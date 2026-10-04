import { FS_VERT, GPU, Surface } from '../gl/gpu'

/**
 * Building blocks of the non-blocking .bwk save (used by io/bwk.ts):
 *   GPU  : layer -> straight-alpha RGBA8 staging surface (one shader pass) -> pixel-pack buffers -> fence
 *   CPU  : row bands are read one small chunk per task (never a whole 33 MB layer in one go) and streamed to Workers
 *   Pool : PNG encoders + an archive worker that caches every layer's PNG (only changed layers are re-encoded)
 */

export class SaveAborted extends Error {
  constructor(readonly reason: string) {
    super('save aborted: ' + reason)
    this.name = 'SaveAborted'
  }
}

/** Set by the app: true while the artist is drawing (autosave yields / aborts then). */
export const saveHooks = { busy: (): boolean => false }

/** Counters for tests / profiling. */
export const saveStats = { encoded: 0, cached: 0, saves: 0, lastMs: 0, maxSliceMs: 0 }

export const yieldTask = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

// ------------------------------------------------------------------ worker pool
type Msg = { t: 'png'; id: number; png: ArrayBuffer } | { t: 'zip'; id: number; zip: ArrayBuffer } | { t: 'err'; id: number; error: string }
interface Waiter {
  ok: (b: ArrayBuffer) => void
  err: (e: Error) => void
  w: Worker
}

class Pool {
  /** bumped whenever the workers are recreated: cached "archive has it" knowledge is then invalid */
  gen = 0
  private enc: Worker[] = []
  private archive: Worker | null = null
  private waiting = new Map<number, Waiter>()
  private seq = 0
  private rr = 0

  private spawn(): Worker {
    const w = new Worker(new URL('./saveWorker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<Msg>): void => {
      const m = e.data
      const wt = this.waiting.get(m.id)
      if (!wt) return
      this.waiting.delete(m.id)
      if (m.t === 'err') wt.err(new Error(m.error))
      else wt.ok(m.t === 'png' ? m.png : m.zip)
    }
    w.onerror = (e): void => this.reset(new Error('save worker error: ' + e.message))
    w.onmessageerror = (): void => this.reset(new Error('save worker message error'))
    return w
  }

  private ensure(): void {
    if (this.archive) return
    const n = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 2))
    this.archive = this.spawn()
    for (let i = 0; i < n; i++) this.enc.push(this.spawn())
  }

  /** Terminate everything and reject every pending job (never leaves a promise unresolved). */
  reset(err: Error): void {
    for (const w of [...this.enc, ...(this.archive ? [this.archive] : [])]) w.terminate()
    this.enc = []
    this.archive = null
    this.gen++
    const list = [...this.waiting.values()]
    this.waiting.clear()
    for (const w of list) w.err(err)
  }

  get width(): number {
    this.ensure()
    return this.enc.length
  }

  /** Start a streaming PNG job on the next encoder worker. */
  png(w: number, h: number): { rows(buf: ArrayBuffer): void; end(): Promise<ArrayBuffer>; cancel(): void } {
    this.ensure()
    const worker = this.enc[this.rr++ % this.enc.length]
    const id = ++this.seq
    worker.postMessage({ t: 'begin', id, w, h })
    return {
      rows: (buf) => worker.postMessage({ t: 'rows', id, buf }, [buf]),
      end: () =>
        new Promise<ArrayBuffer>((ok, err) => {
          this.waiting.set(id, { ok, err, w: worker })
          worker.postMessage({ t: 'end', id })
        }),
      cancel: () => worker.postMessage({ t: 'cancel', id })
    }
  }

  /** Hand an encoded PNG to the archive (transfers the buffer). */
  store(doc: string, key: string, png: ArrayBuffer): void {
    this.ensure()
    this.archive!.postMessage({ t: 'store', doc, key, png }, [png])
  }

  zip(doc: string, entries: { name: string; keys: string[] }[], files: Record<string, Uint8Array>, keep: string[]): Promise<ArrayBuffer> {
    this.ensure()
    const id = ++this.seq
    return new Promise((ok, err) => {
      this.waiting.set(id, { ok, err, w: this.archive! })
      this.archive!.postMessage({ t: 'zip', id, doc, entries, files, keep })
    })
  }
}
export const pool = new Pool()

// ------------------------------------------------------------------ revision cache
interface CacheEntry {
  rev: number
  gen: number
}
const cache = new WeakMap<Surface, CacheEntry>()
const docKeys = new WeakMap<object, string>()
let docKeySeq = 0
export const docKeyOf = (doc: object): string => {
  let k = docKeys.get(doc)
  if (!k) docKeys.set(doc, (k = 'd' + ++docKeySeq))
  return k
}
export const surfaceKey = (s: Surface): string => String(s.uid)

