import { describe, expect, it } from 'vitest'
import { anchorView, docToScreen, fitView, gestureStep, panBy, rotateAt, screenToDoc, zoomAt } from '../src/renderer/src/core/viewTransform'
import { clampToCanvas, unionRect } from '../src/renderer/src/core/geometry'
import { hexToRgb, hsvToRgb, rgbToHex, rgbToHsv, sizeFromSlider, sliderFromSize } from '../src/renderer/src/app/state'

const V = { cx: 512, cy: 384, zoom: 1.7, rot: 0.6 }
describe('view transform', () => {
  it('screen<->doc round trip', () => {
    const p = screenToDoc(V, 123, 456, 1000, 800)
    const s = docToScreen(V, p.x, p.y, 1000, 800)
    expect(s.x).toBeCloseTo(123)
    expect(s.y).toBeCloseTo(456)
  })
  it('zoomAt keeps anchor fixed', () => {
    const before = screenToDoc(V, 300, 200, 1000, 800)
    const v2 = zoomAt(V, 300, 200, 2.5, 1000, 800)
    const after = screenToDoc(v2, 300, 200, 1000, 800)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
    expect(v2.zoom).toBeCloseTo(V.zoom * 2.5)
  })
  it('rotateAt keeps anchor fixed', () => {
    const before = screenToDoc(V, 700, 100, 1000, 800)
    const v2 = rotateAt(V, 700, 100, 1.1, 1000, 800)
    const after = screenToDoc(v2, 700, 100, 1000, 800)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
  })
  it('panBy moves content with the pointer', () => {
    const p = screenToDoc(V, 500, 400, 1000, 800)
    const v2 = panBy(V, 30, -12)
    const s = docToScreen(v2, p.x, p.y, 1000, 800)
    expect(s.x).toBeCloseTo(530)
    expect(s.y).toBeCloseTo(388)
  })
  it('gestureStep follows centroid', () => {
    const v2 = gestureStep(V, { x: 400, y: 300 }, { x: 450, y: 320 }, 1.2, 0.1, 1000, 800)
    const p = screenToDoc(V, 400, 300, 1000, 800)
    const s = docToScreen(v2, p.x, p.y, 1000, 800)
    expect(s.x).toBeCloseTo(450)
    expect(s.y).toBeCloseTo(320)
  })
  it('anchorView clamps zoom', () => expect(anchorView(0, 0, 0, 0, 1e6, 0, 100, 100).zoom).toBe(64))
  it('fitView fits', () => expect(fitView(2000, 1000, 1000, 800, 0).zoom).toBeCloseTo(0.5))
})

describe('geometry, colour, sliders', () => {
  it('clampToCanvas', () => {
    expect(clampToCanvas({ x: -5.5, y: 2.2, w: 20, h: 3.1 }, 10, 100)).toEqual({ x: 0, y: 2, w: 10, h: 4 })
    expect(clampToCanvas({ x: 50, y: 50, w: 5, h: 5 }, 10, 10)).toBeNull()
    expect(unionRect(null, { x: 1, y: 1, w: 2, h: 2 })).toEqual({ x: 1, y: 1, w: 2, h: 2 })
  })
  it('hsv/rgb/hex', () => {
    const rgb = hsvToRgb({ h: 210, s: 0.5, v: 0.8 })
    const back = rgbToHsv(...rgb)
    expect(back.h).toBeCloseTo(210)
    expect(back.s).toBeCloseTo(0.5)
    expect(rgbToHex([1, 0, 0.5])).toBe('#ff0080')
    expect(hexToRgb('#ff0080')![2]).toBeCloseTo(128 / 255)
    expect(hexToRgb('nope')).toBeNull()
  })
  it('size slider round-trips', () => {
    for (const px of [1, 10, 100, 600]) expect(sizeFromSlider(sliderFromSize(px))).toBeCloseTo(px, 3)
  })
})

import { toggleMirrorView } from '../src/renderer/src/core/viewTransform'
describe('mirrored view', () => {
  const v0 = { cx: 300, cy: 200, zoom: 1.5, rot: 0.4 }
  it('toggles on and off without touching the rest', () => {
    const m = toggleMirrorView(v0)
    expect(m.mirror).toBe(true)
    expect(toggleMirrorView(m)).toEqual(v0)
  })
  it('screen<->doc round-trips and mirrors about the screen centre', () => {
    const m = toggleMirrorView(v0)
    const s = docToScreen(m, 120, 340, 800, 600)
    const p = screenToDoc(m, s.x, s.y, 800, 600)
    expect(p.x).toBeCloseTo(120)
    expect(p.y).toBeCloseTo(340)
    const u = docToScreen(v0, 120, 340, 800, 600)
    expect(s.x).toBeCloseTo(800 - u.x)
    expect(s.y).toBeCloseTo(u.y)
  })
  it('zoom/rotate/pan keep the anchor under the pointer and the mirror flag', () => {
    const m = toggleMirrorView(v0)
    const before = screenToDoc(m, 500, 250, 800, 600)
    for (const nv of [zoomAt(m, 500, 250, 2, 800, 600), rotateAt(m, 500, 250, 0.5, 800, 600)]) {
      expect(nv.mirror).toBe(true)
      const after = screenToDoc(nv, 500, 250, 800, 600)
      expect(after.x).toBeCloseTo(before.x)
      expect(after.y).toBeCloseTo(before.y)
    }
    const panned = panBy(m, 40, 10)
    const a = docToScreen(panned, before.x, before.y, 800, 600)
    expect(a.x).toBeCloseTo(540)
    expect(a.y).toBeCloseTo(260)
  })
})
