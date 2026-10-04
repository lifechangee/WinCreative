import { describe, expect, it } from 'vitest'
import { brightnessContrastCurve, familyFromPostScript, levelsCurve, mapAdjustment, psdColorToHex, psdTextToImported } from '../src/renderer/src/io/psdMap'

describe('PSD text mapping', () => {
  it('parses PostScript font names', () => {
    expect(familyFromPostScript('ArialMT')).toEqual({ family: 'Arial', bold: false, italic: false })
    expect(familyFromPostScript('Arial-BoldMT')).toEqual({ family: 'Arial', bold: true, italic: false })
    expect(familyFromPostScript('TimesNewRomanPS-BoldItalicMT')).toEqual({ family: 'Times New Roman', bold: true, italic: true })
    expect(familyFromPostScript(undefined).family).toBe('Segoe UI')
  })
  it('converts colours', () => {
    expect(psdColorToHex({ r: 255, g: 128, b: 0 })).toBe('#ff8000')
    expect(psdColorToHex({ fr: 1, fg: 0, fb: 0 })).toBe('#ff0000')
    expect(psdColorToHex(undefined, '#123456')).toBe('#123456')
  })
  it('maps a point-text layer to an editable text layer', () => {
    const t = psdTextToImported({
      left: 100,
      top: 200,
      right: 400,
      bottom: 260,
      text: {
        text: 'Hello\rWorld',
        transform: [1, 0, 0, 1, 100, 250],
        style: { font: { name: 'Georgia-Bold' }, fontSize: 48, fillColor: { r: 255, g: 0, b: 0 }, tracking: 100, autoLeading: true },
        styleRuns: [
          { length: 5, style: { fillColor: { r: 255, g: 0, b: 0 } } },
          { length: 6, style: { fillColor: { r: 0, g: 0, b: 255 } } }
        ],
        paragraphStyle: { justification: 'center' }
      }
    })!
    expect(t.text).toBe('Hello\nWorld')
    expect(t.style.family).toBe('Georgia')
    expect(t.style.bold).toBe(true)
    expect(t.style.size).toBe(48)
    expect(t.style.color).toBe('#ff0000')
    expect(t.style.tracking).toBeCloseTo(4.8)
    expect(t.style.align).toBe('center')
    expect(t.spans).toEqual([{ start: 5, end: 11, color: '#0000ff' }])
    expect(t.x + t.w / 2).toBeCloseTo(250) // centred on the raster's centre
  })
  it('applies the transform scale and rotation', () => {
    const t = psdTextToImported({ left: 0, top: 0, right: 10, bottom: 10, text: { text: 'x', transform: [0, 2, -2, 0, 0, 0], style: { fontSize: 10 } } })!
    expect(t.style.size).toBeCloseTo(20)
    expect(t.rot).toBeCloseTo(Math.PI / 2)
  })
  it('returns null without text', () => {
    expect(psdTextToImported({})).toBeNull()
  })
})

describe('PSD adjustment mapping', () => {
  it('hue/saturation maps onto the HSB adjustment', () => {
    const r = mapAdjustment({ type: 'hue/saturation', master: { hue: 36, saturation: 40, lightness: -20, a: 0, b: 0, c: 0, d: 0 } })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.adj.params).toEqual({ hue: 60, sat: 70, bri: 40 })
  })
  it('neutral hue/saturation is the neutral HSB point', () => {
    const r = mapAdjustment({ type: 'hue/saturation', master: { hue: 0, saturation: 0, lightness: 0 } })
    if (r.ok) expect(r.adj.params).toEqual({ hue: 50, sat: 50, bri: 50 })
  })
  it('color balance keeps its channels', () => {
    const r = mapAdjustment({ type: 'color balance', shadows: { cyanRed: 10, magentaGreen: -5, yellowBlue: 0 }, midtones: { cyanRed: 0, magentaGreen: 0, yellowBlue: 30 }, preserveLuminosity: true })
    if (r.ok) {
      expect(r.adj.id).toBe('colorBalance')
      expect(r.adj.params.shCR).toBe(10)
      expect(r.adj.params.miYB).toBe(30)
      expect(r.adj.params.preserve).toBe(1)
    } else throw new Error('not mapped')
  })
  it('curves are normalised to 0..1', () => {
    const r = mapAdjustment({ type: 'curves', rgb: [{ input: 0, output: 0 }, { input: 128, output: 64 }, { input: 255, output: 255 }] })
    if (r.ok) {
      expect(r.adj.curves!.master[1][0]).toBeCloseTo(128 / 255)
      expect(r.adj.curves!.master[1][1]).toBeCloseTo(64 / 255)
      expect(r.adj.curves!.r).toEqual([[0, 0], [1, 1]])
    } else throw new Error('not mapped')
  })
  it('levels become a curve: black point clips, gamma bends the midtones', () => {
    const c = levelsCurve({ shadowInput: 51, highlightInput: 255, shadowOutput: 0, highlightOutput: 255, midtoneInput: 100 })
    expect(c[0][1]).toBe(0)
    expect(c[c.length - 1][1]).toBe(1)
    expect(c.find((p) => Math.abs(p[0] - 1 / 12) < 1e-6)![1]).toBeCloseTo(0.0) // below the black point
    const g = levelsCurve({ shadowInput: 0, highlightInput: 255, shadowOutput: 0, highlightOutput: 255, midtoneInput: 200 })
    expect(g[6][1]).toBeGreaterThan(0.5) // gamma 2 brightens
  })
  it('brightness/contrast is approximated by a curve', () => {
    const c = brightnessContrastCurve(60, 0)
    expect(c[6][1]).toBeGreaterThan(0.5)
    const hi = brightnessContrastCurve(0, 60)
    expect(hi[3][1]).toBeLessThan(0.25)
    expect(hi[9][1]).toBeGreaterThan(0.75)
    const r = mapAdjustment({ type: 'brightness/contrast', brightness: 10, contrast: 20 })
    expect(r.ok && r.adj.approx).toBe(true)
  })
  it('invert is supported, unknown kinds report their type', () => {
    expect(mapAdjustment({ type: 'invert' })).toEqual({ ok: true, adj: { id: 'invert', params: {} } })
    expect(mapAdjustment({ type: 'posterize' })).toEqual({ ok: false, reason: 'posterize' })
  })
})
