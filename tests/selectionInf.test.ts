import { describe, expect, it } from 'vitest'
import { combinePatch, floodFillIn, polygonClip, rasterizePolygonIn, rectPolygon, softenPatchIn } from '../src/renderer/src/features/selectxform/geom'
import { chunkPlan } from '../src/renderer/src/features/selectxform/xformInf'

describe('rect-relative selection maths (infinite canvas)', () => {
  it('rasterises a polygon at negative document coordinates', () => {
    const p = rasterizePolygonIn(rectPolygon(-1000, -2000, -900, -1950), { x: -1002, y: -2002, w: 110, h: 60 })!
    expect(p.rect).toEqual({ x: -1000, y: -2000, w: 100, h: 50 })
    expect(p.data.every((v) => v === 255)).toBe(true)
  })
  it('clips the polygon to the given rect', () => {
    const p = rasterizePolygonIn(rectPolygon(-50, -50, 50, 50), { x: 0, y: 0, w: 20, h: 20 })!
    expect(p.rect).toEqual({ x: 0, y: 0, w: 20, h: 20 })
  })
  it('polygonClip limits the window and reports it', () => {
    const a = polygonClip(rectPolygon(10, 10, 110, 60), 8192)
    expect(a.clipped).toBe(false)
    expect(a.rect.w).toBeGreaterThanOrEqual(100)
    const b = polygonClip(rectPolygon(0, 0, 20000, 10), 8192)
    expect(b.clipped).toBe(true)
    expect(b.rect.w).toBe(8192)
  })
  it('flood fill on an area keeps document coordinates and stops at the area border', () => {
    const w = 40
    const h = 30
    const px = new Uint8ClampedArray(w * h * 4).fill(255) // all opaque white
    for (let y = 0; y < h; y++) {
      px.set([0, 0, 0, 255], (y * w + 20) * 4) // vertical black wall at local x = 20
    }
    const f = floodFillIn(px, { x: -5000, y: 7000, w, h }, -4990, 7010, 0.1)!
    expect(f.rect).toEqual({ x: -5000, y: 7000, w: 20, h: 30 })
    const s = softenPatchIn(f, { x: -5000, y: 7000, w, h })
    expect(s.rect.x).toBeGreaterThanOrEqual(-5000)
    expect(s.rect.x + s.rect.w).toBeLessThanOrEqual(-5000 + w)
  })
  it('combinePatch works on a window-relative buffer', () => {
    const win = new Uint8Array(10 * 10)
    combinePatch(win, 10, { rect: { x: 2, y: 3, w: 2, h: 2 }, data: new Uint8Array(4).fill(200) }, 'add')
    expect(win[3 * 10 + 2]).toBe(200)
    combinePatch(win, 10, { rect: { x: 2, y: 3, w: 1, h: 1 }, data: new Uint8Array([255]) }, 'subtract')
    expect(win[3 * 10 + 2]).toBe(0)
  })
})

describe('transform source chunking', () => {
  const app = { gpu: { maxTexture: 16384 } } as never
  it('uses a single chunk when the source fits the GPU', () => {
    const p = chunkPlan(app, { x: -100, y: -100, w: 3000, h: 2000 }, 2, 8)
    expect(p.cores).toHaveLength(1)
    expect(p.halo).toBe(2)
  })
  it('splits huge sources into a grid that covers them exactly, each cell within the texture limit', () => {
    const src = { x: -9000, y: 100, w: 10000, h: 5000 }
    const p = chunkPlan(app, src, 2, 8)
    expect(p.halo).toBe(8)
    let area = 0
    for (const c of p.cores) {
      expect(c.w + 2 * p.halo).toBeLessThanOrEqual(4096)
      expect(c.h + 2 * p.halo).toBeLessThanOrEqual(4096)
      area += c.w * c.h
    }
    expect(area).toBe(src.w * src.h)
  })
})
