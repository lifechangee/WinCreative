/**
 * Colour profiles (pure: no DOM / GPU, unit-tested in node).
 *
 * Working spaces are RGB matrix/TRC profiles: sRGB, Display P3 and Adobe RGB (1998). The document's profile is a tag on
 * its pixel values ("Assign") and pixels can be transformed between spaces ("Convert"). Exports embed a matching ICC
 * profile in PNG (iCCP), JPEG (APP2) and PSD (image resource 1039). Imported ICC profiles that we recognise map back to
 * a built-in space; others are carried as opaque "custom" profiles.
 */
import { zlibSync, unzlibSync } from 'fflate'

export type Mat3 = [number, number, number, number, number, number, number, number, number]
export type Trc = { kind: 'srgb' } | { kind: 'gamma'; g: number }

export interface RgbSpace {
  id: 'srgb' | 'p3' | 'adobe'
  /** canonical label stored as the document's profile tag */
  label: string
  /** description text inside the generated ICC profile */
  desc: string
  /** xy chromaticities of R, G, B */
  primaries: [[number, number], [number, number], [number, number]]
  trc: Trc
}

export const D65: [number, number] = [0.3127, 0.329]
export const SPACES: RgbSpace[] = [
  { id: 'srgb', label: 'sRGB IEC61966-2.1', desc: 'sRGB IEC61966-2.1', primaries: [[0.64, 0.33], [0.3, 0.6], [0.15, 0.06]], trc: { kind: 'srgb' } }, // i18n-ignore
  { id: 'p3', label: 'Display P3', desc: 'Display P3', primaries: [[0.68, 0.32], [0.265, 0.69], [0.15, 0.06]], trc: { kind: 'srgb' } }, // i18n-ignore
  { id: 'adobe', label: 'Adobe RGB (1998)', desc: 'Adobe RGB (1998)', primaries: [[0.64, 0.33], [0.21, 0.71], [0.15, 0.06]], trc: { kind: 'gamma', g: 563 / 256 } } // i18n-ignore
]
export const PROFILE_LABELS = SPACES.map((s) => s.label)
export const SRGB = SPACES[0]

/** Map any stored label ('sRGB', 'Display P3', 'Adobe RGB (label)'...) to a built-in space; null = unknown / custom. */
export function spaceFromLabel(label: string | undefined | null): RgbSpace | null {
  const l = (label ?? '').toLowerCase()
  if (!l) return SRGB
  if (l.includes('p3')) return SPACES[1]
  if (l.includes('adobe')) return SPACES[2]
  if (l.includes('srgb')) return SRGB
  return null
}

// ------------------------------------------------------------------ matrices
const mul = (a: Mat3, b: Mat3): Mat3 => {
  const o = new Array(9).fill(0) as Mat3
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c]
  return o
}
export function invert3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det]
}
export const apply3 = (m: Mat3, v: [number, number, number]): [number, number, number] => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]]

const xyz = (xy: [number, number]): [number, number, number] => [xy[0] / xy[1], 1, (1 - xy[0] - xy[1]) / xy[1]]

/** Linear RGB -> XYZ (D65 white, Y = 1) for a space. */
export function rgbToXyz(s: RgbSpace): Mat3 {
  const [r, g, b] = s.primaries.map(xyz)
  const P: Mat3 = [r[0], g[0], b[0], r[1], g[1], b[1], r[2], g[2], b[2]]
  const S = apply3(invert3(P), xyz(D65))
  return [P[0] * S[0], P[1] * S[1], P[2] * S[2], P[3] * S[0], P[4] * S[1], P[5] * S[2], P[6] * S[0], P[7] * S[1], P[8] * S[2]]
}

/** Linear-light conversion matrix from one space to another (all built-ins share the D65 white). */
export function convertMatrix(from: RgbSpace, to: RgbSpace): Mat3 {
  return mul(invert3(rgbToXyz(to)), rgbToXyz(from))
}

