/// <reference lib="webworker" />
/** CPU image jobs for Smart selection, off the UI thread: edge refinement, classical brush segmentation, cut-out colour clean-up. */
import { brushSegment, rasterizeSeeds, type BrushOpts, type BrushStroke } from './brushSeg'
import { decontaminate, resizePlane } from './imgops'
import { refineField, toBytes, type RefineOpts } from './refine'

export interface RefineJob {
  t: 'refine'
  id: number
  field: Float32Array
  /** guide RGBA at the same grid as `field` */
  guide: Uint8ClampedArray
  w: number
  h: number
  opts: RefineOpts
  /** final output size (alpha is bilinearly resized from the work grid when it differs) */
  outW: number
  outH: number
}
export interface BrushJob {
  t: 'brush'
  id: number
  rgba: Uint8ClampedArray
  w: number
  h: number
  strokes: BrushStroke[]
  opts: BrushOpts
}
export interface DeconJob {
  t: 'decon'
  id: number
  /** straight RGBA of the source pixels */
  rgba: Uint8ClampedArray
  /** selection coverage 0..255 */
  alpha: Uint8Array
  w: number
  h: number
  radius: number
  /** multiply the source alpha into the result (cut-outs of semi-transparent layers) */
  decontaminate: boolean
}
export type ComputeIn = RefineJob | BrushJob | DeconJob
export type ComputeOut = { t: 'refined'; id: number; alpha: Uint8Array; ms: number } | { t: 'brushed'; id: number; field: Float32Array; ms: number } | { t: 'decon'; id: number; rgba: Uint8ClampedArray; ms: number } | { t: 'error'; id: number; message: string }

const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.onmessage = (ev: MessageEvent<ComputeIn>) => {
  const m = ev.data
  const t0 = performance.now()
  try {
    if (m.t === 'refine') {
      let a = refineField(m.field, m.guide, m.w, m.h, m.opts)
      if (m.outW !== m.w || m.outH !== m.h) a = resizePlane(a, m.w, m.h, m.outW, m.outH)
      const bytes = toBytes(a)
      ctx.postMessage({ t: 'refined', id: m.id, alpha: bytes, ms: performance.now() - t0 } satisfies ComputeOut, [bytes.buffer])
    } else if (m.t === 'brush') {
      const seeds = rasterizeSeeds(m.strokes, m.w, m.h)
      const f = brushSegment(m.rgba, seeds, m.w, m.h, m.opts)
      ctx.postMessage({ t: 'brushed', id: m.id, field: f, ms: performance.now() - t0 } satisfies ComputeOut, [f.buffer])
    } else if (m.t === 'decon') {
      const n = m.w * m.h
      const alpha = new Float32Array(n)
      for (let i = 0; i < n; i++) alpha[i] = (m.alpha[i] / 255) * (m.rgba[i * 4 + 3] / 255)
      if (m.decontaminate) decontaminate(m.rgba, alpha, m.w, m.h, m.radius)
      for (let i = 0; i < n; i++) m.rgba[i * 4 + 3] = (alpha[i] * 255 + 0.5) | 0
      ctx.postMessage({ t: 'decon', id: m.id, rgba: m.rgba, ms: performance.now() - t0 } satisfies ComputeOut, [m.rgba.buffer])
    }
  } catch (e) {
    ctx.postMessage({ t: 'error', id: m.id, message: String((e as Error)?.message ?? e) } satisfies ComputeOut)
  }
}
