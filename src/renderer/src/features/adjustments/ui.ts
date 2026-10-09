import type { App } from '../../app/app'
import { docToScreen, gestureStep, screenToDoc } from '../../core/viewTransform'
import { actionEnv, runAction } from '../../input/actions'
import { DEFAULT_GESTURE_CONFIG, Gesture, TouchGestures } from '../../input/gestures'
import { prefs } from '../../input/prefs'
import type { Sample } from '../../core/types'
import { onLangChange, t } from '../../i18n'
import { adjName, lbl, paramLabel } from './labels'
import { h } from '../../ui/dom'
import { CloneTool } from './clone'
import { liquifyRadius } from './liquify'
import { curveIsIdentity, GRADIENT_LIBRARY, histogram, identityCurve, makeCurve, sampleGradient, sortStops, colorToHex, type CurvePt } from './math'
import { AdjustmentSession } from './session'
import type { ParamDef } from './types'

const CSS = `
.adj-bar { position: fixed; top: calc(var(--topbar-h) + 8px); left: 50%; transform: translateX(-50%); z-index: 60; display: flex; align-items: center; gap: 8px;
  background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 6px 10px; box-shadow: 0 8px 30px #0008; max-width: calc(100vw - 24px); flex-wrap: wrap; justify-content: center; }
.adj-bar .name { font-weight: 600; }
.adj-bar .lim { font-size: 11px; color: var(--dim); max-width: 220px; }
.adj-bar .val { min-width: 130px; text-align: center; color: #fff; background: var(--accent); border-radius: 9px; padding: 4px 10px; font-variant-numeric: tabular-nums; }
.adj-bar .val.none { background: var(--panel2); color: var(--dim); }
.adj-bar button, .adj-panel button.b { background: var(--panel2); border: 1px solid var(--line); border-radius: 8px; padding: 5px 10px; cursor: pointer; }
.adj-bar button:hover:not([disabled]), .adj-panel button.b:hover { border-color: var(--accent); }
.adj-bar button[disabled] { opacity: .45; cursor: default; }
.adj-bar button.on, .adj-panel button.b.on { background: var(--accent); border-color: var(--accent); color: #fff; }
.adj-bar .apply { background: var(--accent); border-color: var(--accent); color: #fff; }
.adj-bar .seg { display: flex; gap: 0; } .adj-bar .seg button:first-child { border-radius: 8px 0 0 8px; } .adj-bar .seg button:last-child { border-radius: 0 8px 8px 0; }
.adj-panel { position: fixed; right: 12px; top: calc(var(--topbar-h) + 64px); width: 292px; max-height: calc(100vh - var(--topbar-h) - 84px); overflow: auto; z-index: 60; background: var(--panel);
  border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; box-shadow: 0 12px 40px #000a; }
.adj-panel .prow { display: flex; align-items: center; gap: 8px; margin: 7px 0; }
.adj-panel .prow .lbl { width: 104px; color: var(--dim); flex: none; }
.adj-panel .prow input[type=range] { flex: 1; min-width: 0; accent-color: var(--accent); }
.adj-panel .prow .pv { width: 44px; text-align: right; color: var(--dim); font-variant-numeric: tabular-nums; }
.adj-panel .prow.active .lbl { color: var(--text); }
.adj-panel select { flex: 1; background: var(--panel2); color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 5px; }
.adj-panel h4 { margin: 10px 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--dim); }
.adj-panel canvas.curve { width: 256px; height: 256px; background: #18181a; border: 1px solid var(--line); border-radius: 8px; display: block; margin: 6px auto; touch-action: none; cursor: crosshair; }
.adj-panel .tabs { display: flex; gap: 4px; }
.adj-panel .tabs button { flex: 1; }
.adj-grad { position: relative; height: 28px; border-radius: 6px; border: 1px solid var(--line); margin: 8px 0 22px; cursor: copy; }
.adj-grad .stop { position: absolute; top: 26px; width: 14px; height: 18px; margin-left: -7px; border: 2px solid #fff; border-radius: 3px; box-shadow: 0 0 0 1px #000; cursor: ew-resize; }
.adj-grad .stop.sel { outline: 2px solid var(--accent); }
.adj-lib { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.adj-lib div { height: 34px; border-radius: 6px; border: 1px solid var(--line); cursor: pointer; font-size: 10px; color: #fff; text-shadow: 0 0 3px #000; display: flex; align-items: flex-end; padding: 2px 4px; }
.adj-lib div:hover { border-color: var(--accent); }
.adj-overlay { position: absolute; inset: 0; pointer-events: none; z-index: 5; overflow: hidden; }
.adj-overlay .pt { position: absolute; width: 22px; height: 22px; margin: -11px 0 0 -11px; border: 2px solid #fff; border-radius: 50%; box-shadow: 0 0 0 1px #000, inset 0 0 0 1px #000; }
.adj-overlay .pt::after { content: ''; position: absolute; left: 50%; top: 50%; width: 4px; height: 4px; margin: -2px; background: #fff; border-radius: 50%; }
.adj-overlay .src { position: absolute; width: 26px; height: 26px; margin: -13px 0 0 -13px; }
.adj-overlay .src::before, .adj-overlay .src::after { content: ''; position: absolute; background: #fff; box-shadow: 0 0 0 1px #000; }
.adj-overlay .src::before { left: 12px; top: 0; width: 2px; height: 26px; } .adj-overlay .src::after { top: 12px; left: 0; height: 2px; width: 26px; }
.adj-overlay .ring { position: absolute; border: 1px solid #fff; border-radius: 50%; box-shadow: 0 0 0 1px #000a; }
.adj-hint { color: var(--dim); font-size: 11px; margin: 6px 0; }
`

