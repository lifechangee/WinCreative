import type { GPU, Surface } from '../gl/gpu'
import { decodePng, premultiplyInPlace } from './pngDecode'

/**
 * I/O primitives of the tile memory system (doc/tileMemory.ts, io/bwk.ts):
 *  - TileCodec : pool of Workers (hardwareConcurrency - 1) turning straight RGBA8 <-> PNG
 *  - readTilesBatch : several tiles per GPU readback (vertical atlas -> one pixel-pack buffer -> fence), async
 *  - Scratch : per-document scratch files in the main process (userData/scratch/<docId>/), in-memory fallback without Electron
 */

export const TILE_PX = 512

// ------------------------------------------------------------------ codec pool
interface Job {
  ok: (v: any) => void
  err: (e: Error) => void
  w: Worker
}

class CodecPool {
  private workers: Worker[] = []
  private load: number[] = []
  private jobs = new Map<number, Job>()
  private seq = 0
  size = Math.max(1, Math.min(8, (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4) - 1))

  private ensure(): void {
    if (this.workers.length) return
    for (let i = 0; i < this.size; i++) {
      const w = new Worker(new URL('./tileWorker.ts', import.meta.url), { type: 'module' })
      w.onmessage = (e: MessageEvent): void => {
        const m = e.data
        const j = this.jobs.get(m.id)
        if (!j) return
        this.jobs.delete(m.id)
        this.load[this.workers.indexOf(j.w)]--
        if (m.t === 'err') j.err(new Error(m.error))
        else j.ok(m)
      }
      w.onerror = (e): void => this.reset(new Error('tile worker error: ' + e.message))
      this.workers.push(w)
      this.load.push(0)
    }
  }
  reset(err: Error): void {
    for (const w of this.workers) w.terminate()
    this.workers = []
    this.load = []
    const list = [...this.jobs.values()]
    this.jobs.clear()
    for (const j of list) j.err(err)
  }
  private run<T>(msg: Record<string, unknown>, transfer: Transferable[]): Promise<T> {
    this.ensure()
    let k = 0
    for (let i = 1; i < this.workers.length; i++) if (this.load[i] < this.load[k]) k = i
    const id = ++this.seq
    this.load[k]++
    return new Promise<T>((ok, err) => {
      this.jobs.set(id, { ok, err, w: this.workers[k] })
      this.workers[k].postMessage({ ...msg, id }, transfer)
    })
  }
  get pending(): number {
    return this.jobs.size
  }
  /** straight RGBA8 (ownership of `rgba` transfers) -> PNG bytes */
  async encode(rgba: ArrayBuffer, w = TILE_PX, h = TILE_PX): Promise<Uint8Array> {
    return (await this.encodeEx(rgba, w, h)).png
  }
  /** like encode(), also reporting whether the tile had no pixel with alpha > 0 */
  async encodeEx(rgba: ArrayBuffer, w = TILE_PX, h = TILE_PX): Promise<{ png: Uint8Array; empty: boolean }> {
    const t0 = performance.now()
    const m = await this.run<{ png: Uint8Array; empty: boolean }>({ t: 'enc', w, h, rgba }, [rgba])
    ioStats.encodeMs += performance.now() - t0
    ioStats.encodes++
    return { png: m.png, empty: m.empty }
  }
  /** PNG -> straight RGBA8 (the input is copied, the caller keeps it); null when the PNG is not decodable by the fast path */
  async decode(png: Uint8Array): Promise<{ w: number; h: number; rgba: Uint8Array } | null> {
    const copy = png.slice()
    const m = await this.run<{ rgba: Uint8Array | null; w: number; h: number }>({ t: 'dec', png: copy }, [copy.buffer])
    return m.rgba ? { w: m.w, h: m.h, rgba: m.rgba } : null
  }
}
export const codec = new CodecPool()

/** Synchronous PNG -> PREMULTIPLIED RGBA (main thread); null if unsupported. */
export function decodeSync(png: Uint8Array): { w: number; h: number; rgba: Uint8Array } | null {
  const d = decodePng(png)
  if (d) premultiplyInPlace(d.rgba)
  return d
}

/** Raw upload of premultiplied RGBA8 bytes into a tile surface (no shader pass). The surface must exist already (GL rule). */
export function uploadPremult(gpu: GPU, s: Surface, data: Uint8Array): void {
  const gl = gpu.gl
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, s.tex)
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, s.w, s.h, gl.RGBA, gl.UNSIGNED_BYTE, data)
  s.rev++
}

// ------------------------------------------------------------------ GPU -> CPU, several tiles per readback
/** zero-delay macrotask (setTimeout(0) is clamped to 1-4 ms, which dominated the polling loops) */
export const nextTask = (): Promise<void> =>
  new Promise((r) => {
    const c = new MessageChannel()
    c.port1.onmessage = (): void => {
      c.port1.close()
      r()
    }
    c.port2.postMessage(0)
  })

/** profiling counters of the readback path (ms summed over batches) */
export const ioStats = { issueMs: 0, fenceMs: 0, copyMs: 0, encodeMs: 0, encodes: 0 }

