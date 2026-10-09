import type { Rect } from '../../core/types'

/**
 * The document frame (one per document): a rectangle in document pixels that bounds recording content.
 *  - `enabled`: clip painting to it + dim the outside; off = paint anywhere and show a thin outline (when `visible`).
 * It defines the time-lapse area and the default export area.
 */
export interface FrameData {
  x: number
  y: number
  w: number
  h: number
  enabled: boolean
  /** show the outline while `enabled` is off */
  visible: boolean
  /** preset id this frame was made from (informational, e.g. 'reels') */
  preset?: string
}

export interface FramePreset {
  id: string
  w: number
  h: number
}

/** Frame presets; the label of `<id>` is the i18n key `frame.preset.<id>`. */
export const FRAME_PRESETS: FramePreset[] = [
  { id: 'reels', w: 1080, h: 1920 },
  { id: 'hd', w: 1920, h: 1080 },
  { id: 'uhd', w: 3840, h: 2160 },
  { id: 'sq1080', w: 1080, h: 1080 },
  { id: 'sq2048', w: 2048, h: 2048 },
  { id: 'portrait45', w: 1080, h: 1350 },
  { id: 'a4p', w: 2480, h: 3508 },
  { id: 'a4l', w: 3508, h: 2480 }
]

export const MIN_FRAME = 16
export const MAX_FRAME = 16384

export const presetById = (id: string): FramePreset | undefined => FRAME_PRESETS.find((p) => p.id === id)

export const clampInt = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Math.round(Number.isFinite(v) ? v : lo)))

/** Normalise a frame: integer pixel rect, size within limits (and within `maxSize` when given, e.g. a fixed canvas). */
export function normalizeFrame(f: FrameData, maxSize?: { w: number; h: number }): FrameData {
  const w = clampInt(f.w, MIN_FRAME, MAX_FRAME)
  const h = clampInt(f.h, MIN_FRAME, MAX_FRAME)
  return { ...f, x: Math.round(f.x), y: Math.round(f.y), w: maxSize ? Math.min(w, maxSize.w) : w, h: maxSize ? Math.min(h, maxSize.h) : h }
}

/** Frame of preset size centred on `around` (a point or the middle of a rect). */
export function frameCenteredOn(w: number, h: number, around: { x: number; y: number }): Rect {
  return { x: Math.round(around.x - w / 2), y: Math.round(around.y - h / 2), w, h }
}

export function intersectRect(a: Rect, b: Rect): Rect | null {
  const x0 = Math.max(a.x, b.x)
  const y0 = Math.max(a.y, b.y)
  const x1 = Math.min(a.x + a.w, b.x + b.w)
  const y1 = Math.min(a.y + a.h, b.y + b.h)
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null
}

/** Effective clip rectangle of an operation: the selection bounds (null = no selection) x the frame (null = clipping off). */
export function effectiveClip(sel: Rect | null, frame: Rect | null): Rect | null | 'empty' {
  if (!sel) return frame
  if (!frame) return sel
  return intersectRect(sel, frame) ?? 'empty'
}

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move'

/**
 * Drag a handle by (dx,dy) document pixels from `start`. `lock` keeps the aspect ratio (corners; edges scale the other axis around the centre line).
 * Result is an integer rect with size >= MIN_FRAME (the dragged edge stops there).
 */
export function dragFrame(start: Rect, handle: Handle, dx: number, dy: number, lock: boolean, snap = true): Rect {
  const r = (v: number): number => (snap ? Math.round(v) : v)
  if (handle === 'move') return { ...start, x: r(start.x + dx), y: r(start.y + dy) }
  let x0 = start.x
  let y0 = start.y
  let x1 = start.x + start.w
  let y1 = start.y + start.h
  if (handle.includes('w')) x0 = Math.min(r(x0 + dx), x1 - MIN_FRAME)
  if (handle.includes('e')) x1 = Math.max(r(x1 + dx), x0 + MIN_FRAME)
  if (handle.includes('n')) y0 = Math.min(r(y0 + dy), y1 - MIN_FRAME)
  if (handle.includes('s')) y1 = Math.max(r(y1 + dy), y0 + MIN_FRAME)
  if (lock) {
    const ar = start.w / start.h
    let w = x1 - x0
    let h = y1 - y0
    const horiz = handle === 'e' || handle === 'w'
    const vert = handle === 'n' || handle === 's'
    if (horiz) h = Math.max(MIN_FRAME, Math.round(w / ar))
    else if (vert) w = Math.max(MIN_FRAME, Math.round(h * ar))
    else if (w / ar > h) h = Math.max(MIN_FRAME, Math.round(w / ar))
    else w = Math.max(MIN_FRAME, Math.round(h * ar))
    // anchor: the edge opposite the dragged handle (edges: centre line of the other axis)
    if (handle.includes('w')) x0 = x1 - w
    else if (handle.includes('e') || vert) x1 = x0 + w
    if (vert) {
      const cx = (start.x * 2 + start.w) / 2
      x0 = Math.round(cx - w / 2)
      x1 = x0 + w
    }
    if (handle.includes('n')) y0 = y1 - h
    else if (handle.includes('s') || horiz) y1 = y0 + h
    if (horiz) {
      const cy = (start.y * 2 + start.h) / 2
      y0 = Math.round(cy - h / 2)
      y1 = y0 + h
    }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** New size with the aspect ratio of `from` kept when changing one dimension. */
export function lockedSize(from: { w: number; h: number }, field: 'w' | 'h', value: number): { w: number; h: number } {
  const v = clampInt(value, MIN_FRAME, MAX_FRAME)
  return field === 'w' ? { w: v, h: clampInt((v * from.h) / from.w, MIN_FRAME, MAX_FRAME) } : { w: clampInt((v * from.w) / from.h, MIN_FRAME, MAX_FRAME), h: v }
}

/** Letterbox a `sw x sh` source into an `ow x oh` output: the destination rectangle (integers, centred, aspect kept). */
export function letterbox(sw: number, sh: number, ow: number, oh: number): Rect {
  if (sw <= 0 || sh <= 0) return { x: 0, y: 0, w: ow, h: oh }
  const k = Math.min(ow / sw, oh / sh)
  const w = Math.max(1, Math.min(ow, Math.round(sw * k)))
  const h = Math.max(1, Math.min(oh, Math.round(sh * k)))
  return { x: Math.floor((ow - w) / 2), y: Math.floor((oh - h) / 2), w, h }
}

/** Even output size (video codecs) with the aspect of `w x h` whose long side is at most `longSide`. */
export function fitOutputSize(w: number, h: number, longSide: number): { w: number; h: number } {
  const k = Math.min(1, longSide / Math.max(w, h))
  const ev = (v: number): number => Math.max(2, Math.round((v * k) / 2) * 2)
  return { w: ev(w), h: ev(h) }
}

export const sameRect = (a: Rect | null, b: Rect | null): boolean => (!a || !b ? a === b : a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h)

/** Aspect label such as "9:16" (reduced when it is a neat ratio, else "1.78:1"). */
export function aspectLabel(w: number, h: number): string {
  const g = (a: number, b: number): number => (b ? g(b, a % b) : a)
  const d = g(w, h)
  const a = w / d
  const b = h / d
  return a <= 32 && b <= 32 ? `${a}:${b}` : `${(w / h).toFixed(2)}:1`
}
