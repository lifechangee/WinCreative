import { clipImageToFrame } from '../frame/clip'
import { t } from '../../i18n'
import type { Rect } from '../../core/types'
import { TILE, TileKey, intRect, regionPieces, tileKey, tileKeyX, tileKeyY, tilesIn } from '../../core/tiles'
import type { Document } from '../../doc/document'
import type { Layer } from '../../doc/layer'
import { newInfMask } from '../../doc/maskStore'
import { StackRenderer } from '../../gl/compositor'
import { bindClipMask, clipMask } from '../../gl/clipMask'
import type { Surface } from '../../gl/gpu'
import { FS_VERT } from '../../gl/shaders'
import { LAYER_OP_FS } from '../../gl/layerShaders'

/**
 * Optional integration points other features may set.
 *  - beginTransform(layer): called after a layer was pasted / inserted so the transform tool can pick it up
 *  - addText(): create a text layer (Text feature)
 *  - workRect(): infinite canvas, the doc-space rect "whole layer" operations act on (frame, else visible area)
 *  - selectionBounds(): tight bounds of the active selection (null = none)
 * A DOM CustomEvent 'bw:layer-inserted' ({detail:{layerId}}) is dispatched as well.
 */
export const layerHooks: {
  beginTransform: ((layer: Layer) => void) | null
  addText: (() => void) | null
  workRect: (() => Rect) | null
  selectionBounds: (() => Rect | null) | null
} = { beginTransform: null, addText: null, workRect: null, selectionBounds: null }

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
  /** infinite canvas: texture of the mask tile belonging to the tile being processed */
  maskTex?: WebGLTexture | null
  /** honour the current selection (clipMask) */
  useSelection?: boolean
}

const fullRect = (doc: Document): Rect => ({ x: 0, y: 0, w: doc.width, h: doc.height })
const tileCtx = (tx: number, ty: number): { x: number; y: number; w: number; h: number } => ({ x: tx * TILE, y: ty * TILE, w: TILE, h: TILE })

/** Run a layer op reading `src` and writing `dst` (different surfaces). `ctx`: where `dst` lives in document space (infinite canvas tiles). */
export function opToSurface(doc: Document, src: Surface | null, dst: Surface, o: OpOpts, ctx?: { x: number; y: number; w: number; h: number }): void {
  const gpu = doc.gpu
  const gl = gpu.gl
  const p = gpu.program('layer-op', FS_VERT, LAYER_OP_FS).use()
  gpu.bindTex(0, src ? src.tex : gpu.blank)
  gpu.bindTex(1, o.maskTex ?? (o.mask ? o.mask.tex : gpu.blank))
  const c = o.color ?? [0, 0, 0]
  p.i('uSrc', 0).i('uMask', 1).i('uOp', o.op).v3('uColor', c[0], c[1], c[2]).f('uAlphaLock', o.alphaLock ? 1 : 0)
  if (o.useSelection !== false && clipMask.tex) bindClipMask(gpu, p, ctx)
  else {
    gpu.bindTex(4, gpu.blank)
    p.i('uSelMask', 4).f('uSelOn', 0)
  }
  p.f('uFrameOn', 0)
  gl.disable(gl.BLEND)
  gpu.bindTarget(dst, null)
  gpu.fullscreen()
}

// ---------------------------------------------------------------- infinite canvas: tile-wise ops
/** The rect whole-layer ops use on an infinite canvas: the selection bounds when there is a selection, else the work rect. */
function infRect(doc: Document): Rect {
  const sel = clipMask.tex ? layerHooks.selectionBounds?.() : null
  if (sel) return sel
  return layerHooks.workRect?.() ?? doc.contentBounds() ?? { x: 0, y: 0, w: 1024, h: 1024 }
}

function maskTexFor(doc: Document, layer: Layer, key: TileKey): WebGLTexture {
  const m = layer.maskTiles?.getKey(key)
  return m ? m.tex : layer.maskFill ? doc.gpu.white : doc.gpu.blank
}

/**
 * Undoable op over the tiles of a layer's pixels (or mask). `rect` = tiles to process (null = every existing tile);
 * `existingOnly` = skip tiles that do not exist yet (otherwise they are allocated - and freed again when they end up empty).
 */
