/**
 * Pure flood-fill maths (no DOM/GL) used by ColorDrop.
 *
 * `computeFillLevels` runs a bucketed minimax flood (Dijkstra with 256 priority buckets) from the seed:
 * level[p] = the smallest threshold (0..255) at which pixel p becomes reachable from the seed through
 * pixels that all lie within that colour distance of the seed. A whole threshold sweep is then a
 * plain comparison (`levels[p] <= t`), so adjusting the threshold while dragging is instantaneous.
 */

export interface FillSource {
  /** straight RGBA8, row 0 = top */
  data: Uint8ClampedArray | Uint8Array
  w: number
  h: number
}

/** Distance between a pixel and the seed (premultiplied RGBA, max channel difference, 0..255). */
function pixelDiff(d: ArrayLike<number>, i: number, sr: number, sg: number, sb: number, sa: number): number {
  const a = d[i + 3]
  const r = (d[i] * a) / 255
  const g = (d[i + 1] * a) / 255
  const b = (d[i + 2] * a) / 255
  const dr = Math.abs(r - sr)
  const dg = Math.abs(g - sg)
  const db = Math.abs(b - sb)
  const da = Math.abs(a - sa)
  const m = dr > dg ? dr : dg
  const m2 = m > db ? m : db
  return Math.round(m2 > da ? m2 : da)
}

export function computeFillLevels(src: FillSource, sx: number, sy: number): Uint8Array {
  const { data, w, h } = src
  const n = w * h
  const levels = new Uint8Array(n)
  sx = Math.min(w - 1, Math.max(0, Math.floor(sx)))
  sy = Math.min(h - 1, Math.max(0, Math.floor(sy)))
  const si = (sy * w + sx) * 4
  const sa = data[si + 3]
  const sr = (data[si] * sa) / 255
  const sg = (data[si + 1] * sa) / 255
  const sb = (data[si + 2] * sa) / 255
  const best = new Uint16Array(n).fill(256)
  const done = new Uint8Array(n)
  const buckets: number[][] = Array.from({ length: 256 }, () => [])
  const start = sy * w + sx
  best[start] = 0
  buckets[0].push(start)
  for (let lv = 0; lv < 256; lv++) {
    const st = buckets[lv]
    while (st.length) {
      const p = st.pop()!
      if (done[p]) continue
      done[p] = 1
      levels[p] = lv
      const x = p % w
      const y = (p - x) / w
      const visit = (q: number): void => {
        if (done[q]) return
        const d = pixelDiff(data, q * 4, sr, sg, sb, sa)
        const nl = d > lv ? d : lv
        if (nl < best[q]) {
          best[q] = nl
          buckets[nl].push(q)
        }
      }
      if (x > 0) visit(p - 1)
      if (x < w - 1) visit(p + 1)
      if (y > 0) visit(p - w)
      if (y < h - 1) visit(p + w)
    }
    buckets[lv] = []
  }
  return levels
}

export interface FillMask {
  /** coverage 0..255 for the rect below, row-major */
  cov: Uint8Array
  x: number
  y: number
  w: number
  h: number
}

export interface MaskOpts {
  antialias?: boolean
  /** w*h coverage 0..255 restricting + scaling the fill (selection) */
  selection?: Uint8Array | null
}

/**
 * Turn levels into a coverage mask for `threshold` (0..1). Anti-aliased edges: a 2 pixel ring around the
 * flooded region gets partial coverage proportional to how "seed-like" the boundary pixel is, which removes
 * the halo left by AA line-art. Returns null when nothing is covered.
 */
export function maskFromLevels(levels: Uint8Array, src: FillSource, sx: number, sy: number, threshold: number, opts: MaskOpts = {}): FillMask | null {
  const { w, h, data } = src
  const t = Math.round(Math.min(1, Math.max(0, threshold)) * 255)
  const n = w * h
  const cov = new Uint8Array(n)
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0, p = y * w; x < w; x++, p++) {
      if (levels[p] <= t) {
        cov[p] = 255
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return null
  if (opts.antialias !== false && t < 255) {
    const si = (Math.min(h - 1, Math.floor(sy)) * w + Math.min(w - 1, Math.floor(sx))) * 4
    const sa = data[si + 3]
    const sr = (data[si] * sa) / 255
    const sg = (data[si + 1] * sa) / 255
    const sb = (data[si + 2] * sa) / 255
    const denom = Math.max(1, 255 - t)
    const ex0 = Math.max(0, x0 - 2)
    const ey0 = Math.max(0, y0 - 2)
    const ex1 = Math.min(w - 1, x1 + 2)
    const ey1 = Math.min(h - 1, y1 + 2)
    const inner = cov.slice() // fully-flooded pixels never change
    for (let pass = 0; pass < 2; pass++) {
      const add: [number, number][] = []
      for (let y = ey0; y <= ey1; y++) {
        for (let x = ex0; x <= ex1; x++) {
          const p = y * w + x
          if (inner[p] || cov[p]) continue
          let nb = 0
          if (x > 0) nb = Math.max(nb, cov[p - 1])
          if (x < w - 1) nb = Math.max(nb, cov[p + 1])
          if (y > 0) nb = Math.max(nb, cov[p - w])
          if (y < h - 1) nb = Math.max(nb, cov[p + w])
          if (!nb) continue
          const d = pixelDiff(data, p * 4, sr, sg, sb, sa)
          const c = Math.max(0, 1 - (d - t) / denom)
          const v = Math.round(Math.min(nb, c * 255))
          if (v > 0) add.push([p, v])
        }
      }
      for (const [p, v] of add) {
        cov[p] = v
        const x = p % w
        const y = (p - x) / w
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  const sel = opts.selection
  if (sel) {
    let nx0 = w
    let ny0 = h
    let nx1 = -1
    let ny1 = -1
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const p = y * w + x
        if (!cov[p]) continue
        cov[p] = Math.round((cov[p] * sel[p]) / 255)
        if (cov[p]) {
          if (x < nx0) nx0 = x
          if (x > nx1) nx1 = x
          if (y < ny0) ny0 = y
          if (y > ny1) ny1 = y
        }
      }
    }
    if (nx1 < 0) return null
    x0 = nx0
    y0 = ny0
    x1 = nx1
    y1 = ny1
  }
  const rw = x1 - x0 + 1
  const rh = y1 - y0 + 1
  const out = new Uint8Array(rw * rh)
  for (let y = 0; y < rh; y++) out.set(cov.subarray((y0 + y) * w + x0, (y0 + y) * w + x0 + rw), y * rw)
  return { cov: out, x: x0, y: y0, w: rw, h: rh }
}

/** Convenience for tests / one-shot fills. */
export function floodMask(src: FillSource, sx: number, sy: number, threshold: number, opts: MaskOpts = {}): FillMask | null {
  return maskFromLevels(computeFillLevels(src, sx, sy), src, sx, sy, threshold, opts)
}
