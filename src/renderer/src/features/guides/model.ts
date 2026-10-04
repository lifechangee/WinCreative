/** Pure drawing-guide model: state, symmetry transforms and stroke-assist line candidates. (No DOM.) */

export interface Pt {
  x: number
  y: number
}
export type GuideType = 'grid' | 'iso' | 'perspective' | 'symmetry'
export type SymKind = 'vertical' | 'horizontal' | 'quadrant' | 'radial'
export type IsoPlane = 'all' | 'top' | 'left' | 'right'

export interface GuideState {
  /** Drawing Guide toggle (guide visible + active) */
  enabled: boolean
  type: GuideType
  /** 0..360 */
  hue: number
  opacity: number
  /** screen px */
  thickness: number
  /** document px */
  gridSize: number
  /** degrees */
  gridRotation: number
  isoPlane: IsoPlane
  /** perspective vanishing points (1..3), document coords */
  vps: Pt[]
  symKind: SymKind
  symCenter: Pt
  /** degrees: rotation of the symmetry axes */
  symAngle: number
  symSegments: number
  symRotational: boolean
}

export function defaultGuide(w: number, h: number): GuideState {
  return {
    enabled: false,
    type: 'grid',
    hue: 190,
    opacity: 0.55,
    thickness: 1.5,
    gridSize: 64,
    gridRotation: 0,
    isoPlane: 'all',
    vps: [{ x: w / 2, y: h * 0.4 }],
    symKind: 'vertical',
    symCenter: { x: w / 2, y: h / 2 },
    symAngle: 0,
    symSegments: 6,
    symRotational: false
  }
}

export function normalizeGuide(raw: unknown, w: number, h: number): GuideState {
  const d = defaultGuide(w, h)
  if (!raw || typeof raw !== 'object') return d
  const r = raw as Partial<GuideState>
  const num = (v: unknown, def: number, lo: number, hi: number): number => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def)
  const pt = (v: unknown, def: Pt): Pt => (v && typeof v === 'object' && isFinite((v as Pt).x) && isFinite((v as Pt).y) ? { x: (v as Pt).x, y: (v as Pt).y } : def)
  const vps = Array.isArray(r.vps) ? r.vps.slice(0, 3).map((p, i) => pt(p, { x: w / 2 + i * 100, y: h / 2 })) : d.vps
  return {
    enabled: !!r.enabled,
    type: (['grid', 'iso', 'perspective', 'symmetry'] as GuideType[]).includes(r.type as GuideType) ? (r.type as GuideType) : d.type,
    hue: num(r.hue, d.hue, 0, 360),
    opacity: num(r.opacity, d.opacity, 0.05, 1),
    thickness: num(r.thickness, d.thickness, 0.5, 12),
    gridSize: num(r.gridSize, d.gridSize, 4, 2048),
    gridRotation: num(r.gridRotation, 0, -360, 360),
    isoPlane: (['all', 'top', 'left', 'right'] as IsoPlane[]).includes(r.isoPlane as IsoPlane) ? (r.isoPlane as IsoPlane) : 'all',
    vps: vps.length ? vps : d.vps,
    symKind: (['vertical', 'horizontal', 'quadrant', 'radial'] as SymKind[]).includes(r.symKind as SymKind) ? (r.symKind as SymKind) : 'vertical',
    symCenter: pt(r.symCenter, d.symCenter),
    symAngle: num(r.symAngle, 0, -360, 360),
    symSegments: Math.round(num(r.symSegments, 6, 2, 24)),
    symRotational: !!r.symRotational
  }
}

const RAD = Math.PI / 180

// ------------------------------------------------------------------ symmetry
/** T(v) = R(theta) * F(phi)^reflect * v  about the symmetry centre. F(phi) reflects across a line of direction phi. */
export interface SymXform {
  theta: number
  reflect: boolean
  phi: number
}

export function symmetryTransforms(g: GuideState): SymXform[] {
  const a = g.symAngle * RAD
  const phiV = Math.PI / 2 + a // the "vertical" axis
  const phiH = a
  const id: SymXform = { theta: 0, reflect: false, phi: 0 }
  switch (g.symKind) {
    case 'vertical':
      return [id, { theta: 0, reflect: true, phi: phiV }]
    case 'horizontal':
      return [id, { theta: 0, reflect: true, phi: phiH }]
    case 'quadrant':
      return [id, { theta: 0, reflect: true, phi: phiV }, { theta: 0, reflect: true, phi: phiH }, { theta: Math.PI, reflect: false, phi: 0 }]
    case 'radial': {
      const n = Math.max(2, Math.round(g.symSegments))
      const out: SymXform[] = []
      for (let k = 0; k < n; k++) {
        out.push({ theta: (2 * Math.PI * k) / n, reflect: false, phi: 0 })
        if (!g.symRotational) out.push({ theta: (2 * Math.PI * k) / n, reflect: true, phi: phiV })
      }
      return out
    }
  }
}

export function applyXform(x: SymXform, c: Pt, p: Pt): Pt {
  let vx = p.x - c.x
  let vy = p.y - c.y
  if (x.reflect) {
    const c2 = Math.cos(2 * x.phi)
    const s2 = Math.sin(2 * x.phi)
    const nx = c2 * vx + s2 * vy
    const ny = s2 * vx - c2 * vy
    vx = nx
    vy = ny
  }
  if (x.theta) {
    const ct = Math.cos(x.theta)
    const st = Math.sin(x.theta)
    const nx = ct * vx - st * vy
    const ny = st * vx + ct * vy
    vx = nx
    vy = ny
  }
  return { x: c.x + vx, y: c.y + vy }
}

