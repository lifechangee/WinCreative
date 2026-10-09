import type { App } from '../../../app/app'
import type { Rect } from '../../../core/types'
import type { Document } from '../../../doc/document'
import { registerBwkExtension } from '../../../io/bwk'
import { putRegionPixels } from '../../../doc/regionPut'
import { strokeHooks } from '../../../tools/strokeHooks'
import { t as tr, tEl, tk } from '../../../i18n'
import { h } from '../../../ui/dom'
import { registerMenuItem } from '../../../ui/registry'
import { layerHooks } from '../../layers/ops'
import type { DragHandler, Overlay } from '../overlay'
import { floatPanel, injectCss, segRow, sliderRow, toggleRow } from '../widgets'
import { DEFAULT_TEXT_STYLE, TextData, TextStyle, cloneText, normalizeText, paintSpan, remapSpans } from './model'
import { measureBox, renderText } from './render'
import { registerResourceImporter } from '../../color/resourceImport'

type Snap = TextData | null
type LastRect = Rect | 'full' | null

const FALLBACK_FONTS = ['Arial', 'Segoe UI', 'Calibri', 'Cambria', 'Candara', 'Consolas', 'Constantia', 'Corbel', 'Courier New', 'Georgia', 'Impact', 'Lucida Console', 'Palatino Linotype', 'Segoe Print', 'Segoe Script', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Comic Sans MS']

/** Text layers: editable until rasterised (painting on one, or the Rasterize action). Saved in the .bwk as manifest.extra.text. */
export class TextManager {
  private store = new WeakMap<Document, Map<string, TextData>>()
  private lastRect = new Map<string, LastRect>()
  private session: { layerId: string; before: Snap; timer: number } | null = null
  private self = false
  editing = false
  readonly imported = new Map<string, { data: Uint8Array; file: string }>()
  fonts: string[] = [...FALLBACK_FONTS]
  /** default style for the next new text layer */
  defaults: TextStyle = { ...DEFAULT_TEXT_STYLE }
  private ta: HTMLTextAreaElement
  private listeners = new Set<() => void>()
  private dragMoved = false
  private lastTap = { t: 0, x: 0, y: 0 }

  constructor(
    readonly app: App,
    readonly overlay: Overlay
  ) {
    injectCss()
    this.ta = h('textarea', { spellcheck: false }) as HTMLTextAreaElement
    this.ta.style.cssText = 'position:absolute;left:0;top:0;display:none;z-index:6;margin:0;padding:0;border:1px dashed #3b82f6;background:transparent;color:transparent;resize:none;overflow:hidden;white-space:pre-wrap;word-break:break-word;transform-origin:0 0;outline:none;box-sizing:content-box'
    overlay.stage.append(this.ta)
    this.ta.addEventListener('input', () => this.onInput())
    this.ta.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Escape') this.stopEditing()
    })
    this.ta.addEventListener('keyup', (e) => e.stopPropagation())
    this.ta.addEventListener('blur', () => setTimeout(() => !document.activeElement?.closest('.bwf-panel') && this.stopEditing(), 0))
    overlay.addPainter((c) => this.paint(c), 20)
    overlay.addInteractor({ pick: (x, y, e) => this.pick(x, y, e) }, 5)
    app.events.on('view', () => this.placeEditor())
    const hook = (): void => {
      this.flush()
      this.stopEditing()
      app.doc.events.on('layers', () => {
        if (this.editing && !this.cur()) this.stopEditing()
        this.overlay.redraw()
        this.emit()
      })
      app.doc.events.on('commit', (e) => this.onCommit(e))
    }
    hook()
    app.events.on('doc', hook)
    strokeHooks.onBeforeBegin((id) => {
      if (this.isText(id)) this.rasterize(id)
    })
    this.installPersistence()
    this.loadSystemFonts()
  }

  // ------------------------------------------------------------------ state
  onChange(fn: () => void): void {
    this.listeners.add(fn)
  }
  private emit(): void {
    for (const f of this.listeners) f()
  }
  private map(doc = this.app.doc): Map<string, TextData> {
    let m = this.store.get(doc)
    if (!m) this.store.set(doc, (m = new Map()))
    return m
  }
  get(id: string): TextData | undefined {
    return this.map().get(id)
  }
  isText(id: string): boolean {
    return !!this.app.doc.getLayer(id) && this.map().has(id)
  }
  /** text data of the active layer, if it is a text layer */
  cur(): TextData | undefined {
    return this.get(this.app.doc.activeId)
  }
  /** Attach text data to layers of a document (PSD import): they become editable text layers. */
  adopt(doc: Document, data: Record<string, unknown>): void {
    this.setAll(doc, data)
    this.overlay.redraw()
    this.emit()
  }
  setAll(doc: Document, data: Record<string, unknown>): void {
    const m = this.map(doc)
    m.clear()
    for (const [id, raw] of Object.entries(data)) {
      const t = normalizeText(raw)
      if (t && doc.getLayer(id)) {
        m.set(id, t)
        this.lastRect.set(id, 'full')
      }
    }
  }

  // ------------------------------------------------------------------ rendering + history
  private draw(id: string): Rect | null {
    const doc = this.app.doc
    const layer = doc.getLayer(id)
    const t = this.get(id)
    if (!layer) return null
    const inf = !!layer.tiles
    let prev = this.lastRect.get(id) ?? null
    if (inf && prev === 'full') {
      // pixels of unknown extent (loaded document): the layer holds nothing but this text, so drop all of its tiles
      for (const k of [...layer.tiles!.keys()]) layer.tiles!.free(k)
      prev = null
    }
    const full: Rect = { x: 0, y: 0, w: doc.width, h: doc.height }
    const r = t ? renderText(t, doc.width, doc.height, inf) : null
    let u: Rect | null = prev === 'full' ? full : prev
    if (r) {
      const rr: Rect = { x: r.x, y: r.y, w: r.canvas.width, h: r.canvas.height }
      u = u ? union(u, rr) : rr
    }
    if (!u || u.w <= 0 || u.h <= 0) {
      if (inf) doc.events.emit('change', { rect: null })
      return null
    }
    const cv = document.createElement('canvas')
    cv.width = u.w
    cv.height = u.h
    const ctx = cv.getContext('2d', { willReadFrequently: true })!
    if (r) ctx.drawImage(r.canvas, r.x - u.x, r.y - u.y)
    const data = ctx.getImageData(0, 0, u.w, u.h)
    if (inf) putRegionPixels(doc, layer, u, data.data)
    else doc.gpu.uploadRGBA8(layer.pixels, u.x, u.y, u.w, u.h, data.data)
    this.lastRect.set(id, r ? { x: r.x, y: r.y, w: r.canvas.width, h: r.canvas.height } : null)
    doc.events.emit('change', { rect: u })
    return u
  }

  private apply(id: string, snap: Snap, keepPixels = false): void {
    const m = this.map()
    if (snap) m.set(id, cloneText(snap))
    else m.delete(id)
    if (!keepPixels) this.draw(id)
    this.overlay.redraw()
    this.placeEditor()
    this.emit()
  }

  /** Change a text layer live; the history step is recorded shortly after the last change (or on flush). */
  mutate(id: string, fn: (t: TextData) => void): void {
    const t = this.get(id)
    if (!t) return
    if (!this.session || this.session.layerId !== id) {
      this.flush()
      this.session = { layerId: id, before: cloneText(t), timer: 0 }
    }
    fn(t)
    this.draw(id)
    this.overlay.redraw()
    this.placeEditor()
    this.emit()
    window.clearTimeout(this.session.timer)
    this.session.timer = window.setTimeout(() => this.flush(), 700)
  }

  /** Close the running edit session into one undo step. */
  flush(): void {
    const s = this.session
    if (!s) return
    window.clearTimeout(s.timer)
    this.session = null
    const doc = this.app.doc
    const now = this.get(s.layerId)
    const after: Snap = now ? cloneText(now) : null
    if (JSON.stringify(s.before) === JSON.stringify(after)) return
    this.pushHistory(s.layerId, s.before, after, tr('guides.text.editText'))
  }

  private pushHistory(id: string, before: Snap, after: Snap, label: string, keepPixels = false): void {
    const doc = this.app.doc
    doc.pushCommand({
      label,
      layerId: id,
      dirtyRect: null,
      bytes: 2000,
      undo: () => this.apply(id, before, keepPixels),
      redo: () => this.apply(id, after, keepPixels)
    })
    this.self = true
    doc.emitCommit('filter', id, null, label)
    this.self = false
    doc.events.emit('layers', undefined)
  }

  private onCommit(e: { type: string; layerId: string | null }): void {
    if (this.self || !e.layerId) return
    const keep = ['undo', 'redo', 'layer-add', 'layer-props', 'layer-reorder', 'layer-delete', 'layer-duplicate', 'layer-group', 'layer-mask', 'new', 'load', 'selection']
    if (keep.includes(e.type)) return
    if (this.map().has(e.layerId)) {
      // pixels were changed by something else: the layer is now plain pixels
      this.map().delete(e.layerId)
      this.stopEditing()
      this.overlay.redraw()
      this.emit()
    }
  }

  // ------------------------------------------------------------------ actions
  addText(text = tr('guides.text.defaultText')): void {
    const app = this.app
    const doc = app.doc
    this.flush()
    const c = this.overlay.toDoc(this.overlay.w / 2, this.overlay.h / 2)
    const layer = doc.addLayer({ name: tr('guides.text.defaultText') })
    const w = doc.isInfinite ? Math.min((this.overlay.w / app.view.zoom) * 0.8, 600) : Math.min(doc.width * 0.8, 600)
    const t: TextData = { text, style: { ...this.defaults }, spans: [], x: c.x - w / 2, y: c.y - this.defaults.size, w, rot: -app.view.rot }
    this.map().set(layer.id, t)
    this.lastRect.set(layer.id, null)
    this.draw(layer.id)
    this.pushHistory(layer.id, null, cloneText(t), tr('guides.text.addText'))
    this.emit()
    this.startEditing(true)
  }

  rasterize(id = this.app.doc.activeId): void {
    const t = this.get(id)
    if (!t) return
    this.flush()
    this.stopEditing()
    this.map().delete(id)
    this.pushHistory(id, cloneText(t), null, tr('guides.text.rasterizeText'), true)
    this.overlay.redraw()
    this.emit()
    this.app.notify(tr('guides.text.textLayerRasterized'))
  }

  // ------------------------------------------------------------------ editor
  startEditing(selectAll = false): void {
    const t = this.cur()
    if (!t) return
    this.editing = true
    this.ta.style.display = 'block'
    this.ta.value = t.text
    this.placeEditor()
    this.ta.focus()
    if (selectAll) this.ta.select()
    this.overlay.redraw()
    this.emit()
  }

  stopEditing(): void {
    if (!this.editing) return
    this.editing = false
    this.ta.style.display = 'none'
    this.ta.blur()
    this.flush()
    const id = this.app.doc.activeId
    const t = this.get(id)
    if (t && t.text.trim() === '') {
      this.map().delete(id)
      this.app.doc.deleteLayer(id)
    }
    this.overlay.redraw()
    this.emit()
  }

  private onInput(): void {
    const id = this.app.doc.activeId
    const t = this.get(id)
    if (!t) return
    const old = t.text
    this.mutate(id, (d) => {
      d.text = this.ta.value
      d.spans = remapSpans(d.spans, old, d.text)
    })
  }

  selection(): { start: number; end: number } {
    return { start: this.ta.selectionStart, end: this.ta.selectionEnd }
  }

  /** Colour: applies to the selected range while editing, else to the whole text. */
  setColor(hex: string): void {
    const id = this.app.doc.activeId
    const sel = this.selection()
    this.mutate(id, (d) => {
      if (this.editing && sel.end > sel.start) d.spans = paintSpan(d.spans, sel.start, sel.end, hex)
      else {
        d.style.color = hex
        d.spans = []
      }
    })
    this.defaults.color = hex
  }

  setStyle(patch: Partial<TextStyle>): void {
    Object.assign(this.defaults, patch)
    const id = this.app.doc.activeId
    if (this.isText(id)) this.mutate(id, (d) => Object.assign(d.style, patch))
  }

  private placeEditor(): void {
    if (!this.editing) return
    const t = this.cur()
    if (!t) return
    const b = measureBox(t)
    const ta = this.ta
    const v = this.app.view
    const cx = t.x + b.w / 2
    const cy = t.y + b.h / 2
    const cs = this.overlay.toScreen({ x: cx, y: cy })
    const s = t.style
    ta.style.width = b.w + 'px'
    ta.style.height = Math.max(b.h, s.size * s.leading) + 'px'
    ta.style.font = `${s.italic ? 'italic ' : ''}${s.bold ? '700' : '400'} ${s.size}px/${s.size * s.leading}px "${s.family}", sans-serif`
    ta.style.letterSpacing = s.tracking + 'px'
    ta.style.textAlign = s.align === 'justify' ? 'justify' : s.align
    ta.style.textTransform = s.caps === 'upper' ? 'uppercase' : s.caps === 'lower' ? 'lowercase' : 'none'
    ta.style.fontVariantCaps = s.caps === 'small' ? 'small-caps' : 'normal'
    ta.style.writingMode = s.vertical ? 'vertical-rl' : 'horizontal-tb'
    ta.style.caretColor = '#3b82f6'
    ta.style.transform = `translate(${cs.x}px, ${cs.y}px) ${v.mirror ? `scale(${-v.zoom}, ${v.zoom})` : `scale(${v.zoom})`} rotate(${v.rot + t.rot}rad) translate(${-b.w / 2}px, ${-b.h / 2}px)`
    ta.style.borderWidth = 1 / v.zoom + 'px'
  }

  // ------------------------------------------------------------------ overlay: box, handles, drag
  private geom(t: TextData): { c: { x: number; y: number }; w: number; h: number; co: number; si: number } {
    const b = measureBox(t)
    return { c: { x: t.x + b.w / 2, y: t.y + b.h / 2 }, w: b.w, h: b.h, co: Math.cos(t.rot), si: Math.sin(t.rot) }
  }
  private local(g: ReturnType<TextManager['geom']>, u: number, v: number): { x: number; y: number } {
    return { x: g.c.x + u * g.co - v * g.si, y: g.c.y + u * g.si + v * g.co }
  }
  private handles(t: TextData): { id: string; p: { x: number; y: number } }[] {
    const g = this.geom(t)
    const out = [
      { id: 'tl', p: this.local(g, -g.w / 2, -g.h / 2) },
      { id: 'tr', p: this.local(g, g.w / 2, -g.h / 2) },
      { id: 'bl', p: this.local(g, -g.w / 2, g.h / 2) },
      { id: 'br', p: this.local(g, g.w / 2, g.h / 2) }
    ]
    const ro = this.local(g, 0, -g.h / 2 - 34 / Math.max(0.05, this.app.view.zoom))
    out.push({ id: 'rot', p: ro })
    return out
  }

  private paint(c: CanvasRenderingContext2D): void {
    const t = this.cur()
    if (!t) return
    const ov = this.overlay
    const hs = this.handles(t)
    const pts = ['tl', 'tr', 'br', 'bl'].map((id) => ov.toScreen(hs.find((q) => q.id === id)!.p))
    c.beginPath()
    pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)))
    c.closePath()
    c.strokeStyle = '#3b82f6'
    c.lineWidth = 1.5
    c.stroke()
    const rot = ov.toScreen(hs.find((q) => q.id === 'rot')!.p)
    const top = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }
    c.beginPath()
    c.moveTo(top.x, top.y)
    c.lineTo(rot.x, rot.y)
    c.stroke()
    for (const q of hs) {
      const p = ov.toScreen(q.p)
      c.beginPath()
      if (q.id === 'rot') c.arc(p.x, p.y, 8, 0, Math.PI * 2)
      else c.rect(p.x - 6, p.y - 6, 12, 12)
      c.fillStyle = q.id === 'rot' ? '#3b82f6' : '#fff'
      c.fill()
      c.strokeStyle = q.id === 'rot' ? '#fff' : '#3b82f6'
      c.stroke()
    }
  }

  private pick(sx: number, sy: number, e: PointerEvent): DragHandler | null {
    const t = this.cur()
    if (!t) return null
    if (e.target === this.ta) return null
    const app = this.app
    const ov = this.overlay
    const id = app.doc.activeId
    const layer = app.doc.getLayer(id)
    if (!layer || layer.locked) return null
    const vertical = t.style.vertical
    for (const hd of this.handles(t)) {
      const p = ov.toScreen(hd.p)
      if (Math.hypot(p.x - sx, p.y - sy) > 14) continue
      if (vertical && hd.id !== 'rot') continue
      return {
        move: (x, y, ev) => {
          const q = ov.toDoc(x, y)
          this.mutate(id, (d) => {
            const g = this.geom(d)
            if (hd.id === 'rot') {
              let a = Math.atan2(q.y - g.c.y, q.x - g.c.x) + Math.PI / 2
              if (ev.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12)
              d.rot = a
              return
            }
            const left = hd.id[1] === 'l'
            const top = hd.id[0] === 't'
            const u = (q.x - g.c.x) * g.co + (q.y - g.c.y) * g.si
            const newW = Math.max(30, left ? g.w / 2 - u : u + g.w / 2)
            // fixed corner = opposite side, same row
            const fixed = this.local(g, left ? g.w / 2 : -g.w / 2, top ? -g.h / 2 : g.h / 2)
            const nb = measureBox({ ...d, w: newW })
            const c2 = { x: 0, y: 0 }
            const ng = { c: c2, w: newW, h: nb.h, co: g.co, si: g.si }
            // solve centre so the fixed corner stays put
            const off = this.local({ ...ng, c: { x: 0, y: 0 } }, left ? newW / 2 : -newW / 2, top ? -nb.h / 2 : nb.h / 2)
            c2.x = fixed.x - off.x
            c2.y = fixed.y - off.y
            d.w = newW
            d.x = c2.x - newW / 2
            d.y = c2.y - nb.h / 2
          })
        },
        up: () => this.flush()
      }
    }
    // inside the box: drag = move, double-tap = edit
    const doc = ov.toDoc(sx, sy)
    const g = this.geom(t)
    const du = (doc.x - g.c.x) * g.co + (doc.y - g.c.y) * g.si
    const dv = -(doc.x - g.c.x) * g.si + (doc.y - g.c.y) * g.co
    if (Math.abs(du) <= g.w / 2 && Math.abs(dv) <= g.h / 2) {
      const now = performance.now()
      const dbl = now - this.lastTap.t < 380 && Math.hypot(sx - this.lastTap.x, sy - this.lastTap.y) < 12
      this.lastTap = { t: now, x: sx, y: sy }
      if (dbl) {
        this.startEditing()
        return { move: () => void 0 }
      }
      let last = doc
      this.dragMoved = false
      return {
        move: (x, y) => {
          const q = ov.toDoc(x, y)
          const dx = q.x - last.x
          const dy = q.y - last.y
          last = q
          this.dragMoved = true
          this.mutate(id, (d) => {
            d.x += dx
            d.y += dy
          })
        },
        up: () => this.flush()
      }
    }
    if (this.editing) this.stopEditing()
    return null
  }

  // ------------------------------------------------------------------ fonts
  private async loadSystemFonts(): Promise<void> {
    try {
      const q = (window as any).queryLocalFonts as undefined | (() => Promise<{ family: string }[]>)
      if (!q) return
      const list = await q()
      const fam = new Set<string>(FALLBACK_FONTS)
      for (const f of list) fam.add(f.family)
      this.fonts = [...fam].sort((a, b) => a.localeCompare(b))
      this.emit()
    } catch {
      /* permission denied: keep the fallback list */
    }
  }

  async importFont(file: File): Promise<string> {
    const data = new Uint8Array(await file.arrayBuffer())
    const family = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Imported'
    await this.registerFont(family, data, file.name)
    return family
  }

  private async registerFont(family: string, data: Uint8Array, file: string): Promise<void> {
    const ff = new FontFace(family, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)
    await ff.load()
    document.fonts.add(ff)
    this.imported.set(family, { data, file })
    if (!this.fonts.includes(family)) this.fonts = [family, ...this.fonts]
    this.emit()
  }

  // ------------------------------------------------------------------ persistence
  private installPersistence(): void {
    registerBwkExtension({
      id: 'text',
      save: (doc) => {
        this.flush()
        const layers: Record<string, TextData> = {}
        for (const [id, t] of this.map(doc)) if (doc.getLayer(id)) layers[id] = t
        const files: Record<string, Uint8Array> = {}
        const fonts: { family: string; file: string }[] = []
        let n = 0
        for (const [family, f] of this.imported) {
          const path = `fonts/${n++}_${f.file.replace(/[^\w.\-]/g, '_')}`
          files[path] = f.data
          fonts.push({ family, file: path })
        }
        return { extra: { layers, fonts }, files }
      },
      load: async (doc, extra, entries) => {
        const e = (extra ?? {}) as { layers?: Record<string, unknown>; fonts?: { family: string; file: string }[] }
        for (const f of e.fonts ?? []) {
          const data = entries[f.file]
          if (data && !this.imported.has(f.family)) {
            try {
              await this.registerFont(f.family, data, f.file.replace(/^fonts\/\d+_/, ''))
            } catch (err) {
              console.warn('font load failed', f.family, err)
            }
          }
        }
        this.setAll(doc, e.layers ?? {})
      }
    })
  }
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

