import { describe, expect, it } from 'vitest'
import { applyXform, assistCandidates, defaultGuide, mapAngle, pickLine, projectOnLine, snapToFamily, symmetryTransforms, normalizeGuide } from '../src/renderer/src/features/guides/model'
import type { Pt } from '../src/renderer/src/features/guides/model'
import { arcParams, dragHandle, perfectShape, recognizeShape, shapeHandles, shapePoints } from '../src/renderer/src/features/guides/shapes'

const G = () => ({ ...defaultGuide(1000, 800), symCenter: { x: 500, y: 400 } })

describe('symmetry transforms', () => {
  it('vertical mirrors across x=cx', () => {
    const g = { ...G(), type: 'symmetry' as const, symKind: 'vertical' as const }
    const xs = symmetryTransforms(g)
    expect(xs).toHaveLength(2)
    const p = applyXform(xs[1], g.symCenter, { x: 600, y: 300 })
    expect(p.x).toBeCloseTo(400)
    expect(p.y).toBeCloseTo(300)
  })
  it('horizontal mirrors across y=cy', () => {
    const g = { ...G(), symKind: 'horizontal' as const }
    const p = applyXform(symmetryTransforms(g)[1], g.symCenter, { x: 600, y: 300 })
    expect(p.x).toBeCloseTo(600)
    expect(p.y).toBeCloseTo(500)
  })
  it('quadrant gives 4 copies incl. point reflection', () => {
    const g = { ...G(), symKind: 'quadrant' as const }
    const xs = symmetryTransforms(g)
    expect(xs).toHaveLength(4)
    const pts = xs.map((x) => applyXform(x, g.symCenter, { x: 600, y: 300 }))
    expect(pts[3].x).toBeCloseTo(400)
    expect(pts[3].y).toBeCloseTo(500)
  })
  it('radial counts: rotational only n, mirrored 2n', () => {
    const g = { ...G(), symKind: 'radial' as const, symSegments: 6 }
    expect(symmetryTransforms({ ...g, symRotational: true })).toHaveLength(6)
    expect(symmetryTransforms({ ...g, symRotational: false })).toHaveLength(12)
  })
  it('radial copies keep distance from centre and are distinct', () => {
    const g = { ...G(), symKind: 'radial' as const, symSegments: 5, symRotational: true }
    const pts = symmetryTransforms(g).map((x) => applyXform(x, g.symCenter, { x: 700, y: 400 }))
    for (const p of pts) expect(Math.hypot(p.x - 500, p.y - 400)).toBeCloseTo(200)
    expect(new Set(pts.map((p) => p.x.toFixed(2) + p.y.toFixed(2))).size).toBe(5)
  })
  it('rotated axis reflects across rotated line', () => {
    const g = { ...G(), symKind: 'vertical' as const, symAngle: 45 }
    // vertical axis rotated by 45deg -> line at 135deg; reflecting (1,0) gives (0,-1)... verify involution instead
    const x = symmetryTransforms(g)[1]
    const p = { x: 650, y: 380 }
    const q = applyXform(x, g.symCenter, applyXform(x, g.symCenter, p))
    expect(q.x).toBeCloseTo(p.x)
    expect(q.y).toBeCloseTo(p.y)
  })
  it('mapAngle agrees with transforming a direction vector', () => {
    const g = { ...G(), symKind: 'radial' as const, symSegments: 7, symRotational: false, symAngle: 20 }
    for (const x of symmetryTransforms(g)) {
      for (const a of [0.3, 1.9, -2.2]) {
        const c = { x: 0, y: 0 }
        const q = applyXform(x, c, { x: Math.cos(a), y: Math.sin(a) })
        const b = mapAngle(x, a)
        expect(Math.cos(b)).toBeCloseTo(q.x)
        expect(Math.sin(b)).toBeCloseTo(q.y)
      }
    }
  })
})

