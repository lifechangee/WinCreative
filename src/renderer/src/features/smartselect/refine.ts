/**
 * Edge refinement: turns a coarse signed field (> 0 inside; decoder logits or brush result, bilinear-upsampled) into a
 * full-resolution soft alpha that follows the real image edges (guided filter in a narrow band around the contour),
 * then applies Smooth / Shift edge / Feather. Pure, runs in a Worker.
 */
import { gaussBlur, guidedFilter, shiftEdge, signedDistance } from './imgops'

export interface RefineOpts {
  /** work-grid px covered by one coarse cell (decoder logit cell or brush grid cell): sets the band width */
  cellPx: number
  /** 0..1: rounds jaggies / softens the matte slightly */
  smooth: number
  /** gaussian feather radius in work px (0 = none) */
  feather: number
  /** px, >0 expands the edge, <0 contracts it */
  shift: number
  /** snap the edge to image edges (guided filter); false = keep the coarse contour (anti-aliased only) */
  snap?: boolean
}

export const DEFAULT_REFINE: RefineOpts = { cellPx: 4, smooth: 0.25, feather: 0, shift: 0, snap: true }

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Returns alpha 0..1 (Float32, w*h). `guide` is straight RGBA8 of the same grid. */
export function refineField(field: Float32Array, guide: Uint8ClampedArray, w: number, h: number, o: RefineOpts): Float32Array {
  const n = w * h
  const inside = new Uint8Array(n)
  let any = false
  for (let i = 0; i < n; i++)
    if (field[i] > 0) {
      inside[i] = 1
      any = true
    }
  if (!any) return new Float32Array(n)

  const sd = signedDistance(inside, w, h)
  const B = Math.min(48, Math.max(3, o.cellPx * 1.6 + 2)) // half width of the uncertain band
  let alpha: Float32Array = new Float32Array(n)
  if (o.snap !== false) {
    // soft starting matte: linear ramp across the band (continuous, so the filter has something to pull on)
    const ramp = new Float32Array(n)
    for (let i = 0; i < n; i++) ramp[i] = clamp01(0.5 + sd[i] / (2 * B))
    const r1 = Math.max(2, Math.round(B * 0.7))
    const a2 = guidedFilter(guide, ramp, w, h, r1, 3e-4, Math.max(1, Math.round(r1 / 2.5)))
    for (let i = 0; i < n; i++) {
      if (sd[i] > B) alpha[i] = 1
      else if (sd[i] < -B) alpha[i] = 0
      else {
        // contrast curve: the matte becomes crisp (about 1.5 px edge) but keeps genuine soft detail
        alpha[i] = clamp01((clamp01(a2[i]) - 0.5) * (2.4 - 1.2 * o.smooth) + 0.5)
      }
    }
  } else {
    for (let i = 0; i < n; i++) alpha[i] = clamp01(0.5 + sd[i])
  }
  // Smooth: low-pass the matte near the contour only (keeps interiors exactly 1 / 0), then re-sharpen the ramp a little
  if (o.smooth > 0.02) {
    const blurred = gaussBlur(alpha, w, h, 0.6 + o.smooth * 2.4)
    for (let i = 0; i < n; i++) {
      if (sd[i] > B + 4 || sd[i] < -B - 4) continue
      const v = blurred[i]
      alpha[i] = clamp01((v - 0.5) * (1.6 + (1 - o.smooth) * 0.8) + 0.5)
    }
  }
  if (Math.abs(o.shift) >= 0.01) alpha = shiftEdge(alpha, w, h, o.shift)
  if (o.feather > 0.3) alpha = gaussBlur(alpha, w, h, o.feather / 2)
  return alpha
}

/** alpha plane -> 0..255 bytes */
export function toBytes(alpha: Float32Array): Uint8Array {
  const out = new Uint8Array(alpha.length)
  for (let i = 0; i < alpha.length; i++) out[i] = (alpha[i] * 255 + 0.5) | 0
  return out
}
