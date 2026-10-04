import { t } from '../../i18n'
import type { Rect } from '../../core/types'
import type { Document } from '../../doc/document'
import type { Layer } from '../../doc/layer'
import { StackRenderer } from '../../gl/compositor'
import { clipMask } from '../../gl/clipMask'
import type { Surface } from '../../gl/gpu'
import { FS_VERT } from '../../gl/shaders'
import { LAYER_OP_FS } from '../../gl/layerShaders'

/**
 * Optional integration points other features may set.
 *  - beginTransform(layer): called after a layer was pasted / inserted so the transform tool can pick it up
 *  - addText(): create a text layer (Text feature)
 * A DOM CustomEvent 'bw:layer-inserted' ({detail:{layerId}}) is dispatched as well.
 */
export const layerHooks: { beginTransform: ((layer: Layer) => void) | null; addText: (() => void) | null } = { beginTransform: null, addText: null }

export enum Op {
  Fill = 0,
  InvertColors = 1,
  ApplyMask = 2,
  InvertMask = 3,
  KeepSelection = 4,
  EraseSelection = 5,
  SelectionToMask = 6
}

interface OpOpts {
  op: Op
  color?: [number, number, number]
  alphaLock?: boolean
  mask?: Surface | null
  /** honour the current selection (clipMask) */
  useSelection?: boolean
}

const fullRect = (doc: Document): Rect => ({ x: 0, y: 0, w: doc.width, h: doc.height })

/** Run a layer op reading `src` and writing `dst` (different surfaces). */
export function opToSurface(doc: Document, src: Surface, dst: Surface, o: OpOpts): void {
  const gpu = doc.gpu
  const gl = gpu.gl
  const p = gpu.program('layer-op', FS_VERT, LAYER_OP_FS).use()
  const sel = o.useSelection === false ? null : clipMask.tex
  gpu.bindTex(0, src.tex)
  gpu.bindTex(1, o.mask ? o.mask.tex : gpu.blank)
  gpu.bindTex(2, sel ?? gpu.blank)
  const c = o.color ?? [0, 0, 0]
  p.i('uSrc', 0).i('uMask', 1).i('uSel', 2).f('uSelOn', sel ? 1 : 0).i('uOp', o.op).v3('uColor', c[0], c[1], c[2]).f('uAlphaLock', o.alphaLock ? 1 : 0)
  gl.disable(gl.BLEND)
  gpu.bindTarget(dst, null)
  gpu.fullscreen()
}

/** Undoable in-place op on a layer's pixels (or its mask when `onMask`). */
function runOp(doc: Document, layer: Layer, label: string, type: 'layer-fill' | 'layer-invert' | 'layer-mask' | 'clear', o: OpOpts, onMask = false): boolean {
  if (layer.isGroup || layer.locked) return false
  if (onMask && !layer.mask) return false
  const prev = layer.editingMask
  layer.editingMask = onMask
  try {
    const target = onMask ? layer.mask! : layer.pixels
    const edit = doc.beginPixelEdit(layer, label)
    const full = fullRect(doc)
    edit.save(full)
    doc.gpu.blit(target, full, doc.scratch, 0, 0)
    opToSurface(doc, doc.scratch, target, o)
    const dirty = edit.finish()
    doc.emitCommit(type, layer.id, dirty, label)
    return true
  } finally {
    layer.editingMask = prev
  }
}

export function fillLayer(doc: Document, layer: Layer, color: [number, number, number]): boolean {
  if (layer.editingMask && layer.mask) return runOp(doc, layer, 'Fill mask', 'layer-fill', { op: Op.Fill, color }, true)
  return runOp(doc, layer, 'Fill layer', 'layer-fill', { op: Op.Fill, color, alphaLock: layer.alphaLock })
}

export function invertLayer(doc: Document, layer: Layer): boolean {
  if (layer.editingMask && layer.mask) return runOp(doc, layer, 'Invert mask', 'layer-invert', { op: Op.InvertMask, useSelection: false }, true)
  return runOp(doc, layer, 'Invert colors', 'layer-invert', { op: Op.InvertColors })
}

export function invertMask(doc: Document, layer: Layer): boolean {
  return runOp(doc, layer, 'Invert mask', 'layer-mask', { op: Op.InvertMask, useSelection: false }, true)
}

