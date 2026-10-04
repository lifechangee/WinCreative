/**
 * Pure multi-touch gesture recognizer (no DOM). Feed it pointer down/move/up with a timestamp (ms) and
 * call tick(now) regularly while fingers are down. It reports semantic gestures through `emit`.
 */

export type Gesture =
  | { type: 'tap'; fingers: 2 | 3 | 4 | 5 }
  | { type: 'hold'; fingers: 2 | 3; phase: 'start' | 'repeat' | 'end' }
  | { type: 'scrub'; fingers: 3 }
  | { type: 'swipeDown'; fingers: 3 }
  | { type: 'quickPinch' }
  | { type: 'longPress'; x: number; y: number }
  | { type: 'transform'; prev: { x: number; y: number }; cur: { x: number; y: number }; scale: number; rot: number }

export interface GestureConfig {
  /** max duration of a tap (ms) */
  tapMs: number
  /** max finger travel (px) still counted as a tap / hold */
  moveTol: number
  /** finger-down time before 2/3 finger hold starts (ms) */
  holdMs: number
  /** repeat interval of hold gestures (ms), = Rapid Undo delay */
  repeatMs: number
  /** single-finger long press time (ms); 0 disables */
  longPressMs: number
}

export const DEFAULT_GESTURE_CONFIG: GestureConfig = { tapMs: 350, moveTol: 14, holdMs: 450, repeatMs: 90, longPressMs: 600 }

interface Finger {
  x: number
  y: number
}

/** Fires once when a point stays within `tol` px for `ms`. Used for pen touch-and-hold. */
export class HoldDetector {
  private on = false
  private x = 0
  private y = 0
  private t = 0
  private done = false
  constructor(public ms: number, public tol: number) {}
  start(x: number, y: number, t: number): void {
    this.on = true
    this.done = false
    this.x = x
    this.y = y
    this.t = t
  }
  move(x: number, y: number): void {
    if (this.on && Math.hypot(x - this.x, y - this.y) > this.tol) this.on = false
  }
  stop(): void {
    this.on = false
  }
  /** returns true once when the hold elapses */
  check(t: number): boolean {
    if (!this.on || this.done || this.ms <= 0 || t - this.t < this.ms) return false
    this.done = true
    this.on = false
    return true
  }
}

export class TouchGestures {
  private fingers = new Map<number, Finger>()
  private start = 0
  private maxCount = 0
  private maxCountTime = 0
  private moved = 0
  private holding: 2 | 3 | null = null
  private lastRepeat = 0
  private fired = false // scrub / swipe / hold already consumed this session
  private lp = { active: false, fired: false, x: 0, y: 0, t: 0 }
  private prev2: { cx: number; cy: number; dist: number; angle: number } | null = null
  private startDist = 0
  private minDistRatio = 1
  private dir = 0
  private lastExtreme = 0
  private reversals = 0
  private scrubStart = 0
  private cy0 = 0
  private cx0 = 0

  constructor(
    public cfg: GestureConfig,
    private emit: (g: Gesture) => void
  ) {}

  get count(): number {
    return this.fingers.size
  }

  reset(): void {
    this.fingers.clear()
    this.maxCount = 0
    this.moved = 0
    this.holding = null
    this.fired = false
    this.lp.active = false
    this.prev2 = null
    this.reversals = 0
    this.dir = 0
  }

  private centroid(): { x: number; y: number } {
    let x = 0
    let y = 0
    for (const f of this.fingers.values()) {
      x += f.x
      y += f.y
    }
    const n = this.fingers.size || 1
    return { x: x / n, y: y / n }
  }

