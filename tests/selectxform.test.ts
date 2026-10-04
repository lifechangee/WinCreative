import { describe, expect, it } from 'vitest'
import { blurMask, combinePatch, ellipsePolygon, floodFill, maskBounds, rasterizePolygon, rectPolygon, uniformBox } from '../src/renderer/src/features/selectxform/geom'
import {
  applyH,
  distortQuad,
  evalNet,
  flipNet,
  makeNet,
  netCorners,
  pointInQuad,
  resampleNet,
  rotatePt,
  scaleQuad,
  snapAngle,
  snapDelta,
  solveHomography,
  tessellate,
  warpDrag
} from '../src/renderer/src/features/selectxform/xformMath'

const sum = (a: Uint8Array): number => a.reduce((s, v) => s + v, 0)

describe('polygon rasterisation', () => {
  it('fills an integer rect exactly', () => {
    const p = rasterizePolygon(rectPolygon(2, 3, 6, 8), 20, 20)!
    expect(p.rect).toEqual({ x: 2, y: 3, w: 4, h: 5 })
    expect(p.data.every((v) => v === 255)).toBe(true)
  })
  it('anti-aliases fractional edges', () => {
    const p = rasterizePolygon(rectPolygon(0.5, 0, 3, 2), 10, 10)!
    expect(p.data[0]).toBeGreaterThan(120)
    expect(p.data[0]).toBeLessThan(135)
    expect(p.data[1]).toBe(255)
  })
  it('area of a circle is close to pi r^2', () => {
    const p = rasterizePolygon(ellipsePolygon(10, 10, 110, 110), 200, 200)!
    const area = sum(p.data) / 255
    expect(Math.abs(area - Math.PI * 2500) / (Math.PI * 2500)).toBeLessThan(0.01)
  })
  it('clips to the canvas and rejects degenerate polygons', () => {
    const p = rasterizePolygon(rectPolygon(-10, -10, 5, 5), 20, 20)!
    expect(p.rect).toEqual({ x: 0, y: 0, w: 5, h: 5 })
    expect(rasterizePolygon([{ x: 0, y: 0 }, { x: 1, y: 1 }], 10, 10)).toBeNull()
    expect(rasterizePolygon(rectPolygon(30, 30, 40, 40), 20, 20)).toBeNull()
  })
  it('handles concave polygons', () => {
    const L = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 10 }, { x: 0, y: 10 }]
    const p = rasterizePolygon(L, 20, 20)!
    expect(sum(p.data) / 255).toBeCloseTo(10 * 4 + 4 * 6, 0)
  })
  it('uniform box is square', () => {
    const [x, y] = uniformBox(10, 10, 50, 30)
    expect(x - 10).toBe(y - 10)
  })
})

describe('mask combination / blur / bounds', () => {
  it('add is a union, subtract removes', () => {
    const w = 10
    const m = new Uint8Array(w * w)
    combinePatch(m, w, rasterizePolygon(rectPolygon(0, 0, 5, 5), w, w)!, 'add')
    combinePatch(m, w, rasterizePolygon(rectPolygon(3, 3, 8, 8), w, w)!, 'add')
    expect(m[0]).toBe(255)
    expect(m[7 * w + 7]).toBe(255)
    expect(m[4 * w + 4]).toBe(255)
    combinePatch(m, w, rasterizePolygon(rectPolygon(3, 3, 8, 8), w, w)!, 'subtract')
    expect(m[4 * w + 4]).toBe(0)
    expect(m[0]).toBe(255)
    expect(maskBounds(m, w, w)).toEqual({ x: 0, y: 0, w: 5, h: 5 })
  })
  it('blur preserves mass approximately and softens edge', () => {
    const w = 64
    const m = new Uint8Array(w * w)
    combinePatch(m, w, rasterizePolygon(rectPolygon(24, 24, 40, 40), w, w)!, 'add')
    const before = sum(m)
    blurMask(m, w, { x: 0, y: 0, w, h: w }, 6)
    expect(Math.abs(sum(m) - before) / before).toBeLessThan(0.02)
    expect(m[32 * w + 23]).toBeGreaterThan(0)
    expect(m[32 * w + 23]).toBeLessThan(255)
    expect(m[32 * w + 32]).toBeGreaterThan(200)
  })
})

