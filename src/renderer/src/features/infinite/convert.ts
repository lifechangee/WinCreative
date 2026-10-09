import type { App } from '../../app/app'
import type { Rect } from '../../core/types'
import { regionPieces, tileKey } from '../../core/tiles'
import { Document, INF_FRAME } from '../../doc/document'
import { normalizeOrder } from '../../doc/layerTree'
import type { GPU } from '../../gl/gpu'
import { Compositor } from '../../gl/compositor'
import { resample } from '../../io/gpuUtil'
import { h } from '../../ui/dom'
import { t, tk } from '../../i18n'
import { galleryRef } from '../color/galleryRef'
import { frameRect } from '../frame/workRect'
import { getExportArea } from '../frame/exportArea'
import { btn, modal, numberInput, select } from '../animio/ui'

/**
 * Conversions between fixed and infinite canvases, and the "work rect" bridge that lets bounded-canvas exporters (PSD, layer PNG / PDF,
 * copy) run on an infinite document.
 *
 * Convert is done as "duplicate as...": the result is a NEW artwork in the gallery and the original is never touched (safer than an
 * in-place conversion, which would have to be undoable across document kinds).
 */

const fullRect = (w: number, h: number): Rect => ({ x: 0, y: 0, w, h })

/** The rect bounded-canvas tools use on an infinite document: the frame, else the tight content bounds (null = nothing painted). */
export function workRectOrContent(doc: Document): Rect | null {
  if (!doc.isInfinite) return fullRect(doc.width, doc.height)
  // honour the export Area chosen in the Share dialog (Frame / All content); without a frame it is the content bounds
  const area = getExportArea(doc)
  return (area === 'frame' ? frameRect(doc) : null) ?? doc.contentBounds({ tight: true, visibleOnly: false })
}

/** New FIXED document with the pixels of `rect` of an infinite document: layers, groups, blend modes, masks, background and ids are kept. */
export function infiniteToFixed(gpu: GPU, doc: Document, rect: Rect): Document {
  if (rect.w < 1 || rect.h < 1) throw new RangeError('empty rect')
  if (rect.w > gpu.maxTexture || rect.h > gpu.maxTexture) throw new RangeError(`The area exceeds the ${gpu.maxTexture}px canvas limit`)
  const nd = new Document(gpu, Math.round(rect.w), Math.round(rect.h), { background: { color: [...doc.background.color], visible: doc.background.visible } })
  nd.name = doc.name
  nd.langs = doc.langs.map((l) => ({ ...l })) // language variants travel with the copy (cells keep their lang tag)
  nd.viewLang = doc.viewLang
  const full = fullRect(nd.width, nd.height)
  for (const l of doc.layers) {
    const nl = nd.createLayer({ ...l.props, reference: false }, l.id)
    if (!l.isGroup && l.tiles) {
      const src = doc.readRegion(l, rect)
      gpu.blit(src, full, nl.pixels, 0, 0)
      src.dispose()
      const ms = l.maskTiles
      if (l.mask && ms) {
        nl.mask = nd.createMaskSurface(l.maskFill === 1)
        for (const p of regionPieces(rect)) {
          const tile = ms.peekKey(tileKey(p.tx, p.ty)) ?? ms.getKey(tileKey(p.tx, p.ty))
          if (tile) gpu.blit(tile, { x: p.sx, y: p.sy, w: p.w, h: p.h }, nl.mask, p.dx, p.dy)
        }
      }
    }
    nd.layers.push(nl)
  }
  nd.layers.splice(0, nd.layers.length, ...normalizeOrder(nd.layers))
  nd.activeId = nd.getLayer(doc.activeId) ? doc.activeId : nd.layers[nd.layers.length - 1].id
  return nd
}

