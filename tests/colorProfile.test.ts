import { describe, expect, it } from 'vitest'
import { encodePsd, decodePsd } from '../src/renderer/src/io/psd'
import {
  SPACES,
  SRGB,
  buildIcc,
  convertMatrix,
  convertPixels8,
  embedIcc,
  embedJpegIcc,
  embedPngIcc,
  embedPsdIcc,
  extractIcc,
  extractJpegIcc,
  extractPngIcc,
  iccColorSpace,
  iccDescription,
  identifyIcc,
  rgbToXyzD50,
  spaceFromLabel
} from '../src/renderer/src/io/colorProfile'

const P3 = SPACES[1]
const ADOBE = SPACES[2]

// minimal valid 1x1 PNG
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
// SOI + JFIF APP0 + EOI (structure only)
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9])

describe('colour spaces', () => {
  it('maps stored labels', () => {
    expect(spaceFromLabel('sRGB')).toBe(SRGB)
    expect(spaceFromLabel('sRGB IEC61966-2.1')).toBe(SRGB)
    expect(spaceFromLabel('Display P3')).toBe(P3)
    expect(spaceFromLabel('Adobe RGB (label)')).toBe(ADOBE)
    expect(spaceFromLabel('Custom: Foo')).toBeNull()
  })
  it('D50 colorants match the published ICC values', () => {
    const m = rgbToXyzD50(SRGB)
    expect(m[0]).toBeCloseTo(0.4361, 3)
    expect(m[3]).toBeCloseTo(0.2225, 3)
    expect(m[4]).toBeCloseTo(0.7169, 3)
    expect(m[7]).toBeCloseTo(0.0971, 3)
    const p = rgbToXyzD50(P3)
    expect(p[0]).toBeCloseTo(0.5151, 3)
    expect(p[4]).toBeCloseTo(0.6922, 3)
  })
  it('converts sRGB <-> P3', () => {
    const px = new Uint8ClampedArray([255, 0, 0, 255, 255, 255, 255, 255, 128, 128, 128, 200])
    convertPixels8(px, SRGB, P3)
    expect(px[0]).toBeGreaterThanOrEqual(233)
    expect(px[0]).toBeLessThanOrEqual(235)
    expect(px[1]).toBeGreaterThanOrEqual(50)
    expect(px[1]).toBeLessThanOrEqual(52)
    expect([...px.slice(4, 8)]).toEqual([255, 255, 255, 255]) // white stays white
    expect(px[11]).toBe(200) // alpha untouched
    expect(Math.abs(px[8] - 128)).toBeLessThanOrEqual(1) // neutrals stay neutral
    const back = convertMatrix(P3, SRGB)
    expect(back[0]).toBeGreaterThan(1)
  })
  it('round trips saturated colours inside both gamuts', () => {
    const px = new Uint8ClampedArray([200, 90, 60, 255, 20, 140, 220, 255])
    const orig = [...px]
    convertPixels8(px, SRGB, ADOBE)
    convertPixels8(px, ADOBE, SRGB)
    px.forEach((v, i) => expect(Math.abs(v - orig[i])).toBeLessThanOrEqual(2))
  })
})

describe('ICC profiles', () => {
  it('builds valid v2 profiles that identify themselves', () => {
    for (const s of SPACES) {
      const icc = buildIcc(s)
      expect(new TextDecoder().decode(icc.slice(36, 40))).toBe('acsp')
      expect((icc[0] << 24 | icc[1] << 16 | icc[2] << 8 | icc[3]) >>> 0).toBe(icc.length)
      expect(iccColorSpace(icc)).toBe('RGB ')
      expect(iccDescription(icc)).toBe(s.desc)
      expect(identifyIcc(icc)).toBe(s)
    }
    expect(buildIcc(P3).length).toBeLessThan(4000)
  })
  it('identifies by colorants when the description is unhelpful', () => {
    const icc = buildIcc(P3)
    // wipe the description text (keep length) -> falls back to the chromaticities
    const i = icc.findIndex((_, k) => String.fromCharCode(...icc.slice(k, k + 10)) === 'Display P3')
    for (let k = 0; k < 10; k++) icc[i + k] = 'x'.charCodeAt(0)
    expect(identifyIcc(icc)).toBe(P3)
  })
})

describe('embedding', () => {
  it('PNG iCCP round trip keeps the file decodable structure', () => {
    const icc = buildIcc(P3)
    const out = embedPngIcc(PNG, 'Display P3', icc)
    expect(out.length).toBeGreaterThan(PNG.length)
    expect(new TextDecoder().decode(out.slice(37, 41))).toBe('iCCP') // right after IHDR (8 sig + 25 IHDR = 33.. + len)
    expect(extractPngIcc(out)).toEqual(icc)
    // idempotent: re-embedding replaces instead of duplicating
    const twice = embedPngIcc(out, 'sRGB', buildIcc(SRGB))
    expect(identifyIcc(extractPngIcc(twice)!)).toBe(SRGB)
    expect(extractIcc(out)).toEqual(icc)
  })
  it('JPEG APP2 round trip, split over segments', () => {
    const big = new Uint8Array(150000).map((_, i) => i & 255)
    const out = embedJpegIcc(JPEG, big)
    expect(out[2]).toBe(0xff)
    expect(out[3]).toBe(0xe0) // JFIF stays first
    expect(extractJpegIcc(out)).toEqual(big)
    const small = buildIcc(P3)
    expect(extractJpegIcc(embedJpegIcc(JPEG, small))).toEqual(small)
  })
  it('PSD gets resource 1039 and still decodes', () => {
    const px = new Uint8ClampedArray(4 * 4 * 4).fill(200)
    const psd = encodePsd(4, 4, [{ name: 'L', visible: true, opacity: 1, blendMode: 'normal', clipping: false, pixels: { x: 0, y: 0, width: 4, height: 4, data: px } }])
    const icc = buildIcc(P3)
    const out = embedPsdIcc(psd, icc)
    expect(out.length).toBeGreaterThan(psd.length + icc.length - 2)
    const dec = decodePsd(out)
    expect(dec.width).toBe(4)
    expect(dec.layers.length).toBe(1)
    // the profile bytes are in the file
    const hay = Buffer.from(out)
    expect(hay.indexOf(Buffer.from(icc))).toBeGreaterThan(0)
    expect(embedIcc('psd', psd, 'x', icc)).toEqual(out)
    expect(embedIcc('tiff', psd, 'x', icc)).toBe(psd)
  })
})
