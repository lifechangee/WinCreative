/** Pure QuickShape logic: recognise a hand-drawn stroke as a primitive, generate its outline, edit handles. (No DOM.) */
import type { Pt } from './model'

export type Shape =
  | { kind: 'line'; a: Pt; b: Pt }
  | { kind: 'arc'; p0: Pt; pm: Pt; p1: Pt }
  | { kind: 'polyline'; pts: Pt[] }
  | { kind: 'polygon'; pts: Pt[] }
  | { kind: 'ellipse'; c: Pt; rx: number; ry: number; rot: number }
  | { kind: 'rect'; c: Pt; w: number; h: number; rot: number }

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y)
const RAD = Math.PI / 180

export function pathLength(pts: Pt[]): number {
  let l = 0
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i])
  return l
}

/** Resample to (near) uniform arc-length spacing. */
export function resample(pts: Pt[], step: number): Pt[] {
  if (pts.length < 2) return pts.slice()
  const out: Pt[] = [{ ...pts[0] }]
  let carry = 0
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1]
    const b = pts[i]
    let d = dist(a, b)
    while (carry + d >= step && d > 1e-9) {
      const t = (step - carry) / d
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
      out.push(p)
      a = p
      d = dist(a, b)
      carry = 0
    }
    carry += d
  }
  const last = pts[pts.length - 1]
  if (dist(out[out.length - 1], last) > step * 0.3) out.push({ ...last })
  return out
}

function perpDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l = Math.hypot(dx, dy)
  if (l < 1e-9) return dist(p, a)
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / l
}

/** Douglas-Peucker on an open polyline; returns kept indices. */
export function simplifyIdx(pts: Pt[], eps: number, lo = 0, hi = pts.length - 1): number[] {
  if (hi <= lo + 1) return [lo, hi].filter((v, i, a) => a.indexOf(v) === i)
  let mx = -1
  let mi = -1
  for (let i = lo + 1; i < hi; i++) {
    const d = perpDist(pts[i], pts[lo], pts[hi])
    if (d > mx) {
      mx = d
      mi = i
    }
  }
  if (mx <= eps) return [lo, hi]
  const l = simplifyIdx(pts, eps, lo, mi)
  const r = simplifyIdx(pts, eps, mi, hi)
  return [...l.slice(0, -1), ...r]
}

function bbox(pts: Pt[]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of pts) {
    x0 = Math.min(x0, p.x)
    y0 = Math.min(y0, p.y)
    x1 = Math.max(x1, p.x)
    y1 = Math.max(y1, p.y)
  }
  return { x0, y0, x1, y1 }
}

/** Kasa least-squares circle fit. */
export function fitCircle(pts: Pt[]): { c: Pt; r: number; rms: number } | null {
  const n = pts.length
  if (n < 3) return null
  let mx = 0
  let my = 0
  for (const p of pts) {
    mx += p.x
    my += p.y
  }
  mx /= n
  my /= n
  let suu = 0
  let suv = 0
  let svv = 0
  let suuu = 0
  let svvv = 0
  let suvv = 0
  let svuu = 0
  for (const p of pts) {
    const u = p.x - mx
    const v = p.y - my
    suu += u * u
    suv += u * v
    svv += v * v
    suuu += u * u * u
    svvv += v * v * v
    suvv += u * v * v
    svuu += v * u * u
  }
  const det = suu * svv - suv * suv
  if (Math.abs(det) < 1e-9) return null
  const b1 = 0.5 * (suuu + suvv)
  const b2 = 0.5 * (svvv + svuu)
  const uc = (b1 * svv - b2 * suv) / det
  const vc = (suu * b2 - suv * b1) / det
  const c = { x: mx + uc, y: my + vc }
  let r = 0
  for (const p of pts) r += dist(p, c)
  r /= n
  let e = 0
  for (const p of pts) e += (dist(p, c) - r) ** 2
  return { c, r, rms: Math.sqrt(e / n) }
}

/** Circumcircle through three points (null when collinear). */
export function circleFrom3(a: Pt, b: Pt, c: Pt): { c: Pt; r: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y))
  if (Math.abs(d) < 1e-9) return null
  const a2 = a.x * a.x + a.y * a.y
  const b2 = b.x * b.x + b.y * b.y
  const c2 = c.x * c.x + c.y * c.y
  const ux = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d
  const uy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d
  const ctr = { x: ux, y: uy }
  return { c: ctr, r: dist(ctr, a) }
}

