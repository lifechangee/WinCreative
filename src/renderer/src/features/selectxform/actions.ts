import type { App } from '../../app/app'
import { clampToCanvas } from '../../core/geometry'
import type { Rect } from '../../core/types'
import { t } from '../../i18n'
import { extractFloat, maskedOp } from './gpuOps'
import { groupHistory } from './history'

/** Pixel-level selection operations (clear / fill / copy / cut). All undoable, emit commit events. */

function target(app: App): ReturnType<App['doc']['getLayer']> | null {
  const l = app.doc.activeLayer
  if (!l || l.isGroup) {
    app.notify(t('selectxform.action.selectPaintLayer'))
    return null
  }
  if (l.locked) {
    app.notify(t('selectxform.action.layerLocked'))
    return null
  }
  return l
}

function region(app: App): Rect {
  return app.selection.bounds() ?? { x: 0, y: 0, w: app.doc.width, h: app.doc.height }
}

export function clearSelection(app: App): boolean {
  if (!app.selection.hasSelection()) {
    app.notify(t('selectxform.action.makeSelection'))
    return false
  }
  return applyMasked(app, 'clear', 'Clear selection', 'clear')
}

export function colorFillSelection(app: App): boolean {
  if (!app.selection.hasSelection()) {
    app.notify(t('selectxform.action.makeSelection'))
    return false
  }
  return applyMasked(app, 'fill', 'Color fill', 'fill')
}

function applyMasked(app: App, mode: 'clear' | 'fill', label: string, type: 'clear' | 'fill'): boolean {
  const layer = target(app)
  if (!layer) return false
  const { doc, gpu } = app
  const r = clampToCanvas(region(app), doc.width, doc.height)
  if (!r) return false
  const edit = doc.beginPixelEdit(layer, label)
  edit.save(r)
  maskedOp(gpu, layer.surface, doc.scratch, r, { mode, color: app.state.rgb, alphaLock: layer.alphaLock })
  const dirty = edit.finish()
  doc.emitCommit(type, layer.id, dirty, label)
  return true
}

/** Copy (or cut) the selected pixels of the active layer into a NEW layer above it. One undo step. */
export function copyPaste(app: App, cut: boolean): boolean {
  const src = target(app)
  if (!src) return false
  const { doc, gpu } = app
  const r = clampToCanvas(region(app), doc.width, doc.height)
  if (!r) return false
  const hasSel = app.selection.hasSelection()
  let newId = ''
  groupHistory(doc, cut ? 'Cut & Paste' : 'Copy & Paste', () => {
    const layer = doc.addLayer({ name: (src.name || t('core.doc.layer')) + (cut ? t('core.doc.cutSuffix') : t('core.doc.copySuffix')) })
    newId = layer.id
    const tmp = extractFloat(gpu, src.surface, { x: 0, y: 0, w: doc.width, h: doc.height }, 0, false, hasSel)
    gpu.blit(tmp, r, layer.surface, r.x, r.y)
    tmp.dispose()
    if (cut) {
      const edit = doc.beginPixelEdit(src, 'Cut')
      edit.save(r)
      maskedOp(gpu, src.surface, doc.scratch, r, { mode: 'clear' })
      edit.finish()
    }
  })
  doc.emitCommit('fill', newId, r, cut ? 'Cut & paste' : 'Copy & paste')
  return true
}

/** Select the non-transparent pixels of the active layer. */
export function selectLayerContents(app: App): boolean {
  const { doc, gpu } = app
  const l = doc.activeLayer
  if (!l || l.isGroup) return false
  const px = gpu.readRGBA8(l.surface, { x: 0, y: 0, w: doc.width, h: doc.height })
  const full = new Uint8Array(doc.width * doc.height)
  let any = false
  for (let i = 0; i < full.length; i++) {
    const a = px[i * 4 + 3]
    full[i] = a
    if (a) any = true
  }
  if (!any) {
    app.notify(t('selectxform.action.layerEmpty'))
    return false
  }
  app.selection.setFromFull(full, 'Select layer contents')
  return true
}