function runOpInf(doc: Document, layer: Layer, label: string, type: 'layer-fill' | 'layer-invert' | 'layer-mask' | 'clear', o: OpOpts, onMask: boolean, rect: Rect | null, existingOnly: boolean): boolean {
  const store = onMask ? layer.maskTiles : layer.tiles
  if (!store) return false
  const gpu = doc.gpu
  const coords = rect
    ? tilesIn(intRect(rect)).filter((c) => !existingOnly || store.has(c.tx, c.ty))
    : [...store.keys()].map((k) => ({ tx: tileKeyX(k), ty: tileKeyY(k) }))
  if (!coords.length) return false
  const prev = layer.editingMask
  layer.editingMask = onMask
  const edit = doc.beginPixelEdit(layer, label)
  layer.editingMask = prev
  try {
    for (const c of coords) {
      edit.saveKey(tileKey(c.tx, c.ty))
      store.ensure(c.tx, c.ty) // allocate before any texture is bound
    }
    const scratch = gpu.surface(TILE, TILE, store.fmt, 0)
    for (const c of coords) {
      const tile = store.ensure(c.tx, c.ty)
      gpu.blit(tile, { x: 0, y: 0, w: TILE, h: TILE }, scratch, 0, 0)
      const maskTex = o.op === Op.ApplyMask ? maskTexFor(doc, layer, tileKey(c.tx, c.ty)) : null
      opToSurface(doc, scratch, tile, { ...o, maskTex }, tileCtx(c.tx, c.ty))
    }
    scratch.dispose()
    if (!onMask) for (const k of store.emptyAmong(edit.savedKeys())) edit.removeKey(k)
  } catch (e) {
    edit.abort()
    throw e
  }
  const dirty = edit.finish()
  doc.emitCommit(type, layer.id, dirty, label)
  return true
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
  if (doc.isInfinite) {
    if (layer.isGroup || layer.locked) return false
    const onMask = layer.editingMask && !!layer.mask
    return runOpInf(doc, layer, onMask ? 'Fill mask' : 'Fill layer', 'layer-fill', { op: Op.Fill, color, alphaLock: !onMask && layer.alphaLock }, onMask, infRect(doc), !onMask && layer.alphaLock)
  }
  if (layer.editingMask && layer.mask) return runOp(doc, layer, 'Fill mask', 'layer-fill', { op: Op.Fill, color }, true)
  return runOp(doc, layer, 'Fill layer', 'layer-fill', { op: Op.Fill, color, alphaLock: layer.alphaLock })
}

export function invertLayer(doc: Document, layer: Layer): boolean {
  if (doc.isInfinite) {
    if (layer.isGroup || layer.locked) return false
    if (layer.editingMask && layer.mask) return invertMask(doc, layer)
    return runOpInf(doc, layer, 'Invert colors', 'layer-invert', { op: Op.InvertColors }, false, clipMask.tex ? infRect(doc) : null, true)
  }
  if (layer.editingMask && layer.mask) return runOp(doc, layer, 'Invert mask', 'layer-invert', { op: Op.InvertMask, useSelection: false }, true)
  return runOp(doc, layer, 'Invert colors', 'layer-invert', { op: Op.InvertColors })
}

/** Infinite mask: the mask is replaced (structural, undoable) by an inverted copy - every tile inverted, the fill value flipped. */
function invertMaskInf(doc: Document, layer: Layer): boolean {
  const old = layer.mask!
  const src = layer.maskTiles!
  const gpu = doc.gpu
  const ns = newInfMask(gpu, src.fmt, layer.maskFill ? 0 : 1)
  const dst = ns.inf!
  const keys = [...src.keys()]
  for (const k of keys) dst.ensureKey(k)
  const scratch = gpu.surface(TILE, TILE, src.fmt, 0)
  for (const k of keys) {
    const s = src.getKey(k)!
    const d = dst.ensureKey(k)
    gpu.blit(s, { x: 0, y: 0, w: TILE, h: TILE }, scratch, 0, 0)
    opToSurface(doc, scratch, d, { op: Op.InvertMask, useSelection: false })
  }
  scratch.dispose()
  const keep = { editing: layer.editingMask, enabled: layer.maskEnabled, view: layer.maskView }
  doc.setMask(layer.id, ns, 'Invert mask')
  layer.editingMask = keep.editing
  layer.maskEnabled = keep.enabled
  layer.maskView = keep.view
  void old
  return true
}

export function invertMask(doc: Document, layer: Layer): boolean {
  if (doc.isInfinite) return !!layer.mask && !layer.locked && invertMaskInf(doc, layer)
  return runOp(doc, layer, 'Invert mask', 'layer-mask', { op: Op.InvertMask, useSelection: false }, true)
}

