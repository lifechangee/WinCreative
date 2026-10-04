/** Pure math for adjustments (no DOM / GL): curves, gradients, colour balance, HSB. Mirrors the GLSL. */

export type CurvePt = [number, number]
export type RGB = [number, number, number]

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

// ------------------------------------------------------------------ curves (monotone cubic / Fritsch-Carlson)
export function sortCurve(pts: CurvePt[]): CurvePt[] {
  return [...pts].sort((a, b) => a[0] - b[0])
}

/** Build an evaluator f(x) for control points (x,y in 0..1). Monotone cubic Hermite, flat outside the ends. */
export function makeCurve(points: CurvePt[]): (x: number) => number {
  const p = sortCurve(points)
  const n = p.length
  if (n === 0) return (x) => x
  if (n === 1) return () => p[0][1]
  const dx: number[] = []
  const d: number[] = []
  for (let i = 0; i < n - 1; i++) {
    dx.push(Math.max(1e-6, p[i + 1][0] - p[i][0]))
    d.push((p[i + 1][1] - p[i][1]) / dx[i])
  }
  const m: number[] = new Array(n)
  m[0] = d[0]
  m[n - 1] = d[n - 2]
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0
      m[i + 1] = 0
    } else {
      const a = m[i] / d[i]
      const b = m[i + 1] / d[i]
      const s = a * a + b * b
      if (s > 9) {
        const t = 3 / Math.sqrt(s)
        m[i] = t * a * d[i]
        m[i + 1] = t * b * d[i]
      }
    }
  }
  return (x: number): number => {
    if (x <= p[0][0]) return p[0][1]
    if (x >= p[n - 1][0]) return p[n - 1][1]
    let lo = 0
    let hi = n - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (p[mid][0] <= x) lo = mid
      else hi = mid
    }
    const h = dx[lo]
    const t = (x - p[lo][0]) / h
    const t2 = t * t
    const t3 = t2 * t
    return (2 * t3 - 3 * t2 + 1) * p[lo][1] + (t3 - 2 * t2 + t) * h * m[lo] + (-2 * t3 + 3 * t2) * p[lo + 1][1] + (t3 - t2) * h * m[lo + 1]
  }
}

export interface CurveSet {
  /** master ("Gamma" in Procreate) */
  master: CurvePt[]
  r: CurvePt[]
  g: CurvePt[]
  b: CurvePt[]
}
export const identityCurve = (): CurvePt[] => [
  [0, 0],
  [1, 1]
]
export const defaultCurves = (): CurveSet => ({ master: identityCurve(), r: identityCurve(), g: identityCurve(), b: identityCurve() })
export const curveIsIdentity = (pts: CurvePt[]): boolean => {
  const f = makeCurve(pts)
  for (let i = 0; i <= 16; i++) if (Math.abs(f(i / 16) - i / 16) > 1e-4) return false
  return true
}

/** 256-entry RGBA8 lookup: out_c(x) = channelCurve_c(master(x)). */
export function bakeCurveLut(c: CurveSet, size = 256): Uint8Array {
  const fm = makeCurve(c.master)
  const fr = makeCurve(c.r)
  const fg = makeCurve(c.g)
  const fb = makeCurve(c.b)
  const out = new Uint8Array(size * 4)
  for (let i = 0; i < size; i++) {
    const m = clamp01(fm(i / (size - 1)))
    out[i * 4] = Math.round(clamp01(fr(m)) * 255)
    out[i * 4 + 1] = Math.round(clamp01(fg(m)) * 255)
    out[i * 4 + 2] = Math.round(clamp01(fb(m)) * 255)
    out[i * 4 + 3] = 255
  }
  return out
}

/** Histogram (256 bins) of straight RGBA8 pixels, alpha-weighted (skips transparent). */
export function histogram(px: ArrayLike<number>): { r: Uint32Array; g: Uint32Array; b: Uint32Array; l: Uint32Array } {
  const r = new Uint32Array(256)
  const g = new Uint32Array(256)
  const b = new Uint32Array(256)
  const l = new Uint32Array(256)
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 8) continue
    r[px[i]]++
    g[px[i + 1]]++
    b[px[i + 2]]++
    l[Math.round(px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11)]++
  }
  return { r, g, b, l }
}

// ------------------------------------------------------------------ gradients
export interface GradientStop {
  pos: number
  color: RGB
}

export function sortStops(stops: GradientStop[]): GradientStop[] {
  return [...stops].sort((a, b) => a.pos - b.pos)
}

export function sampleGradient(stops: GradientStop[], t: number): RGB {
  const s = sortStops(stops)
  if (!s.length) return [t, t, t]
  if (t <= s[0].pos) return [...s[0].color]
  if (t >= s[s.length - 1].pos) return [...s[s.length - 1].color]
  for (let i = 0; i < s.length - 1; i++) {
    if (t <= s[i + 1].pos) {
      const span = s[i + 1].pos - s[i].pos
      const k = span < 1e-6 ? 0 : (t - s[i].pos) / span
      return [0, 1, 2].map((c) => s[i].color[c] + (s[i + 1].color[c] - s[i].color[c]) * k) as RGB
    }
  }
  return [...s[s.length - 1].color]
}

