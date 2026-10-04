import type { App } from '../../app/app'
import { t } from '../../i18n'
import { screenToDoc } from '../../core/viewTransform'
import type { Rect } from '../../core/types'
import type { Document } from '../../doc/document'
import type { Layer } from '../../doc/layer'
import type { PixelEdit } from '../../doc/pixelEdit'
import { FS_VERT, GPU, Surface } from '../../gl/gpu'
import { FillMask, FillSource, computeFillLevels, maskFromLevels } from './floodFill'
import { paletteStore } from './paletteStore'

/**
 * ColorDrop / flood fill on the GPU-backed document.
 *
 * A FillSession reads the sampling source once (reference layer when one is set, else the active layer),
 * computes the flood "levels" once, and can then re-render at any threshold instantly (used while the user
 * drags left/right after dropping). Rendering restores the touched region from a backup surface, then draws
 * the coverage mask over the layer with premultiplied source-over (or source-atop on alpha-locked layers,
 * which recolours only existing pixels). Commit produces ONE undo step.
 */

export type SelectionMask = Uint8Array // w*h coverage 0..255
type SelectionProvider = (doc: Document) => SelectionMask | null
const providers: SelectionProvider[] = []

/** Extension point: the selection feature registers a provider returning the active selection as a w*h mask. */
export function registerSelectionMaskProvider(fn: SelectionProvider): void {
  providers.push(fn)
}
export function activeSelectionMask(doc: Document): SelectionMask | null {
  for (const p of providers) {
    try {
      const m = p(doc)
      if (m && m.length === doc.width * doc.height) return m
    } catch (e) {
      console.error('[colorDrop] selection provider failed', e)
    }
  }
  return null
}

const MASK_FS = `#version 300 es
precision highp float;
uniform sampler2D uMask; uniform ivec2 uOrigin; uniform vec3 uColor;
out vec4 o;
void main(){
  float c = texelFetch(uMask, ivec2(gl_FragCoord.xy) - uOrigin, 0).r;
  o = vec4(uColor * c, c);
}`

export interface FillOptions {
  threshold: number
  antialias: boolean
  /** override: true = recolour only existing pixels (source-atop); default = layer.alphaLock */
  recolor?: boolean
}

export const referenceLayer = (doc: Document): Layer | null => doc.layers.find((l) => (l as any).reference && !(l as any).isGroup) ?? null

export interface LastFill {
  x: number
  y: number
  threshold: number
}
let lastFill: LastFill | null = null
export const getLastFill = (): LastFill | null => lastFill

export class FillSession {
  readonly layer: Layer
  private gpu: GPU
  private levels: Uint8Array
  private src: FillSource
  private backup: Surface
  private edit: PixelEdit
  private drawn: Rect | null = null
  private mask: FillMask | null = null
  private tex: WebGLTexture | null = null
  private selection: SelectionMask | null
  threshold = 0
  private done = false

  private constructor(
    private app: App,
    layer: Layer,
    src: FillSource,
    readonly sx: number,
    readonly sy: number,
    private rgb: [number, number, number],
    private opts: FillOptions
  ) {
    const doc = app.doc
    this.gpu = doc.gpu
    this.layer = layer
    this.src = src
    this.levels = computeFillLevels(src, sx, sy)
    this.selection = activeSelectionMask(doc)
    const full = { x: 0, y: 0, w: doc.width, h: doc.height }
    this.backup = doc.gpu.surface(doc.width, doc.height, layer.surface.fmt, 0)
    doc.gpu.blit(layer.surface, full, this.backup, 0, 0)
    this.edit = doc.beginPixelEdit(layer, 'ColorDrop')
  }

  /** Returns null (with a toast) when the fill cannot start. */
  static begin(app: App, docX: number, docY: number, rgb: [number, number, number], opts: FillOptions): FillSession | null {
    const doc = app.doc
    const layer = doc.activeLayer
    if (!layer || (layer as any).isGroup) {
      app.notify(t('color.fill.selectLayer'))
      return null
    }
    if (layer.locked) {
      app.notify(t('color.fill.locked'))
      return null
    }
    const x = Math.floor(docX)
    const y = Math.floor(docY)
    if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return null
    const ref = referenceLayer(doc)
    const from = ref ?? layer
    const full = { x: 0, y: 0, w: doc.width, h: doc.height }
    const data = doc.gpu.readRGBA8(from.surface, full)
    return new FillSession(app, layer, { data, w: doc.width, h: doc.height }, x, y, rgb, opts)
  }