describe('flood fill', () => {
  const mk = (w: number, h: number, f: (x: number, y: number) => number[]): Uint8ClampedArray => {
    const a = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a.set(f(x, y), (y * w + x) * 4)
    return a
  }
  it('selects a contiguous region only', () => {
    const px = mk(10, 10, (x) => (x === 5 ? [0, 0, 0, 255] : [255, 255, 255, 255]))
    const r = floodFill(px, 10, 10, 1, 1, 0.1)!
    expect(r.rect).toEqual({ x: 0, y: 0, w: 5, h: 10 })
    expect(sum(r.data) / 255).toBe(50)
  })
  it('threshold widens the selection', () => {
    const px = mk(10, 1, (x) => [x * 20, x * 20, x * 20, 255])
    const lo = floodFill(px, 10, 1, 0, 0, 0.05)!
    const hi = floodFill(px, 10, 1, 0, 0, 0.5)!
    expect(lo.rect.w).toBeLessThan(hi.rect.w)
  })
  it('transparent region fill', () => {
    const px = mk(6, 6, (x, y) => (x < 3 && y < 3 ? [10, 20, 30, 255] : [0, 0, 0, 0]))
    const r = floodFill(px, 6, 6, 5, 5, 0.05)!
    expect(sum(r.data) / 255).toBe(36 - 9)
  })
})

describe('homography and nets', () => {
  it('maps the unit square to a quad', () => {
    const dst = [{ x: 10, y: 10 }, { x: 50, y: 20 }, { x: 60, y: 70 }, { x: 5, y: 60 }]
    const H = solveHomography([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], dst)!
    for (const [i, [u, v]] of [[0, 0], [1, 0], [1, 1], [0, 1]].entries()) {
      const p = applyH(H, u, v)
      expect(p.x).toBeCloseTo(dst[i].x, 6)
      expect(p.y).toBeCloseTo(dst[i].y, 6)
    }
  })
  it('spline net interpolates its control points and is identity on a regular grid', () => {
    const n = makeNet({ x: 0, y: 0, w: 90, h: 60 }, 3, 2)
    const p = evalNet(n, 0.4, 0.7)
    expect(p.x).toBeCloseTo(36, 6)
    expect(p.y).toBeCloseTo(42, 6)
    const moved = { ...n, pts: n.pts.map((q, i) => (i === 5 ? { x: q.x + 10, y: q.y - 5 } : q)) }
    const at = evalNet(moved, 1 / 3, 0.5)
    expect(at.x).toBeCloseTo(30 + 10, 6)
    expect(at.y).toBeCloseTo(30 - 5, 6)
  })
  it('1x1 net corners are ordered TL, TR, BR, BL', () => {
    const q = netCorners(makeNet({ x: 0, y: 0, w: 10, h: 20 }, 1, 1))
    expect(q).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }, { x: 0, y: 20 }])
  })
  it('resample keeps corners', () => {
    const n = makeNet({ x: 5, y: 5, w: 100, h: 100 }, 1, 1)
    const r = resampleNet(n, 4, 4)
    expect(netCorners(r)).toEqual(netCorners(n))
    expect(r.pts.length).toBe(25)
  })
  it('tessellation covers the net corners', () => {
    const m = tessellate(makeNet({ x: 0, y: 0, w: 10, h: 10 }, 2, 2), 3)
    expect(m.verts.length / 4).toBe(49)
    expect(m.indices.length).toBe(6 * 6 * 6)
    expect([m.verts[0], m.verts[1], m.verts[2], m.verts[3]]).toEqual([0, 0, 0, 0])
  })
  it('flip reverses columns / rows', () => {
    const n = makeNet({ x: 0, y: 0, w: 10, h: 10 }, 2, 1)
    const f = flipNet(n, 'h')
    expect(f.pts[0].x).toBe(10)
    expect(flipNet(f, 'h')).toEqual(n)
    expect(flipNet(n, 'v').pts[0].y).toBe(10)
  })
  it('warpDrag moves only points in radius', () => {
    const n = makeNet({ x: 0, y: 0, w: 100, h: 100 }, 4, 4)
    const w = warpDrag(n, { x: 0, y: 0 }, { x: 5, y: 5 }, 30)
    expect(w.pts[0].x).toBeCloseTo(5, 6)
    expect(w.pts[24].x).toBe(100)
  })
})