const BRADFORD: Mat3 = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296]
export const D50_XYZ: [number, number, number] = [0.9642, 1, 0.8249]
/** Linear RGB -> XYZ adapted to the D50 profile connection space (what an ICC colorant tag stores). */
export function rgbToXyzD50(s: RgbSpace): Mat3 {
  const src = apply3(BRADFORD, xyz(D65))
  const dst = apply3(BRADFORD, D50_XYZ)
  const scale: Mat3 = [dst[0] / src[0], 0, 0, 0, dst[1] / src[1], 0, 0, 0, dst[2] / src[2]]
  const adapt = mul(invert3(BRADFORD), mul(scale, BRADFORD))
  return mul(adapt, rgbToXyz(s))
}

// ------------------------------------------------------------------ transfer curves
export function decodeTrc(t: Trc, v: number): number {
  if (t.kind === 'gamma') return Math.pow(Math.max(0, v), t.g)
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}
export function encodeTrc(t: Trc, v: number): number {
  v = Math.min(1, Math.max(0, v))
  if (t.kind === 'gamma') return Math.pow(v, 1 / t.g)
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
}

/**
 * Convert straight RGBA8 pixels in place from one space to another (alpha untouched, gamut-clipped).
 * CPU reference for the GPU pass in features/profiles; used by tests and small images.
 */
export function convertPixels8(px: Uint8ClampedArray | Uint8Array, from: RgbSpace, to: RgbSpace): void {
  if (from === to) return
  const m = convertMatrix(from, to)
  const lut = new Float32Array(256)
  for (let i = 0; i < 256; i++) lut[i] = decodeTrc(from.trc, i / 255)
  const cache = new Map<number, number>()
  for (let i = 0; i < px.length; i += 4) {
    const key = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2]
    let out = cache.get(key)
    if (out === undefined) {
      const c = apply3(m, [lut[px[i]], lut[px[i + 1]], lut[px[i + 2]]])
      out = (Math.round(encodeTrc(to.trc, c[0]) * 255) << 16) | (Math.round(encodeTrc(to.trc, c[1]) * 255) << 8) | Math.round(encodeTrc(to.trc, c[2]) * 255)
      if (cache.size < 1 << 20) cache.set(key, out)
    }
    px[i] = out >> 16
    px[i + 1] = (out >> 8) & 255
    px[i + 2] = out & 255
  }
}

// ------------------------------------------------------------------ ICC profile (v2 matrix/TRC)
const u32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const u16 = (n: number): number[] => [(n >>> 8) & 255, n & 255]
const sig = (s: string): number[] => [...s].map((c) => c.charCodeAt(0))
const s15 = (v: number): number[] => u32((Math.round(v * 65536) | 0) >>> 0)
const pad4 = (a: number[]): number[] => {
  while (a.length % 4) a.push(0)
  return a
}

function descTag(text: string): number[] {
  const ascii = [...text].map((c) => c.charCodeAt(0) & 127)
  return pad4([...sig('desc'), ...u32(0), ...u32(ascii.length + 1), ...ascii, 0, ...u32(0), ...u32(0), ...u16(0), 0, ...new Array(67).fill(0)])
}
const textTag = (text: string): number[] => pad4([...sig('text'), ...u32(0), ...[...text].map((c) => c.charCodeAt(0) & 127), 0])
const xyzTag = (v: [number, number, number]): number[] => [...sig('XYZ '), ...u32(0), ...s15(v[0]), ...s15(v[1]), ...s15(v[2])]

function curveTag(t: Trc): number[] {
  if (t.kind === 'gamma') return pad4([...sig('curv'), ...u32(0), ...u32(1), ...u16(Math.round(t.g * 256))])
  const n = 1024
  const out = [...sig('curv'), ...u32(0), ...u32(n)]
  for (let i = 0; i < n; i++) out.push(...u16(Math.round(decodeTrc(t, i / (n - 1)) * 65535)))
  return pad4(out)
}

