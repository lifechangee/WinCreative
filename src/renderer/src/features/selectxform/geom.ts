/** Pure (no DOM / GL) selection maths: polygon rasterisation, flood fill, blur, mask combination. */
import type { Rect } from '../../core/types'

export interface Pt {
  x: number
  y: number
}

export type SelMode = 'replace' | 'add' | 'subtract'

export interface MaskPatch {
  /** integer rect inside the canvas */
  rect: Rect
  /** rect.w * rect.h coverage bytes (0..255) */
  data: Uint8Array
}

const SS = 5 // vertical sub-scanlines per pixel row

/**
 * Anti-aliased polygon fill (non-zero winding). Horizontal coverage is exact, vertical uses SS sub-scanlines.
 * Returns null when the polygon is degenerate / entirely off-canvas.
 */
export function rasterizePolygon(pts: Pt[], w: number, h: number): MaskPatch | null {
  if (pts.length < 3) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  const x0 = Math.max(0, Math.floor(minX))
  const y0 = Math.max(0, Math.floor(minY))
  const x1 = Math.min(w, Math.ceil(maxX))
  const y1 = Math.min(h, Math.ceil(maxY))
  if (x1 <= x0 || y1 <= y0) return null
  const rw = x1 - x0
  const rh = y1 - y0
  const data = new Uint8Array(rw * rh)
  // edges (non horizontal), oriented top->bottom with winding direction
  const n = pts.length
  const ex0: number[] = []
  const ey0: number[] = []
  const ey1: number[] = []
  const eslope: number[] = []
  const edir: number[] = []
  for (let i = 0; i < n; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    if (a.y === b.y) continue
    const dir = b.y > a.y ? 1 : -1
    const top = dir === 1 ? a : b
    const bot = dir === 1 ? b : a
    ex0.push(top.x)
    ey0.push(top.y)
    ey1.push(bot.y)
    eslope.push((bot.x - top.x) / (bot.y - top.y))
    edir.push(dir)
  }
  const E = ex0.length
  if (!E) return null
  const acc = new Float32Array(rw)
  const xs: number[] = []
  const ds: number[] = []
  const order: number[] = []
  for (let y = y0; y < y1; y++) {
    acc.fill(0)
    let any = false
    for (let s = 0; s < SS; s++) {
      const sy = y + (s + 0.5) / SS
      xs.length = 0
      ds.length = 0
      for (let e = 0; e < E; e++) {
        if (sy >= ey0[e] && sy < ey1[e]) {
          xs.push(ex0[e] + (sy - ey0[e]) * eslope[e])
          ds.push(edir[e])
        }
      }
      const m = xs.length
      if (m < 2) continue
      order.length = m
      for (let i = 0; i < m; i++) order[i] = i
      order.sort((i, j) => xs[i] - xs[j])
      let wind = 0
      for (let k = 0; k < m - 1; k++) {
        wind += ds[order[k]]
        if (wind === 0) continue
        let xa = xs[order[k]] - x0
        let xb = xs[order[k + 1]] - x0
        if (xb <= 0 || xa >= rw) continue
        if (xa < 0) xa = 0
        if (xb > rw) xb = rw
        if (xb <= xa) continue
        any = true
        const i0 = Math.floor(xa)
        const i1 = Math.floor(xb)
        if (i0 === i1) acc[i0] += (xb - xa) / SS
        else {
          acc[i0] += (i0 + 1 - xa) / SS
          for (let i = i0 + 1; i < i1; i++) acc[i] += 1 / SS
          if (i1 < rw) acc[i1] += (xb - i1) / SS
        }
      }
    }
    if (any) {
      const o = (y - y0) * rw
      for (let i = 0; i < rw; i++) {
        const v = acc[i]
        data[o + i] = v >= 0.999 ? 255 : (v * 255 + 0.5) | 0
      }
    }
  }
  return { rect: { x: x0, y: y0, w: rw, h: rh }, data }
}

