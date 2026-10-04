import type { App } from '../../app/app'
import { Emitter } from '../../core/events'
import type { Document } from '../../doc/document'
import type { Surface } from '../../gl/gpu'
import { registerBwkExtension, type BwkExtSave } from '../../io/bwk'
import { animioApi } from './api'
import { readbackAsync, resample } from '../../io/gpuUtil'
import { TL_QUALITY, TlQuality, tlFrameSize } from './schedule'
import { FrameTag, HistSig, HistoryTracker } from './tlHistory'
import { TlEdit, clampEditToFrames, defaultEdit, halveEditIndices, normalizeEdit } from './tlModel'
import { prefs } from '../../input/prefs'
import { galleryRef } from '../color/galleryRef'

/**
 * Time-lapse recorder. One per document, created automatically when the document is bound (new / open).
 *
 * Pipeline (never blocks the drawing loop):
 *   doc 'commit' -> coalesce (>=150 ms apart, wait until the compositor drew it: 2 rAFs) -> GPU box-downscale of the
 *   live composite (+ paper colour) into a small RGBA8 surface -> async pixel-pack-buffer readback (fence polled, no
 *   stall) -> JPEG in a Worker -> IPC append to an on-disk file in the main process.  While a long stroke is in
 *   progress a frame is also captured every ~1.5 s.  The file is embedded into the .bwk on save and restored on load,
 *   so recording continues seamlessly across sessions.
 */
const MIN_INTERVAL = 150
const LIVE_INTERVAL = 1500
const IDLE_MS = 8000
export const MAX_FRAMES = 3000
export const MAX_BYTES = 400e6

export interface TlSettings {
  enabled: boolean
  quality: TlQuality
}