export const BATCH_TILES = 8
const stages = new WeakMap<GPU, Surface>()

export function releaseTileStage(gpu: GPU): void {
  stages.get(gpu)?.dispose()
  stages.delete(gpu)
}

/**
 * Read up to BATCH_TILES RGBA8 tile surfaces back as raw PREMULTIPLIED bytes (the codec Workers convert to straight alpha), ONE readback for the batch.
 * The GPU part is issued synchronously, so several batches can be in flight at once (pipelined fences). Resolves with one fresh ArrayBuffer (512*512*4) per input surface.
 */
export interface ReadItem {
  surf: Surface
  /** checked right before the GPU pass: false = the surface was disposed / replaced meanwhile (result null) */
  alive: () => boolean
}
export interface ReadResult {
  buf: ArrayBuffer
  /** surf.rev at the time of the pass */
  rev: number
}
export function readTilesBatch(gpu: GPU, items: ReadItem[]): Promise<(ReadResult | null)[]> {
  // readNow issues its GPU work synchronously (before the first await), so batches never interleave on the shared atlas; their fences overlap
  return readNow(gpu, items)
}

async function readNow(gpu: GPU, items: ReadItem[]): Promise<(ReadResult | null)[]> {
  if (!items.length) return []
  if (items.length > BATCH_TILES) throw new RangeError('batch too large')
  const tIssue = performance.now()
  const live = items.map((it) => it.alive())
  const surfs = items.map((it) => it.surf)
  const revs = surfs.map((s) => s.rev)
  const gl = gpu.gl
  const S = TILE_PX
  // allocate BEFORE binding any texture (a new texture rebinds the active unit)
  let stage = stages.get(gpu)
  if (!stage) stages.set(gpu, (stage = gpu.surface(S, S * BATCH_TILES, 'rgba8', 0)))
  const buf = gl.createBuffer()!
  surfs.forEach((s, i) => {
    if (live[i]) gpu.blit(s, { x: 0, y: 0, w: S, h: S }, stage!, 0, i * S) // raw premultiplied copy; the Worker converts to straight alpha exactly
  })
  const bytes = surfs.length * S * S * 4
  gl.bindFramebuffer(gl.FRAMEBUFFER, stage.fbo)
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buf)
  gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes, gl.STREAM_READ)
  gl.readPixels(0, 0, S, surfs.length * S, gl.RGBA, gl.UNSIGNED_BYTE, 0)
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!
  gl.flush()
  ioStats.issueMs += performance.now() - tIssue
  try {
    const t0 = performance.now()
    for (;;) {
      const r = gl.clientWaitSync(sync, 0, 0)
      if (r === gl.ALREADY_SIGNALED || r === gl.CONDITION_SATISFIED) break
      if (r === gl.WAIT_FAILED) throw new Error('GPU readback failed')
      if (performance.now() - t0 > 20000) throw new Error('GPU readback timed out')
      await nextTask()
    }
    ioStats.fenceMs += performance.now() - t0
    const tc = performance.now()
    const out: (ReadResult | null)[] = []
    // every 1 MB getBufferSubData is a synchronous GPU-process round trip (3-12 ms; one 8 MB call blocks for ~300 ms, 256 KB slices + timers are 10x slower
    // overall): hand the thread back after EVERY copy that pushed the task past ~4 ms, so a frame is lost at most once per task, never in bursts
    let sliceAt = performance.now()
    for (let i = 0; i < surfs.length; i++) {
      if (!live[i]) {
        out.push(null)
        continue
      }
      const a = new Uint8Array(S * S * 4)
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buf) // re-bound every time: other code runs while we yield between tiles
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, i * S * S * 4, a)
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
      out.push({ buf: a.buffer, rev: revs[i] })
      if (i < surfs.length - 1 && performance.now() - sliceAt > 4) {
        await nextTask()
        sliceAt = performance.now()
      }
    }
    ioStats.copyMs += performance.now() - tc
    return out
  } finally {
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    gl.deleteBuffer(buf)
    gl.deleteSync(sync)
  }
}

// ------------------------------------------------------------------ scratch files
interface ScratchApi {
  put(doc: string, name: string, data: Uint8Array): Promise<boolean>
  get(doc: string, name: string): Promise<Uint8Array | null>
  getSync(doc: string, name: string): Uint8Array | null
  remove(doc: string, name: string): Promise<boolean>
  drop(doc: string): Promise<boolean>
}
const mem = new Map<string, Uint8Array>()
const memApi: ScratchApi = {
  put: async (d, n, b) => (mem.set(d + '/' + n, b), true),
  get: async (d, n) => mem.get(d + '/' + n) ?? null,
  getSync: (d, n) => mem.get(d + '/' + n) ?? null,
  remove: async (d, n) => mem.delete(d + '/' + n),
  drop: async (d) => {
    for (const k of [...mem.keys()]) if (k.startsWith(d + '/')) mem.delete(k)
    return true
  }
}
export const scratch = (): ScratchApi => (globalThis as unknown as { bwScratch?: ScratchApi }).bwScratch ?? memApi
