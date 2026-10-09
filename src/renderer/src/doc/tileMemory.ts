import type { GPU, Surface } from '../gl/gpu'
import type { TileKey } from '../core/tiles'
import { tileKeyX, tileKeyY } from '../core/tiles'
import { codec, decodeSync as decodeSyncRef, readTilesBatch, scratch, uploadPremult, BATCH_TILES, releaseTileStage } from '../io/tileIo'
import { premultiplyInPlace } from '../io/pngDecode'
import { BudgetOverride, MemBudget, bytesToEvict, deriveBudget, pickVictims, priorityOf } from './tileBudget'
import { BlobCorruptError, Saved, blobHooks, TileStore, memCounters, newSaved, savedBytes, savedBytesAsync, savedRelease, scratchName, tileClock } from './tileStore'
import { blobSum } from '../core/blobSum'

/**
 * Memory manager of the infinite canvas (tier policy in doc/tileBudget.ts):
 *   GPU  resident tiles + undo snapshots   <= budget.gpu   -> LRU eviction (clean tiles free instantly, dirty ones are read back + PNG-encoded first)
 *   RAM  compressed PNG blobs               <= budget.cpu   -> spilled to userData/scratch/<doc>/ through the main process
 *   disk scratch files (deleted with the document, and wiped at every app start)
 * Evicted tiles come back transparently: sync (any accessor) or async via prefetch() (decode in Workers, <= a few uploads per slice).
 */

/** Pre-edit state of one tile inside an undo step: resident surface, compressed blob, or "did not exist". */
export class SnapEntry {
  surf: Surface | null = null
  saved: Saved | null = null
  dead = false
  /** age marker (tileClock at creation / last swap) - old snapshots are evicted first */
  born = tileClock.n
  constructor(readonly docId: string, readonly size: number, readonly fmt: 'rgba8' | 'rgba16f') {}

  get absent(): boolean {
    return !this.surf && !this.saved
  }
  get bytes(): number {
    return this.surf ? this.surf.bytes : 0
  }
  /** Surface for reading the snapshot (decodes a compressed one back; the entry becomes resident again). null = tile absent. */
  surface(gpu: GPU): Surface | null {
    if (this.surf || !this.saved) return this.surf
    let d: Uint8Array | null = null
    try {
      d = decodeBlob(this.docId, this.saved, this.size)
    } catch (e) {
      console.error('[tile-memory] snapshot blob unusable, restoring an empty tile', e)
      memCounters.corrupt++
      blobHooks.onCorrupt?.(this.docId)
    }
    const s = gpu.surface(this.size, this.size, this.fmt, 0)
    if (d) uploadPremult(gpu, s, d)
    else {
      gpu.bindTarget(s, null)
      gpu.gl.clearColor(0, 0, 0, 0)
      gpu.gl.clear(gpu.gl.COLOR_BUFFER_BIT)
    }
    savedRelease(this.docId, this.saved)
    this.saved = null
    this.surf = s
    this.born = tileClock.n
    tileMemory.snaps.add(this)
    return s
  }
  /** Snapshot a layer tile BEFORE it is modified. Evicted tiles are captured as their blob, without decoding. */
  static capture(gpu: GPU, store: TileStore, key: TileKey): SnapEntry {
    const e = new SnapEntry(store.docId, store.size, store.fmt)
    const sv = store.cold.get(key)
    if (sv) {
      e.saved = newSaved(savedBytes(store.docId, sv).slice())
      return e
    }
    const cur = store.peekKey(key)
    if (cur) {
      e.surf = gpu.surface(store.size, store.size, store.fmt, 0)
      gpu.blit(cur, { x: 0, y: 0, w: store.size, h: store.size }, e.surf, 0, 0)
      tileMemory.snaps.add(e)
    }
    return e
  }
  /** Move the tile out of the store into a new entry (no decode, no GPU copy). */
  static takeFrom(store: TileStore, key: TileKey): SnapEntry {
    const e = new SnapEntry(store.docId, store.size, store.fmt)
    const t = store.takeAny(key)
    e.surf = t.surf
    e.saved = t.saved
    if (e.surf) tileMemory.snaps.add(e)
    return e
  }
  /** Put the tile back into the store (undo / redo swap) and empty this entry. */
  giveTo(store: TileStore, key: TileKey): void {
    tileMemory.snaps.delete(this)
    if (this.surf) store.put(key, this.surf)
    else if (this.saved) store.putCold(key, this.saved)
    this.surf = null
    this.saved = null
  }
  dispose(): void {
    this.dead = true
    tileMemory.snaps.delete(this)
    this.surf?.dispose()
    this.surf = null
    if (this.saved) savedRelease(this.docId, this.saved)
    this.saved = null
  }
}

