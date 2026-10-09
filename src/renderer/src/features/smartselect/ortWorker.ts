/// <reference lib="webworker" />
/**
 * ONNX Runtime Web worker for Smart selection. Loads a SAM-class encoder / decoder pair, runs the (heavy) image encoder once
 * per region (WebGPU when available, WASM otherwise) and the (light) prompt decoder per click on the WASM EP.
 * Never touches the DOM; the UI thread stays free. Protocol: see `WorkerIn` / `WorkerOut`.
 */
import * as ort from 'onnxruntime-web'
import { resizeRGBA } from './imgops'
import { encodeGeom, FRAME, LOWRES, sam1Pixels, sam2Pixels, flattenOnGrey, type ModelFamily } from './region'

export type EpChoice = 'auto' | 'webgpu' | 'wasm'
/** how the pair is placed: gpu = encoder + decoder on WebGPU with GPU-resident embeddings; gpuenc = encoder on WebGPU, decoder on WASM; gpumid = both WebGPU, embeddings copied to the CPU between */
export type Placement = 'gpu' | 'gpumid' | 'gpuenc'

export interface InitMsg {
  t: 'init'
  family: ModelFamily
  encoder: string
  decoder: string
  files: Record<string, ArrayBuffer>
  /** base URL of the folder holding ort-wasm-simd-threaded.jsep.{mjs,wasm} */
  wasmBase: string
  ep: EpChoice
  threads: number
  place?: Placement
}
export interface EncodeMsg {
  t: 'encode'
  id: number
  rgba: ArrayBuffer
  w: number
  h: number
}
export interface DecodeMsg {
  t: 'decode'
  id: number
  coords: Float32Array
  labels: Float32Array
  box: Float32Array | null
  count: number
}
export type WorkerIn = InitMsg | EncodeMsg | DecodeMsg | { t: 'dispose' }
export type WorkerOut =
  | { t: 'ready'; ep: string; decEp: string; loadMs: number; threads: number; isolated: boolean }
  | { t: 'encoded'; id: number; ms: number; ep: string }
  | { t: 'decoded'; id: number; ms: number; logits: Float32Array; iou: Float32Array; n: number }
  | { t: 'error'; id?: number; message: string }

const ctx = self as unknown as DedicatedWorkerGlobalScope
const post = (m: WorkerOut, tr: Transferable[] = []): void => ctx.postMessage(m, tr)

let family: ModelFamily = 'sam1'
let lastInit: InitMsg | null = null
let decEpName = 'wasm'
let encSession: ort.InferenceSession | null = null
let decSession: ort.InferenceSession | null = null
let encEp = 'wasm'
let emb: Record<string, ort.Tensor> | null = null
let embDims = { rw: 0, rh: 0 }

async function createSession(bytes: ArrayBuffer, extra: { path: string; data: ArrayBuffer }[], eps: string[], gpuOut = false): Promise<{ s: ort.InferenceSession; ep: string }> {
  let lastErr: unknown = null
  for (const ep of eps) {
    try {
      const s = await ort.InferenceSession.create(new Uint8Array(bytes), {
        executionProviders: [ep],
        graphOptimizationLevel: 'all',
        // the CPU arena only ever grows (a SAM encoder pass peaks at several hundred MB of wasm heap, and the heap itself can never shrink):
        // plain allocations are returned to the allocator after every run, which keeps the worker's footprint at the model + one pass
        enableCpuMemArena: false,
        enableMemPattern: false,
        logSeverityLevel: 3, // keep the console clean (the shape-op CPU assignment warning is expected)
        // keep the embeddings on the GPU when the decoder runs there too (no 16 MB read-back / upload per image)
        ...(gpuOut && ep === 'webgpu' ? { preferredOutputLocation: 'gpu-buffer' as const } : {}),
        externalData: extra.map((e) => ({ path: e.path, data: new Uint8Array(e.data) }))
      })
      return { s, ep }
    } catch (e) {
      lastErr = e
      console.warn('[smartselect] EP', ep, 'failed:', e)
    }
  }
  throw lastErr ?? new Error('no execution provider')
}

