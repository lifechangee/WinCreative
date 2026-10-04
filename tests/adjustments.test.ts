import { describe, expect, it } from 'vitest'
import { bakeCurveLut, bakeGradientLut, colorBalance, defaultCurves, hsbAdjust, makeCurve, sampleGradient, histogram } from '../src/renderer/src/features/adjustments/math'

describe('curves', () => {
  it('identity passes through', () => {
    const f = makeCurve([[0, 0], [1, 1]])
    for (let i = 0; i <= 10; i++) expect(f(i / 10)).toBeCloseTo(i / 10, 6)
  })
  it('interpolates control points and stays monotone', () => {
    const f = makeCurve([[0, 0], [0.5, 0.8], [1, 1]])
    expect(f(0.5)).toBeCloseTo(0.8, 6)
    let prev = -1
    for (let i = 0; i <= 100; i++) {
      const v = f(i / 100)
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9)
      expect(v).toBeLessThanOrEqual(1 + 1e-9)
      prev = v
    }
  })
  it('bakes an identity LUT', () => {
    const l = bakeCurveLut(defaultCurves())
    expect(l[0]).toBe(0)
    expect(l[255 * 4]).toBe(255)
    expect(l[128 * 4]).toBe(128)
  })
  it('composes master then channel', () => {
    const c = defaultCurves()
    c.master = [[0, 0], [1, 0.5]]
    c.r = [[0, 0], [1, 1]]
    const l = bakeCurveLut(c)
    expect(l[255 * 4]).toBe(128)
  })
})

describe('gradient', () => {
  const stops = [{ pos: 0, color: [0, 0, 0] as [number, number, number] }, { pos: 1, color: [1, 0.5, 0] as [number, number, number] }]
  it('samples linearly and clamps', () => {
    expect(sampleGradient(stops, 0.5)).toEqual([0.5, 0.25, 0])
    expect(sampleGradient(stops, -1)).toEqual([0, 0, 0])
    expect(sampleGradient(stops, 2)).toEqual([1, 0.5, 0])
  })
  it('bakes 256 entries', () => {
    const l = bakeGradientLut(stops)
    expect(l.length).toBe(1024)
    expect(l[255 * 4]).toBe(255)
    expect(l[255 * 4 + 1]).toBe(128)
  })
})

describe('colour balance / hsb', () => {
  const zero = { sh: [0, 0, 0] as [number, number, number], mi: [0, 0, 0] as [number, number, number], hi: [0, 0, 0] as [number, number, number], preserve: false }
  it('zero is identity', () => {
    expect(colorBalance([0.2, 0.5, 0.7], zero)).toEqual([0.2, 0.5, 0.7])
  })
  it('midtone red pushes red up', () => {
    const o = colorBalance([0.5, 0.5, 0.5], { ...zero, mi: [100, 0, 0] })
    expect(o[0]).toBeGreaterThan(0.5)
    expect(o[1]).toBeCloseTo(0.5, 6)
  })
  it('shadow weight does not affect highlights', () => {
    const o = colorBalance([1, 1, 1], { ...zero, sh: [-100, 0, 0] })
    expect(o).toEqual([1, 1, 1])
  })
  it('hsb neutral at 50', () => {
    const o = hsbAdjust([0.8, 0.3, 0.2], 50, 50, 50)
    expect(o[0]).toBeCloseTo(0.8, 5)
    expect(o[1]).toBeCloseTo(0.3, 5)
  })
  it('sat 0 gives grey, bri 100 gives white', () => {
    const g = hsbAdjust([0.8, 0.3, 0.2], 50, 0, 50)
    expect(g[0]).toBeCloseTo(g[1], 6)
    expect(hsbAdjust([0.4, 0.4, 0.4], 50, 50, 100)).toEqual([1, 1, 1])
  })
  it('hue 100 rotates half a turn (red -> cyan)', () => {
    const o = hsbAdjust([1, 0, 0], 100, 50, 50)
    expect(o[0]).toBeCloseTo(0, 5)
    expect(o[1]).toBeCloseTo(1, 5)
  })
})

describe('histogram', () => {
  it('counts opaque pixels only', () => {
    const h = histogram([255, 0, 0, 255, 0, 0, 0, 0])
    expect(h.r[255]).toBe(1)
    expect(h.r[0]).toBe(0)
  })
})