function decodeBlob(doc: string, sv: Saved, size: number): Uint8Array {
  const bytes = savedBytes(doc, sv)
  const d = decodeSyncRef(bytes)
  if (!d || d.w !== size || d.h !== size) throw new Error('snapshot blob cannot be decoded')
  return d.rgba
}

interface Pending {
  store: TileStore
  key: TileKey
  sv: Saved
  prio: number
}
interface Ready {
  store: TileStore
  key: TileKey
  sv: Saved
  rgba: Uint8Array
}

export interface MemStats {
  gpuTiles: number
  gpuBytes: number
  cpuTiles: number
  cpuBytes: number
  diskTiles: number
  diskBytes: number
  snapshots: number
  budget: MemBudget
}

export class TileMemory {
  budget: MemBudget = deriveBudget({})
  readonly stores = new Set<TileStore>()
  readonly snaps = new Set<SnapEntry>()
  /** called after async restores made tiles resident (the app requests a frame) */
  onRestored: (() => void) | null = null
  gpu: GPU | null = null

  private queue: Pending[] = []
  private queued = new Map<Saved, Pending>()
  private active = 0
  private ready: Ready[] = []
  private dirtyQueue = true
  private flushing = false
  private flushQ: { store: TileStore | null; key: TileKey; surf: Surface; entry: SnapEntry | null }[] = []
  private inflight = new Set<Surface>()
  private lastPass = 0
  private spilling = 0
  private applyTimer: ReturnType<typeof setTimeout> | null = null
  private idleTimer: ReturnType<typeof setInterval> | null = null
  /** stats of the last eviction pass (tests / diagnostics) */
  readonly pass = { evictedClean: 0, flushed: 0, spilled: 0 }

  /** Derive the budgets from the device and the Prefs override (localStorage `bw.tileMem` = {gpuMB, cpuMB}). */
  configure(gpu: GPU | null, override?: BudgetOverride): void {
    this.gpu = gpu ?? this.gpu
    let ov = override
    if (!ov) {
      try {
        ov = JSON.parse(localStorage.getItem('bw.tileMem') ?? 'null') ?? undefined
      } catch {
        ov = undefined
      }
    }
    const dm = (navigator as unknown as { deviceMemory?: number }).deviceMemory
    this.budget = deriveBudget({ deviceMemoryGB: dm, maxTexture: this.gpu?.maxTexture }, ov ?? {})
  }

  register(store: TileStore, docId: string): void {
    store.docId = docId
    store.onDispose = () => this.unregister(store)
    this.stores.add(store)
    this.gpu ??= store.gpu
    if (!this.idleTimer) this.idleTimer = setInterval(() => this.tick(false), 400)
  }
  unregister(store: TileStore): void {
    this.stores.delete(store)
  }
  /** Drop every scratch file of a closed document. */
  dropDoc(docId: string): void {
    void scratch().drop(docId)
  }

  // ------------------------------------------------------------------ accounting
  residentBytes(): number {
    let b = 0
    for (const s of this.stores) b += s.bytes
    for (const e of this.snaps) b += e.bytes
    return b
  }
  stats(stores?: Iterable<TileStore>): MemStats {
    let gpuTiles = 0
    let cpuTiles = 0
    let diskTiles = 0
    let cpuBytes = 0
    let diskBytes = 0
    for (const s of stores ?? this.stores) {
      gpuTiles += s.map.size
      for (const sv of s.cold.values()) {
        if (sv.png) (cpuTiles++, (cpuBytes += sv.png.length))
        else (diskTiles++, (diskBytes += sv.size))
      }
    }
    return { gpuTiles, gpuBytes: this.residentBytes(), cpuTiles, cpuBytes: memCounters.cpuBytes || cpuBytes, diskTiles, diskBytes, snapshots: this.snaps.size, budget: this.budget }
  }

  // ------------------------------------------------------------------ frame tick
  /** Called once per presented frame (and by a 400 ms idle timer): advance the LRU clock, apply restores, evict / spill when over budget. */
  tick(frame = true): void {
    if (frame) tileClock.n++
    this.applyReady(3, 4)
    this.pump()
    const used = this.residentBytes()
    const now = performance.now()
    if (used > this.budget.gpu && !this.flushing && now - this.lastPass > (frame ? 60 : 0)) {
      this.lastPass = now
      this.evictPass(used)
    }
    if (memCounters.cpuBytes > this.budget.cpu) this.spillPass()
  }