/** Clear mask = everything hidden (black). */
export function clearMask(doc: Document, layer: Layer): boolean {
  if (!layer.mask) return false
  if (doc.isInfinite) return setInfMaskFill(doc, layer, 0, 'Clear mask')
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
  if (doc.isInfinite) return setInfMaskFill(doc, layer, 1, 'Reveal all')
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

/** Infinite mask reset to a uniform value: a fresh empty mask store replaces the old one (one undo step, nothing to copy). */
function setInfMaskFill(doc: Document, layer: Layer, fill: 0 | 1, label: string): boolean {
  const keep = { editing: layer.editingMask, enabled: layer.maskEnabled, view: layer.maskView }
  doc.setMask(layer.id, newInfMask(doc.gpu, layer.tiles!.fmt, fill), label)
  layer.editingMask = keep.editing
  layer.maskEnabled = keep.enabled
  layer.maskView = keep.view
  return true
}

/** Bake the mask into the pixels and remove it (one undo step). */
export function applyMask(doc: Document, layer: Layer): boolean {
  if (!layer.mask || layer.isGroup || layer.locked) return false
  const mask = layer.mask
  doc.transaction('Apply mask', 'layer-mask', layer.id, () => {
    if (doc.isInfinite) runOpInf(doc, layer, 'Apply mask', 'layer-mask', { op: Op.ApplyMask, useSelection: false }, false, null, true)
    else runOp(doc, layer, 'Apply mask', 'layer-mask', { op: Op.ApplyMask, mask, useSelection: false })
    doc.setMask(layer.id, null, 'Apply mask')
  })
  return true
}

/** New mask from the current selection (white = selected) or plain white/black when there is none. */
export function addMask(doc: Document, layer: Layer, fill: 'white' | 'black' | 'selection' = 'white'): boolean {
  if (layer.mask) return false
  let surf: Surface
  if (fill === 'selection' && clipMask.tex) {
    if (doc.isInfinite) {
      surf = newInfMask(doc.gpu, layer.tiles?.fmt ?? doc.format, 0)
      const store = surf.inf!
      const win = clipMask.win
      const coords = win ? tilesIn(win) : []
      for (const c of coords) store.ensure(c.tx, c.ty)
      for (const c of coords) opToSurface(doc, null, store.ensure(c.tx, c.ty), { op: Op.SelectionToMask }, tileCtx(c.tx, c.ty))
    } else {
      surf = doc.createMaskSurface(false)
      opToSurface(doc, doc.scratch, surf, { op: Op.SelectionToMask })
    }
  } else surf = doc.createMaskSurface(fill !== 'black')
  doc.setMask(layer.id, surf)
  return true
}

// ---------------------------------------------------------------- merge / flatten
type Proxy = Layer

const proxy = (l: Layer, over: Partial<Layer>): Proxy => Object.assign(Object.create(l), over) as Proxy

/** Result of rendering a layer list: one canvas-sized surface (fixed) or one surface per tile (infinite). */
type Rendered = { surf: Surface } | { tiles: Map<TileKey, Surface> }

function renderTo(doc: Document, items: Layer[], lang?: string): Rendered {
  const r = new StackRenderer(doc.gpu, () => doc)
  if (lang) r.lang = lang // language variants: render as this language (default: the view language)
  try {
    if (!doc.isInfinite) {
      const dest = doc.gpu.surface(doc.width, doc.height, doc.format)
      r.render(items, dest, null, null)
      return { surf: dest }
    }
    const keys = new Set<TileKey>()
    const all: Layer[] = []
    for (const l of items) {
      all.push(l)
      if (l.isGroup) all.push(...doc.descendantsOf(l.id))
    }
    for (const l of all) if (!l.isGroup && l.tiles) for (const k of l.tiles.keys()) keys.add(k)
    const tiles = new Map<TileKey, Surface>()
    for (const k of keys) {
      const dest = doc.gpu.surface(TILE, TILE, doc.format)
      tiles.set(k, dest)
      r.renderTile(items, k, dest, null, null)
    }
    return { tiles }
  } finally {
    r.dispose()
  }
}

const disposeRendered = (x: Rendered): void => {
  if ('surf' in x) x.surf.dispose()
  else for (const s of x.tiles.values()) s.dispose()
}

/** Layer directly below `id` among its siblings, if it is a plain layer. */
export function layerBelow(doc: Document, id: string): Layer | null {
  const l = doc.getLayer(id)
  if (!l) return null
  const sibs = doc.childrenOf(l.parentId)
  const i = sibs.indexOf(l)
  return i > 0 ? sibs[i - 1] : null
}

function copyInto(doc: Document, layer: Layer, src: Rendered, label: string): void {
  const prev = layer.editingMask
  layer.editingMask = false
  const edit = doc.beginPixelEdit(layer, label)
  layer.editingMask = prev
  if ('tiles' in src) {
    const store = layer.tiles!
    const gpu = doc.gpu
    const keys = new Set<TileKey>([...store.keys(), ...src.tiles.keys()])
    for (const k of keys) edit.saveKey(k)
    for (const k of src.tiles.keys()) store.ensureKey(k) // allocate before binding
    for (const k of keys) {
      const t = store.getKey(k)
      const r = src.tiles.get(k)
      if (r && t) gpu.blit(r, { x: 0, y: 0, w: TILE, h: TILE }, t, 0, 0)
      else if (t) gpu.clear(t)
    }
    for (const k of store.emptyAmong(edit.savedKeys())) edit.removeKey(k)
    const dirty = edit.finish()
    if (dirty) doc.events.emit('change', { rect: dirty })
    return
  }
  const full = fullRect(doc)
  edit.save(full)
  doc.gpu.blit(src.surf, full, layer.pixels, 0, 0)
  edit.finish()
}

/** Fill the (new, empty) layer `nl` with a rendering. */
function fillLayerFrom(doc: Document, nl: Layer, src: Rendered): void {
  if ('tiles' in src) {
    const store = nl.tiles!
    for (const k of src.tiles.keys()) store.ensureKey(k)
    for (const [k, s] of src.tiles) doc.gpu.blit(s, { x: 0, y: 0, w: TILE, h: TILE }, store.ensureKey(k), 0, 0)
    store.prune()
  } else doc.gpu.blit(src.surf, fullRect(doc), nl.pixels, 0, 0)
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
    disposeRendered(tmp)
  }
  return null
}