const wrapPi = (a: number): number => {
  while (a > Math.PI) a -= 2 * Math.PI
  while (a < -Math.PI) a += 2 * Math.PI
  return a
}

/** Arc through p0 -> pm -> p1: centre, radius, start angle and signed sweep. */
export function arcParams(p0: Pt, pm: Pt, p1: Pt): { c: Pt; r: number; a0: number; sweep: number } | null {
  const cc = circleFrom3(p0, pm, p1)
  if (!cc) return null
  const a0 = Math.atan2(p0.y - cc.c.y, p0.x - cc.c.x)
  const am = Math.atan2(pm.y - cc.c.y, pm.x - cc.c.x)
  const a1 = Math.atan2(p1.y - cc.c.y, p1.x - cc.c.x)
  const dm = wrapPi(am - a0)
  const d1 = wrapPi(a1 - a0)
  // direction: sign of dm; total sweep must contain dm before reaching a1
  let sweep = d1
  if (dm >= 0) {
    while (sweep < dm) sweep += 2 * Math.PI
    while (sweep > 2 * Math.PI) sweep -= 2 * Math.PI
    if (sweep < 0) sweep += 2 * Math.PI
  } else {
    while (sweep > dm) sweep -= 2 * Math.PI
    while (sweep < -2 * Math.PI) sweep += 2 * Math.PI
    if (sweep > 0) sweep -= 2 * Math.PI
  }
  return { c: cc.c, r: cc.r, a0, sweep }
}

/** Moment-based ellipse fit for a closed, uniformly resampled loop. */
export function fitEllipse(pts: Pt[]): { c: Pt; rx: number; ry: number; rot: number; rms: number } | null {
  const n = pts.length
  if (n < 6) return null
  let cx = 0
  let cy = 0
  for (const p of pts) {
    cx += p.x
    cy += p.y
  }
  cx /= n
  cy /= n
  let sxx = 0
  let sxy = 0
  let syy = 0
  for (const p of pts) {
    const u = p.x - cx
    const v = p.y - cy
    sxx += u * u
    sxy += u * v
    syy += v * v
  }
  sxx /= n
  sxy /= n
  syy /= n
  const rot = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  const co = Math.cos(rot)
  const si = Math.sin(rot)
  const l1 = sxx * co * co + 2 * sxy * co * si + syy * si * si
  const l2 = sxx * si * si - 2 * sxy * co * si + syy * co * co
  let rx = Math.sqrt(2 * Math.max(l1, 1e-9))
  let ry = Math.sqrt(2 * Math.max(l2, 1e-9))
  const rad = (p: Pt): number => {
    const u = (p.x - cx) * co + (p.y - cy) * si
    const v = -(p.x - cx) * si + (p.y - cy) * co
    return Math.sqrt((u / rx) ** 2 + (v / ry) ** 2)
  }
  let m = 0
  for (const p of pts) m += rad(p)
  m /= n
  rx *= m
  ry *= m
  let e = 0
  for (const p of pts) e += (rad(p) - 1) ** 2
  return { c: { x: cx, y: cy }, rx, ry, rot, rms: Math.sqrt(e / n) }
}

const angDiff = (a: number, b: number): number => Math.abs(wrapPi(a - b))

export interface RecognizeOptions {
  /** ignore strokes shorter than this (document px) */
  minLength?: number
}