export function bakeGradientLut(stops: GradientStop[], size = 256): Uint8Array {
  const out = new Uint8Array(size * 4)
  for (let i = 0; i < size; i++) {
    const c = sampleGradient(stops, i / (size - 1))
    out[i * 4] = Math.round(clamp01(c[0]) * 255)
    out[i * 4 + 1] = Math.round(clamp01(c[1]) * 255)
    out[i * 4 + 2] = Math.round(clamp01(c[2]) * 255)
    out[i * 4 + 3] = 255
  }
  return out
}

const hx = (h: string): RGB => {
  const n = parseInt(h.replace('#', ''), 16)
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}
const G = (name: string, ...s: [number, string][]): { name: string; stops: GradientStop[] } => ({ name, stops: s.map(([pos, c]) => ({ pos, color: hx(c) })) })

export const GRADIENT_LIBRARY: { name: string; stops: GradientStop[] }[] = [
  G('Black & White', [0, '#000000'], [1, '#ffffff']),
  G('Sepia', [0, '#1b0f05'], [0.5, '#8a6a45'], [1, '#f6e7c8']),
  G('Sunset', [0, '#1a0b2e'], [0.35, '#8b1e6e'], [0.65, '#f2542d'], [1, '#ffd86b']),
  G('Ocean', [0, '#02121f'], [0.4, '#0b5c8a'], [0.75, '#3fc1c9'], [1, '#f2fbff']),
  G('Fire', [0, '#000000'], [0.3, '#7a0a0a'], [0.6, '#ff6a00'], [0.85, '#ffd400'], [1, '#ffffff']),
  G('Neon', [0, '#0d0221'], [0.35, '#6b00ff'], [0.7, '#ff2ec4'], [1, '#00f0ff']),
  G('Forest', [0, '#06140a'], [0.5, '#2f7a3c'], [1, '#e8f5b8']),
  G('Rainbow', [0, '#ff0000'], [0.2, '#ffd000'], [0.4, '#22cc44'], [0.6, '#20c8e8'], [0.8, '#3a3aff'], [1, '#c020e0']),
  G('Duotone Teal-Orange', [0, '#0b3c49'], [1, '#ff9f4a']),
  G('Cyanotype', [0, '#001a33'], [0.6, '#1f6fa8'], [1, '#e6f3ff']),
  G('Rose Gold', [0, '#2b1216'], [0.5, '#c9827a'], [1, '#fff0e6']),
  G('Toxic', [0, '#0a0a0a'], [0.5, '#3dff5c'], [1, '#f6ff9e'])
]

// ------------------------------------------------------------------ colour balance
export interface BalanceParams {
  /** [cyan-red, magenta-green, yellow-blue] each -100..100 */
  sh: [number, number, number]
  mi: [number, number, number]
  hi: [number, number, number]
  preserve: boolean
}

const lum = (c: RGB): number => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11

export function balanceWeights(l: number): [number, number, number] {
  const ws = clamp01(1 - 2 * l)
  const wh = clamp01(2 * l - 1)
  return [ws, 1 - ws - wh, wh]
}

/** Straight (un-premultiplied) rgb in/out, matches the GLSL. */
export function colorBalance(c: RGB, p: BalanceParams): RGB {
  const l = lum(c)
  const [ws, wm, wh] = balanceWeights(l)
  const out: RGB = [0, 0, 0]
  for (let i = 0; i < 3; i++) out[i] = c[i] + ((ws * p.sh[i] + wm * p.mi[i] + wh * p.hi[i]) / 100) * 0.4
  if (p.preserve) {
    const dl = l - lum(out)
    for (let i = 0; i < 3; i++) out[i] += dl
  }
  return [clamp01(out[0]), clamp01(out[1]), clamp01(out[2])]
}

// ------------------------------------------------------------------ HSB
export function rgbToHsv(c: RGB): RGB {
  const [r, g, b] = c
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const d = mx - mn
  let h = 0
  if (d > 0) {
    if (mx === r) h = ((g - b) / d) % 6
    else if (mx === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h /= 6
    if (h < 0) h += 1
  }
  return [h, mx === 0 ? 0 : d / mx, mx]
}
export function hsvToRgb(c: RGB): RGB {
  const [h, s, v] = c
  const f = (n: number): number => {
    const k = (n + h * 6) % 6
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
  }
  return [f(5), f(3), f(1)]
}

/** hue/sat/bri are Procreate-style 0..100 with 50 = unchanged. */
export function hsbAdjust(c: RGB, hue: number, sat: number, bri: number): RGB {
  const hsv = rgbToHsv(c)
  hsv[0] = (((hsv[0] + (hue - 50) / 100) % 1) + 1) % 1
  hsv[1] = clamp01(hsv[1] * (sat / 50))
  const rgb = hsvToRgb(hsv)
  const t = (bri - 50) / 50
  return rgb.map((v) => clamp01(t >= 0 ? 1 - (1 - v) * (1 - t) : v * (1 + t))) as RGB
}

// ------------------------------------------------------------------ misc
/** Deterministic hash for CPU-side tests of shader-like behaviour. */
export const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

export function packColor(c: RGB): number {
  return (Math.round(c[0] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[2] * 255)
}
export function unpackColor(n: number): RGB {
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}
export const colorToHex = (n: number): string => '#' + (n & 0xffffff).toString(16).padStart(6, '0')
