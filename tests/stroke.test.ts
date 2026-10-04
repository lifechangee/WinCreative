import { describe, expect, it } from 'vitest'
import { StrokeBuilder, catmullRom } from '../src/renderer/src/core/stroke'
import type { Sample } from '../src/renderer/src/core/types'

const S = (x: number, y: number, p = 1, t = 0): Sample => ({ x, y, pressure: p, tiltX: 0, tiltY: 0, twist: 0, t })

function run(points: Sample[], spacing: number | ((s: Sample) => number)) {
  const b = new StrokeBuilder(typeof spacing === 'number' ? () => spacing : spacing)
  const out = []
  for (const p of points) out.push(...b.push(p))
  out.push(...b.end())
  return out
}

describe('StrokeBuilder spacing', () => {
  it('places dabs at exact even spacing along a straight line', () => {
    const pts = [S(0, 0), S(37.3, 0), S(80, 0), S(101.7, 0)]
    const dabs = run(pts, 5)
    expect(dabs[0].x).toBe(0)
    for (let i = 1; i < dabs.length; i++) expect(dabs[i].x - dabs[i - 1].x).toBeCloseTo(5, 3)
    expect(dabs.length).toBe(Math.floor(101.7 / 5) + 1)
  })

  it('carries the remainder across segments (no reset at sample boundaries)', () => {
    const many: Sample[] = []
    for (let i = 0; i <= 100; i++) many.push(S(i * 1.37, 0))
    const dabs = run(many, 4.2)
    for (let i = 1; i < dabs.length; i++) expect(dabs[i].x - dabs[i - 1].x).toBeCloseTo(4.2, 3)
  })

  it('emits a single dab for a tap', () => {
    expect(run([S(10, 10)], 3).length).toBe(1)
  })

  it('interpolates pressure between samples', () => {
    const dabs = run([S(0, 0, 0), S(100, 0, 1), S(200, 0, 1)], 10)
    const mid = dabs.find((d) => Math.abs(d.x - 50) < 0.5)!
    expect(mid.pressure).toBeGreaterThan(0.4)
    expect(mid.pressure).toBeLessThan(0.6)
    for (let i = 1; i < dabs.length; i++) expect(dabs[i].pressure).toBeGreaterThanOrEqual(dabs[i - 1].pressure - 1e-9)
  })

  it('uses sub-pixel (non-rounded) positions', () => {
    const dabs = run([S(0, 0), S(50, 3.3), S(100, 0)], 2.5)
    expect(dabs.some((d) => d.x !== Math.round(d.x) && d.y !== Math.round(d.y))).toBe(true)
  })

  it('smooths corners: path stays continuous and passes through control points', () => {
    const dabs = run([S(0, 0), S(50, 0), S(50, 50), S(100, 50)], 1)
    for (let i = 1; i < dabs.length; i++) expect(Math.hypot(dabs[i].x - dabs[i - 1].x, dabs[i].y - dabs[i - 1].y)).toBeLessThan(1.05)
    expect(dabs.some((d) => Math.hypot(d.x - 50, d.y) < 1.2)).toBe(true)
  })

  it('reports travel direction and distance', () => {
    const dabs = run([S(0, 0), S(50, 50), S(100, 100)], 10)
    expect(dabs[3].angle).toBeCloseTo(Math.PI / 4, 2)
    expect(dabs[3].distance).toBeGreaterThan(dabs[2].distance)
  })

  it('supports pressure-dependent spacing', () => {
    const dabs = run([S(0, 0, 1), S(200, 0, 0.1), S(400, 0, 0.1)], (s) => 2 + s.pressure * 20)
    const gaps = dabs.slice(1).map((d, i) => d.x - dabs[i].x)
    expect(gaps[0]).toBeGreaterThan(gaps[gaps.length - 1])
  })

  it('catmullRom hits endpoints', () => {
    expect(catmullRom(0, 1, 2, 3, 0)).toBeCloseTo(1)
    expect(catmullRom(0, 1, 2, 3, 1)).toBeCloseTo(2)
  })
})