/** Recognise a stroke (document-space points) as a primitive; null when it looks like free drawing. */
export function recognizeShape(raw: Pt[], opts: RecognizeOptions = {}): Shape | null {
  if (raw.length < 2) return null
  const L0 = pathLength(raw)
  const minLen = opts.minLength ?? 20
  if (L0 < minLen) return null
  const step = Math.max(1.5, L0 / 240)
  const pts = resample(raw, step)
  if (pts.length < 4) return null
  const L = pathLength(pts)
  const bb = bbox(pts)
  const diag = Math.hypot(bb.x1 - bb.x0, bb.y1 - bb.y0)
  if (diag < 1e-6) return null
  const first = pts[0]
  const last = pts[pts.length - 1]
  const E = dist(first, last)
  const closed = E < 0.14 * L && L > 3 * E

  if (!closed) {
    // ---- line
    let dev = 0
    for (const p of pts) dev = Math.max(dev, perpDist(p, first, last))
    if (E > 0 && dev < 0.05 * E + step * 0.5) return { kind: 'line', a: { ...first }, b: { ...last } }
    // ---- arc
    const fc = fitCircle(pts)
    if (fc && fc.rms < 0.045 * fc.r && fc.r < 8 * diag) {
      const mid = pts[Math.floor(pts.length / 2)]
      const proj = (p: Pt): Pt => {
        const d = dist(p, fc.c) || 1
        return { x: fc.c.x + ((p.x - fc.c.x) / d) * fc.r, y: fc.c.y + ((p.y - fc.c.y) / d) * fc.r }
      }
      const p0 = proj(first)
      const pm = proj(mid)
      const p1 = proj(last)
      const ap = arcParams(p0, pm, p1)
      if (ap && Math.abs(ap.sweep) > 25 * RAD && Math.abs(ap.sweep) < 340 * RAD) return { kind: 'arc', p0, pm, p1 }
    }
    // ---- polyline
    const idx = simplifyIdx(pts, 0.05 * diag)
    if (idx.length >= 3 && idx.length <= 7) {
      const v = idx.map((i) => ({ ...pts[i] }))
      return { kind: 'polyline', pts: v }
    }
    if (idx.length === 2) return { kind: 'line', a: { ...first }, b: { ...last } }
    return null
  }

  // ---- closed shapes
  const loop = pts.slice()
  // split at the point farthest from the start so both halves simplify well
  let far = 0
  let fd = -1
  for (let i = 0; i < loop.length; i++) {
    const d = dist(loop[i], first)
    if (d > fd) {
      fd = d
      far = i
    }
  }
  const eps = 0.05 * diag
  const h1 = simplifyIdx(loop, eps, 0, far)
  const h2 = simplifyIdx(loop, eps, far, loop.length - 1)
  let verts: Pt[] = [...h1.slice(0, -1), ...h2.slice(0, -1)].map((i) => ({ ...loop[i] }))
  // drop near-collinear vertices, merge near-duplicates
  const clean = (vs: Pt[]): Pt[] => {
    let changed = true
    let cur = vs
    while (changed && cur.length > 3) {
      changed = false
      for (let i = 0; i < cur.length; i++) {
        const p = cur[(i + cur.length - 1) % cur.length]
        const c = cur[i]
        const n = cur[(i + 1) % cur.length]
        const a1 = Math.atan2(c.y - p.y, c.x - p.x)
        const a2 = Math.atan2(n.y - c.y, n.x - c.x)
        if (angDiff(a1, a2) < 18 * RAD || dist(p, c) < 0.1 * diag) {
          cur = cur.filter((_, j) => j !== i)
          changed = true
          break
        }
      }
    }
    return cur
  }
  verts = clean(verts)

  const el = fitEllipse(loop)
  if (el && el.rms < 0.075 && (verts.length <= 2 || verts.length >= 7 || el.rms < 0.03 || (verts.length >= 5 && polyDev(loop, verts) > 0.045 * diag))) {
    return { kind: 'ellipse', c: el.c, rx: el.rx, ry: el.ry, rot: el.rot }
  }
  if (verts.length <= 2) return el ? { kind: 'ellipse', c: el.c, rx: el.rx, ry: el.ry, rot: el.rot } : null
  if (verts.length === 4) {
    const rect = fitRect(verts)
    if (rect) return rect
  }
  if (verts.length > 9) return el && el.rms < 0.15 ? { kind: 'ellipse', c: el.c, rx: el.rx, ry: el.ry, rot: el.rot } : null
  return { kind: 'polygon', pts: verts }
}

/** Max distance of the loop's points from the closed polygon outline. */
function polyDev(loop: Pt[], verts: Pt[]): number {
  let mx = 0
  for (const p of loop) {
    let best = Infinity
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i]
      const b = verts[(i + 1) % verts.length]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const l2 = dx * dx + dy * dy || 1
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2))
      best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)))
    }
    mx = Math.max(mx, best)
  }
  return mx
}

