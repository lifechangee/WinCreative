import { t } from '../../i18n'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { hexToRgb, hsvToRgb, normalizeHex, rgbToHex, rgbToHsv } from './colorMath'

/** A palette: fixed grid of slots, each a "#rrggbb" or null (empty slot). */
export interface Palette {
  id: string
  name: string
  colors: (string | null)[]
}

export const DEFAULT_PALETTE_SIZE = 30

const DEFAULT_COLORS = [
  '#000000', '#3a3a3c', '#7d7d82', '#bfbfc4', '#ffffff', '#5c3b28',
  '#a8442a', '#e8412e', '#f08a2e', '#f7c531', '#f4e76a', '#a5d04a',
  '#4aa85a', '#1f7a5c', '#2ab5b0', '#5bc8ef', '#3b82f6', '#2c4fb8',
  '#5a3fb0', '#9b59d0', '#d95fb8', '#f28fb0', '#f5b59a', '#e0b384',
  '#c48a5a', '#8a5a3a', '#6b7d3a', '#3d5a6b', '#b7c9d6', '#f1e4d0'
]

/** Display name: the built-in default palette is translated, every other name is user content. */
export const paletteName = (q: { id: string; name: string }): string => (q.id === 'default' && q.name === 'Default' ? t('color.palette.builtin.default') : q.name)

export const makeDefaultPalette = (): Palette => ({ id: 'default', name: 'Default', colors: [...DEFAULT_COLORS] })

let idn = 0
export const newPaletteId = (): string => 'p' + Date.now().toString(36) + (idn++).toString(36) + Math.random().toString(36).slice(2, 5)

export function makePalette(name: string, colors: (string | null)[] = []): Palette {
  return { id: newPaletteId(), name, colors: colors.map((c) => (c ? normalizeHex(c) : null)) }
}

/** Normalise arbitrary parsed JSON into a Palette (defensive, used on load from localStorage). */
export function sanitizePalette(p: any): Palette | null {
  if (!p || typeof p !== 'object' || !Array.isArray(p.colors)) return null
  return {
    id: typeof p.id === 'string' ? p.id : newPaletteId(),
    name: String(p.name ?? t('color.palette.fallbackName')).slice(0, 80),
    colors: p.colors.map((c: unknown) => (typeof c === 'string' ? normalizeHex(c) : null))
  }
}

// ------------------------------------------------------------------ .swatches (Procreate-compatible zip)
interface SwatchJson {
  hue: number
  saturation: number
  brightness: number
  alpha: number
  colorSpace: number
  origin: number
  colorModel: number
  components: number[]
}
const hexToSwatch = (hex: string): SwatchJson => {
  const rgb = hexToRgb(hex)!
  const hsv = rgbToHsv(...rgb)
  return { hue: hsv.h / 360, saturation: hsv.s, brightness: hsv.v, alpha: 1, colorSpace: 0, origin: 2, colorModel: 0, components: [hsv.h / 360, hsv.s, hsv.v] }
}

/** Serialise palettes into Procreate's .swatches layout: ZIP containing Swatches.json (hue/sat/bri in 0..1). */
export function encodeSwatches(palette: Palette): Uint8Array {
  const json = {
    name: palette.name,
    swatches: palette.colors.map((c) => (c ? hexToSwatch(c) : null))
  }
  return zipSync({ 'Swatches.json': strToU8(JSON.stringify(json)) })
}

/** Plain JSON variant (same shape as Swatches.json). */
export const encodePaletteJson = (palette: Palette): Uint8Array => strToU8(JSON.stringify({ name: palette.name, swatches: palette.colors.map((c) => (c ? hexToSwatch(c) : null)) }, null, 1))

function swatchToHex(s: any): string | null {
  if (!s || typeof s !== 'object') return null
  if (typeof s.hex === 'string') return normalizeHex(s.hex)
  let h = Number(s.hue)
  let sat = Number(s.saturation)
  let v = Number(s.brightness)
  if (!Number.isFinite(h) && Array.isArray(s.components)) [h, sat, v] = s.components.map(Number)
  if (![h, sat, v].every(Number.isFinite)) return null
  return rgbToHex(hsvToRgb({ h: (h > 1 ? h : h * 360) % 360, s: Math.min(1, Math.max(0, sat)), v: Math.min(1, Math.max(0, v)) }))
}

