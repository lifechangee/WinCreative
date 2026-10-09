import { unzlibSync } from 'fflate'

/**
 * Minimal synchronous PNG decoder (pure, no DOM): 8-bit, non-interlaced, grey / grey+alpha / RGB / RGBA. Returns straight-alpha
 * RGBA8, or null for anything else (callers fall back to createImageBitmap). Used for evicted tile blobs, which are PNGs.
 */
export interface Decoded {
  w: number
  h: number
  rgba: Uint8Array
}

const CH: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 }

export function decodePng(src: Uint8Array): Decoded | null {
  if (src.length < 45 || src[0] !== 0x89 || src[1] !== 0x50 || src[2] !== 0x4e || src[3] !== 0x47) return null
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength)
  let o = 8
  let w = 0
  let h = 0
  let ct = -1
  const idat: Uint8Array[] = []
  let idatBytes = 0
  while (o + 8 <= src.length) {
    const len = dv.getUint32(o)
    const type = String.fromCharCode(src[o + 4], src[o + 5], src[o + 6], src[o + 7])
    const d = o + 8
    if (d + len > src.length) return null
    if (type === 'IHDR') {
      w = dv.getUint32(d)
      h = dv.getUint32(d + 4)
      if (src[d + 8] !== 8 || src[d + 12] !== 0) return null
      ct = src[d + 9]
    } else if (type === 'IDAT') {
      idat.push(src.subarray(d, d + len))
      idatBytes += len
    } else if (type === 'IEND') break
    o = d + len + 4
  }
  const ch = CH[ct]
  if (!ch || w < 1 || h < 1 || !idat.length) return null
  const z = idat.length === 1 ? idat[0] : concat(idat, idatBytes)
  const stride = w * ch
  let raw: Uint8Array
  try {
    raw = unzlibSync(z, { out: new Uint8Array(h * (stride + 1)) })
  } catch {
    return null // not decodable by the fast path: callers fall back to the browser decoder
  }
  if (raw.length < h * (stride + 1)) return null
  // unfilter in place into `pix` (h x stride)
  const pix = new Uint8Array(h * stride)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]
    const s = y * (stride + 1) + 1
    const d = y * stride
    const p = d - stride
    switch (f) {
      case 0:
        pix.set(raw.subarray(s, s + stride), d)
        break
      case 1:
        for (let i = 0; i < stride; i++) pix[d + i] = raw[s + i] + (i >= ch ? pix[d + i - ch] : 0)
        break
      case 2:
        for (let i = 0; i < stride; i++) pix[d + i] = raw[s + i] + (y ? pix[p + i] : 0)
        break
      case 3:
        for (let i = 0; i < stride; i++) pix[d + i] = raw[s + i] + (((i >= ch ? pix[d + i - ch] : 0) + (y ? pix[p + i] : 0)) >> 1)
        break
      case 4:
        for (let i = 0; i < stride; i++) {
          const a = i >= ch ? pix[d + i - ch] : 0
          const b = y ? pix[p + i] : 0
          const c = y && i >= ch ? pix[p + i - ch] : 0
          const pp = a + b - c
          const pa = Math.abs(pp - a)
          const pb = Math.abs(pp - b)
          const pc = Math.abs(pp - c)
          pix[d + i] = raw[s + i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
        }
        break
      default:
        return null
    }
  }
  if (ch === 4) return { w, h, rgba: pix }
  const out = new Uint8Array(w * h * 4)
  for (let i = 0, j = 0; i < w * h; i++, j += ch) {
    const k = i * 4
    if (ch === 1) (out[k] = out[k + 1] = out[k + 2] = pix[j]), (out[k + 3] = 255)
    else if (ch === 2) (out[k] = out[k + 1] = out[k + 2] = pix[j]), (out[k + 3] = pix[j + 1])
    else ((out[k] = pix[j]), (out[k + 1] = pix[j + 1]), (out[k + 2] = pix[j + 2]), (out[k + 3] = 255))
  }
  return { w, h, rgba: out }
}

function concat(parts: Uint8Array[], n: number): Uint8Array {
  const out = new Uint8Array(n)
  let o = 0
  for (const p of parts) (out.set(p, o), (o += p.length))
  return out
}

/**
 * Exact 8-bit alpha conversions used by tile eviction. unpremultiply rounds to nearest, premultiply likewise; for valid premultiplied
 * data (c <= a) premultiply(unpremultiply(p)) === p, so an evict -> restore round trip is bit exact (|s*a/255 - p| <= a/510 < 0.5).
 * Both are 64 KB lookup tables indexed by (alpha << 8 | value): ~10x faster than dividing per channel.
 */
let UN: Uint8Array | null = null
let PRE: Uint8Array | null = null
function tables(): void {
  if (UN) return
  UN = new Uint8Array(65536)
  PRE = new Uint8Array(65536)
  for (let a = 1; a < 256; a++) {
    const h = a >> 1
    for (let v = 0; v < 256; v++) {
      const u = Math.floor((v * 255 + h) / a)
      UN[(a << 8) | v] = u > 255 ? 255 : u
      PRE[(a << 8) | v] = Math.floor((v * a + 127) / 255)
    }
  }
}
/** `empty` = no pixel has alpha > 0 (the tile can be dropped instead of saved). */
export function unpremultiplyEx(p: Uint8Array | Uint8ClampedArray): { data: Uint8Array; empty: boolean } {
  tables()
  const un = UN!
  const o = new Uint8Array(p.length)
  let any = 0
  for (let i = 0; i < p.length; i += 4) {
    const a = p[i + 3]
    if (!a) continue
    any = 1
    o[i + 3] = a
    const b = a << 8
    o[i] = un[b | p[i]]
    o[i + 1] = un[b | p[i + 1]]
    o[i + 2] = un[b | p[i + 2]]
  }
  return { data: o, empty: !any }
}
export const unpremultiply = (p: Uint8Array | Uint8ClampedArray): Uint8Array => unpremultiplyEx(p).data
/** In place: straight -> premultiplied. */
export function premultiplyInPlace(s: Uint8Array): Uint8Array {
  tables()
  const pre = PRE!
  for (let i = 0; i < s.length; i += 4) {
    const a = s[i + 3]
    if (a === 255) continue
    if (!a) {
      s[i] = s[i + 1] = s[i + 2] = 0
      continue
    }
    const b = a << 8
    s[i] = pre[b | s[i]]
    s[i + 1] = pre[b | s[i + 1]]
    s[i + 2] = pre[b | s[i + 2]]
  }
  return s
}
