import type { App } from '../../app/app'
import { Emitter } from '../../core/events'
import type { Document } from '../../doc/document'
import { Layer } from '../../doc/layer'
import { registerBwkExtension } from '../../io/bwk'
import { FrameRenderer } from '../../io/frameRender'
import { encodeJpegBitmap, encodePngBitmap, flattenOnto } from '../../io/imageFormats'
import { buildPdf } from '../../io/pdf'
import { h } from '../../ui/dom'
import { t, tAttr, tk } from '../../i18n'

const tip = <E extends HTMLElement>(el: E, key: string): E => tAttr(el, 'title', key)
import { registerMenuItem } from '../../ui/registry'
import type { UIContext } from '../../ui/registry'
import { animioApi } from './api'
import { docMeta } from './docMeta'
import { ThumbMaker } from './thumbs'
import { btn, ensureStyles, modal, select } from './ui'

interface PageState {
  enabled: boolean
  current: number
  background: string[]
  foreground: string[]
}
const states = new WeakMap<Document, PageState>()
const pageState = (d: Document): PageState => {
  let s = states.get(d)
  if (!s) states.set(d, (s = { enabled: false, current: 0, background: [], foreground: [] }))
  return s
}
registerBwkExtension({
  id: 'animio.pages',
  save: (doc) => ({ extra: pageState(doc) }),
  load: (doc, extra) => {
    const e = (extra ?? {}) as Partial<PageState>
    const ids = new Set(doc.layers.map((l) => l.id))
    states.set(doc, { enabled: !!e.enabled, current: Number(e.current) || 0, background: (e.background ?? []).filter((i) => ids.has(i)), foreground: (e.foreground ?? []).filter((i) => ids.has(i)) })
  }
})

/** Page Assist: every root layer/group is a page; only the current page (+ background/foreground pages) is shown. */
export class PageAssist {
  readonly events = new Emitter<{ change: void }>()
  private fr: FrameRenderer | null = null
  private suppress = false
  private offs: (() => void)[] = []

