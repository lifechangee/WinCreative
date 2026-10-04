import { PathSmoother, SmoothingSettings } from './smoothing'
import type { Sample } from './types'

export interface StabilizerSettings extends SmoothingSettings {
  /** smooths pressure variation 0..1 */
  streamlinePressure: number
  /** speed dependent moving average 0..1 */
  stabilization: number
  /** adaptive low-pass 0..1 */
  motionFiltering: number
  /** restores expressiveness lost to filtering 0..1 */
  motionExpression: number
}

/** One Euro filter (Casiez et al.) - low-pass whose cutoff rises with speed, so corners survive. */
class OneEuro {
  private px = 0
  private py = 0
  private dx = 0
  private dy = 0
  private t = 0
  private init = false
  constructor(
    private minCut: number,
    private beta: number
  ) {}
  private static alpha(cut: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cut)
    return 1 / (1 + tau / dt)
  }
  filter(x: number, y: number, tMs: number): [number, number] {
    if (!this.init) {
      this.init = true
      this.px = x
      this.py = y
      this.t = tMs
      return [x, y]
    }
    const dt = Math.max(0.001, Math.min(0.1, (tMs - this.t) / 1000))
    this.t = tMs
    const ad = OneEuro.alpha(1, dt)
    const rx = (x - this.px) / dt
    const ry = (y - this.py) / dt
    this.dx += (rx - this.dx) * ad
    this.dy += (ry - this.dy) * ad
    const speed = Math.hypot(this.dx, this.dy)
    const a = OneEuro.alpha(this.minCut + this.beta * speed, dt)
    this.px += (x - this.px) * a
    this.py += (y - this.py) * a
    return [this.px, this.py]
  }
}

/**
 * Input stabilisation chain: Motion Filtering (One Euro) -> Stabilization (speed dependent moving average)
 * -> StreamLine (lag smoothing, PathSmoother) with optional extra pressure smoothing.
 */
export class InputStabilizer {
  private mf: OneEuro | null
  private buf: Sample[] = []
  private smoother: PathSmoother
  private last: Sample | null = null
  private outP = -1
  private speed = 0
  private prevRaw: Sample | null = null

  constructor(private s: StabilizerSettings) {
    const m = Math.min(1, Math.max(0, s.motionFiltering))
    this.mf = m > 0 ? new OneEuro(0.4 + 24 * Math.pow(1 - m, 2.2), 0.004 + 0.06 * s.motionExpression * s.motionExpression + 0.01 * s.motionExpression) : null
    this.smoother = new PathSmoother({ amount: s.amount, mode: s.mode, lazyRadius: s.lazyRadius })
  }

  push(raw: Sample): Sample {
    this.last = raw
    if (this.prevRaw) {
      const dt = Math.max(1, raw.t - this.prevRaw.t)
      const v = Math.hypot(raw.x - this.prevRaw.x, raw.y - this.prevRaw.y) / dt
      this.speed += (v - this.speed) * 0.3
    }
    this.prevRaw = raw
    let s: Sample = { ...raw }
    if (this.mf) {
      const [x, y] = this.mf.filter(s.x, s.y, s.t)
      s.x = x
      s.y = y
    }
    if (this.s.stabilization > 0) {
      const n = 1 + Math.round(this.s.stabilization * 22)
      const eff = Math.max(1, Math.round(n / (1 + this.speed * 0.45)))
      this.buf.push({ ...s })
      if (this.buf.length > 24) this.buf.shift()
      const k = Math.min(eff, this.buf.length)
      let sx = 0
      let sy = 0
      for (let i = this.buf.length - k; i < this.buf.length; i++) {
        sx += this.buf[i].x
        sy += this.buf[i].y
      }
      s.x = sx / k
      s.y = sy / k
    }
    const o = this.smoother.push(s)
    const sp = this.s.streamlinePressure
    if (sp > 0) {
      if (this.outP < 0) this.outP = o.pressure
      this.outP += (o.pressure - this.outP) * (1 - sp * 0.93)
      o.pressure = this.outP
    }
    return o
  }

  /** Extra samples so the stabilised path catches up with the last raw sample. */
  finish(): Sample[] {
    const out: Sample[] = []
    const l = this.last
    if (!l) return out
    const lag = this.s.amount > 0 || this.s.stabilization > 0 || this.s.motionFiltering > 0
    if (!lag) return out
    let prev: Sample | null = null
    for (let i = 0; i < 120; i++) {
      const o = this.push({ ...l, t: (prev?.t ?? l.t) + 8 })
      prev = o
      out.push(o)
      if (Math.hypot(l.x - o.x, l.y - o.y) < 0.3) break
    }
    out.push({ ...l })
    return out
  }
}
