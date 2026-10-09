import { Zip, ZipPassThrough } from 'fflate'
import type { TileKey } from '../core/tiles'
import type { Surface } from '../gl/gpu'
import { tileKeyX, tileKeyY } from '../core/tiles'
import type { Document } from '../doc/document'
import type { TileStore } from '../doc/tileStore'
import { BATCH_TILES, codec, nextTask, readTilesBatch, scratch } from './tileIo'
import { tileFileName } from './bwkInfinite'
import { saveStats } from './asyncSave'

/** yield to the event loop only when the current slice has run long enough to matter for a 60 fps frame */
let sliceStart = 0
export async function yieldIfSlow(ms = 6): Promise<void> {
  const now = performance.now()
  if (!sliceStart) sliceStart = now
  if (now - sliceStart < ms) return
  await nextTask()
  sliceStart = performance.now()
}

/** Receives the zip as it is produced (renderer -> main process in ~1 MB pieces), so a huge document never exists as one buffer. */
export interface ByteSink {
  write(chunk: Uint8Array): Promise<void>
}

export const infSaveStats = { readMs: 0, thumbMs: 0, tiles: 0, encoded: 0, reusedBlobs: 0, ms: 0, readbackBatches: 0 }

interface TileJob {
  store: TileStore
  key: TileKey
  name: string
}

/** The PNG bytes of tile `key` when a valid saved form exists (RAM or disk), else null. */
async function savedPng(store: TileStore, key: TileKey): Promise<Uint8Array | null> {
  const sv = store.savedOf(key)
  if (!sv) return null
  if (sv.png) return sv.png
  if (sv.disk) return scratch().get(store.docId, sv.disk)
  return null
}

/**
 * Write the tiles of an infinite document: tiles with a valid saved PNG (clean resident tiles, evicted tiles) are reused byte for byte;
 * dirty tiles are read back several per GPU readback and encoded by the Worker pool; the zip is streamed.
 * `files` = small named entries (manifest, thumbnail, extension data) written first/last.
 */
export async function writeInfiniteZip(
  doc: Document,
  files: Record<string, Uint8Array>,
  manifest: () => Uint8Array,
  late: Record<string, () => Promise<Uint8Array>>,
  sink: ByteSink | null,
  check: () => void
): Promise<Uint8Array> {
  const t0 = performance.now()
  const out: Uint8Array[] = []
  let queued = 0
  let sinkErr: unknown = null
  const flushQ: Uint8Array[] = []
  const zip = new Zip((err, chunk) => {
    if (err) {
      sinkErr = err
      return
    }
    if (sink) {
      flushQ.push(chunk)
      queued += chunk.length
    } else out.push(chunk)
  })
  const flush = async (force = false): Promise<void> => {
    if (!sink || (!force && queued < 1 << 20)) return
    if (!flushQ.length) return
    const buf = new Uint8Array(queued)
    let o = 0
    for (const c of flushQ) (buf.set(c, o), (o += c.length))
    flushQ.length = 0
    queued = 0
    await sink.write(buf)
  }
  const add = (name: string, data: Uint8Array): void => {
    const f = new ZipPassThrough(name)
    zip.add(f)
    f.push(data, true)
  }
  for (const [n, d] of Object.entries(files)) add(n, d)

  // ---- gather jobs
  const jobs: TileJob[] = []
  for (const l of doc.layers) {
    if (l.isGroup || !l.tiles) continue
    for (const key of l.tiles.keys()) jobs.push({ store: l.tiles, key, name: tileFileName(l.id, tileKeyX(key), tileKeyY(key)) })
  }
  infSaveStats.tiles = jobs.length
  infSaveStats.encoded = 0
  infSaveStats.reusedBlobs = 0
  infSaveStats.readbackBatches = 0
  infSaveStats.readMs = 0

  // ---- 1) reuse saved forms; the rest must be encoded
  const dirty: TileJob[] = []
  const ready = new Map<TileJob, Uint8Array>()
  for (let i = 0; i < jobs.length; i++) {
    const j = jobs[i]
    const png = await savedPng(j.store, j.key)
    if (png) {
      ready.set(j, png)
      infSaveStats.reusedBlobs++
    } else dirty.push(j)
    if ((i & 63) === 63) {
      check()
    }
    await yieldIfSlow()
  }

  // ---- 2) dirty tiles: batched readback + parallel encode (the stage is shared, so batches are serial; encodes overlap)
  const gpu = doc.gpu
  const inflight = new Set<Promise<void>>()
  let failure: unknown = null
  const empties: TileJob[] = []
  type Pend = { batch: TileJob[]; surfs: Surface[]; p: ReturnType<typeof readTilesBatch>; t: number }
  const pend: Pend[] = []
  const drain = async (): Promise<void> => {
    const x = pend.shift()!
    const res = await x.p
    infSaveStats.readbackBatches++
    infSaveStats.readMs += performance.now() - x.t
    x.batch.forEach((j, k) => {
      const r = res[k]
      if (!r) {
        failure = new Error('tile changed during save')
        return
      }
      const p = codec.encodeEx(r.buf).then(
        ({ png, empty }) => {
          ready.set(j, png)
          if (empty) empties.push(j)
          else j.store.attach(j.key, x.surfs[k], r.rev, png)
          infSaveStats.encoded++
          saveStats.encoded++
          inflight.delete(p)
        },
        (e) => {
          failure = e
          inflight.delete(p)
        }
      )
      inflight.add(p)
    })
    while (inflight.size > codec.size * 2) await Promise.race(inflight)
  }
  for (let i = 0; i < dirty.length && !failure; i += BATCH_TILES) {
    check()
    const batch = dirty.slice(i, i + BATCH_TILES)
    const surfs = batch.map((j) => j.store.getKey(j.key)!)
    // up to 3 readbacks in flight: the fence latency (about a frame) is hidden behind the next batches
    pend.push({ batch, surfs, t: performance.now(), p: readTilesBatch(gpu, surfs.map((s, k) => ({ surf: s, alive: () => batch[k].store.peekKey(batch[k].key) === s }))) })
    if (pend.length >= 3) await drain()
    await yieldIfSlow(2)
  }
  while (pend.length) await drain()
  await Promise.all(inflight)
  if (failure) throw failure
  check()
  // tiles that turned out fully transparent are dropped (no PNG, not listed) - found for free while encoding, no GPU round trip per tile
  if (empties.length) {
    const gone = new Set(empties)
    for (const j of empties) if (j.store.peekKey(j.key)) j.store.free(j.key)
    for (let i = jobs.length - 1; i >= 0; i--) if (gone.has(jobs[i])) jobs.splice(i, 1)
  }
  add('manifest.json', manifest())

  // ---- 3) stream the zip
  let n = 0
  for (const j of jobs) {
    const png = ready.get(j)!
    add(j.name, png)
    if (sinkErr) throw sinkErr
    if (++n % 8 === 0) {
      await flush()
      check()
      await yieldIfSlow()
    }
  }
  for (const [name, get] of Object.entries(late)) add(name, await get())
  zip.end()
  if (sinkErr) throw sinkErr
  await flush(true)
  infSaveStats.ms = performance.now() - t0
  if (sink) return new Uint8Array(0)
  let total = 0
  for (const c of out) total += c.length
  const all = new Uint8Array(total)
  let o = 0
  for (const c of out) (all.set(c, o), (o += c.length))
  return all
}
