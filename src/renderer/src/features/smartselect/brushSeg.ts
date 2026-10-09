/**
 * "Brush (no AI)" quick selection: the user paints roughly over the object (object seeds) and optionally over what is not the
 * object (background seeds); the selection grows to the edges. Geodesic segmentation on a down-scaled working image:
 * every pixel joins the seed set it can reach more cheaply, where moving costs more across image edges and through colours that
 * resemble the other class (colour histograms learned from the strokes). Pure; runs in a Worker.
 */

import { boxMean, distanceTo } from './imgops'

export interface BrushStroke {
  /** polyline in work-grid px */
  pts: { x: number; y: number }[]
  /** work-grid radius per point (pressure aware) */
  radii: number[]
  /** 1 = object, 0 = not object */
  label: 0 | 1
}

export interface BrushOpts {
  /** gradient weight (edge strength) */
  edge?: number
  /** colour-model weight */
  colour?: number
  /** use the window border as automatic background seed (when the user painted no background) */
  autoBackground?: boolean
  /** colour-model re-estimation passes */
  iterations?: number
}

const BINS = 16 // per channel

/** Rasterise strokes into a label plane: 0 none, 1 object, 2 background. Later strokes win. */
export function rasterizeSeeds(strokes: BrushStroke[], w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h)
  const disk = (cx: number, cy: number, r: number, v: number): void => {
    const x0 = Math.max(0, Math.floor(cx - r))
    const x1 = Math.min(w - 1, Math.ceil(cx + r))
    const y0 = Math.max(0, Math.floor(cy - r))
    const y1 = Math.min(h - 1, Math.ceil(cy + r))
    const r2 = r * r
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r2) out[y * w + x] = v
  }
  for (const s of strokes) {
    const v = s.label ? 1 : 2
    for (let i = 0; i < s.pts.length; i++) {
      const p = s.pts[i]
      const r = Math.max(0.75, s.radii[i] ?? s.radii[0] ?? 1)
      disk(p.x, p.y, r, v)
      if (i) {
        const q = s.pts[i - 1]
        const rq = Math.max(0.75, s.radii[i - 1] ?? r)
        const len = Math.hypot(p.x - q.x, p.y - q.y)
        const steps = Math.ceil(len / Math.max(0.5, Math.min(r, rq) * 0.5))
        for (let k = 1; k < steps; k++) {
          const t = k / steps
          disk(q.x + (p.x - q.x) * t, q.y + (p.y - q.y) * t, rq + (r - rq) * t, v)
        }
      }
    }
  }
  return out
}

function gradientMagnitude(rgba: Uint8ClampedArray, w: number, h: number): Float32Array {
  const g = new Float32Array(w * h)
  const lum = new Float32Array(w * h * 3)
  // box smoothing (r = 2) against fur / grain / jpeg texture: only edges that survive the blur separate regions
  const tmpP = new Float32Array(w * h)
  const planeOut = new Float32Array(w * h)
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < w * h; i++) tmpP[i] = rgba[i * 4 + c]
    boxMean(tmpP, w, h, 2, planeOut)
    for (let i = 0; i < w * h; i++) lum[i * 3 + c] = planeOut[i]
  }
  let max = 1e-6
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const xl = Math.max(0, x - 1)
      const xr = Math.min(w - 1, x + 1)
      const yu = Math.max(0, y - 1)
      const yd = Math.min(h - 1, y + 1)
      let m = 0
      for (let c = 0; c < 3; c++) {
        const gx = lum[(y * w + xr) * 3 + c] - lum[(y * w + xl) * 3 + c]
        const gy = lum[(yd * w + x) * 3 + c] - lum[(yu * w + x) * 3 + c]
        m += gx * gx + gy * gy
      }
      g[y * w + x] = Math.sqrt(m)
      if (g[y * w + x] > max) max = g[y * w + x]
    }
  // normalise by a robust maximum (97th percentile of a sample) so a few extreme edges do not flatten the rest
  const sample: number[] = []
  const stride = Math.max(1, Math.floor(g.length / 4000))
  for (let i = 0; i < g.length; i += stride) sample.push(g[i])
  sample.sort((a, b) => a - b)
  const ref = Math.max(8, sample[Math.floor(sample.length * 0.97)] || max)
  for (let i = 0; i < g.length; i++) g[i] = Math.min(2, g[i] / ref)
  return g
}