  /** (Re)render the fill at `threshold` (0..1). Returns false when nothing is covered. */
  render(threshold: number): boolean {
    if (this.done) return false
    this.threshold = Math.min(1, Math.max(0, threshold))
    const doc = this.app.doc
    const gpu = this.gpu
    const gl = gpu.gl
    if (this.drawn) {
      gpu.blit(this.backup, this.drawn, this.layer.surface, this.drawn.x, this.drawn.y)
      doc.events.emit('change', { rect: this.drawn })
      this.drawn = null
    }
    this.mask = maskFromLevels(this.levels, this.src, this.sx, this.sy, this.threshold, { antialias: this.opts.antialias, selection: this.selection })
    const m = this.mask
    if (!m) return false
    const rect: Rect = { x: m.x, y: m.y, w: m.w, h: m.h }
    this.edit.save(rect)
    if (this.tex) gl.deleteTexture(this.tex)
    const tex = (this.tex = gl.createTexture()!)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, m.w, m.h)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, m.w, m.h, gl.RED, gl.UNSIGNED_BYTE, m.cov)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    const p = gpu.program('colordrop-mask', FS_VERT, MASK_FS).use()
    gpu.bindTex(0, tex)
    p.i('uMask', 0)
    gl.uniform2i(p.loc('uOrigin'), m.x, m.y)
    p.v3('uColor', this.rgb[0], this.rgb[1], this.rgb[2])
    gpu.bindTarget(this.layer.surface, rect)
    gl.enable(gl.BLEND)
    const atop = this.opts.recolor ?? this.layer.alphaLock
    if (atop) gl.blendFunc(gl.DST_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gpu.fullscreen()
    gl.disable(gl.BLEND)
    gl.disable(gl.SCISSOR_TEST)
    this.drawn = rect
    doc.events.emit('change', { rect })
    return true
  }

  private release(): void {
    this.done = true
    this.backup.dispose()
    if (this.tex) this.gpu.gl.deleteTexture(this.tex)
    this.tex = null
  }

  /** Finish: one undo step + commit event. Returns false when nothing was filled. */
  commit(): boolean {
    if (this.done) return false
    const doc = this.app.doc
    const ok = !!this.drawn
    let dirty: Rect | null = null
    if (ok) dirty = this.edit.finish()
    else this.edit.abort()
    this.release()
    if (dirty) {
      doc.emitCommit('filter', this.layer.id, dirty, 'ColorDrop')
      lastFill = { x: this.sx, y: this.sy, threshold: this.threshold }
    }
    return !!dirty
  }

  cancel(): void {
    if (this.done) return
    if (this.drawn) {
      this.gpu.blit(this.backup, this.drawn, this.layer.surface, this.drawn.x, this.drawn.y)
      this.app.doc.events.emit('change', { rect: this.drawn })
    }
    this.edit.abort()
    this.release()
  }
}

// ------------------------------------------------------------------ one-shot helpers
const currentRgb = (app: App): [number, number, number] => app.state.rgb

/** Flood fill at a document point with the primary colour. Returns true when pixels changed. */
export function fillAt(app: App, x: number, y: number, threshold = paletteStore().settings.fillThreshold, rgb = currentRgb(app)): boolean {
  const s = FillSession.begin(app, x, y, rgb, { threshold, antialias: paletteStore().settings.fillAntialias })
  if (!s) return false
  if (!s.render(threshold)) {
    s.cancel()
    return false
  }
  return s.commit()
}

/** Repeat the last ColorDrop (same point and threshold) with the current colour. */
export function fillLast(app: App): boolean {
  const l = lastFill
  if (!l) {
    app.notify(t('color.fill.nothingToRepeat'))
    return false
  }
  return fillAt(app, l.x, l.y, l.threshold)
}

/** Fill the entire active layer (or the active selection) with the primary colour. Alpha-locked layers are recoloured. */
export function fillLayer(app: App, recolorOnly = false): boolean {
  const doc = app.doc
  const s = FillSession.begin(app, 0, 0, currentRgb(app), { threshold: 1, antialias: false, recolor: recolorOnly ? true : undefined })
  if (!s) return false
  if (!s.render(1)) {
    s.cancel()
    return false
  }
  const ok = s.commit()
  if (ok) app.notify(t(recolorOnly ? 'color.fill.recoloured' : 'color.fill.filled', { name: doc.activeLayer.name }))
  return ok
}