  private evictPass(used: number): void {
    const need = bytesToEvict(used, this.budget.gpu)
    const pin = tileClock.n - 2
    interface Ref {
      store: TileStore | null
      key: TileKey
      surf: Surface
      entry: SnapEntry | null
    }
    const refs: Ref[] = []
    const cands: { id: number; stamp: number; bytes: number }[] = []
    for (const st of this.stores) {
      if (st.fmt !== 'rgba8') continue
      for (const [key, surf] of st.map) {
        if (this.inflight.has(surf)) continue
        cands.push({ id: refs.length, stamp: st.stamp.get(key) ?? 0, bytes: surf.bytes })
        refs.push({ store: st, key, surf, entry: null })
      }
    }
    for (const e of this.snaps) {
      if (!e.surf || e.fmt !== 'rgba8' || this.inflight.has(e.surf)) continue
      // old undo snapshots go first: they count as used `SNAP_BIAS` frames before their birth
      cands.push({ id: refs.length, stamp: e.born - SNAP_BIAS, bytes: e.surf.bytes })
      refs.push({ store: null, key: 0, surf: e.surf, entry: e })
    }
    const victims = pickVictims(cands, need, pin)
    this.pass.evictedClean = 0
    for (const v of victims) {
      const r = refs[v.id]
      if (r.store && r.store.isClean(r.key)) {
        if (r.store.evictClean(r.key)) this.pass.evictedClean++
        continue
      }
      this.inflight.add(r.surf)
      this.flushQ.push(r)
    }
    if (this.flushQ.length && !this.flushing) void this.runFlush()
  }

  /** Read dirty victims back (several tiles per readback), encode them in the Worker pool, then evict them. */
  private async runFlush(): Promise<void> {
    this.flushing = true
    const gpu = this.gpu!
    try {
      while (this.flushQ.length) {
        const batch = this.flushQ.splice(0, BATCH_TILES)
        let res
        try {
          res = await readTilesBatch(
            gpu,
            batch.map((b) => ({ surf: b.surf, alive: () => (b.store ? b.store.peekKey(b.key) === b.surf : !!b.entry && !b.entry.dead && b.entry.surf === b.surf) }))
          )
        } catch (e) {
          for (const b of batch) this.inflight.delete(b.surf)
          console.error('[tile-memory] readback failed', e)
          continue
        }
        const jobs = batch.map(async (b, i) => {
          const r = res[i]
          try {
            if (!r) return
            const png = await codec.encode(r.buf)
            this.pass.flushed++
            if (b.store) {
              if (b.store.attach(b.key, b.surf, r.rev, png) && this.residentBytes() > this.budget.gpu * 0.9 && (b.store.stamp.get(b.key) ?? 0) < tileClock.n - 2) b.store.evictClean(b.key)
            } else if (b.entry && !b.entry.dead && b.entry.surf === b.surf && b.surf.rev === r.rev) {
              b.entry.saved = newSaved(png)
              b.entry.surf = null
              this.snaps.delete(b.entry)
              b.surf.dispose()
              memCounters.evictions++
            }
          } finally {
            this.inflight.delete(b.surf)
          }
        })
        // keep the encoders busy but bounded: wait while many jobs are outstanding
        if (codec.pending > codec.size * 3) await Promise.all(jobs)
        else void Promise.all(jobs)
      }
      while (codec.pending > 0) await new Promise((r) => setTimeout(r, 4))
    } finally {
      this.flushing = false
    }
  }

  private spillPass(): void {
    if (this.spilling >= 8) return
    const cap = this.budget.cpu * 0.85
    // 1) saved forms of resident tiles are regenerable: drop them first
    for (const st of this.stores) {
      if (memCounters.cpuBytes <= cap) return
      for (const key of [...st.clean.keys()]) {
        if (memCounters.cpuBytes <= cap) return
        if (!st.isClean(key) || (st.stamp.get(key) ?? 0) >= tileClock.n - 2) continue
        st.dropClean(key)
      }
    }
    // 2) evicted tiles' blobs go to the scratch disk (Map order = eviction order = oldest first)
    for (const st of this.stores) {
      for (const [, sv] of st.cold) {
        if (memCounters.cpuBytes <= cap || this.spilling >= 8) return
        if (sv.png && !sv.disk) this.spill(st.docId, sv)
      }
    }
  }

