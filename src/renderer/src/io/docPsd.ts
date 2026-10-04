import { t } from '../i18n'
import { Document } from '../doc/document'
import type { Layer } from '../doc/layer'
import { normalizeOrder } from '../doc/layerTree'
import type { GPU } from '../gl/gpu'
import type { Compositor } from '../gl/compositor'
import { flattenedBitmap, layerBitmap } from './frameRender'
import { DecodedPsd, ExLayer, decodePsd, encodePsd, flattenGroups } from './psd'
import { Bitmap } from './imageFormats'
import type { ImportedText, MappedAdjustment } from './psdMap'

/** Document layer tree -> PSD layer tree (bottom -> top; groups nested). Masks are baked into layer alpha. */
export function docToExLayers(gpu: GPU, doc: Document, parentId: string | null = null): ExLayer[] {
  const out: ExLayer[] = []
  for (const l of doc.childrenOf(parentId)) {
    const base = { name: l.name, visible: l.visible, opacity: l.opacity, blendMode: l.blendMode, clipping: l.clipping, alphaLock: l.alphaLock }
    if (l.isGroup) out.push({ ...base, children: docToExLayers(gpu, doc, l.id), open: !l.collapsed, passThrough: l.passThrough })
    else {
      const b = layerBitmap(gpu, doc, l)
      out.push({ ...base, pixels: { x: 0, y: 0, width: b.width, height: b.height, data: b.data } })
    }
  }
  return out
}

export function exportPsdBytes(gpu: GPU, doc: Document, comp: Compositor): Uint8Array {
  const composite = flattenedBitmap(comp, doc, true)
  return encodePsd(doc.width, doc.height, docToExLayers(gpu, doc), { background: doc.background.visible ? doc.background.color : null, composite: composite.data })
}

/** Copy a bitmap (positioned at x,y in canvas space) into a layer surface, cropping what falls outside. */
export function uploadBitmap(gpu: GPU, doc: Document, layer: Layer, b: { x: number; y: number; width: number; height: number; data: Uint8ClampedArray | Uint8Array }): void {
  const x0 = Math.max(0, b.x)
  const y0 = Math.max(0, b.y)
  const x1 = Math.min(doc.width, b.x + b.width)
  const y1 = Math.min(doc.height, b.y + b.height)
  if (x1 <= x0 || y1 <= y0) return
  if (x0 === b.x && y0 === b.y && x1 === b.x + b.width && y1 === b.y + b.height) {
    gpu.uploadRGBA8(layer.pixels, x0, y0, b.width, b.height, b.data)
    return
  }
  const w = x1 - x0
  const h = y1 - y0
  const crop = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const s = ((y0 - b.y + y) * b.width + (x0 - b.x)) * 4
    crop.set(b.data.subarray(s, s + w * 4), y * w * 4)
  }
  gpu.uploadRGBA8(layer.pixels, x0, y0, w, h, crop)
}

/**
 * PSD features that need the running app (text manager, adjustment engine) and are applied when the imported document
 * becomes current: see features/psdimport.
 */
export interface PsdPost {
  text: Map<string, ImportedText>
  /** adjustment layers with the ids of the paint layers underneath them (same group scope) */
  adjustments: { name: string; adj: MappedAdjustment; targets: string[] }[]
  /** adjustment layers that have no Brushwork equivalent */
  skipped: string[]
}
export const psdPost = new WeakMap<Document, PsdPost>()

/** Build a Document from a decoded PSD, preserving groups, blend modes, opacity, visibility, clipping. */
export function psdToDocument(gpu: GPU, psd: DecodedPsd, name: string): Document {
  const doc = new Document(gpu, psd.width, psd.height, { background: { color: [1, 1, 1], visible: false } })
  doc.name = name
  const post: PsdPost = { text: new Map(), adjustments: [], skipped: [] }
  /** returns the paint layer ids created in this scope (bottom -> top); adjustment layers affect what is below them */
  const add = (list: ExLayer[], parentId: string | null): string[] => {
    const below: string[] = []
    for (const e of list) {
      if (e.adjustment) {
        if (!e.visible) continue
        if (e.adjustment.ok) post.adjustments.push({ name: e.name, adj: e.adjustment.adj, targets: [...below] })
        else post.skipped.push(`${e.name} (${e.adjustment.reason})`)
        continue
      }
      const props = { name: e.name, visible: e.visible, opacity: e.opacity, blendMode: e.blendMode, clipping: e.clipping, alphaLock: !!e.alphaLock, parentId }
      if (e.children) {
        const g = doc.createLayer({ ...props, isGroup: true, passThrough: e.passThrough !== false, collapsed: e.open === false })
        doc.layers.push(g)
        below.push(...add(e.children, g.id))
      } else {
        const l = doc.createLayer(props)
        if (e.pixels) uploadBitmap(gpu, doc, l, e.pixels)
        doc.layers.push(l)
        below.push(l.id)
        if (e.text) post.text.set(l.id, e.text)
      }
    }
    return below
  }
  add(psd.layers, null)
  if (post.text.size || post.adjustments.length || post.skipped.length) psdPost.set(doc, post)
  if (!doc.layers.some((l) => !l.isGroup)) doc.layers.push(doc.createLayer({ name: t('core.doc.layerN', { n: 1 }) }))
  doc.layers.splice(0, doc.layers.length, ...normalizeOrder(doc.layers))
  const top = [...doc.layers].reverse().find((l) => !l.isGroup)!
  doc.activeId = top.id
  doc.emitCommit('load', null, null, 'Import PSD')
  return doc
}

export function importPsdBytes(gpu: GPU, bytes: Uint8Array, name: string): Document {
  return psdToDocument(gpu, decodePsd(bytes), name)
}

/** PSD with flat structure (no groups), for consumers that cannot use groups. */
export const flatPsdLayers = (psd: DecodedPsd): ExLayer[] => flattenGroups(psd.layers)

/** A bitmap as a brand-new single-layer document. */
export function bitmapToDocument(gpu: GPU, b: Bitmap, name: string): Document {
  const doc = new Document(gpu, b.width, b.height, { background: { color: [1, 1, 1], visible: false } })
  doc.name = name
  const l = doc.createLayer({ name: t('core.doc.image') })
  gpu.uploadRGBA8(l.pixels, 0, 0, b.width, b.height, b.data)
  doc.layers.push(l)
  doc.activeId = l.id
  doc.emitCommit('load', null, null, 'Import image')
  return doc
}
