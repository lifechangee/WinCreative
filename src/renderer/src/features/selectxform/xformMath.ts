/** Pure transform maths: homographies, control nets (warp meshes), handle dragging, snapping. */
import type { Rect } from '../../core/types'
import type { Pt } from './geom'

export type Quad = [Pt, Pt, Pt, Pt] // TL, TR, BR, BL

export interface Net {
  cols: number
  rows: number
  /** (cols+1)*(rows+1) points, row-major, dest positions of the uniform source grid */
  pts: Pt[]
}

// ------------------------------------------------------------------ homography
/** 3x3 row-major matrix mapping src[i] -> dst[i] (4 point pairs). Null when degenerate. */
export function solveHomography(src: Pt[], dst: Pt[]): number[] | null {
  const A: number[][] = []
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]
    const { x: u, y: v } = dst[i]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u])
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v])
  }
  // gaussian elimination with partial pivoting on the 8x9 augmented system
  for (let c = 0; c < 8; c++) {
    let p = c
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r
    if (Math.abs(A[p][c]) < 1e-12) return null
    ;[A[c], A[p]] = [A[p], A[c]]
    for (let r = 0; r < 8; r++) {
      if (r === c) continue
      const f = A[r][c] / A[c][c]
      if (f === 0) continue
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k]
    }
  }
  const h = A.map((row, i) => row[8] / row[i])
  return [...h, 1]
}

export function applyH(H: number[], x: number, y: number): Pt {
  const w = H[6] * x + H[7] * y + H[8]
  return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w }
}

export function unitToQuadH(q: Quad): number[] | null {
  return solveHomography([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], q)
}

// ------------------------------------------------------------------ nets
export function makeNet(r: Rect, cols: number, rows: number): Net {
  const pts: Pt[] = []
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) pts.push({ x: r.x + (r.w * i) / cols, y: r.y + (r.h * j) / rows })
  return { cols, rows, pts }
}

export const cloneNet = (n: Net): Net => ({ cols: n.cols, rows: n.rows, pts: n.pts.map((p) => ({ ...p })) })

export function netCorners(n: Net): Quad {
  const W = n.cols + 1
  return [{ ...n.pts[0] }, { ...n.pts[n.cols] }, { ...n.pts[n.rows * W + n.cols] }, { ...n.pts[n.rows * W] }]
}

const cr = (p0: number, p1: number, p2: number, p3: number, t: number): number => {
  const t2 = t * t
  const t3 = t2 * t
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
}

/** Position on the net at normalised (u,v) in 0..1. 1x1 nets are perspective quads, larger nets Catmull-Rom patches. */
export function evalNet(n: Net, u: number, v: number, H?: number[] | null): Pt {
  if (n.cols === 1 && n.rows === 1) {
    const h = H === undefined ? unitToQuadH(netCorners(n)) : H
    if (h) return applyH(h, u, v)
    const [a, b, c, d] = netCorners(n)
    return { x: (1 - v) * ((1 - u) * a.x + u * b.x) + v * ((1 - u) * d.x + u * c.x), y: (1 - v) * ((1 - u) * a.y + u * b.y) + v * ((1 - u) * d.y + u * c.y) }
  }
  const W = n.cols + 1
  const fu = Math.min(Math.max(u, 0), 1) * n.cols
  const fv = Math.min(Math.max(v, 0), 1) * n.rows
  const i = Math.min(n.cols - 1, Math.floor(fu))
  const j = Math.min(n.rows - 1, Math.floor(fv))
  const tu = fu - i
  const tv = fv - j
  const P = (ci: number, cj: number): Pt => n.pts[cj * W + ci]
  const ghost = (p: Pt, q: Pt): Pt => ({ x: 2 * p.x - q.x, y: 2 * p.y - q.y })
  const rp = (ci: number, rj: number): Pt => (ci < 0 ? ghost(P(0, rj), P(1, rj)) : ci > n.cols ? ghost(P(n.cols, rj), P(n.cols - 1, rj)) : P(ci, rj))
  const at = (ci: number, cj: number): Pt => (cj < 0 ? ghost(rp(ci, 0), rp(ci, 1)) : cj > n.rows ? ghost(rp(ci, n.rows), rp(ci, n.rows - 1)) : rp(ci, cj))
  const rowsX: number[] = []
  const rowsY: number[] = []
  for (let dj = -1; dj <= 2; dj++) {
    const a = at(i - 1, j + dj)
    const b = at(i, j + dj)
    const c = at(i + 1, j + dj)
    const d = at(i + 2, j + dj)
    rowsX.push(cr(a.x, b.x, c.x, d.x, tu))
    rowsY.push(cr(a.y, b.y, c.y, d.y, tu))
  }
  return { x: cr(rowsX[0], rowsX[1], rowsX[2], rowsX[3], tv), y: cr(rowsY[0], rowsY[1], rowsY[2], rowsY[3], tv) }
}

