/**
 * Procedural brush textures (tips + grains), generated lazily on the CPU as 8-bit single channel maps.
 * Register more via registerTexture() (e.g. decoded from images by the brush importers / Brush Studio).
 * Tips: 255 = full paint, edges are zero. Grains: tileable, 255 = paint passes, low = tooth blocks paint.
 */
export interface BrushTexture {
  id: string
  kind: 'tip' | 'grain'
  size: number
  /** size*size bytes, 255 = full paint */
  data: Uint8Array
  /** display name */
  name?: string
  /** true for procedural built-ins (not stored in the user library) */
  builtin?: boolean
  /** bumped when data is edited in place so GPU caches refresh */
  rev?: number
}

interface Lazy extends Omit<BrushTexture, 'data'> {
  gen: () => Uint8Array
  cache?: Uint8Array
}

const registry = new Map<string, BrushTexture>()

/** Register a texture whose pixels are computed on first access. */
export function registerLazyTexture(t: Lazy): void {
  const o = { ...t } as Lazy & { data?: Uint8Array }
  Object.defineProperty(o, 'data', {
    enumerable: true,
    get: () => (o.cache ??= o.gen())
  })
  registry.set(t.id, o as unknown as BrushTexture)
}

export const registerTexture = (t: BrushTexture): void => void registry.set(t.id, t)
export const getTextureDef = (id: string): BrushTexture | undefined => registry.get(id)
export const listTextures = (kind?: 'tip' | 'grain'): BrushTexture[] => [...registry.values()].filter((t) => !kind || t.kind === kind)
export const removeTexture = (id: string): void => void registry.delete(id)

function hash(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967295
}

/** Tileable value noise on a period-`period` lattice. */
function noise(x: number, y: number, period: number, seed: number): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const m = (v: number): number => ((v % period) + period) % period
  const a = hash(m(x0), m(y0), seed)
  const b = hash(m(x0 + 1), m(y0), seed)
  const c = hash(m(x0), m(y0 + 1), seed)
  const d = hash(m(x0 + 1), m(y0 + 1), seed)
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}

function fbm(x: number, y: number, size: number, base: number, oct: number, seed: number): number {
  let sum = 0
  let amp = 1
  let norm = 0
  let f = base
  for (let i = 0; i < oct; i++) {
    sum += amp * noise((x / size) * f, (y / size) * f, f, seed + i * 17)
    norm += amp
    amp *= 0.5
    f *= 2
  }
  return sum / norm
}

const smooth = (a: number, b: number, v: number): number => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

function make(size: number, fn: (x: number, y: number, u: number, v: number) => number): Uint8Array {
  const d = new Uint8Array(size * size)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) d[y * size + x] = Math.round(Math.max(0, Math.min(1, fn(x, y, x / size, y / size))) * 255)
  return d
}

const G = 256
const T = 128
const grain = (id: string, name: string, fn: (x: number, y: number, u: number, v: number) => number, size = G): void =>
  registerLazyTexture({ id, name, kind: 'grain', size, builtin: true, gen: () => make(size, fn) })
const tip = (id: string, name: string, fn: (x: number, y: number, u: number, v: number) => number, size = T): void =>
  registerLazyTexture({ id, name, kind: 'tip', size, builtin: true, gen: () => make(size, fn) })

/** radial distance 0 (centre) .. 1 (edge of the tip square) */
const rad = (u: number, v: number): number => Math.hypot(u - 0.5, v - 0.5) * 2