describe('handles, snapping', () => {
  const box = (): [any, any, any, any] => [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }]
  it('freeform corner scales about the opposite corner', () => {
    const q = scaleQuad(box(), { hx: 1, hy: 1 }, { x: 200, y: 150 }, false)
    expect(q[0]).toEqual({ x: 0, y: 0 })
    expect(q[2].x).toBeCloseTo(200, 6)
    expect(q[2].y).toBeCloseTo(150, 6)
  })
  it('uniform keeps aspect ratio', () => {
    const q = scaleQuad(box(), { hx: 1, hy: 1 }, { x: 200, y: 60 }, true)
    const w = q[1].x - q[0].x
    const h = q[3].y - q[0].y
    expect(w / h).toBeCloseTo(2, 6)
  })
  it('edge handle scales one axis', () => {
    const q = scaleQuad(box(), { hx: 0.5, hy: 0 }, { x: 50, y: -50 }, false)
    expect(q[2].y).toBeCloseTo(50, 6)
    expect(q[0].y).toBeCloseTo(-50, 6)
    expect(q[1].x).toBeCloseTo(100, 6)
  })
  it('scales in a rotated frame', () => {
    const r = box().map((p) => rotatePt(p, { x: 0, y: 0 }, Math.PI / 2)) as any
    const q = scaleQuad(r, { hx: 1, hy: 0.5 }, rotatePt({ x: 200, y: 25 }, { x: 0, y: 0 }, Math.PI / 2), false)
    const w = Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y)
    expect(w).toBeCloseTo(200, 5)
  })
  it('distort moves single corner', () => {
    const q = distortQuad(box(), { hx: 1, hy: 0 }, { x: 10, y: -10 })
    expect(q[1]).toEqual({ x: 110, y: -10 })
    expect(q[2]).toEqual({ x: 100, y: 50 })
  })
  it('snapDelta / snapAngle', () => {
    expect(snapDelta([98, 130], [0, 100, 200], 5)).toEqual({ delta: 2, target: 100 })
    expect(snapDelta([50], [0, 100], 5)).toBeNull()
    expect(snapAngle(0.26, Math.PI / 12, 0.05).snapped).toBe(true)
    expect(snapAngle(0.2, Math.PI / 12, 0.02).snapped).toBe(false)
  })
  it('pointInQuad', () => {
    expect(pointInQuad(box(), { x: 10, y: 10 })).toBe(true)
    expect(pointInQuad(box(), { x: 110, y: 10 })).toBe(false)
  })
})

import { bendAmount, bendNet, bendProfile, makeNet as mkNet, netCorners as nCorners } from '../src/renderer/src/features/selectxform/xformMath'
describe('bend', () => {
  it('profile is 0 at the ends and 1 in the middle', () => {
    expect(bendProfile(0)).toBe(0)
    expect(bendProfile(1)).toBe(0)
    expect(bendProfile(0.5)).toBe(1)
  })
  it('keeps corners fixed and pushes the middle by the amount', () => {
    const n = mkNet({ x: 0, y: 0, w: 100, h: 50 }, 4, 4)
    const b = bendNet(n, nCorners(n), 'h', 20)
    const c = nCorners(b)
    expect(c[0]).toEqual({ x: 0, y: 0 })
    expect(c[1]).toEqual({ x: 100, y: 0 })
    expect(b.pts[2].y).toBeCloseTo(20) // top row, middle column
    expect(b.pts[2].x).toBeCloseTo(50)
    expect(bendAmount(nCorners(n), 'h', { x: 5, y: 12 })).toBeCloseTo(12)
    expect(bendAmount(nCorners(n), 'v', { x: 5, y: 12 })).toBeCloseTo(5)
  })
})
