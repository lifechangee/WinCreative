import type { App } from '../../app/app'
import type { Rect } from '../../core/types'
import type { Document } from '../../doc/document'
import type { Surface } from '../../gl/gpu'
import { resample } from '../../io/gpuUtil'
import { letterbox } from './model'
import { frameRect, viewportRect } from './workRect'

/**
 * Time-lapse capture areas (features/animio/timelapse.ts):
 *  - 'frame'  : the document frame (also when clipping is switched off)
 *  - 'view'   : infinite canvas WITHOUT a frame: what the screen shows (pan / zoom / rotation), canvas only
 *  - 'canvas' : fixed canvas without a frame (the classic path)
 * Frames of a recording have one stable size (`out`); a source of another aspect is letterboxed into it.
 */
export type TlArea = 'canvas' | 'frame' | 'view'

export function tlAreaOf(doc: Document): TlArea {
  if (frameRect(doc)) return 'frame'
  return doc.isInfinite ? 'view' : 'canvas'
}

/** Pixel size of the source area (used to choose the stable output size of a new recording). */
export function areaSize(app: App, area: TlArea): { w: number; h: number } {
  if (area === 'frame') {
    const r = frameRect(app.doc)!
    return { w: r.w, h: r.h }
  }
  if (area === 'view') return { w: app.canvas.width, h: app.canvas.height }
  return { w: app.doc.width, h: app.doc.height }
}

/** Render `area` letterboxed into an `out.w x out.h` RGBA8 image (opaque; top row first). */
export async function captureArea(app: App, area: TlArea, out: { w: number; h: number }, lang?: string): Promise<Uint8Array<ArrayBuffer>> {
  const c = new OffscreenCanvas(out.w, out.h)
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, out.w, out.h)
  ctx.imageSmoothingQuality = 'high'
  if (area === 'view') {
    // present + copy in the same task: the drawing buffer is only valid until the browser composites it
    const s = app.cssSize()
    // language variant: the screen is drawn AS that language for this copy only, then restored in the same task (nothing flickers)
    if (lang) app.compositor.presentLang(lang, app.view, s.w, s.h)
    else app.compositor.present(app.view, s.w, s.h, window.devicePixelRatio || 1)
    const cv = app.canvas
    const d = letterbox(cv.width, cv.height, out.w, out.h)
    ctx.drawImage(cv, 0, 0, cv.width, cv.height, d.x, d.y, d.w, d.h)
    if (lang) app.compositor.present(app.view, s.w, s.h, window.devicePixelRatio || 1)
  } else {
    const rect: Rect = area === 'frame' ? frameRect(app.doc)! : { x: 0, y: 0, w: app.doc.width, h: app.doc.height }
    const d = letterbox(rect.w, rect.h, out.w, out.h)
    const k = Math.min(1, d.w / rect.w)
    const img = app.compositor.readFlattened(rect, k, true, lang)
    ctx.fillStyle = '#fff'
    ctx.fillRect(d.x, d.y, d.w, d.h)
    const bmp = await createImageBitmap(new ImageData(img.px as unknown as Uint8ClampedArray<ArrayBuffer>, img.w, img.h))
    ctx.drawImage(bmp, 0, 0, img.w, img.h, d.x, d.y, d.w, d.h)
    bmp.close()
  }
  return new Uint8Array(ctx.getImageData(0, 0, out.w, out.h).data.buffer)
}

/**
 * GPU capture (frame area, or the view of a frameless infinite canvas): the area is box-downscaled on the GPU into `small` (out-sized, opaque
 * over the paper colour) and the caller reads it back through the fenced pixel-pack-buffer path - no pipeline stall, no 2D canvas, no
 * multi-megabyte main-thread copy. `lang` renders the document AS that language (language variants).
 * Returns false when the plain path must be used (fixed canvas without frame, the source's aspect differs from the stored size so letterbox
 * bars are needed, or the source is smaller than the output).
 */
let viewTmp: Surface | null = null
let viewTmpGpu: unknown = null
export function captureAreaGpu(app: App, area: TlArea, out: { w: number; h: number }, small: Surface, lang?: string): boolean {
  if (small.w !== out.w || small.h !== out.h) return false
  if (area === 'view') {
    const cv = app.canvas
    const d = letterbox(cv.width, cv.height, out.w, out.h)
    if (Math.abs(d.w - out.w) > 1 || Math.abs(d.h - out.h) > 1 || out.w > cv.width) return false
    const s = app.cssSize()
    // the view is drawn the way the screen shows it (its first memory row is the BOTTOM of the picture) into a scratch surface; a flipping
    // resample() turns it into the layout every other capture path stores (first row = top)
    if (!viewTmp || viewTmp.w !== out.w || viewTmp.h !== out.h || viewTmpGpu !== app.gpu) {
      viewTmpGpu = app.gpu
      viewTmp?.dispose()
      viewTmp = app.gpu.surface(out.w, out.h, 'rgba8')
    }
    app.syncComposite() // a commit made after the last frame is part of the state this capture is tagged with
    if (lang) app.compositor.presentLang(lang, app.view, s.w, s.h, viewTmp)
    else app.compositor.inf.present(app.view, s.w, s.h, viewTmp)
    resample(app.gpu, viewTmp, small, { origin: [0, out.h], step: [1, -1] })
    return true
  }
  if (area !== 'frame') return false
  const doc = app.doc
  const rect = frameRect(doc)
  if (!rect) return false
  const d = letterbox(rect.w, rect.h, out.w, out.h)
  if (Math.abs(d.w - out.w) > 1 || Math.abs(d.h - out.h) > 1 || out.w > rect.w) return false
  const paper: [number, number, number] = doc.background.visible ? (doc.background.color as [number, number, number]) : [1, 1, 1]
  const gpu = app.gpu
  app.syncComposite() // (see above)
  if (!doc.isInfinite) {
    const src = lang ? app.compositor.renderLang(lang, app.engine.live) : app.compositor.composite
    resample(gpu, src, small, { origin: [rect.x, rect.y], step: [rect.w / out.w, rect.h / out.h], paper })
    return true
  }
  const inf = lang ? app.compositor.langInf(lang) : app.compositor.inf
  const a = inf.assembleRect(rect, Math.min(1, out.w / rect.w))
  try {
    const grid = a.rect.w / a.asm.w
    resample(gpu, a.asm, small, { origin: [(rect.x - a.rect.x) / grid, (rect.y - a.rect.y) / grid], step: [rect.w / out.w / grid, rect.h / out.h / grid], paper })
  } finally {
    a.asm.dispose()
  }
  return true
}

/** Source rectangle (document space) of `area` right now, as [x, y, w, h]; stored with every recorded frame (the frame may move / resize mid-recording). */
export function sourceRect(app: App, area: TlArea): [number, number, number, number] {
  const r: Rect = area === 'frame' ? frameRect(app.doc)! : area === 'view' ? viewportRect(app) : { x: 0, y: 0, w: app.doc.width, h: app.doc.height }
  return [r.x, r.y, r.w, r.h]
}