/** Smoothed 3D colour histograms from the labelled pixels; returns P(object | colour) per pixel. */
function colourPosterior(rgba: Uint8ClampedArray, seeds: Uint8Array, n: number): Float32Array {
  const hist = [new Float32Array(BINS ** 3), new Float32Array(BINS ** 3)]
  const bin = (i: number): number => ((rgba[i * 4] >> 4) * BINS + (rgba[i * 4 + 1] >> 4)) * BINS + (rgba[i * 4 + 2] >> 4)
  const cnt = [0, 0]
  for (let i = 0; i < n; i++) {
    const s = seeds[i]
    if (!s) continue
    hist[s - 1][bin(i)] += 1
    cnt[s - 1]++
  }
  const smooth = (h: Float32Array): Float32Array => {
    // two passes of a separable [1 2 1] kernel over the colour cube
    let src = h
    for (let pass = 0; pass < 2; pass++) {
      for (const axis of [1, BINS, BINS * BINS]) {
        const dst = new Float32Array(src.length)
        for (let b = 0; b < src.length; b++) {
          const c = Math.floor(b / axis) % BINS
          let v = src[b] * 2
          if (c > 0) v += src[b - axis]
          if (c < BINS - 1) v += src[b + axis]
          dst[b] = v * 0.25
        }
        src = dst
      }
    }
    return src
  }
  const hf = smooth(hist[0])
  const hb = smooth(hist[1])
  const nf = Math.max(1, cnt[0])
  const nb = Math.max(1, cnt[1])
  const eps = 1e-4
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const b = bin(i)
    const pf = hf[b] / nf + eps
    const pb = hb[b] / nb + eps
    out[i] = pf / (pf + pb)
  }
  return out
}

const SQ2 = Math.SQRT2

/** Geodesic distance from the seed pixels (label === which) over the cost field, chamfer sweeps until stable. */
function geodesic(cost: Float32Array, seeds: Uint8Array, which: number, w: number, h: number, maxIter = 30): Float32Array {
  const n = w * h
  const d = new Float32Array(n).fill(1e9)
  for (let i = 0; i < n; i++) if (seeds[i] === which) d[i] = 0
  for (let it = 0; it < maxIter; it++) {
    let changed = 0
    // forward sweep
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        let best = d[i]
        const c = cost[i]
        if (x > 0) {
          const v = d[i - 1] + (c + cost[i - 1]) * 0.5
          if (v < best) best = v
        }
        if (y > 0) {
          const v = d[i - w] + (c + cost[i - w]) * 0.5
          if (v < best) best = v
          if (x > 0) {
            const v2 = d[i - w - 1] + (c + cost[i - w - 1]) * 0.5 * SQ2
            if (v2 < best) best = v2
          }
          if (x < w - 1) {
            const v3 = d[i - w + 1] + (c + cost[i - w + 1]) * 0.5 * SQ2
            if (v3 < best) best = v3
          }
        }
        if (best < d[i] - 1e-4) {
          d[i] = best
          changed++
        }
      }
    // backward sweep
    for (let y = h - 1; y >= 0; y--)
      for (let x = w - 1; x >= 0; x--) {
        const i = y * w + x
        let best = d[i]
        const c = cost[i]
        if (x < w - 1) {
          const v = d[i + 1] + (c + cost[i + 1]) * 0.5
          if (v < best) best = v
        }
        if (y < h - 1) {
          const v = d[i + w] + (c + cost[i + w]) * 0.5
          if (v < best) best = v
          if (x < w - 1) {
            const v2 = d[i + w + 1] + (c + cost[i + w + 1]) * 0.5 * SQ2
            if (v2 < best) best = v2
          }
          if (x > 0) {
            const v3 = d[i + w - 1] + (c + cost[i + w - 1]) * 0.5 * SQ2
            if (v3 < best) best = v3
          }
        }
        if (best < d[i] - 1e-4) {
          d[i] = best
          changed++
        }
      }
    if (changed < n * 0.0004) break
  }
  return d
}

/**
 * Segment. `rgba` is the working image (straight RGBA8, w*h), `seeds` the label plane from rasterizeSeeds.
 * Returns a signed field (> 0 object) on the same grid.
 */