/** Opaque byte blobs kept in the archive worker between saves (extensions cache big append-only data there). */
const blobGen = new Map<string, number>()
export class BlobStore {
  constructor(private doc: string) {}
  has(key: string): boolean {
    return blobGen.get(this.doc + '|' + key) === pool.gen
  }
  /** Hand `bytes` to the archive (ownership transfers: pass a buffer you no longer need). */
  put(key: string, bytes: Uint8Array): void {
    const buf = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? (bytes.buffer as ArrayBuffer) : (bytes.slice().buffer as ArrayBuffer)
    pool.store(this.doc, key, buf)
    blobGen.set(this.doc + '|' + key, pool.gen)
  }
}
export function isCached(s: Surface): boolean {
  const c = cache.get(s)
  return !!c && c.rev === s.rev && c.gen === pool.gen
}
export function markCached(s: Surface, rev: number, gen: number): void {
  cache.set(s, { rev, gen })
}

// ------------------------------------------------------------------ GPU -> bands
const STRAIGHT_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
out vec4 o;
void main(){
  vec4 c = texelFetch(uTex, ivec2(gl_FragCoord.xy), 0);
  float a = c.a;
  o = vec4(a > 0.0 ? clamp(c.rgb / a, 0.0, 1.0) : vec3(0.0), a);
}`

// box-filter downscale (+ paper) used for the gallery thumbnail
const THUMB_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec2 uSrc; uniform vec2 uDst; uniform vec4 uPaper;
out vec4 o;
void main(){
  vec2 d = floor(gl_FragCoord.xy);
  vec2 s0 = d * uSrc / uDst;
  vec2 s1 = (d + 1.0) * uSrc / uDst;
  ivec2 a = ivec2(floor(s0));
  ivec2 b = ivec2(min(ceil(s1), uSrc));
  vec4 acc = vec4(0.0); float n = 0.0;
  for (int y = a.y; y < b.y; y++) for (int x = a.x; x < b.x; x++) { acc += texelFetch(uTex, ivec2(x, y), 0); n += 1.0; }
  vec4 c = acc / max(n, 1.0);
  if (uPaper.a > 0.5) o = vec4(c.rgb + uPaper.rgb * (1.0 - c.a), 1.0);
  else o = vec4(c.a > 0.0 ? clamp(c.rgb / c.a, 0.0, 1.0) : vec3(0.0), c.a);
}`

const stages = new WeakMap<GPU, Surface>()
function stageFor(gpu: GPU, w: number, h: number): Surface {
  let s = stages.get(gpu)
  if (!s || s.w !== w || s.h !== h) {
    s?.dispose()
    stages.set(gpu, (s = gpu.surface(w, h, 'rgba8', 0)))
  }
  return s
}
/** Free the staging surface (call when idle / doc closed). */
export function releaseStage(gpu: GPU): void {
  stages.get(gpu)?.dispose()
  stages.delete(gpu)
}

/** Render `src` as straight-alpha RGBA8 into the staging surface of the same size. */
function toStraightStage(gpu: GPU, src: Surface, rect: { x: number; y: number; w: number; h: number } | null = null): Surface {
  const gl = gpu.gl
  const stage = stageFor(gpu, src.w, src.h)
  const p = gpu.program('save-straight', FS_VERT, STRAIGHT_FS).use()
  gpu.bindTex(0, src.tex)
  p.i('uTex', 0)
  gpu.bindTarget(stage, rect)
  gl.disable(gl.BLEND)
  gpu.fullscreen()
  gl.disable(gl.SCISSOR_TEST)
  return stage
}

const BAND_BYTES = 1 << 21

async function waitFence(gl: WebGL2RenderingContext, sync: WebGLSync, check: () => void): Promise<void> {
  const t0 = performance.now()
  for (;;) {
    const r = gl.clientWaitSync(sync, 0, 0)
    if (r === gl.ALREADY_SIGNALED || r === gl.CONDITION_SATISFIED) return
    if (r === gl.WAIT_FAILED) throw new Error('GPU readback failed')
    if (performance.now() - t0 > 20000) throw new Error('GPU readback timed out')
    check()
    await new Promise((res) => setTimeout(res, 2))
  }
}

/**
 * Read `stage` (RGBA8, w x h) in row bands through pixel-pack buffers. `onBand` receives each band's bytes
 * (a fresh ArrayBuffer, ownership passes to the callee). Main-thread slices are ~1-3 ms; between them the loop yields.
 */