  constructor(private app: App) {
    app.events.on('doc', () => this.bind())
    this.bind()
  }
  get doc(): Document {
    return this.app.doc
  }
  get state(): PageState {
    return pageState(this.doc)
  }
  get enabled(): boolean {
    return this.state.enabled
  }
  renderer(): FrameRenderer {
    return (this.fr ??= new FrameRenderer(this.app.gpu, this.doc))
  }
  private bind(): void {
    this.offs.forEach((o) => o())
    this.fr?.dispose()
    this.fr = null
    this.offs = [
      this.doc.events.on('layers', () => {
        if (!this.suppress && this.enabled) this.syncFromActive()
        this.events.emit('change', undefined)
      })
    ]
    this.apply()
    this.events.emit('change', undefined)
  }
  pages(): Layer[] {
    const s = this.state
    return this.doc.childrenOf(null).filter((l) => !s.background.includes(l.id) && !s.foreground.includes(l.id))
  }
  backgrounds(): Layer[] {
    return this.state.background.map((i) => this.doc.getLayer(i)).filter((l): l is Layer => !!l)
  }
  foregrounds(): Layer[] {
    return this.state.foreground.map((i) => this.doc.getLayer(i)).filter((l): l is Layer => !!l)
  }
  get current(): number {
    return Math.max(0, Math.min(this.pages().length - 1, this.state.current))
  }
  /** layers composited for page i */
  stackFor(i: number): Layer[] {
    const p = this.pages()[i]
    return [...this.backgrounds(), ...(p ? [p] : []), ...this.foregrounds()]
  }
  private apply(): void {
    this.app.compositor.rootProvider = this.state.enabled ? (roots) => (this.pages().length ? this.stackFor(this.current) : roots) : null
    this.doc.events.emit('change', { rect: null })
  }
  setEnabled(on: boolean): void {
    this.state.enabled = on
    if (on) this.syncFromActive()
    this.apply()
    this.events.emit('change', undefined)
  }
  private syncFromActive(): void {
    let l: Layer | undefined = this.doc.getLayer(this.doc.activeId)
    let g = 0
    while (l?.parentId && g++ < 64) l = this.doc.getLayer(l.parentId)
    const i = l ? this.pages().findIndex((p) => p.id === l!.id) : -1
    if (i >= 0) this.state.current = i
  }
  goto(i: number): void {
    const ps = this.pages()
    if (!ps.length) return
    i = Math.max(0, Math.min(ps.length - 1, i))
    this.state.current = i
    const p = ps[i]
    const kids = p.isGroup ? this.doc.descendantsOf(p.id).filter((l) => !l.isGroup) : []
    this.suppress = true
    this.doc.setActive((p.isGroup ? (kids[kids.length - 1] ?? p) : p).id)
    this.suppress = false
    this.apply()
    this.events.emit('change', undefined)
  }
  addPage(): void {
    const cur = this.pages()[this.current]
    const l = this.doc.createLayer({ name: t('core.doc.pageN', { n: this.pages().length + 1 }) })
    this.doc.insertLayer(l, cur ? { id: cur.id, where: 'above' } : null, 'Add page')
    this.goto(this.pages().findIndex((p) => p.id === l.id))
  }
  duplicatePage(): void {
    const cur = this.pages()[this.current]
    const d = cur && this.doc.duplicateLayer(cur.id)
    if (d) this.goto(this.pages().findIndex((p) => p.id === d.id))
  }
  deletePage(): void {
    const cur = this.pages()[this.current]
    if (!cur) return
    this.doc.deleteLayer(cur.id)
    this.goto(Math.min(this.current, this.pages().length - 1))
  }
  setRole(id: string, role: 'none' | 'bg' | 'fg'): void {
    const s = this.state
    s.background = s.background.filter((x) => x !== id)
    s.foreground = s.foreground.filter((x) => x !== id)
    if (role === 'bg') s.background.push(id)
    if (role === 'fg') s.foreground.push(id)
    this.goto(this.current)
  }
  movePage(fromId: string, toId: string): void {
    const fr = this.doc.childrenOf(null)
    const a = fr.findIndex((l) => l.id === fromId)
    const b = fr.findIndex((l) => l.id === toId)
    if (a < 0 || b < 0 || a === b) return
    this.doc.moveLayerRelative(fromId, toId, a < b ? 'above' : 'below')
    this.goto(this.pages().findIndex((p) => p.id === fromId))
  }
}

// ------------------------------------------------------------------ export
export type PdfQuality = 'best' | 'web'

export interface PageSource {
  pages(): Layer[]
  stackFor(i: number): Layer[]
  renderer(): FrameRenderer
}

export async function exportPagesPdf(app: App, pa: PageSource, quality: PdfQuality): Promise<Uint8Array> {
  const doc = app.doc
  const paper = doc.background.visible ? doc.background.color : ([1, 1, 1] as [number, number, number])
  const pages = []
  const n = Math.max(1, pa.pages().length)
  for (let i = 0; i < n; i++) {
    const roots = pa.pages().length ? pa.stackFor(i) : doc.childrenOf(null)
    const bmp = pa.renderer().bitmap(roots, { paper })
    if (quality === 'best') pages.push({ image: await encodePngBitmap(bmp), format: 'png' as const, width: bmp.width, height: bmp.height })
    else pages.push({ image: await encodeJpegBitmap(flattenOnto(bmp), 0.7), format: 'jpeg' as const, width: bmp.width, height: bmp.height })
  }
  const meta = docMeta(doc)
  return buildPdf(pages, meta.dpi, { title: doc.name, author: meta.author })
}