/**
 * Merge Down for a language layer: the layer below must be a language layer too; every language's cell is composited onto the same language's
 * cell of the lower row (created when missing), with the upper row's opacity / blend mode applied. The upper row disappears.
 */
export function mergeLangDown(doc: Document, id: string): string | null {
  const up = doc.getLayer(id)
  if (!up?.langSet) return t('layers.toast.noLayer')
  const low = layerBelow(doc, id)
  if (!low) return t('layers.toast.noLayerBelow')
  if (!low.langSet) return t('langs.toast.mergeNeedsLang')
  if (low.locked || up.locked) return t('layers.toast.layerLocked')
  const upBlend = up.passThrough ? 'normal' : up.blendMode
  doc.transaction('Merge language layers', 'layer-merge', low.id, () => {
    for (const l of doc.langs) {
      const uc = doc.cellOf(up.id, l.code)
      if (!uc) continue
      const lc = doc.ensureCell(low, l.code)
      const lowP = proxy(lc, { opacity: 1, blendMode: 'normal', clipping: false, visible: true, maskView: false, parentId: null })
      const upP = proxy(uc, { opacity: uc.opacity * up.opacity, blendMode: upBlend as Layer['blendMode'], visible: true, maskView: false, parentId: null })
      const tmp = renderTo(doc, [lowP, upP], l.code)
      try {
        copyInto(doc, lc, tmp, 'Merge language layers')
      } finally {
        disposeRendered(tmp)
      }
    }
    doc.replaceLayers([...doc.descendantsOf(up.id), up], null, null, low.id, 'Merge language layers', 'layer-merge')
  })
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
    disposeRendered(tmp)
  }
  return null
}

/** Flatten a group into one layer that replaces it (group opacity/blend/mask carried over). */
export function mergeGroup(doc: Document, id: string, force = false): string | null {
  const g = doc.getLayer(id)
  if (!g || !g.isGroup) return t('layers.toast.notGroup')
  // a language layer (or a group holding one) would be flattened into the VIEW language only and lose the other languages' cells
  if (!force && (g.langSet || doc.descendantsOf(id).some((d) => d.langSet))) return t('langs.toast.mergeRefused')
  const kids = doc.childrenOf(id)
  const tmp = renderTo(doc, kids.map((k) => k))
  const nl = doc.createLayer({ name: g.name, opacity: g.opacity, blendMode: g.passThrough ? 'normal' : g.blendMode, visible: g.visible, locked: g.locked, alphaLock: g.alphaLock, clipping: false })
  fillLayerFrom(doc, nl, tmp)
  disposeRendered(tmp)
  nl.mask = g.mask
  nl.maskEnabled = g.maskEnabled
  const removed = [...doc.descendantsOf(id), g]
  doc.replaceLayers(removed, nl, id, nl.id, 'Merge group', 'layer-merge')
  return null
}

