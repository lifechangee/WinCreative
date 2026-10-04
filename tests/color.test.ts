import { describe, expect, it } from 'vitest'
import { HARMONY_OFFSETS, harmonyBaseFromHandle, harmonyColors, hexToHsv, hsvToHex, normalizeHex, rgbDistance } from '../src/renderer/src/features/color/colorMath'
import { computeFillLevels, floodMask, maskFromLevels } from '../src/renderer/src/features/color/floodFill'
import { decodeAse, decodeSwatches, encodeAse, encodeSwatches, extractPalette, makeDefaultPalette, makePalette } from '../src/renderer/src/features/color/palettes'

describe('color math', () => {
  it('normalises hex', () => {
    expect(normalizeHex('ABC')).toBe('#aabbcc')
    expect(normalizeHex('#FF8800')).toBe('#ff8800')
    expect(normalizeHex('#ff880080')).toBe('#ff8800')
    expect(normalizeHex('zzz')).toBeNull()
  })
  it('hex <-> hsv round trips and keeps fallback hue for greys', () => {
    for (const hx of ['#ff0000', '#12ab9c', '#808080', '#000000', '#ffffff']) expect(hsvToHex(hexToHsv(hx, 100)!)).toBe(hx)
    expect(hexToHsv('#808080', 123)!.h).toBe(123)
  })
  it('harmony offsets', () => {
    const base = { h: 10, s: 0.5, v: 0.5 }
    expect(harmonyColors(base, 'complementary').map((c) => c.h)).toEqual([10, 190])
    expect(harmonyColors(base, 'triadic').map((c) => c.h)).toEqual([10, 130, 250])
    expect(harmonyColors(base, 'analogous').map((c) => c.h)).toEqual([10, 340, 40])
    expect(harmonyColors(base, 'splitComplementary').map((c) => c.h)).toEqual([10, 160, 220])
    expect(harmonyColors(base, 'tetradic')).toHaveLength(HARMONY_OFFSETS.tetradic.length)
  })
  it('dragging a handle rotates the set', () => {
    const b = harmonyBaseFromHandle({ h: 10, s: 0.5, v: 0.5 }, 'triadic', 1, 200)
    expect(b.h).toBe(80)
    expect(harmonyColors(b, 'triadic')[1].h).toBe(200)
  })
  it('rgbDistance', () => expect(rgbDistance([0, 0, 0], [1, 0.5, 0])).toBe(1))
})

/** Build a w*h image: white with a black vertical wall at x = wall (1px), optional soft grey AA columns. */
function walled(w: number, h: number, wall: number, aa = false): { data: Uint8ClampedArray; w: number; h: number } {
  const data = new Uint8ClampedArray(w * h * 4).fill(255)
  for (let y = 0; y < h; y++) {
    const set = (x: number, v: number): void => {
      const i = (y * w + x) * 4
      data[i] = data[i + 1] = data[i + 2] = v
    }
    set(wall, 0)
    if (aa) {
      set(wall - 1, 200)
      set(wall + 1, 200)
    }
  }
  return { data, w, h }
}

describe('flood fill', () => {
  it('fills only the contiguous region on one side of a wall', () => {
    const src = walled(20, 10, 10)
    const m = floodMask(src, 2, 5, 0.1, { antialias: false })!
    expect(m.x).toBe(0)
    expect(m.w).toBe(10)
    expect(m.cov.every((v) => v === 255)).toBe(true)
  })
  it('max threshold fills everything', () => {
    const src = walled(20, 10, 10)
    const m = floodMask(src, 2, 5, 1)!
    expect(m.w).toBe(20)
    expect(m.h).toBe(10)
  })
  it('threshold sweep is monotonic and leaps the wall once the threshold exceeds its contrast', () => {
    const src = walled(20, 10, 10)
    const lv = computeFillLevels(src, 2, 5)
    let last = 0
    for (const t of [0, 0.2, 0.5, 0.9, 1]) {
      const m = maskFromLevels(lv, src, 2, 5, t, { antialias: false })!
      const area = m.cov.reduce((a, v) => a + (v ? 1 : 0), 0)
      expect(area).toBeGreaterThanOrEqual(last)
      last = area
    }
    expect(last).toBe(200)
  })
  it('anti-aliased edge pixels get partial coverage and the wall core stays empty', () => {
    const src = walled(20, 10, 10, true)
    const m = floodMask(src, 2, 5, 0.05)!
    const at = (x: number): number => (x - m.x >= m.w ? 0 : m.cov[5 * m.w + (x - m.x)])
    expect(at(8)).toBe(255)
    expect(at(9)).toBeGreaterThan(0)
    expect(at(9)).toBeLessThan(255)
    expect(at(10)).toBe(0)
  })
  it('respects a selection mask', () => {
    const src = walled(20, 10, 10)
    const sel = new Uint8Array(200)
    for (let y = 0; y < 10; y++) for (let x = 0; x < 5; x++) sel[y * 20 + x] = 255
    const m = floodMask(src, 2, 5, 0.1, { antialias: false, selection: sel })!
    expect(m.w).toBe(5)
    expect(floodMask(src, 15, 5, 0.1, { selection: sel })).toBeNull()
  })
  it('transparent pixels are treated as one colour (premultiplied compare)', () => {
    const data = new Uint8ClampedArray(4 * 4 * 4)
    for (let i = 0; i < 16; i++) data[i * 4] = 255 * (i % 2) // rgb garbage under alpha 0
    const m = floodMask({ data, w: 4, h: 4 }, 0, 0, 0)!
    expect(m.w).toBe(4)
    expect(m.h).toBe(4)
  })
})

describe('palettes', () => {
  it('swatches zip round trip keeps colours and empty slots', () => {
    const p = makePalette('Test', ['#ff0000', null, '#12ab9c'])
    const back = decodeSwatches(encodeSwatches(p))
    expect(back).toHaveLength(1)
    expect(back[0].name).toBe('Test')
    expect(back[0].colors).toEqual(['#ff0000', null, '#12ab9c'])
  })
  it('ase round trip', () => {
    const p = makePalette('Ase', ['#ff0000', '#00ff00', '#0000ff'])
    const back = decodeAse(encodeAse(p))
    expect(back[0].name).toBe('Ase')
    expect(back[0].colors).toEqual(['#ff0000', '#00ff00', '#0000ff'])
  })
  it('extracts dominant colours from pixels', () => {
    const px = new Uint8ClampedArray(64 * 4)
    for (let i = 0; i < 64; i++) px.set(i < 32 ? [250, 0, 0, 255] : [0, 0, 250, 255], i * 4)
    const cols = extractPalette(px, 4)
    expect([...cols].sort()).toEqual(['#0000fa', '#fa0000'])
  })
  it('default palette has 30 unique swatches', () => {
    const d = makeDefaultPalette()
    expect(new Set(d.colors).size).toBe(30)
  })
})
