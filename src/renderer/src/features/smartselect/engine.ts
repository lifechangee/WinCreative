/**
 * Smart selection engine (UI-thread side): owns the ONNX worker and the CPU compute worker, loads models lazily from the
 * main process, caches the image embedding, coalesces decode requests and releases everything after an idle period.
 */
import { Emitter } from '../../core/events'
import type { BrushStroke, BrushOpts } from './brushSeg'
import { modelFiles, MODELS, type ModelId } from './manifest'
import type { ComputeIn, ComputeOut } from './computeWorker'
import type { EpChoice, Placement, WorkerIn, WorkerOut } from './ortWorker'
import type { RefineOpts } from './refine'
import type { EncodeGeom, EncodedPrompt } from './region'

declare global {
  interface Window {
    smartselectApi?: {
      status(): Promise<{ id: string; bundled: boolean; installed: boolean; bytes: number; diskBytes: number }[]>
      read(id: string, name: string): Promise<Uint8Array>
      download(id: string): Promise<{ ok: boolean; error?: string }>
      cancel(id: string): Promise<void>
      remove(id: string): Promise<boolean>
      onProgress(cb: (p: { id: string; state: string; done: number; total: number; file?: string; error?: string }) => void): () => void
      testMode(): Promise<boolean>
      testLog(s: string): Promise<void>
      testDone(ok: boolean): Promise<void>
    }
  }
}

export type EngineState = 'unloaded' | 'loading' | 'ready' | 'encoding' | 'error'

export interface EngineStats {
  model: ModelId | null
  ep: string
  decEp: string
  threads: number
  isolated: boolean
  loadMs: number
  lastEncodeMs: number
  lastDecodeMs: number
  encodes: number
  decodes: number
}

export interface DecodeResult {
  /** n candidate masks of 256*256 logits, concatenated */
  logits: Float32Array
  iou: Float32Array
  n: number
  ms: number
}

const wasmBase = (): string => new URL('ort/', document.baseURI).href

export class SmartEngine {
  readonly events = new Emitter<{ state: EngineState; stats: EngineStats }>()
  state: EngineState = 'unloaded'
  stats: EngineStats = { model: null, ep: '', decEp: '', threads: 0, isolated: false, loadMs: 0, lastEncodeMs: 0, lastDecodeMs: 0, encodes: 0, decodes: 0 }
  /** idle minutes before the model is released (0 = never) */
  private idleMin = 5
  get idleMinutes(): number {
    return this.idleMin
  }
  set idleMinutes(v: number) {
    this.idleMin = v
    this.touch()
  }
  /** execution provider preference */
  ep: EpChoice = 'auto'
  /** encoder/decoder placement on the GPU (diagnostics; picked per model) */
  place: Placement | null = null
  private ort: Worker | null = null
  private cw: Worker | null = null
  private loading: Promise<void> | null = null
  private model: ModelId | null = null
  private idleTimer = 0
  private seq = 1
  private waiting = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>()
  private readyResolve: ((v: WorkerOut & { t: 'ready' }) => void) | null = null
  private readyReject: ((e: Error) => void) | null = null
  private pendingDecode: { id: number; msg: WorkerIn; drop: () => void } | null = null
  private decodeBusy = false
  /** key of the embedding currently held by the worker */
  encodedKey: string | null = null
  encodedGeom: EncodeGeom | null = null

  private setState(s: EngineState): void {
    if (this.state === s) return
    this.state = s
    this.events.emit('state', s)
  }

  get loadedModel(): ModelId | null {
    return this.ort ? this.model : null
  }

  private touch(): void {
    window.clearTimeout(this.idleTimer)
    if (this.idleMin > 0 && (this.ort || this.cw)) this.idleTimer = window.setTimeout(() => this.release(), this.idleMin * 60000)
  }

  // ---------------------------------------------------------------- ONNX worker
  async ensure(model: ModelId): Promise<void> {
    this.touch()
    if (this.ort && this.model === model && this.state !== 'error') return this.loading ?? undefined
    if (this.ort && this.model !== model) this.release(false)
    if (this.loading) return this.loading
    this.model = model
    this.setState('loading')
    this.loading = this.load(model).then(
      () => {
        this.loading = null
        this.setState('ready')
        this.touch()
      },
      (e) => {
        this.loading = null
        this.releaseOrt()
        this.setState('error')
        throw e
      }
    )
    return this.loading
  }