/** Build a small ICC v2.1 display profile for a built-in space. */
export function buildIcc(s: RgbSpace): Uint8Array {
  const m = rgbToXyzD50(s)
  const trc = curveTag(s.trc)
  const tags: [string, number[]][] = [
    ['desc', descTag(s.desc)],
    ['cprt', textTag('Public Domain - generated by WinCreative')],
    ['wtpt', xyzTag(D50_XYZ)],
    ['rXYZ', xyzTag([m[0], m[3], m[6]])],
    ['gXYZ', xyzTag([m[1], m[4], m[7]])],
    ['bXYZ', xyzTag([m[2], m[5], m[8]])],
    ['rTRC', trc],
    ['gTRC', trc],
    ['bTRC', trc]
  ]
  const tableSize = 4 + tags.length * 12
  let offset = 128 + tableSize
  const table: number[] = [...u32(tags.length)]
  const body: number[] = []
  let shared = -1
  for (const [name, data] of tags) {
    let at = offset
    if (name.endsWith('TRC') && shared >= 0) at = shared
    else {
      if (name.endsWith('TRC')) shared = offset
      body.push(...data)
      offset += data.length
    }
    table.push(...sig(name), ...u32(at), ...u32(data.length))
  }
  const total = 128 + table.length + body.length
  const header = new Array(128).fill(0)
  const put = (o: number, a: number[]): void => a.forEach((v, i) => (header[o + i] = v))
  put(0, u32(total))
  put(8, [2, 0x10, 0, 0]) // v2.1.0
  put(12, sig('mntr'))
  put(16, sig('RGB '))
  put(20, sig('XYZ '))
  put(24, [...u16(2026), ...u16(1), ...u16(1), ...u16(0), ...u16(0), ...u16(0)])
  put(36, sig('acsp'))
  put(40, sig('MSFT'))
  put(68, s15(D50_XYZ[0]))
  put(72, s15(D50_XYZ[1]))
  put(76, s15(D50_XYZ[2]))
  return Uint8Array.from([...header, ...table, ...body])
}

// ------------------------------------------------------------------ reading ICC profiles
const rd32 = (b: Uint8Array, o: number): number => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0
const rdSig = (b: Uint8Array, o: number): string => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3])

function findTag(icc: Uint8Array, name: string): { off: number; size: number } | null {
  if (icc.length < 132 || rdSig(icc, 36) !== 'acsp') return null
  const n = rd32(icc, 128)
  for (let i = 0; i < n && 132 + i * 12 + 12 <= icc.length; i++) {
    const o = 132 + i * 12
    if (rdSig(icc, o) === name) {
      const off = rd32(icc, o + 4)
      const size = rd32(icc, o + 8)
      if (off + size <= icc.length) return { off, size }
    }
  }
  return null
}

/** Human-readable profile description (desc tag, v2 'desc' or v4 'mluc'); null when unreadable. */
export function iccDescription(icc: Uint8Array): string | null {
  const t = findTag(icc, 'desc')
  if (!t) return null
  const type = rdSig(icc, t.off)
  if (type === 'desc') {
    const n = rd32(icc, t.off + 8)
    return String.fromCharCode(...icc.slice(t.off + 12, t.off + 12 + Math.max(0, n - 1)))
  }
  if (type === 'mluc') {
    const len = rd32(icc, t.off + 20)
    const off = rd32(icc, t.off + 24)
    let s = ''
    for (let i = 0; i + 1 < len; i += 2) s += String.fromCharCode((icc[t.off + off + i] << 8) | icc[t.off + off + i + 1])
    return s
  }
  return null
}

/** Colour space signature ('RGB ', 'CMYK', 'GRAY'). */
export const iccColorSpace = (icc: Uint8Array): string => (icc.length > 20 ? rdSig(icc, 16) : '')