  private read2(): { cx: number; cy: number; dist: number; angle: number } | null {
    if (this.fingers.size !== 2) return null
    const [a, b] = [...this.fingers.values()]
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, dist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), angle: Math.atan2(b.y - a.y, b.x - a.x) }
  }

  down(id: number, x: number, y: number, t: number): void {
    if (this.fingers.size === 0) {
      this.start = t
      this.maxCount = 0
      this.moved = 0
      this.fired = false
      this.holding = null
      this.minDistRatio = 1
    }
    this.fingers.set(id, { x, y })
    if (this.fingers.size > this.maxCount) {
      this.maxCount = this.fingers.size
      this.maxCountTime = t
      const c = this.centroid()
      this.cx0 = c.x
      this.cy0 = c.y
      this.lastExtreme = c.x
      this.reversals = 0
      this.dir = 0
      this.scrubStart = t
      this.moved = 0
    }
    if (this.fingers.size === 1) this.lp = { active: this.cfg.longPressMs > 0, fired: false, x, y, t }
    else this.lp.active = false
    this.prev2 = this.read2()
    if (this.prev2) {
      this.startDist = this.prev2.dist
      this.minDistRatio = 1
    }
  }

  move(id: number, x: number, y: number, t: number): void {
    const f = this.fingers.get(id)
    if (!f) return
    const step = Math.hypot(x - f.x, y - f.y)
    f.x = x
    f.y = y
    if (this.lp.active && Math.hypot(x - this.lp.x, y - this.lp.y) > this.cfg.moveTol) this.lp.active = false
    const n = this.fingers.size
    const c = this.centroid()

    if (n === 2) {
      const g = this.read2()!
      const p = this.prev2
      if (p && !this.fired) {
        let dRot = g.angle - p.angle
        if (dRot > Math.PI) dRot -= 2 * Math.PI
        if (dRot < -Math.PI) dRot += 2 * Math.PI
        this.moved += Math.hypot(g.cx - p.cx, g.cy - p.cy) + Math.abs(g.dist - p.dist) + Math.abs(dRot) * 30
        this.emit({ type: 'transform', prev: { x: p.cx, y: p.cy }, cur: { x: g.cx, y: g.cy }, scale: g.dist / p.dist, rot: dRot })
        this.minDistRatio = Math.min(this.minDistRatio, g.dist / this.startDist)
      }
      this.prev2 = g
      return
    }
    if (n >= 3) {
      this.moved += step / n
      if (this.fired || n !== 3) return
      // scrub: side-to-side reversals with amplitude
      const dx = c.x - this.lastExtreme
      const d = Math.sign(dx)
      if (Math.abs(dx) > 30 && d !== 0 && d !== this.dir) {
        if (this.dir !== 0) this.reversals++
        this.dir = d
        this.lastExtreme = c.x
      } else if ((this.dir > 0 && c.x > this.lastExtreme) || (this.dir < 0 && c.x < this.lastExtreme)) this.lastExtreme = c.x
      if (this.reversals >= 3 && t - this.scrubStart < 2500) {
        this.fired = true
        this.emit({ type: 'scrub', fingers: 3 })
        return
      }
      const dy = c.y - this.cy0
      if (dy > 90 && Math.abs(c.x - this.cx0) < dy * 0.6 && this.reversals === 0) {
        this.fired = true
        this.emit({ type: 'swipeDown', fingers: 3 })
      }
    } else this.moved += step
  }

  up(id: number, t: number, cancelled = false): void {
    if (!this.fingers.has(id)) return
    this.fingers.delete(id)
    this.lp.active = false
    if (this.holding) {
      this.emit({ type: 'hold', fingers: this.holding, phase: 'end' })
      this.holding = null
      this.fired = true
    }
    this.prev2 = this.read2()
    if (this.fingers.size > 0) return
    const dur = t - this.start
    const wasFired = this.fired
    const maxCount = this.maxCount
    const moved = this.moved
    this.maxCount = 0
    this.fired = false
    if (cancelled || wasFired) return
    if (maxCount >= 2 && dur < this.cfg.tapMs && moved < this.cfg.moveTol) {
      this.emit({ type: 'tap', fingers: Math.min(5, maxCount) as 2 | 3 | 4 | 5 })
    } else if (maxCount === 2 && dur < 450 && this.minDistRatio < 0.55 && this.startDist > 60) {
      this.emit({ type: 'quickPinch' })
    }
  }

  /** Drive timers (hold, repeat, long press). Call ~every 30 ms while any finger is down. */
  tick(t: number): void {
    if (this.lp.active && !this.lp.fired && this.fingers.size === 1 && t - this.lp.t >= this.cfg.longPressMs) {
      this.lp.fired = true
      this.lp.active = false
      this.emit({ type: 'longPress', x: this.lp.x, y: this.lp.y })
    }
    const n = this.fingers.size
    if ((n === 2 || n === 3) && !this.fired) {
      if (!this.holding) {
        if (n === this.maxCount && t - this.maxCountTime >= this.cfg.holdMs && this.moved < this.cfg.moveTol) {
          this.holding = n as 2 | 3
          this.lastRepeat = t
          this.emit({ type: 'hold', fingers: this.holding, phase: 'start' })
        }
      } else if (t - this.lastRepeat >= this.cfg.repeatMs) {
        this.lastRepeat = t
        this.emit({ type: 'hold', fingers: this.holding, phase: 'repeat' })
      }
    }
  }
}
