import { t } from '../../i18n'
import type { Document } from '../../doc/document'
import type { Layer } from '../../doc/layer'
import { cloneInfMask } from '../../doc/maskStore'
import { tileMemory } from '../../doc/tileMemory'
import { cleanName } from './model'

/** Document-level language-layer operations (no UI). */

/** A new, empty language layer (group) above the active row; the cells appear when something is first written. */
export function createLanguageLayer(doc: Document, name: string): Layer {
  const g = doc.createLayer({ name: cleanName(name) || t('langs.layer.defaultName'), isGroup: true, langSet: true, passThrough: true, collapsed: true })
  // above the active row; inside a language layer, above that language layer (a language layer never nests in another)
  const act = doc.getLayer(doc.activeId)
  const near = doc.langSetOf(act) ?? act
  try {
    return doc.insertLayer(g, near ? { id: near.id, where: 'above' } : null, 'Add language layer')
  } catch (e) {
    g.dispose()
    throw e
  }
}

function cloneInto(doc: Document, src: Layer, dst: Layer): void {
  if (src.tiles) {
    dst.tiles?.dispose()
    dst.tiles = src.tiles.clone()
    tileMemory.register(dst.tiles, doc.scratchId)
    if (src.mask?.inf) dst.mask = cloneInfMask(doc.gpu, src.mask)
  } else {
    const full = { x: 0, y: 0, w: doc.width, h: doc.height }
    doc.gpu.blit(src.pixels, full, dst.pixels, 0, 0)
    if (src.mask) {
      dst.mask = doc.gpu.surface(doc.width, doc.height, doc.format)
      doc.gpu.blit(src.mask, full, dst.mask, 0, 0)
    }
    doc.painted.add(dst.id)
  }
}

/** Copy the writing of one language into another language of the same language layer (replaces the target cell; one undo step). */
export function copyCell(doc: Document, groupId: string, from: string, to: string): string | null {
  const g = doc.getLayer(groupId)
  const src = doc.cellOf(groupId, from)
  if (!g?.langSet || !src) return t('langs.toast.cellEmpty')
  if (from === to) return null
  const old = doc.cellOf(groupId, to)
  if (old?.locked || g.locked) return t('layers.toast.layerLocked')
  const nl = doc.createLayer({ ...src.props, lang: to, parentId: g.id, name: `${g.name} [${to.toUpperCase()}]`, reference: false })
  try {
    cloneInto(doc, src, nl)
  } catch (e) {
    nl.dispose()
    throw e
  }
  const keep = doc.activeId
  doc.replaceLayers(old ? [old] : [], nl, old ? old.id : src.id, keep, 'Copy language cell', 'layer-paste')
  doc.activeId = keep
  return null
}

/** Empty the cell of one language (undoable; the other languages stay). */
export function clearCell(doc: Document, groupId: string, lang: string): void {
  const c = doc.cellOf(groupId, lang)
  if (c) doc.clearLayer(c.id)
}

/** Languages whose cell of this language layer has pixels (fixed canvases: ever painted). */
export function filledLangs(doc: Document, groupId: string): Set<string> {
  const out = new Set<string>()
  for (const c of doc.cellsOf(groupId)) if (doc.cellHasContent(c)) out.add(c.lang)
  return out
}
