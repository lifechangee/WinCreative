import type { App } from '../../app/app'
import { h } from '../../ui/dom'
import { getLang, onLangChange, t, tk } from '../../i18n'
import { menuEvents, registerTopTab, setTopTabActive } from '../../ui/registry'
import type { UIContext } from '../../ui/registry'
import { TlEditorCore } from './tlEditorCore'
import { getRecorder } from './timelapse'
import { ensureStyles, fx } from './ui'
import {
  SEG_SPEED_MAX,
  SEG_SPEED_MIN,
  SPEED_MAX,
  SPEED_MIN,
  TlEdit,
  addPause,
  applySegment,
  fadeAlpha,
  formatClock,
  itemAt,
  parseDuration,
  removePause,
  removeSegment,
  resizeSegment,
  setSegmentSpeed,
  sliderToSpeed,
  speedToSlider,
  splitSegment,
  timeOfSource,
  updatePause
} from './tlModel'
import { openExportDialog } from './tlExportUi'
import { CompareView } from './tlCompare'
import { copyEditBetweenVariants } from './tlVariants'
import './tlEditor.css'

/** Time-lapse editor: a full-window mode (top-bar tab) with preview, inspector and a zoomable timeline. */

const RULER_H = 24
const THUMB_H = 54
const SEG_H = 30
const PAUSE_H = 32
const TL_H = RULER_H + THUMB_H + SEG_H + PAUSE_H
const MAX_PPF = 48
const THUMB_SLOT = 64

/** Pointer capture keeps a drag alive outside the element; synthetic / already-released pointers just skip it. */
const capture = (el: Element, id: number): void => {
  try {
    el.setPointerCapture(id)
  } catch {
    /* pointer already gone */
  }
}
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x))

const svg = (d: string, size = 20): SVGElement => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  s.setAttribute('viewBox', '0 0 24 24')
  s.setAttribute('width', String(size))
  s.setAttribute('height', String(size))
  s.setAttribute('fill', 'none')
  s.setAttribute('stroke', 'currentColor')
  s.setAttribute('stroke-width', '2')
  s.setAttribute('stroke-linecap', 'round')
  s.setAttribute('stroke-linejoin', 'round')
  s.innerHTML = d
  return s
}
const ICON = {
  play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="3.2"/>',
  prev: '<path d="M15 5 8 12l7 7"/>',
  next: '<path d="m9 5 7 7-7 7"/>',
  start: '<path d="M6 5v14"/><path d="M18 5 10 12l8 7z" fill="currentColor"/>',
  end: '<path d="M18 5v14"/><path d="m6 5 8 7-8 7z" fill="currentColor"/>',
  loop: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
  back: '<path d="M19 12H5"/><path d="m11 18-6-6 6-6"/>',
  zoomIn: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.2-4.2M11 8v6M8 11h6"/>',
  zoomOut: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.2-4.2M8 11h6"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  pausebar: '<path d="M9 5v14M15 5v14" stroke-width="3"/>',
  split: '<path d="M12 3v18"/><path d="M8 8 4 12l4 4M16 8l4 4-4 4"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m6 6 1 14h10l1-14"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>'
}

// ------------------------------------------------------------------ small UI builders
const parseNum = (s: string): number | null => {
  const v = Number(s.trim().replace(',', '.'))
  return s.trim() && Number.isFinite(v) ? v : null
}
const fmtNum = (v: number, dec: number): string => {
  const s = String(Number(v.toFixed(dec)))
  return getLang() === 'ru' ? s.replace('.', ',') : s
}

interface NumField {
  el: HTMLInputElement
  sync(): void
}
function numField(o: { get(): number; set(v: number): void; min: number; max: number; step: number; dec: number; parse?: (s: string) => number | null; format?: (v: number) => string; label?: string }): NumField {
  const el = h('input', { type: 'text', class: 'tle-num', inputMode: 'decimal', autocomplete: 'off', spellcheck: false })
  const show = (): void => void (el.value = o.format ? o.format(o.get()) : fmtNum(o.get(), o.dec))
  el.addEventListener('change', () => {
    const v = (o.parse ?? parseNum)(el.value)
    if (v === null || !Number.isFinite(v)) return show()
    o.set(clamp(v, o.min, o.max))
    show()
  })
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') el.blur()
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const cur = (o.parse ?? parseNum)(el.value) ?? o.get()
      o.set(clamp(Number((cur + (e.key === 'ArrowUp' ? 1 : -1) * o.step * (e.shiftKey ? 10 : 1)).toFixed(4)), o.min, o.max))
      show()
    } else if (e.key === 'Escape') {
      show()
      el.blur()
      e.stopPropagation()
    }
  })
  el.addEventListener('focus', () => el.select())
  return { el, sync: () => void (document.activeElement !== el && show()) }
}

const card = (title: ReturnType<typeof tk>, ...kids: (Node | null)[]): HTMLElement => h('section', { class: 'tle-card' }, h('h4', { text: title }), ...kids)
const row = (label: ReturnType<typeof tk>, ...kids: (Node | null)[]): HTMLElement => h('div', { class: 'tle-row' }, h('label', { text: label }), ...kids)
const tbtn = (icon: string, title: ReturnType<typeof tk>, onclick: () => void, cls = ''): HTMLButtonElement => {
  const b = h('button', { class: 'tle-btn tle-icon ' + cls, title, ariaLabel: title })
  b.append(svg(icon, 20))
  b.addEventListener('click', onclick)
  return b
}
const wbtn = (label: ReturnType<typeof tk>, onclick: () => void, cls = ''): HTMLButtonElement => h('button', { class: 'tle-btn ' + cls, text: label, onclick })

const bandColor = (speed: number): string => {
  // slow = cool blue, fast = warm orange / red
  const l = Math.log2(speed)
  const hue = l >= 0 ? 38 - Math.min(l, 4) * 8.5 : 205 + Math.max(l, -3) * -3
  return `hsl(${hue.toFixed(0)} 70% 48%)`
}

type Sel = { kind: 'seg'; id: number } | { kind: 'pause'; id: number } | { kind: 'range'; from: number; to: number } | null

// ------------------------------------------------------------------ the editor
class Editor {
  readonly core: TlEditorCore
  readonly root: HTMLElement
  private closed = false
  private offs: (() => void)[] = []

  // preview
  private canvas = h('canvas', { class: 'tle-canvas', width: 640, height: 360 })
  private ctx = this.canvas.getContext('2d')!
  private fade = h('div', { class: 'tle-fade' })
  private shownRaw = -1
  private wantRaw = -1
  private pumping = false
  private time = 0
  private playing = false
  private rate = 1
  private loop = false
  private lastTick = 0
  private playBtn!: HTMLButtonElement
  private loopBtn!: HTMLButtonElement
  private timeLbl = h('span', { class: 'tle-time' })
  private frameLbl = h('span', { class: 'tle-dim' })
  private rateLbl = h('span', { class: 'tle-rate' })

