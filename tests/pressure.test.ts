import { describe, expect, it } from 'vitest'
import { gammaCurve, LINEAR_CURVE, makePressureCurve } from '../src/renderer/src/core/pressure'
import { computeDab, makeRng, sizeAt } from '../src/renderer/src/core/dynamics'
import { normalizeBrush } from '../src/renderer/src/core/brush'

describe('pressure curve', () => {
  it('linear is identity', () => {
    const f = makePressureCurve(LINEAR_CURVE)
    for (const p of [0, 0.25, 0.5, 0.8, 1]) expect(f(p)).toBeCloseTo(p, 6)
  })
  it('clamps input', () => {
    const f = makePressureCurve(LINEAR_CURVE)
    expect(f(-1)).toBe(0)
    expect(f(2)).toBe(1)
  })
  it('is monotone for monotone control points', () => {
    const f = makePressureCurve({ points: [[0, 0], [0.2, 0.05], [0.6, 0.9], [1, 1]] })
    let prev = -1
    for (let i = 0; i <= 200; i++) {
      const v = f(i / 200)
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = v
    }
  })
  it('passes through control points', () => {
    const f = makePressureCurve({ points: [[0, 0], [0.5, 0.8], [1, 1]] })
    expect(f(0.5)).toBeCloseTo(0.8, 6)
  })
  it('gamma above 1 needs harder press, below 1 softer', () => {
    expect(makePressureCurve(gammaCurve(2))(0.5)).toBeLessThan(0.5)
    expect(makePressureCurve(gammaCurve(0.5))(0.5)).toBeGreaterThan(0.5)
  })
})

describe('dynamics', () => {
  const b = normalizeBrush({ id: 't', name: 't', dynamics: { pressureSize: 1, pressureOpacity: 0.5 } })
  const ctx = { baseSize: 100, curve: (p: number) => p, rand: makeRng(1) }
  const pt = { x: 5, y: 6, pressure: 0.5, tiltX: 0, tiltY: 0, twist: 0, t: 0, angle: 0, distance: 100 }
  it('pressure drives size and alpha', () => {
    expect(sizeAt(b, 100, 0.5)).toBeCloseTo(50)
    const d = computeDab(b, pt, ctx)
    expect(d.size).toBeCloseTo(50)
    expect(d.alpha).toBeCloseTo(0.75)
    expect(d.x).toBe(5)
  })
  it('seeded rng is deterministic', () => {
    const a = makeRng(42)
    const c = makeRng(42)
    expect([a(), a(), a()]).toEqual([c(), c(), c()])
  })
  it('scatter and jitter stay in range', () => {
    const j = normalizeBrush({ id: 'j', name: 'j', dynamics: { scatter: 0.5, sizeJitter: 0.5, angleJitter: 90 } })
    for (let i = 0; i < 50; i++) {
      const d = computeDab(j, pt, ctx)
      expect(Math.abs(d.x - 5)).toBeLessThanOrEqual(0.5 * 100)
      expect(d.size).toBeLessThanOrEqual(100)
      expect(Math.abs(d.angle)).toBeLessThanOrEqual(Math.PI / 2 + 1e-6)
    }
  })
})