  private spill(docId: string, sv: Saved): void {
    const png = sv.png!
    sv.sum ??= blobSum(png) // blobs viewed out of a loaded file get their checksum when they leave RAM
    const name = scratchName()
    this.spilling++
    this.pass.spilled++
    void scratch()
      // a view into a bigger buffer (tiles of a loaded .bwk) is copied first: IPC structured clone may serialise the whole backing buffer
      .put(docId, name, png.byteOffset === 0 && png.byteLength === png.buffer.byteLength ? png : png.slice())
      .then(
        () => {
          if (sv.png !== png) {
            void scratch().remove(docId, name) // released / restored meanwhile
            return
          }
          sv.disk = name
          sv.png = null
          memCounters.cpuBytes -= png.length
          memCounters.diskBytes += sv.size
          memCounters.spills++
        },
        (e) => console.error('[tile-memory] spill failed', e)
      )
      .finally(() => this.spilling--)
  }

  // ------------------------------------------------------------------ async restore
  /** Ask for the evicted tile `key` to be brought back; `prio` = smaller first (distance from the view centre). Idempotent. */
  prefetch(store: TileStore, key: TileKey, prio: number): void {
    const sv = store.cold.get(key)
    if (!sv) return
    const p = this.queued.get(sv)
    if (p) {
      if (prio < p.prio) (p.prio = prio), (this.dirtyQueue = true)
      return
    }
    const np: Pending = { store, key, sv, prio }
    this.queued.set(sv, np)
    this.queue.push(np)
    this.dirtyQueue = true
    this.pump()
  }
  prefetchAround(store: TileStore, key: TileKey, cx: number, cy: number): void {
    this.prefetch(store, key, priorityOf(tileKeyX(key), tileKeyY(key), cx, cy))
  }
  get pendingRestores(): number {
    return this.queue.length + this.active + this.ready.length
  }

  private pump(): void {
    const maxActive = Math.max(2, codec.size)
    if (this.dirtyQueue) {
      this.queue.sort((a, b) => b.prio - a.prio) // best last -> pop()
      this.dirtyQueue = false
    }
    while (this.queue.length && this.active + this.ready.length < maxActive + 4 && this.active < maxActive) {
      const p = this.queue.pop()!
      if (p.store.cold.get(p.key) !== p.sv) {
        this.queued.delete(p.sv)
        continue
      }
      this.active++
      void this.load(p)
    }
  }

  private async load(p: Pending): Promise<void> {
    try {
      const bytes = await savedBytesAsync(p.store.docId, p.sv)
      if (bytes && p.store.cold.get(p.key) === p.sv) {
        let d = await codec.decode(bytes)
        if (!d) {
          // the browser decoder reads every valid PNG (foreign / unusual encoders)
          const { decodeImage } = await import('../io/bwk')
          const img = await decodeImage(bytes)
          d = { w: img.width, h: img.height, rgba: premultiplyInPlace(new Uint8Array(img.data.buffer.slice(0))) }
        }
        if (d.w === p.store.size && d.h === p.store.size) this.ready.push({ store: p.store, key: p.key, sv: p.sv, rgba: d.rgba })
      }
    } catch (e) {
      console.error('[tile-memory] restore failed', e)
      // a blob that failed its checksum has no intact copy: drop it so the tile is not retried forever (the app was told through blobHooks)
      if (e instanceof BlobCorruptError && p.store.cold.get(p.key) === p.sv) p.store.free(p.key)
    } finally {
      this.active--
      this.queued.delete(p.sv)
      this.armApply()
    }
  }

  private armApply(): void {
    if (this.applyTimer) return
    this.applyTimer = setTimeout(() => {
      this.applyTimer = null
      this.applyReady(3, 4)
      this.pump()
      if (this.ready.length || this.queue.length || this.active) this.armApply()
    }, 0)
  }

  /** Upload decoded tiles (at most `n` and `ms` per slice so panning never stalls). */
  applyReady(n: number, ms: number): void {
    if (!this.ready.length) return
    const t0 = performance.now()
    let applied = 0
    while (this.ready.length && applied < n && performance.now() - t0 < ms) {
      const r = this.ready.shift()!
      if (r.store.restoreWith(r.key, r.sv, r.rgba)) applied++
    }
    if (applied) this.onRestored?.()
  }

  /** Test helper: wait until every queued restore is applied. */
  async settle(timeoutMs = 20000): Promise<void> {
    const t0 = performance.now()
    while (this.pendingRestores || this.flushing || this.flushQ.length) {
      this.applyReady(64, 50)
      this.pump()
      if (performance.now() - t0 > timeoutMs) throw new Error('tile memory did not settle')
      await new Promise((r) => setTimeout(r, 4))
    }
  }

  dispose(): void {
    if (this.idleTimer) clearInterval(this.idleTimer)
    this.idleTimer = null
    if (this.gpu) releaseTileStage(this.gpu)
  }
}

/** Snapshots count as this many frames older than they are (they are the cheapest thing to lose). */
const SNAP_BIAS = 600

export const tileMemory = new TileMemory()