  // timeline
  private ppf = 4
  private scroll = h('div', { class: 'tle-scroll' })
  private inner = h('div', { class: 'tle-inner' })
  private cv = h('canvas', { class: 'tle-cv' })
  private cx = this.cv.getContext('2d')!
  private playhead = h('div', { class: 'tle-ph' }, h('i'))
  private rangeEl = h('div', { class: 'tle-range' })
  private bandEls = new Map<number, HTMLElement>()
  private pauseEls = new Map<number, HTMLElement>()
  private drawQueued = false
  private cvW = 0
  private zoomSlider!: HTMLInputElement
  private fitPpf = 1
  private userZoomed = false
  private sel: Sel = null
  private pauseLen = 1
  private lastTap = { t: 0, x: 0, y: 0 }

  // inspector
  private syncers: (() => void)[] = []
  private hideChk!: HTMLInputElement
  private hideNote = h('p', { class: 'tle-note' })
  private bd: Record<string, HTMLElement> = {}
  private speedSlider!: HTMLInputElement
  private fitChk!: HTMLInputElement
  private fitWarn = h('p', { class: 'tle-warn' })
  private selNone = h('p', { class: 'tle-note', text: tk('animio.tle.sel.none') })
  private selRange = h('div', { class: 'tle-selform' })
  private selSeg = h('div', { class: 'tle-selform' })
  private selPause = h('div', { class: 'tle-selform' })
  private rangeLbl = h('div', { class: 'tle-dim' })
  private undoBtn!: HTMLButtonElement
  private redoBtn!: HTMLButtonElement
  private pauseSummary = h('p', { class: 'tle-note' })
  private rangeSpeed = 4

  constructor(
    private app: App,
    private ui: UIContext,
    core: TlEditorCore,
    private onClose: () => void
  ) {
    this.core = core
    this.root = h('div', { class: 'tle', role: 'dialog' })
    this.build()
  }

  // ---------------------------------------------------------------- build
  private build(): void {
    const core = this.core
    // header
    this.undoBtn = tbtn(ICON.undo, tk('animio.tle.undo'), () => core.undo())
    this.redoBtn = tbtn(ICON.redo, tk('animio.tle.redo'), () => core.redo())
    const head = h(
      'header',
      { class: 'tle-head' },
      h('button', { class: 'tle-btn tle-back', onclick: () => this.onClose() }, svg(ICON.back, 18), h('span', { text: tk('animio.tle.back') })),
      h('div', { class: 'tle-title' }, svg(ICON.film, 18), h('span', { text: tk('animio.tle.title') })),
      h('div', { class: 'tle-spacer' }),
      ...(this.core.rec.variants.length > 1 ? [wbtn(tk('langs.cmp.open'), () => void this.openCompare())] : []),
      this.undoBtn,
      this.redoBtn,
      wbtn(tk('animio.tle.reset'), () => core.reset()),
      wbtn(tk('animio.tle.export'), () => this.exportNow(), 'primary')
    )

    // preview + transport
    this.canvas.style.cssText = ''
    const preview = h('div', { class: 'tle-preview' }, h('div', { class: 'tle-frame' }, this.canvas, this.fade))
    this.playBtn = tbtn(ICON.play, tk('animio.tle.play'), () => this.togglePlay(), 'tle-play')
    this.loopBtn = tbtn(ICON.loop, tk('animio.tle.loop'), () => {
      this.loop = !this.loop
      this.loopBtn.classList.toggle('on', this.loop)
    })
    const transport = h(
      'div',
      { class: 'tle-transport' },
      tbtn(ICON.start, tk('animio.tle.toStart'), () => this.setTime(0)),
      tbtn(ICON.prev, tk('animio.tle.stepBack'), () => this.step(-1)),
      this.playBtn,
      tbtn(ICON.next, tk('animio.tle.stepFwd'), () => this.step(1)),
      tbtn(ICON.end, tk('animio.tle.toEnd'), () => this.setTime(core.schedule.total)),
      this.loopBtn,
      h('div', { class: 'tle-readout' }, this.timeLbl, this.frameLbl),
      this.rateLbl,
      h('div', { class: 'tle-spacer' }),
      h('span', { class: 'tle-keys', text: tk('animio.tle.keys') })
    )
    const stage = h('section', { class: 'tle-stage' }, preview, transport)

    // inspector
    const side = h('aside', { class: 'tle-side' }, ...this.buildSide())

    // timeline
    const tl = this.buildTimeline()

    this.root.append(head, h('div', { class: 'tle-main' }, stage, side), tl)
  }