/** Clear mask = everything hidden (black). */
export function clearMask(doc: Document, layer: Layer): boolean {
  if (!layer.mask) return false
  const prev = layer.editingMask
  layer.editingMask = true
  const edit = doc.beginPixelEdit(layer, 'Clear mask')
  layer.editingMask = prev
  const full = fullRect(doc)
  edit.save(full)
  const gl = doc.gpu.gl
  doc.gpu.bindTarget(layer.mask, null)
  gl.clearColor(0, 0, 0, 1)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.clearColor(0, 0, 0, 0)
  const dirty = edit.finish()
  doc.emitCommit('layer-mask', layer.id, dirty, 'Clear mask')
  return true
}

/** Fill the mask with white (show everything). */
export function fillMaskWhite(doc: Document, layer: Layer): boolean {
  if (!layer.mask) return false
  const prev = layer.editingMask
  layer.editingMask = true
  const edit = doc.beginPixelEdit(layer, 'Reveal all')
  layer.editingMask = prev
  edit.save(fullRect(doc))
  const gl = doc.gpu.gl
  doc.gpu.bindTarget(layer.mask, null)
  gl.clearColor(1, 1, 1, 1)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.clearColor(0, 0, 0, 0)
  const dirty = edit.finish()
  doc.emitCommit('layer-mask', layer.id, dirty, 'Reveal all')
  return true
}

/** Bake the mask into the pixels and remove it (one undo step). */
export function applyMask(doc: Document, layer: Layer): boolean {
  if (!layer.mask || layer.isGroup || layer.locked) return false
  const mask = layer.mask
  doc.transaction('Apply mask', 'layer-mask', layer.id, () => {
    runOp(doc, layer, 'Apply mask', 'layer-mask', { op: Op.ApplyMask, mask, useSelection: false })
    doc.setMask(layer.id, null, 'Apply mask')
  })
  return true
}

/** New mask from the current selection (white = selected) or plain white/black when there is none. */
export function addMask(doc: Document, layer: Layer, fill: 'white' | 'black' | 'selection' = 'white'): boolean {
  if (layer.mask) return false
  let surf: Surface
  if (fill === 'selection' && clipMask.tex) {
    surf = doc.createMaskSurface(false)
    opToSurface(doc, doc.scratch, surf, { op: Op.SelectionToMask })
  } else surf = doc.createMaskSurface(fill !== 'black')
  doc.setMask(layer.id, surf)
  return true
}

// ---------------------------------------------------------------- merge / flatten
type Proxy = Layer

const proxy = (l: Layer, over: Partial<Layer>): Proxy => Object.assign(Object.create(l), over) as Proxy

function renderTo(doc: Document, items: Layer[]): Surface {
  const dest = doc.gpu.surface(doc.width, doc.height, doc.format)
  const r = new StackRenderer(doc.gpu, () => doc)
  try {
    r.render(items, dest, null, null)
  } finally {
    r.dispose()
  }
  return dest
}

/** Layer directly below `id` among its siblings, if it is a plain layer. */
export function layerBelow(doc: Document, id: string): Layer | null {
  const l = doc.getLayer(id)
  if (!l) return null
  const sibs = doc.childrenOf(l.parentId)
  const i = sibs.indexOf(l)
  return i > 0 ? sibs[i - 1] : null
}

function copyInto(doc: Document, layer: Layer, src: Surface, label: string): void {
  const prev = layer.editingMask
  layer.editingMask = false
  const edit = doc.beginPixelEdit(layer, label)
  const full = fullRect(doc)
  edit.save(full)
  doc.gpu.blit(src, full, layer.pixels, 0, 0)
  edit.finish()
  layer.editingMask = prev
}

/**
 * Merge Down: the layer is composited onto the layer below with ITS blend mode/opacity; the result keeps the
 * lower layer's name/blend/opacity. Combine Down: both are combined as a unit that keeps the UPPER layer's
 * blend mode and opacity (the lower layer's opacity is baked in), so the pair still blends with what is below.
 */
