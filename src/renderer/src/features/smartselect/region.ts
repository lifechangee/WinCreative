/**
 * Pure geometry of Smart selection: which document rect is encoded, how document coordinates map to the model's
 * 1024x1024 input frame, how prompts are encoded for the two model families and how the decoder's low-res logits
 * are brought back to document resolution. Everything works in document-space rects (never assumes the image starts at 0,0).
 */
import type { Rect } from '../../core/types'

export type ModelFamily = 'sam1' | 'sam2'
export const FRAME = 1024
export const LOWRES = 256

export interface EncodeGeom {
  family: ModelFamily
  /** document rect that was fed to the encoder */
  region: Rect
  /** size of the resized image inside the 1024 frame (sam1: aspect kept, top-left aligned; sam2: whole frame, squashed) */
  rw: number
  rh: number
  /** document px -> frame px */
  sx: number
  sy: number
}

export function encodeGeom(region: Rect, family: ModelFamily): EncodeGeom {
  if (family === 'sam2') return { family, region, rw: FRAME, rh: FRAME, sx: FRAME / region.w, sy: FRAME / region.h }
  const k = FRAME / Math.max(region.w, region.h)
  const rw = Math.max(1, Math.min(FRAME, Math.round(region.w * k)))
  const rh = Math.max(1, Math.min(FRAME, Math.round(region.h * k)))
  return { family, region, rw, rh, sx: rw / region.w, sy: rh / region.h }
}

export const docToFrame = (g: EncodeGeom, x: number, y: number): { x: number; y: number } => ({ x: (x - g.region.x) * g.sx, y: (y - g.region.y) * g.sy })
export const frameToDoc = (g: EncodeGeom, x: number, y: number): { x: number; y: number } => ({ x: x / g.sx + g.region.x, y: y / g.sy + g.region.y })

export const rectIntersect = (a: Rect, b: Rect): Rect | null => {
  const x0 = Math.max(a.x, b.x)
  const y0 = Math.max(a.y, b.y)
  const x1 = Math.min(a.x + a.w, b.x + b.w)
  const y1 = Math.min(a.y + a.h, b.y + b.h)
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null
}
export const rectUnion = (a: Rect | null, b: Rect | null): Rect | null => {
  if (!a) return b
  if (!b) return a
  const x0 = Math.min(a.x, b.x)
  const y0 = Math.min(a.y, b.y)
  const x1 = Math.max(a.x + a.w, b.x + b.w)
  const y1 = Math.max(a.y + a.h, b.y + b.h)
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}
export const rectGrow = (r: Rect, m: number): Rect => ({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m })
export const rectInt = (r: Rect): Rect => {
  const x0 = Math.floor(r.x)
  const y0 = Math.floor(r.y)
  return { x: x0, y: y0, w: Math.max(1, Math.ceil(r.x + r.w) - x0), h: Math.max(1, Math.ceil(r.y + r.h) - y0) }
}
export const rectContains = (r: Rect, x: number, y: number): boolean => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h

/**
 * The document rect to encode. Default = content bounds of the sampled source; "Refine in view" passes the visible rect,
 * which is intersected with the content, grown by 8 % and never smaller than `minSide` px.
 */
export function planEncodeRegion(content: Rect, view: Rect | null, minSide = 96): Rect {
  if (!view) return { ...content }
  const v = rectIntersect(rectGrow(view, Math.max(view.w, view.h) * 0.04), content)
  if (!v) return { ...content }
  let r = v
  if (r.w < minSide || r.h < minSide) {
    const cx = r.x + r.w / 2
    const cy = r.y + r.h / 2
    const w = Math.min(content.w, Math.max(minSide, r.w))
    const h = Math.min(content.h, Math.max(minSide, r.h))
    r = rectIntersect({ x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h }, content) ?? content
  }
  return rectInt(r)
}

// ---------------------------------------------------------------- prompts
export interface PromptPoint {
  x: number
  y: number
  /** 1 = object, 0 = not object */
  label: 0 | 1
}
export interface Prompt {
  points: PromptPoint[]
  /** document-space box */
  box?: Rect | null
}