/** If the 4 vertices form a (rotated) rectangle within tolerance, return it. */
export function fitRect(v: Pt[]): Shape | null {
  if (v.length !== 4) return null
  let sx = 0
  let sy = 0
  for (let i = 0; i < 4; i++) {
    const a = v[i]
    const b = v[(i + 1) % 4]
    const ang = Math.atan2(b.y - a.y, b.x - a.x)
    sx += Math.cos(4 * ang)
    sy += Math.sin(4 * ang)
  }
  const rot = Math.atan2(sy, sx) / 4
  // interior angles must be near 90 degrees
  for (let i = 0; i < 4; i++) {
    const p = v[(i + 3) % 4]
    const c = v[i]
    const n = v[(i + 1) % 4]
    const a1 = Math.atan2(p.y - c.y, p.x - c.x)
    const a2 = Math.atan2(n.y - c.y, n.x - c.x)
    if (Math.abs(angDiff(a1, a2) - Math.PI / 2) > 22 * RAD) return null
  }
  const co = Math.cos(rot)
  const si = Math.sin(rot)
  let u0 = Infinity
  let u1 = -Infinity
  let v0 = Infinity
  let v1 = -Infinity
  for (const p of v) {
    const u = p.x * co + p.y * si
    const w = -p.x * si + p.y * co
    u0 = Math.min(u0, u)
    u1 = Math.max(u1, u)
    v0 = Math.min(v0, w)
    v1 = Math.max(v1, w)
  }
  const cu = (u0 + u1) / 2
  const cv = (v0 + v1) / 2
  return { kind: 'rect', c: { x: cu * co - cv * si, y: cu * si + cv * co }, w: u1 - u0, h: v1 - v0, rot }
}

// ------------------------------------------------------------------ outline generation
function densify(pts: Pt[], step: number, closed: boolean): Pt[] {
  const src = closed ? [...pts, pts[0]] : pts
  const out: Pt[] = []
  for (let i = 0; i < src.length - 1; i++) {
    const a = src[i]
    const b = src[i + 1]
    const d = dist(a, b)
    const n = Math.max(1, Math.ceil(d / step))
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n })
  }
  out.push({ ...src[src.length - 1] })
  return out
}

export function rectCorners(s: { c: Pt; w: number; h: number; rot: number }): Pt[] {
  const co = Math.cos(s.rot)
  const si = Math.sin(s.rot)
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1]
  ].map(([sx, sy]) => {
    const u = (sx * s.w) / 2
    const v = (sy * s.h) / 2
    return { x: s.c.x + u * co - v * si, y: s.c.y + u * si + v * co }
  })
}

/** Outline of the shape as a dense polyline (closed shapes end on their first point). */
export function shapePoints(s: Shape, step = 2): Pt[] {
  step = Math.max(0.5, step)
  switch (s.kind) {
    case 'line':
      return densify([s.a, s.b], step, false)
    case 'polyline':
      return densify(s.pts, step, false)
    case 'polygon':
      return densify(s.pts, step, true)
    case 'rect':
      return densify(rectCorners(s), step, true)
    case 'ellipse': {
      const per = Math.PI * (3 * (s.rx + s.ry) - Math.sqrt((3 * s.rx + s.ry) * (s.rx + 3 * s.ry)))
      const n = Math.max(24, Math.ceil(per / step))
      const co = Math.cos(s.rot)
      const si = Math.sin(s.rot)
      const out: Pt[] = []
      for (let i = 0; i <= n; i++) {
        const t = (i / n) * Math.PI * 2
        const u = Math.cos(t) * s.rx
        const v = Math.sin(t) * s.ry
        out.push({ x: s.c.x + u * co - v * si, y: s.c.y + u * si + v * co })
      }
      return out
    }
    case 'arc': {
      const ap = arcParams(s.p0, s.pm, s.p1)
      if (!ap) return densify([s.p0, s.p1], step, false)
      const n = Math.max(8, Math.ceil((Math.abs(ap.sweep) * ap.r) / step))
      const out: Pt[] = []
      for (let i = 0; i <= n; i++) {
        const a = ap.a0 + (ap.sweep * i) / n
        out.push({ x: ap.c.x + Math.cos(a) * ap.r, y: ap.c.y + Math.sin(a) * ap.r })
      }
      return out
    }
  }
}