  private buildSide(): HTMLElement[] {
    const core = this.core
    const edit = (): TlEdit => core.edit
    // --- selection card (top: the thing being worked on)
    const rangeSpeed = numField({ get: () => this.rangeSpeed, set: (v) => (this.rangeSpeed = v), min: SEG_SPEED_MIN, max: SEG_SPEED_MAX, step: 0.5, dec: 2 })
    this.selRange.append(
      this.rangeLbl,
      row(tk('animio.tle.sel.speed'), rangeSpeed.el),
      h('div', { class: 'tle-chips' }, ...[0.25, 0.5, 2, 4, 8].map((v) => h('button', { class: 'tle-chip', text: '×' + v, onclick: () => ((this.rangeSpeed = v), rangeSpeed.sync()) }))),
      h('div', { class: 'tle-btns' }, wbtn(tk('animio.tle.sel.apply'), () => this.applyRange(), 'primary'), wbtn(tk('animio.tle.sel.clear'), () => this.select(null)))
    )
    this.syncers.push(rangeSpeed.sync)
    const segSpeed = numField({
      get: () => this.segOf()?.speed ?? 1,
      set: (v) => {
        const s = this.segOf()
        if (s) core.commit(setSegmentSpeed(edit(), s.id, v))
      },
      min: SEG_SPEED_MIN,
      max: SEG_SPEED_MAX,
      step: 0.5,
      dec: 2
    })
    this.syncers.push(segSpeed.sync)
    this.selSeg.append(
      h('div', { class: 'tle-dim', text: tk('animio.tle.seg.title') }),
      row(tk('animio.tle.sel.speed'), segSpeed.el),
      h('div', { class: 'tle-btns' }, wbtn(tk('animio.tle.seg.split'), () => this.splitAtPlayhead()), wbtn(tk('animio.tle.seg.remove'), () => this.deleteSel()))
    )
    const pauseSec = numField({
      get: () => this.pauseOf()?.seconds ?? 1,
      set: (v) => {
        const p = this.pauseOf()
        if (p) core.commit(updatePause(edit(), p.id, { seconds: v }))
      },
      min: 0.05,
      max: 3600,
      step: 0.1,
      dec: 2
    })
    this.syncers.push(pauseSec.sync)
    this.selPause.append(h('div', { class: 'tle-dim', text: tk('animio.tle.pause.title') }), row(tk('animio.tle.pause.duration'), pauseSec.el), h('div', { class: 'tle-btns' }, wbtn(tk('animio.tle.pause.remove'), () => this.deleteSel())))
    const selCard = card(tk('animio.tle.sel.title'), this.selNone, this.selRange, this.selSeg, this.selPause)

    // --- hide undone
    this.hideChk = h('input', { type: 'checkbox' })
    this.hideChk.addEventListener('change', () => core.commit({ ...edit(), hideUndone: this.hideChk.checked }))
    const hideCard = card(tk('animio.tle.hide.title'), h('label', { class: 'tle-switch' }, this.hideChk, h('span', { text: tk('animio.tle.hide.toggle') })), this.hideNote)

    // --- speed
    const speed = numField({
      get: () => this.effSpeed(),
      set: (v) => core.commit({ ...edit(), globalSpeed: v, fitDuration: null }),
      min: SPEED_MIN,
      max: SPEED_MAX,
      step: 0.1,
      dec: 2,
      format: (v) => fmtNum(v, v < 10 ? 2 : v < 100 ? 1 : 0) + '×'
    })
    this.syncers.push(speed.sync)
    this.speedSlider = h('input', { type: 'range', min: '0', max: '1000', step: '1' })
    this.speedSlider.addEventListener('input', () => {
      const v = sliderToSpeed(Number(this.speedSlider.value) / 1000)
      core.live({ ...edit(), globalSpeed: v, fitDuration: null })
      speed.sync()
    })
    this.speedSlider.addEventListener('change', () => core.end())
    // --- fit
    this.fitChk = h('input', { type: 'checkbox' })
    this.fitChk.addEventListener('change', () => {
      const e = edit()
      core.commit({ ...e, fitDuration: this.fitChk.checked ? (e.fitDuration ?? Math.max(1, Math.round(core.schedule.total))) : null, globalSpeed: this.fitChk.checked ? e.globalSpeed : Number(core.schedule.speed.toFixed(4)) })
    })
    const fit = numField({
      get: () => edit().fitDuration ?? core.schedule.total,
      set: (v) => core.commit({ ...edit(), fitDuration: v }),
      min: 0.5,
      max: 86400,
      step: 1,
      dec: 1,
      parse: parseDuration,
      format: (v) => formatClock(v, v % 1 ? 1 : 0)
    })
    this.syncers.push(fit.sync)
    const presets = h('div', { class: 'tle-chips' }, ...([[15, tk('animio.tle.fit.p15')], [30, tk('animio.tle.fit.p30')], [60, tk('animio.tle.fit.p60')]] as [number, ReturnType<typeof tk>][]).map(([s, lbl]) => h('button', { class: 'tle-chip', text: lbl, onclick: () => core.commit({ ...edit(), fitDuration: s }) })))
    const speedCard = card(
      tk('animio.tle.speed.title'),
      row(tk('animio.tle.speed.global'), speed.el),
      this.speedSlider,
      h('label', { class: 'tle-switch' }, this.fitChk, h('span', { text: tk('animio.tle.fit.toggle') })),
      row(tk('animio.tle.fit.length'), fit.el),
      presets,
      this.fitWarn,
      h('p', { class: 'tle-note', text: tk('animio.tle.fit.hint') }),
      this.breakdown()
    )

    // --- pauses
    const pLen = numField({ get: () => this.pauseLen, set: (v) => (this.pauseLen = v), min: 0.05, max: 3600, step: 0.1, dec: 2 })
    this.syncers.push(pLen.sync)
    const pauseCard = card(tk('animio.tle.pauses.title'), row(tk('animio.tle.pauses.length'), pLen.el), wbtn(tk('animio.tle.pauses.add'), () => this.addPauseAtPlayhead(), 'primary'), this.pauseSummary, h('p', { class: 'tle-note', text: tk('animio.tle.pauses.hint') }))

    // --- finale
    const fin = (k: 'holdSeconds' | 'fadeIn' | 'fadeOut', max: number): NumField => {
      const f = numField({ get: () => edit().finale[k], set: (v) => core.commit({ ...edit(), finale: { ...edit().finale, [k]: v } }), min: 0, max, step: 0.5, dec: 2 })
      this.syncers.push(f.sync)
      return f
    }
    const finale = card(tk('animio.tle.finale.title'), row(tk('animio.tle.finale.hold'), fin('holdSeconds', 600).el), row(tk('animio.tle.finale.fadeIn'), fin('fadeIn', 60).el), row(tk('animio.tle.finale.fadeOut'), fin('fadeOut', 60).el))

    const out = [selCard, hideCard, speedCard, pauseCard, finale]
    const rec = core.rec
    if (rec.variants.length) out.unshift(this.variantCard())
    return out
  }

  // ---------------------------------------------------------------- language variants
  private variantBtns = new Map<string, HTMLButtonElement>()
  private cmp: CompareView | null = null

  private variantCard(): HTMLElement {
    const core = this.core
    const rec = core.rec
    const langs = this.app.doc.langs.filter((l) => rec.variants.includes(l.code))
    const seg = h('div', { class: 'tle-seg', role: 'group' })
    for (const l of langs) {
      const b = h('button', { class: 'tle-seg-btn', text: l.code.toUpperCase(), title: l.name, 'data-lang': l.code, onclick: () => core.setVariant(l.code) })
      this.variantBtns.set(l.code, b)
      seg.append(b)
    }
    const copies = h('div', { class: 'tle-btns' })
    for (const l of langs) {
      const b = h('button', { class: 'tle-btn', text: t('langs.tl.copyFrom', { name: l.name }), 'data-from': l.code })
      b.addEventListener('click', () => {
        const cur = rec.variantKey
        if (!cur || cur === l.code) return
        core.commit(copyEditBetweenVariants(rec.editFor(l.code), core.edit, core.tags, l.code, cur))
      })
      this.syncers.push(() => {
        b.textContent = t('langs.tl.copyFrom', { name: l.name })
        b.style.display = rec.variantKey === l.code ? 'none' : ''
      })
      copies.append(b)
    }
    this.syncers.push(() => {
      for (const [c, b] of this.variantBtns) b.classList.toggle('on', c === rec.variantKey)
    })
    const late = h('p', { class: 'tle-warn' })
    this.syncers.push(() => {
      const v = rec.variantKey
      const lg = v ? this.app.doc.langs.find((x) => x.code === v) : undefined
      late.style.display = v && lg && rec.lateLangs[v] !== undefined ? '' : 'none'
      if (lg) late.textContent = t('langs.tl.late', { name: lg.name })
    })
    return card(tk('langs.tl.title'), seg, h('p', { class: 'tle-note', text: tk('langs.tl.note') }), late, copies)
  }

  private async openCompare(): Promise<void> {
    if (this.cmp) return
    this.pause()
    const cv = new CompareView(this.app, this.core.rec, () => this.closeCompare())
    await cv.load()
    this.cmp = cv
    this.root.classList.add('cmp')
    this.root.insertBefore(cv.el, this.root.querySelector('.tle-main'))
  }
  private closeCompare(): void {
    this.cmp?.dispose()
    this.cmp = null
    this.root.classList.remove('cmp')
    this.queueDraw()
  }
  /** QA / selftest handle */
  compare(): CompareView | null {
    return this.cmp
  }
  async openCompareForTest(): Promise<CompareView | null> {
    await this.openCompare()
    return this.cmp
  }
  closeCompareForTest(): void {
    this.closeCompare()
  }