// ------------------------------------------------------------------ worker client
let worker: Worker | null = null
let jobSeq = 0
const waiting = new Map<number, { ok: (b: Uint8Array) => void; err: (e: Error) => void }>()
function encodeJpeg(pixels: Uint8Array<ArrayBuffer>, w: number, h: number, quality: number): Promise<Uint8Array> {
  if (!worker) {
    worker = new Worker(new URL('./tlWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<{ id: number; bytes?: ArrayBuffer; error?: string }>): void => {
      const w = waiting.get(e.data.id)
      if (!w) return
      waiting.delete(e.data.id)
      if (e.data.bytes) w.ok(new Uint8Array(e.data.bytes))
      else w.err(new Error(e.data.error ?? 'encode failed'))
    }
    worker.onerror = (e): void => console.error('[timelapse] worker error', e.message)
  }
  const id = ++jobSeq
  return new Promise((ok, err) => {
    waiting.set(id, { ok, err })
    worker!.postMessage({ id, w, h, quality, pixels: pixels.buffer }, [pixels.buffer])
  })
}

// rAF never fires while the window is hidden/minimised: never wait on it unboundedly (would hang save/export flush)
const raf2 = (): Promise<void> =>
  new Promise((r) => {
    requestAnimationFrame(() => requestAnimationFrame(() => r()))
    setTimeout(r, 250)
  })

export interface RecorderEvents {
  change: void
  /** the non-destructive edit settings (tlModel.ts TlEdit) changed */
  edit: void
}

const sigOf = (doc: Document): HistSig => {
  const h = doc.history
  return { pushes: h.pushes, undos: h.undos, redos: h.redos, clears: h.clears, undoCount: h.undoCount, redoCount: h.redoCount }
}

export class TimelapseRecorder {
  readonly id = 'tl' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
  readonly events = new Emitter<RecorderEvents>()
  enabled = true
  quality: TlQuality = 'hd'
  count = 0
  bytes = 0
  strokes = 0
  trackedMs = 0
  /** true once main has the file open */
  ready: Promise<void>

  private small: Surface | null = null
  private capturing = false
  private again = false
  private timer = 0
  private lastCapture = 0
  private lastCommit = performance.now()
  private pendingDt = 0
  private disposed = false
  private offs: (() => void)[] = []
  private tick = 0
  private inflight: Promise<void> = Promise.resolve()
  /** history tree mirror: every frame is tagged with the state it shows (see tlHistory.ts) */
  tracker: HistoryTracker
  /** commit type of the latest operation (undo / redo are reported as such) */
  private lastType = 'init'
  /** non-destructive edit of the video (the recording itself is never modified) */
  edit: TlEdit

  constructor(
    private app: App,
    readonly doc: Document,
    restore?: PendingRestore
  ) {
    const api = animioApi().tl
    const lastS = restore ? [...restore.index].reverse().find((e) => typeof e.s === 'number')?.s : undefined
    this.tracker = new HistoryTracker(sigOf(doc), restore?.parents.length && lastS !== undefined ? { parents: restore.parents, curr: lastS } : undefined)
    this.edit = restore?.edit ? normalizeEdit(restore.edit, prefs.v.timelapseHideUndone) : defaultEdit(prefs.v.timelapseHideUndone)
    if (restore) {
      this.enabled = restore.settings.enabled
      this.quality = restore.settings.quality
      this.strokes = restore.strokes
      this.trackedMs = restore.trackedMs
      this.ready = api.load(this.id, restore.data, restore.index).then((r) => {
        this.count = r.count
        this.bytes = r.bytes
      })
    } else this.ready = api.start(this.id)
    this.offs.push(doc.events.on('commit', (e) => this.onCommit(e.type)))
    // an old recording without a state tree continues with a fresh one (its frames stay "always shown")
    this.tick = window.setInterval(() => this.onTick(), 500)
    // first frame: the document as it is right now (blank for a new canvas)
    void this.ready.then(() => {
      if (this.count === 0) this.schedule(0)
      else this.events.emit('change', undefined)
    })
  }

  get settings(): TlSettings {
    return { enabled: this.enabled, quality: this.quality }
  }
  setEnabled(on: boolean): void {
    if (on === this.enabled) return
    this.enabled = on
    if (on) this.schedule(0) // a frame right away so the gap is visible as a jump, not a glitch
    this.events.emit('change', undefined)
  }
  setQuality(q: TlQuality): void {
    this.quality = q
    this.events.emit('change', undefined)
  }

  /** Full-length duration in seconds at 30 fps. */
  get seconds(): number {
    return this.count / 30
  }

  /** Replace the edit settings (persisted with the recording; autosave is armed). */
  setEdit(e: TlEdit): void {
    this.edit = e
    this.events.emit('edit', undefined)
    galleryRef.store?.touchDoc(this.doc)
  }

  /** Per-frame tags (state id + commit type) for the editor / hide-undone computation. */
  async tags(): Promise<(FrameTag & { d: number })[]> {
    await this.flush()
    return animioApi().tl.tags(this.id)
  }

  private onCommit(type: string): void {
    const tr = this.tracker.observe(sigOf(this.doc), type)
    this.lastType = tr.kind === 'undo' || tr.kind === 'redo' ? tr.kind : type
    const now = performance.now()
    const delta = Math.min(now - this.lastCommit, IDLE_MS)
    this.lastCommit = now
    if (type === 'stroke' || type === 'erase' || type === 'smudge') this.strokes++
    if (!this.enabled) return
    this.trackedMs += delta
    this.pendingDt += delta
    this.schedule(MIN_INTERVAL)
  }

  private onTick(): void {
    if (this.disposed || !this.enabled) return
    const now = performance.now()
    if (this.app.engine.active) {
      // long stroke in progress: count the time and capture a partial frame now and then
      this.trackedMs += now - this.lastCommit
      this.pendingDt += now - this.lastCommit
      this.lastCommit = now
      if (now - this.lastCapture >= LIVE_INTERVAL) this.schedule(0)
    }
  }

  /** Queue a capture no sooner than `minGap` ms after the previous one. */
  private schedule(minGap: number): void {
    if (this.disposed || !this.enabled || this.timer) return
    const wait = Math.max(0, minGap - (performance.now() - this.lastCapture))
    this.timer = window.setTimeout(() => {
      this.timer = 0
      this.inflight = this.capture()
    }, wait)
  }

  /** Capture immediately (after the compositor caught up) and wait until all frames are on disk. */
  async flush(): Promise<void> {
    await this.ready
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = 0
      this.inflight = this.capture()
    }
    // wait for whatever is running, plus a follow-up if changes arrived meanwhile
    for (let i = 0; i < 4; i++) {
      await this.inflight
      if (!this.again && !this.timer) break
      if (this.timer) {
        clearTimeout(this.timer)
        this.timer = 0
        this.inflight = this.capture()
      }
    }
  }

  private async capture(): Promise<void> {
    if (this.disposed || !this.enabled) return
    if (this.capturing) {
      this.again = true
      return
    }
    this.capturing = true
    this.again = false
    try {
      await this.ready
      await raf2() // let App.frame() compose the latest state into compositor.composite
      if (this.disposed || this.app.doc !== this.doc) return
      const gpu = this.app.gpu
      const { width, height } = tlFrameSize(this.doc.width, this.doc.height, this.quality)
      if (!this.small || this.small.w !== width || this.small.h !== height) {
        this.small?.dispose()
        this.small = gpu.surface(width, height, 'rgba8')
      }
      // tag the frame with the history state it shows (read right here: nothing can change between this and the resample)
      const live = this.app.engine.active
      const meta = this.count === 0 && !this.tracker.parents.slice(1).length ? { t: 'init', s: this.tracker.curr } : live ? { t: 'live', s: this.tracker.nextId } : { t: this.lastType, s: this.tracker.curr }
      const bg = this.doc.background
      resample(gpu, this.app.compositor.composite, this.small, { paper: bg.visible ? bg.color : [1, 1, 1] })
      const dt = this.pendingDt
      this.pendingDt = 0
      this.lastCapture = performance.now()
      const px = await readbackAsync(gpu, this.small)
      const jpg = await encodeJpeg(px, width, height, TL_QUALITY[this.quality].jpeg)
      if (this.disposed) return
      const r = await animioApi().tl.append(this.id, jpg, dt, meta)
      this.count = r.count
      this.bytes = r.bytes
      if (this.count > MAX_FRAMES || this.bytes > MAX_BYTES) {
        const d = await animioApi().tl.decimate(this.id)
        this.count = d.count
        this.bytes = d.bytes
        // the editor addresses frames by index: follow the thinning
        this.edit = halveEditIndices(this.edit)
        this.events.emit('edit', undefined)
      }
      this.events.emit('change', undefined)
    } catch (e) {
      console.error('[timelapse] capture failed', e)
    } finally {
      this.capturing = false
      if (this.again && !this.disposed) this.schedule(MIN_INTERVAL)
    }
  }

  /** Discard all recorded frames (Procreate: recording is reset when the canvas is resized/cropped). */
  async reset(): Promise<void> {
    await this.flush()
    await animioApi().tl.start(this.id)
    this.tracker = new HistoryTracker(sigOf(this.doc))
    this.lastType = 'init'
    this.edit = defaultEdit(this.edit.hideUndone)
    this.count = 0
    this.bytes = 0
    this.strokes = 0
    this.trackedMs = 0
    this.pendingDt = 0
    this.events.emit('change', undefined)
    this.events.emit('edit', undefined)
    if (this.enabled) this.schedule(0)
  }

  async frame(i: number): Promise<Uint8Array | null> {
    return animioApi().tl.frame(this.id, i)
  }

  dispose(): void {
    this.disposed = true
    clearTimeout(this.timer)
    clearInterval(this.tick)
    for (const o of this.offs) o()
    this.small?.dispose()
    void animioApi().tl.close(this.id)
  }
}