export function shapeCenter(s: Shape): Pt {
  switch (s.kind) {
    case 'line':
      return { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 }
    case 'ellipse':
    case 'rect':
      return { ...s.c }
    case 'arc': {
      const ap = arcParams(s.p0, s.pm, s.p1)
      return ap ? ap.c : shapeCenter({ kind: 'line', a: s.p0, b: s.p1 })
    }
    case 'polygon':
    case 'polyline': {
      let x = 0
      let y = 0
      for (const p of s.pts) {
        x += p.x
        y += p.y
      }
      return { x: x / s.pts.length, y: y / s.pts.length }
    }
  }
}

/** Uniform scale + rotation about `c`. */
export function similarity(s: Shape, c: Pt, scale: number, dRot: number): Shape {
  const co = Math.cos(dRot) * scale
  const si = Math.sin(dRot) * scale
  const m = (p: Pt): Pt => ({ x: c.x + (p.x - c.x) * co - (p.y - c.y) * si, y: c.y + (p.x - c.x) * si + (p.y - c.y) * co })
  switch (s.kind) {
    case 'line':
      return { kind: 'line', a: m(s.a), b: m(s.b) }
    case 'arc':
      return { kind: 'arc', p0: m(s.p0), pm: m(s.pm), p1: m(s.p1) }
    case 'polyline':
      return { kind: 'polyline', pts: s.pts.map(m) }
    case 'polygon':
      return { kind: 'polygon', pts: s.pts.map(m) }
    case 'ellipse':
      return { kind: 'ellipse', c: m(s.c), rx: s.rx * scale, ry: s.ry * scale, rot: s.rot + dRot }
    case 'rect':
      return { kind: 'rect', c: m(s.c), w: s.w * scale, h: s.h * scale, rot: s.rot + dRot }
  }
}

const snap15 = (a: number): number => Math.round(a / (15 * RAD)) * 15 * RAD

/** "Perfect" version: 15-degree lines, circles, squares, regular polygons. */
export function perfectShape(s: Shape): Shape {
  switch (s.kind) {
    case 'line': {
      const a = snap15(Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x))
      const l = dist(s.a, s.b)
      return { kind: 'line', a: s.a, b: { x: s.a.x + Math.cos(a) * l, y: s.a.y + Math.sin(a) * l } }
    }
    case 'ellipse': {
      const r = (s.rx + s.ry) / 2
      return { kind: 'ellipse', c: s.c, rx: r, ry: r, rot: 0 }
    }
    case 'rect': {
      const w = (s.w + s.h) / 2
      return { kind: 'rect', c: s.c, w, h: w, rot: snap15(s.rot) }
    }
    case 'polygon': {
      const c = shapeCenter(s)
      let r = 0
      for (const p of s.pts) r += dist(p, c)
      r /= s.pts.length
      const a0 = snap15(Math.atan2(s.pts[0].y - c.y, s.pts[0].x - c.x))
      const n = s.pts.length
      return { kind: 'polygon', pts: s.pts.map((_, i) => ({ x: c.x + Math.cos(a0 + (2 * Math.PI * i) / n) * r, y: c.y + Math.sin(a0 + (2 * Math.PI * i) / n) * r })) }
    }
    default:
      return s
  }
}

// ------------------------------------------------------------------ handles
export interface Handle {
  id: string
  p: Pt
}

