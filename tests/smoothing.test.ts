import { describe, expect, it } from 'vitest'
import { PathSmoother } from '../src/renderer/src/core/smoothing'
import type { Sample } from '../src/renderer/src/core/types'

const S = (x: number, y: number, t: number): Sample => ({ x, y, pressure: 1, tiltX: 0, tiltY: 0, twist: 0, t })

describe('PathSmoother', () => {
  it('is a passthrough at amount 0', () => {
    const s = new PathSmoother({ amount: 0, mode: 'exp', lazyRadius: 20 })
    s.push(S(0, 0, 0))
    expect(s.push(S(10, 5, 8))).toMatchObject({ x: 10, y: 5 })
  })

  it('lags behind the pointer with exp smoothing and converges via finish()', () => {
    const s = new PathSmoother({ amount: 0.8, mode: 'exp', lazyRadius: 20 })
    s.push(S(0, 0, 0))
    const p = s.push(S(100, 0, 8))
    expect(p.x).toBeGreaterThan(0)
    expect(p.x).toBeLessThan(100)
    const tail = s.finish()
    expect(tail.length).toBeGreaterThan(0)
    expect(tail[tail.length - 1].x).toBe(100)
  })

  it('more smoothing lags more', () => {
    const a = new PathSmoother({ amount: 0.3, mode: 'exp', lazyRadius: 20 })
    const b = new PathSmoother({ amount: 0.9, mode: 'exp', lazyRadius: 20 })
    a.push(S(0, 0, 0))
    b.push(S(0, 0, 0))
    expect(a.push(S(100, 0, 8)).x).toBeGreaterThan(b.push(S(100, 0, 8)).x)
  })

  it('is time-normalised (two 8ms steps ~ one 16ms step)', () => {
    const a = new PathSmoother({ amount: 0.7, mode: 'exp', lazyRadius: 20 })
    const b = new PathSmoother({ amount: 0.7, mode: 'exp', lazyRadius: 20 })
    a.push(S(0, 0, 0))
    b.push(S(0, 0, 0))
    a.push(S(100, 0, 8))
    const x1 = a.push(S(100, 0, 16)).x
    const x2 = b.push(S(100, 0, 16)).x
    expect(Math.abs(x1 - x2)).toBeLessThan(2.5)
  })

  it('lazy brush ignores movement inside the dead-zone radius', () => {
    const s = new PathSmoother({ amount: 1, mode: 'lazy', lazyRadius: 20 })
    s.push(S(0, 0, 0))
    expect(s.push(S(10, 0, 8)).x).toBe(0)
    expect(s.push(S(50, 0, 16)).x).toBeCloseTo(30, 5)
  })
})