/** Recognise one of the built-in RGB spaces from an ICC profile (description first, then colorant chromaticities). */
export function identifyIcc(icc: Uint8Array): RgbSpace | null {
  if (iccColorSpace(icc) !== 'RGB ') return null
  const d = (iccDescription(icc) ?? '').toLowerCase()
  if (/p3/.test(d)) return SPACES[1]
  if (/adobe\s*rgb/.test(d)) return SPACES[2]
  if (/srgb/.test(d)) return SRGB
  const cols = ['rXYZ', 'gXYZ', 'bXYZ'].map((n) => findTag(icc, n))
  if (cols.some((c) => !c)) return null
  const got = cols.map((c) => [0, 1, 2].map((k) => (rd32(icc, c!.off + 8 + k * 4) | 0) / 65536))
  for (const s of SPACES) {
    const m = rgbToXyzD50(s)
    const want = [[m[0], m[3], m[6]], [m[1], m[4], m[7]], [m[2], m[5], m[8]]]
    if (got.every((g, i) => g.every((v, k) => Math.abs(v - want[i][k]) < 0.004))) return s
  }
  return null
}

// ------------------------------------------------------------------ embedding in files
const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(b: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const isPng = (b: Uint8Array): boolean => b.length > 33 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  out.set(u32(data.length), 0)
  out.set(sig(type), 4)
  out.set(data, 8)
  out.set(u32(crc32(out.subarray(4, 8 + data.length))), 8 + data.length)
  return out
}

/** Insert (or replace) the iCCP chunk of a PNG right after IHDR. */
export function embedPngIcc(png: Uint8Array, name: string, icc: Uint8Array): Uint8Array {
  if (!isPng(png)) return png
  const stripped = removePngChunk(removePngChunk(png, 'iCCP'), 'sRGB') // sRGB and iCCP are mutually exclusive
  const nm = [...name.slice(0, 79)].map((c) => c.charCodeAt(0) & 127)
  const data = Uint8Array.from([...nm, 0, 0, ...zlibSync(icc)])
  const chunk = pngChunk('iCCP', data)
  const ihdrEnd = 8 + 12 + rd32(stripped, 8)
  const out = new Uint8Array(stripped.length + chunk.length)
  out.set(stripped.subarray(0, ihdrEnd), 0)
  out.set(chunk, ihdrEnd)
  out.set(stripped.subarray(ihdrEnd), ihdrEnd + chunk.length)
  return out
}

function removePngChunk(png: Uint8Array, type: string): Uint8Array {
  const parts: Uint8Array[] = [png.subarray(0, 8)]
  let o = 8
  while (o + 12 <= png.length) {
    const len = rd32(png, o)
    const t = rdSig(png, o + 4)
    if (t !== type) parts.push(png.subarray(o, o + 12 + len))
    o += 12 + len
    if (t === 'IEND') break
  }
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0))
  let p = 0
  for (const x of parts) (out.set(x, p), (p += x.length))
  return out
}

export function extractPngIcc(png: Uint8Array): Uint8Array | null {
  if (!isPng(png)) return null
  let o = 8
  while (o + 12 <= png.length) {
    const len = rd32(png, o)
    const t = rdSig(png, o + 4)
    if (t === 'iCCP') {
      let z = o + 8
      while (z < o + 8 + len && png[z] !== 0) z++
      try {
        return unzlibSync(png.subarray(z + 2, o + 8 + len))
      } catch {
        return null
      }
    }
    if (t === 'IDAT' || t === 'IEND') return null
    o += 12 + len
  }
  return null
}

const isJpeg = (b: Uint8Array): boolean => b.length > 4 && b[0] === 0xff && b[1] === 0xd8

/** Insert the profile as APP2 "ICC_PROFILE" segments (split into <= 65519 byte chunks) after any JFIF / Exif header. */
export function embedJpegIcc(jpeg: Uint8Array, icc: Uint8Array): Uint8Array {
  if (!isJpeg(jpeg)) return jpeg
  let pos = 2
  while (pos + 4 <= jpeg.length && jpeg[pos] === 0xff && (jpeg[pos + 1] === 0xe0 || jpeg[pos + 1] === 0xe1)) pos += 2 + ((jpeg[pos + 2] << 8) | jpeg[pos + 3])
  const MAX = 65519 - 14
  const n = Math.ceil(icc.length / MAX)
  const segs: number[][] = []
  for (let i = 0; i < n; i++) {
    const part = icc.subarray(i * MAX, (i + 1) * MAX)
    segs.push([0xff, 0xe2, ...u16(part.length + 16), ...sig('ICC_PROFILE'), 0, i + 1, n, ...part])
  }
  const flat = segs.flat()
  const out = new Uint8Array(jpeg.length + flat.length)
  out.set(jpeg.subarray(0, pos), 0)
  out.set(flat, pos)
  out.set(jpeg.subarray(pos), pos + flat.length)
  return out
}