/** Flatten every visible layer into one. Hidden layers are discarded. */
export function flattenAll(doc: Document, force = false): string | null {
  if (doc.layers.length < 2) return t('layers.toast.nothingToFlatten')
  if (!force && doc.hasLangLayers) return t('langs.toast.flattenRefused')
  const tmp = renderTo(doc, doc.childrenOf(null))
  const nl = doc.createLayer({ name: t('layers.flattened') })
  fillLayerFrom(doc, nl, tmp)
  disposeRendered(tmp)
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
  if (doc.isInfinite) {
    const sel = useSelection && clipMask.tex ? (layerHooks.selectionBounds?.() ?? null) : null
    const b = sel ?? layer.tiles?.tightBounds() ?? null
    if (!b) return null
    const max = doc.gpu.maxTexture
    const r = { x: b.x, y: b.y, w: Math.min(b.w, max), h: Math.min(b.h, max) }
    const src = doc.readRegion(layer, r)
    let tmp: Surface | null = null
    let from = src
    if (sel) {
      tmp = doc.gpu.surface(r.w, r.h, src.fmt, 0)
      opToSurface(doc, src, tmp, { op: Op.KeepSelection }, { x: r.x, y: r.y, w: r.w, h: r.h })
      from = tmp
    }
    const px = doc.gpu.readRGBA8(from, { x: 0, y: 0, w: r.w, h: r.h })
    src.dispose()
    tmp?.dispose()
    const c = cropToAlpha(px, r.w, r.h)
    return c ? { ...c, x: c.x + r.x, y: c.y + r.y } : null
  }
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
  if (doc.isInfinite) {
    if (layer.locked || layer.isGroup) return false
    if (clipMask.tex) return runOpInf(doc, layer, label, 'clear', { op: Op.EraseSelection }, false, infRect(doc), true)
    doc.clearLayer(layer.id)
    return true
  }
  if (clipMask.tex) return runOp(doc, layer, label, 'clear', { op: Op.EraseSelection })
  if (layer.locked || layer.isGroup) return false
  doc.clearLayer(layer.id)
  return true
}

/** Build a new full-size layer whose pixels are `img` placed at img.x/img.y (cropped to the canvas; infinite canvas: any size, split into tiles). */
export function layerFromImage(doc: Document, src: PixelImage, name: string): Layer {
  const layer = doc.createLayer({ name })
  const img = clipImageToFrame(doc, src) // frame ON: only what lands inside the frame is kept (features/frame)
  if (!img) return layer
  if (doc.isInfinite) {
    const store = layer.tiles!
    for (const p of regionPieces({ x: img.x, y: img.y, w: img.w, h: img.h })) {
      const buf = new Uint8ClampedArray(p.w * p.h * 4)
      let any = false
      for (let y = 0; y < p.h; y++) {
        const so = ((p.dy + y) * img.w + p.dx) * 4
        const row = img.data.subarray(so, so + p.w * 4)
        buf.set(row, y * p.w * 4)
        if (!any) for (let i = 3; i < row.length; i += 4) if (row[i]) { any = true; break }
      }
      if (!any) continue
      doc.gpu.uploadRGBA8(store.ensure(p.tx, p.ty), p.sx, p.sy, p.w, p.h, buf)
    }
    return layer
  }
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
export function insertAndTransform(doc: Document, layer: Layer, label: string): 'cell' | 'common-over-language' | 'plain' {
  // language layer active and its view-language cell still empty: the pasted pixels BECOME that cell (language-specific writing);
  // otherwise a pasted layer is an ordinary (common) layer above the active row
  const g = doc.langSetOf(doc.getLayer(doc.activeId))
  if (g && !doc.cellOf(g.id, doc.viewLang)) {
    layer.lang = doc.viewLang
    doc.insertLayer(layer, { id: g.id, where: 'into' }, label, 'layer-paste')
    doc.activeId = g.id
    notifyInserted(layer)
    return 'cell'
  }
  const near = g ?? doc.getLayer(doc.activeId)
  doc.insertLayer(layer, near ? { id: near.id, where: 'above' } : null, label, 'layer-paste')
  notifyInserted(layer)
  return g ? 'common-over-language' : 'plain'
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
  if (doc.isInfinite) {
    const src = layer.tiles!
    const dst = nl.tiles!
    const b = layerHooks.selectionBounds?.() ?? null
    const coords = b ? tilesIn(intRect(b)).filter((c) => src.has(c.tx, c.ty)) : []
    for (const c of coords) dst.ensure(c.tx, c.ty)
    for (const c of coords) opToSurface(doc, src.get(c.tx, c.ty)!, dst.ensure(c.tx, c.ty), { op: Op.KeepSelection }, tileCtx(c.tx, c.ty))
    dst.prune()
  } else opToSurface(doc, layer.pixels, nl.pixels, { op: Op.KeepSelection })
  const result: Layer = nl
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
