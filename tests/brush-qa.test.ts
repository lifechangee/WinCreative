import { describe, expect, it } from 'vitest'
import { normalizeBrush } from '../src/renderer/src/core/brush'
import { usesMaxCoverage } from '../src/renderer/src/gl/brushEngine'
import { hardJumpFrac, lineStats } from '../src/renderer/src/features/brushes/qa/metrics'

describe('max-coverage stamping choice', () => {
  it('plain full-flow round brushes use MAX (no edge saturation)', () => {
    expect(usesMaxCoverage(normalizeBrush({ id: 'a', name: 'a', hardness: 1, flow: 1 }))).toBe(true)
  })
  it('low flow, textured or colour-dynamic brushes keep build-up', () => {
    expect(usesMaxCoverage(normalizeBrush({ id: 'b', name: 'b', flow: 0.5 }))).toBe(false)
    expect(usesMaxCoverage(normalizeBrush({ id: 'b2', name: 'b2', flow: 0.9 }))).toBe(true)
    expect(usesMaxCoverage(normalizeBrush({ id: 'c', name: 'c', flow: 1, grain: { texture: 'grain-paper', depth: 0.5 } }))).toBe(false)
    expect(usesMaxCoverage(normalizeBrush({ id: 'd', name: 'd', flow: 1, color: { stampJitter: { hue: 0.1 } } }))).toBe(false)
  })
})

describe('qa metrics', () => {
  it('detects aliased vs anti-aliased edges', () => {
    const w = 40
    const h = 40
    const alias = new Uint8Array(w * h)
    const aa = new Uint8Array(w * h)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const d = y - 0.3 * x - 10
        alias[y * w + x] = d > 0 && d < 8 ? 255 : 0
        aa[y * w + x] = Math.round(255 * Math.max(0, Math.min(1, Math.min(d + 0.5, 8.5 - d))))
      }
    expect(hardJumpFrac({ w, h, a: alias }).frac).toBeGreaterThan(0.9)
    expect(hardJumpFrac({ w, h, a: aa }).frac).toBeLessThan(0.1)
    expect(lineStats({ w, h, a: aa }, 0, 10, 0.3, 40, 10, 6).centroidRms).toBeLessThan(0.05)
    expect(lineStats({ w, h, a: alias }, 0, 10, 0.3, 40, 10, 6).centroidRms).toBeGreaterThan(0.1)
  })
})
