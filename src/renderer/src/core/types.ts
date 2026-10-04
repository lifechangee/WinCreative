/** A raw or smoothed pointer sample in DOCUMENT coordinates (pixels, y down). */
export interface Sample {
  x: number
  y: number
  /** 0..1 */
  pressure: number
  /** degrees -90..90 */
  tiltX: number
  tiltY: number
  /** degrees 0..359 */
  twist: number
  /** ms (performance.now timebase) */
  t: number
  /** input device (optional; brushes use it to pick pen vs touch taper) */
  pointerType?: 'pen' | 'mouse' | 'touch'
  /** stroke speed in px/ms (filled in by the brush pipeline) */
  speed?: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** One stamp of the brush. All positions are sub-pixel floats in document space. */
export interface Dab {
  x: number
  y: number
  /** diameter in px */
  size: number
  /** radians */
  angle: number
  /** 0..1 per-dab flow alpha */
  alpha: number
  /** minor/major axis ratio 0..1 */
  roundness: number
  /** smudge pickup position (previous/lagged point) */
  px: number
  py: number
}
