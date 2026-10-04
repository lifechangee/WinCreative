import { describe, expect, it } from 'vitest'
import { hoverOpacity, hoverSize } from '../src/renderer/src/input/hoverAdjust'

describe('hover adjust', () => {
  it('size grows to the right and shrinks to the left, never below 1', () => {
    expect(hoverSize(20, 40)).toBeGreaterThan(20)
    expect(hoverSize(20, -40)).toBeLessThan(20)
    expect(hoverSize(1, -300)).toBeGreaterThanOrEqual(1)
    expect(hoverSize(5, 1)).toBeGreaterThan(5) // a tiny move still changes a small brush
  })
  it('opacity is clamped', () => {
    expect(hoverOpacity(0.5, 100)).toBeCloseTo(0.75)
    expect(hoverOpacity(0.95, 100)).toBe(1)
    expect(hoverOpacity(0.05, -100)).toBe(0.01)
  })
})
