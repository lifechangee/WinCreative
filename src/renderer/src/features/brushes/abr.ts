import { t } from '../../i18n'
/**
 * Photoshop .abr brush importer (best effort): sampled brush tips of versions 1, 2 (old format) and 6+ (8BIM
 * "samp" section). Returns 8-bit grayscale tips (255 = paint); computed (round) brushes are skipped.
 */
export interface AbrTip {
  name: string
  width: number
  height: number
  /** 255 = full paint */
  data: Uint8Array
  /** spacing in percent when the file states it (old format) */
  spacing?: number
}

class Reader {
  dv: DataView
  constructor(
    readonly buf: Uint8Array,
    public pos = 0
  ) {
    this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  }
  need(n: number): void {
    if (this.pos + n > this.buf.length) throw new Error('Unexpected end of .abr data')
  }
  u8(): number {
    this.need(1)
    return this.buf[this.pos++]
  }
  i16(): number {
    this.need(2)
    const v = this.dv.getInt16(this.pos)
    this.pos += 2
    return v
  }
  u16(): number {
    this.need(2)
    const v = this.dv.getUint16(this.pos)
    this.pos += 2
    return v
  }
  i32(): number {
    this.need(4)
    const v = this.dv.getInt32(this.pos)
    this.pos += 4
    return v
  }
  tag(): string {
    this.need(4)
    const s = String.fromCharCode(...this.buf.slice(this.pos, this.pos + 4))
    this.pos += 4
    return s
  }
  skip(n: number): void {
    this.need(n)
    this.pos += n
  }
}

/** Photoshop PackBits row decoder. */
export function unpackBits(src: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected)
  let i = 0
  let o = 0
  while (i < src.length && o < expected) {
    const n = (src[i++] << 24) >> 24
    if (n >= 0) {
      const c = n + 1
      for (let k = 0; k < c && o < expected && i < src.length; k++) out[o++] = src[i++]
    } else if (n !== -128) {
      const c = 1 - n
      const v = src[i++]
      for (let k = 0; k < c && o < expected; k++) out[o++] = v
    }
  }
  return out
}

function readImage(r: Reader, w: number, h: number, depth: number, compression: number): Uint8Array {
  const bytesPP = depth === 16 ? 2 : 1
  const rowBytes = w * bytesPP
  const raw = new Uint8Array(rowBytes * h)
  if (compression === 0) {
    r.need(raw.length)
    raw.set(r.buf.subarray(r.pos, r.pos + raw.length))
    r.pos += raw.length
  } else {
    const lens: number[] = []
    for (let y = 0; y < h; y++) lens.push(r.u16())
    for (let y = 0; y < h; y++) {
      r.need(lens[y])
      raw.set(unpackBits(r.buf.subarray(r.pos, r.pos + lens[y]), rowBytes), y * rowBytes)
      r.pos += lens[y]
    }
  }
  if (bytesPP === 1) return raw
  const out = new Uint8Array(w * h)
  for (let i = 0; i < out.length; i++) out[i] = raw[i * 2] // high byte
  return out
}

const isUsable = (w: number, h: number): boolean => w > 0 && h > 0 && w <= 8192 && h <= 8192

/** Parse an .abr file. Throws on unsupported/corrupt data; brushes that fail individually are skipped. */
export function parseAbr(buf: Uint8Array): AbrTip[] {
  const r = new Reader(buf)
  const ver = r.i16()
  const tips: AbrTip[] = []
  if (ver === 1 || ver === 2) {
    const count = r.i16()
    for (let n = 0; n < count; n++) {
      const type = r.i16()
      const size = r.i32()
      const end = r.pos + size
      try {
        if (type === 2) {
          r.i32() // misc
          const spacing = r.i16()
          let name = t('brushes.import.brushN', { n: n + 1 })
          if (ver === 2) {
            const len = r.i32()
            let s = ''
            for (let i = 0; i < len - 1 && i < 256; i++) s += String.fromCharCode(r.u16())
            r.skip(2)
            if (s.trim()) name = s
          }
          r.u8() // antialias
          r.skip(8) // short bounds
          const top = r.i32()
          const left = r.i32()
          const bottom = r.i32()
          const right = r.i32()
          const depth = r.i16()
          const comp = r.u8()
          const w = right - left
          const h = bottom - top
          if (isUsable(w, h)) tips.push({ name, width: w, height: h, data: readImage(r, w, h, depth, comp), spacing })
        }
      } catch {
        /* skip broken brush */
      }
      r.pos = Math.min(buf.length, end)
    }
    return tips
  }
  if (ver >= 6) {
    const sub = r.i16()
    try {
    while (r.pos + 12 <= buf.length) {
      const sig = r.tag()
      if (sig !== '8BIM') break
      const key = r.tag()
      const len = r.i32()
      const blockEnd = r.pos + len
      if (key === 'samp') {
        let idx = 0
        while (r.pos + 4 < blockEnd) {
          const size = r.i32()
          let padded = size
          while (padded % 4) padded++
          const next = r.pos + padded
          try {
            const idLen = r.u8()
            let id = ''
            for (let i = 0; i < idLen; i++) id += String.fromCharCode(r.u8())
            r.skip(sub === 1 ? 10 : 264)
            const top = r.i32()
            const left = r.i32()
            const bottom = r.i32()
            const right = r.i32()
            const depth = r.i16()
            const comp = r.u8()
            const w = right - left
            const h = bottom - top
            if (isUsable(w, h)) tips.push({ name: t('brushes.import.brushN', { n: ++idx }), width: w, height: h, data: readImage(r, w, h, depth, comp) })
          } catch {
            idx++
          }
          r.pos = Math.min(buf.length, next)
        }
      }
      r.pos = Math.min(buf.length, blockEnd)
    }
    } catch {
      /* truncated file: keep the tips read so far */
    }
    return tips
  }
  throw new Error('Unsupported .abr version ' + ver)
}