describe('assist snapping', () => {
  it('grid: locks to nearest axis and grid line', () => {
    const g = { ...G(), type: 'grid' as const, gridSize: 50, gridRotation: 0 }
    const lines = assistCandidates(g, { x: 123, y: 210 })
    expect(lines).toHaveLength(2)
    const l = pickLine(lines, { x: 30, y: 4 })!
    expect(l.dir.x).toBeCloseTo(1)
    const q = projectOnLine(l, { x: 300, y: 260 })
    expect(q.y).toBeCloseTo(200) // 210 snaps to the y=200 grid line
    expect(q.x).toBeCloseTo(300)
  })
  it('grid rotation', () => {
    const g = { ...G(), type: 'grid' as const, gridRotation: 30 }
    const lines = assistCandidates(g, { x: 0, y: 0 })
    const l = pickLine(lines, { x: Math.cos(0.5), y: Math.sin(0.5) })!
    expect(Math.atan2(l.dir.y, l.dir.x)).toBeCloseTo((30 * Math.PI) / 180)
  })
  it('snapToFamily', () => {
    const p = snapToFamily({ x: 77, y: 13 }, { x: 1, y: 0 }, 20)
    expect(p.y).toBeCloseTo(20)
    expect(p.x).toBeCloseTo(77)
  })
  it('iso has 3 directions at 90/30/150', () => {
    const g = { ...G(), type: 'iso' as const, isoPlane: 'all' as const }
    const lines = assistCandidates(g, { x: 10, y: 10 })
    expect(lines).toHaveLength(3)
    const l = pickLine(lines, { x: Math.cos(-0.5), y: Math.sin(-0.5) })!
    expect(Math.atan2(l.dir.y, l.dir.x)).toBeCloseTo(-Math.PI / 6)
    expect(assistCandidates({ ...g, isoPlane: 'top' }, { x: 0, y: 0 })).toHaveLength(2)
  })
  it('perspective: lines point at vanishing point', () => {
    const g = { ...G(), type: 'perspective' as const, vps: [{ x: 1000, y: 400 }, { x: -200, y: 400 }] }
    const start = { x: 300, y: 600 }
    const lines = assistCandidates(g, start)
    expect(lines).toHaveLength(3) // 2 VPs + vertical
    const towards = pickLine(lines, { x: 700, y: -200 })!
    const q = projectOnLine(towards, { x: 700, y: 600 - 200 * (700 / 700) })
    // point on line start -> VP1 must be collinear with VP1
    const cross = (q.x - start.x) * (400 - start.y) - (q.y - start.y) * (1000 - start.x)
    expect(Math.abs(cross)).toBeLessThan(1e-6)
  })
  it('symmetry has no line lock', () => {
    expect(assistCandidates({ ...G(), type: 'symmetry' }, { x: 1, y: 1 })).toHaveLength(0)
  })
  it('normalizeGuide is tolerant', () => {
    const g = normalizeGuide({ type: 'bogus', vps: [{ x: 1, y: 2 }, 'x'], opacity: 9 }, 100, 100)
    expect(g.type).toBe('grid')
    expect(g.opacity).toBe(1)
    expect(g.vps).toHaveLength(2)
  })
})

// ------------------------------------------------------------------ shapes
const jitter = (pts: Pt[], amt: number): Pt[] => {
  let s = 12345
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5) * 2
  return pts.map((p) => ({ x: p.x + r() * amt, y: p.y + r() * amt }))
}
const circlePts = (cx: number, cy: number, rx: number, ry: number, n = 80, sweep = Math.PI * 2 * 1.04, rot = 0): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = (i / n) * sweep - 1
    const u = Math.cos(t) * rx
    const v = Math.sin(t) * ry
    return { x: cx + u * Math.cos(rot) - v * Math.sin(rot), y: cy + u * Math.sin(rot) + v * Math.cos(rot) }
  })
const poly = (v: Pt[], closed = true, per = 30): Pt[] => {
  const src = closed ? [...v, v[0]] : v
  const out: Pt[] = []
  for (let i = 0; i < src.length - 1; i++) for (let k = 0; k < per; k++) out.push({ x: src[i].x + ((src[i + 1].x - src[i].x) * k) / per, y: src[i].y + ((src[i + 1].y - src[i].y) * k) / per })
  out.push(src[src.length - 1])
  return out
}