async function readBands(gpu: GPU, stage: Surface, onBand: (b: ArrayBuffer) => void, check: () => void): Promise<void> {
  const gl = gpu.gl
  const w = stage.w
  const h = stage.h
  const rowsPer = Math.max(1, Math.floor(BAND_BYTES / (w * 4)))
  const bands: { buf: WebGLBuffer; rows: number }[] = []
  let sync: WebGLSync | null = null
  try {
    gl.bindFramebuffer(gl.FRAMEBUFFER, stage.fbo)
    for (let y0 = 0; y0 < h; y0 += rowsPer) {
      const rows = Math.min(rowsPer, h - y0)
      const buf = gl.createBuffer()!
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buf)
      gl.bufferData(gl.PIXEL_PACK_BUFFER, w * rows * 4, gl.STREAM_READ)
      gl.readPixels(0, y0, w, rows, gl.RGBA, gl.UNSIGNED_BYTE, 0)
      bands.push({ buf, rows })
    }
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!
    gl.flush()
    await waitFence(gl, sync, check)
    while (bands.length) {
      check()
      const b = bands.shift()!
      const t0 = performance.now()
      const out = new Uint8Array(w * b.rows * 4)
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, b.buf)
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out)
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
      gl.deleteBuffer(b.buf)
      onBand(out.buffer)
      saveStats.maxSliceMs = Math.max(saveStats.maxSliceMs, performance.now() - t0)
      await yieldTask()
    }
  } finally {
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    for (const b of bands) gl.deleteBuffer(b.buf)
    if (sync) gl.deleteSync(sync)
  }
}

/**
 * Encode one surface as PNG through the worker pool. Resolves with the PNG bytes once encoded (the caller decides what
 * to do with them). The GPU readback part is complete when this function's returned `read` promise resolves, so the
 * caller can start the next surface while the workers still compress.
 */
export async function encodeSurface(gpu: GPU, src: Surface, check: () => void): Promise<{ rev: number; gen: number; png: Promise<ArrayBuffer> }> {
  const rev = src.rev
  const gen = pool.gen
  const stage = toStraightStage(gpu, src)
  const job = pool.png(src.w, src.h)
  try {
    await readBands(gpu, stage, (b) => job.rows(b), check)
  } catch (e) {
    job.cancel()
    throw e
  }
  saveStats.encoded++
  return { rev, gen, png: job.end() }
}

/** Downscaled, paper-flattened preview of `composite` as PNG bytes (max side `max`). */
export async function encodeThumbnail(gpu: GPU, composite: Surface, paper: [number, number, number] | null, check: () => void, max = 256): Promise<Uint8Array> {
  const k = Math.min(1, max / Math.max(composite.w, composite.h))
  const tw = Math.max(1, Math.round(composite.w * k))
  const th = Math.max(1, Math.round(composite.h * k))
  const small = gpu.surface(tw, th, 'rgba8', 0)
  try {
    const gl = gpu.gl
    const p = gpu.program('save-thumb', FS_VERT, THUMB_FS).use()
    gpu.bindTex(0, composite.tex)
    p.i('uTex', 0).v2('uSrc', composite.w, composite.h).v2('uDst', tw, th).v4('uPaper', paper ? paper[0] : 0, paper ? paper[1] : 0, paper ? paper[2] : 0, paper ? 1 : 0)
    gpu.bindTarget(small, null)
    gl.disable(gl.BLEND)
    gpu.fullscreen()
    const job = pool.png(tw, th)
    try {
      await readBands(gpu, small, (b) => job.rows(b), check)
    } catch (e) {
      job.cancel()
      throw e
    }
    return new Uint8Array(await job.end())
  } finally {
    small.dispose()
  }
}

/** Read a rect of a surface as straight RGBA8 PNG (crash-journal patches). */
export async function encodeRect(gpu: GPU, src: Surface, x: number, y: number, w: number, h: number, check: () => void): Promise<Uint8Array> {
  const stage = toStraightStage(gpu, src, { x, y, w, h })
  // crop on the GPU side by reading only the needed rows/cols: copy the rect into a small surface first
  const small = gpu.surface(w, h, 'rgba8', 0)
  try {
    gpu.blit(stage, { x, y, w, h }, small, 0, 0)
    const job = pool.png(w, h)
    try {
      await readBands(gpu, small, (b) => job.rows(b), check)
    } catch (e) {
      job.cancel()
      throw e
    }
    return new Uint8Array(await job.end())
  } finally {
    small.dispose()
  }
}