// ------------------------------------------------------------------ persistence (.bwk)
interface PendingRestore {
  settings: TlSettings
  strokes: number
  trackedMs: number
  data: Uint8Array
  index: { o: number; l: number; d: number; t?: string; s?: number }[]
  /** history state tree (parents[id]); empty for recordings made before the editor existed */
  parents: number[]
  edit: unknown
}
const pendingRestore = new WeakMap<Document, PendingRestore>()
const recorders = new WeakMap<Document, TimelapseRecorder>()
/** what of the recording is already cached in the save worker */
const packCache = new WeakMap<TimelapseRecorder, { gen: number; len: number; keys: string[]; n: number }>()
export const getRecorder = (doc: Document): TimelapseRecorder | undefined => recorders.get(doc)

registerBwkExtension({
  id: 'animio.timelapse',
  async save(doc, ctx): Promise<BwkExtSave | void> {
    const rec = recorders.get(doc)
    if (!rec) return
    await rec.flush()
    const extra = { enabled: rec.enabled, quality: rec.quality, strokes: rec.strokes, trackedMs: Math.round(rec.trackedMs), frames: rec.count, edit: clampEditToFrames(rec.edit, rec.count) }
    const tree = new TextEncoder().encode(JSON.stringify(rec.tracker.parents))
    if (!rec.count) return { extra, files: { 'timelapse/tree.json': tree } }
    // Incremental: the recording is append-only, so only the bytes added since the last save cross the IPC (1 MB pieces),
    // and they are cached in the save worker - a multi-hundred-MB recording never lands on the main thread again.
    const api = animioApi().tl
    const info = await api.packInfo(rec.id)
    let c = packCache.get(rec)
    if (!c || c.gen !== info.gen || c.len > info.offset || !c.keys.every((k) => ctx.blobs.has(k))) packCache.set(rec, (c = { gen: info.gen, len: 0, keys: [], n: c ? c.n + 1 : 0 }))
    const STEP = 1 << 20
    while (c.len < info.offset) {
      const chunk = await api.packRange(rec.id, c.len, Math.min(STEP, info.offset - c.len))
      if (!chunk.length) break
      const key = `tl:${rec.id}:${c.n}:${c.keys.length}`
      c.len += chunk.length
      c.keys.push(key)
      ctx.blobs.put(key, chunk)
    }
    if ((await api.packInfo(rec.id)).gen !== info.gen) throw new Error('time-lapse was rewritten while saving') // decimated: retry later
    return { extra, files: { 'timelapse/index.json': new TextEncoder().encode(JSON.stringify(info.index)), 'timelapse/tree.json': tree }, blobFiles: { 'timelapse/frames.bin': c.keys.slice() } }
  },
  load(doc, extra, entries) {
    const e = (extra ?? {}) as Record<string, unknown>
    const data = entries['timelapse/frames.bin']
    const idx = entries['timelapse/index.json']
    let index: PendingRestore['index'] = []
    try {
      if (idx) index = JSON.parse(new TextDecoder().decode(idx))
    } catch {
      index = []
    }
    let parents: number[] = []
    try {
      const tr = entries['timelapse/tree.json']
      const p = tr ? JSON.parse(new TextDecoder().decode(tr)) : []
      if (Array.isArray(p) && p.every((x) => Number.isInteger(x))) parents = p
    } catch {
      parents = []
    }
    const q = e.quality === 'max' || e.quality === 'small' ? e.quality : 'hd'
    pendingRestore.set(doc, {
      settings: { enabled: e.enabled !== false, quality: q },
      strokes: Number(e.strokes) || 0,
      trackedMs: Number(e.trackedMs) || 0,
      data: data ?? new Uint8Array(0),
      index: data ? index : [],
      parents,
      edit: e.edit
    })
  }
})

// ------------------------------------------------------------------ manager
export interface TimelapseManager {
  readonly current: TimelapseRecorder | null
  readonly events: Emitter<{ recorder: TimelapseRecorder }>
}

export function installTimelapse(app: App): TimelapseManager {
  const events = new Emitter<{ recorder: TimelapseRecorder }>()
  const mgr: TimelapseManager & { current: TimelapseRecorder | null } = { current: null, events }
  const attach = (doc: Document): void => {
    const prev = mgr.current
    if (prev && prev.doc !== doc) {
      // the old document may still be autosaving (its .bwk embeds the recording): dispose after it is retired
      const held = app.whenRetired(prev.doc)
      if (held) void held.then(() => prev.dispose())
      else prev.dispose()
    }
    if (recorders.has(doc)) {
      mgr.current = recorders.get(doc)!
      return
    }
    const rec = new TimelapseRecorder(app, doc, pendingRestore.get(doc))
    pendingRestore.delete(doc)
    recorders.set(doc, rec)
    mgr.current = rec
    events.emit('recorder', rec)
  }
  app.events.on('doc', attach)
  attach(app.doc)
  return mgr
}