const unitStr = (u: string | undefined, v: number): string => Math.round(v) + (u ?? '')

/** The interactive layer around an AdjustmentSession: top bar, parameter panel, pointer routing, overlays. */
export class AdjustmentUI {
  session: AdjustmentSession | null = null
  private bar!: HTMLElement
  private panel: HTMLElement | null = null
  private overlay: HTMLElement
  private valEl: HTMLElement | null = null
  private ptEl: HTMLElement | null = null
  private srcEl: HTMLElement | null = null
  private ringEl: HTMLElement
  private stage: HTMLElement
  private pick: 'point' | 'source' | null = null
  private ptrId: number | null = null
  private ptrKind: 'drag' | 'tool' | 'point' | 'source' | null = null
  private rowEls = new Map<string, HTMLElement>()
  private panelSig = ''
  private cursorWas = ''
  private srcVisible = false
  private srcPos = { x: 0, y: 0 }
  private lastMouse: { x: number; y: number } | null = null
  /** finger gestures while an adjustment is open: two-finger tap = undo, pinch / twist / pan = navigate the canvas */
  private touchIds = new Set<number>()
  private gest = new TouchGestures({ ...DEFAULT_GESTURE_CONFIG }, (g) => this.onGesture(g))
  private gestTimer = 0
  private pendingDrag: number | null = null

  constructor(private app: App) {
    document.head.append(h('style', { text: CSS }))
    this.stage = app.canvas.parentElement!
    this.overlay = h('div', { class: 'adj-overlay' })
    this.ringEl = h('div', { class: 'ring', style: 'display:none' })
    this.overlay.append(this.ringEl)
    this.stage.append(this.overlay)
    this.stage.addEventListener('pointerdown', this.down, true)
    app.canvas.addEventListener('pointermove', this.move)
    app.canvas.addEventListener('pointerup', this.up)
    app.canvas.addEventListener('pointercancel', this.up)
    app.canvas.addEventListener('pointermove', this.touchMove)
    app.canvas.addEventListener('pointerup', this.touchUp)
    app.canvas.addEventListener('pointercancel', this.touchUp)
    app.canvas.addEventListener('pointerleave', () => (this.ringEl.style.display = 'none'))
    window.addEventListener('keydown', this.key)
    app.events.on('view', () => this.updateOverlay())
    app.events.on('doc', () => this.session && this.session.cancel())
    app.events.on('doc', () => this.closeUI())
    onLangChange(() => {
      if (!this.session || this.session.isClosed) return
      this.buildBar()
      this.buildPanel()
      this.refresh()
    })
  }

  // ------------------------------------------------------------------ open / close
  open(id: string): void {
    if (this.session && !this.session.isClosed) this.finish(true)
    const doc = this.app.doc
    const layer = doc.activeLayer
    if (!layer || layer.locked) return this.app.notify(t('adjustments.ui.layerLocked'))
    if (!layer.visible) return this.app.notify(t('adjustments.ui.layerHidden'))
    const s = new AdjustmentSession(this.app, id)
    this.session = s
    s.onChange = () => this.refresh()
    s.onMarker = (x, y, v) => {
      this.srcPos = { x, y }
      this.srcVisible = v
      this.updateOverlay()
    }
    doc.events.on('layers', this.layersWatch)
    this.buildBar()
    this.buildPanel()
    this.cursorWas = this.app.cursorEl.style.visibility
    this.refresh()
  }

  private layersWatch = (): void => {
    const s = this.session
    if (s && !s.isClosed && this.app.doc.activeLayer !== s.layer) this.finish(false)
  }