describe('shape recognition', () => {
  it('line', () => {
    const pts = jitter(poly([{ x: 10, y: 10 }, { x: 300, y: 80 }], false, 80), 2)
    const s = recognizeShape(pts)!
    expect(s.kind).toBe('line')
  })
  it('circle -> ellipse with equal radii', () => {
    const s = recognizeShape(jitter(circlePts(200, 200, 100, 100), 3))!
    expect(s.kind).toBe('ellipse')
    if (s.kind === 'ellipse') {
      expect(Math.abs(s.rx - 100)).toBeLessThan(10)
      expect(Math.abs(s.ry - 100)).toBeLessThan(10)
      expect(Math.abs(s.c.x - 200)).toBeLessThan(8)
    }
  })
  it('ellipse', () => {
    const s = recognizeShape(jitter(circlePts(300, 200, 160, 70, 100, Math.PI * 2 * 1.03, 0.4), 2))!
    expect(s.kind).toBe('ellipse')
    if (s.kind === 'ellipse') expect(Math.max(s.rx, s.ry) / Math.min(s.rx, s.ry)).toBeGreaterThan(1.8)
  })
  it('rectangle', () => {
    const s = recognizeShape(jitter(poly([{ x: 100, y: 100 }, { x: 400, y: 100 }, { x: 400, y: 260 }, { x: 100, y: 260 }]), 3))!
    expect(s.kind).toBe('rect')
    if (s.kind === 'rect') {
      expect(Math.abs(Math.max(s.w, s.h) - 300)).toBeLessThan(15)
      expect(Math.abs(Math.min(s.w, s.h) - 160)).toBeLessThan(15)
    }
  })
  it('rotated rectangle', () => {
    const rot = 0.5
    const corners = [[-150, -70], [150, -70], [150, 70], [-150, 70]].map(([u, v]) => ({ x: 300 + u * Math.cos(rot) - v * Math.sin(rot), y: 300 + u * Math.sin(rot) + v * Math.cos(rot) }))
    const s = recognizeShape(jitter(poly(corners), 2))!
    expect(s.kind).toBe('rect')
  })
  it('triangle', () => {
    const s = recognizeShape(jitter(poly([{ x: 200, y: 50 }, { x: 350, y: 300 }, { x: 60, y: 280 }]), 2))!
    expect(s.kind).toBe('polygon')
    if (s.kind === 'polygon') expect(s.pts).toHaveLength(3)
  })
  it('pentagon', () => {
    const v = Array.from({ length: 5 }, (_, i) => ({ x: 300 + Math.cos((i * 2 * Math.PI) / 5) * 120, y: 300 + Math.sin((i * 2 * Math.PI) / 5) * 120 }))
    const s = recognizeShape(jitter(poly(v), 2))!
    expect(s.kind).toBe('polygon')
    if (s.kind === 'polygon') expect(s.pts).toHaveLength(5)
  })
  it('arc', () => {
    const s = recognizeShape(jitter(circlePts(300, 300, 150, 150, 60, Math.PI * 0.9), 2))!
    expect(s.kind).toBe('arc')
    if (s.kind === 'arc') {
      const ap = arcParams(s.p0, s.pm, s.p1)!
      expect(Math.abs(ap.r - 150)).toBeLessThan(15)
      expect(Math.abs(Math.abs(ap.sweep) - Math.PI * 0.9)).toBeLessThan(0.3)
    }
  })
  it('polyline (zigzag)', () => {
    const s = recognizeShape(poly([{ x: 0, y: 0 }, { x: 100, y: 120 }, { x: 200, y: 0 }, { x: 300, y: 120 }], false))!
    expect(s.kind).toBe('polyline')
  })
  it('scribble is not recognised', () => {
    const pts: Pt[] = []
    for (let i = 0; i < 200; i++) pts.push({ x: 100 + i * 2 + Math.sin(i * 0.7) * 40, y: 100 + Math.cos(i * 1.9) * 80 + Math.sin(i * 0.31) * 60 })
    expect(recognizeShape(pts)?.kind ?? 'none').not.toBe('ellipse')
  })
  it('tiny strokes ignored', () => {
    expect(recognizeShape(poly([{ x: 0, y: 0 }, { x: 5, y: 1 }], false))).toBeNull()
  })
})