async function init(m: InitMsg): Promise<void> {
  const t0 = performance.now()
  lastInit = m
  family = m.family
  const base = m.wasmBase.endsWith('/') ? m.wasmBase : m.wasmBase + '/'
  ort.env.wasm.wasmPaths = { mjs: base + 'ort-wasm-simd-threaded.jsep.mjs', wasm: base + 'ort-wasm-simd-threaded.jsep.wasm' }
  const isolated = (self as any).crossOriginIsolated === true
  const canThreads = typeof SharedArrayBuffer !== 'undefined'
  ort.env.wasm.numThreads = canThreads ? Math.max(1, m.threads) : 1
  ort.env.wasm.proxy = false
  ort.env.logLevel = 'error'
  const hasGpu = 'gpu' in navigator && m.ep !== 'wasm'
  const eps = m.ep === 'wasm' || !hasGpu ? ['wasm'] : m.ep === 'webgpu' ? ['webgpu'] : ['webgpu', 'wasm']
  const extraFor = (name: string): { path: string; data: ArrayBuffer }[] =>
    Object.entries(m.files)
      .filter(([k]) => k !== m.encoder && k !== m.decoder && k.startsWith(name.replace(/\.onnx$/, '.onnx_data')))
      .map(([k, v]) => ({ path: k, data: v }))
  let enc: { s: ort.InferenceSession; ep: string } | null = null
  let dec: { s: ort.InferenceSession; ep: string } | null = null
  const place: Placement = m.place ?? (family === 'sam1' ? 'gpu' : 'gpuenc') // the SAM 2 decoder returns garbage on the WebGPU EP (checked), so it runs on the CPU
  if (eps[0] === 'webgpu' && place !== 'gpuenc') {
    try {
      enc = await createSession(m.files[m.encoder], extraFor(m.encoder), ['webgpu'], place === 'gpu')
      dec = await createSession(m.files[m.decoder], extraFor(m.decoder), ['webgpu'])
    } catch (e) {
      console.warn('[smartselect] GPU decoder unavailable, decoding on the CPU:', e)
      await enc?.s.release()
      enc = dec = null
    }
  }
  if (!enc || !dec) {
    enc = await createSession(m.files[m.encoder], extraFor(m.encoder), eps)
    dec = await createSession(m.files[m.decoder], extraFor(m.decoder), ['wasm'])
  }
  encSession = enc.s
  decSession = dec.s
  encEp = enc.ep
  decEpName = dec.ep
  post({ t: 'ready', ep: enc.ep, decEp: dec.ep, loadMs: performance.now() - t0, threads: ort.env.wasm.numThreads ?? 1, isolated })
}

async function encode(m: EncodeMsg): Promise<void> {
  if (!encSession) throw new Error('encoder not loaded')
  const t0 = performance.now()
  const rgba = new Uint8ClampedArray(m.rgba)
  flattenOnGrey(rgba)
  const g = encodeGeom({ x: 0, y: 0, w: m.w, h: m.h }, family)
  const small = resizeRGBA(rgba, m.w, m.h, g.rw, g.rh)
  let feeds: Record<string, ort.Tensor>
  if (family === 'sam1') feeds = { input_image: new ort.Tensor('float32', sam1Pixels(small, g.rw, g.rh), [g.rh, g.rw, 3]) }
  else feeds = { pixel_values: new ort.Tensor('float32', sam2Pixels(small), [1, 3, FRAME, FRAME]) }
  disposeEmb()
  const out = await encSession.run(feeds)
  emb = out as unknown as Record<string, ort.Tensor>
  embDims = { rw: g.rw, rh: g.rh }
  // a throw-away decode forces the (asynchronous) GPU work to finish, so the reported time is honest, and compiles the decoder
  const warm = await runDecode(new Float32Array(family === 'sam1' ? [g.rw / 2, g.rh / 2, 0, 0] : [FRAME / 2, FRAME / 2]), new Float32Array(family === 'sam1' ? [1, -1] : [1]), null, family === 'sam1' ? 2 : 1)
  if (decEpName === 'webgpu' && !plausible(warm.logits, warm.iou) && lastInit && !retried) {
    // some GPU / driver combinations compute garbage in the decoder: move it (and the embeddings) to the CPU and encode again
    retried = true
    console.warn('[smartselect] GPU decoder output is degenerate, falling back to the CPU decoder')
    await disposeAll()
    await init({ ...lastInit, place: 'gpuenc' })
    return encode(m)
  }
  post({ t: 'encoded', id: m.id, ms: performance.now() - t0, ep: encEp })
}