export function extractJpegIcc(jpeg: Uint8Array): Uint8Array | null {
  if (!isJpeg(jpeg)) return null
  const parts = new Map<number, Uint8Array>()
  let pos = 2
  while (pos + 4 <= jpeg.length && jpeg[pos] === 0xff) {
    const m = jpeg[pos + 1]
    if (m === 0xda || m === 0xd9) break
    const len = (jpeg[pos + 2] << 8) | jpeg[pos + 3]
    if (m === 0xe2 && rdSig(jpeg, pos + 4) === 'ICC_' && String.fromCharCode(...jpeg.subarray(pos + 4, pos + 15)) === 'ICC_PROFILE') parts.set(jpeg[pos + 16], jpeg.subarray(pos + 18, pos + 2 + len))
    pos += 2 + len
  }
  if (!parts.size) return null
  const seq = [...parts.keys()].sort((a, b) => a - b)
  const out = new Uint8Array(seq.reduce((a, k) => a + parts.get(k)!.length, 0))
  let p = 0
  for (const k of seq) (out.set(parts.get(k)!, p), (p += parts.get(k)!.length))
  return out
}

/** Add image resource 1039 (ICC profile) to a PSD / PSB written without one. */
export function embedPsdIcc(psd: Uint8Array, icc: Uint8Array): Uint8Array {
  if (psd.length < 34 || rdSig(psd, 0) !== '8BPS') return psd
  const cmLen = rd32(psd, 26)
  const irLenAt = 30 + cmLen
  const irLen = rd32(psd, irLenAt)
  const irStart = irLenAt + 4
  // drop an existing 1039 block first
  let res = psd.subarray(irStart, irStart + irLen)
  const kept: number[] = []
  let o = 0
  while (o + 12 <= res.length && rdSig(res, o) === '8BIM') {
    const id = (res[o + 4] << 8) | res[o + 5]
    let p = o + 6
    p += 1 + res[p]
    if (p % 2) p++
    const size = rd32(res, p)
    const end = p + 4 + size + (size % 2)
    if (id !== 1039) for (let i = o; i < end; i++) kept.push(res[i])
    o = end
  }
  res = Uint8Array.from(kept)
  const block = [...sig('8BIM'), ...u16(1039), 0, 0, ...u32(icc.length), ...icc, ...(icc.length % 2 ? [0] : [])]
  const newRes = new Uint8Array(res.length + block.length)
  newRes.set(res, 0)
  newRes.set(block, res.length)
  const out = new Uint8Array(irStart + newRes.length + (psd.length - (irStart + irLen)))
  out.set(psd.subarray(0, irLenAt), 0)
  out.set(u32(newRes.length), irLenAt)
  out.set(newRes, irStart)
  out.set(psd.subarray(irStart + irLen), irStart + newRes.length)
  return out
}

export type EmbedKind = 'png' | 'jpeg' | 'psd'
/** Embed `icc` (named `name`) in an encoded file; unsupported kinds are returned unchanged. */
export function embedIcc(kind: string, bytes: Uint8Array, name: string, icc: Uint8Array): Uint8Array {
  if (kind === 'png') return embedPngIcc(bytes, name, icc)
  if (kind === 'jpeg') return embedJpegIcc(bytes, icc)
  if (kind === 'psd') return embedPsdIcc(bytes, icc)
  return bytes
}

/** Find an embedded ICC profile in PNG / JPEG bytes. */
export function extractIcc(bytes: Uint8Array): Uint8Array | null {
  return extractPngIcc(bytes) ?? extractJpegIcc(bytes)
}