  private async load(model: ModelId): Promise<void> {
    const api = window.smartselectApi
    if (!api) throw new Error('model API unavailable')
    const def = MODELS[model]
    const files: Record<string, ArrayBuffer> = {}
    for (const f of modelFiles(def)) {
      const u8 = await api.read(model, f.name)
      files[f.name] = u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength ? (u8.buffer as ArrayBuffer) : (u8.slice().buffer as ArrayBuffer)
    }
    const w = new Worker(new URL('./ortWorker.ts', import.meta.url), { type: 'module' })
    this.ort = w
    w.onmessage = (ev: MessageEvent<WorkerOut>) => this.onOrt(ev.data)
    w.onerror = (e) => this.failAll(new Error(e.message || 'worker error'))
    const ready = new Promise<WorkerOut & { t: 'ready' }>((res, rej) => {
      this.readyResolve = res
      this.readyReject = rej
    })
    const threads = Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 4) / 2)))
    const msg: WorkerIn = { t: 'init', family: def.family, encoder: def.encoder.name, decoder: def.decoder.name, files, wasmBase: wasmBase(), ep: this.ep, threads, place: this.place ?? undefined }
    w.postMessage(msg, Object.values(files))
    const r = await ready
    this.stats = { ...this.stats, model, ep: r.ep, decEp: r.decEp, threads: r.threads, isolated: r.isolated, loadMs: r.loadMs }
    this.events.emit('stats', this.stats)
  }

  private onOrt(m: WorkerOut): void {
    if (m.t === 'ready') {
      if (!this.readyResolve) {
        this.stats = { ...this.stats, ep: m.ep, decEp: m.decEp } // the worker re-placed the models (GPU decoder fallback)
        this.events.emit('stats', this.stats)
      }
      this.readyResolve?.(m)
      this.readyResolve = this.readyReject = null
    } else if (m.t === 'error') {
      if (m.id === undefined) {
        this.readyReject?.(new Error(m.message))
        this.readyResolve = this.readyReject = null
      } else {
        const w = this.waiting.get(m.id)
        this.waiting.delete(m.id)
        w?.rej(new Error(m.message))
      }
    } else {
      const w = this.waiting.get(m.id)
      this.waiting.delete(m.id)
      w?.res(m)
    }
  }

  private failAll(e: Error): void {
    for (const w of this.waiting.values()) w.rej(e)
    this.waiting.clear()
    this.readyReject?.(e)
    this.readyResolve = this.readyReject = null
  }

  private rpc<T>(msg: WorkerIn & { id: number }, transfer: Transferable[] = []): Promise<T> {
    return new Promise<T>((res, rej) => {
      if (!this.ort) return rej(new Error('engine not loaded'))
      this.waiting.set(msg.id, { res, rej })
      this.ort.postMessage(msg, transfer)
    })
  }

  /** Encode an RGBA region (straight alpha). Resolves with the encoder time. Cancel with `cancel()`. */
  async encode(key: string, geom: EncodeGeom, rgba: Uint8ClampedArray): Promise<number> {
    if (!this.ort || !this.model) throw new Error('engine not loaded')
    this.touch()
    this.setState('encoding')
    this.encodedKey = null
    const id = this.seq++
    try {
      const buf = rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + rgba.byteLength) as ArrayBuffer
      const r = await this.rpc<{ ms: number; ep: string }>({ t: 'encode', id, rgba: buf, w: geom.region.w, h: geom.region.h }, [buf])
      this.encodedKey = key
      this.encodedGeom = geom
      this.stats = { ...this.stats, lastEncodeMs: r.ms, encodes: this.stats.encodes + 1 }
      this.events.emit('stats', this.stats)
      return r.ms
    } finally {
      if (this.ort) this.setState('ready')
      this.touch()
    }
  }

  /** Decode a prompt. A newer request replaces a queued one (the dropped one resolves null). */
  decode(p: EncodedPrompt): Promise<DecodeResult | null> {
    this.touch()
    const id = this.seq++
    const msg: WorkerIn = { t: 'decode', id, coords: p.coords, labels: p.labels, box: p.box, count: p.count }
    return new Promise<DecodeResult | null>((res, rej) => {
      if (!this.ort) return rej(new Error('engine not loaded'))
      if (this.pendingDecode) {
        this.waiting.delete(this.pendingDecode.id)
        this.pendingDecode.drop()
      }
      this.waiting.set(id, {
        res: (m: { ms: number; logits: Float32Array; iou: Float32Array; n: number }) => {
          this.stats = { ...this.stats, lastDecodeMs: m.ms, decodes: this.stats.decodes + 1 }
          this.decodeBusy = false
          res({ logits: m.logits, iou: m.iou, n: m.n, ms: m.ms })
          this.pump()
        },
        rej: (e) => {
          this.decodeBusy = false
          rej(e)
          this.pump()
        }
      })
      this.pendingDecode = { id, msg, drop: () => res(null) }
      this.pump()
    })
  }

  private pump(): void {
    if (this.decodeBusy || !this.pendingDecode || !this.ort) return
    const { msg } = this.pendingDecode
    this.pendingDecode = null
    this.decodeBusy = true
    this.ort.postMessage(msg)
  }

  /** Abort whatever is running (kills the worker; the model reloads on next use). */
  cancel(): void {
    const e = new Error('cancelled')
    this.failAll(e)
    this.releaseOrt()
    this.loading = null
    this.setState('unloaded')
  }

  // ---------------------------------------------------------------- compute worker
  private computeCall<T extends ComputeOut>(job: ComputeIn, transfer: Transferable[]): Promise<T> {
    this.touch()
    if (!this.cw) {
      this.cw = new Worker(new URL('./computeWorker.ts', import.meta.url), { type: 'module' })
      this.cw.onmessage = (ev: MessageEvent<ComputeOut>) => {
        const w = this.waiting.get(ev.data.id)
        this.waiting.delete(ev.data.id)
        if (ev.data.t === 'error') w?.rej(new Error(ev.data.message))
        else w?.res(ev.data)
      }
    }
    return new Promise<T>((res, rej) => {
      this.waiting.set(job.id, { res, rej })
      this.cw!.postMessage(job, transfer)
    })
  }

  refine(field: Float32Array, guide: Uint8ClampedArray, w: number, h: number, opts: RefineOpts, outW: number, outH: number): Promise<{ alpha: Uint8Array; ms: number }> {
    const id = this.seq++
    return this.computeCall<Extract<ComputeOut, { t: 'refined' }>>({ t: 'refine', id, field, guide, w, h, opts, outW, outH }, [field.buffer, guide.buffer])
  }
  brush(rgba: Uint8ClampedArray, w: number, h: number, strokes: BrushStroke[], opts: BrushOpts): Promise<{ field: Float32Array; ms: number }> {
    const id = this.seq++
    return this.computeCall<Extract<ComputeOut, { t: 'brushed' }>>({ t: 'brush', id, rgba, w, h, strokes, opts }, [rgba.buffer])
  }
  decon(rgba: Uint8ClampedArray, alpha: Uint8Array, w: number, h: number, radius: number, on: boolean): Promise<{ rgba: Uint8ClampedArray; ms: number }> {
    const id = this.seq++
    return this.computeCall<Extract<ComputeOut, { t: 'decon' }>>({ t: 'decon', id, rgba, alpha, w, h, radius, decontaminate: on }, [rgba.buffer])
  }

  // ---------------------------------------------------------------- lifetime
  private releaseOrt(): void {
    if (this.ort) {
      try {
        this.ort.postMessage({ t: 'dispose' } satisfies WorkerIn)
      } catch {
        /* worker already gone */
      }
      this.ort.terminate()
    }
    this.ort = null
    this.encodedKey = null
    this.encodedGeom = null
    this.pendingDecode = null
    this.decodeBusy = false
  }

  /** Free the models and the workers (idle timeout, tool closed for good, model switch). */
  release(full = true): void {
    window.clearTimeout(this.idleTimer)
    this.releaseOrt()
    if (full && this.cw) {
      this.cw.terminate()
      this.cw = null
    }
    this.loading = null
    if (this.state !== 'unloaded') this.setState('unloaded')
  }

  get active(): boolean {
    return !!(this.ort || this.cw)
  }
}
