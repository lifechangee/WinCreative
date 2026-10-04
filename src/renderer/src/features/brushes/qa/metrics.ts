/** Pure image metrics for the brush QA harness (coverage maps are 0..255, row-major, y down). */

export interface CovMap {
  w: number
  h: number
  a: Uint8Array | Uint8ClampedArray
}

/** Share of edge pixel pairs (4-neighbourhood) that jump >= 250 levels: ~0 for anti-aliased, ~1 for aliased edges. */
export function hardJumpFrac(c: CovMap): { hard: number; edge: number; frac: number } {
  let hard = 0
  let edge = 0
  const { w, h, a } = c
  const test = (p: number, q: number): void => {
    const lo = Math.min(p, q)
    const hi = Math.max(p, q)
    if (hi < 8 || lo > 247) return
    edge++
    if (hi - lo >= 250) hard++
  }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = a[y * w + x]
      if (x + 1 < w) test(v, a[y * w + x + 1])
      if (y + 1 < h) test(v, a[(y + 1) * w + x])
    }
  return { hard, edge, frac: edge ? hard / edge : 0 }
}

export interface LineStats {
  /** RMS deviation (px) of the per-column centroid from a straight-line fit (stair-stepping) */
  centroidRms: number
  /** coefficient of variation of the per-column ink thickness (dab spacing ripple) */
  thicknessCv: number
  /** std/mean of the coverage on the centre line (bead / ripple of flow) */
  centerCv: number
  /** average number of partially covered pixels per column and edge (edge softness in px) */
  edgePx: number
  meanThickness: number
  columns: number
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** Bilinear coverage sample at continuous coordinates (pixel i centre = i + 0.5). */
export function sampleCov(c: CovMap, x: number, y: number): number {
  const fx = x - 0.5
  const fy = y - 0.5
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const tx = fx - x0
  const ty = fy - y0
  const g = (px: number, py: number): number => (px < 0 || py < 0 || px >= c.w || py >= c.h ? 0 : c.a[py * c.w + px])
  return lerp(lerp(g(x0, y0), g(x0 + 1, y0), tx), lerp(g(x0, y0 + 1), g(x0 + 1, y0 + 1), tx), ty)
}

/**
 * Statistics of a near-horizontal straight stroke y = y0 + slope * (x - xa) between xa and xb.
 * `pad` = half band height (px) examined around the ideal line; the stroke ends are trimmed by `trim` px.
 */
export function lineStats(c: CovMap, xa: number, y0: number, slope: number, xb: number, pad: number, trim: number): LineStats {
  const cx: number[] = []
  const cy: number[] = []
  const th: number[] = []
  const cl: number[] = []
  let edgeSum = 0
  const from = Math.ceil(xa + trim)
  const to = Math.floor(xb - trim)
  for (let x = from; x < to; x++) {
    const yc = y0 + slope * (x + 0.5 - xa)
    const ya = Math.max(0, Math.floor(yc - pad))
    const yb = Math.min(c.h - 1, Math.ceil(yc + pad))
    let s = 0
    let sy = 0
    let partial = 0
    for (let y = ya; y <= yb; y++) {
      const v = c.a[y * c.w + x]
      s += v
      sy += v * (y + 0.5)
      if (v > 8 && v < 247) partial++
    }
    if (s < 255 * 0.05) continue
    cx.push(x + 0.5)
    cy.push(sy / s)
    th.push(s / 255)
    cl.push(sampleCov(c, x + 0.5, yc))
    edgeSum += partial / 2
  }
  const n = cx.length
  if (n < 8) return { centroidRms: 0, thicknessCv: 0, centerCv: 0, edgePx: 0, meanThickness: 0, columns: n }
  // linear regression of centroid
  let mx = 0
  let my = 0
  for (let i = 0; i < n; i++) (mx += cx[i]), (my += cy[i])
  mx /= n
  my /= n
  let sxx = 0
  let sxy = 0
  for (let i = 0; i < n; i++) (sxx += (cx[i] - mx) ** 2), (sxy += (cx[i] - mx) * (cy[i] - my))
  const k = sxy / sxx
  let r2 = 0
  for (let i = 0; i < n; i++) r2 += (cy[i] - (my + k * (cx[i] - mx))) ** 2
  const stat = (v: number[]): { m: number; cv: number } => {
    const m = v.reduce((p, q) => p + q, 0) / v.length
    const sd = Math.sqrt(v.reduce((p, q) => p + (q - m) ** 2, 0) / v.length)
    return { m, cv: m > 1e-6 ? sd / m : 0 }
  }
  const t = stat(th)
  return { centroidRms: Math.sqrt(r2 / n), thicknessCv: t.cv, centerCv: stat(cl).cv, edgePx: edgeSum / n, meanThickness: t.m, columns: n }
}

/** Per-column ink thickness of a horizontal stroke centred on y. */
export function columnThickness(c: CovMap, xa: number, xb: number, yc: number, pad: number): number[] {
  const out: number[] = []
  for (let x = Math.max(0, Math.floor(xa)); x < Math.min(c.w, Math.ceil(xb)); x++) {
    let s = 0
    for (let y = Math.max(0, Math.floor(yc - pad)); y <= Math.min(c.h - 1, Math.ceil(yc + pad)); y++) s += c.a[y * c.w + x]
    out.push(s / 255)
  }
  return out
}

/** Blob ratio at a stroke start (or end when reversed): peak thickness in the first `frac` of the stroke / thickness at `frac`. ~<=1.15 is clean. */
export function endBlob(th: number[], frac: number, reverse: boolean): number {
  const v = reverse ? [...th].reverse() : th
  const k = Math.max(3, Math.floor(v.length * frac))
  let mx = 0
  for (let i = 0; i < k; i++) mx = Math.max(mx, v[i])
  const ref = (v[k] + v[k + 1] + v[k + 2]) / 3
  return ref > 0.05 ? mx / ref : 0
}

/** Fraction of samples along a straight line whose coverage falls below half of the median: gaps in fast strokes. */
export function gapFrac(c: CovMap, a: [number, number], b: [number, number], from: number, to: number): { frac: number; minRel: number; median: number } {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  const vals: number[] = []
  for (let d = len * from; d < len * to; d += 0.5) {
    const t = d / len
    vals.push(sampleCov(c, lerp(a[0], b[0], t), lerp(a[1], b[1], t)))
  }
  const sorted = [...vals].sort((p, q) => p - q)
  const med = sorted[Math.floor(sorted.length / 2)] || 1
  let bad = 0
  for (const v of vals) if (v < 0.5 * med) bad++
  return { frac: bad / vals.length, minRel: sorted[0] / med, median: med }
}

/** Centroid of a coverage blob (continuous coordinates). */
export function centroid(c: CovMap, r?: { x: number; y: number; w: number; h: number }): { x: number; y: number; mass: number } {
  const x0 = r ? Math.max(0, r.x) : 0
  const y0 = r ? Math.max(0, r.y) : 0
  const x1 = r ? Math.min(c.w, r.x + r.w) : c.w
  const y1 = r ? Math.min(c.h, r.y + r.h) : c.h
  let s = 0
  let sx = 0
  let sy = 0
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const v = c.a[y * c.w + x]
      s += v
      sx += v * (x + 0.5)
      sy += v * (y + 0.5)
    }
  return { x: s ? sx / s : 0, y: s ? sy / s : 0, mass: s / 255 }
}

/** Longest run of identical values along a scan line inside [x0,x1) where the value changes at all (banding measure). */
export function longestRun(v: ArrayLike<number>, x0: number, x1: number): number {
  let best = 1
  let run = 1
  for (let x = x0 + 1; x < x1; x++) {
    if (v[x] === v[x - 1]) run++
    else run = 1
    if (run > best) best = run
  }
  return best
}