/** Resample a net to a new density (positions interpolated from the current surface). */
export function resampleNet(n: Net, cols: number, rows: number): Net {
  const H = n.cols === 1 && n.rows === 1 ? unitToQuadH(netCorners(n)) : undefined
  const pts: Pt[] = []
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) pts.push(evalNet(n, i / cols, j / rows, H))
  return { cols, rows, pts }
}

export interface Mesh {
  /** x, y (dest doc px), u, v (0..1 in source rect) per vertex */
  verts: Float32Array
  indices: Uint32Array
}

/** Tessellate a net into a triangle mesh. `sub` = subdivisions per net cell. */
export function tessellate(n: Net, sub: number): Mesh {
  const cx = n.cols * sub
  const cy = n.rows * sub
  const H = n.cols === 1 && n.rows === 1 ? unitToQuadH(netCorners(n)) : undefined
  const verts = new Float32Array((cx + 1) * (cy + 1) * 4)
  let o = 0
  for (let j = 0; j <= cy; j++) {
    for (let i = 0; i <= cx; i++) {
      const u = i / cx
      const v = j / cy
      const p = evalNet(n, u, v, H)
      verts[o++] = p.x
      verts[o++] = p.y
      verts[o++] = u
      verts[o++] = v
    }
  }
  const indices = new Uint32Array(cx * cy * 6)
  let k = 0
  for (let j = 0; j < cy; j++) {
    for (let i = 0; i < cx; i++) {
      const a = j * (cx + 1) + i
      const b = a + 1
      const c = a + cx + 1
      const d = c + 1
      indices[k++] = a
      indices[k++] = b
      indices[k++] = c
      indices[k++] = b
      indices[k++] = d
      indices[k++] = c
    }
  }
  return { verts, indices }
}

/** True if the quad is a parallelogram (affine) so one cell renders exactly. */
export function isAffineQuad(q: Quad): boolean {
  const ex = q[0].x + q[2].x - q[1].x - q[3].x
  const ey = q[0].y + q[2].y - q[1].y - q[3].y
  return Math.hypot(ex, ey) < 1e-6
}

export function netBounds(n: Net, sub = 8): Rect {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  const H = n.cols === 1 && n.rows === 1 ? unitToQuadH(netCorners(n)) : undefined
  const steps = n.cols * sub
  const stepsV = n.rows * sub
  for (let j = 0; j <= stepsV; j++) {
    for (let i = 0; i <= steps; i++) {
      if (j > 0 && j < stepsV && i > 0 && i < steps) continue
      const p = evalNet(n, i / steps, j / stepsV, H)
      x0 = Math.min(x0, p.x)
      y0 = Math.min(y0, p.y)
      x1 = Math.max(x1, p.x)
      y1 = Math.max(y1, p.y)
    }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

export function mapNet(n: Net, f: (p: Pt) => Pt): Net {
  return { cols: n.cols, rows: n.rows, pts: n.pts.map(f) }
}

// ------------------------------------------------------------------ handle dragging
/** hx,hy in {0, .5, 1}: 0,0 = top-left ... 1,1 = bottom-right. */
export interface HandleId {
  hx: number
  hy: number
}

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y })
const dot = (a: Pt, b: Pt): number => a.x * b.x + a.y * b.y
const len = (a: Pt): number => Math.hypot(a.x, a.y)

/**
 * Scale a (parallelogram) quad by dragging handle `hd` to pointer `P`, keeping the opposite handle fixed.
 * `uniform` keeps aspect. Works in the quad's own (possibly rotated) axes.
 */