/** New INFINITE document holding a fixed canvas with its top-left corner at the origin (a frame of the canvas size is NOT created here). */
export function fixedToInfinite(gpu: GPU, doc: Document): Document {
  const nd = new Document(gpu, INF_FRAME, INF_FRAME, { kind: 'infinite', background: { color: [...doc.background.color], visible: doc.background.visible } })
  nd.name = doc.name
  nd.langs = doc.langs.map((l) => ({ ...l }))
  nd.viewLang = doc.viewLang
  const W = doc.width
  const H = doc.height
  for (const l of doc.layers) {
    const nl = nd.createLayer({ ...l.props, reference: false }, l.id)
    if (!l.isGroup && nl.tiles) {
      const copy = (src: typeof l.pixels, dst: NonNullable<typeof nl.tiles>): void => {
        for (const p of regionPieces(fullRect(W, H))) {
          const d = dst.ensure(p.tx, p.ty)
          gpu.blit(src, { x: p.dx, y: p.dy, w: p.w, h: p.h }, d, p.sx, p.sy)
        }
      }
      copy(l.pixels, nl.tiles)
      nl.tiles.prune()
      if (l.mask) {
        nl.mask = nd.createMaskSurface(true)
        if (nl.maskTiles) copy(l.mask, nl.maskTiles)
      }
    }
    nd.layers.push(nl)
  }
  nd.layers.splice(0, nd.layers.length, ...normalizeOrder(nd.layers))
  nd.activeId = nd.getLayer(doc.activeId) ? doc.activeId : nd.layers[nd.layers.length - 1].id
  return nd
}

/**
 * Run `fn` with an App whose `doc` / `compositor` are a temporary fixed copy of the work rect (frame, else content bounds) of the
 * infinite document - everything written for bounded canvases (PSD, layer PNG / PDF, copy to clipboard) then works unchanged.
 * Fixed documents run `fn(app)` directly. Returns null (and tells the user) when there is nothing to export.
 */
export async function withWorkDoc<T>(app: App, fn: (app: App) => Promise<T> | T, notify: (msg: string) => void = (m) => app.notify(m)): Promise<T | null> {
  if (!app.doc.isInfinite) return fn(app)
  const rect = workRectOrContent(app.doc)
  if (!rect) {
    notify(t('ui.inf.nothingToExport'))
    return null
  }
  if (rect.w > app.gpu.maxTexture || rect.h > app.gpu.maxTexture) {
    // layered exports cannot be scaled down like a flattened PNG: say what the real limit is (the GPU texture size), not a generic "canvas limit"
    notify(t('ui.inf.export.tooBig', { w: Math.round(rect.w), h: Math.round(rect.h), max: app.gpu.maxTexture }))
    return null
  }
  let tmp: Document
  try {
    tmp = infiniteToFixed(app.gpu, app.doc, rect)
  } catch (e) {
    notify((e as Error).message)
    return null
  }
  const comp = new Compositor(app.gpu, tmp)
  const proxy = new Proxy(app, {
    get(target, prop) {
      if (prop === 'doc') return tmp
      if (prop === 'compositor') return comp
      const v = (target as unknown as Record<string | symbol, unknown>)[prop]
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v
    }
  })
  try {
    return await fn(proxy)
  } finally {
    comp.renderer.dispose()
    comp.inf.dispose()
    comp.composite.dispose()
    tmp.dispose()
  }
}

/** Pixel flip of every layer around the centre of the work rect (frame, else content bounds), one undo step. */
export function flipInfinite(app: App, axis: 'h' | 'v'): void {
  const doc = app.doc
  const gpu = app.gpu
  const rect = workRectOrContent(doc)
  if (!rect) return app.notify(t('ui.inf.nothingToExport'))
  doc.transaction(axis === 'h' ? 'Flip canvas horizontal' : 'Flip canvas vertical', 'filter', null, () => {
    for (const l of doc.layers) {
      if (l.isGroup || !l.tiles) continue
      doc.withRegion(
        l,
        rect,
        (surf, r) => {
          const tmp = gpu.surface(r.w, r.h, surf.fmt, 0)
          gpu.blit(surf, fullRect(r.w, r.h), tmp, 0, 0)
          resample(gpu, tmp, surf, axis === 'h' ? { origin: [r.w, 0], step: [-1, 1] } : { origin: [0, r.h], step: [1, -1] })
          tmp.dispose()
        },
        { undoLabel: 'Flip' }
      )
    }
  })
}

