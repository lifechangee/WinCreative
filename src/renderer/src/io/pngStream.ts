import { Zlib } from 'fflate'

/**
 * Streaming PNG encoder (pure, no DOM): feed straight-alpha RGBA8 rows in bands, get one PNG at the end. Rows are
 * filtered with PNG "Sub" and deflated incrementally, so a 33 MB layer never needs a second full-size buffer.
 */
const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
export function crc32(a: Uint8Array, seed = 0xffffffff): number {
  let c = seed
  for (let i = 0; i < a.length; i++) c = CRC[(c ^ a[i]) & 255] ^ (c >>> 8)
  return c
}
const u32 = (v: DataView, o: number, x: number): void => v.setUint32(o, x >>> 0)

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const v = new DataView(out.buffer)
  u32(v, 0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  let c = crc32(out.subarray(4, 8))
  c = crc32(data, c)
  u32(v, 8 + data.length, (c ^ 0xffffffff) >>> 0)
  return out
}

export class PngStream {
  private z: Zlib
  private parts: Uint8Array[] = []
  private bytes = 0
  rows = 0

  constructor(
    readonly w: number,
    readonly h: number,
    level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 = 3
  ) {
    this.z = new Zlib({ level }, (data) => {
      this.parts.push(data)
      this.bytes += data.length
    })
  }

  /** Append whole rows (length must be a multiple of w*4). */
  push(src: Uint8Array): void {
    const stride = this.w * 4
    const n = Math.floor(src.length / stride)
    const out = new Uint8Array(n * (stride + 1))
    let so = 0
    let d = 0
    for (let r = 0; r < n; r++) {
      out[d++] = 1
      for (let i = 0; i < 4; i++) out[d + i] = src[so + i]
      for (let i = 4; i < stride; i++) out[d + i] = (src[so + i] - src[so + i - 4]) & 255
      d += stride
      so += stride
    }
    this.rows += n
    this.z.push(out, false)
  }

  finish(): Uint8Array {
    this.z.push(new Uint8Array(0), true)
    const ihdr = new Uint8Array(13)
    const v = new DataView(ihdr.buffer)
    u32(v, 0, this.w)
    u32(v, 4, this.h)
    ihdr[8] = 8
    ihdr[9] = 6
    const all = new Uint8Array(this.bytes)
    let o = 0
    for (const p of this.parts) (all.set(p, o), (o += p.length))
    const pieces: Uint8Array[] = [Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), chunk('IHDR', ihdr)]
    for (let i = 0; i < all.length; i += 1 << 20) pieces.push(chunk('IDAT', all.subarray(i, Math.min(all.length, i + (1 << 20)))))
    pieces.push(chunk('IEND', new Uint8Array(0)))
    const out = new Uint8Array(pieces.reduce((a, b) => a + b.length, 0))
    o = 0
    for (const p of pieces) (out.set(p, o), (o += p.length))
    return out
  }
}