/** Map a brush angle (radians) through the transform. */
export function mapAngle(x: SymXform, angle: number): number {
  return (x.reflect ? 2 * x.phi - angle : angle) + x.theta
}

/** Axis directions (radians) through the centre to draw for a symmetry guide. */
export function symmetryAxes(g: GuideState): number[] {
  const a = g.symAngle * RAD
  switch (g.symKind) {
    case 'vertical':
      return [Math.PI / 2 + a]
    case 'horizontal':
      return [a]
    case 'quadrant':
      return [Math.PI / 2 + a, a]
    case 'radial': {
      const n = Math.max(2, Math.round(g.symSegments))
      const out: number[] = []
      for (let k = 0; k < n; k++) out.push(Math.PI / 2 + a + (2 * Math.PI * k) / n)
      return out
    }
  }
}

// ------------------------------------------------------------------ assist
export interface AssistLine {
  /** a point on the (grid-snapped) line */
  origin: Pt
  /** unit direction */
  dir: Pt
}

const unit = (a: number): Pt => ({ x: Math.cos(a), y: Math.sin(a) })

/** Family directions for grid / iso guides (unit vectors). */
export function familyDirs(g: GuideState): Pt[] {
  if (g.type === 'grid') {
    const t = g.gridRotation * RAD
    return [unit(t), unit(t + Math.PI / 2)]
  }
  const v = { x: 0, y: 1 }
  const up = unit(-30 * RAD) // up-right
  const down = unit(30 * RAD) // down-right
  switch (g.isoPlane) {
    case 'top':
      return [up, down]
    case 'left':
      return [v, down]
    case 'right':
      return [v, up]
    default:
      return [v, up, down]
  }
}

/** Snap a point's offset perpendicular to `dir` onto the nearest grid line (spacing `size`, lines through the doc origin). */
export function snapToFamily(p: Pt, dir: Pt, size: number): Pt {
  const n = { x: -dir.y, y: dir.x }
  const off = p.x * n.x + p.y * n.y
  const snapped = Math.round(off / size) * size
  return { x: p.x + n.x * (snapped - off), y: p.y + n.y * (snapped - off) }
}

/** Lines a stroke starting at `start` may be locked to. Empty for symmetry (no line lock). */
export function assistCandidates(g: GuideState, start: Pt): AssistLine[] {
  if (g.type === 'grid' || g.type === 'iso') {
    return familyDirs(g).map((dir) => ({ dir, origin: snapToFamily(start, dir, g.gridSize) }))
  }
  if (g.type === 'perspective') {
    const out: AssistLine[] = []
    for (const v of g.vps) {
      const dx = v.x - start.x
      const dy = v.y - start.y
      const d = Math.hypot(dx, dy)
      if (d > 1e-6) out.push({ origin: start, dir: { x: dx / d, y: dy / d } })
    }
    if (g.vps.length === 1) out.push({ origin: start, dir: { x: 1, y: 0 } }, { origin: start, dir: { x: 0, y: 1 } })
    else if (g.vps.length === 2) out.push({ origin: start, dir: { x: 0, y: 1 } })
    return out
  }
  return []
}

/** Pick the candidate line closest in direction to `move`. */
export function pickLine(lines: AssistLine[], move: Pt): AssistLine | null {
  const m = Math.hypot(move.x, move.y)
  if (!lines.length || m < 1e-9) return null
  let best: AssistLine | null = null
  let bestC = -1
  for (const l of lines) {
    const c = Math.abs((l.dir.x * move.x + l.dir.y * move.y) / m)
    if (c > bestC) {
      bestC = c
      best = l
    }
  }
  return best
}

export function projectOnLine(l: AssistLine, p: Pt): Pt {
  const t = (p.x - l.origin.x) * l.dir.x + (p.y - l.origin.y) * l.dir.y
  return { x: l.origin.x + l.dir.x * t, y: l.origin.y + l.dir.y * t }
}

// ------------------------------------------------------------------ transform snapping
const nearMultiple = (deg: number, step: number): boolean => {
  const m = ((deg % step) + step) % step
  return Math.min(m, step - m) < 0.01
}

/**
 * Axis-aligned lines (document px) that the Transform tool can snap to: grid lines, the symmetry axes and
 * vanishing-point coordinates. Empty when the guide is off. Lines are capped so a tiny grid stays cheap.
 */
export function snapTargetsFor(g: GuideState, w: number, h: number): { x: number[]; y: number[] } {
  const out = { x: [] as number[], y: [] as number[] }
  if (!g.enabled) return out
  if (g.type === 'grid') {
    if (!nearMultiple(g.gridRotation, 90)) return out
    let step = Math.max(4, g.gridSize)
    while (w / step > 160 || h / step > 160) step *= 2
    for (let x = step; x < w; x += step) out.x.push(x)
    for (let y = step; y < h; y += step) out.y.push(y)
  } else if (g.type === 'symmetry') {
    const a = g.symAngle
    const vertical = nearMultiple(a, 180)
    const horizontal = nearMultiple(a - 90, 180)
    if (g.symKind === 'vertical' || g.symKind === 'quadrant' || g.symKind === 'radial') {
      if (vertical) out.x.push(g.symCenter.x)
      else if (horizontal) out.y.push(g.symCenter.y)
    }
    if (g.symKind === 'horizontal' || g.symKind === 'quadrant') {
      if (vertical) out.y.push(g.symCenter.y)
      else if (horizontal) out.x.push(g.symCenter.x)
    }
  } else if (g.type === 'perspective') {
    for (const p of g.vps) {
      out.x.push(p.x)
      out.y.push(p.y)
    }
  }
  return out
}
