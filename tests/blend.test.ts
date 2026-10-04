import { describe, expect, it } from 'vitest'
import { BLEND_MODES, blendColor, compositePremult, RGB } from '../src/renderer/src/core/blend'

const near = (a: RGB, b: RGB): void => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 5))

describe('blend reference', () => {
  const cb: RGB = [0.2, 0.5, 0.8]
  const cs: RGB = [0.6, 0.3, 0.9]
  it('normal returns source', () => near(blendColor('normal', cb, cs), cs))
  it('multiply and screen', () => {
    near(blendColor('multiply', cb, cs), [0.12, 0.15, 0.72])
    near(blendColor('screen', cb, cs), [0.68, 0.65, 0.98])
  })
  it('multiply by white and screen by black are identity', () => {
    near(blendColor('multiply', cb, [1, 1, 1]), cb)
    near(blendColor('screen', cb, [0, 0, 0]), cb)
  })
  it('overlay = hardLight with swapped args', () => {
    near(blendColor('overlay', cb, cs), blendColor('hardLight', cs, cb))
  })
  it('difference, exclusion, add, darken, lighten', () => {
    near(blendColor('difference', cb, cs), [0.4, 0.2, 0.1])
    near(blendColor('exclusion', cb, cs), [0.2 + 0.6 - 0.24, 0.5 + 0.3 - 0.3, 0.8 + 0.9 - 1.44])
    near(blendColor('add', cb, cs), [0.8, 0.8, 1])
    near(blendColor('darken', cb, cs), [0.2, 0.3, 0.8])
    near(blendColor('lighten', cb, cs), [0.6, 0.5, 0.9])
  })
  it('dodge and burn edge cases', () => {
    near(blendColor('colorDodge', [0, 0.5, 0.5], [1, 1, 0.5]), [0, 1, 1])
    near(blendColor('colorBurn', [1, 0.5, 0.5], [0, 0, 0.5]), [1, 0, 0])
  })
  it('soft light with 50% grey source is identity', () => near(blendColor('softLight', cb, [0.5, 0.5, 0.5]), cb))
  it('non-separable modes stay in range', () => {
    for (const m of ['hue', 'saturation', 'color', 'luminosity'] as const) {
      blendColor(m, cb, cs).forEach((v) => {
        expect(v).toBeGreaterThanOrEqual(-1e-9)
        expect(v).toBeLessThanOrEqual(1 + 1e-9)
      })
    }
  })
  it('color blend takes source hue with backdrop luminance', () => {
    const r = blendColor('color', [0.5, 0.5, 0.5], [1, 0, 0])
    expect(0.3 * r[0] + 0.59 * r[1] + 0.11 * r[2]).toBeCloseTo(0.5, 5)
    expect(r[0]).toBeGreaterThan(r[1])
  })
  it('has all 26 modes', () => expect(BLEND_MODES.length).toBe(26))
  it('extended modes', () => {
    near(blendColor('linearBurn', cb, cs), [0, 0, 0.7])
    near(blendColor('subtract', cb, cs), [0, 0.2, 0])
    near(blendColor('divide', [0.2, 0.5, 0.5], [0.5, 0.25, 0]), [0.4, 1, 1])
    near(blendColor('hardMix', cb, cs), [0, 0, 1])
    near(blendColor('darkerColor', cb, cs), cb)
    near(blendColor('lighterColor', cb, cs), cs)
    near(blendColor('linearLight', cb, [0.5, 0.5, 0.5]), cb)
  })
})

describe('compositePremult', () => {
  it('opaque normal source replaces backdrop', () => {
    expect(compositePremult('normal', [0.2, 0.2, 0.2, 1], [1, 0, 0, 1])).toEqual([1, 0, 0, 1])
  })
  it('50% normal over opaque mixes linearly', () => {
    const r = compositePremult('normal', [0, 0, 0, 1], [1, 1, 1, 1], 0.5)
    near([r[0], r[1], r[2]], [0.5, 0.5, 0.5])
    expect(r[3]).toBeCloseTo(1)
  })
  it('over transparent backdrop keeps source', () => {
    const r = compositePremult('multiply', [0, 0, 0, 0], [0.5, 0.25, 0, 0.5])
    near([r[0], r[1], r[2]], [0.5, 0.25, 0])
    expect(r[3]).toBeCloseTo(0.5)
  })
  it('multiply over opaque backdrop', () => {
    const r = compositePremult('multiply', [0.5, 0.5, 0.5, 1], [1, 0, 0, 1])
    near([r[0], r[1], r[2]], [0.5, 0, 0])
  })
})
