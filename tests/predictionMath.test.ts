import { describe, expect, it } from 'vitest'
import { MAX_EXTENSION, smoothExtension, type Vec } from '../src/renderer/src/input/predictionMath'

describe('smoothExtension', () => {
  it('clamps overshoot', () => {
    let e: Vec | null = null
    for (let i = 0; i < 50; i++) e = smoothExtension(e, { x: 500, y: 0 }, { x: 5, y: 0 })
    expect(Math.hypot(e!.x, e!.y)).toBeLessThanOrEqual(MAX_EXTENSION + 1e-6)
  })
  it('never points against the motion and decays instead of flipping', () => {
    let e: Vec = { x: 10, y: 0 }
    for (let i = 0; i < 10; i++) {
      e = smoothExtension(e, { x: -30, y: 0 }, { x: 5, y: 0 })
      expect(e.x).toBeGreaterThanOrEqual(0)
    }
  })
  it('changes smoothly between noisy inputs', () => {
    let e: Vec | null = null
    let prev = 0
    let maxStep = 0
    for (let i = 0; i < 100; i++) {
      e = smoothExtension(e, { x: i % 2 ? 40 : 4, y: 0 }, { x: 5, y: 0 })
      if (i > 5) maxStep = Math.max(maxStep, Math.abs(e.x - prev))
      prev = e.x
    }
    expect(maxStep).toBeLessThan(8)
  })
})