  /** Apply (commit=true) or cancel the running adjustment. */
  finish(commit: boolean): void {
    const s = this.session
    if (!s || s.isClosed) return this.closeUI()
    s.onChange = () => {}
    const ok = commit ? s.apply() : (s.cancel(), false)
    if (commit && !ok) this.app.notify(t('adjustments.ui.nothingToApply'))
    this.closeUI()
  }

  private closeUI(): void {
    this.session = null
    this.app.doc.events.off?.('layers', this.layersWatch)
    this.bar?.remove()
    this.panel?.remove()
    this.panel = null
    this.pick = null
    this.ringEl.style.display = 'none'
    this.ptEl?.remove()
    this.srcEl?.remove()
    this.ptEl = this.srcEl = null
    this.app.cursorEl.style.visibility = this.cursorWas
  }

  // ------------------------------------------------------------------ bar
  private buildBar(): void {
    const s = this.session!
    this.bar?.remove()
    const btn = (label: string, fn: () => void, cls = '', title = ''): HTMLButtonElement => h('button', { class: cls, text: label, title, onclick: fn })
    this.valEl = h('div', { class: 'val' })
    const seg = h('div', { class: 'seg' })
    if (s.canLayer && s.canPencil) {
      seg.append(
        btn(t('adjustments.ui.layer'), () => s.setMode('layer'), s.mode === 'layer' ? 'on' : '', t('adjustments.ui.dragTip')),
        btn(t('adjustments.ui.pencil'), () => s.setMode('pencil'), s.mode === 'pencil' ? 'on' : '', t('adjustments.ui.paintBrushTip'))
      )
    }
    const undo = btn(t('adjustments.ui.undo'), () => s.undo())
    undo.disabled = !s.canUndo
    this.bar = h(
      'div',
      { class: 'adj-bar' },
      h('span', { class: 'name', text: adjName(s.def) }),
      s.limit ? h('span', { class: 'lim', text: t('adjustments.ui.limit.' + s.limit), title: t('adjustments.ui.limit.tip') }) : null,
      seg.childElementCount ? seg : null,
      this.valEl,
      undo,
      btn(t('adjustments.ui.reset'), () => s.reset()),
      btn(t('adjustments.ui.preview'), () => s.setPreview(!s.preview), s.preview ? 'on' : '', t('adjustments.ui.previewTip')),
      btn(t('adjustments.ui.cancel'), () => this.finish(false), '', 'Esc'),
      btn(t('adjustments.ui.apply'), () => this.finish(true), 'apply', 'Enter')
    )
    document.body.append(this.bar)
  }

  private updateVal(): void {
    const s = this.session
    if (!s || !this.valEl) return
    const m = s.mainParam
    if (s.mode === 'pencil') {
      this.valEl.className = 'val none'
      this.valEl.textContent = s.def.custom === 'clone' ? (s.tool && (s.tool as CloneTool).source ? t('adjustments.ui.paintToClone') : t('adjustments.ui.setSourceTip')) : t('adjustments.ui.paintWithBrush')
    } else if (m) {
      this.valEl.className = 'val'
      const d = s.def.params.find((p) => p.key === m.key)!
      this.valEl.textContent = `${m.label} ${d.kind === 'select' ? '' : unitStr(m.unit, m.value)}`
    } else {
      this.valEl.className = 'val none'
      this.valEl.textContent = t('adjustments.ui.editInPanel')
    }
  }

  // ------------------------------------------------------------------ refresh
  private refresh(): void {
    const s = this.session
    if (!s) return
    if (s.isClosed) return
    this.buildBar()
    this.updateVal()
    // rebuild panel only when the visible structure changes (mode / dependent params), otherwise update values
    const sig = s.mode + '|' + s.def.params.map((p) => (!p.show || p.show(s.params) ? '1' : '0')).join('')
    if (sig !== this.panelSig) this.buildPanel()
    else this.syncPanel()
    this.app.cursorEl.style.visibility = s.def.custom === 'liquify' ? 'hidden' : this.cursorWas
    this.updateOverlay()
  }

