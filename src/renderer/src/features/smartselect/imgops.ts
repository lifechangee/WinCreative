/** Pure image maths for Smart selection (no DOM / GL): resize, box / gaussian blur, guided filter, distance transform, edge shift. */

/** Resize straight RGBA8: area-average when shrinking, bilinear when enlarging (per axis decided by the scale). */
export function resizeRGBA(src: Uint8ClampedArray | Uint8Array, sw: number, sh: number, dw: number, dh: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dw * dh * 4)
  if (sw === dw && sh === dh) {
    out.set(src.subarray(0, dw * dh * 4))
    return out
  }
  // horizontal pass -> float rows, then vertical; premultiplied so transparent pixels do not bleed colour
  const tmp = new Float32Array(dw * sh * 4)
  const xs = dw / sw
  for (let y = 0; y < sh; y++) {
    const row = y * sw * 4
    for (let x = 0; x < dw; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      if (xs < 1) {
        const x0 = x / xs
        const x1 = (x + 1) / xs
        let wsum = 0
        for (let i = Math.floor(x0); i < Math.min(sw, Math.ceil(x1)); i++) {
          const wt = Math.min(i + 1, x1) - Math.max(i, x0)
          const p = row + i * 4
          const al = src[p + 3] * wt
          r += src[p] * al
          g += src[p + 1] * al
          b += src[p + 2] * al
          a += al
          wsum += wt
        }
        const o = (y * dw + x) * 4
        if (a > 0) {
          tmp[o] = r / a
          tmp[o + 1] = g / a
          tmp[o + 2] = b / a
          tmp[o + 3] = a / wsum
        }
      } else {
        const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) / xs - 0.5))
        const i0 = Math.floor(fx)
        const i1 = Math.min(sw - 1, i0 + 1)
        const f = fx - i0
        const p0 = row + i0 * 4
        const p1 = row + i1 * 4
        const a0 = src[p0 + 3] * (1 - f)
        const a1 = src[p1 + 3] * f
        const a = a0 + a1
        const o = (y * dw + x) * 4
        if (a > 0) {
          tmp[o] = (src[p0] * a0 + src[p1] * a1) / a
          tmp[o + 1] = (src[p0 + 1] * a0 + src[p1 + 1] * a1) / a
          tmp[o + 2] = (src[p0 + 2] * a0 + src[p1 + 2] * a1) / a
          tmp[o + 3] = a
        }
      }
    }
  }
  const ys = dh / sh
  for (let y = 0; y < dh; y++) {
    if (ys < 1) {
      const y0 = y / ys
      const y1 = (y + 1) / ys
      for (let x = 0; x < dw; x++) {
        let r = 0
        let g = 0
        let b = 0
        let a = 0
        let wsum = 0
        for (let j = Math.floor(y0); j < Math.min(sh, Math.ceil(y1)); j++) {
          const wt = Math.min(j + 1, y1) - Math.max(j, y0)
          const p = (j * dw + x) * 4
          const al = tmp[p + 3] * wt
          r += tmp[p] * al
          g += tmp[p + 1] * al
          b += tmp[p + 2] * al
          a += al
          wsum += wt
        }
        const o = (y * dw + x) * 4
        if (a > 0) {
          out[o] = r / a + 0.5
          out[o + 1] = g / a + 0.5
          out[o + 2] = b / a + 0.5
          out[o + 3] = (a / wsum) + 0.5
        }
      }
    } else {
      const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) / ys - 0.5))
      const j0 = Math.floor(fy)
      const j1 = Math.min(sh - 1, j0 + 1)
      const f = fy - j0
      for (let x = 0; x < dw; x++) {
        const p0 = (j0 * dw + x) * 4
        const p1 = (j1 * dw + x) * 4
        const a0 = tmp[p0 + 3] * (1 - f)
        const a1 = tmp[p1 + 3] * f
        const a = a0 + a1
        const o = (y * dw + x) * 4
        if (a > 0) {
          out[o] = (tmp[p0] * a0 + tmp[p1] * a1) / a + 0.5
          out[o + 1] = (tmp[p0 + 1] * a0 + tmp[p1 + 1] * a1) / a + 0.5
          out[o + 2] = (tmp[p0 + 2] * a0 + tmp[p1 + 2] * a1) / a + 0.5
          out[o + 3] = a + 0.5
        }
      }
    }
  }
  return out
}