export function scaleQuad(q: Quad, hd: HandleId, P: Pt, uniform: boolean, fromCenter = false): Quad {
  const a = sub(q[1], q[0])
  const b = sub(q[3], q[0])
  const la = len(a)
  const lb = len(b)
  if (la < 1e-9 || lb < 1e-9) return q
  const ea = { x: a.x / la, y: a.y / la }
  const eb = { x: b.x / lb, y: b.y / lb }
  const O = q[0]
  const ah = fromCenter ? 0.5 : 1 - hd.hx
  const bh = fromCenter ? 0.5 : 1 - hd.hy
  const A: Pt = { x: O.x + ah * a.x + bh * b.x, y: O.y + ah * a.y + bh * b.y }
  const d = sub(P, A)
  const sx = 2 * hd.hx - 1
  const sy = 2 * hd.hy - 1
  // for a centre-anchored drag the handle is at +-0.5 of the extents
  const fx = fromCenter ? sx * 0.5 : sx
  const fy = fromCenter ? sy * 0.5 : sy
  let ka = fx === 0 ? 1 : dot(d, ea) / (fx * la)
  let kb = fy === 0 ? 1 : dot(d, eb) / (fy * lb)
  if (uniform) {
    let k: number
    if (fx !== 0 && fy !== 0) {
      // project pointer onto the diagonal
      const diag = { x: fx * a.x + fy * b.x, y: fx * a.y + fy * b.y }
      k = dot(d, diag) / dot(diag, diag)
    } else k = fx === 0 ? kb : ka
    ka = kb = k
  }
  const a2 = { x: a.x * ka, y: a.y * ka }
  const b2 = { x: b.x * kb, y: b.y * kb }
  const O2 = { x: A.x - ah * a2.x - bh * b2.x, y: A.y - ah * a2.y - bh * b2.y }
  return [O2, { x: O2.x + a2.x, y: O2.y + a2.y }, { x: O2.x + a2.x + b2.x, y: O2.y + a2.y + b2.y }, { x: O2.x + b2.x, y: O2.y + b2.y }]
}

/** Distort: move a corner freely, or an edge (both adjacent corners) by the same delta. */
export function distortQuad(q: Quad, hd: HandleId, delta: Pt): Quad {
  const out = q.map((p) => ({ ...p })) as Quad
  const move = (i: number): void => {
    out[i] = { x: q[i].x + delta.x, y: q[i].y + delta.y }
  }
  const { hx, hy } = hd
  if (hx === 0 && hy === 0) move(0)
  else if (hx === 1 && hy === 0) move(1)
  else if (hx === 1 && hy === 1) move(2)
  else if (hx === 0 && hy === 1) move(3)
  else if (hy === 0) (move(0), move(1))
  else if (hy === 1) (move(2), move(3))
  else if (hx === 0) (move(0), move(3))
  else (move(1), move(2))
  return out
}

export function rotatePt(p: Pt, c: Pt, ang: number): Pt {
  const s = Math.sin(ang)
  const co = Math.cos(ang)
  const dx = p.x - c.x
  const dy = p.y - c.y
  return { x: c.x + dx * co - dy * s, y: c.y + dx * s + dy * co }
}

export function quadCenter(q: Quad): Pt {
  return { x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4, y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4 }
}

export function handlePos(q: Quad, hd: HandleId): Pt {
  const top = { x: q[0].x + (q[1].x - q[0].x) * hd.hx, y: q[0].y + (q[1].y - q[0].y) * hd.hx }
  const bot = { x: q[3].x + (q[2].x - q[3].x) * hd.hx, y: q[3].y + (q[2].y - q[3].y) * hd.hx }
  return { x: top.x + (bot.x - top.x) * hd.hy, y: top.y + (bot.y - top.y) * hd.hy }
}

/** Rotation node position: beyond the top edge middle, `dist` doc px away. */
export function rotationNode(q: Quad, dist: number, side: 1 | -1 = 1): Pt {
  // side -1 puts the node beyond the BOTTOM edge (used when the top is hidden under the top bar)
  const m = handlePos(q, { hx: 0.5, hy: side === 1 ? 0 : 1 })
  const c = handlePos(q, { hx: 0.5, hy: 0.5 })
  const d = sub(m, c)
  const l = len(d) || 1
  return { x: m.x + (d.x / l) * dist, y: m.y + (d.y / l) * dist }
}

export function pointInQuad(q: Quad, p: Pt): boolean {
  let s = 0
  for (let i = 0; i < 4; i++) {
    const a = q[i]
    const b = q[(i + 1) % 4]
    const cr = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
    if (cr !== 0) {
      const sg = Math.sign(cr)
      if (s === 0) s = sg
      else if (sg !== s) return false
    }
  }
  return true
}