export function mergeDown(doc: Document, id: string, combine = false): string | null {
  const up = doc.getLayer(id)
  if (!up) return t('layers.toast.noLayer')
  if (up.isGroup) return t('layers.toast.useMergeGroup')
  const low = layerBelow(doc, id)
  if (!low) return t('layers.toast.noLayerBelow')
  if (low.isGroup) return t('layers.toast.belowIsGroup')
  if (low.locked || up.locked) return t('layers.toast.layerLocked')
  const lowP = proxy(low, combine ? { blendMode: 'normal', clipping: false, visible: true, maskView: false } : { opacity: 1, blendMode: 'normal', clipping: false, visible: true, maskView: false })
  const upP = proxy(up, combine ? { opacity: 1, blendMode: 'normal', visible: true, maskView: false } : { visible: true, maskView: false })
  const tmp = renderTo(doc, [lowP, upP])
  try {
    doc.transaction(combine ? 'Combine down' : 'Merge down', 'layer-merge', low.id, () => {
      copyInto(doc, low, tmp, combine ? 'Combine down' : 'Merge down')
      doc.structural(combine ? 'Combine down' : 'Merge down', 'layer-merge', low.id, () => {
        if (combine) {
          low.blendMode = up.blendMode
          low.opacity = up.opacity
        }
        low.mask = null
        low.editingMask = false
        low.maskView = false
        const i = doc.layers.indexOf(up)
        doc.layers.splice(i, 1)
        doc.activeId = low.id
        doc.layerSel.clear()
      })
    })
  } finally {
    tmp.dispose()
  }
  return null
}

/** Merge several layers into the lowest of them (multi-select "pinch"). */
export function mergeLayers(doc: Document, ids: string[]): string | null {
  const layers = doc.layers.filter((l) => ids.includes(l.id) && !l.isGroup)
  if (layers.length < 2) return t('layers.toast.selectTwo')
  if (layers.some((l) => l.locked)) return t('layers.toast.selectedLocked')
  const base = layers[0]
  const items = layers.map((l, i) => proxy(l, { visible: true, maskView: false, ...(i === 0 ? { opacity: 1, blendMode: 'normal' as const, clipping: false } : {}) }))
  const tmp = renderTo(doc, items)
  try {
    doc.transaction('Merge layers', 'layer-merge', base.id, () => {
      copyInto(doc, base, tmp, 'Merge layers')
      if (base.mask) doc.setMask(base.id, null, 'Merge layers')
      doc.replaceLayers(layers.slice(1), null, null, base.id, 'Merge layers', 'layer-merge')
    })
  } finally {
    tmp.dispose()
  }
  return null
}

/** Flatten a group into one layer that replaces it (group opacity/blend/mask carried over). */
export function mergeGroup(doc: Document, id: string): string | null {
  const g = doc.getLayer(id)
  if (!g || !g.isGroup) return t('layers.toast.notGroup')
  const kids = doc.childrenOf(id)
  const tmp = renderTo(doc, kids.map((k) => k))
  const nl = doc.createLayer({ name: g.name, opacity: g.opacity, blendMode: g.passThrough ? 'normal' : g.blendMode, visible: g.visible, locked: g.locked, alphaLock: g.alphaLock, clipping: false })
  doc.gpu.blit(tmp, fullRect(doc), nl.pixels, 0, 0)
  tmp.dispose()
  nl.mask = g.mask
  nl.maskEnabled = g.maskEnabled
  const removed = [...doc.descendantsOf(id), g]
  doc.replaceLayers(removed, nl, id, nl.id, 'Merge group', 'layer-merge')
  return null
}

/** Flatten every visible layer into one. Hidden layers are discarded. */
export function flattenAll(doc: Document): string | null {
  if (doc.layers.length < 2) return t('layers.toast.nothingToFlatten')
  const tmp = renderTo(doc, doc.childrenOf(null))
  const nl = doc.createLayer({ name: t('layers.flattened') })
  doc.gpu.blit(tmp, fullRect(doc), nl.pixels, 0, 0)
  tmp.dispose()
  doc.replaceLayers([...doc.layers], nl, null, nl.id, 'Flatten', 'layer-flatten')
  return null
}

// ---------------------------------------------------------------- pixel access for clipboard / export
export interface PixelImage {
  x: number
  y: number
  w: number
  h: number
  /** straight RGBA8 */
  data: Uint8ClampedArray
}

