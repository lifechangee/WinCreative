import { I18nText, tk } from '../../i18n'
import { h } from '../../ui/dom'

const CSS = `
.bwf-panel{position:fixed;z-index:60;background:var(--panel,#2a2a2d);border:1px solid var(--line,#3d3d42);border-radius:12px;box-shadow:0 12px 40px #000a;color:var(--text,#e8e8ea);display:none;max-height:calc(100vh - 70px);overflow:auto}
.bwf-panel.open{display:block}
.bwf-head{display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:move;border-bottom:1px solid var(--line,#3d3d42);position:sticky;top:0;background:inherit;z-index:1;-webkit-app-region:no-drag}
.bwf-head .t{flex:1;font-weight:600;font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:var(--dim,#9a9aa2)}
.bwf-body{padding:8px 10px 10px}
.bwf-btn{background:var(--panel2,#333337);border:1px solid var(--line,#3d3d42);color:inherit;border-radius:7px;padding:5px 10px;cursor:pointer;font:inherit}
.bwf-btn:hover{background:#3d3d42}
.bwf-btn.on{background:var(--accent,#3b82f6);border-color:var(--accent,#3b82f6);color:#fff}
.bwf-btn.primary{background:var(--accent,#3b82f6);border-color:var(--accent,#3b82f6);color:#fff}
.bwf-seg{display:flex;gap:4px;margin:6px 0;flex-wrap:wrap}
.bwf-seg .bwf-btn{flex:1 1 auto;min-width:0;padding:5px 4px;text-align:center;white-space:normal;overflow-wrap:anywhere;font-size:12px}
.bwf-row{display:flex;align-items:center;gap:8px;margin:6px 0}
.bwf-row .l{width:104px;color:var(--dim,#9a9aa2);flex:none}
.bwf-row input[type=range]{flex:1;min-width:0;accent-color:var(--accent,#3b82f6)}
.bwf-row .v{width:44px;text-align:right;color:var(--dim,#9a9aa2);flex:none}
.bwf-row select,.bwf-row input[type=text],.bwf-row input[type=number]{flex:1;min-width:0;background:var(--panel2,#333337);color:inherit;border:1px solid var(--line,#3d3d42);border-radius:6px;padding:5px}
.bwf-row input[type=color]{width:34px;height:26px;padding:0;border:1px solid var(--line,#3d3d42);border-radius:6px;background:none}
.bwf-sec{margin:10px 0 2px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--dim,#9a9aa2)}
.bwf-hue{-webkit-appearance:none;appearance:none;height:10px;border-radius:5px;background:linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)}
.bwf-list{max-height:180px;overflow:auto;border:1px solid var(--line,#3d3d42);border-radius:8px;margin:6px 0}
.bwf-list .it{padding:5px 8px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bwf-list .it:hover{background:var(--panel2,#333337)}
.bwf-list .it.sel{background:var(--accent,#3b82f6);color:#fff}
.bwf-note{color:var(--dim,#9a9aa2);font-size:11px;margin:4px 0}
.bwf-panel input,.bwf-panel textarea,.bwf-panel select{-webkit-user-select:text;user-select:text}
`

let injected = false
export function injectCss(extra = ''): void {
  if (injected && !extra) return
  const st = document.createElement('style')
  st.textContent = injected ? extra : CSS + extra
  document.head.append(st)
  injected = true
}

export interface FloatPanel {
  el: HTMLElement
  body: HTMLElement
  title: HTMLElement
  readonly isOpen: boolean
  open(): void
  close(): void
  toggle(): void
  onClose: (() => void) | null
}

const allPanels: FloatPanel[] = []

/** Draggable non-modal panel (does not close when the canvas is clicked, unlike popovers). */
export function floatPanel(title: I18nText, width: number, pos: { right?: number; left?: number; top?: number; bottom?: number }): FloatPanel {
  injectCss()
  const closeBtn = h('button', { class: 'bwf-btn', text: tk('core.common.done') })
  const titleEl = h('div', { class: 't', text: title })
  const head = h('div', { class: 'bwf-head' }, titleEl, closeBtn)
  const body = h('div', { class: 'bwf-body' })
  const el = h('div', { class: 'bwf-panel', style: `width:${width}px` }, head, body)
  const set = (k: string, v?: number): void => void (v !== undefined && (el.style[k as 'left'] = v + 'px'))
  set('right', pos.right)
  set('left', pos.left)
  set('top', pos.top)
  set('bottom', pos.bottom)
  document.body.append(el)
  const p: FloatPanel = {
    el,
    body,
    title: titleEl,
    get isOpen() {
      return el.classList.contains('open')
    },
    open: () => {
      // panels that share a default anchor would stack on top of each other: close the previous one
      for (const o of allPanels) if (o !== p && o.isOpen && o.el.style.top === el.style.top && o.el.style.right === el.style.right && o.el.style.left === el.style.left) o.close()
      el.classList.add('open')
    },
    close: () => {
      if (!el.classList.contains('open')) return
      el.classList.remove('open')
      p.onClose?.()
    },
    toggle: () => (p.isOpen ? p.close() : p.open()),
    onClose: null
  }
  allPanels.push(p)
  closeBtn.addEventListener('click', () => p.close())
  head.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return
    const r = el.getBoundingClientRect()
    const dx = e.clientX - r.left
    const dy = e.clientY - r.top
    head.setPointerCapture(e.pointerId)
    const mv = (ev: PointerEvent): void => {
      el.style.left = Math.min(window.innerWidth - 60, Math.max(-r.width + 60, ev.clientX - dx)) + 'px'
      el.style.top = Math.min(window.innerHeight - 40, Math.max(0, ev.clientY - dy)) + 'px'
      el.style.right = 'auto'
      el.style.bottom = 'auto'
    }
    const up = (): void => {
      head.removeEventListener('pointermove', mv)
      head.removeEventListener('pointerup', up)
    }
    head.addEventListener('pointermove', mv)
    head.addEventListener('pointerup', up)
  })
  return p
}

export function sliderRow(label: I18nText, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string = (v) => String(Math.round(v * 100) / 100), cls = ''): { el: HTMLElement; update(): void } {
  const val = h('span', { class: 'v' })
  const inp = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), class: cls }) as HTMLInputElement
  const update = (): void => {
    inp.value = String(get())
    val.textContent = fmt(get())
  }
  inp.addEventListener('input', () => {
    set(Number(inp.value))
    val.textContent = fmt(Number(inp.value))
  })
  update()
  return { el: h('div', { class: 'bwf-row' }, h('span', { class: 'l', text: label }), inp, val), update }
}

export function segRow<T extends string | number>(options: [T, I18nText][], get: () => T, set: (v: T) => void): { el: HTMLElement; update(): void } {
  const btns = options.map(([v, label]) => h('button', { class: 'bwf-btn', text: label, onclick: () => (set(v), update()) }))
  const update = (): void => btns.forEach((b, i) => b.classList.toggle('on', options[i][0] === get()))
  update()
  return { el: h('div', { class: 'bwf-seg' }, ...btns), update }
}

export function toggleRow(label: I18nText, get: () => boolean, set: (v: boolean) => void): { el: HTMLElement; update(): void } {
  const cb = h('input', { type: 'checkbox' }) as HTMLInputElement
  cb.addEventListener('change', () => set(cb.checked))
  const update = (): void => void (cb.checked = get())
  update()
  const lab = h('label', { class: 'bwf-row', style: 'cursor:pointer' }, cb, h('span', { text: label }))
  return { el: lab, update }
}