/** Editing handles; `rotOffset` is the distance (document px) of the rotate handle from the shape. */
export function shapeHandles(s: Shape, rotOffset = 40): Handle[] {
  switch (s.kind) {
    case 'line':
      return [
        { id: 'a', p: s.a },
        { id: 'b', p: s.b }
      ]
    case 'arc':
      return [
        { id: 'p0', p: s.p0 },
        { id: 'pm', p: s.pm },
        { id: 'p1', p: s.p1 }
      ]
    case 'polyline':
    case 'polygon':
      return s.pts.map((p, i) => ({ id: 'v' + i, p }))
    case 'rect': {
      const k = rectCorners(s)
      const co = Math.cos(s.rot)
      const si = Math.sin(s.rot)
      const off = s.h / 2 + rotOffset
      return [
        ...k.map((p, i) => ({ id: 'k' + i, p })),
        { id: 'c', p: s.c },
        { id: 'rot', p: { x: s.c.x + si * off, y: s.c.y - co * off } }
      ]
    }
    case 'ellipse': {
      const co = Math.cos(s.rot)
      const si = Math.sin(s.rot)
      const off = s.ry + rotOffset
      return [
        { id: 'rx', p: { x: s.c.x + co * s.rx, y: s.c.y + si * s.rx } },
        { id: 'ry', p: { x: s.c.x - si * s.ry, y: s.c.y + co * s.ry } },
        { id: 'c', p: s.c },
        { id: 'rot', p: { x: s.c.x + si * off, y: s.c.y - co * off } }
      ]
    }
  }
}

/** Apply a handle drag; `perfect` constrains (15-degree lines, circle, square, regular polygon). */
export function dragHandle(s: Shape, id: string, p: Pt, perfect: boolean): Shape {
  let out: Shape = s
  switch (s.kind) {
    case 'line':
      out = id === 'a' ? { ...s, a: p } : { ...s, b: p }
      if (perfect) {
        const fixed = id === 'a' ? s.b : s.a
        const moving = id === 'a' ? 'a' : 'b'
        const a = snap15(Math.atan2(p.y - fixed.y, p.x - fixed.x))
        const l = dist(p, fixed)
        const q = { x: fixed.x + Math.cos(a) * l, y: fixed.y + Math.sin(a) * l }
        out = moving === 'a' ? { kind: 'line', a: q, b: fixed } : { kind: 'line', a: fixed, b: q }
      }
      return out
    case 'arc':
      return id === 'p0' ? { ...s, p0: p } : id === 'p1' ? { ...s, p1: p } : { ...s, pm: p }
    case 'polyline':
    case 'polygon': {
      const i = Number(id.slice(1))
      const pts = s.pts.map((q, j) => (j === i ? p : q))
      const res: Shape = { kind: s.kind, pts }
      if (perfect && s.kind === 'polygon') {
        // regularise around the fixed centre-of-others
        return perfectShape(res)
      }
      return res
    }
    case 'ellipse': {
      if (id === 'c') return { ...s, c: p }
      const co = Math.cos(s.rot)
      const si = Math.sin(s.rot)
      if (id === 'rot') {
        const a = Math.atan2(p.y - s.c.y, p.x - s.c.x) + Math.PI / 2
        return { ...s, rot: perfect ? snap15(a) : a }
      }
      const u = (p.x - s.c.x) * co + (p.y - s.c.y) * si
      const v = -(p.x - s.c.x) * si + (p.y - s.c.y) * co
      if (perfect) {
        const r = Math.max(1, dist(p, s.c))
        return { ...s, rx: r, ry: r }
      }
      return id === 'rx' ? { ...s, rx: Math.max(1, Math.abs(u)) } : { ...s, ry: Math.max(1, Math.abs(v)) }
    }
    case 'rect': {
      if (id === 'c') return { ...s, c: p }
      if (id === 'rot') {
        const a = Math.atan2(p.y - s.c.y, p.x - s.c.x) + Math.PI / 2
        return { ...s, rot: perfect ? snap15(a) : a }
      }
      const i = Number(id.slice(1))
      const corners = rectCorners(s)
      const opp = corners[(i + 2) % 4]
      const co = Math.cos(s.rot)
      const si = Math.sin(s.rot)
      let du = (p.x - opp.x) * co + (p.y - opp.y) * si
      let dv = -(p.x - opp.x) * si + (p.y - opp.y) * co
      if (perfect) {
        const m = Math.max(Math.abs(du), Math.abs(dv))
        du = Math.sign(du || 1) * m
        dv = Math.sign(dv || 1) * m
      }
      const mid = { x: opp.x + (du * co - dv * si) / 2, y: opp.y + (du * si + dv * co) / 2 }
      return { kind: 'rect', c: mid, w: Math.max(1, Math.abs(du)), h: Math.max(1, Math.abs(dv)), rot: s.rot }
    }
  }
}
