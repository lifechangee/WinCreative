import type { App } from '../../app/app'
import { onLangChange, t } from '../../i18n'
import { h } from '../../ui/dom'
import { runCutAction, type CutAction } from './cutout'
import { MODELS, modelBytes, type ModelId, type ModelStatus } from './manifest'
import { saveSs, ss, type CombineMode, type SmartMode } from './settings'
import type { SmartSelect } from './smart'

const CSS = `
.ss-bar{width:max-content;position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:61;max-width:calc(100vw - 24px);background:var(--panel,#2a2a2d);border:1px solid var(--line,#3d3d42);border-radius:14px;box-shadow:0 10px 34px #000a;padding:8px 10px;display:flex;flex-direction:column;gap:8px;color:var(--text,#e8e8ea);font-size:13px;user-select:none}
.ss-bar .sx-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px;justify-content:center}
.ss-bar button{background:var(--panel2,#333338);border:1px solid var(--line,#3d3d42);color:inherit;border-radius:9px;padding:7px 11px;cursor:pointer;min-height:34px;touch-action:manipulation;white-space:normal}
.ss-bar button:hover:not(:disabled){background:#3d3d44}
.ss-bar button:disabled{opacity:.45;cursor:default}
.ss-bar button.on,.ss-bar button.on:hover:not(:disabled),.ss-bar button.primary,.ss-bar button.primary:hover:not(:disabled){background:var(--accent,#3b82f6);border-color:transparent;color:#fff}
.ss-bar button.on:hover:not(:disabled),.ss-bar button.primary:hover:not(:disabled){filter:brightness(1.12)}
.ss-bar .sep{width:1px;align-self:stretch;background:var(--line,#3d3d42);margin:0 2px}
.ss-bar label{display:flex;align-items:center;gap:6px;color:var(--dim,#9a9aa2);min-width:0}
.ss-bar input[type=range]{width:96px}
.ss-bar select{background:var(--panel2,#333338);color:inherit;border:1px solid var(--line,#3d3d42);border-radius:8px;padding:6px}
.ss-modes{display:flex;gap:6px;flex-wrap:wrap;justify-content:center;align-items:stretch}
.ss-mode{display:flex;align-items:center;gap:4px;background:#0002;border-radius:11px;padding:2px}
.ss-mode .ss-extra{display:flex;align-items:center;gap:6px;padding:0 6px 0 2px;color:var(--dim,#9a9aa2);font-size:12px}
.ss-prog{width:90px;height:6px;border-radius:4px;background:#0006;overflow:hidden}
.ss-prog>i{display:block;height:100%;background:var(--accent,#3b82f6)}
.ss-status{display:flex;align-items:center;gap:8px;color:var(--dim,#9a9aa2);font-size:12px;min-height:20px;justify-content:center;flex-wrap:wrap}
.ss-spin{width:12px;height:12px;border-radius:50%;border:2px solid #fff4;border-top-color:var(--accent,#3b82f6);animation:ss-rot .8s linear infinite}
@keyframes ss-rot{to{transform:rotate(360deg)}}
.ss-hint{color:var(--dim,#9a9aa2);font-size:12px;text-align:center;max-width:620px}
`

let styled = false
function injectCss(): void {
  if (styled) return
  styled = true
  const s = document.createElement('style')
  s.textContent = CSS
  document.head.append(s)
}

const mb = (bytes: number): string => t('smartselect.bar.sizeMb', { n: Math.round(bytes / 1048576) })

/** Floating bar of the Smart selection tool. The mode switch lives right here (no trip through Preferences). */
export class SmartBar {
  readonly el: HTMLElement
  private statusEl: HTMLElement
  private models = new Map<ModelId, ModelStatus>()
  private dl: { id: ModelId; done: number; total: number } | null = null
  private progBar: HTMLElement | null = null
  private progText: HTMLElement | null = null

