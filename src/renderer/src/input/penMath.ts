/** Pure pen helpers: tilt conversion, per-device pressure calibration, pressure smoothing. */

const DEG = Math.PI / 180

/**
 * W3C tiltX/tiltY (degrees, -90..90) -> spherical azimuth (radians 0..2PI, 0 = +x, clockwise on screen)
 * and altitude (radians, PI/2 = perpendicular to the surface, 0 = flat).
 */
export function tiltToSpherical(tiltX: number, tiltY: number): { azimuth: number; altitude: number } {
  const cx = Math.max(-89.9, Math.min(89.9, tiltX || 0))
  const cy = Math.max(-89.9, Math.min(89.9, tiltY || 0))
  if (cx === 0 && cy === 0) return { azimuth: 0, altitude: Math.PI / 2 }
  const tx = Math.tan(cx * DEG)
  const ty = Math.tan(cy * DEG)
  let azimuth = Math.atan2(ty, tx)
  if (azimuth < 0) azimuth += Math.PI * 2
  const altitude = Math.atan(1 / Math.hypot(tx, ty))
  return { azimuth, altitude }
}

/** Inverse of tiltToSpherical (degrees). */
export function sphericalToTilt(azimuth: number, altitude: number): { tiltX: number; tiltY: number } {
  const r = altitude >= Math.PI / 2 - 1e-9 ? 0 : 1 / Math.tan(altitude)
  return { tiltX: Math.atan(r * Math.cos(azimuth)) / DEG, tiltY: Math.atan(r * Math.sin(azimuth)) / DEG }
}

/**
 * Some tablet drivers never report 1.0 (they clip at e.g. 0.87). We watch for a plateau: many samples
 * at the same maximum. Once found, pressures are rescaled so that value maps to 1.
 */
export class PressureCalibrator {
  enabled = true
  peak: number
  private hits: number
  constructor(peak = 0, hits = 0) {
    this.peak = peak
    this.hits = hits
  }
  /** a clipped driver repeats the identical ceiling value: tolerance is ~4 steps of a 8192-level tablet */
  static readonly TOL = 0.0005
  /** consecutive samples at the ceiling that prove a plateau (a hand holding steady pressure does not do this) */
  static readonly RUN = 12
  static readonly MIN_HITS = 12
  private run = 0

  observe(raw: number): void {
    if (!(raw > 0.3) || raw > 1) return
    if (raw > this.peak + PressureCalibrator.TOL) {
      this.peak = raw
      this.hits = 1
      this.run = 1
    } else if (raw >= this.peak - PressureCalibrator.TOL) {
      if (raw > this.peak) this.peak = raw
      this.run++
      // only an unbroken run counts: a loosely steady hand must not be mistaken for a driver ceiling
      if (this.run >= PressureCalibrator.RUN) this.hits = Math.max(this.hits + 1, PressureCalibrator.MIN_HITS)
    } else this.run = 0
  }
  /** Scale factor currently applied (1 = none). */
  get scale(): number {
    if (!this.enabled) return 1
    if (this.hits >= PressureCalibrator.MIN_HITS && this.peak >= 0.6 && this.peak < 0.985) return this.peak
    return 1
  }
  get calibrated(): boolean {
    return this.scale !== 1
  }
  normalize(raw: number): number {
    const v = raw / this.scale
    return v < 0 ? 0 : v > 1 ? 1 : v
  }
  reset(): void {
    this.peak = 0
    this.hits = 0
  }
  toJSON(): { peak: number; hits: number } {
    return { peak: this.peak, hits: Math.min(this.hits, 1000) }
  }
}

/** One-pole low-pass on pressure. amount 0 = off .. 1 = heavy. Reset at stroke start. */
export class PressureSmoother {
  private v = -1
  reset(): void {
    this.v = -1
  }
  apply(p: number, amount: number): number {
    if (amount <= 0 || this.v < 0) {
      this.v = p
      return p
    }
    const a = 1 - Math.min(0.92, amount * 0.92)
    this.v += (p - this.v) * a
    return this.v
  }
}