export function rectPolygon(x0: number, y0: number, x1: number, y1: number): Pt[] {
  return [
    { x: Math.min(x0, x1), y: Math.min(y0, y1) },
    { x: Math.max(x0, x1), y: Math.min(y0, y1) },
    { x: Math.max(x0, x1), y: Math.max(y0, y1) },
    { x: Math.min(x0, x1), y: Math.max(y0, y1) }
  ]
}

export function ellipsePolygon(x0: number, y0: number, x1: number, y1: number): Pt[] {
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const rx = Math.abs(x1 - x0) / 2
  const ry = Math.abs(y1 - y0) / 2
  const n = Math.max(24, Math.min(720, Math.ceil(Math.PI * 2 * Math.max(rx, ry) / 3)))
  const out: Pt[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    out.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry })
  }
  return out
}

/** Make a square/circle box out of a drag from (x0,y0) to (x1,y1). */
export function uniformBox(x0: number, y0: number, x1: number, y1: number): [number, number] {
  const dx = x1 - x0
  const dy = y1 - y0
  const s = Math.max(Math.abs(dx), Math.abs(dy))
  return [x0 + Math.sign(dx || 1) * s, y0 + Math.sign(dy || 1) * s]
}

/** Combine `patch` into full-canvas mask `dst` (w wide). replace must be handled by the caller clearing first. */
export function combinePatch(dst: Uint8Array, w: number, patch: MaskPatch, mode: SelMode): void {
  const { rect, data } = patch
  for (let y = 0; y < rect.h; y++) {
    let o = (rect.y + y) * w + rect.x
    let s = y * rect.w
    for (let x = 0; x < rect.w; x++, o++, s++) {
      const v = data[s]
      if (!v) continue
      if (mode === 'subtract') dst[o] = ((dst[o] * (255 - v) + 127) / 255) | 0
      else {
        const d = dst[o]
        dst[o] = d + v - (((d * v + 127) / 255) | 0)
      }
    }
  }
}

/**
 * Contiguous flood fill on straight-RGBA pixels. Distance = max channel difference on premultiplied colour,
 * normalised 0..1. Returns a rect-cropped 0/255 mask, or null when the seed is outside.
 */
export function floodFill(px: Uint8ClampedArray | Uint8Array, w: number, h: number, sx: number, sy: number, tol: number): MaskPatch | null {
  sx = Math.floor(sx)
  sy = Math.floor(sy)
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null
  const T = Math.round(Math.min(1, Math.max(0, tol)) * 255)
  const si = (sy * w + sx) * 4
  const sa = px[si + 3]
  const sr = (px[si] * sa) / 255
  const sg = (px[si + 1] * sa) / 255
  const sb = (px[si + 2] * sa) / 255
  const near = (i: number): boolean => {
    const a = px[i + 3]
    if (Math.abs(a - sa) > T) return false
    if (Math.abs((px[i] * a) / 255 - sr) > T) return false
    if (Math.abs((px[i + 1] * a) / 255 - sg) > T) return false
    return Math.abs((px[i + 2] * a) / 255 - sb) <= T
  }
  const vis = new Uint8Array(w * h)
  const stack: number[] = [sx, sy]
  let minX = sx
  let maxX = sx
  let minY = sy
  let maxY = sy
  while (stack.length) {
    const y = stack.pop()!
    let x = stack.pop()!
    if (vis[y * w + x]) continue
    if (!near((y * w + x) * 4)) continue
    let xl = x
    while (xl > 0 && !vis[y * w + xl - 1] && near((y * w + xl - 1) * 4)) xl--
    let xr = x
    while (xr < w - 1 && !vis[y * w + xr + 1] && near((y * w + xr + 1) * 4)) xr++
    for (x = xl; x <= xr; x++) vis[y * w + x] = 1
    if (xl < minX) minX = xl
    if (xr > maxX) maxX = xr
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    for (const ny of [y - 1, y + 1]) {
      if (ny < 0 || ny >= h) continue
      let inRun = false
      for (x = xl; x <= xr; x++) {
        const ok = !vis[ny * w + x] && near((ny * w + x) * 4)
        if (ok && !inRun) stack.push(x, ny)
        inRun = ok
      }
    }
  }
  const rect = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
  const data = new Uint8Array(rect.w * rect.h)
  for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) if (vis[(rect.y + y) * w + rect.x + x]) data[y * rect.w + x] = 255
  return { rect, data }
}