  private paintProgress(): void {
    if (!this.dl || !this.progBar || !this.progText) return
    const pct = Math.round((this.dl.done / Math.max(1, this.dl.total)) * 100)
    this.progBar.style.width = pct + '%'
    this.progText.textContent = t('smartselect.bar.downloading', { pct })
  }

  constructor(private c: SmartSelect, private app: App) {
    injectCss()
    this.el = h('div', { class: 'ss-bar', style: 'display:none' })
    this.statusEl = h('div', { class: 'ss-status' })
    document.body.append(this.el)
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation())
    c.events.on('change', () => this.render())
    c.events.on('busy', () => this.updateStatus())
    c.engine.events.on('stats', () => this.updateStatus())
    onLangChange(() => c.active && this.render())
    window.smartselectApi?.onProgress((p) => {
      if (p.state === 'progress' || p.state === 'start') {
        const first = !this.dl
        this.dl = { id: p.id as ModelId, done: p.done, total: p.total }
        // patch the bar in place: rebuilding the buttons under the pointer would swallow the click on Cancel
        if (!first && this.progBar?.isConnected) return this.paintProgress()
      } else {
        this.dl = null
        if (p.state === 'error') this.app.notify(t('smartselect.toast.downloadFailed', { error: p.error ?? '' }))
        void this.refreshModels()
      }
      this.render()
    })
    void this.refreshModels()
  }

  async refreshModels(): Promise<void> {
    const list = (await window.smartselectApi?.status()) ?? []
    for (const m of list) this.models.set(m.id as ModelId, m as ModelStatus)
    this.render()
  }

  get precise(): ModelStatus | undefined {
    return this.models.get('precise')
  }

  private btn(label: string, on: boolean, fn: () => void, title = '', cls = ''): HTMLButtonElement {
    const b = h('button', { text: label, title, class: (on ? 'on ' : '') + cls })
    b.addEventListener('click', fn)
    return b
  }
  private sep(): HTMLElement {
    return h('div', { class: 'sep' })
  }
  private range(label: string, min: number, max: number, step: number, val: number, on: (v: number) => void, fmt: (v: number) => string, title = ''): HTMLElement {
    const out = h('span', { text: fmt(val), style: 'min-width:34px;text-align:right;color:#e8e8ea' })
    const inp = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(val), title })
    inp.addEventListener('input', () => {
      const v = parseFloat(inp.value)
      out.textContent = fmt(v)
      on(v)
    })
    return h('label', { title }, h('span', { text: label }), inp, out)
  }
  private check(label: string, val: boolean, on: (v: boolean) => void, title = ''): HTMLElement {
    const cb = h('input', { type: 'checkbox', checked: val })
    cb.addEventListener('change', () => on(cb.checked))
    return h('label', { title }, cb, h('span', { text: label }))
  }

  render(): void {
    const c = this.c
    const el = this.el
    el.style.display = c.active ? 'flex' : 'none'
    if (!c.active) return
    // do not rebuild the DOM under a slider the user is dragging
    const ae = document.activeElement as HTMLInputElement | null
    if (ae && el.contains(ae) && ae.type === 'range' && ae.matches(':active')) return
    el.replaceChildren()
    el.append(this.modesRow(), this.optionsRow(), this.edgeRow(), this.actionsRow(), this.statusEl)
    this.updateStatus()
  }

  // ---------------------------------------------------------------- rows
  private modesRow(): HTMLElement {
    const c = this.c
    const row = h('div', { class: 'ss-modes' })
    const setMode = (m: SmartMode): void => {
      if (m === 'precise' && !this.precise?.installed) {
        this.app.notify(t('smartselect.toast.modelMissing'))
        return
      }
      c.setMode(m)
      saveSs()
    }
    row.append(h('div', { class: 'ss-mode' }, this.btn(t('smartselect.bar.fast'), ss.mode === 'fast', () => setMode('fast'), t('smartselect.bar.fast.tip'))))
    const pm = MODELS.precise
    const st = this.precise
    const extra = h('div', { class: 'ss-extra' })
    if (this.dl && this.dl.id === 'precise') {
      const pct = Math.round((this.dl.done / Math.max(1, this.dl.total)) * 100)
      this.progBar = h('i', { style: `width:${pct}%` })
      this.progText = h('span', { text: t('smartselect.bar.downloading', { pct }) })
      extra.append(
        h('div', { class: 'ss-prog' }, this.progBar),
        this.progText,
        this.btn(t('core.common.cancel'), false, () => void window.smartselectApi?.cancel('precise'))
      )
    } else if (st && !st.installed) {
      extra.append(
        h('span', { text: mb(modelBytes(pm)) }),
        this.btn(t('smartselect.bar.download'), false, () => void window.smartselectApi?.download('precise'), t('smartselect.bar.downloadTip', { name: pm.title, size: mb(modelBytes(pm)) }), 'primary')
      )
    } else if (st?.installed) {
      extra.append(h('span', { text: mb(st.diskBytes || modelBytes(pm)) }), this.btn('✕', false, () => void this.deleteModel(), t('smartselect.bar.deleteModel')))
    }
    row.append(h('div', { class: 'ss-mode' }, this.btn(t('smartselect.bar.precise'), ss.mode === 'precise', () => setMode('precise'), t('smartselect.bar.precise.tip', { name: pm.title })), extra))
    row.append(h('div', { class: 'ss-mode' }, this.btn(t('smartselect.bar.brush'), ss.mode === 'brush', () => setMode('brush'), t('smartselect.bar.brush.tip'))))
    return row
  }

  private async deleteModel(): Promise<void> {
    if (ss.mode === 'precise') this.c.setMode('fast')
    this.c.engine.release()
    await window.smartselectApi?.remove('precise')
    await this.refreshModels()
  }

  private optionsRow(): HTMLElement {
    const c = this.c
    const row = h('div', { class: 'sx-row' })
    const modes: [CombineMode, string][] = [['replace', t('smartselect.bar.replace')], ['add', t('smartselect.bar.add')], ['subtract', t('smartselect.bar.subtract')], ['intersect', t('smartselect.bar.intersect')]]
    for (const [m, l] of modes)
      row.append(
        this.btn(l, ss.combine === m, () => {
          c.session?.live && c.finishSession(true)
          ss.combine = m
          saveSs()
          this.render()
        }, t('smartselect.bar.combine.tip'))
      )
    row.append(this.sep())
    row.append(
      this.btn(t('smartselect.bar.negative'), ss.negative, () => {
        ss.negative = !ss.negative
        this.render()
      }, t('smartselect.bar.negative.tip'))
    )
    const sample = h('select', { title: t('smartselect.bar.sample.tip') }, h('option', { value: 'layer', text: t('smartselect.bar.sample.layer') }), h('option', { value: 'all', text: t('smartselect.bar.sample.all') }))
    sample.value = ss.sample
    sample.addEventListener('change', () => {
      c.finishSession(true)
      ss.sample = sample.value as typeof ss.sample
      saveSs()
      c.resample()
      this.render()
    })
    row.append(h('label', null, h('span', { text: t('smartselect.bar.sample') }), sample))
    if (ss.mode === 'brush') {
      row.append(this.range(t('smartselect.bar.brushSize'), 6, 160, 1, ss.brushSize, (v) => ((ss.brushSize = v), saveSs(), c.overlay.invalidate()), (v) => String(Math.round(v)), t('smartselect.bar.brushSize.tip')))
    } else {
      const lv = h(
        'select',
        { title: t('smartselect.bar.level.tip') },
        h('option', { value: '0', text: t('smartselect.bar.level.auto') }),
        h('option', { value: '1', text: t('smartselect.bar.level.part') }),
        h('option', { value: '2', text: t('smartselect.bar.level.object') }),
        h('option', { value: '3', text: t('smartselect.bar.level.whole') })
      )
      lv.value = String(ss.level)
      lv.addEventListener('change', () => {
        ss.level = parseInt(lv.value, 10)
        saveSs()
        c.runAI()
      })
      row.append(h('label', null, h('span', { text: t('smartselect.bar.level') }), lv))
      row.append(this.btn(t('smartselect.bar.refineView'), !!c.viewRegion, () => c.refineInView(), t('smartselect.bar.refineView.tip')))
      row.append(this.check(t('smartselect.bar.hover'), ss.hover, (v) => ((ss.hover = v), saveSs()), t('smartselect.bar.hover.tip')))
    }
    return row
  }

  private edgeRow(): HTMLElement {
    const c = this.c
    const row = h('div', { class: 'sx-row' })
    const re = (): void => (saveSs(), c.rerefineSoon())
    row.append(
      this.range(t('smartselect.bar.smooth'), 0, 1, 0.05, ss.smooth, (v) => ((ss.smooth = v), re()), (v) => Math.round(v * 100) + '%', t('smartselect.bar.smooth.tip')),
      this.range(t('smartselect.bar.feather'), 0, 40, 0.5, ss.feather, (v) => ((ss.feather = v), re()), (v) => v + ' px', t('smartselect.bar.feather.tip')),
      this.range(t('smartselect.bar.shift'), -20, 20, 0.5, ss.shift, (v) => ((ss.shift = v), re()), (v) => (v > 0 ? '+' : '') + v + ' px', t('smartselect.bar.shift.tip')),
      this.check(t('smartselect.bar.decon'), ss.decontaminate, (v) => ((ss.decontaminate = v), saveSs()), t('smartselect.bar.decon.tip'))
    )
    return row
  }

  private actionsRow(): HTMLElement {
    const c = this.c
    const row = h('div', { class: 'sx-row' })
    const cut = (a: CutAction) => async (): Promise<void> => {
      c.finishSession(true)
      await runCutAction(this.app, c.engine, a)
    }
    row.append(
      this.btn(t('smartselect.bar.cutNew'), false, cut('cut'), t('smartselect.bar.cutNew.tip')),
      this.btn(t('smartselect.bar.copyNew'), false, cut('copy'), t('smartselect.bar.copyNew.tip')),
      this.btn(t('smartselect.bar.removeBg'), false, cut('removeBg'), t('smartselect.bar.removeBg.tip')),
      this.btn(t('smartselect.bar.copyObject'), false, cut('copyObject'), t('smartselect.bar.copyObject.tip')),
      this.sep(),
      this.btn(t('smartselect.bar.next'), false, () => c.nextObject(), t('smartselect.bar.next.tip')),
      this.btn(t('smartselect.bar.reset'), false, () => c.resetPoints(), t('smartselect.bar.reset.tip')),
      this.btn(t('selectxform.bar.invert'), false, () => this.app.selection.invert()),
      this.btn(t('selectxform.bar.deselect'), false, () => {
        c.finishSession(true)
        this.app.selection.clear()
      }),
      this.btn(t('core.common.done'), true, () => c.deactivate(true), t('smartselect.bar.done.tip'), 'primary')
    )
    return row
  }

  /** busy chip + engine info + hint, patched without rebuilding the bar */
  updateStatus(): void {
    const c = this.c
    const s = this.statusEl
    s.replaceChildren()
    if (c.busy) {
      s.append(h('div', { class: 'ss-spin' }), h('span', { text: c.busy.text }))
      if (c.busy.cancellable) s.append(this.btn(t('core.common.cancel'), false, () => c.cancelBusy()))
    } else {
      const n = c.pointCount
      const st = c.engine.stats
      const parts: string[] = []
      if (ss.mode === 'brush') parts.push(t('smartselect.bar.brushHint'))
      else if (n) parts.push(t('smartselect.bar.points', { count: n }))
      else parts.push(t('smartselect.bar.aiHint'))
      if (ss.mode !== 'brush' && c.engine.loadedModel && st.ep) parts.push(t('smartselect.bar.engine', { ep: st.ep === 'webgpu' ? 'WebGPU' : 'WASM', ms: Math.round(st.lastEncodeMs) }))
      s.append(h('span', { text: parts.join('  ·  ') }))
    }
  }
}