  private breakdown(): HTMLElement {
    const mk = (k: string, lbl: ReturnType<typeof tk>): HTMLElement => {
      const v = h('b')
      this.bd[k] = v
      return h('div', { class: 'tle-bd' }, h('span', { text: lbl }), v)
    }
    return h('div', { class: 'tle-breakdown' }, mk('motion', tk('animio.tle.bd.motion')), mk('pauses', tk('animio.tle.bd.pauses')), mk('hold', tk('animio.tle.bd.hold')), mk('total', tk('animio.tle.bd.total')), mk('frames', tk('animio.tle.bd.frames')))
  }

  private buildTimeline(): HTMLElement {
    const core = this.core
    // toolbar
    const pl = numField({ get: () => this.pauseLen, set: (v) => (this.pauseLen = v), min: 0.05, max: 3600, step: 0.1, dec: 2 })
    pl.el.title = t('animio.tle.pauses.length')
    pl.el.classList.add('short')
    this.syncers.push(pl.sync)
    this.zoomSlider = h('input', { type: 'range', min: '0', max: '1000', step: '1', class: 'tle-zoom' })
    this.zoomSlider.addEventListener('input', () => {
      this.userZoomed = true
      this.setZoom(this.sliderPpf(Number(this.zoomSlider.value) / 1000), this.scroll.clientWidth / 2)
    })
    const bar = h(
      'div',
      { class: 'tle-tlbar' },
      h('button', { class: 'tle-btn', onclick: () => this.addPauseAtPlayhead() }, svg(ICON.pausebar, 16), h('span', { text: tk('animio.tle.tl.addPause') })),
      pl.el,
      h('span', { class: 'tle-dim', text: tk('animio.tle.sec.unit') }),
      h('button', { class: 'tle-btn', onclick: () => this.splitAtPlayhead() }, svg(ICON.split, 16), h('span', { text: tk('animio.tle.tl.split') })),
      h('button', { class: 'tle-btn', onclick: () => this.deleteSel() }, svg(ICON.trash, 16), h('span', { text: tk('animio.tle.tl.delete') })),
      h('div', { class: 'tle-spacer' }),
      tbtn(ICON.zoomOut, tk('animio.tle.tl.zoomOut'), () => this.zoomBy(1 / 1.6)),
      this.zoomSlider,
      tbtn(ICON.zoomIn, tk('animio.tle.tl.zoomIn'), () => this.zoomBy(1.6)),
      tbtn(ICON.fit, tk('animio.tle.tl.zoomFit'), () => {
        this.userZoomed = false
        this.fitZoom()
      })
    )
    // lanes
    this.inner.style.height = TL_H + 'px'
    this.cv.style.height = TL_H + 'px'
    const laneLabels = h(
      'div',
      { class: 'tle-lane-labels' },
      h('span', { style: `top:${RULER_H + THUMB_H}px;height:${SEG_H}px`, text: tk('animio.tle.lane.speed') }),
      h('span', { style: `top:${RULER_H + THUMB_H + SEG_H}px;height:${PAUSE_H}px`, text: tk('animio.tle.lane.pauses') })
    )
    this.inner.append(this.cv, this.rangeEl, this.playhead)
    this.scroll.append(this.inner)
    this.scroll.addEventListener('scroll', () => this.queueDraw())
    this.scroll.addEventListener(
      'wheel',
      (e) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault()
          this.userZoomed = true
          const r = this.scroll.getBoundingClientRect()
          this.setZoom(this.ppf * (e.deltaY < 0 ? 1.18 : 1 / 1.18), e.clientX - r.left)
        } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          e.preventDefault()
          this.scroll.scrollLeft += e.deltaY
        }
      },
      { passive: false }
    )
    this.inner.addEventListener('pointerdown', (e) => this.onLanePointer(e))
    const ro = new ResizeObserver(() => this.onResize())
    ro.observe(this.scroll)
    this.offs.push(() => ro.disconnect())
    void core
    return h('footer', { class: 'tle-tl' }, bar, h('div', { class: 'tle-tlwrap' }, laneLabels, this.scroll))
  }

  // ---------------------------------------------------------------- lifecycle
  async start(): Promise<void> {
    const core = this.core
    this.offs.push(core.events.on('change', () => this.onCore()))
    this.offs.push(core.events.on('history', () => this.syncHistory()))
    this.offs.push(onLangChange(() => this.sync()))
    document.body.append(this.root)
    this.onResize()
    this.fitZoom()
    this.onCore()
    this.syncHistory()
    this.setTime(0, true)
    requestAnimationFrame((n) => this.tick(n))
  }

  dispose(): void {
    this.closed = true
    this.playing = false
    this.cmp?.dispose()
    this.cmp = null
    for (const o of this.offs) o()
    this.core.dispose()
    this.root.remove()
  }

  // ---------------------------------------------------------------- derived state
  private effSpeed(): number {
    return this.core.schedule.speed
  }
  private segOf(): { id: number; speed: number; from: number; to: number } | undefined {
    return this.sel?.kind === 'seg' ? this.core.edit.segments.find((s) => s.id === (this.sel as { id: number }).id) : undefined
  }
  private pauseOf(): { id: number; at: number; seconds: number } | undefined {
    return this.sel?.kind === 'pause' ? this.core.edit.pauses.find((p) => p.id === (this.sel as { id: number }).id) : undefined
  }
  private get curRaw(): number {
    const s = this.core.schedule
    const i = itemAt(s, this.time)
    return i < 0 ? 0 : s.items[i].frameIndex
  }

  private onCore(): void {
    const keepRaw = this.shownRaw >= 0 ? this.curRaw : 0
    // validate the selection against the new edit
    if (this.sel?.kind === 'seg' && !this.segOf()) this.sel = null
    if (this.sel?.kind === 'pause' && !this.pauseOf()) this.sel = null
    // keep the playhead on the same source frame when timing changed
    const s = this.core.schedule
    this.time = clamp(s.items.length ? timeOfSource(s, keepRaw) : 0, 0, s.total)
    this.fitPpf = this.computeFitPpf()
    if (!this.userZoomed) this.ppf = this.fitPpf
    this.updateInner()
    this.renderOverlays()
    this.sync()
    this.setTime(this.time, true)
    this.queueDraw()
  }

  private sync(): void {
    const core = this.core
    const e = core.edit
    const s = core.schedule
    for (const f of this.syncers) f()
    // hide undone
    const info = core.keepInfo
    this.hideChk.checked = e.hideUndone && info.supported
    this.hideChk.disabled = !info.supported
    this.hideNote.className = 'tle-note' + (info.supported ? '' : ' warn')
    this.hideNote.textContent = !info.supported ? t('animio.tle.hide.unsupported') : info.hiddenActions ? t('animio.tle.hide.count', { count: info.hiddenActions }) + ' ' + t('animio.tle.hide.frames', { count: info.hiddenFrames }) : t('animio.tle.hide.none')
    // speed
    this.speedSlider.value = String(Math.round(speedToSlider(s.speed) * 1000))
    this.speedSlider.disabled = e.fitDuration !== null
    this.fitChk.checked = e.fitDuration !== null
    this.fitWarn.textContent = e.fitDuration !== null && !s.fitOk ? t('animio.tle.fit.infeasible') : ''
    this.bd.motion.textContent = t('animio.tle.sec', { n: fx(s.body, 1) })
    this.bd.pauses.textContent = t('animio.tle.sec', { n: fx(s.pauses, 1) })
    this.bd.hold.textContent = t('animio.tle.sec', { n: fx(s.hold, 1) })
    this.bd.total.textContent = formatClock(s.total, 1)
    this.bd.frames.textContent = String(this.core.kept.length) + (this.core.kept.length !== this.core.n ? ' / ' + this.core.n : '')
    this.pauseSummary.textContent = e.pauses.length ? t('animio.tle.pauses.count', { count: e.pauses.length, sec: fx(s.pauses, 1) }) : t('animio.tle.pauses.none')
    // selection
    const k = this.sel?.kind ?? 'none'
    this.selNone.style.display = k === 'none' ? '' : 'none'
    this.selRange.style.display = k === 'range' ? '' : 'none'
    this.selSeg.style.display = k === 'seg' ? '' : 'none'
    this.selPause.style.display = k === 'pause' ? '' : 'none'
    if (this.sel?.kind === 'range') this.rangeLbl.textContent = t('animio.tle.sel.range', { from: this.sel.from + 1, to: this.sel.to })
    this.frameLbl.textContent = t('animio.tle.frameOf', { n: Math.max(0, this.curRaw) + 1, total: core.n })
    this.updateTimeLabel()
  }

  private syncHistory(): void {
    this.undoBtn.disabled = !this.core.canUndo
    this.redoBtn.disabled = !this.core.canRedo
  }

  private updateTimeLabel(): void {
    const s = this.core.schedule
    this.timeLbl.textContent = t('animio.tle.time', { cur: formatClock(this.time, 1), total: formatClock(s.total, 1) })
  }

  // ---------------------------------------------------------------- selection / edit ops
  private select(sel: Sel): void {
    this.sel = sel
    this.sync()
    this.renderOverlays()
  }

  private applyRange(): void {
    const r = this.sel
    if (r?.kind !== 'range') return
    this.core.commit(applySegment(this.core.edit, r.from, r.to, this.rangeSpeed))
    const seg = this.core.edit.segments.find((s) => s.from === r.from && s.to === r.to)
    this.select(seg ? { kind: 'seg', id: seg.id } : null)
  }

  private deleteSel(): void {
    const s = this.sel
    if (!s) return
    if (s.kind === 'seg') this.core.commit(removeSegment(this.core.edit, s.id))
    else if (s.kind === 'pause') this.core.commit(removePause(this.core.edit, s.id))
    this.select(null)
  }

  private splitAtPlayhead(): void {
    const raw = this.curRaw
    const next = splitSegment(this.core.edit, raw)
    this.core.commit(next)
  }

  private addPauseAtPlayhead(): void {
    this.addPauseAt(this.curRaw)
  }
  private addPauseAt(raw: number): void {
    const e = addPause(this.core.edit, raw, this.pauseLen)
    const before = new Set(this.core.edit.pauses.map((p) => p.id))
    this.core.commit(e)
    const added = this.core.edit.pauses.find((p) => !before.has(p.id))
    if (added) this.select({ kind: 'pause', id: added.id })
  }

  private exportNow(): void {
    this.pause()
    openExportDialog(this.app, this.core)
  }

  openExport(): void {
    this.exportNow()
  }

  // ---------------------------------------------------------------- playback
  private pause(): void {
    if (!this.playing) return
    this.playing = false
    this.rate = 1
    this.updatePlayUi()
  }
  private togglePlay(): void {
    if (this.playing) return this.pause()
    this.rate = 1
    this.play()
  }
  private play(): void {
    const total = this.core.schedule.total
    if (this.rate > 0 && this.time >= total - 1e-6) this.time = 0
    if (this.rate < 0 && this.time <= 0) this.time = total
    this.playing = true
    this.lastTick = 0
    this.updatePlayUi()
  }
  private updatePlayUi(): void {
    this.playBtn.replaceChildren(svg(this.playing ? ICON.pause : ICON.play, 22))
    this.playBtn.classList.toggle('on', this.playing)
    this.rateLbl.textContent = this.playing && Math.abs(this.rate) !== 1 ? (this.rate < 0 ? '◀ ' : '▶ ') + Math.abs(this.rate) + '×' : ''
  }
  private step(dir: number, count = 1): void {
    this.pause()
    const s = this.core.schedule
    if (!s.items.length) return
    const i = clamp(itemAt(s, this.time) + dir * count, 0, s.items.length - 1)
    this.setTime(s.items[i].startTime)
  }

  private tick(now: number): void {
    if (this.closed) return
    if (this.playing) {
      const dt = this.lastTick ? Math.min(0.25, (now - this.lastTick) / 1000) : 0
      this.lastTick = now
      const total = this.core.schedule.total
      let tt = this.time + dt * this.rate
      if (tt >= total) {
        if (this.loop && this.rate > 0) tt = 0
        else {
          tt = total
          this.pause()
        }
      } else if (tt <= 0 && this.rate < 0) {
        tt = 0
        this.pause()
      }
      this.setTime(tt, false, true)
    }
    requestAnimationFrame((n) => this.tick(n))
  }

  /** Move the playhead (output time in seconds). */
  setTime(time: number, force = false, follow = false): void {
    const s = this.core.schedule
    this.time = clamp(time, 0, s.total)
    const i = itemAt(s, this.time)
    const raw = i < 0 ? -1 : s.items[i].frameIndex
    if (raw !== this.wantRaw || force) {
      this.wantRaw = raw
      void this.pump()
      if (this.playing) this.prefetch(i)
    }
    const a = fadeAlpha(this.time, s.total, this.core.edit.finale.fadeIn, this.core.edit.finale.fadeOut)
    this.fade.style.opacity = String(a)
    this.updateTimeLabel()
    this.frameLbl.textContent = t('animio.tle.frameOf', { n: Math.max(0, raw) + 1, total: this.core.n })
    this.placePlayhead(raw, follow)
  }

  private prefetch(i: number): void {
    const s = this.core.schedule
    const dir = this.rate < 0 ? -1 : 1
    for (let k = 1; k <= 3; k++) {
      const it = s.items[i + dir * k]
      if (it) void this.core.frame(it.frameIndex)
    }
  }

  private async pump(): Promise<void> {
    if (this.pumping) return
    this.pumping = true
    try {
      while (!this.closed && this.wantRaw >= 0 && this.wantRaw !== this.shownRaw) {
        const want = this.wantRaw
        const bmp = await this.core.frame(want)
        if (this.closed) return
        if (bmp) {
          if (this.canvas.width !== bmp.width || this.canvas.height !== bmp.height) {
            this.canvas.width = bmp.width
            this.canvas.height = bmp.height
          }
          this.ctx.drawImage(bmp, 0, 0)
        }
        this.shownRaw = want
      }
    } finally {
      this.pumping = false
    }
  }

  // ---------------------------------------------------------------- keyboard
  /** Returns true when the key was consumed. */
  handleKey(e: KeyboardEvent): boolean {
    if (this.cmp) return this.cmp.handleKey(e)
    if (document.querySelector('.an-modal-bg')) return false // a dialog (export) owns the keyboard
    const typing = (e.target as HTMLElement | null)?.matches?.('input, textarea, select')
    const ctrl = e.ctrlKey || e.metaKey
    if (e.key === 'Escape') {
      if (typing) (e.target as HTMLElement).blur()
      else if (this.sel) this.select(null)
      else this.onClose()
      return true
    }
    if (ctrl && e.code === 'KeyZ') {
      if (typing) return false
      if (e.shiftKey) this.core.redo()
      else this.core.undo()
      return true
    }
    if (ctrl && e.code === 'KeyY') {
      if (!typing) this.core.redo()
      return !typing
    }
    if (typing) return false
    if (ctrl) return false
    switch (e.code) {
      case 'Space':
        this.togglePlay()
        return true
      case 'ArrowLeft':
        this.step(-1, e.shiftKey ? 10 : 1)
        return true
      case 'ArrowRight':
        this.step(1, e.shiftKey ? 10 : 1)
        return true
      case 'Home':
        this.setTime(0)
        return true
      case 'End':
        this.setTime(this.core.schedule.total)
        return true
      case 'KeyK':
        this.pause()
        return true
      case 'KeyL':
        this.rate = this.playing && this.rate > 0 ? Math.min(8, this.rate * 2) : 1
        this.play()
        return true
      case 'KeyJ':
        this.rate = this.playing && this.rate < 0 ? Math.max(-8, this.rate * 2) : -1
        this.play()
        return true
      case 'Delete':
      case 'Backspace':
        this.deleteSel()
        return true
      case 'KeyP':
        this.addPauseAtPlayhead()
        return true
      case 'KeyS':
        this.splitAtPlayhead()
        return true
    }
    return false
  }

  // ---------------------------------------------------------------- timeline geometry
  private computeFitPpf(): number {
    const w = Math.max(200, this.scroll.clientWidth - 2)
    return clamp(w / Math.max(1, this.core.n), 0.05, MAX_PPF)
  }
  private sliderPpf(p: number): number {
    const lo = this.fitPpf
    return lo * Math.pow(MAX_PPF / lo, clamp(p, 0, 1))
  }
  private ppfSlider(): number {
    const lo = this.fitPpf
    return MAX_PPF <= lo ? 0 : Math.log(this.ppf / lo) / Math.log(MAX_PPF / lo)
  }
  private fitZoom(): void {
    this.fitPpf = this.computeFitPpf()
    this.ppf = this.fitPpf
    this.updateInner()
    this.scroll.scrollLeft = 0
    this.renderOverlays()
    this.queueDraw()
  }
  private zoomBy(f: number): void {
    this.userZoomed = true
    this.setZoom(this.ppf * f, this.scroll.clientWidth / 2)
  }
  private setZoom(ppf: number, anchorPx: number): void {
    const lo = this.fitPpf
    const nv = clamp(ppf, lo, Math.max(lo, MAX_PPF))
    const anchorRaw = (this.scroll.scrollLeft + anchorPx) / this.ppf
    this.ppf = nv
    this.updateInner()
    this.scroll.scrollLeft = anchorRaw * nv - anchorPx
    this.renderOverlays()
    this.queueDraw()
  }
  private updateInner(): void {
    this.inner.style.width = Math.max(this.scroll.clientWidth, this.core.n * this.ppf + 2) + 'px'
    this.zoomSlider.value = String(Math.round(this.ppfSlider() * 1000))
    this.placePlayhead(this.curRaw, false)
  }
  private onResize(): void {
    const w = this.scroll.clientWidth
    if (!w) return
    const dpr = window.devicePixelRatio || 1
    this.cvW = w
    this.cv.width = Math.round(w * dpr)
    this.cv.height = Math.round(TL_H * dpr)
    this.cv.style.width = w + 'px'
    this.fitPpf = this.computeFitPpf()
    if (!this.userZoomed) this.ppf = this.fitPpf
    else this.ppf = clamp(this.ppf, this.fitPpf, Math.max(this.fitPpf, MAX_PPF))
    this.updateInner()
    this.renderOverlays()
    this.queueDraw()
  }

  private xOfRaw(raw: number): number {
    return raw * this.ppf
  }
  private rawAtClient(clientX: number, boundary = false): number {
    const r = this.scroll.getBoundingClientRect()
    const x = clientX - r.left + this.scroll.scrollLeft
    const v = x / this.ppf
    return clamp(boundary ? Math.round(v) : Math.floor(v), 0, boundary ? this.core.n : Math.max(0, this.core.n - 1))
  }

  private placePlayhead(raw: number, follow: boolean): void {
    const x = this.xOfRaw(Math.max(0, raw) + 0.5)
    this.playhead.style.transform = `translateX(${x.toFixed(1)}px)`
    if (follow) {
      const sl = this.scroll.scrollLeft
      const w = this.scroll.clientWidth
      if (x < sl + 20 || x > sl + w - 40) this.scroll.scrollLeft = Math.max(0, x - w * 0.3)
    }
  }

  // ---------------------------------------------------------------- lane pointer handling
  private onLanePointer(e: PointerEvent): void {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    const target = e.target as HTMLElement
    if (target.closest('.tle-band, .tle-pause')) return // handled by the element
    const inner = this.inner.getBoundingClientRect()
    const y = e.clientY - inner.top
    const startX = e.clientX
    const tap = this.lastTap
    const now = performance.now()
    const isDouble = now - tap.t < 380 && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 14
    this.lastTap = { t: now, x: e.clientX, y: e.clientY }
    capture(this.inner, e.pointerId)
    if (y >= RULER_H + THUMB_H && y < RULER_H + THUMB_H + SEG_H) {
      // speed lane: drag out a range
      const a = this.rawAtClient(startX, true)
      let moved = false
      const move = (ev: PointerEvent): void => {
        const b = this.rawAtClient(ev.clientX, true)
        if (!moved && Math.abs(ev.clientX - startX) < 4) return
        moved = true
        const from = Math.min(a, b)
        const to = Math.max(a, b)
        this.sel = to > from ? { kind: 'range', from, to } : null
        this.renderOverlays()
        this.sync()
      }
      const up = (): void => {
        this.inner.removeEventListener('pointermove', move)
        this.inner.removeEventListener('pointerup', up)
        this.inner.removeEventListener('pointercancel', up)
        if (!moved) this.select(null)
      }
      this.inner.addEventListener('pointermove', move)
      this.inner.addEventListener('pointerup', up)
      this.inner.addEventListener('pointercancel', up)
      return
    }
    if (isDouble) {
      this.lastTap.t = 0
      this.addPauseAt(this.rawAtClient(e.clientX))
      return
    }
    // ruler / thumbnails / pause lane: scrub
    const scrub = (ev: PointerEvent): void => {
      const raw = this.rawAtClient(ev.clientX)
      this.setTime(timeOfSource(this.core.schedule, raw))
    }
    this.pause()
    scrub(e)
    if (this.sel && !(this.sel.kind === 'range')) this.select(null)
    const up = (): void => {
      this.inner.removeEventListener('pointermove', scrub)
      this.inner.removeEventListener('pointerup', up)
      this.inner.removeEventListener('pointercancel', up)
    }
    this.inner.addEventListener('pointermove', scrub)
    this.inner.addEventListener('pointerup', up)
    this.inner.addEventListener('pointercancel', up)
  }

  // ---------------------------------------------------------------- overlays (bands, pauses, range)
  private renderOverlays(): void {
    const e = this.core.edit
    const n = this.core.n
    // segments
    const segIds = new Set(e.segments.map((s) => s.id))
    for (const [id, el] of this.bandEls)
      if (!segIds.has(id)) {
        el.remove()
        this.bandEls.delete(id)
      }
    for (const s of e.segments) {
      let el = this.bandEls.get(s.id)
      if (!el) {
        el = this.makeBand(s.id)
        this.bandEls.set(s.id, el)
        this.inner.append(el)
      }
      const x0 = this.xOfRaw(s.from)
      const w = Math.max(6, this.xOfRaw(s.to) - x0)
      el.style.cssText = `left:${x0}px;width:${w}px;top:${RULER_H + THUMB_H}px;height:${SEG_H}px;background:${bandColor(s.speed)}`
      el.classList.toggle('sel', this.sel?.kind === 'seg' && this.sel.id === s.id)
      ;(el.querySelector('.lbl') as HTMLElement).textContent = '×' + fmtNum(s.speed, 2)
    }
    // pauses
    const pIds = new Set(e.pauses.map((p) => p.id))
    for (const [id, el] of this.pauseEls)
      if (!pIds.has(id)) {
        el.remove()
        this.pauseEls.delete(id)
      }
    for (const p of e.pauses) {
      let el = this.pauseEls.get(p.id)
      if (!el) {
        el = this.makePause(p.id)
        this.pauseEls.set(p.id, el)
        this.inner.append(el)
      }
      el.style.cssText = `left:${this.xOfRaw(Math.min(p.at, Math.max(0, n - 1)) + 0.5)}px;top:${RULER_H}px;height:${TL_H - RULER_H}px`
      el.classList.toggle('sel', this.sel?.kind === 'pause' && this.sel.id === p.id)
      ;(el.querySelector('.lbl') as HTMLElement).textContent = t('animio.tle.sec', { n: fmtNum(p.seconds, p.seconds < 10 ? 2 : 1) })
    }
    // range
    if (this.sel?.kind === 'range') {
      const x0 = this.xOfRaw(this.sel.from)
      this.rangeEl.style.cssText = `display:block;left:${x0}px;width:${Math.max(2, this.xOfRaw(this.sel.to) - x0)}px;top:${RULER_H + THUMB_H}px;height:${SEG_H}px`
    } else this.rangeEl.style.display = 'none'
  }

  private makeBand(id: number): HTMLElement {
    const el = h('div', { class: 'tle-band' }, h('i', { class: 'edge l' }), h('span', { class: 'lbl' }), h('i', { class: 'edge r' }))
    const core = this.core
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
      const seg = core.edit.segments.find((s) => s.id === id)
      if (!seg) return
      this.pause()
      this.select({ kind: 'seg', id })
      const edge = (e.target as HTMLElement).classList.contains('l') ? 'l' : (e.target as HTMLElement).classList.contains('r') ? 'r' : ''
      if (!edge) return
      const base = core.edit
      core.begin()
      capture(el, e.pointerId)
      const move = (ev: PointerEvent): void => {
        const raw = this.rawAtClient(ev.clientX, true)
        const cur = base.segments.find((s) => s.id === id)!
        core.live(resizeSegment(base, id, edge === 'l' ? raw : cur.from, edge === 'r' ? raw : cur.to, core.n))
      }
      const up = (): void => {
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', up)
        el.removeEventListener('pointercancel', up)
        core.end()
      }
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', up)
      el.addEventListener('pointercancel', up)
    })
    return el
  }

  private makePause(id: number): HTMLElement {
    const core = this.core
    const grip = h('i', { class: 'grip' })
    const lbl = h('span', { class: 'lbl' })
    const pill = h('div', { class: 'pill' }, svg(ICON.pausebar, 12), lbl, grip)
    const el = h('div', { class: 'tle-pause' }, h('b', { class: 'line' }), pill)
    pill.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
      const p = core.edit.pauses.find((x) => x.id === id)
      if (!p) return
      this.pause()
      this.select({ kind: 'pause', id })
      const resize = e.target === grip
      const base = core.edit
      const x0 = e.clientX
      const sec0 = p.seconds
      let moved = false
      core.begin()
      capture(pill, e.pointerId)
      const move = (ev: PointerEvent): void => {
        if (!moved && Math.abs(ev.clientX - x0) < 3) return
        moved = true
        if (resize) {
          // proportional drag: every 80 px doubles / halves the length
          let v = sec0 * Math.pow(2, (ev.clientX - x0) / 80)
          v = v < 10 ? Math.round(v * 10) / 10 : Math.round(v)
          core.live(updatePause(base, id, { seconds: Math.max(0.05, v) }))
        } else core.live(updatePause(base, id, { at: this.rawAtClient(ev.clientX) }))
      }
      const up = (): void => {
        pill.removeEventListener('pointermove', move)
        pill.removeEventListener('pointerup', up)
        pill.removeEventListener('pointercancel', up)
        core.end()
        if (!moved) this.setTime(timeOfSource(core.schedule, core.edit.pauses.find((x) => x.id === id)?.at ?? 0))
      }
      pill.addEventListener('pointermove', move)
      pill.addEventListener('pointerup', up)
      pill.addEventListener('pointercancel', up)
    })
    return el
  }

  // ---------------------------------------------------------------- canvas drawing (virtualised: only the visible part)
  private queueDraw(): void {
    if (this.drawQueued || this.closed) return
    this.drawQueued = true
    requestAnimationFrame(() => {
      this.drawQueued = false
      if (!this.closed) this.draw()
    })
  }

  private draw(): void {
    const core = this.core
    const ctx = this.cx
    const dpr = window.devicePixelRatio || 1
    const W = this.cvW
    if (!W) return
    const sl = this.scroll.scrollLeft
    const ppf = this.ppf
    const n = core.n
    const css = getComputedStyle(this.root)
    const dim = css.getPropertyValue('--dim').trim() || '#9a9aa2'
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, TL_H)
    // lanes background
    ctx.fillStyle = 'rgba(255,255,255,0.03)'
    ctx.fillRect(0, RULER_H + THUMB_H, W, SEG_H + PAUSE_H)
    ctx.fillStyle = 'rgba(0,0,0,0.25)'
    ctx.fillRect(0, RULER_H + THUMB_H + SEG_H - 1, W, 1)
    if (!n) return
    const first = Math.max(0, Math.floor(sl / ppf) - 1)
    const last = Math.min(n - 1, Math.ceil((sl + W) / ppf) + 1)
    // thumbnails
    const step = Math.max(1, Math.ceil(THUMB_SLOT / ppf))
    const redraw = (): void => this.queueDraw()
    for (let f = Math.floor(first / step) * step; f <= last; f += step) {
      const x = f * ppf - sl
      const w = Math.min(step, n - f) * ppf
      const nk = core.nextKept[f]
      const pick = nk < Math.min(n, f + step) ? nk : f
      const bmp = core.thumb(pick, redraw)
      if (bmp) {
        const ar = w / THUMB_H
        const sw = Math.min(bmp.width, bmp.height * ar)
        const sh = sw / ar
        ctx.drawImage(bmp, (bmp.width - sw) / 2, (bmp.height - sh) / 2, sw, sh, x, RULER_H, w, THUMB_H)
      } else {
        ctx.fillStyle = '#2d2d31'
        ctx.fillRect(x, RULER_H, w - 1, THUMB_H)
      }
      if (!core.shown[pick]) {
        ctx.fillStyle = 'rgba(20,20,22,0.62)'
        ctx.fillRect(x, RULER_H, w, THUMB_H)
      }
      if (w > 3) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)'
        ctx.fillRect(x + w - 1, RULER_H, 1, THUMB_H)
      }
    }
    // hidden (undone) runs: dim + hatch + count marker
    let runStart = -1
    const flush = (end: number): void => {
      if (runStart < 0) return
      const x0 = runStart * ppf - sl
      const x1 = end * ppf - sl
      ctx.fillStyle = 'rgba(14,14,16,0.7)'
      ctx.fillRect(x0, RULER_H, x1 - x0, THUMB_H)
      ctx.save()
      ctx.beginPath()
      ctx.rect(x0, RULER_H, x1 - x0, THUMB_H)
      ctx.clip()
      ctx.strokeStyle = 'rgba(255,255,255,0.13)'
      ctx.lineWidth = 1
      for (let hx = x0 - THUMB_H; hx < x1; hx += 7) {
        ctx.beginPath()
        ctx.moveTo(hx, RULER_H + THUMB_H)
        ctx.lineTo(hx + THUMB_H, RULER_H)
        ctx.stroke()
      }
      ctx.restore()
      runStart = -1
    }
    for (let f = first; f <= last; f++) {
      if (!core.shown[f]) {
        if (runStart < 0) runStart = f
      } else flush(f)
    }
    flush(last + 1)
    // ruler
    ctx.fillStyle = 'rgba(255,255,255,0.04)'
    ctx.fillRect(0, 0, W, RULER_H)
    ctx.fillStyle = dim
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'
    ctx.font = '11px "Segoe UI", system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    const total = core.schedule.total
    const major = 96
    for (let x = Math.floor(sl / major) * major; x < sl + W + major; x += major) {
      const raw = Math.min(n - 1, Math.max(0, Math.floor(x / ppf)))
      const tt = timeOfSource(core.schedule, raw)
      const px = x - sl + 0.5
      ctx.beginPath()
      ctx.moveTo(px, RULER_H - 9)
      ctx.lineTo(px, RULER_H)
      ctx.stroke()
      const label = formatClock(tt, total < 120 ? 1 : 0)
      // pauses and hidden stretches make neighbouring ticks share a time: label each distinct time once
      const prevRaw = Math.min(n - 1, Math.max(0, Math.floor((x - major) / ppf)))
      if (x === Math.floor(sl / major) * major || formatClock(timeOfSource(core.schedule, prevRaw), total < 120 ? 1 : 0) !== label) ctx.fillText(label, px + 4, RULER_H / 2 - 1)
      for (let m = 1; m < 4; m++) {
        const mx = px + (m * major) / 4
        ctx.beginPath()
        ctx.moveTo(mx, RULER_H - 4)
        ctx.lineTo(mx, RULER_H)
        ctx.stroke()
      }
    }
    // end of recording marker
    const endX = n * ppf - sl
    if (endX < W) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)'
      ctx.fillRect(endX, RULER_H, W - endX, THUMB_H)
    }
  }
}