/** Parse Swatches.json content (single palette object or array of them) into palettes. */
export function parseSwatchesJson(text: string, fallbackName = t('gallery.imported')): Palette[] {
  const j = JSON.parse(text)
  const list = Array.isArray(j) ? j : [j]
  const out: Palette[] = []
  for (const p of list) {
    if (!p || !Array.isArray(p.swatches)) continue
    out.push(makePalette(String(p.name ?? fallbackName), p.swatches.map(swatchToHex)))
  }
  return out
}

export function decodeSwatches(bytes: Uint8Array, fallbackName = t('gallery.imported')): Palette[] {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const files = unzipSync(bytes)
    const key = Object.keys(files).find((k) => /(^|\/)swatches\.json$/i.test(k)) ?? Object.keys(files).find((k) => k.toLowerCase().endsWith('.json'))
    if (!key) throw new Error('No Swatches.json in archive')
    return parseSwatchesJson(strFromU8(files[key]), fallbackName)
  }
  return parseSwatchesJson(strFromU8(bytes), fallbackName)
}

// ------------------------------------------------------------------ Adobe Swatch Exchange (.ase)
const u8 = (n: number): number => Math.round(Math.min(1, Math.max(0, n)) * 255)

export function encodeAse(palette: Palette): Uint8Array {
  const entries = palette.colors.filter((c): c is string => !!c)
  const chunks: Uint8Array[] = []
  const utf16 = (s: string): Uint8Array => {
    const b = new Uint8Array((s.length + 1) * 2)
    const dv = new DataView(b.buffer)
    for (let i = 0; i < s.length; i++) dv.setUint16(i * 2, s.charCodeAt(i))
    return b
  }
  const block = (type: number, body: Uint8Array): Uint8Array => {
    const b = new Uint8Array(6 + body.length)
    const dv = new DataView(b.buffer)
    dv.setUint16(0, type)
    dv.setUint32(2, body.length)
    b.set(body, 6)
    return b
  }
  const nameField = (s: string): Uint8Array => {
    const u = utf16(s)
    const b = new Uint8Array(2 + u.length)
    new DataView(b.buffer).setUint16(0, s.length + 1)
    b.set(u, 2)
    return b
  }
  const cat = (...a: Uint8Array[]): Uint8Array => {
    const b = new Uint8Array(a.reduce((n, x) => n + x.length, 0))
    let o = 0
    for (const x of a) {
      b.set(x, o)
      o += x.length
    }
    return b
  }
  chunks.push(block(0xc001, nameField(palette.name)))
  for (const hex of entries) {
    const rgb = hexToRgb(hex)!
    const body = new Uint8Array(4 + 12 + 2)
    const dv = new DataView(body.buffer)
    body.set([0x52, 0x47, 0x42, 0x20], 0)
    rgb.forEach((v, i) => dv.setFloat32(4 + i * 4, v))
    dv.setUint16(16, 2)
    chunks.push(block(0x0001, cat(nameField(hex.toUpperCase()), body)))
  }
  chunks.push(block(0xc002, new Uint8Array(0)))
  const head = new Uint8Array(12)
  const hd = new DataView(head.buffer)
  head.set([0x41, 0x53, 0x45, 0x46], 0)
  hd.setUint16(4, 1)
  hd.setUint16(6, 0)
  hd.setUint32(8, chunks.length)
  return cat(head, ...chunks)
}

export function isAse(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && bytes[0] === 0x41 && bytes[1] === 0x53 && bytes[2] === 0x45 && bytes[3] === 0x46
}