export interface EncodedPrompt {
  /** frame-space coordinates, 2 per point */
  coords: Float32Array
  labels: Float32Array
  /** [x0,y0,x1,y1] frame space (sam2 only) */
  box: Float32Array | null
  count: number
}

/** Prompt -> model inputs. sam1 encodes a box as two special points (labels 2,3) and pads with a (0,0,-1) point when there is none. */
export function encodePrompt(g: EncodeGeom, p: Prompt): EncodedPrompt {
  const pts: { x: number; y: number; l: number }[] = p.points.map((q) => ({ ...docToFrame(g, q.x, q.y), l: q.label }))
  let box: Float32Array | null = null
  if (p.box) {
    const a = docToFrame(g, p.box.x, p.box.y)
    const b = docToFrame(g, p.box.x + p.box.w, p.box.y + p.box.h)
    if (g.family === 'sam1') {
      pts.push({ x: a.x, y: a.y, l: 2 }, { x: b.x, y: b.y, l: 3 })
    } else box = new Float32Array([a.x, a.y, b.x, b.y])
  } else if (g.family === 'sam1') pts.push({ x: 0, y: 0, l: -1 })
  const coords = new Float32Array(pts.length * 2)
  const labels = new Float32Array(pts.length)
  pts.forEach((q, i) => {
    coords[i * 2] = q.x
    coords[i * 2 + 1] = q.y
    labels[i] = q.l
  })
  return { coords, labels, box, count: pts.length }
}

/** Which of the decoder's candidate masks to use. `level` 0 = auto, 1..n = fixed candidate (Part / Object / Whole). */
export function pickCandidate(iou: ArrayLike<number>, family: ModelFamily, positives: number, hasBox: boolean, level = 0): number {
  const n = family === 'sam1' ? 3 : iou.length
  const off = family === 'sam1' ? 1 : 0 // sam1 decoder returns [single, 3 multimask]
  if (level > 0) return off + Math.min(n, level) - 1
  if (family === 'sam1' && (positives + (hasBox ? 1 : 0) > 1 || hasBox)) return 0
  let best = off
  for (let i = off; i < off + n; i++) if (iou[i] > iou[best]) best = i
  return best
}

// ---------------------------------------------------------------- low-res logits -> document resolution
/**
 * Bilinear upsample of the 256x256 decoder logits onto the pixels of `rect` (document space, sampled every `step` doc px).
 * Result is a signed field: > 0 inside the object. Pixels outside the encoded region (or in sam1 padding) are strongly negative.
 */
export function upsampleLogits(logits: Float32Array, g: EncodeGeom, rect: Rect, step = 1): { data: Float32Array; w: number; h: number } {
  const w = Math.max(1, Math.ceil(rect.w / step))
  const h = Math.max(1, Math.ceil(rect.h / step))
  const out = new Float32Array(w * h)
  const cell = FRAME / LOWRES
  const maxU = LOWRES - 1
  for (let j = 0; j < h; j++) {
    const dy = rect.y + (j + 0.5) * step
    const fy = (dy - g.region.y) * g.sy
    for (let i = 0; i < w; i++) {
      const dx = rect.x + (i + 0.5) * step
      const fx = (dx - g.region.x) * g.sx
      if (fx < 0 || fy < 0 || fx >= g.rw || fy >= g.rh) {
        out[j * w + i] = -12
        continue
      }
      const u = Math.min(maxU, Math.max(0, fx / cell - 0.5))
      const v = Math.min(maxU, Math.max(0, fy / cell - 0.5))
      const u0 = Math.floor(u)
      const v0 = Math.floor(v)
      const u1 = Math.min(maxU, u0 + 1)
      const v1 = Math.min(maxU, v0 + 1)
      const a = u - u0
      const b = v - v0
      out[j * w + i] = (logits[v0 * LOWRES + u0] * (1 - a) + logits[v0 * LOWRES + u1] * a) * (1 - b) + (logits[v1 * LOWRES + u0] * (1 - a) + logits[v1 * LOWRES + u1] * a) * b
    }
  }
  return { data: out, w, h }
}