  // ------------------------------------------------------------------ panel
  private buildPanel(): void {
    const s = this.session!
    this.panel?.remove()
    this.rowEls.clear()
    const panel = h('div', { class: 'adj-panel' })
    this.panel = panel
    this.panelSig = s.mode + '|' + s.def.params.map((p) => (!p.show || p.show(s.params) ? '1' : '0')).join('')
    for (const p of s.def.params) if (!p.show || p.show(s.params)) panel.append(this.paramRow(p))
    if (s.def.custom === 'curves') panel.append(this.curvesEditor())
    if (s.def.custom === 'gradient') panel.append(this.gradientEditor())
    if (s.def.custom === 'clone') panel.append(this.cloneControls())
    if (s.def.custom === 'liquify') panel.append(h('div', { class: 'adj-hint', text: t('adjustments.ui.liquifyHint') }))
    if (s.def.params.some((p) => p.kind === 'point'))
      panel.append(
        h('div', { class: 'prow' }, h('button', { class: 'b' + (this.pick === 'point' ? ' on' : ''), text: t('adjustments.ui.placePoint'), onclick: () => this.togglePick('point') }), h('button', { class: 'b', text: t('adjustments.ui.center'), onclick: () => this.session!.setParam(this.pointKeys()[0], 0.5, this.pointKeys()[1], 0.5) })),
        h('div', { class: 'adj-hint', text: t('adjustments.ui.pointTip') })
      )
    if (s.mode === 'pencil' && s.def.custom !== 'liquify' && s.def.custom !== 'clone') panel.append(h('div', { class: 'adj-hint', text: t('adjustments.ui.pencilHint') }))
    if (s.mode === 'layer' && !s.def.noDrag && s.mainParam) panel.append(h('div', { class: 'adj-hint', text: t('adjustments.ui.dragSliderHint') }))
    document.body.append(panel)
    this.syncPanel()
  }

  private pointKeys(): [string, string] {
    const p = this.session!.def.params.find((q) => q.kind === 'point')!
    return [p.key, p.key2!]
  }

  private paramRow(p: ParamDef): HTMLElement {
    const s = this.session!
    if (p.kind === 'point') return h('span')
    const row = h('div', { class: 'prow' })
    row.append(h('span', { class: 'lbl', text: paramLabel(s.def, p) }))
    if (p.kind === 'select') {
      const sel = h('select')
      p.options!.forEach((o, i) => sel.append(h('option', { value: String(i), text: lbl(o) })))
      sel.value = String(s.params[p.key])
      sel.addEventListener('change', () => s.setParam(p.key, Number(sel.value)))
      row.append(sel)
    } else if (p.kind === 'toggle') {
      const c = h('input', { type: 'checkbox' })
      c.checked = s.params[p.key] > 0.5
      c.addEventListener('change', () => s.setParam(p.key, c.checked ? 1 : 0))
      row.append(c)
    } else if (p.kind === 'color') {
      const c = h('input', { type: 'color' })
      c.value = colorToHex(s.params[p.key])
      c.addEventListener('input', () => s.setParam(p.key, parseInt(c.value.slice(1), 16)))
      row.append(c)
    } else {
      const r = h('input', { type: 'range', min: String(p.min), max: String(p.max), step: String(p.step ?? 1), value: String(s.params[p.key]) })
      const v = h('span', { class: 'pv', text: unitStr(p.unit, s.params[p.key]) })
      r.addEventListener('input', () => s.setParam(p.key, Number(r.value)))
      r.addEventListener('pointerdown', () => (s.activeKey = p.key))
      row.append(r, v)
      row.dataset.key = p.key
    }
    this.rowEls.set(p.key + '|' + p.label, row)
    return row
  }

  private syncPanel(): void {
    const s = this.session
    if (!s) return
    for (const row of this.rowEls.values()) {
      const key = row.dataset.key
      if (!key) continue
      const p = s.def.params.find((q) => q.key === key)!
      const r = row.querySelector('input[type=range]') as HTMLInputElement
      if (r && document.activeElement !== r) r.value = String(s.params[key])
      else if (r) r.value = String(s.params[key])
      ;(row.querySelector('.pv') as HTMLElement).textContent = unitStr(p.unit, s.params[key])
      row.classList.toggle('active', s.activeKey === key && s.mode === 'layer')
    }
  }

  private togglePick(k: 'point' | 'source'): void {
    this.pick = this.pick === k ? null : k
    this.buildPanel()
  }

