import { describe, expect, it } from 'vitest'
import { FRAME_PRESETS, aspectLabel, dragFrame, effectiveClip, fitOutputSize, intersectRect, letterbox, lockedSize, normalizeFrame, presetById } from '../src/renderer/src/features/frame/model'

describe('frame model', () => {
  it('has the agreed presets', () => {
    const sz = (id: string): string => `${presetById(id)!.w}x${presetById(id)!.h}`
    expect(sz('reels')).toBe('1080x1920')
    expect(sz('hd')).toBe('1920x1080')
    expect(sz('uhd')).toBe('3840x2160')
    expect(sz('portrait45')).toBe('1080x1350')
    expect(sz('a4p')).toBe('2480x3508')
    expect(FRAME_PRESETS.length).toBe(8)
  })
  it('normalizes to integer pixels within limits', () => {
    const f = normalizeFrame({ x: 1.4, y: -2.6, w: 100.4, h: 5, enabled: true, visible: true }, { w: 80, h: 80 })
    expect(f).toMatchObject({ x: 1, y: -3, w: 80, h: 16 })
  })
  it('intersects rects and combines selection x frame', () => {
    expect(intersectRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toEqual({ x: 5, y: 5, w: 5, h: 5 })
    expect(intersectRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 })).toBeNull()
    expect(effectiveClip(null, null)).toBeNull()
    expect(effectiveClip(null, { x: 1, y: 1, w: 2, h: 2 })).toEqual({ x: 1, y: 1, w: 2, h: 2 })
    expect(effectiveClip({ x: 0, y: 0, w: 4, h: 4 }, { x: 10, y: 10, w: 2, h: 2 })).toBe('empty')
  })
  it('moves and resizes with handles', () => {
    const r = { x: 100, y: 100, w: 400, h: 200 }
    expect(dragFrame(r, 'move', 10.4, -5.2, false)).toEqual({ x: 110, y: 95, w: 400, h: 200 })
    expect(dragFrame(r, 'se', 50, 20, false)).toEqual({ x: 100, y: 100, w: 450, h: 220 })
    expect(dragFrame(r, 'nw', -20, -10, false)).toEqual({ x: 80, y: 90, w: 420, h: 210 })
    const l = dragFrame(r, 'e', 100, 0, true)
    expect(l.w / l.h).toBeCloseTo(2, 1)
    expect(dragFrame(r, 'w', 1000, 0, false).w).toBe(16)
  })
  it('locks aspect when typing a size', () => {
    expect(lockedSize({ w: 1080, h: 1920 }, 'w', 540)).toEqual({ w: 540, h: 960 })
    expect(lockedSize({ w: 1920, h: 1080 }, 'h', 540)).toEqual({ w: 960, h: 540 })
  })
  it('letterboxes a source into a stable output', () => {
    expect(letterbox(1080, 1920, 1080, 1920)).toEqual({ x: 0, y: 0, w: 1080, h: 1920 })
    expect(letterbox(1920, 1080, 1080, 1920)).toEqual({ x: 0, y: 656, w: 1080, h: 608 })
    expect(letterbox(1000, 1000, 400, 200)).toEqual({ x: 100, y: 0, w: 200, h: 200 })
  })
  it('computes even video sizes and labels', () => {
    expect(fitOutputSize(1080, 1920, 960)).toEqual({ w: 540, h: 960 })
    expect(aspectLabel(1080, 1920)).toBe('9:16')
    expect(aspectLabel(2480, 3508)).toBe('0.71:1')
  })
})
