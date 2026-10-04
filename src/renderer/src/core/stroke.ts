import type { Sample } from './types'

/** A point along the path where a dab should be stamped. */
export interface PathPoint extends Sample {
  /** direction of travel, radians */
  angle: number
  /** cumulative path length from stroke start, px */
  distance: number
}

/** Returns the spacing (px) to use after stamping at this sample. */
export type SpacingFn = (s: Sample) => number

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

export function lerpSample(a: Sample, b: Sample, t: number): Sample {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    pressure: lerp(a.pressure, b.pressure, t),
    tiltX: lerp(a.tiltX, b.tiltX, t),
    tiltY: lerp(a.tiltY, b.tiltY, t),
    twist: lerp(a.twist, b.twist, t),
    t: lerp(a.t, b.t, t),
    ...(a.pointerType || b.pointerType ? { pointerType: a.pointerType ?? b.pointerType } : {}),
    ...(a.speed !== undefined || b.speed !== undefined ? { speed: lerp(a.speed ?? b.speed ?? 0, b.speed ?? a.speed ?? 0, t) } : {})
  }
}

/** Uniform Catmull-Rom for one scalar. */
export function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t
  const t3 = t2 * t
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
}

/**
 * Turns a stream of samples into evenly spaced path points:
 *  - Catmull-Rom smoothing through samples (1 sample latency),
 *  - distance-based spacing with the remainder carried across segments,
 *  - pressure/tilt linearly interpolated.
 */
export class StrokeBuilder {
  private w: Sample[] = [] // last (up to) 4 samples
  private count = 0
  private remain = 0 // distance still to travel before next dab
  private dist = 0
  private lastAngle = 0

  constructor(private spacing: SpacingFn) {}

  private minSpacing(s: Sample): number {
    return Math.max(0.05, this.spacing(s))
  }

  push(s: Sample): PathPoint[] {
    const out: PathPoint[] = []
    const last = this.w[this.w.length - 1]
    if (last && Math.hypot(s.x - last.x, s.y - last.y) < 0.01) {
      // coincident position: keep the freshest pressure but add no geometry
      last.pressure = s.pressure
      last.tiltX = s.tiltX
      last.tiltY = s.tiltY
      last.twist = s.twist
      if (s.speed !== undefined) last.speed = s.speed
      return out
    }
    this.w.push({ ...s })
    if (this.w.length > 4) this.w.shift()
    this.count++
    if (this.count === 1) {
      this.remain = this.minSpacing(s)
      out.push({ ...s, angle: 0, distance: 0 })
      return out
    }
    if (this.count >= 3) {
      const n = this.w.length
      // segment P(k-2) -> P(k-1) with neighbours P(k-3) (or itself) and P(k)
      const p0 = n >= 4 ? this.w[n - 4] : this.w[n - 3]
      this.segment(p0, this.w[n - 3], this.w[n - 2], this.w[n - 1], out)
    }
    return out
  }

  /** Flush the final segment. */
  end(): PathPoint[] {
    const out: PathPoint[] = []
    const n = this.w.length
    if (this.count >= 2) {
      const p2 = this.w[n - 1]
      const p1 = this.w[n - 2]
      const p0 = n >= 3 ? this.w[n - 3] : p1
      this.segment(p0, p1, p2, p2, out)
    }
    this.w = []
    this.count = 0
    return out
  }

  private segment(p0: Sample, p1: Sample, p2: Sample, p3: Sample, out: PathPoint[]): void {
    const chord = Math.hypot(p2.x - p1.x, p2.y - p1.y)
    const steps = Math.max(1, Math.min(96, Math.ceil(chord / 1.5)))
    let prev: Sample = p1
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const cur = lerpSample(p1, p2, t)
      cur.x = catmullRom(p0.x, p1.x, p2.x, p3.x, t)
      cur.y = catmullRom(p0.y, p1.y, p2.y, p3.y, t)
      const d = Math.hypot(cur.x - prev.x, cur.y - prev.y)
      if (d > 1e-9) {
        this.lastAngle = Math.atan2(cur.y - prev.y, cur.x - prev.x)
        let pos = 0
        while (pos + this.remain <= d) {
          pos += this.remain
          const e = lerpSample(prev, cur, pos / d)
          out.push({ ...e, angle: this.lastAngle, distance: this.dist + pos })
          this.remain = this.minSpacing(e)
        }
        this.remain -= d - pos
        this.dist += d
      }
      prev = cur
    }
  }
}