export function brushSegment(rgba: Uint8ClampedArray, seeds: Uint8Array, w: number, h: number, o: BrushOpts = {}): Float32Array {
  const n = w * h
  const edgeK = o.edge ?? 3
  const colK = o.colour ?? 3
  const g = gradientMagnitude(rgba, w, h)
  let hasBg = false
  let hasFg = false
  for (let i = 0; i < n; i++) {
    if (seeds[i] === 2) hasBg = true
    else if (seeds[i] === 1) hasFg = true
  }
  if (!hasFg) return new Float32Array(n).fill(-1)
  let seedsUse = seeds
  let q = colourPosterior(rgba, seeds, n)
  if (!hasBg && o.autoBackground !== false) {
    // window border = background, except where the colour clearly belongs to the object
    const ring = 2
    const withBg = seeds.slice()
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (x >= ring && y >= ring && x < w - ring && y < h - ring) continue
        const i = y * w + x
        if (!withBg[i]) withBg[i] = 2
      }
    q = colourPosterior(rgba, withBg, n)
    for (let i = 0; i < n; i++) if (withBg[i] === 2 && seeds[i] === 0 && q[i] > 0.6) withBg[i] = 0
    seedsUse = withBg
    q = colourPosterior(rgba, withBg, n)
  }
  let field = finish(rgba, seedsUse, q, g, w, h, edgeK, colK)
  // GrabCut-style refinement: learn the colour models from everything that is already confidently labelled, grow again
  for (let it = 0; it < (o.iterations ?? 1); it++) {
    const aug = seedsUse.slice()
    for (let i = 0; i < n; i++) if (!aug[i]) aug[i] = field[i] > 0.45 ? 1 : field[i] < -0.45 ? 2 : 0
    q = colourPosterior(rgba, aug, n)
    field = finish(rgba, seedsUse, q, g, w, h, edgeK * 0.7, colK * 1.6)
  }
  return cleanField(field, seeds, w, h)
}

/** Morphological opening (drops thin leaks along seams / hairlines), then fills small holes and removes specks. */
export function cleanField(field: Float32Array, seeds: Uint8Array, w: number, h: number, r = 3): Float32Array {
  const n = w * h
  const inside = new Uint8Array(n)
  for (let i = 0; i < n; i++) inside[i] = field[i] > 0 || seeds[i] === 1 ? 1 : 0
  // opening = dilate(erode(inside, r), r)
  const outside = new Uint8Array(n)
  for (let i = 0; i < n; i++) outside[i] = inside[i] ? 0 : 1
  const dIn = distanceTo(outside, w, h) // distance to the nearest outside pixel
  const core = new Uint8Array(n)
  for (let i = 0; i < n; i++) core[i] = dIn[i] > r || seeds[i] === 1 ? 1 : 0
  const dCore = distanceTo(core, w, h)
  const keep = new Uint8Array(n)
  for (let i = 0; i < n; i++) keep[i] = inside[i] && dCore[i] <= r + 0.5 ? 1 : 0
  // components: small holes -> filled, small specks -> dropped
  const label = new Int32Array(n)
  const stack: number[] = []
  const visited: number[] = []
  const flood = (start: number, val: number, id: number): { size: number; border: boolean } => {
    visited.length = 0
    let size = 0
    let border = false
    stack.length = 0
    stack.push(start)
    label[start] = id
    while (stack.length) {
      const i = stack.pop()!
      visited.push(i)
      size++
      const x = i % w
      const y = (i / w) | 0
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true
      if (x > 0 && keep[i - 1] === val && !label[i - 1]) (label[i - 1] = id), stack.push(i - 1)
      if (x < w - 1 && keep[i + 1] === val && !label[i + 1]) (label[i + 1] = id), stack.push(i + 1)
      if (y > 0 && keep[i - w] === val && !label[i - w]) (label[i - w] = id), stack.push(i - w)
      if (y < h - 1 && keep[i + w] === val && !label[i + w]) (label[i + w] = id), stack.push(i + w)
    }
    return { size, border }
  }
  let id = 1
  const out = field.slice()
  const holeMax = Math.max(80, n * 0.003)
  const speckMax = Math.max(40, n * 0.0006)
  for (let i = 0; i < n; i++) {
    if (label[i]) continue
    const val = keep[i]
    const startId = id++
    const comp = flood(i, val, startId)
    if (val === 0 && !comp.border && comp.size < holeMax) {
      for (const k of visited) keep[k] = 1
    } else if (val === 1 && comp.size < speckMax) {
      for (const k of visited) if (seeds[k] !== 1) keep[k] = 0
    }
  }
  for (let i = 0; i < n; i++) out[i] = keep[i] ? Math.max(0.05, Math.abs(field[i])) : -Math.max(0.05, Math.abs(field[i]))
  return out
}

function finish(_rgba: Uint8ClampedArray, seeds: Uint8Array, q: Float32Array, g: Float32Array, w: number, h: number, edgeK: number, colK: number): Float32Array {
  const n = w * h
  const costF = new Float32Array(n)
  const costB = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const base = 0.04 + edgeK * g[i] * g[i]
    costF[i] = base + colK * (1 - q[i]) * (1 - q[i])
    costB[i] = base + colK * q[i] * q[i]
  }
  const dF = geodesic(costF, seeds, 1, w, h)
  const dB = geodesic(costB, seeds, 2, w, h)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const a = dF[i]
    const b = dB[i]
    out[i] = (b - a) / (a + b + 1e-3)
  }
  return out
}
