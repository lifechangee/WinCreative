export interface Vec {
  x: number
  y: number
}

/** Longest predicted extension shown, css px. */
export const MAX_EXTENSION = 24
/** Fraction of the raw predicted delta that is trusted (the rest is damped away). */
const DAMP = 0.6
/** Exponential smoothing factor applied to the extension vector each event. */
const SMOOTH = 0.3

/**
 * Turns the raw (noisy, jumpy) predicted tip delta into a short, damped, smoothed extension of the painted tip.
 * - clamped to MAX_EXTENSION (no overshoot),
 * - discarded when it points against the recent motion (no backtracking),
 * - exponentially smoothed against the previous extension so frame-to-frame changes are small.
 * `raw` = predicted tip - raw pointer; `motion` = raw pointer delta since the previous event (null when unknown).
 */
export function smoothExtension(prev: Vec | null, raw: Vec, motion: Vec | null): Vec {
  let tx = raw.x * DAMP
  let ty = raw.y * DAMP
  if (motion && motion.x * tx + motion.y * ty < 0) {
    tx = 0
    ty = 0
  }
  const len = Math.hypot(tx, ty)
  if (len > MAX_EXTENSION) {
    tx *= MAX_EXTENSION / len
    ty *= MAX_EXTENSION / len
  }
  if (!prev) return { x: tx * SMOOTH, y: ty * SMOOTH }
  return { x: prev.x + (tx - prev.x) * SMOOTH, y: prev.y + (ty - prev.y) * SMOOTH }
}