/** Flip the net across its own vertical (h) or horizontal (v) axis. */
export function flipNet(n: Net, dir: 'h' | 'v'): Net {
  const W = n.cols + 1
  const pts: Pt[] = new Array(n.pts.length)
  for (let j = 0; j <= n.rows; j++) {
    for (let i = 0; i <= n.cols; i++) {
      const si = dir === 'h' ? n.cols - i : i
      const sj = dir === 'v' ? n.rows - j : j
      pts[j * W + i] = { ...n.pts[sj * W + si] }
    }
  }
  return { cols: n.cols, rows: n.rows, pts }
}

/** Push nearby net points with a smooth falloff (regular Warp mode). */
export function warpDrag(base: Net, at: Pt, delta: Pt, radius: number): Net {
  return mapNet(base, (p) => {
    const d = Math.hypot(p.x - at.x, p.y - at.y) / radius
    if (d >= 1) return { ...p }
    const w = (1 - d * d) * (1 - d * d)
    return { x: p.x + delta.x * w, y: p.y + delta.y * w }
  })
}

// ------------------------------------------------------------------ snapping
/** Best snap delta moving any of `values` onto any of `targets` within `dist`; null if none. */
export function snapDelta(values: number[], targets: number[], dist: number): { delta: number; target: number } | null {
  let best: { delta: number; target: number } | null = null
  for (const v of values) {
    for (const t of targets) {
      const d = t - v
      if (Math.abs(d) <= dist && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, target: t }
    }
  }
  return best
}

/** Snap an angle (radians) to multiples of `step` within `tol`. */
export function snapAngle(a: number, step: number, tol: number): { angle: number; snapped: boolean } {
  const k = Math.round(a / step)
  const s = k * step
  return Math.abs(a - s) <= tol ? { angle: s, snapped: true } : { angle: a, snapped: false }
}

export function quadBounds(q: Quad): Rect {
  const xs = q.map((p) => p.x)
  const ys = q.map((p) => p.y)
  const x0 = Math.min(...xs)
  const y0 = Math.min(...ys)
  return { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 }
}

/** Similarity transform helper (pinch/twist): scale+rotate about `c`, then translate. */
export function similarity(p: Pt, c: Pt, scale: number, ang: number, t: Pt): Pt {
  const r = rotatePt(p, c, ang)
  return { x: c.x + (r.x - c.x) * scale + t.x, y: c.y + (r.y - c.y) * scale + t.y }
}

// ------------------------------------------------------------------ bend
/** Parabolic bend profile: 0 at both ends, 1 in the middle. */
export const bendProfile = (t: number): number => 1 - (2 * t - 1) * (2 * t - 1)

/**
 * Bend a net like a curved sheet: every point is pushed along one frame axis by `amount * profile(t)` where t is its
 * position along the other axis. axis 'h' = bend the top/bottom edges (push along the frame's y direction),
 * axis 'v' = bend the left/right edges (push along x). `frame` = corners (TL, TR, BR, BL) of the net when the drag began.
 */
export function bendNet(net: Net, frame: Quad, axis: 'h' | 'v', amount: number): Net {
  const norm = (a: Pt, b: Pt): Pt => {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const l = Math.hypot(dx, dy) || 1
    return { x: dx / l, y: dy / l }
  }
  const dir = axis === 'h' ? norm(frame[0], frame[3]) : norm(frame[0], frame[1])
  const W = net.cols + 1
  const out = cloneNet(net)
  out.pts.forEach((p, k) => {
    const i = k % W
    const j = Math.floor(k / W)
    const t = axis === 'h' ? i / net.cols : j / net.rows
    const d = amount * bendProfile(t)
    p.x += dir.x * d
    p.y += dir.y * d
  })
  return out
}

/** Signed distance of `delta` along the bend direction of `frame` (inverse of what bendNet applies). */
export function bendAmount(frame: Quad, axis: 'h' | 'v', delta: Pt): number {
  const a = axis === 'h' ? frame[0] : frame[0]
  const b = axis === 'h' ? frame[3] : frame[1]
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l = Math.hypot(dx, dy) || 1
  return (delta.x * dx + delta.y * dy) / l
}