/** Nonzero bounding box of a full-canvas mask. */
export function maskBounds(m: Uint8Array, w: number, h: number, hint?: Rect): Rect | null {
  const r = hint ?? { x: 0, y: 0, w, h }
  let minX = Infinity
  let minY = Infinity
  let maxX = -1
  let maxY = -1
  for (let y = r.y; y < r.y + r.h; y++) {
    const o = y * w
    for (let x = r.x; x < r.x + r.w; x++) {
      if (m[o + x]) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

function boxPass(src: Float32Array, dst: Float32Array, n: number, stride: number, count: number, lineStride: number, r: number): void {
  const inv = 1 / (2 * r + 1)
  for (let l = 0; l < count; l++) {
    const base = l * lineStride
    let sum = src[base] * (r + 1)
    for (let i = 1; i <= r; i++) sum += src[base + Math.min(i, n - 1) * stride]
    for (let i = 0; i < n; i++) {
      dst[base + i * stride] = sum * inv
      const add = src[base + Math.min(i + r + 1, n - 1) * stride]
      const sub = src[base + Math.max(i - r, 0) * stride]
      sum += add - sub
    }
  }
}

/**
 * Gaussian-ish blur (3 box passes) of a full-canvas mask, in place, limited to `area` (already expanded by the
 * caller). Edges are replicated. `radius` in px.
 */
export function blurMask(m: Uint8Array, w: number, area: Rect, radius: number): void {
  if (radius <= 0.5) return
  const b = Math.max(1, Math.round(radius / 3))
  const rw = area.w
  const rh = area.h
  let a = new Float32Array(rw * rh)
  let t = new Float32Array(rw * rh)
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) a[y * rw + x] = m[(area.y + y) * w + area.x + x]
  for (let p = 0; p < 3; p++) {
    boxPass(a, t, rw, 1, rh, rw, b)
    boxPass(t, a, rh, rw, rw, 1, b)
  }
  void t
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) m[(area.y + y) * w + area.x + x] = Math.round(a[y * rw + x])
}

export function expandClamp(r: Rect, m: number, w: number, h: number): Rect {
  const x0 = Math.max(0, Math.floor(r.x - m))
  const y0 = Math.max(0, Math.floor(r.y - m))
  const x1 = Math.min(w, Math.ceil(r.x + r.w + m))
  const y1 = Math.min(h, Math.ceil(r.y + r.h + m))
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) }
}

/** Grow/blur a hard 0/255 patch by ~1px so flood-fill edges are anti-aliased. */
export function softenEdges(m: Uint8Array, w: number, h: number, rect: Rect): void {
  blurMask(m, w, expandClamp(rect, 3, w, h), 3)
}

/** Anti-alias the edge of a hard patch (flood fill result): returns a slightly larger, softened patch. */
export function softenPatch(p: MaskPatch, w: number, h: number): MaskPatch {
  const M = 4
  const tw = p.rect.w + M * 2
  const th = p.rect.h + M * 2
  const tmp = new Uint8Array(tw * th)
  for (let y = 0; y < p.rect.h; y++) tmp.set(p.data.subarray(y * p.rect.w, (y + 1) * p.rect.w), (y + M) * tw + M)
  blurMask(tmp, tw, { x: 0, y: 0, w: tw, h: th }, 2.4)
  const x0 = Math.max(0, p.rect.x - M)
  const y0 = Math.max(0, p.rect.y - M)
  const x1 = Math.min(w, p.rect.x + p.rect.w + M)
  const y1 = Math.min(h, p.rect.y + p.rect.h + M)
  const rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
  const data = new Uint8Array(rect.w * rect.h)
  for (let y = 0; y < rect.h; y++) {
    const so = (y0 + y - (p.rect.y - M)) * tw + (x0 - (p.rect.x - M))
    data.set(tmp.subarray(so, so + rect.w), y * rect.w)
  }
  return { rect, data }
}