/** Resize a float plane with bilinear sampling (shrinking uses a box prefilter). */
export function resizePlane(src: Float32Array, sw: number, sh: number, dw: number, dh: number): Float32Array {
  const out = new Float32Array(dw * dh)
  const kx = sw / dw
  const ky = sh / dh
  if (kx > 1 || ky > 1) {
    for (let y = 0; y < dh; y++) {
      const y0 = Math.floor(y * ky)
      const y1 = Math.max(y0 + 1, Math.min(sh, Math.ceil((y + 1) * ky)))
      for (let x = 0; x < dw; x++) {
        const x0 = Math.floor(x * kx)
        const x1 = Math.max(x0 + 1, Math.min(sw, Math.ceil((x + 1) * kx)))
        let s = 0
        for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) s += src[j * sw + i]
        out[y * dw + x] = s / ((y1 - y0) * (x1 - x0))
      }
    }
    return out
  }
  for (let y = 0; y < dh; y++) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) * ky - 0.5))
    const j0 = Math.floor(fy)
    const j1 = Math.min(sh - 1, j0 + 1)
    const wy = fy - j0
    for (let x = 0; x < dw; x++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) * kx - 0.5))
      const i0 = Math.floor(fx)
      const i1 = Math.min(sw - 1, i0 + 1)
      const wx = fx - i0
      out[y * dw + x] = (src[j0 * sw + i0] * (1 - wx) + src[j0 * sw + i1] * wx) * (1 - wy) + (src[j1 * sw + i0] * (1 - wx) + src[j1 * sw + i1] * wx) * wy
    }
  }
  return out
}

/** Mean over a (2r+1)^2 window (clipped at the borders, normalised by the real window size). */
export function boxMean(src: Float32Array, w: number, h: number, r: number, dst: Float32Array = new Float32Array(w * h), tmp: Float32Array = new Float32Array(w * h)): Float32Array {
  if (r <= 0) {
    dst.set(src)
    return dst
  }
  for (let y = 0; y < h; y++) {
    const o = y * w
    let s = 0
    const lim = Math.min(r, w - 1)
    for (let x = 0; x <= lim; x++) s += src[o + x]
    for (let x = 0; x < w; x++) {
      const lo = Math.max(0, x - r)
      const hi = Math.min(w - 1, x + r)
      tmp[o + x] = s / (hi - lo + 1)
      if (x + r + 1 < w) s += src[o + x + r + 1]
      if (x - r >= 0) s -= src[o + x - r]
    }
  }
  const col = new Float32Array(h)
  for (let x = 0; x < w; x++) {
    let s = 0
    const lim = Math.min(r, h - 1)
    for (let y = 0; y <= lim; y++) s += tmp[y * w + x]
    for (let y = 0; y < h; y++) {
      const lo = Math.max(0, y - r)
      const hi = Math.min(h - 1, y + r)
      col[y] = s / (hi - lo + 1)
      if (y + r + 1 < h) s += tmp[(y + r + 1) * w + x]
      if (y - r >= 0) s -= tmp[(y - r) * w + x]
    }
    for (let y = 0; y < h; y++) dst[y * w + x] = col[y]
  }
  return dst
}

/** Gaussian blur approximated by three box passes (in place on a copy). */
export function gaussBlur(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma < 0.3) return src.slice()
  // box sizes for a 3-pass approximation (Kovesi)
  const n = 3
  const wl = Math.floor(Math.sqrt((12 * sigma * sigma) / n + 1))
  const wIdeal = wl % 2 === 0 ? wl - 1 : wl
  const wu = wIdeal + 2
  const m = Math.round((12 * sigma * sigma - n * wIdeal * wIdeal - 4 * n * wIdeal - 3 * n) / (-4 * wIdeal - 4))
  let a = src.slice()
  let b = new Float32Array(w * h)
  const tmp = new Float32Array(w * h)
  for (let i = 0; i < n; i++) {
    const size = i < m ? wIdeal : wu
    boxMean(a, w, h, (size - 1) >> 1, b, tmp)
    ;[a, b] = [b, a]
  }
  return a
}

/**
 * Colour guided filter (He et al.), optionally on a sub-sampled grid ("fast guided filter").
 * guide: interleaved RGBA8 (straight), p: float plane 0..1. radius in pixels. eps relative to guide in 0..1.
 */
