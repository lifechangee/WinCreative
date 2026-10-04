import type { Sample } from './types'

export interface SmoothingSettings {
  /** 0 = off .. 1 = maximum. */
  amount: number
  /** 'exp' = exponential (StreamLine-like); 'lazy' = lazy-brush with a dead-zone radius (px) */
  mode: 'exp' | 'lazy'
  lazyRadius: number
}

export const DEFAULT_SMOOTHING: SmoothingSettings = { amount: 0.3, mode: 'exp', lazyRadius: 24 }

/**
 * Stabilises raw pointer input. `push` returns the smoothed sample; `finish` returns extra
 * samples that let the smoothed path catch up with the last raw sample (exp mode).
 */
export class PathSmoother {
  private cur: Sample | null = null
  private last: Sample | null = null

  constructor(public settings: SmoothingSettings) {}

  reset(): void {
    this.cur = null
    this.last = null
  }

  private factor(dt: number): number {
    const a = Math.min(0.985, Math.max(0, this.settings.amount))
    if (a <= 0) return 1
    // time-normalised: fraction of lag retained per 8ms
    return 1 - Math.pow(a, Math.max(1, Math.min(50, dt)) / 8)
  }

  push(s: Sample): Sample {
    this.last = s
    if (!this.cur || this.settings.amount <= 0) {
      this.cur = { ...s }
      return { ...this.cur }
    }
    const c = this.cur
    if (this.settings.mode === 'lazy') {
      const dx = s.x - c.x
      const dy = s.y - c.y
      const d = Math.hypot(dx, dy)
      const r = this.settings.lazyRadius * this.settings.amount
      if (d > r) {
        const k = (d - r) / d
        c.x += dx * k
        c.y += dy * k
      }
      c.pressure = s.pressure
      c.tiltX = s.tiltX
      c.tiltY = s.tiltY
      c.twist = s.twist
      c.t = s.t
      return { ...c }
    }
    const k = this.factor(s.t - c.t)
    const kp = Math.min(1, k * 2)
    c.x += (s.x - c.x) * k
    c.y += (s.y - c.y) * k
    c.pressure += (s.pressure - c.pressure) * kp
    c.tiltX += (s.tiltX - c.tiltX) * kp
    c.tiltY += (s.tiltY - c.tiltY) * kp
    c.twist = s.twist
    c.t = s.t
    return { ...c }
  }

  /** Catch-up samples so the stroke ends at the pointer (exp mode only). */
  finish(): Sample[] {
    const out: Sample[] = []
    if (!this.cur || !this.last || this.settings.mode !== 'exp' || this.settings.amount <= 0) return out
    const l = this.last
    for (let i = 0; i < 80; i++) {
      const c = this.cur
      if (Math.hypot(l.x - c.x, l.y - c.y) < 0.3) break
      out.push(this.push({ ...l, t: c.t + 8 }))
    }
    if (out.length) out.push({ ...l })
    return out
  }
}