export function generateDefaultTextures(): void {
  if (registry.size) return
  // ---------------------------------------------------------------- grains
  grain('grain-paper', 'Paper', (x, y) => 0.25 + 0.75 * smooth(0.3, 0.75, fbm(x, y, G, 16, 4, 3)))
  grain('grain-pencil', 'Pencil tooth', (x, y) => smooth(0.18, 0.62, fbm(x, y, G, 64, 2, 9) * 0.6 + hash(x, y, 5) * 0.55))
  grain('grain-canvas', 'Canvas', (x, y) => {
    const wx = 0.5 + 0.5 * Math.sin((x / G) * Math.PI * 2 * 32)
    const wy = 0.5 + 0.5 * Math.sin((y / G) * Math.PI * 2 * 32)
    return 0.35 + 0.65 * smooth(0.15, 0.85, 0.5 * (wx * 0.6 + wy * 0.6) + 0.5 * fbm(x, y, G, 32, 3, 21))
  })
  grain('grain-rough', 'Rough paper', (x, y) => 0.15 + 0.85 * smooth(0.35, 0.7, fbm(x, y, G, 8, 5, 41)))
  grain('grain-watercolor', 'Cold press', (x, y) => 0.3 + 0.7 * smooth(0.25, 0.8, fbm(x, y, G, 24, 4, 61) * 0.8 + hash(x >> 1, y >> 1, 4) * 0.2))
  grain('grain-linen', 'Linen', (x, y) => {
    const a = 0.5 + 0.5 * Math.sin((x / G) * Math.PI * 2 * 48 + fbm(x, y, G, 8, 2, 3) * 3)
    const b = 0.5 + 0.5 * Math.sin((y / G) * Math.PI * 2 * 48 + fbm(x, y, G, 8, 2, 5) * 3)
    return 0.3 + 0.7 * smooth(0.2, 0.9, a * b * 0.5 + 0.5 * Math.max(a, b) * 0.7)
  })
  grain('grain-sand', 'Sand', (x, y) => smooth(0.1, 0.7, hash(x, y, 91) * 0.8 + fbm(x, y, G, 32, 2, 7) * 0.4))
  grain('grain-noise', 'Fine noise', (x, y) => 0.4 + 0.6 * hash(x, y, 17))
  grain('grain-charcoal', 'Charcoal paper', (x, y) => smooth(0.2, 0.75, fbm(x, y, G, 96, 2, 71) * 0.7 + hash(x, y, 3) * 0.5))
  grain('grain-concrete', 'Concrete', (x, y) => 0.2 + 0.8 * smooth(0.3, 0.8, fbm(x, y, G, 6, 5, 13) * 0.6 + fbm(x, y, G, 64, 2, 19) * 0.5))
  grain('grain-halftone', 'Halftone', (x, y) => {
    const s = 16
    const fx = (x % s) - s / 2
    const fy = (y % s) - s / 2
    return 1 - smooth(s * 0.28, s * 0.36, Math.hypot(fx + 0.5, fy + 0.5))
  })
  grain('grain-hatch', 'Hatching', (x, y) => 0.25 + 0.75 * smooth(0.35, 0.65, 0.5 + 0.5 * Math.sin(((x + y) / G) * Math.PI * 2 * 24)))
  grain('grain-wood', 'Wood', (x, y) => 0.3 + 0.7 * smooth(0.25, 0.8, 0.5 + 0.35 * Math.sin((y / G) * Math.PI * 2 * 22 + fbm(x, y, G, 4, 3, 2) * 6) + 0.25 * (fbm(x, y, G, 32, 2, 8) - 0.5)))
  grain('grain-stipple', 'Stipple', (x, y) => 1 - smooth(0.62, 0.8, hash(Math.floor(x / 2), Math.floor(y / 2), 77)))
  grain('grain-bubbles', 'Bubbles', (x, y) => {
    const s = 32
    const cx = Math.floor(x / s)
    const cy = Math.floor(y / s)
    const ox = hash(cx, cy, 1) * s * 0.5 + s * 0.25
    const oy = hash(cx, cy, 2) * s * 0.5 + s * 0.25
    const rr = 5 + hash(cx, cy, 3) * 8
    const d = Math.hypot((x % s) - ox, (y % s) - oy)
    return 0.35 + 0.65 * smooth(rr - 1, rr + 1, d)
  })
  // ---------------------------------------------------------------- tips (edges are zero)
  tip('tip-chalk', 'Chalk', (x, y, u, v) => {
    const r = rad(u, v)
    const n = fbm(x, y, T, 8, 4, 33)
    const body = 1 - smooth(0.55 + (n - 0.5) * 0.5, 0.95 + (n - 0.5) * 0.3, r)
    return body * smooth(0.25, 0.6, n * 0.7 + hash(x, y, 77) * 0.45)
  })
  tip('tip-blot', 'Blot', (x, y, u, v) => 1 - smooth(0.5 + (fbm(x, y, T, 4, 4, 51) - 0.5) * 0.7, 0.98, rad(u, v)))
  tip('tip-bristle', 'Bristles', (x, y, u, v) => {
    const line = 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * 9 + fbm(x, y, T, 4, 2, 8) * 5)
    const streak = smooth(0.25, 0.7, line * 0.7 + hash(Math.floor(x / 2), 0, 12) * 0.5)
    return (1 - smooth(0.7, 0.98, rad(u, v))) * streak
  })
  tip('tip-charcoal', 'Charcoal', (x, y, u, v) => {
    const r = rad(u, v)
    const n = fbm(x, y, T, 10, 4, 5)
    return (1 - smooth(0.5 + (n - 0.5) * 0.6, 0.97, r)) * smooth(0.2, 0.55, n * 0.55 + hash(x, y, 21) * 0.6)
  })
  tip('tip-splatter', 'Splatter', (x, y, u, v) => {
    const r = rad(u, v)
    let a = 0
    for (let i = 0; i < 14; i++) {
      const px = 0.15 + hash(i, 1, 9) * 0.7
      const py = 0.15 + hash(i, 2, 9) * 0.7
      const rr = 0.02 + hash(i, 3, 9) * 0.07 * (1 - Math.hypot(px - 0.5, py - 0.5))
      a = Math.max(a, 1 - smooth(rr * 0.6, rr, Math.hypot(u - px, v - py)))
    }
    return a * (1 - smooth(0.85, 0.98, r))
  })
  tip('tip-dry', 'Dry brush', (x, y, u, v) => {
    const line = fbm(x * 0.15, y * 6, T, 3, 2, 5)
    const s = smooth(0.35, 0.65, line + (hash(Math.floor(x / 2), Math.floor(y / 6), 3) - 0.5) * 0.5)
    return s * (1 - smooth(0.6, 0.97, rad(u, v)))
  })
  tip('tip-sponge', 'Sponge', (x, y, u, v) => (1 - smooth(0.6, 0.97, rad(u, v))) * smooth(0.35, 0.55, fbm(x, y, T, 12, 3, 44)))
  tip('tip-stipple', 'Stipple', (x, y, u, v) => (1 - smooth(0.7, 0.98, rad(u, v))) * (1 - smooth(0.4, 0.55, hash(Math.floor(x / 2), Math.floor(y / 2), 8))))
  tip('tip-spray', 'Spray dots', (x, y, u, v) => (1 - smooth(0.6, 0.98, rad(u, v))) * (hash(x, y, 31) > 0.72 ? 1 : 0))
  tip('tip-leaf', 'Leaf', (x, y, u, v) => {
    const dx = (u - 0.5) * 2
    const dy = (v - 0.5) * 2
    const w = Math.max(0, 1 - Math.pow(Math.abs(dy) / (0.2 + 0.8 * Math.sin(Math.PI * Math.min(1, Math.max(0, (dx + 1) / 2)))), 1.6))
    const vein = 1 - 0.45 * smooth(0.06, 0, Math.abs(dy))
    return w * vein * (1 - smooth(0.9, 0.99, Math.abs(dx)))
  })
  tip('tip-star', 'Star', (x, y, u, v) => {
    const dx = (u - 0.5) * 2
    const dy = (v - 0.5) * 2
    const r = Math.hypot(dx, dy)
    const a = Math.atan2(dy, dx)
    const k = 0.45 + 0.5 * Math.pow(Math.abs(Math.cos(a * 2.5)), 2.2)
    return 1 - smooth(k - 0.05, k + 0.02, r)
  })
  tip('tip-grass', 'Grass', (x, y, u, v) => {
    let a = 0
    for (let i = 0; i < 9; i++) {
      const bx = 0.12 + (i / 8) * 0.76
      const lean = (hash(i, 4, 6) - 0.5) * 0.35
      const h = 0.55 + hash(i, 5, 6) * 0.4
      const t = (1 - v) / h
      if (t < 0 || t > 1) continue
      const cx = bx + lean * t * t
      a = Math.max(a, 1 - smooth(0.005, 0.02 * (1 - t) + 0.006, Math.abs(u - cx)))
    }
    return a
  })
  tip('tip-hair', 'Fine hair', (x, y, u, v) => {
    let a = 0
    for (let i = 0; i < 24; i++) {
      const cx = 0.5 + (hash(i, 1, 4) - 0.5) * 0.8
      const ph = hash(i, 2, 4) * 6
      const px = cx + Math.sin(v * 3 + ph) * 0.05
      a = Math.max(a, (1 - smooth(0.004, 0.012, Math.abs(u - px))) * (0.5 + 0.5 * hash(i, 3, 4)))
    }
    return a * (1 - smooth(0.85, 1, Math.abs(v - 0.5) * 2))
  })
  tip('tip-crayon', 'Crayon', (x, y, u, v) => (1 - smooth(0.7, 0.98, rad(u, v))) * smooth(0.28, 0.5, fbm(x, y, T, 24, 3, 6) * 0.7 + hash(x, y, 2) * 0.45))
  tip('tip-flat', 'Flat bristles', (x, y, u, v) => {
    const line = smooth(0.3, 0.6, 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * 16 + hash(Math.floor(u * 16), 0, 3) * 6))
    const edge = smooth(0, 0.08, u) * smooth(0, 0.08, 1 - u) * smooth(0, 0.15, v) * smooth(0, 0.15, 1 - v)
    return edge * (0.55 + 0.45 * line) * (0.8 + 0.2 * hash(Math.floor(u * 32), 1, 9))
  })
  tip('tip-oil', 'Oil bristle', (x, y, u, v) => {
    const line = 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * 7 + fbm(x, y, T, 4, 2, 15) * 6)
    return (1 - smooth(0.62, 0.96, rad(u, v) + (fbm(x, y, T, 6, 3, 2) - 0.5) * 0.3)) * (0.6 + 0.4 * smooth(0.2, 0.8, line))
  })
  tip('tip-square', 'Square', (x, y, u, v) => smooth(0, 0.04, u) * smooth(0, 0.04, 1 - u) * smooth(0, 0.04, v) * smooth(0, 0.04, 1 - v))
  tip('tip-splash', 'Ink splash', (x, y, u, v) => {
    const r = rad(u, v)
    const a = Math.atan2(v - 0.5, u - 0.5)
    const spikes = 0.45 + 0.4 * noise((a / (Math.PI * 2) + 1) * 9, 3.3, 9, 5) + 0.12 * noise(a * 6 + 20, 1.2, 64, 2)
    return 1 - smooth(spikes - 0.06, spikes, r)
  })
}