// ------------------------------------------------------------------ drag-and-drop interaction
const DRAG_START_PX = 6
const DWELL_MS = 320
const PX_PER_FULL_RANGE = 360

/**
 * Make `el` a ColorDrop source: press and drag it onto the canvas. Release = fill with the current
 * threshold; hold still over the canvas (or after dropping) and keep dragging left/right to adjust the
 * threshold with a live percentage pill; lift to commit.
 */
export function attachColorDrag(app: App, el: HTMLElement, getRgbHex: () => string, getRgb: () => [number, number, number]): void {
  let pill: HTMLElement | null = null
  let ghost: HTMLElement | null = null
  const cleanupUi = (): void => {
    ghost?.remove()
    pill?.remove()
    ghost = pill = null
  }
  el.style.touchAction = 'none'
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    const id = e.pointerId
    const sx = e.clientX
    const sy = e.clientY
    let dragging = false
    let session: FillSession | null = null
    let dwell = 0
    let baseX = 0
    let baseT = 0
    let last = { x: sx, y: sy }
    const overCanvas = (x: number, y: number): boolean => document.elementFromPoint(x, y) === app.canvas
    const docPoint = (x: number, y: number): { x: number; y: number } => {
      const r = app.canvas.getBoundingClientRect()
      const s = app.cssSize()
      return screenToDoc(app.view, x - r.left, y - r.top, s.w, s.h)
    }
    const showPill = (thr: number): void => {
      if (!pill) {
        pill = document.createElement('div')
        pill.className = 'bw-pill'
        document.body.append(pill)
      }
      pill.textContent = t('color.fill.threshold', { n: Math.round(thr * 100) })
    }
    const startSession = (x: number, y: number): void => {
      const d = docPoint(x, y)
      const st = paletteStore().settings
      const s = FillSession.begin(app, d.x, d.y, getRgb(), { threshold: st.fillThreshold, antialias: st.fillAntialias })
      if (!s) return
      session = s
      baseX = x
      baseT = st.fillThreshold
      s.render(baseT)
      showPill(baseT)
    }
    const move = (ev: PointerEvent): void => {
      if (ev.pointerId !== id) return
      last = { x: ev.clientX, y: ev.clientY }
      if (!dragging) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < DRAG_START_PX) return
        dragging = true
        ghost = document.createElement('div')
        ghost.className = 'bw-drop-ghost'
        ghost.style.background = getRgbHex()
        document.body.append(ghost)
        app.input.releaseAll()
      }
      if (ghost) {
        ghost.style.left = ev.clientX + 'px'
        ghost.style.top = ev.clientY + 'px'
      }
      if (session) {
        const t = Math.min(1, Math.max(0, baseT + (ev.clientX - baseX) / PX_PER_FULL_RANGE))
        session.render(t)
        showPill(t)
        return
      }
      clearTimeout(dwell)
      if (overCanvas(ev.clientX, ev.clientY)) dwell = window.setTimeout(() => startSession(last.x, last.y), DWELL_MS)
    }
    const finish = (ev: PointerEvent, cancelled: boolean): void => {
      if (ev.pointerId !== id) return
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', cancel)
      clearTimeout(dwell)
      try {
        el.releasePointerCapture(id)
      } catch {
        /* not captured */
      }
      if (dragging) {
        // the drag must not count as a click on the swatch (which toggles the panel)
        const swallow = (c: Event): void => c.stopImmediatePropagation()
        window.addEventListener('click', swallow, { capture: true, once: true })
        setTimeout(() => window.removeEventListener('click', swallow, true), 0)
      }
      if (cancelled) session?.cancel()
      else if (session) {
        paletteStore().settings.fillThreshold = session.threshold
        paletteStore().saveSettings()
        if (!session.commit()) app.notify(t('color.fill.nothing'))
      } else if (dragging && overCanvas(ev.clientX, ev.clientY)) {
        const d = docPoint(ev.clientX, ev.clientY)
        if (!fillAt(app, d.x, d.y, paletteStore().settings.fillThreshold, getRgb())) app.notify(t('color.fill.nothing'))
      }
      cleanupUi()
    }
    const up = (ev: PointerEvent): void => finish(ev, false)
    const cancel = (ev: PointerEvent): void => finish(ev, true)
    try {
      el.setPointerCapture(id)
    } catch {
      /* synthetic pointer */
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', cancel)
  })
}