  // ------------------------------------------------------------------ curves editor
  private curvesEditor(): HTMLElement {
    const s = this.session!
    const wrap = h('div')
    const cv = h('canvas', { class: 'curve', width: 512, height: 512 })
    const ctx = cv.getContext('2d')!
    const chans: ['master' | 'r' | 'g' | 'b', string, string][] = [
      ['master', t('adjustments.curves.gamma'), '#ddd'],
      ['r', t('adjustments.curves.red'), '#ff5a5a'],
      ['g', t('adjustments.curves.green'), '#5aff7a'],
      ['b', t('adjustments.curves.blue'), '#5a8aff']
    ]
    // histogram of the original layer (downsampled on the GPU first)
    let hist: ReturnType<typeof histogram> | null = null
    try {
      const t = s.fx.tmp(256, 256)
      s.fx.resample(s.orig, t)
      hist = histogram(s.app.gpu.readRGBA8(t, { x: 0, y: 0, w: 256, h: 256 }))
      s.fx.free(t)
    } catch {
      hist = null
    }
    const tabs = h('div', { class: 'tabs' })
    const draw = (): void => {
      const ch = s.extra.curveChannel
      ctx.clearRect(0, 0, 512, 512)
      ctx.strokeStyle = '#333'
      ctx.lineWidth = 1
      for (let i = 1; i < 4; i++) {
        ctx.beginPath()
        ctx.moveTo(i * 128, 0)
        ctx.lineTo(i * 128, 512)
        ctx.moveTo(0, i * 128)
        ctx.lineTo(512, i * 128)
        ctx.stroke()
      }
      if (hist) {
        const arr = ch === 'r' ? hist.r : ch === 'g' ? hist.g : ch === 'b' ? hist.b : hist.l
        let mx = 1
        for (let i = 1; i < 255; i++) mx = Math.max(mx, arr[i])
        ctx.fillStyle = 'rgba(160,160,170,.35)'
        for (let i = 0; i < 256; i++) ctx.fillRect(i * 2, 512 - Math.min(1, arr[i] / mx) * 500, 2, 512)
      }
      ctx.strokeStyle = '#555'
      ctx.beginPath()
      ctx.moveTo(0, 512)
      ctx.lineTo(512, 0)
      ctx.stroke()
      const color = chans.find((c) => c[0] === ch)![2]
      ctx.strokeStyle = color
      ctx.lineWidth = 2.5
      const f = makeCurve(s.extra.curves[ch])
      ctx.beginPath()
      for (let i = 0; i <= 256; i++) {
        const y = Math.min(1, Math.max(0, f(i / 256)))
        i ? ctx.lineTo(i * 2, 512 - y * 512) : ctx.moveTo(0, 512 - y * 512)
      }
      ctx.stroke()
      for (const pt of s.extra.curves[ch]) {
        ctx.fillStyle = '#fff'
        ctx.strokeStyle = '#000'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(pt[0] * 512, 512 - pt[1] * 512, 8, 0, 6.3)
        ctx.fill()
        ctx.stroke()
      }
      tabs.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', chans[i][0] === ch))
    }
    for (const [id, name] of chans) tabs.append(h('button', { class: 'b', text: name, onclick: () => ((s.extra.curveChannel = id), draw()) }))
    let drag: CurvePt | null = null
    const pos = (e: PointerEvent): CurvePt => {
      const r = cv.getBoundingClientRect()
      return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height))]
    }
    const hit = (p: CurvePt): CurvePt | null => {
      let best: CurvePt | null = null
      let bd = 14 / 256
      for (const q of s.extra.curves[s.extra.curveChannel]) {
        const d = Math.hypot(q[0] - p[0], q[1] - p[1])
        if (d < bd) {
          bd = d
          best = q
        }
      }
      return best
    }
    cv.addEventListener('pointerdown', (e) => {
      if (e.button === 2) return
      cv.setPointerCapture(e.pointerId)
      const p = pos(e)
      const pts = s.extra.curves[s.extra.curveChannel]
      s.beginEdit()
      drag = hit(p)
      if (!drag) {
        drag = p
        pts.push(p)
      }
      pts.sort((a, b) => a[0] - b[0])
      s.extraChanged()
      draw()
    })
    cv.addEventListener('pointermove', (e) => {
      if (!drag) return
      const p = pos(e)
      const pts = s.extra.curves[s.extra.curveChannel]
      const i = pts.indexOf(drag)
      const lo = i > 0 ? pts[i - 1][0] + 0.004 : 0
      const hi = i < pts.length - 1 ? pts[i + 1][0] - 0.004 : 1
      drag[0] = i === 0 ? Math.min(p[0], hi) : i === pts.length - 1 ? Math.max(p[0], lo) : Math.min(hi, Math.max(lo, p[0]))
      drag[1] = p[1]
      s.extraChanged()
      draw()
    })
    const end = (): void => {
      drag = null
    }
    cv.addEventListener('pointerup', end)
    cv.addEventListener('pointercancel', end)
    const del = (e: Event): void => {
      e.preventDefault()
      const p = pos(e as PointerEvent)
      const pts = s.extra.curves[s.extra.curveChannel]
      const q = hit(p)
      if (q && pts.length > 2) {
        s.beginEdit()
        pts.splice(pts.indexOf(q), 1)
        s.extraChanged()
        draw()
      }
    }
    cv.addEventListener('dblclick', del)
    cv.addEventListener('contextmenu', del)
    wrap.append(
      h('h4', { text: t('adjustments.curves.title') }),
      tabs,
      cv,
      h('div', { class: 'prow' }, h('button', { class: 'b', text: t('adjustments.curves.resetChannel'), onclick: () => {
        s.beginEdit()
        s.extra.curves[s.extra.curveChannel] = identityCurve()
        s.extraChanged()
        draw()
      } }), h('button', { class: 'b', text: t('adjustments.curves.resetAll'), onclick: () => {
        s.beginEdit()
        for (const k of ['master', 'r', 'g', 'b'] as const) s.extra.curves[k] = identityCurve()
        s.extraChanged()
        draw()
      } })),
      h('div', { class: 'adj-hint', text: t('adjustments.curves.hint') })
    )
    void curveIsIdentity
    draw()
    return wrap
  }

  // ------------------------------------------------------------------ gradient editor
  private gradientEditor(): HTMLElement {
    const s = this.session!
    const wrap = h('div')
    let sel = 0
    const bar = h('div', { class: 'adj-grad' })
    const info = h('div', { class: 'prow' })
    const cssGrad = (): string => 'linear-gradient(90deg,' + sortStops(s.extra.stops).map((st) => `rgb(${st.color.map((c) => Math.round(c * 255)).join(',')}) ${(st.pos * 100).toFixed(1)}%`).join(',') + ')'
    const rebuild = (): void => {
      bar.style.background = cssGrad()
      bar.querySelectorAll('.stop').forEach((n) => n.remove())
      s.extra.stops.forEach((st, i) => {
        const el = h('div', { class: 'stop' + (i === sel ? ' sel' : ''), style: `left:${st.pos * 100}%;background:rgb(${st.color.map((c) => Math.round(c * 255)).join(',')})` })
        el.addEventListener('pointerdown', (e) => {
          e.stopPropagation()
          sel = i
          el.setPointerCapture(e.pointerId)
          s.beginEdit()
          const move = (ev: PointerEvent): void => {
            const r = bar.getBoundingClientRect()
            st.pos = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width))
            s.extraChanged()
            bar.style.background = cssGrad()
            el.style.left = st.pos * 100 + '%'
          }
          const up = (): void => {
            el.removeEventListener('pointermove', move)
            el.removeEventListener('pointerup', up)
            rebuild()
          }
          el.addEventListener('pointermove', move)
          el.addEventListener('pointerup', up)
          rebuild()
        })
        bar.append(el)
      })
      info.replaceChildren()
      const st = s.extra.stops[sel]
      if (st) {
        const col = h('input', { type: 'color', value: colorToHex((Math.round(st.color[0] * 255) << 16) | (Math.round(st.color[1] * 255) << 8) | Math.round(st.color[2] * 255)) })
        col.addEventListener('input', () => {
          const n = parseInt(col.value.slice(1), 16)
          s.beginEdit()
          st.color = [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
          s.extraChanged()
          bar.style.background = cssGrad()
          bar.querySelectorAll<HTMLElement>('.stop')[sel].style.background = col.value
        })
        const pos = h('input', { type: 'number', min: '0', max: '100', value: String(Math.round(st.pos * 100)), style: 'width:60px' })
        pos.addEventListener('change', () => {
          s.beginEdit()
          st.pos = Math.min(1, Math.max(0, Number(pos.value) / 100))
          s.extraChanged(true)
          rebuild()
        })
        info.append(
          h('span', { class: 'lbl', text: t('adjustments.gradient.stop') }),
          col,
          pos,
          h('button', { class: 'b', text: t('adjustments.gradient.delete'), onclick: () => {
            if (s.extra.stops.length <= 2) return
            s.beginEdit()
            s.extra.stops.splice(sel, 1)
            sel = Math.max(0, sel - 1)
            s.extraChanged(true)
            rebuild()
          } })
        )
      }
    }
    bar.addEventListener('pointerdown', (e) => {
      const r = bar.getBoundingClientRect()
      const t = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
      s.beginEdit()
      s.extra.stops.push({ pos: t, color: sampleGradient(s.extra.stops, t) })
      sel = s.extra.stops.length - 1
      s.extraChanged(true)
      rebuild()
    })
    const lib = h('div', { class: 'adj-lib' })
    for (const g of GRADIENT_LIBRARY) {
      const d = h('div', { text: lbl(g.name), style: 'background:linear-gradient(90deg,' + g.stops.map((st) => `rgb(${st.color.map((c) => Math.round(c * 255)).join(',')}) ${st.pos * 100}%`).join(',') + ')' })
      d.addEventListener('click', () => {
        s.beginEdit()
        s.extra.stops = JSON.parse(JSON.stringify(g.stops))
        sel = 0
        s.extraChanged(true)
        rebuild()
      })
      lib.append(d)
    }
    wrap.append(
      h('h4', { text: t('adjustments.gradient.title') }),
      bar,
      info,
      h('div', { class: 'prow' }, h('button', { class: 'b', text: t('adjustments.gradient.reverse'), onclick: () => {
        s.beginEdit()
        for (const st of s.extra.stops) st.pos = 1 - st.pos
        s.extraChanged(true)
        rebuild()
      } })),
      h('div', { class: 'adj-hint', text: t('adjustments.gradient.hint') }),
      h('h4', { text: t('adjustments.gradient.library') }),
      lib
    )
    rebuild()
    return wrap
  }

  private cloneControls(): HTMLElement {
    const s = this.session!
    const tool = s.tool as CloneTool | null
    return h(
      'div',
      null,
      h('div', { class: 'prow' }, h('button', { class: 'b' + (this.pick === 'source' ? ' on' : ''), text: t('adjustments.clone.setSource'), onclick: () => this.togglePick('source') }), h('button', { class: 'b', text: t('adjustments.clone.resetSource'), onclick: () => {
        tool?.resetSource()
        this.refresh()
      } })),
      h('div', { class: 'adj-hint', text: t('adjustments.clone.hint') })
    )
  }

  // ------------------------------------------------------------------ overlay
  private updateOverlay(): void {
    const s = this.session
    if (!s || s.isClosed) return
    const size = this.app.cssSize()
    const v = this.app.view
    if (s.def.params.some((p) => p.kind === 'point')) {
      if (!this.ptEl) this.overlay.append((this.ptEl = h('div', { class: 'pt' })))
      const [kx, ky] = this.pointKeys()
      const p = docToScreen(v, s.inner.x + s.params[kx] * s.inner.w, s.inner.y + s.params[ky] * s.inner.h, size.w, size.h)
      this.ptEl.style.left = p.x + 'px'
      this.ptEl.style.top = p.y + 'px'
    }
    if (s.def.custom === 'clone') {
      if (!this.srcEl) this.overlay.append((this.srcEl = h('div', { class: 'src' })))
      const p = docToScreen(v, this.srcPos.x, this.srcPos.y, size.w, size.h)
      this.srcEl.style.left = p.x + 'px'
      this.srcEl.style.top = p.y + 'px'
      this.srcEl.style.display = this.srcVisible ? 'block' : 'none'
    }
    this.updateRing()
  }

  private updateRing(): void {
    const s = this.session
    if (!s || s.def.custom !== 'liquify' || !this.lastMouse) return void (this.ringEl.style.display = 'none')
    const d = liquifyRadius(s.params.size, s.fx.maxDim) * 2 * this.app.view.zoom
    this.ringEl.style.cssText = `display:block;width:${d}px;height:${d}px;left:${this.lastMouse.x - d / 2}px;top:${this.lastMouse.y - d / 2}px`
  }

  // ------------------------------------------------------------------ pointer routing
  private sample(e: PointerEvent): Sample {
    const r = this.app.canvas.getBoundingClientRect()
    const size = this.app.cssSize()
    const p = screenToDoc(this.app.view, e.clientX - r.left, e.clientY - r.top, size.w, size.h)
    let pressure = e.pressure
    if (e.pointerType === 'pen') {
      if (pressure <= 0 && e.buttons) pressure = 0.05
    } else pressure = 1
    return { x: p.x, y: p.y, pressure, tiltX: e.tiltX || 0, tiltY: e.tiltY || 0, twist: e.twist || 0, t: e.timeStamp }
  }

  // ---- finger gestures (share the recognizer with the normal canvas input)
  private onGesture(g: Gesture): void {
    const cfg = prefs.v.gestures
    const run = (id: string): void => void runAction(id, actionEnv())
    if (g.type === 'transform') {
      const r = this.app.canvas.getBoundingClientRect()
      const s = this.app.cssSize()
      this.app.setView(gestureStep(this.app.view, { x: g.prev.x - r.left, y: g.prev.y - r.top }, { x: g.cur.x - r.left, y: g.cur.y - r.top }, g.scale, g.rot, s.w, s.h))
    } else if (g.type === 'tap') run(g.fingers === 2 ? cfg.twoFingerTap : g.fingers === 3 ? cfg.threeFingerTap : cfg.fourFingerTap)
    else if (g.type === 'hold' && g.phase !== 'end') run(g.fingers === 2 ? cfg.twoFingerHold : cfg.threeFingerHold)
    else if (g.type === 'quickPinch') run(cfg.quickPinch)
  }

  private touchMove = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch' || !this.touchIds.has(e.pointerId)) return
    this.gest.move(e.pointerId, e.clientX, e.clientY, e.timeStamp)
  }

  private touchUp = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch' || !this.touchIds.delete(e.pointerId)) return
    this.gest.up(e.pointerId, e.timeStamp, e.type === 'pointercancel')
    if (!this.touchIds.size) {
      clearInterval(this.gestTimer)
      this.gestTimer = 0
    }
  }

  private down = (e: PointerEvent): void => {
    const s = this.session
    if (!s || s.isClosed || e.target !== this.app.canvas) return
    if (e.pointerType === 'touch') {
      const c = this.gest.cfg
      c.longPressMs = 0 // a held finger keeps adjusting, it must not become an eyedropper
      c.repeatMs = prefs.v.rapidUndoDelay
      c.tapMs = prefs.v.gestureAdv.tapMs
      c.moveTol = prefs.v.gestureAdv.moveTol
      c.holdMs = prefs.v.gestureAdv.holdMs
      this.touchIds.add(e.pointerId)
      this.gest.down(e.pointerId, e.clientX, e.clientY, e.timeStamp)
      if (!this.gestTimer) this.gestTimer = window.setInterval(() => this.gest.tick(performance.now()), 30)
      if (this.touchIds.size >= 2) {
        // a second finger turns the first one's drag into a navigation gesture
        if (this.ptrId !== null && this.ptrKind === 'drag') this.pendingDrag === null ? s.dragEnd() : (this.pendingDrag = null)
        if (this.ptrId !== null) this.ptrId = null
        this.ptrKind = null
        e.stopPropagation()
        e.preventDefault()
        return
      }
    }
    if (this.ptrId !== null) return
    if (e.button === 1 || e.button === 2 || this.app.input.spaceDown || this.app.input.rotateKeyDown) return
    if (e.pointerType === 'touch' && !e.isPrimary) return
    e.stopPropagation()
    e.preventDefault()
    try {
      this.app.canvas.setPointerCapture(e.pointerId)
    } catch {
      /* synthetic pointer */
    }
    this.ptrId = e.pointerId
    const smp = this.sample(e)
    const hasPoint = s.def.params.some((p) => p.kind === 'point')
    if (e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32) !== 0)) this.app.state.setTempEraser(true)
    if (s.def.custom === 'clone' && (e.altKey || this.pick === 'source')) {
      ;s.setCloneSource(smp.x, smp.y)
      this.ptrKind = 'source'
      if (this.pick === 'source') {
        this.pick = null
        this.buildPanel()
      }
      this.updateVal()
      return
    }
    if (hasPoint && (e.altKey || this.pick === 'point')) {
      this.ptrKind = 'point'
      this.setPoint(smp)
      return
    }
    if (s.mode === 'pencil') {
      if (s.toolBegin(smp)) this.ptrKind = 'tool'
      else this.ptrId = null
      return
    }
    this.ptrKind = 'drag'
    if (e.pointerType === 'touch') this.pendingDrag = e.clientX // start once the finger really moves (a 2nd finger may turn it into a gesture)
    else s.dragBegin(e.clientX)
  }

  private setPoint(smp: Sample): void {
    const s = this.session!
    const [kx, ky] = this.pointKeys()
    s.setParam(kx, Math.min(1, Math.max(0, (smp.x - s.inner.x) / s.inner.w)), ky, Math.min(1, Math.max(0, (smp.y - s.inner.y) / s.inner.h)))
  }

  private move = (e: PointerEvent): void => {
    const r = this.app.canvas.getBoundingClientRect()
    this.lastMouse = { x: e.clientX - r.left, y: e.clientY - r.top }
    this.updateRing()
    const s = this.session
    if (!s || s.isClosed || e.pointerId !== this.ptrId) return
    if (this.ptrKind === 'drag') {
      if (this.pendingDrag !== null) {
        if (Math.abs(e.clientX - this.pendingDrag) < 6) return
        s.dragBegin(this.pendingDrag)
        this.pendingDrag = null
      }
      s.dragMove(e.clientX)
    }
    else if (this.ptrKind === 'point') this.setPoint(this.sample(e))
    else if (this.ptrKind === 'tool') {
      const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : []
      s.toolMove((list.length ? list : [e]).map((ev) => this.sample(ev)))
    }
  }

  private up = (e: PointerEvent): void => {
    const s = this.session
    if (e.pointerId !== this.ptrId) return
    this.ptrId = null
    this.app.state.setTempEraser(false)
    if (!s || s.isClosed) return
    if (this.ptrKind === 'drag') this.pendingDrag === null ? s.dragEnd() : (this.pendingDrag = null)
    else if (this.ptrKind === 'tool') s.toolEnd()
    this.ptrKind = null
    this.refresh()
  }

  private key = (e: KeyboardEvent): void => {
    if (!this.session || this.session.isClosed) return
    const t = e.target as HTMLElement | null
    const typing = !!t && (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'range' && (t as HTMLInputElement).type !== 'checkbox' ? true : t.tagName === 'TEXTAREA')
    if (e.key === 'Escape') {
      this.finish(false)
      e.preventDefault()
    } else if (e.key === 'Enter' && !typing) {
      this.finish(true)
      e.preventDefault()
    }
  }
}