export function guidedFilter(guide: Uint8ClampedArray, p: Float32Array, w: number, h: number, radius: number, eps: number, sub = 1): Float32Array {
  const s = Math.max(1, Math.floor(sub))
  const gw = Math.max(1, Math.ceil(w / s))
  const gh = Math.max(1, Math.ceil(h / s))
  const n = gw * gh
  const I = [new Float32Array(n), new Float32Array(n), new Float32Array(n)]
  const P = new Float32Array(n)
  // sub-sample by averaging
  if (s === 1) {
    for (let i = 0; i < n; i++) {
      I[0][i] = guide[i * 4] / 255
      I[1][i] = guide[i * 4 + 1] / 255
      I[2][i] = guide[i * 4 + 2] / 255
      P[i] = p[i]
    }
  } else {
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; x++) {
        let r = 0
        let g = 0
        let b = 0
        let q = 0
        let c = 0
        for (let j = y * s; j < Math.min(h, y * s + s); j++)
          for (let i = x * s; i < Math.min(w, x * s + s); i++) {
            const k = j * w + i
            r += guide[k * 4]
            g += guide[k * 4 + 1]
            b += guide[k * 4 + 2]
            q += p[k]
            c++
          }
        const o = y * gw + x
        I[0][o] = r / c / 255
        I[1][o] = g / c / 255
        I[2][o] = b / c / 255
        P[o] = q / c
      }
  }
  const r = Math.max(1, Math.round(radius / s))
  const tmp = new Float32Array(n)
  const bm = (a: Float32Array): Float32Array => boxMean(a, gw, gh, r, new Float32Array(n), tmp)
  const mI = I.map(bm)
  const mP = bm(P)
  const prod = new Float32Array(n)
  const mulBm = (a: Float32Array, b: Float32Array): Float32Array => {
    for (let i = 0; i < n; i++) prod[i] = a[i] * b[i]
    return bm(prod)
  }
  const cIP = I.map((c) => mulBm(c, P))
  const sRR = mulBm(I[0], I[0])
  const sRG = mulBm(I[0], I[1])
  const sRB = mulBm(I[0], I[2])
  const sGG = mulBm(I[1], I[1])
  const sGB = mulBm(I[1], I[2])
  const sBB = mulBm(I[2], I[2])
  const a0 = new Float32Array(n)
  const a1 = new Float32Array(n)
  const a2 = new Float32Array(n)
  const bb = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const m0 = mI[0][i]
    const m1 = mI[1][i]
    const m2 = mI[2][i]
    const rr = sRR[i] - m0 * m0 + eps
    const rg = sRG[i] - m0 * m1
    const rb = sRB[i] - m0 * m2
    const gg = sGG[i] - m1 * m1 + eps
    const gb = sGB[i] - m1 * m2
    const bb2 = sBB[i] - m2 * m2 + eps
    const c0 = cIP[0][i] - m0 * mP[i]
    const c1 = cIP[1][i] - m1 * mP[i]
    const c2 = cIP[2][i] - m2 * mP[i]
    // inverse of symmetric 3x3 [[rr rg rb][rg gg gb][rb gb bb2]]
    const i00 = gg * bb2 - gb * gb
    const i01 = rb * gb - rg * bb2
    const i02 = rg * gb - rb * gg
    const i11 = rr * bb2 - rb * rb
    const i12 = rb * rg - rr * gb
    const i22 = rr * gg - rg * rg
    const det = rr * i00 + rg * i01 + rb * i02
    const inv = Math.abs(det) > 1e-18 ? 1 / det : 0
    const A0 = (i00 * c0 + i01 * c1 + i02 * c2) * inv
    const A1 = (i01 * c0 + i11 * c1 + i12 * c2) * inv
    const A2 = (i02 * c0 + i12 * c1 + i22 * c2) * inv
    a0[i] = A0
    a1[i] = A1
    a2[i] = A2
    bb[i] = mP[i] - A0 * m0 - A1 * m1 - A2 * m2
  }
  const ma0 = bm(a0)
  const ma1 = bm(a1)
  const ma2 = bm(a2)
  const mb = bm(bb)
  const out = new Float32Array(w * h)
  if (s === 1) {
    for (let i = 0; i < n; i++) out[i] = ma0[i] * (guide[i * 4] / 255) + ma1[i] * (guide[i * 4 + 1] / 255) + ma2[i] * (guide[i * 4 + 2] / 255) + mb[i]
    return out
  }
  // bilinear upsample of the coefficients to full res, then apply with the full-res guide
  const up = (c: Float32Array): Float32Array => resizePlane(c, gw, gh, w, h)
  const ua0 = up(ma0)
  const ua1 = up(ma1)
  const ua2 = up(ma2)
  const ub = up(mb)
  for (let i = 0; i < w * h; i++) out[i] = ua0[i] * (guide[i * 4] / 255) + ua1[i] * (guide[i * 4 + 1] / 255) + ua2[i] * (guide[i * 4 + 2] / 255) + ub[i]
  return out
}

// ---------------------------------------------------------------- Euclidean distance transform (Felzenszwalb & Huttenlocher)
const INF = 1e20

function edt1d(f: Float32Array, n: number, d: Float32Array, v: Int32Array, z: Float32Array): void {
  let k = 0
  v[0] = 0
  z[0] = -INF
  z[1] = INF
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    while (s <= z[k]) {
      k--
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = INF
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]
  }
}