let retried = false
/** a usable decoder answer varies over the mask and has finite scores */
function plausible(logits: Float32Array, iou: Float32Array): boolean {
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < logits.length; i += 7) {
    const v = logits[i]
    if (!Number.isFinite(v)) return false
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  let best = 0
  for (const v of iou) best = Math.max(best, Number.isFinite(v) ? v : 0)
  return hi - lo > 0.5 && best > 0.02
}

async function disposeAll(): Promise<void> {
  disposeEmb()
  await encSession?.release()
  await decSession?.release()
  encSession = decSession = null
}

function disposeEmb(): void {
  if (emb) for (const k of Object.keys(emb)) emb[k].dispose?.()
  emb = null
}

async function runDecode(coords: Float32Array, labels: Float32Array, box: Float32Array | null, count: number): Promise<{ logits: Float32Array; iou: Float32Array; n: number }> {
  if (!decSession || !emb) throw new Error('nothing encoded')
  if (family === 'sam1') {
    const out = await decSession.run(
      {
        image_embeddings: emb['image_embeddings'],
        point_coords: new ort.Tensor('float32', coords, [1, count, 2]),
        point_labels: new ort.Tensor('float32', labels, [1, count]),
        mask_input: new ort.Tensor('float32', new Float32Array(LOWRES * LOWRES), [1, 1, LOWRES, LOWRES]),
        has_mask_input: new ort.Tensor('float32', new Float32Array([0]), [1]),
        orig_im_size: new ort.Tensor('float32', new Float32Array([embDims.rh, embDims.rw]), [2])
      },
      ['low_res_masks', 'iou_predictions'] // the full-size 'masks' output (1024^2 interpolation) is never needed
    )
    const lr = out['low_res_masks']
    return { logits: (lr.data as Float32Array).slice(), iou: (out['iou_predictions'].data as Float32Array).slice(), n: lr.dims[1] }
  }
  const labelsI = BigInt64Array.from(Array.from(labels, (v) => BigInt(Math.round(v))))
  const out = await decSession.run(
    {
      input_points: new ort.Tensor('float32', coords, [1, 1, count, 2]),
      input_labels: new ort.Tensor('int64', labelsI, [1, 1, count]),
      input_boxes: new ort.Tensor('float32', box ?? new Float32Array(0), [1, box ? 1 : 0, 4]),
      'image_embeddings.0': emb['image_embeddings.0'],
      'image_embeddings.1': emb['image_embeddings.1'],
      'image_embeddings.2': emb['image_embeddings.2']
    },
    ['pred_masks', 'iou_scores']
  )
  const pm = out['pred_masks']
  return { logits: (pm.data as Float32Array).slice(), iou: (out['iou_scores'].data as Float32Array).slice(), n: pm.dims[2] }
}

async function decode(m: DecodeMsg): Promise<void> {
  const t0 = performance.now()
  const r = await runDecode(m.coords, m.labels, m.box, m.count)
  post({ t: 'decoded', id: m.id, ms: performance.now() - t0, logits: r.logits, iou: r.iou, n: r.n })
}

ctx.onmessage = (ev: MessageEvent<WorkerIn>) => {
  const m = ev.data
  const id = (m as { id?: number }).id
  const run = async (): Promise<void> => {
    if (m.t === 'init') await init(m)
    else if (m.t === 'encode') await encode(m)
    else if (m.t === 'decode') await decode(m)
    else if (m.t === 'dispose') await disposeAll()
  }
  run().catch((e) => post({ t: 'error', id, message: String((e as Error)?.message ?? e) }))
}
