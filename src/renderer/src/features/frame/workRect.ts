import type { App } from '../../app/app'
import type { Rect } from '../../core/types'
import type { Document } from '../../doc/document'
import { screenToDoc } from '../../core/viewTransform'
import { getFrame } from './state'

/** Largest doc-space extent a "whole canvas" tool may be handed on an infinite document (GPU texture limit guard). */
const MAX_EXTENT = 8192

/** The document's single frame rectangle (doc space), or null when it has none. */
export function frameRect(doc: Document): Rect | null {
  const f = getFrame(doc)
  return f ? { x: f.x, y: f.y, w: f.w, h: f.h } : null
}

/** true when a frame exists and clipping to it is switched on. */
export function frameEnabled(doc: Document): boolean {
  const f = getFrame(doc)
  return !!f && f.enabled
}

/** Axis-aligned doc-space bounding box of what the screen currently shows (rotation / mirror respected). */
export function viewportRect(app: App): Rect {
  const { w: sw, h: sh } = app.cssSize()
  const pts = [screenToDoc(app.view, 0, 0, sw, sh), screenToDoc(app.view, sw, 0, sw, sh), screenToDoc(app.view, sw, sh, sw, sh), screenToDoc(app.view, 0, sh, sw, sh)]
  const x0 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x))
  const y0 = Math.min(...pts.map((p) => p.y)), y1 = Math.max(...pts.map((p) => p.y))
  const x = Math.floor(x0), y = Math.floor(y0)
  return { x, y, w: Math.max(1, Math.min(MAX_EXTENT, Math.ceil(x1) - x)), h: Math.max(1, Math.min(MAX_EXTENT, Math.ceil(y1) - y)) }
}

/** The doc-space rectangle "whole-canvas" tools operate on: fixed = the canvas; infinite = the frame, else the visible viewport. */
export function workRect(app: App): Rect {
  const doc = app.doc
  if (!doc.isInfinite) return { x: 0, y: 0, w: doc.width, h: doc.height }
  return frameRect(doc) ?? viewportRect(app)
}
