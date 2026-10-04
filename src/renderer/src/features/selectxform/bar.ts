import type { App } from '../../app/app'
import { onLangChange, t, tk } from '../../i18n'
import { h } from '../../ui/dom'
import { clearSelection, colorFillSelection, copyPaste, selectLayerContents } from './actions'
import type { LiveEdit } from './selection'
import { selSettings, SelShape, SelectionTool } from './selTool'
import type { TransformTool } from './xformTool'
import { saveXformSettings, xs, XMode } from './xformSession'

const CSS = `
.sx-bar{width:max-content;position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:60;max-width:calc(100vw - 24px);background:var(--panel,#2a2a2d);border:1px solid var(--line,#3d3d42);border-radius:14px;box-shadow:0 10px 34px #000a;padding:8px 10px;display:flex;flex-direction:column;gap:8px;color:var(--text,#e8e8ea);font-size:13px;user-select:none}
.sx-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px;justify-content:center}
.sx-bar button{background:var(--panel2,#333338);border:1px solid var(--line,#3d3d42);color:inherit;border-radius:9px;padding:8px 11px;cursor:pointer;min-height:36px;touch-action:manipulation}
.sx-bar button:hover{background:#3d3d44}
.sx-bar button.on{background:var(--accent,#3b82f6);border-color:transparent;color:#fff}
.sx-bar button.primary{background:var(--accent,#3b82f6);border-color:transparent;color:#fff}
.sx-bar .sep{width:1px;align-self:stretch;background:var(--line,#3d3d42);margin:0 2px}
.sx-bar label{display:flex;align-items:center;gap:6px;color:var(--dim,#9a9aa2)}
.sx-bar input[type=range]{width:110px}
.sx-bar select{background:var(--panel2,#333338);color:inherit;border:1px solid var(--line,#3d3d42);border-radius:8px;padding:6px}
.sx-bar input[type=text]{background:#1c1c1e;color:inherit;border:1px solid var(--line,#3d3d42);border-radius:8px;padding:6px 8px;width:130px}
.sx-saved{display:flex;gap:6px;align-items:center;background:#0002;border-radius:8px;padding:3px 6px}
`

let styled = false
function injectCss(): void {
  if (styled) return
  styled = true
  const s = document.createElement('style')
  s.textContent = CSS
  document.head.append(s)
}

export interface BarDeps {
  app: App
  sel: SelectionTool
  xf: TransformTool
  setShape(s: SelShape): void
  startTransform(m: XMode): void
  closeAll(commit?: boolean): void
}