/** Parse .ase into palettes (one per group; loose colours go to a palette named after fallbackName). */
export function decodeAse(bytes: Uint8Array, fallbackName = t('gallery.imported')): Palette[] {
  if (!isAse(bytes)) throw new Error('Not an ASE file')
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = dv.getUint32(8)
  let o = 12
  const palettes: Palette[] = []
  let cur: Palette | null = null
  const loose = makePalette(fallbackName)
  const readName = (at: number): { s: string; end: number } => {
    const n = dv.getUint16(at)
    let s = ''
    for (let i = 0; i < n - 1; i++) s += String.fromCharCode(dv.getUint16(at + 2 + i * 2))
    return { s, end: at + 2 + n * 2 }
  }
  for (let b = 0; b < count && o + 6 <= bytes.length; b++) {
    const type = dv.getUint16(o)
    const len = dv.getUint32(o + 2)
    const body = o + 6
    if (type === 0xc001) {
      cur = makePalette(readName(body).s || fallbackName)
      palettes.push(cur)
    } else if (type === 0xc002) cur = null
    else if (type === 0x0001) {
      const { end } = readName(body)
      const model = String.fromCharCode(dv.getUint8(end), dv.getUint8(end + 1), dv.getUint8(end + 2), dv.getUint8(end + 3)).trim()
      const f = (i: number): number => dv.getFloat32(end + 4 + i * 4)
      let rgb: [number, number, number] | null = null
      if (model === 'RGB') rgb = [f(0), f(1), f(2)]
      else if (model === 'Gray') rgb = [f(0), f(0), f(0)]
      else if (model === 'CMYK') {
        const [c, m, y, k] = [f(0), f(1), f(2), f(3)]
        rgb = [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)]
      } else if (model === 'LAB') rgb = labToRgb(f(0) * 100, f(1), f(2))
      if (rgb) (cur ?? loose).colors.push(rgbToHex(rgb))
    }
    o = body + len
  }
  if (loose.colors.length) palettes.push(loose)
  return palettes.filter((p) => p.colors.length)
}

function labToRgb(L: number, a: number, b: number): [number, number, number] {
  const fy = (L + 16) / 116
  const fx = fy + a / 500
  const fz = fy - b / 200
  const inv = (t: number): number => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787)
  const X = 0.95047 * inv(fx)
  const Y = inv(fy)
  const Z = 1.08883 * inv(fz)
  const lin = [3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.204 * Y + 1.057 * Z]
  return lin.map((c) => Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055))) as [number, number, number]
}

// ------------------------------------------------------------------ extraction from an image (median cut)
/**
 * Extract up to `count` representative colours from straight RGBA8 pixels using median cut.
 * Fully transparent pixels are ignored. Results ordered by population (largest first).
 */
export function extractPalette(rgba: ArrayLike<number>, count = DEFAULT_PALETTE_SIZE, maxSamples = 60000): string[] {
  const n = Math.floor(rgba.length / 4)
  const step = Math.max(1, Math.floor(n / maxSamples))
  const px: number[] = []
  for (let i = 0; i < n; i += step) {
    if (rgba[i * 4 + 3] < 16) continue
    px.push(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2])
  }
  const total = px.length / 3
  if (!total) return []
  type Box = { idx: number[] }
  let boxes: Box[] = [{ idx: Array.from({ length: total }, (_, i) => i) }]
  const range = (b: Box): { ch: number; span: number } => {
    const mn = [255, 255, 255]
    const mx = [0, 0, 0]
    for (const i of b.idx)
      for (let c = 0; c < 3; c++) {
        const v = px[i * 3 + c]
        if (v < mn[c]) mn[c] = v
        if (v > mx[c]) mx[c] = v
      }
    let ch = 0
    for (let c = 1; c < 3; c++) if (mx[c] - mn[c] > mx[ch] - mn[ch]) ch = c
    return { ch, span: mx[ch] - mn[ch] }
  }
  while (boxes.length < count) {
    let bi = -1
    let bestScore = 0
    boxes.forEach((b, i) => {
      if (b.idx.length < 2) return
      const score = range(b).span * Math.sqrt(b.idx.length)
      if (score > bestScore) {
        bestScore = score
        bi = i
      }
    })
    if (bi < 0 || bestScore <= 0) break
    const box = boxes[bi]
    const { ch } = range(box)
    box.idx.sort((a, b) => px[a * 3 + ch] - px[b * 3 + ch])
    const mid = box.idx.length >> 1
    boxes.splice(bi, 1, { idx: box.idx.slice(0, mid) }, { idx: box.idx.slice(mid) })
  }
  boxes = boxes.filter((b) => b.idx.length).sort((a, b) => b.idx.length - a.idx.length)
  const out: string[] = []
  for (const b of boxes) {
    let r = 0
    let g = 0
    let bl = 0
    for (const i of b.idx) {
      r += px[i * 3]
      g += px[i * 3 + 1]
      bl += px[i * 3 + 2]
    }
    const k = b.idx.length * 255
    const hex = rgbToHex([r / k, g / k, bl / k])
    if (!out.includes(hex)) out.push(hex)
  }
  return out
}
