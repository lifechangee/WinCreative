/** Pure decision helpers for touch gestures on layer rows (see ui/layerPanel.ts). Unit-tested in tests/rowGestures.test.ts. */

export type TwoFingerKind = 'pending' | 'swipe-right' | 'hold' | 'tap'

export const TWO_FINGER = { swipePx: 40, movePx: 12, holdMs: 550, tapMs: 350 }

/**
 * Two fingers on ONE layer row. `dx`/`dy` = movement of the pair's centre since both fingers were down,
 * `dt` = ms since then, `released` = the fingers were lifted.
 * swipe right -> Alpha Lock, held still -> select layer contents, quick tap -> opacity slider.
 */
export function classifyTwoFinger(dx: number, dy: number, dt: number, released: boolean): TwoFingerKind {
  if (dx >= TWO_FINGER.swipePx && Math.abs(dx) > Math.abs(dy) * 1.5) return 'swipe-right'
  const still = Math.hypot(dx, dy) < TWO_FINGER.movePx
  if (!released) return still && dt >= TWO_FINGER.holdMs ? 'hold' : 'pending'
  return still && dt <= TWO_FINGER.tapMs ? 'tap' : 'pending'
}

/** Two fingers on two DIFFERENT rows moving towards each other = merge those layers. */
export function isPinchTogether(startDist: number, dist: number): boolean {
  return startDist - dist >= 24 && dist <= startDist * 0.65
}
