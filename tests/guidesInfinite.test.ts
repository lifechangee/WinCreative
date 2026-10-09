import { describe, expect, it } from 'vitest'
import { assistCandidates, defaultGuide, infiniteAnchor, normalizeGuide, snapToFamily, snapTargetsFor } from '../src/renderer/src/features/guides/model'

describe('guides on an infinite canvas', () => {
  it('snaps to grid lines through an arbitrary origin', () => {
    const p = snapToFamily({ x: 100030, y: -50000 }, { x: 1, y: 0 }, 64, { x: 0, y: 1000 })
    expect(p.x).toBe(100030)
    expect(Math.abs((p.y - 1000) % 64)).toBeCloseTo(0)
    expect(snapToFamily({ x: 5, y: 70 }, { x: 1, y: 0 }, 64).y).toBe(64) // default origin = doc origin (fixed docs unchanged)
  })
  it('assist candidates follow gridOrigin', () => {
    const g = { ...defaultGuide(100, 100), type: 'grid' as const, gridOrigin: { x: 7, y: 13 }, gridSize: 10 }
    const lines = assistCandidates(g, { x: 1000, y: 1000 })
    expect(lines.some((l) => l.dir.x === 1 && Math.abs(((l.origin.y - 13) % 10 + 10) % 10) < 1e-6)).toBe(true)
  })
  it('anchor = centre of the frame / view box', () => {
    const a = infiniteAnchor({ x: -1000, y: 5000, w: 400, h: 200 })
    expect(a.centre).toEqual({ x: -800, y: 5100 })
    expect(a.vp.x).toBe(-800)
  })
  it('state round-trips gridOrigin and placed', () => {
    const g = normalizeGuide({ gridOrigin: { x: 5, y: 6 }, placed: true }, 10, 10)
    expect(g.gridOrigin).toEqual({ x: 5, y: 6 })
    expect(g.placed).toBe(true)
  })
  it('snap targets cover the given box only', () => {
    const g = { ...defaultGuide(10, 10), enabled: true, gridSize: 100, gridOrigin: { x: 50, y: 0 } }
    const t = snapTargetsFor(g, 10, 10, { x: 10000, y: 0, w: 300, h: 250 })
    expect(t.x).toEqual([10050, 10150, 10250])
    expect(t.y).toEqual([0, 100, 200])
  })
})
