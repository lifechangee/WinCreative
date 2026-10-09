import type { Document } from '../../doc/document'
import { intersectRect } from './model'
import { getFrame } from './state'

interface Img {
  x: number
  y: number
  w: number
  h: number
  /** straight RGBA8 */
  data: Uint8ClampedArray
}

/**
 * Pasted / inserted pixels while the frame clips: keep only the part inside the frame (null = nothing is left, so the layer stays empty).
 * Frame OFF (or no frame) returns the image unchanged.
 */
export function clipImageToFrame<T extends Img>(doc: Document, img: T): T | null {
  const f = getFrame(doc)
  if (!f || !f.enabled) return img
  const r = intersectRect({ x: img.x, y: img.y, w: img.w, h: img.h }, f)
  if (!r) return null
  if (r.w === img.w && r.h === img.h) return img
  const data = new Uint8ClampedArray(r.w * r.h * 4)
  for (let y = 0; y < r.h; y++) {
    const so = ((r.y - img.y + y) * img.w + (r.x - img.x)) * 4
    data.set(img.data.subarray(so, so + r.w * 4), y * r.w * 4)
  }
  return { ...img, x: r.x, y: r.y, w: r.w, h: r.h, data }
}