// ------------------------------------------------------------------ dialogs
async function adopt(app: App, nd: Document, name: string): Promise<void> {
  nd.name = name
  const store = galleryRef.store
  if (store) await store.addDocument(nd, { name })
  app.setDocument(nd)
}

type Source = 'frame' | 'content' | 'custom'

/** "Convert to fixed canvas..." (infinite documents): from Frame / from content bounds / custom rect. Creates a new artwork. */
export function convertToFixedDialog(app: App): void {
  const doc = app.doc
  const fr = frameRect(doc)
  const content = doc.contentBounds({ tight: true })
  const start = fr ?? content ?? { x: 0, y: 0, w: 2048, h: 2048 }
  const st = { src: (fr ? 'frame' : content ? 'content' : 'custom') as Source, x: Math.round(start.x), y: Math.round(start.y), w: Math.round(start.w), h: Math.round(start.h) }
  const m = modal(tk('ui.inf.toFixed.title'))
  const info = h('p', { class: 'an-note' })
  const inputs = {
    x: numberInput(st.x, -1e7, 1e7, (v) => ((st.x = v), update())),
    y: numberInput(st.y, -1e7, 1e7, (v) => ((st.y = v), update())),
    w: numberInput(st.w, 1, app.gpu.maxTexture, (v) => ((st.w = v), update())),
    h: numberInput(st.h, 1, app.gpu.maxTexture, (v) => ((st.h = v), update()))
  }
  const rect = (): Rect | null => (st.src === 'frame' ? fr : st.src === 'content' ? content : { x: st.x, y: st.y, w: st.w, h: st.h })
  function update(): void {
    const r = rect()
    const ok = !!r && r.w >= 1 && r.h >= 1 && r.w <= app.gpu.maxTexture && r.h <= app.gpu.maxTexture
    info.textContent = !r ? t('ui.inf.toFixed.none') : ok ? t('ui.inf.toFixed.size', { w: Math.round(r.w), h: Math.round(r.h) }) : t('ui.inf.toFixed.tooBig', { max: app.gpu.maxTexture })
    go.disabled = !ok
    for (const k of Object.keys(inputs) as (keyof typeof inputs)[]) inputs[k].disabled = st.src !== 'custom'
  }
  const go = btn(tk('ui.inf.toFixed.create'), async () => {
    const r = rect()
    if (!r) return
    go.disabled = true
    try {
      const nd = infiniteToFixed(app.gpu, doc, { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) })
      m.close()
      await adopt(app, nd, doc.name + t('ui.inf.toFixed.suffix'))
    } catch (e) {
      app.notify(String((e as Error).message))
      go.disabled = false
    }
  }, 'primary')
  m.body.append(
    h('p', { class: 'an-note', text: t('ui.inf.toFixed.note') }),
    h('div', { class: 'an-grid' }, h('label', { text: t('ui.inf.toFixed.source') }), select<Source>([['frame', tk('ui.inf.toFixed.frame')], ['content', tk('ui.inf.toFixed.content')], ['custom', tk('ui.inf.toFixed.custom')]], st.src, (v) => ((st.src = v), update())), h('label', { text: 'X' }), inputs.x, h('label', { text: 'Y' }), inputs.y, h('label', { text: 'W' }), inputs.w, h('label', { text: 'H' }), inputs.h),
    info
  )
  m.footer.append(btn(tk('core.common.close'), () => m.close()), go)
  update()
}

/** "Convert to infinite canvas" (fixed documents): a new infinite artwork holding the canvas at the origin. */
export async function convertToInfinite(app: App): Promise<void> {
  const doc = app.doc
  if (doc.isInfinite) return
  const nd = fixedToInfinite(app.gpu, doc)
  await adopt(app, nd, doc.name + t('ui.inf.toInfinite.suffix'))
  app.notify(t('ui.inf.toInfinite.done'))
}