describe('shape outline, perfect and handles', () => {
  it('perfect line snaps to 15 degrees', () => {
    const s = perfectShape({ kind: 'line', a: { x: 0, y: 0 }, b: { x: 100, y: 20 } })
    if (s.kind !== 'line') throw new Error()
    expect(Math.atan2(s.b.y, s.b.x)).toBeCloseTo((15 * Math.PI) / 180)
    expect(Math.hypot(s.b.x, s.b.y)).toBeCloseTo(Math.hypot(100, 20))
  })
  it('perfect ellipse is a circle, rect a square, polygon regular', () => {
    const e = perfectShape({ kind: 'ellipse', c: { x: 0, y: 0 }, rx: 100, ry: 60, rot: 0.3 })
    if (e.kind !== 'ellipse') throw new Error()
    expect(e.rx).toBe(e.ry)
    const r = perfectShape({ kind: 'rect', c: { x: 0, y: 0 }, w: 200, h: 100, rot: 0 })
    if (r.kind !== 'rect') throw new Error()
    expect(r.w).toBe(r.h)
    const p = perfectShape({ kind: 'polygon', pts: [{ x: 0, y: 0 }, { x: 100, y: 10 }, { x: 40, y: 90 }] })
    if (p.kind !== 'polygon') throw new Error()
    const d = p.pts.map((q, i) => Math.hypot(q.x - p.pts[(i + 1) % 3].x, q.y - p.pts[(i + 1) % 3].y))
    expect(d[0]).toBeCloseTo(d[1])
    expect(d[1]).toBeCloseTo(d[2])
  })
  it('outline is closed for closed shapes and dense', () => {
    const pts = shapePoints({ kind: 'rect', c: { x: 50, y: 50 }, w: 100, h: 60, rot: 0 }, 2)
    expect(pts[0].x).toBeCloseTo(pts[pts.length - 1].x)
    expect(pts[0].y).toBeCloseTo(pts[pts.length - 1].y)
    for (let i = 1; i < pts.length; i++) expect(Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)).toBeLessThan(2.01)
  })
  it('arc outline passes through pm', () => {
    const a = { kind: 'arc' as const, p0: { x: 0, y: 0 }, pm: { x: 50, y: -30 }, p1: { x: 100, y: 0 } }
    const pts = shapePoints(a, 1)
    expect(Math.min(...pts.map((p) => Math.hypot(p.x - 50, p.y + 30)))).toBeLessThan(1.2)
  })
  it('handle drags', () => {
    const rect = { kind: 'rect' as const, c: { x: 100, y: 100 }, w: 100, h: 60, rot: 0 }
    const hs = shapeHandles(rect)
    expect(hs.map((h) => h.id)).toEqual(['k0', 'k1', 'k2', 'k3', 'c', 'rot'])
    const d = dragHandle(rect, 'k2', { x: 250, y: 200 }, false)
    if (d.kind !== 'rect') throw new Error()
    expect(d.w).toBeCloseTo(200)
    expect(d.h).toBeCloseTo(130)
    const sq = dragHandle(rect, 'k2', { x: 250, y: 200 }, true)
    if (sq.kind !== 'rect') throw new Error()
    expect(sq.w).toBeCloseTo(sq.h)
    const el = dragHandle({ kind: 'ellipse', c: { x: 0, y: 0 }, rx: 50, ry: 20, rot: 0 }, 'ry', { x: 0, y: 40 }, false)
    if (el.kind !== 'ellipse') throw new Error()
    expect(el.ry).toBeCloseTo(40)
    const circ = dragHandle({ kind: 'ellipse', c: { x: 0, y: 0 }, rx: 50, ry: 20, rot: 0 }, 'rx', { x: 30, y: 40 }, true)
    if (circ.kind !== 'ellipse') throw new Error()
    expect(circ.rx).toBeCloseTo(circ.ry)
  })
})

import { defaultGuide as dg, snapTargetsFor } from '../src/renderer/src/features/guides/model'
describe('transform snap targets', () => {
  it('is empty when the guide is off', () => {
    expect(snapTargetsFor(dg(1000, 800), 1000, 800)).toEqual({ x: [], y: [] })
  })
  it('grid lines at multiples of the grid size', () => {
    const g = { ...dg(1000, 800), enabled: true, gridSize: 250 }
    const t = snapTargetsFor(g, 1000, 800)
    expect(t.x).toEqual([250, 500, 750])
    expect(t.y).toEqual([250, 500, 750])
  })
  it('rotated grid gives no axis lines; symmetry gives its axis', () => {
    expect(snapTargetsFor({ ...dg(1000, 800), enabled: true, gridRotation: 30 }, 1000, 800).x).toEqual([])
    const s = { ...dg(1000, 800), enabled: true, type: 'symmetry' as const, symKind: 'vertical' as const }
    expect(snapTargetsFor(s, 1000, 800)).toEqual({ x: [500], y: [] })
  })
})
