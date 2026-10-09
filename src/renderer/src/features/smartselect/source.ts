/**
 * Pixel source adapter for Smart selection. Everything outside this file asks for pixels through `getSourceImage(rect, sample)`
 * and `sourceInfo(sample)` in document-space rects, so the tiled / infinite canvas can re-point it to its region API later
 * without touching the tool. Built only on public APIs: layer surfaces (gpu.readRGBA8) and compositor.readFlattened.
 */
import type { App } from '../../app/app'
import type { Rect } from '../../core/types'
import { screenToDoc } from '../../core/viewTransform'
import type { Layer } from '../../doc/layer'
import { workRect } from '../frame/workRect'
import { rectInt, rectIntersect } from './region'

/** Largest side (px) analysed on an infinite document: bounds the readback (and the encoder's input) of huge layers. */
const INF_CAP = 6144

/** Rect that limits every read / write: the canvas (fixed) or an effectively unbounded rect (infinite). */
export function limitRect(app: App): Rect {
  return app.doc.isInfinite ? { x: -1e7, y: -1e7, w: 2e7, h: 2e7 } : { x: 0, y: 0, w: app.doc.width, h: app.doc.height }
}

/** Cheap signature of an infinite layer's pixels: set of tiles + the revision of every resident tile. */
function tilesSig(l: Layer): string {
  const st = l.tiles
  if (!st) return String(l.pixels.rev)
  let sum = 0
  let n = 0
  for (const k of st.keys()) {
    sum += st.peekKey(k)?.rev ?? 0
    n++
  }
  return `${st.version}.${n}.${sum}`
}

/** `bounds` of an infinite layer limited to INF_CAP around the view centre (null = empty). */
function capped(app: App, b: Rect | null): Rect | null {
  if (!b) return null
  if (b.w <= INF_CAP && b.h <= INF_CAP) return b
  const v = app.view
  return rectIntersect(b, { x: Math.round(v.cx - INF_CAP / 2), y: Math.round(v.cy - INF_CAP / 2), w: INF_CAP, h: INF_CAP }) ?? { x: b.x, y: b.y, w: Math.min(b.w, INF_CAP), h: Math.min(b.h, INF_CAP) }
}

/** which pixels the model looks at */
export type SampleMode = 'layer' | 'all'

export interface SourceInfo {
  /** content bounds in document space (layer: non-transparent pixels; all: the canvas) */
  bounds: Rect
  /** changes whenever the sampled pixels may have changed (encoder cache key) */
  key: string
}
export interface SourceImage {
  rect: Rect
  /** straight RGBA8, rect.w * rect.h */
  data: Uint8ClampedArray
}

let flatCache: { doc: object; key: string; px: Uint8ClampedArray } | null = null
let boundsCache: { key: string; bounds: Rect | null } | null = null

const docRect = (app: App): Rect => limitRect(app)

function sourceKey(app: App, sample: SampleMode): string {
  const doc = app.doc
  if (sample === 'layer') {
    const l = doc.activeLayer
    return l ? `L${l.id}:${doc.isInfinite ? tilesSig(l) : l.pixels.rev}` : 'none'
  }
  const parts: string[] = [`bg${doc.background.visible ? doc.background.color.join(',') : '-'}`, `lang${doc.viewLang}`] // the visible stack = common layers + the view language's cells
  for (const l of doc.layers) parts.push(l.isGroup ? `G${l.id}:${l.visible ? 1 : 0}:${l.opacity}:${l.mask?.rev ?? ''}` : `${l.id}:${doc.isInfinite ? tilesSig(l) : l.pixels.rev}:${l.visible ? 1 : 0}:${l.opacity}:${l.blendMode}:${l.mask?.rev ?? ''}:${l.maskEnabled ? 1 : 0}`)
  return 'A' + parts.join('|')
}

function flattened(app: App, key: string): Uint8ClampedArray {
  if (flatCache && flatCache.doc === app.doc && flatCache.key === key) return flatCache.px
  const px = app.compositor.readFlattened(true)
  flatCache = { doc: app.doc, key, px }
  return px
}

/** Bounds + cache key of the sampled source, or null when there is nothing to sample (empty / group layer). */
export function sourceInfo(app: App, sample: SampleMode): SourceInfo | null {
  const doc = app.doc
  const key = sourceKey(app, sample)
  if (sample === 'all') return { bounds: doc.isInfinite ? workRect(app) : docRect(app), key: doc.isInfinite ? key + '@' + JSON.stringify(workRect(app)) : key }
  const l = doc.activeLayer
  if (!l || l.isGroup) return null
  if (doc.isInfinite) {
    const b = capped(app, l.tiles?.tightBounds() ?? null)
    return b ? { bounds: b, key } : null
  }
  if (boundsCache && boundsCache.key === key) return boundsCache.bounds ? { bounds: boundsCache.bounds, key } : null
  const px = app.gpu.readRGBA8(l.pixels, docRect(app))
  const w = doc.width
  const h = doc.height
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++) {
    const row = y * w * 4 + 3
    for (let x = 0; x < w; x++)
      if (px[row + x * 4] > 8) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        y1 = y
      }
  }
  const bounds = x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
  boundsCache = { key, bounds }
  return bounds ? { bounds, key } : null
}

/** Straight RGBA8 pixels of `rect` of one layer (fixed or infinite). */
export function readLayerPixels(app: App, l: Layer, rect: Rect): Uint8ClampedArray {
  return app.doc.isInfinite ? app.doc.readRegionPixels(l, rect) : app.gpu.readRGBA8(l.pixels, rect)
}

/** Straight RGBA8 pixels of `rect` (document space, clipped to the canvas). `rect` null = the whole content bounds. */
export function getSourceImage(app: App, rect: Rect | null, sample: SampleMode): SourceImage | null {
  const info = sourceInfo(app, sample)
  if (!info) return null
  const want = rectIntersect(rect ? rectInt(rect) : info.bounds, docRect(app))
  if (!want) return null
  if (sample === 'layer') {
    const l = app.doc.activeLayer
    return { rect: want, data: app.doc.isInfinite ? app.doc.readRegionPixels(l, want) : app.gpu.readRGBA8(l.pixels, want) }
  }
  if (app.doc.isInfinite) {
    const f = app.compositor.readFlattened(want, 1, true)
    return { rect: want, data: f.px }
  }
  const full = flattened(app, info.key)
  const W = app.doc.width
  const out = new Uint8ClampedArray(want.w * want.h * 4)
  for (let y = 0; y < want.h; y++) out.set(full.subarray(((want.y + y) * W + want.x) * 4, ((want.y + y) * W + want.x + want.w) * 4), y * want.w * 4)
  return { rect: want, data: out }
}

/** The part of the document currently visible on screen (document space). */
export function visibleDocRect(app: App): Rect {
  const { w, h } = app.cssSize()
  const pts = [screenToDoc(app.view, 0, 0, w, h), screenToDoc(app.view, w, 0, w, h), screenToDoc(app.view, 0, h, w, h), screenToDoc(app.view, w, h, w, h)]
  const x0 = Math.min(...pts.map((p) => p.x))
  const x1 = Math.max(...pts.map((p) => p.x))
  const y0 = Math.min(...pts.map((p) => p.y))
  const y1 = Math.max(...pts.map((p) => p.y))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

export function dropSourceCaches(): void {
  flatCache = null
  boundsCache = null
}