/** Bounding rect (doc space, integer) of the pixels > 0 in a signed field sampled on `rect` with `step`; null when empty. */
export function fieldBounds(field: Float32Array, w: number, h: number, rect: Rect, step: number): Rect | null {
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (field[y * w + x] > 0) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
  if (x1 < 0) return null
  return rectInt({ x: rect.x + x0 * step, y: rect.y + y0 * step, w: (x1 - x0 + 1) * step, h: (y1 - y0 + 1) * step })
}

/** Normalised ImageNet-style input for sam2 (NCHW float, 1024x1024) from a resized RGB(A) 1024x1024 image. */
export function sam2Pixels(rgba: Uint8ClampedArray): Float32Array {
  const n = FRAME * FRAME
  const out = new Float32Array(3 * n)
  const mean = [0.485, 0.456, 0.406]
  const std = [0.229, 0.224, 0.225]
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) out[c * n + i] = (rgba[i * 4 + c] / 255 - mean[c]) / std[c]
  }
  return out
}

/** sam1 input: HWC float 0..255 of the resized (<=1024) image. */
export function sam1Pixels(rgba: Uint8ClampedArray, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h * 3)
  for (let i = 0, n = w * h; i < n; i++) {
    out[i * 3] = rgba[i * 4]
    out[i * 3 + 1] = rgba[i * 4 + 1]
    out[i * 3 + 2] = rgba[i * 4 + 2]
  }
  return out
}

/** Composite straight RGBA over a neutral grey so transparent areas are not seen as black by the encoder. */
export function flattenOnGrey(rgba: Uint8ClampedArray, grey = 127): void {
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3]
    if (a === 255) continue
    const k = a / 255
    rgba[i] = rgba[i] * k + grey * (1 - k)
    rgba[i + 1] = rgba[i + 1] * k + grey * (1 - k)
    rgba[i + 2] = rgba[i + 2] * k + grey * (1 - k)
    rgba[i + 3] = 255
  }
}

/**
 * Bilinear resample of a coarse signed field that covers `fieldRect` (document space, w*h cells) onto the pixels of `rect`
 * (sampled every `step` doc px). Used for the brush result; cells outside the field are strongly negative.
 */
export function upsampleField(field: Float32Array, fw: number, fh: number, fieldRect: Rect, rect: Rect, step = 1): { data: Float32Array; w: number; h: number } {
  const w = Math.max(1, Math.ceil(rect.w / step))
  const h = Math.max(1, Math.ceil(rect.h / step))
  const out = new Float32Array(w * h)
  const kx = fw / fieldRect.w
  const ky = fh / fieldRect.h
  for (let j = 0; j < h; j++) {
    const dy = rect.y + (j + 0.5) * step
    const v = (dy - fieldRect.y) * ky - 0.5
    for (let i = 0; i < w; i++) {
      const dx = rect.x + (i + 0.5) * step
      const u = (dx - fieldRect.x) * kx - 0.5
      if (dx < fieldRect.x || dy < fieldRect.y || dx >= fieldRect.x + fieldRect.w || dy >= fieldRect.y + fieldRect.h) {
        out[j * w + i] = -1
        continue
      }
      const uc = Math.min(fw - 1, Math.max(0, u))
      const vc = Math.min(fh - 1, Math.max(0, v))
      const u0 = Math.floor(uc)
      const v0 = Math.floor(vc)
      const u1 = Math.min(fw - 1, u0 + 1)
      const v1 = Math.min(fh - 1, v0 + 1)
      const a = uc - u0
      const b = vc - v0
      out[j * w + i] = (field[v0 * fw + u0] * (1 - a) + field[v0 * fw + u1] * a) * (1 - b) + (field[v1 * fw + u0] * (1 - a) + field[v1 * fw + u1] * a) * b
    }
  }
  return { data: out, w, h }
}