// ------------------------------------------------------------------ UI
export function installPagesUi(app: App, ui: UIContext, hooks: { onEnable?: () => void } = {}): PageAssist {
  ensureStyles()
  const pa = new PageAssist(app)
  const thumbs = new ThumbMaker(app, () => pa.renderer())
  const strip = h('div', { class: 'an-strip', style: 'display:none' })
  document.body.append(strip)
  let timer = 0
  const canv: [string, HTMLCanvasElement][] = []
  let dragId: string | null = null

  const paint = (): void => {
    for (const [id, cv] of canv) {
      const l = app.doc.getLayer(id)
      if (l) thumbs.draw(cv, [l])
    }
  }
  const later = (): void => {
    clearTimeout(timer)
    timer = window.setTimeout(paint, 200)
  }
  const rebuild = (): void => {
    if (!pa.enabled) {
      strip.style.display = 'none'
      return
    }
    strip.style.display = 'flex'
    strip.replaceChildren()
    canv.length = 0
    const pages = pa.pages()
    const list = h('div', { class: 'an-frames' })
    const mk = (l: Layer, idx: number | null, tag: string): HTMLElement => {
      const cv = h('canvas', { style: 'width:100%;height:100%;object-fit:contain;pointer-events:none' })
      canv.push([l.id, cv])
      const el = h('div', { class: 'an-frame' + (idx === pa.current ? ' sel' : ''), draggable: true, 'data-tag': tag === 'bg' ? 'BG' : tag === 'fg' ? 'FG' : '' }, cv, h('span', { class: 'n', text: idx !== null ? String(idx + 1) : l.name }))
      if (tag) el.classList.add(tag)
      el.addEventListener('click', () => (idx !== null ? pa.goto(idx) : app.doc.setActive(l.id)))
      el.addEventListener('dragstart', () => (dragId = l.id))
      el.addEventListener('dragover', (e) => e.preventDefault())
      el.addEventListener('drop', (e) => {
        e.preventDefault()
        if (dragId && dragId !== l.id) pa.movePage(dragId, l.id)
        dragId = null
      })
      return el
    }
    pa.backgrounds().forEach((l) => list.append(mk(l, null, 'bg')))
    pages.forEach((l, i) => list.append(mk(l, i, '')))
    pa.foregrounds().forEach((l) => list.append(mk(l, null, 'fg')))
    list.append(h('button', { class: 'an-frame', style: 'display:grid;place-items:center;font-size:26px;background:var(--panel2)', title: tk('animio.page.add'), onclick: () => pa.addPage(), icon: 'plus', iconSize: 26 }))
    const cur = pages[pa.current]
    strip.append(
      h('div', { class: 'an-row' }, h('b', { text: tk('animio.page.title') }), h('span', { class: 'lbl', text: tk('animio.page.pageOf', { n: pa.current + 1, total: pages.length }) }), btn(tk('animio.page.prev'), () => pa.goto(pa.current - 1), 'small'), btn(tk('core.common.next'), () => pa.goto(pa.current + 1), 'small'), btn(tk('core.common.duplicate'), () => pa.duplicatePage(), 'small'), btn(tk('core.common.delete'), () => pa.deletePage(), 'small'), cur ? tip(btn(tk('animio.page.bgPage'), () => pa.setRole(cur.id, 'bg'), 'small'), 'animio.page.bgTip') : null, cur ? tip(btn(tk('animio.page.fgPage'), () => pa.setRole(cur.id, 'fg'), 'small'), 'animio.page.fgTip') : null, ...[...pa.backgrounds(), ...pa.foregrounds()].map((l) => btn(tk('animio.anim.restore', { name: l.name }), () => pa.setRole(l.id, 'none'), 'small')), btn(tk('animio.page.exportPdfEllipsis'), () => openPdfDialog(app, ui, pa), 'small'), btn(tk('core.common.close'), () => pa.setEnabled(false), 'small')),
      list
    )
    later()
  }
  pa.events.on('change', () => {
    rebuild()
    refreshMenu()
  })
  const rebind = (): void => {
    app.doc.events.on('commit', () => pa.enabled && later())
    setTimeout(rebuild, 0)
  }
  app.events.on('doc', rebind)
  app.doc.events.on('commit', () => pa.enabled && later())

  const refreshMenu = (): void =>
    registerMenuItem('actions', {
      id: 'canvas-page',
      group: 'canvas',
      label: pa.enabled ? tk('animio.menu.page.on') : tk('animio.menu.page.off'),
      run: () => {
        if (!pa.enabled) hooks.onEnable?.()
        pa.setEnabled(!pa.enabled)
      }
    })
  refreshMenu()
  registerMenuItem('actions', { id: 'share-pdf', group: 'share', label: tk('animio.menu.sharePdf'), run: () => openPdfDialog(app, ui, pa) })
  registerMenuItem('actions', { id: 'share-pages-img', group: 'share', label: tk('animio.menu.sharePagesPng'), run: () => void exportPagesImages(app, ui, pa) })
  return pa
}

