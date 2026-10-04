export type CurvePoint = [number, number]

/** Default is identity. Points are (input, output) in 0..1, sorted by input. */
export interface PressureCurveSettings {
  points: CurvePoint[]
}

export const LINEAR_CURVE: PressureCurveSettings = { points: [[0, 0], [1, 1]] }

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Build a smooth monotone (Fritsch-Carlson) curve function through the given points. */
export function makePressureCurve(settings: PressureCurveSettings): (p: number) => number {
  const pts = [...settings.points].sort((a, b) => a[0] - b[0])
  if (pts.length < 2) return (p) => clamp01(p)
  const n = pts.length
  const dx: number[] = []
  const m: number[] = []
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0] || 1e-9)
    m.push((pts[i + 1][1] - pts[i][1]) / dx[i])
  }
  const t: number[] = new Array(n)
  t[0] = m[0]
  t[n - 1] = m[n - 2]
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0
      t[i + 1] = 0
      continue
    }
    const a = t[i] / m[i]
    const b = t[i + 1] / m[i]
    const s = a * a + b * b
    if (s > 9) {
      const k = 3 / Math.sqrt(s)
      t[i] = k * a * m[i]
      t[i + 1] = k * b * m[i]
    }
  }
  return (p: number) => {
    const x = clamp01(p)
    if (x <= pts[0][0]) return clamp01(pts[0][1])
    if (x >= pts[n - 1][0]) return clamp01(pts[n - 1][1])
    let i = 0
    while (i < n - 2 && x > pts[i + 1][0]) i++
    const h = dx[i]
    const s = (x - pts[i][0]) / h
    const s2 = s * s
    const s3 = s2 * s
    const y =
      (2 * s3 - 3 * s2 + 1) * pts[i][1] +
      (s3 - 2 * s2 + s) * h * t[i] +
      (-2 * s3 + 3 * s2) * pts[i + 1][1] +
      (s3 - s2) * h * t[i + 1]
    return clamp01(y)
  }
}

/** Convenience gamma-style curve (gamma below 1 = lighter touch needed, above 1 = firmer). */
export function gammaCurve(gamma: number): PressureCurveSettings {
  const pts: CurvePoint[] = []
  for (let i = 0; i <= 8; i++) pts.push([i / 8, Math.pow(i / 8, gamma)])
  return { points: pts }
}

// ---------------------------------------------------------------- curve editing helpers (pressure curve editor)

/** Named starting points for the curve editor. */
export const PRESSURE_PRESETS: Record<string, PressureCurveSettings> = {
  Linear: { points: [[0, 0], [1, 1]] },
  Soft: { points: [[0, 0], [0.25, 0.42], [0.6, 0.8], [1, 1]] },
  Firm: { points: [[0, 0], [0.4, 0.2], [0.75, 0.62], [1, 1]] },
  'S-curve': { points: [[0, 0], [0.25, 0.12], [0.5, 0.5], [0.75, 0.88], [1, 1]] },
  'Light touch': { points: [[0, 0], [0.12, 0.35], [0.5, 0.85], [1, 1]] }
}

export const MIN_POINT_GAP = 0.02

/** Clamp to 0..1, sort, guarantee x=0 and x=1 end points and a minimum gap between points. */
export function sanitizeCurve(points: CurvePoint[] | undefined | null): PressureCurveSettings {
  const raw = (Array.isArray(points) ? points : []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
  const pts: CurvePoint[] = raw.map((p) => [clamp01(p[0]), clamp01(p[1])] as CurvePoint).sort((a, b) => a[0] - b[0])
  if (!pts.length || pts[0][0] > 0) pts.unshift([0, pts.length ? pts[0][1] : 0])
  if (pts[pts.length - 1][0] < 1) pts.push([1, pts[pts.length - 1][1] > 0.999 ? 1 : pts[pts.length - 1][1]])
  pts[0][0] = 0
  pts[pts.length - 1][0] = 1
  const out: CurvePoint[] = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    const last = out[out.length - 1]
    if (i === pts.length - 1) {
      if (pts[i][0] - last[0] < MIN_POINT_GAP && out.length > 1) out.pop()
      out.push(pts[i])
    } else if (pts[i][0] - last[0] >= MIN_POINT_GAP && 1 - pts[i][0] >= MIN_POINT_GAP) out.push(pts[i])
  }
  return { points: out }
}

/** Insert a point keeping the list sorted; returns the new index or -1 if too close to a neighbour. */
export function insertCurvePoint(s: PressureCurveSettings, x: number, y: number): number {
  x = clamp01(x)
  y = clamp01(y)
  const pts = s.points
  for (const p of pts) if (Math.abs(p[0] - x) < MIN_POINT_GAP) return -1
  let i = 0
  while (i < pts.length && pts[i][0] < x) i++
  pts.splice(i, 0, [x, y])
  return i
}

/** Move point i (end points keep their x). Neighbours limit x so points never cross. */
export function moveCurvePoint(s: PressureCurveSettings, i: number, x: number, y: number): void {
  const pts = s.points
  const last = pts.length - 1
  if (i === 0 || i === last) pts[i][1] = clamp01(y)
  else {
    const lo = pts[i - 1][0] + MIN_POINT_GAP
    const hi = pts[i + 1][0] - MIN_POINT_GAP
    pts[i] = [Math.min(hi, Math.max(lo, x)), clamp01(y)]
  }
}

/** Remove an interior point (end points cannot be removed). */
export function removeCurvePoint(s: PressureCurveSettings, i: number): boolean {
  if (i <= 0 || i >= s.points.length - 1) return false
  s.points.splice(i, 1)
  return true
}