/** Crop straight RGBA to its non-transparent bounding box (null when fully transparent). */
export function cropToAlpha(data: Uint8ClampedArray, w: number, h: number): PixelImage | null {
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++) {
    const row = y * w * 4
    for (let x = 0; x < w; x++) {
      if (data[row + x * 4 + 3] > 0) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        y1 = y
      }
    }
  }
  if (x1 < 0) return null
  const cw = x1 - x0 + 1
  const ch = y1 - y0 + 1
  const out = new Uint8ClampedArray(cw * ch * 4)
  for (let y = 0; y < ch; y++) out.set(data.subarray(((y0 + y) * w + x0) * 4, ((y0 + y) * w + x0 + cw) * 4), y * cw * 4)
  return { x: x0, y: y0, w: cw, h: ch, data: out }
}

/** The layer's pixels (restricted to the selection when there is one), cropped to content. */
export function readLayerImage(doc: Document, layer: Layer, useSelection = true): PixelImage | null {
  if (layer.isGroup) return null
  const full = fullRect(doc)
  let src: Surface = layer.pixels
  let tmp: Surface | null = null
  if (useSelection && clipMask.tex) {
    tmp = doc.gpu.surface(doc.width, doc.height, doc.format)
    opToSurface(doc, layer.pixels, tmp, { op: Op.KeepSelection })
    src = tmp
  }
  const px = doc.gpu.readRGBA8(src, full)
  tmp?.dispose()
  return cropToAlpha(px, doc.width, doc.height)
}

/** Erase the selected part of the layer (or all of it when nothing is selected) - undoable. */
export function eraseSelected(doc: Document, layer: Layer, label = 'Cut'): boolean {
  if (clipMask.tex) return runOp(doc, layer, label, 'clear', { op: Op.EraseSelection })
  if (layer.locked || layer.isGroup) return false
  doc.clearLayer(layer.id)
  return true
}

/** Build a new full-size layer whose pixels are `img` placed at img.x/img.y (cropped to the canvas). */
export function layerFromImage(doc: Document, img: PixelImage, name: string): Layer {
  const layer = doc.createLayer({ name })
  const x0 = Math.max(0, img.x)
  const y0 = Math.max(0, img.y)
  const x1 = Math.min(doc.width, img.x + img.w)
  const y1 = Math.min(doc.height, img.y + img.h)
  const w = x1 - x0
  const h = y1 - y0
  if (w > 0 && h > 0) {
    let data = img.data
    if (w !== img.w || h !== img.h) {
      data = new Uint8ClampedArray(w * h * 4)
      for (let y = 0; y < h; y++) {
        const so = ((y0 - img.y + y) * img.w + (x0 - img.x)) * 4
        data.set(img.data.subarray(so, so + w * 4), y * w * 4)
      }
    }
    doc.gpu.uploadRGBA8(layer.pixels, x0, y0, w, h, data)
  }
  return layer
}

/** Insert a layer above the active one, notify transform hooks. */
export function insertAndTransform(doc: Document, layer: Layer, label: string): void {
  doc.insertLayer(layer, doc.getLayer(doc.activeId) ? { id: doc.activeId, where: 'above' } : null, label, 'layer-paste')
  notifyInserted(layer)
}

export function notifyInserted(layer: Layer): void {
  try {
    layerHooks.beginTransform?.(layer)
  } catch (e) {
    console.error('[layers] beginTransform hook failed', e)
  }
  window.dispatchEvent(new CustomEvent('bw:layer-inserted', { detail: { layerId: layer.id } }))
}

/** Copy of the active layer's selected area as a NEW layer in place; optionally erases it from the source. */
export function selectionToNewLayer(doc: Document, layer: Layer, cut: boolean): Layer | null {
  if (layer.isGroup) return null
  if (!clipMask.tex) {
    if (cut) return null
    return doc.duplicateLayer(layer.id)
  }
  const nl = doc.createLayer({ name: layer.name + (cut ? t('core.doc.cutSuffix') : t('core.doc.copySuffix')), blendMode: layer.blendMode, opacity: layer.opacity })
  opToSurface(doc, layer.pixels, nl.pixels, { op: Op.KeepSelection })
  let result: Layer = nl
  try {
    doc.transaction(cut ? 'Cut & paste' : 'Duplicate', 'layer-paste', nl.id, () => {
      if (cut) eraseSelected(doc, layer, 'Cut')
      doc.insertLayer(nl, { id: layer.id, where: 'above' }, cut ? 'Cut & paste' : 'Duplicate', 'layer-paste')
    })
  } catch (e) {
    result.dispose()
    throw e
  }
  return result
}