/** Floating tool bar for the Selection and Transform tools. */
export class Bar {
  readonly el: HTMLElement
  private mode: 'selection' | 'transform' | null = null
  private sub: null | 'feather' | 'saveload' = null
  private feather: { edit: LiveEdit; pct: number } | null = null
  constructor(private d: BarDeps) {
    injectCss()
    this.el = h('div', { class: 'sx-bar', style: 'display:none' })
    document.body.append(this.el)
    // keep touches on the bar from reaching the canvas handlers
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation())
    onLangChange(() => this.mode && this.render())
  }

  show(mode: 'selection' | 'transform' | null): void {
    if (mode !== this.mode) this.closeFeather(false)
    this.mode = mode
    if (mode !== 'selection') this.sub = null
    this.render()
  }

  render(): void {
    const el = this.el
    el.replaceChildren()
    el.style.display = this.mode ? 'flex' : 'none'
    if (this.mode === 'selection') this.renderSelection()
    else if (this.mode === 'transform') this.renderTransform()
  }

  private btn(label: string, on: boolean, fn: () => void, title = ''): HTMLButtonElement {
    // '@name' = icon from the shared set
    const b = h('button', label.startsWith('@') ? { icon: label.slice(1), title, class: on ? 'on' : '' } : { text: label, title, class: on ? 'on' : '' })
    b.addEventListener('click', fn)
    return b
  }
  private sep(): HTMLElement {
    return h('div', { class: 'sep' })
  }
  private range(label: string, min: number, max: number, step: number, val: number, on: (v: number) => void, fmt: (v: number) => string): HTMLElement {
    const out = h('span', { text: fmt(val), style: 'min-width:38px;text-align:right;color:#e8e8ea' })
    const inp = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(val) })
    inp.addEventListener('input', () => {
      const v = parseFloat(inp.value)
      out.textContent = fmt(v)
      on(v)
    })
    return h('label', null, h('span', { text: label }), inp, out)
  }

  // ------------------------------------------------------------------ selection
  private renderSelection(): void {
    const { app, sel } = this.d
    const svc = app.selection
    const r1 = h('div', { class: 'sx-row' })
    const shapes: [SelShape, string][] = [['auto', t('selectxform.bar.automatic')], ['free', t('selectxform.bar.freehand')], ['rect', t('selectxform.bar.rectangle')], ['ellipse', t('selectxform.bar.ellipse')]]
    for (const [s, l] of shapes) r1.append(this.btn(l, selSettings.shape === s, () => this.d.setShape(s)))
    r1.append(this.sep())
    r1.append(
      this.btn(t('selectxform.bar.add'), selSettings.mode === 'add', () => {
        selSettings.mode = selSettings.mode === 'add' ? 'replace' : 'add'
        this.render()
      }, t('selectxform.bar.addToSelection')),
      this.btn(t('selectxform.bar.remove'), selSettings.mode === 'subtract', () => {
        selSettings.mode = selSettings.mode === 'subtract' ? 'replace' : 'subtract'
        this.render()
      }, t('selectxform.bar.subtractFromSelection'))
    )
    if (selSettings.shape === 'rect' || selSettings.shape === 'ellipse') {
      const cb = h('input', { type: 'checkbox', checked: selSettings.uniform })
      cb.addEventListener('change', () => (selSettings.uniform = cb.checked))
      r1.append(h('label', null, cb, h('span', { text: selSettings.shape === 'rect' ? t('selectxform.bar.square') : t('selectxform.bar.circle') })))
    }
    if (selSettings.shape === 'auto') {
      const sel2 = h('select', null, h('option', { value: 'layer', text: t('selectxform.bar.layer') }), h('option', { value: 'reference', text: t('selectxform.bar.canvasReference') }))
      sel2.value = selSettings.source
      sel2.addEventListener('change', () => (selSettings.source = sel2.value as 'layer' | 'reference'))
      r1.append(h('label', null, h('span', { text: t('selectxform.bar.source') }), sel2))
      r1.append(h('span', { text: t('selectxform.bar.threshold'), style: 'color:#9a9aa2;font-size:12px' }))
    }
    if (selSettings.shape === 'free') {
      r1.append(this.btn(t('selectxform.bar.close'), false, () => sel.closePolygon(), t('selectxform.bar.closeTip')), this.btn(t('selectxform.bar.cancel'), false, () => sel.cancelPolygon()))
    }
    const r2 = h('div', { class: 'sx-row' })
    r2.append(
      this.btn(t('selectxform.bar.invert'), false, () => svc.invert()),
      this.btn(t('selectxform.bar.copyPaste'), false, () => copyPaste(app, false), t('selectxform.bar.copyPasteTip')),
      this.btn(t('selectxform.bar.cutPaste'), false, () => copyPaste(app, true)),
      this.btn(t('selectxform.bar.feather'), this.sub === 'feather', () => this.toggleSub('feather')),
      this.btn(t('selectxform.bar.saveLoad'), this.sub === 'saveload', () => this.toggleSub('saveload')),
      this.btn(t('selectxform.bar.colorFill'), false, () => colorFillSelection(app)),
      this.btn(t('selectxform.bar.clear'), false, () => clearSelection(app)),
      this.sep(),
      this.btn(t('selectxform.bar.all'), false, () => svc.selectAll()),
      this.btn(t('selectxform.bar.layerContents'), false, () => selectLayerContents(app), t('selectxform.bar.layerContentsTip')),
      this.btn(t('selectxform.bar.deselect'), false, () => svc.clear()),
      this.sep(),
      this.range(t('selectxform.bar.mask'), 0, 1, 0.05, svc.maskVisibility, (v) => svc.setMaskVisibility(v), (v) => Math.round(v * 100) + '%'),
      this.btn('@clear', false, () => this.d.closeAll(), t('selectxform.bar.closeToolsTip'))
    )
    this.el.append(r1, r2)
    if (this.sub === 'feather') this.el.append(this.featherRow())
    if (this.sub === 'saveload') this.el.append(this.saveLoadRow())
  }

  toggleSub(s: 'feather' | 'saveload'): void {
    if (this.sub === s) {
      this.closeFeather(false)
      this.sub = null
    } else {
      this.closeFeather(false)
      this.sub = s
      if (s === 'feather') {
        if (!this.d.app.selection.hasSelection()) {
          this.d.app.notify(t('selectxform.action.makeSelection'))
          this.sub = null
        } else this.feather = { edit: this.d.app.selection.begin(), pct: 0 }
      }
    }
    this.render()
  }

  private closeFeather(commit: boolean): void {
    const f = this.feather
    this.feather = null
    if (!f) return
    if (commit && f.pct > 0) f.edit.commit('Feather selection')
    else f.edit.cancel()
  }

  private featherRow(): HTMLElement {
    const row = h('div', { class: 'sx-row' })
    const app = this.d.app
    const maxDim = Math.max(app.doc.width, app.doc.height)
    row.append(
      this.range(t('selectxform.bar.featherRange'), 0, 100, 1, this.feather?.pct ?? 0, (v) => {
        if (!this.feather) return
        this.feather.pct = v
        const radius = (v / 100) * maxDim * 0.05
        if (v === 0) this.feather.edit.cancel(), (this.feather.edit = app.selection.begin())
        else this.feather.edit.previewBlur(radius)
      }, (v) => v + '%'),
      this.btn(t('selectxform.bar.featherApply'), false, () => {
        this.closeFeather(true)
        this.sub = null
        this.render()
      }),
      this.btn(t('selectxform.bar.featherCancel'), false, () => {
        this.closeFeather(false)
        this.sub = null
        this.render()
      })
    )
    return row
  }

  private saveLoadRow(): HTMLElement {
    const svc = this.d.app.selection
    const row = h('div', { class: 'sx-row' })
    const name = h('input', { type: 'text', placeholder: t('selectxform.bar.selectionName'), value: t('selectxform.bar.savedName', { n: svc.savedList().length + 1 }) })
    row.append(
      name,
      this.btn(t('selectxform.bar.selectionSave'), false, () => {
        if (!svc.saveCurrent(name.value.trim() || t('selectxform.bar.savedDefault'))) this.d.app.notify(t('selectxform.action.makeSelection'))
        this.render()
      })
    )
    for (const s of svc.savedList()) {
      const chip = h('div', { class: 'sx-saved' }, h('span', { text: s.name }))
      chip.append(
        this.btn(t('selectxform.bar.selectionLoad'), false, () => svc.load(s.name, 'replace')),
        this.btn('@plus', false, () => svc.load(s.name, 'add'), t('selectxform.bar.selectionAdd')),
        this.btn('@minus', false, () => svc.load(s.name, 'subtract'), t('selectxform.bar.selectionSubtract')),
        this.btn('@clear', false, () => {
          svc.deleteSaved(s.name)
          this.render()
        })
      )
      row.append(chip)
    }
    if (!svc.savedList().length) row.append(h('span', { text: t('selectxform.bar.noSavedSelections'), style: 'color:#9a9aa2' }))
    return row
  }

  // ------------------------------------------------------------------ transform
  private renderTransform(): void {
    const xf = this.d.xf
    const s = xf.session
    if (!s) return
    const r1 = h('div', { class: 'sx-row' })
    const modes: [XMode, string][] = [['freeform', t('selectxform.xform.freeform')], ['uniform', t('selectxform.xform.uniform')], ['distort', t('selectxform.xform.distort')], ['warp', t('selectxform.xform.warp')], ['bend', t('selectxform.xform.bend')]]
    for (const [m, l] of modes) r1.append(this.btn(l, s.mode === m, () => this.d.startTransform(m)))
    r1.append(
      this.sep(),
      this.btn(t('selectxform.xform.flipH'), false, () => s.flip('h')),
      this.btn(t('selectxform.xform.flipV'), false, () => s.flip('v')),
      this.btn(t('selectxform.xform.rotate45'), false, () => s.rotate45()),
      this.btn(t('selectxform.xform.fitToScreen'), false, () => s.fitToScreen()),
      this.btn(t('selectxform.xform.reset'), false, () => s.reset())
    )
    const r2 = h('div', { class: 'sx-row' })
    const interp = h('select', null, h('option', { value: 'nearest', text: t('selectxform.xform.nearest') }), h('option', { value: 'bilinear', text: t('selectxform.xform.bilinear') }), h('option', { value: 'bicubic', text: t('selectxform.xform.bicubic') }))
    interp.value = xs.interp
    interp.addEventListener('change', () => {
      xs.interp = interp.value as typeof xs.interp
      saveXformSettings()
      s.render()
    })
    r2.append(
      h('label', null, h('span', { text: t('selectxform.xform.interpolation') }), interp),
      this.sep(),
      this.btn(t('selectxform.xform.magnetics'), xs.magnetics, () => {
        xs.magnetics = !xs.magnetics
        saveXformSettings()
        this.render()
      }, t('selectxform.xform.magneticsTip')),
      this.btn(t('selectxform.xform.guides'), xs.snapGuides, () => {
        xs.snapGuides = !xs.snapGuides
        saveXformSettings()
        this.render()
      }, t('selectxform.xform.guidesTip')),
      this.range(t('selectxform.xform.distance'), 2, 40, 1, xs.snapDist, (v) => ((xs.snapDist = v), saveXformSettings()), (v) => v + 'px'),
      this.range(t('selectxform.xform.velocity'), 0.2, 5, 0.1, xs.snapVelocity, (v) => ((xs.snapVelocity = v), saveXformSettings()), (v) => v.toFixed(1)),
      this.sep(),
      this.btn(t('selectxform.xform.advancedMesh'), xs.advancedMesh, () => {
        xs.advancedMesh = !xs.advancedMesh
        saveXformSettings()
        if (xs.advancedMesh) {
          this.d.startTransform('warp')
          s.setGrid(xs.cols, xs.rows)
        }
        this.render()
      })
    )
    if (xs.advancedMesh && s.mode === 'warp') {
      r2.append(
        this.range(t('selectxform.xform.columns'), 2, 16, 1, xs.cols, (v) => s.setGrid(v, xs.rows), (v) => String(v)),
        this.range(t('selectxform.xform.rows'), 2, 16, 1, xs.rows, (v) => s.setGrid(xs.cols, v), (v) => String(v))
      )
    }
    const r3 = h('div', { class: 'sx-row' })
    const all = h('input', { type: 'checkbox', checked: xs.allLayers })
    all.addEventListener('change', () => {
      xs.allLayers = all.checked
      saveXformSettings()
      const mode = s.mode
      xf.discard()
      xf.start(mode)
      this.render()
    })
    r3.append(
      h('label', null, all, h('span', { text: t('selectxform.xform.allLayers') })),
      h('span', { text: t(s.selectionBased ? 'selectxform.bar.layersSel' : 'selectxform.bar.layersOnly', { count: s.layerCount }), style: 'color:#9a9aa2' }),
      this.sep(),
      this.btn(t('selectxform.xform.cancel'), false, () => this.d.closeAll()),
      this.btn(t('selectxform.xform.done'), true, () => this.d.closeAll(true))
    )
    this.el.append(r1, r2, r3)
  }
}
