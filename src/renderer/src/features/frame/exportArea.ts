import { t } from '../../i18n'
import type { Rect } from '../../core/types'
import type { Compositor } from '../../gl/compositor'
import type { Document } from '../../doc/document'
import { guardHooks } from '../../doc/infiniteGuard'
import { frameRect } from './workRect'

/** What an image export covers: the frame, all drawn content (infinite) or the whole canvas (fixed). */
export type ExportArea = 'frame' | 'content' | 'canvas'

const chosen = new WeakMap<Document, ExportArea>()

/** Areas offered for this document, the default (Frame when one exists) first. */
export function exportAreas(doc: Document): ExportArea[] {
  const base: ExportArea = doc.isInfinite ? 'content' : 'canvas'
  return frameRect(doc) ? ['frame', base] : [base]
}
export function getExportArea(doc: Document): ExportArea {
  const list = exportAreas(doc)
  const c = chosen.get(doc)
  return c && list.includes(c) ? c : list[0]
}
export function setExportArea(doc: Document, a: ExportArea): void {
  chosen.set(doc, a)
}

/** Flattened pixels of the chosen export area (straight RGBA8). Large areas are scaled down to the GPU limit / 100 Mpx. */
export function readExportArea(doc: Document, comp: Compositor, withBackground: boolean, area: ExportArea = getExportArea(doc), lang?: string): { px: Uint8ClampedArray; w: number; h: number } {
  let rect: Rect | null = null
  if (area === 'frame') rect = frameRect(doc)
  if (!rect && doc.isInfinite) {
    rect = lang ? doc.withLang(lang, () => doc.contentBounds({ tight: true, visibleOnly: true })) : doc.contentBounds({ tight: true, visibleOnly: true })
    if (!rect) {
      guardHooks.notify(t('ui.inf.exportEmpty'))
      throw new Error(t('ui.inf.exportEmpty'))
    }
  }
  if (!rect) return { px: lang ? comp.readFlattened({ x: 0, y: 0, w: doc.width, h: doc.height }, 1, withBackground, lang).px : comp.readFlattened(withBackground), w: doc.width, h: doc.height }
  const k = Math.min(1, comp.gpuMaxTexture / Math.max(rect.w, rect.h), Math.sqrt(1e8 / (rect.w * rect.h)))
  if (k < 1) guardHooks.notify(t('ui.inf.exportScaled', { pct: Math.floor(k * 100) }))
  const img = comp.readFlattened(rect, k, withBackground, lang)
  return { px: img.px, w: img.w, h: img.h }
}
