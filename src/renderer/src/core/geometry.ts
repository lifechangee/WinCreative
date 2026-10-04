import type { Rect } from './types'

export const emptyRect = (): Rect => ({ x: 0, y: 0, w: 0, h: 0 })
export const isEmpty = (r: Rect): boolean => r.w <= 0 || r.h <= 0

export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a || isEmpty(a)) return b && !isEmpty(b) ? { ...b } : null
  if (!b || isEmpty(b)) return { ...a }
  const x0 = Math.min(a.x, b.x)
  const y0 = Math.min(a.y, b.y)
  const x1 = Math.max(a.x + a.w, b.x + b.w)
  const y1 = Math.max(a.y + a.h, b.y + b.h)
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

export function intersectRect(a: Rect, b: Rect): Rect | null {
  const x0 = Math.max(a.x, b.x)
  const y0 = Math.max(a.y, b.y)
  const x1 = Math.min(a.x + a.w, b.x + b.w)
  const y1 = Math.min(a.y + a.h, b.y + b.h)
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null
}

/** Integer rect covering the float rect, clipped to [0,w]x[0,h]. Null if empty. */
export function clampToCanvas(r: Rect, w: number, h: number): Rect | null {
  const x0 = Math.max(0, Math.floor(r.x))
  const y0 = Math.max(0, Math.floor(r.y))
  const x1 = Math.min(w, Math.ceil(r.x + r.w))
  const y1 = Math.min(h, Math.ceil(r.y + r.h))
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null
}

export const expandRect = (r: Rect, m: number): Rect => ({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m })

/** Bounding box of a dab (circle of diameter size, with margin). */
export function dabBounds(x: number, y: number, size: number, margin = 2): Rect {
  const r = size / 2 + margin
  return { x: x - r, y: y - r, w: 2 * r, h: 2 * r }
}
