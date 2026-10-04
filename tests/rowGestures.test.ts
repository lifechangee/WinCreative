import { describe, expect, it } from 'vitest'
import { classifyTwoFinger, isPinchTogether } from '../src/renderer/src/features/layers/rowGestures'

describe('layer row gestures', () => {
  it('two-finger swipe right toggles alpha lock', () => {
    expect(classifyTwoFinger(60, 5, 100, false)).toBe('swipe-right')
    expect(classifyTwoFinger(-60, 5, 100, false)).toBe('pending')
    expect(classifyTwoFinger(60, 80, 100, false)).toBe('pending')
  })
  it('two-finger tap vs hold', () => {
    expect(classifyTwoFinger(2, 1, 120, true)).toBe('tap')
    expect(classifyTwoFinger(2, 1, 800, true)).toBe('pending')
    expect(classifyTwoFinger(2, 1, 700, false)).toBe('hold')
    expect(classifyTwoFinger(2, 1, 100, false)).toBe('pending')
  })
  it('pinch together', () => {
    expect(isPinchTogether(100, 50)).toBe(true)
    expect(isPinchTogether(100, 90)).toBe(false)
    expect(isPinchTogether(30, 10)).toBe(false)
  })
})
