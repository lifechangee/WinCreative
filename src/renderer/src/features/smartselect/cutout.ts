/** Cut-out actions on the current selection: cut / copy to a new layer, remove background (layer mask), copy object to the clipboard. */
import type { App } from '../../app/app'
import type { Layer } from '../../doc/layer'
import { encodePng } from '../../io/bwk'
import { t } from '../../i18n'
import { addMask, applyMask, eraseSelected, layerFromImage } from '../layers/ops'
import type { SmartEngine } from './engine'
import { ss } from './settings'
import { frameEnabled, frameRect } from '../frame/workRect'
import { getSourceImage, readLayerPixels } from './source'

export type CutAction = 'cut' | 'copy' | 'removeBg' | 'copyObject'

/** Topmost visible paint layer that really holds the selected object (falls back to the active layer). */
export function pickSourceLayer(app: App): Layer | null {
  const doc = app.doc
  const act = doc.activeLayer
  if (ss.sample === 'layer' || !app.selection.data) return act && !act.isGroup ? act : null
  const sel = app.selection.data
  const b = app.selection.bounds()
  if (!b) return act
  const cand = [...doc.layers].reverse().filter((l) => !l.isGroup && doc.isEffectivelyVisible(l))
  const N = 1500
  const win = app.selection.window!
  for (const l of cand) {
    let hit = 0
    let tot = 0
    const px = readLayerPixels(app, l, b)
    for (let k = 0; k < N; k++) {
      const x = ((k * 7919) % b.w) | 0
      const y = ((k * 104729) % b.h) | 0
      const w = sel[(b.y + y - win.y) * win.w + (b.x + x - win.x)]
      if (w < 128) continue
      tot++
      if (px[(y * b.w + x) * 4 + 3] > 128) hit++
    }
    if (tot && hit / tot > 0.5) return l
  }
  return act && !act.isGroup ? act : null
}

/** Straight RGBA of the selected object (alpha = selection coverage x source alpha, colours decontaminated when enabled). */
async function objectPixels(app: App, engine: SmartEngine, src: Layer | null, composite: boolean): Promise<{ x: number; y: number; w: number; h: number; data: Uint8ClampedArray } | null> {
  const svc = app.selection
  const b = svc.bounds()
  if (!b || !svc.data) return null
  const alpha = svc.readRect(b)!
  // an enabled frame limits what leaves the canvas: the object is clipped to it like every other edit
  const fr = app.doc.isInfinite && frameEnabled(app.doc) ? frameRect(app.doc) : null
  if (fr)
    for (let y = 0; y < b.h; y++)
      for (let x = 0; x < b.w; x++) {
        const dx = b.x + x
        const dy = b.y + y
        if (dx < fr.x || dy < fr.y || dx >= fr.x + fr.w || dy >= fr.y + fr.h) alpha[y * b.w + x] = 0
      }
  const rgba = composite || !src ? (getSourceImage(app, b, 'all')?.data ?? null) : readLayerPixels(app, src, b)
  if (!rgba) return null
  const radius = Math.max(2, Math.min(8, Math.round(Math.min(b.w, b.h) * 0.012)))
  const r = await engine.decon(new Uint8ClampedArray(rgba), alpha, b.w, b.h, radius, ss.decontaminate)
  return { x: b.x, y: b.y, w: b.w, h: b.h, data: r.rgba }
}

import { writeClipboardPng } from '../layers/clipboard'
export { writeClipboardPng }

const COMMIT_LABEL: Record<CutAction, string> = { cut: 'Cut object to new layer', copy: 'Copy object to new layer', removeBg: 'Remove background', copyObject: 'Copy object' }

export async function runCutAction(app: App, engine: SmartEngine, action: CutAction): Promise<boolean> {
  const svc = app.selection
  if (!svc.hasSelection()) {
    app.notify(t('smartselect.toast.noSelection'))
    return false
  }
  const doc = app.doc
  const src = pickSourceLayer(app)
  if (action !== 'copyObject' && (!src || src.isGroup)) {
    app.notify(t('smartselect.toast.pickLayer'))
    return false
  }
  if ((action === 'cut' || action === 'removeBg') && src!.locked) {
    app.notify(t('smartselect.toast.locked'))
    return false
  }
  try {
    if (action === 'removeBg') {
      const layer = src!
      doc.transaction(COMMIT_LABEL.removeBg, 'layer-mask', layer.id, () => {
        if (layer.mask) applyMask(doc, layer)
        addMask(doc, layer, 'selection')
      })
      app.notify(t('smartselect.toast.bgRemoved'))
      return true
    }
    const obj = await objectPixels(app, engine, src, action === 'copyObject' || (action === 'copy' && ss.sample === 'all'))
    if (!obj) {
      app.notify(t('smartselect.toast.noSelection'))
      return false
    }
    if (action === 'copyObject') {
      const png = await encodePng(obj.data, obj.w, obj.h)
      await writeClipboardPng(png)
      app.notify(t('smartselect.toast.objectCopied'))
      return true
    }
    const layer = src!
    const name = (layer.name || t('core.doc.layer')) + t('smartselect.layerSuffix')
    const nl = layerFromImage(doc, obj, name)
    try {
      doc.transaction(COMMIT_LABEL[action], 'layer-paste', nl.id, () => {
        doc.insertLayer(nl, { id: layer.id, where: 'above' }, COMMIT_LABEL[action], 'layer-paste')
        if (action === 'cut') eraseSelected(doc, layer, 'Cut')
      })
    } catch (e) {
      nl.dispose()
      throw e
    }
    app.notify(action === 'cut' ? t('smartselect.toast.cutDone') : t('smartselect.toast.copyDone'))
    return true
  } catch (e) {
    app.notify(t('smartselect.toast.failed', { error: (e as Error).message }))
    return false
  }
}