/** Distance (px) from every pixel to the nearest pixel where `target[i]` is true. Pixels in the target get 0. */
export function distanceTo(target: Uint8Array, w: number, h: number): Float32Array {
  const g = new Float32Array(w * h)
  for (let i = 0; i < g.length; i++) g[i] = target[i] ? 0 : INF
  const m = Math.max(w, h)
  const f = new Float32Array(m)
  const d = new Float32Array(m)
  const v = new Int32Array(m)
  const z = new Float32Array(m + 1)
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = g[y * w + x]
    edt1d(f, h, d, v, z)
    for (let y = 0; y < h; y++) g[y * w + x] = d[y]
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = g[y * w + x]
    edt1d(f, w, d, v, z)
    for (let x = 0; x < w; x++) g[y * w + x] = Math.sqrt(d[x])
  }
  return g
}

/** Signed distance to the 0.5 contour of `alpha`: positive inside, negative outside, 0.5px accuracy. */
export function signedDistance(inside: Uint8Array, w: number, h: number): Float32Array {
  const n = w * h
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) out[i] = inside[i] ? 0 : 1
  const dIn = distanceTo(out, w, h) // distance to nearest OUTSIDE pixel (for inside pixels)
  for (let i = 0; i < n; i++) out[i] = inside[i] ? 1 : 0
  const dOut = distanceTo(out, w, h)
  const s = new Float32Array(n)
  for (let i = 0; i < n; i++) s[i] = inside[i] ? dIn[i] - 0.5 : -(dOut[i] - 0.5)
  return s
}

/**
 * Move the edge of a soft alpha by `shift` px (>0 expands, <0 contracts) keeping its soft detail:
 * pixels beyond the old edge are raised (expand) or lowered (contract) with a 1px anti-aliased ramp.
 */
export function shiftEdge(alpha: Float32Array, w: number, h: number, shift: number): Float32Array {
  if (Math.abs(shift) < 0.01) return alpha
  const n = w * h
  const inside = new Uint8Array(n)
  for (let i = 0; i < n; i++) inside[i] = alpha[i] >= 0.5 ? 1 : 0
  const sd = signedDistance(inside, w, h)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    // signed distance after the move: edge at sd == shift  ->  coverage ramp around that line
    const c = Math.min(1, Math.max(0, 0.5 + (sd[i] + shift)))
    out[i] = shift > 0 ? Math.max(alpha[i], c) : Math.min(alpha[i], c)
  }
  return out
}

/**
 * Colour decontamination for cut-outs: for partially transparent pixels, replace the colour by the colour of the nearby
 * (almost) opaque object pixels (normalised box convolution), which removes the background fringe.
 * rgba is modified in place; alpha stays as given in `alpha` (0..1 plane), written to channel 3 by the caller.
 */
export function decontaminate(rgba: Uint8ClampedArray, alpha: Float32Array, w: number, h: number, radius: number): void {
  const n = w * h
  const r = Math.max(1, Math.round(radius))
  const wt = new Float32Array(n)
  const cr = new Float32Array(n)
  const cg = new Float32Array(n)
  const cb = new Float32Array(n)
  let any = false
  for (let i = 0; i < n; i++) {
    const a = alpha[i]
    if (a > 0 && a < 0.995) any = true
    const k = a >= 0.98 ? 1 : 0
    wt[i] = k
    cr[i] = rgba[i * 4] * k
    cg[i] = rgba[i * 4 + 1] * k
    cb[i] = rgba[i * 4 + 2] * k
  }
  if (!any) return
  const tmp = new Float32Array(n)
  const mw = boxMean(wt, w, h, r, new Float32Array(n), tmp)
  const mr = boxMean(cr, w, h, r, new Float32Array(n), tmp)
  const mg = boxMean(cg, w, h, r, new Float32Array(n), tmp)
  const mb = boxMean(cb, w, h, r, new Float32Array(n), tmp)
  for (let i = 0; i < n; i++) {
    const a = alpha[i]
    if (a <= 0 || a >= 0.995) continue
    const d = mw[i]
    if (d < 0.02) continue // no opaque neighbours: keep the original colour
    rgba[i * 4] = mr[i] / d + 0.5
    rgba[i * 4 + 1] = mg[i] / d + 0.5
    rgba[i * 4 + 2] = mb[i] / d + 0.5
  }
}

/** Intersection over union of two coverage planes thresholded at 0.5. */
export function iou(a: ArrayLike<number>, b: ArrayLike<number>, thr = 0.5): number {
  let i = 0
  let u = 0
  for (let k = 0; k < a.length; k++) {
    const x = a[k] >= thr
    const y = b[k] >= thr
    if (x && y) i++
    if (x || y) u++
  }
  return u ? i / u : 1
}