// ------------------------------------------------------------------ session management
let session: { ed: Editor; offKey: () => void } | null = null
const TAB_ID = 'timelapse'

export const isTimelapseEditorOpen = (): boolean => !!session
/** QA / selftest handle of the open editor */
export const timelapseEditor = (): Editor | null => session?.ed ?? null
export function closeTimelapseEditor(): void {
  if (!session) return
  const s = session
  session = null
  s.offKey()
  s.ed.dispose()
  setTopTabActive(TAB_ID, false)
  document.querySelector<HTMLElement>('#app')?.focus?.()
}

/** Open the editor for the current document; `exportNow` goes straight to the export dialog. */
export async function openTimelapseEditor(app: App, ui: UIContext, opts: { exportNow?: boolean } = {}): Promise<void> {
  if (session) {
    if (opts.exportNow) session.ed.openExport()
    return
  }
  const rec = getRecorder(app.doc)
  if (!rec) return
  await rec.flush()
  if (rec.count < 1) {
    ui.toast(t('animio.tl.nothing'))
    return
  }
  ensureStyles()
  if (app.engine.active) return
  // the editor opens on the language the canvas shows right now
  if (app.doc.hasLangLayers && app.doc.langs.some((l) => l.code === app.doc.viewLang)) rec.setEditVariant(app.doc.viewLang)
  const core = new TlEditorCore(rec)
  await core.load()
  const ed = new Editor(app, ui, core, () => closeTimelapseEditor())
  // keyboard: while the editor is open painting shortcuts are off (Ctrl+S and the cheat sheet still work)
  const onKey = (e: KeyboardEvent): void => {
    if (ed.handleKey(e)) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    const typing = (e.target as HTMLElement | null)?.matches?.('input, textarea, select')
    if (typing || document.querySelector('.an-modal-bg')) return
    const ctrl = e.ctrlKey || e.metaKey
    if ((ctrl && e.code === 'KeyS') || e.key === 'F1' || e.key === 'F11' || (e.key === '/' && e.shiftKey)) return
    e.stopPropagation()
  }
  window.addEventListener('keydown', onKey, true)
  session = { ed, offKey: () => window.removeEventListener('keydown', onKey, true) }
  setTopTabActive(TAB_ID, true)
  await ed.start()
  if (opts.exportNow) ed.openExport()
}

/** Registers the top-bar tab and routes the old Actions > Video entries to the editor. */
export function installTimelapseEditor(app: App, ui: UIContext): void {
  registerTopTab({
    id: TAB_ID,
    label: tk('animio.tle.tab'),
    run: () => (isTimelapseEditorOpen() ? closeTimelapseEditor() : void openTimelapseEditor(app, ui))
  })
  // the editor replaces the canvas workspace: leaving for another document or a canvas tool menu closes it
  app.events.on('doc', () => closeTimelapseEditor())
  menuEvents.on('run', (m) => {
    if (m.menu !== 'actions') closeTimelapseEditor()
  })
}
