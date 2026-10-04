import { describe, expect, it } from 'vitest'
import { unzlibSync } from 'fflate'
import { PngStream, crc32 } from '../src/renderer/src/io/pngStream'
import { packEntry, parseEntries } from '../src/renderer/src/features/color/journal'

/** Minimal PNG reader for the tests: chunks + CRC check + inflate + un-filter (Sub only, that is all we write). */
function readPng(b: Uint8Array): { w: number; h: number; rgba: Uint8Array } {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  expect(Array.from(b.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  let o = 8
  let w = 0
  let h = 0
  const idat: Uint8Array[] = []
  let sawEnd = false
  while (o < b.length) {
    const len = v.getUint32(o)
    const type = String.fromCharCode(...b.subarray(o + 4, o + 8))
    const data = b.subarray(o + 8, o + 8 + len)
    const crc = v.getUint32(o + 8 + len)
    let c = crc32(b.subarray(o + 4, o + 8))
    c = crc32(data, c)
    expect((c ^ 0xffffffff) >>> 0).toBe(crc)
    if (type === 'IHDR') {
      w = new DataView(data.buffer, data.byteOffset).getUint32(0)
      h = new DataView(data.buffer, data.byteOffset).getUint32(4)
      expect(data[8]).toBe(8)
      expect(data[9]).toBe(6)
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') sawEnd = true
    o += 12 + len
  }
  expect(sawEnd).toBe(true)
  const z = new Uint8Array(idat.reduce((a, d) => a + d.length, 0))
  let p = 0
  for (const d of idat) (z.set(d, p), (p += d.length))
  const raw = unzlibSync(z)
  const stride = w * 4
  const out = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    expect(raw[y * (stride + 1)]).toBe(1)
    for (let i = 0; i < stride; i++) {
      const prev = i >= 4 ? out[y * stride + i - 4] : 0
      out[y * stride + i] = (raw[y * (stride + 1) + 1 + i] + prev) & 255
    }
  }
  return { w, h, rgba: out }
}

describe('PngStream (async save encoder)', () => {
  it('round-trips pixels fed in several bands', () => {
    const w = 37
    const h = 23
    const px = new Uint8Array(w * h * 4)
    for (let i = 0; i < px.length; i++) px[i] = (i * 7 + (i >> 5) * 13) & 255
    const s = new PngStream(w, h)
    s.push(px.subarray(0, w * 4 * 5))
    s.push(px.subarray(w * 4 * 5, w * 4 * 6))
    s.push(px.subarray(w * 4 * 6))
    expect(s.rows).toBe(h)
    const r = readPng(s.finish())
    expect([r.w, r.h]).toEqual([w, h])
    expect(Array.from(r.rgba)).toEqual(Array.from(px))
  })

  it('keeps straight-alpha colour under transparent pixels (lossless)', () => {
    const px = new Uint8Array([10, 200, 30, 0, 255, 0, 128, 1, 1, 2, 3, 255, 9, 9, 9, 128])
    const s = new PngStream(4, 1)
    s.push(px)
    expect(Array.from(readPng(s.finish()).rgba)).toEqual(Array.from(px))
  })

  it('handles a large flat layer (many IDAT chunks are not required, size stays tiny)', () => {
    const w = 512
    const h = 512
    const s = new PngStream(w, h)
    s.push(new Uint8Array(w * h * 4))
    const png = s.finish()
    expect(png.length).toBeLessThan(4000)
    expect(readPng(png).rgba.every((v) => v === 0)).toBe(true)
  })
})

describe('crash journal format', () => {
  it('packs and parses entries and ignores a torn tail', () => {
    const a = packEntry({ gen: 'g1', seq: 5, layer: 'L1', x: 1, y: 2, w: 3, h: 4 }, new Uint8Array([1, 2, 3, 4, 5]))
    const b = packEntry({ gen: 'g1', seq: 6, layer: 'L2', x: 0, y: 0, w: 1, h: 1 }, new Uint8Array([9]))
    const file = new Uint8Array(a.length + b.length + 7)
    file.set(a, 0)
    file.set(b, a.length)
    file.set([1, 2, 3, 4, 5, 6, 7], a.length + b.length) // partial header written when the process was killed
    const es = parseEntries(file)
    expect(es.map((e) => e.h.seq)).toEqual([5, 6])
    expect(Array.from(es[0].png)).toEqual([1, 2, 3, 4, 5])
    const cut = file.subarray(0, a.length + b.length - 2) // last entry truncated mid-data
    expect(parseEntries(cut).map((e) => e.h.seq)).toEqual([5])
  })
})
