/** Deterministic synthetic test images with ground-truth masks (used by unit tests, the self-test and QA scripts). */

export interface SynthScene {
  w: number
  h: number
  rgba: Uint8ClampedArray
  /** ground truth coverage 0..1 of the main object */
  gt: Float32Array
  /** object centre (document coords) for click tests */
  cx: number
  cy: number
}

function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** value noise 0..1 */
function noise(w: number, h: number, cell: number, seed: number): Float32Array {
  const r = rng(seed)
  const gw = Math.ceil(w / cell) + 2
  const gh = Math.ceil(h / cell) + 2
  const g = new Float32Array(gw * gh)
  for (let i = 0; i < g.length; i++) g[i] = r()
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const fx = x / cell
      const fy = y / cell
      const i = Math.floor(fx)
      const j = Math.floor(fy)
      const a = fx - i
      const b = fy - j
      const sa = a * a * (3 - 2 * a)
      const sb = b * b * (3 - 2 * b)
      out[y * w + x] = (g[j * gw + i] * (1 - sa) + g[j * gw + i + 1] * sa) * (1 - sb) + (g[(j + 1) * gw + i] * (1 - sa) + g[(j + 1) * gw + i + 1] * sa) * sb
    }
  return out
}

export type SynthKind = 'clean' | 'textured' | 'lowContrast' | 'hair'

/**
 * Object on a background. kind:
 *  clean       - saturated ellipse-ish blob on a smooth gradient
 *  textured    - same blob over a busy multi-scale texture
 *  lowContrast - object colour close to the background
 *  hair        - blob with thin radial strands (soft, partly transparent edge)
 */
export function makeScene(kind: SynthKind, w = 640, h = 480, seed = 7): SynthScene {
  const rgba = new Uint8ClampedArray(w * h * 4)
  const gt = new Float32Array(w * h)
  const cx = w * 0.5
  const cy = h * 0.52
  const rx = w * 0.26
  const ry = h * 0.3
  const n1 = noise(w, h, 40, seed)
  const n2 = noise(w, h, 9, seed + 1)
  const n3 = noise(w, h, 3, seed + 2)
  const wob = noise(w, h, 70, seed + 3)
  const r = rng(seed + 9)
  const strands: { a: number; len: number; wd: number }[] = []
  if (kind === 'hair') for (let i = 0; i < 90; i++) strands.push({ a: r() * Math.PI * 2, len: 0.12 + r() * 0.25, wd: 0.8 + r() * 1.2 })
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      // background
      let br = 60 + 90 * (x / w)
      let bg = 110 + 40 * (y / h)
      let bb = 150 - 60 * (x / w)
      if (kind === 'textured' || kind === 'hair') {
        const t = (n1[i] - 0.5) * 70 + (n2[i] - 0.5) * 60 + (n3[i] - 0.5) * 40
        br += t
        bg += t * 0.8
        bb += t * 0.6
      }
      // object signed distance (blob with wobbly boundary)
      const dx = (x + 0.5 - cx) / rx
      const dy = (y + 0.5 - cy) / ry
      const rad = Math.hypot(dx, dy)
      const wobble = 1 + (wob[i] - 0.5) * 0.18
      const sd = (1 - rad / wobble) * Math.min(rx, ry) * wobble
      let cov = Math.min(1, Math.max(0, 0.5 + sd))
      let or = 215
      let og = 70
      let ob = 60
      if (kind === 'lowContrast') {
        or = br + 26
        og = bg - 22
        ob = bb + 20
      } else {
        const sh = (n2[i] - 0.5) * 36 + (1 - rad) * 30
        or += sh
        og += sh * 0.6
        ob += sh * 0.5
      }
      let strandCov = 0
      for (const s of strands) {
        // distance of the pixel to a radial segment starting at the blob border
        const ax = cx + Math.cos(s.a) * rx * 0.98
        const ay = cy + Math.sin(s.a) * ry * 0.98
        const ex = ax + Math.cos(s.a) * rx * s.len * 1.6
        const ey = ay + Math.sin(s.a) * ry * s.len * 1.6
        const vx = ex - ax
        const vy = ey - ay
        const t = Math.max(0, Math.min(1, ((x + 0.5 - ax) * vx + (y + 0.5 - ay) * vy) / (vx * vx + vy * vy)))
        const d = Math.hypot(x + 0.5 - (ax + vx * t), y + 0.5 - (ay + vy * t))
        const c = Math.min(1, Math.max(0, 0.5 + (s.wd * (1 - 0.6 * t)) / 2 - d)) * (1 - 0.45 * t)
        if (c > strandCov) strandCov = c
      }
      if (strandCov > cov) cov = strandCov
      gt[i] = cov
      const o = i * 4
      rgba[o] = br * (1 - cov) + or * cov
      rgba[o + 1] = bg * (1 - cov) + og * cov
      rgba[o + 2] = bb * (1 - cov) + ob * cov
      rgba[o + 3] = 255
    }
  }
  return { w, h, rgba, gt, cx, cy }
}

/**
 * Simulate what a SAM decoder hands back: logits on the 256 grid of a 1024 frame (aspect kept, top-left aligned) derived from the
 * ground truth with a few cells of boundary error, so refinement can be tested without a model.
 */
export function fakeLogits(s: SynthScene, errCells = 1.2, seed = 3): Float32Array {
  const L = 256
  const k = 1024 / Math.max(s.w, s.h) // doc px -> frame px
  const out = new Float32Array(L * L)
  const nz = noise(L, L, 6, seed)
  for (let v = 0; v < L; v++)
    for (let u = 0; u < L; u++) {
      // centre of the low-res cell in doc px
      const dx = ((u + 0.5) * 4) / k
      const dy = ((v + 0.5) * 4) / k
      if (dx >= s.w || dy >= s.h) {
        out[v * L + u] = -10
        continue
      }
      // average coverage in the cell footprint (box of 4/k px)
      const half = 2 / k
      let sum = 0
      let c = 0
      for (let yy = Math.floor(dy - half); yy <= Math.floor(dy + half); yy++)
        for (let xx = Math.floor(dx - half); xx <= Math.floor(dx + half); xx++) {
          if (xx < 0 || yy < 0 || xx >= s.w || yy >= s.h) continue
          sum += s.gt[yy * s.w + xx]
          c++
        }
      const cov = c ? sum / c : 0
      out[v * L + u] = (cov - 0.5) * 8 + (nz[v * L + u] - 0.5) * errCells * 6
    }
  return out
}