// ====================================================================== UI
export function installText(app: App, overlay: Overlay): TextManager {
  const tm = new TextManager(app, overlay)
  // fonts dropped into the Gallery's Import
  registerResourceImporter({
    exts: ['ttf', 'otf', 'woff', 'woff2'],
    run: async (bytes, name) => tr('guides.text.importedFont', { name: await tm.importFont(new File([bytes as unknown as BlobPart], name.replace(/^.*[\/]/, ''))) })
  })
  const panel = floatPanel(tk('guides.text.textStyleAa'), 350, { right: 16, top: 60 })
  const b = panel.body
  const cur = (): TextStyle => tm.cur()?.style ?? tm.defaults

  const note = h('div', { class: 'bwf-note' })
  const actions = h(
    'div',
    { class: 'bwf-seg' },
    h('button', { class: 'bwf-btn primary', text: tk('guides.text.addText'), onclick: () => tm.addText() }),
    h('button', { class: 'bwf-btn', text: tk('guides.text.editText'), onclick: () => tm.startEditing() }),
    h('button', { class: 'bwf-btn', text: tk('guides.text.rasterize'), onclick: () => tm.rasterize() })
  )
  b.append(note, actions)

  const updaters: (() => void)[] = []
  const add = <T extends { el: HTMLElement; update(): void }>(w: T): T => (b.append(w.el), updaters.push(w.update), w)

  b.append(h('div', { class: 'bwf-sec', text: tk('guides.text.font') }))
  const search = h('input', { type: 'text', placeholder: tk('guides.text.searchFonts') }) as HTMLInputElement
  const list = h('div', { class: 'bwf-list' })
  const file = h('input', { type: 'file', accept: '.ttf,.otf,.woff,.woff2', style: 'display:none' }) as HTMLInputElement
  b.append(
    h('div', { class: 'bwf-row' }, search, h('button', { class: 'bwf-btn', text: tk('guides.text.importFont'), onclick: () => file.click() })),
    list,
    file
  )
  const renderList = (): void => {
    const q = search.value.toLowerCase()
    list.replaceChildren()
    for (const f of tm.fonts.filter((x) => x.toLowerCase().includes(q)).slice(0, 300)) {
      const it = h('div', { class: 'it' + (f === cur().family ? ' sel' : ''), text: f, style: `font-family:"${f}"`, onclick: () => (tm.setStyle({ family: f }), renderList()) })
      list.append(it)
    }
  }
  search.addEventListener('input', renderList)
  file.addEventListener('change', async () => {
    const f = file.files?.[0]
    file.value = ''
    if (!f) return
    try {
      const fam = await tm.importFont(f)
      tm.setStyle({ family: fam })
      app.notify(tr('guides.text.importedFont', { name: fam }))
    } catch (e) {
      app.notify(tr('guides.text.fontError', { error: (e as Error).message }))
    }
  })

  b.append(h('div', { class: 'bwf-sec', text: tk('guides.text.style') }))
  add(sliderRow(tk('core.common.size'), 6, 800, 1, () => cur().size, (v) => tm.setStyle({ size: v }), (v) => Math.round(v) + 'px'))
  const bi = h(
    'div',
    { class: 'bwf-seg' },
    h('button', { class: 'bwf-btn', text: tk('guides.text.bold'), onclick: () => (tm.setStyle({ bold: !cur().bold }), sync()) }),
    h('button', { class: 'bwf-btn', text: tk('guides.text.italic'), onclick: () => (tm.setStyle({ italic: !cur().italic }), sync()) })
  )
  b.append(bi)
  add(segRow<string>([['none', tk('guides.text.normal')], ['upper', tk('guides.text.upper')], ['lower', tk('guides.text.lower')], ['small', tk('guides.text.smallCaps')]], () => cur().caps, (v) => tm.setStyle({ caps: v as TextStyle['caps'] })))

  b.append(h('div', { class: 'bwf-sec', text: tk('guides.text.design') }))
  const color = h('input', { type: 'color' }) as HTMLInputElement
  color.addEventListener('input', () => tm.setColor(color.value))
  const ocolor = h('input', { type: 'color' }) as HTMLInputElement
  ocolor.addEventListener('input', () => tm.setStyle({ outlineColor: ocolor.value }))
  b.append(h('div', { class: 'bwf-row' }, h('span', { class: 'l', text: tk('guides.panel.colour') }), color, h('span', { class: 'bwf-note', text: tk('guides.text.appliesToSelected') })))
  add(sliderRow(tk('guides.text.outline'), 0, 30, 0.5, () => cur().outlineWidth, (v) => tm.setStyle({ outlineWidth: v }), (v) => v.toFixed(1)))
  b.append(h('div', { class: 'bwf-row' }, h('span', { class: 'l', text: tk('guides.text.outlineCol') }), ocolor))
  add(
    sliderRow(
      tk('core.common.opacity'),
      0,
      100,
      1,
      () => Math.round((app.doc.activeLayer?.opacity ?? 1) * 100),
      (v) => app.doc.setLayerPropsLive(app.doc.activeId, { opacity: v / 100 }),
      (v) => Math.round(v) + '%'
    )
  )

  b.append(h('div', { class: 'bwf-sec', text: tk('guides.text.attributes') }))
  add(toggleRow(tk('guides.text.kerning'), () => cur().kerning, (v) => tm.setStyle({ kerning: v })))
  add(sliderRow(tk('guides.text.tracking'), -20, 100, 0.5, () => cur().tracking, (v) => tm.setStyle({ tracking: v }), (v) => v.toFixed(1)))
  add(sliderRow(tk('guides.text.leading'), 0.6, 3, 0.05, () => cur().leading, (v) => tm.setStyle({ leading: v }), (v) => v.toFixed(2)))
  add(sliderRow(tk('guides.text.baseline'), -200, 200, 1, () => cur().baseline, (v) => tm.setStyle({ baseline: v }), (v) => Math.round(v) + 'px'))
  add(segRow<string>([['left', tk('guides.panel.left')], ['center', tk('guides.text.center')], ['right', tk('guides.panel.right')], ['justify', tk('guides.text.justify')]], () => cur().align, (v) => tm.setStyle({ align: v as TextStyle['align'] })))
  add(segRow<string>([['h', tk('guides.panel.horizontal')], ['v', tk('guides.panel.vertical')]], () => (cur().vertical ? 'v' : 'h'), (v) => tm.setStyle({ vertical: v === 'v' })))
  add(toggleRow(tk('guides.text.underline'), () => cur().underline, (v) => tm.setStyle({ underline: v })))
  add(toggleRow(tk('guides.text.strikethrough'), () => cur().strike, (v) => tm.setStyle({ strike: v })))
  add(toggleRow(tk('guides.text.ligatures'), () => cur().ligatures, (v) => tm.setStyle({ ligatures: v })))

  const sync = (): void => {
    const t = tm.cur()
    tEl(note, t ? 'guides.text.editingTheActiveText' : 'guides.text.selectATextLayer')
    for (const u of updaters) u()
    const s = cur()
    color.value = /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : '#000000'
    ocolor.value = /^#[0-9a-f]{6}$/i.test(s.outlineColor) ? s.outlineColor : '#ffffff'
    ;(bi.children[0] as HTMLElement).classList.toggle('on', s.bold)
    ;(bi.children[1] as HTMLElement).classList.toggle('on', s.italic)
    renderList()
  }
  tm.onChange(() => panel.isOpen && sync())
  const open = panel.open
  panel.open = (): void => {
    open()
    sync()
  }

  // Actions > Add > "Add text" lives in the layers module and calls this hook (single menu entry, no duplicate here)
  layerHooks.addText = (): void => {
    panel.open()
    tm.addText()
  }
  registerMenuItem('actions', { id: 'text-style', label: tk('guides.text.textStyleAa2'), run: () => panel.open() })
  registerMenuItem('actions', { id: 'text-raster', label: tk('guides.text.rasterizeTextLayer'), run: () => tm.rasterize() })
  ;(window as any).brushwork_text = tm
  return tm
}