function openPdfDialog(app: App, ui: UIContext, pa: PageAssist): void {
  const m = modal(tk('animio.page.pdf.title'))
  let q: PdfQuality = 'best'
  m.body.append(
    h('div', { class: 'an-grid' }, h('label', { text: tk('animio.page.pdf.quality') }), select<PdfQuality>([['best', tk('animio.page.pdf.best')], ['web', tk('animio.page.pdf.web')]], q, (v) => (q = v))),
    h('p', { class: 'an-note', text: pa.enabled ? tk('animio.page.pdf.noteOn') : tk('animio.page.pdf.noteOff') }),
    h('p', { class: 'an-note', text: tk('animio.page.pdf.dpi', { dpi: docMeta(app.doc).dpi }) })
  )
  const status = h('p', { class: 'an-note' })
  let statusFn: (() => string) | null = null
  const setStatus = (fn: () => string): void => {
    statusFn = fn
    status.textContent = fn()
  }
  m.onLang(() => statusFn && (status.textContent = statusFn()))
  m.body.append(status)
  m.footer.append(
    btn(tk('core.common.close'), () => m.close()),
    btn(tk('animio.common.exportEllipsis'), async () => {
      setStatus(() => t('animio.page.pdf.rendering'))
      try {
        const data = await exportPagesPdf(app, pa.enabled ? pa : new PageAssistStub(app, pa), q)
        const path = await window.brushwork!.saveFile({ defaultName: app.doc.name + '.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }], data })
        setStatus(() => (path ? t('animio.common.savedTo', { path }) : t('animio.common.cancelled')))
        if (path) ui.toast(t('animio.page.pdf.done'))
      } catch (e) {
        setStatus(() => t('animio.common.failed', { error: (e as Error).message }))
      }
    }, 'primary')
  )
}

/** When Page Assist is off, a PDF is one page: the real document composite. */
class PageAssistStub {
  constructor(
    private app: App,
    private real: PageAssist
  ) {}
  pages(): Layer[] {
    return []
  }
  stackFor(): Layer[] {
    return this.app.doc.childrenOf(null)
  }
  renderer(): FrameRenderer {
    return this.real.renderer()
  }
}

async function exportPagesImages(app: App, ui: UIContext, pa: PageAssist): Promise<void> {
  const dir = await animioApi().ff.pickDir(t('animio.page.pickFolder'))
  if (!dir) return
  const paper = app.doc.background.visible ? app.doc.background.color : null
  const n = pa.pages().length
  const files: { name: string; data: Uint8Array }[] = []
  for (let i = 0; i < n; i++) files.push({ name: `${app.doc.name}-page-${String(i + 1).padStart(3, '0')}.png`, data: await encodePngBitmap(pa.renderer().bitmap(pa.stackFor(i), { paper })) })
  await animioApi().writeFiles(dir, files)
  ui.toast(t('animio.page.exported', { count: files.length }))
}
