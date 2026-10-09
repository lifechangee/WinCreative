import type { App } from '../../app/app'
import { t, tk } from '../../i18n'
import { h, icon } from '../../ui/dom'
import { aspectLabel, FRAME_PRESETS, lockedSize, MAX_FRAME, MIN_FRAME } from './model'
import { editFrame, getFrame } from './state'

/** Stylesheet of the Frame button + settings panel + on-canvas hints (shared CSS variables of the app). */
export const FRAME_CSS = `
.tb-icon.bw-frame-btn{position:relative}
.bw-frame-btn.has{color:var(--text)}
.bw-frame-btn.on{background:color-mix(in srgb,var(--accent) 30%,transparent);color:#fff;box-shadow:inset 0 0 0 1px var(--accent)}
.bw-frame-btn .fr-dot{position:absolute;right:5px;bottom:5px;width:8px;height:8px;border-radius:50%;border:1.5px solid var(--dim);background:var(--bg);display:none}
.bw-frame-btn.has .fr-dot{display:block}
.bw-frame-btn.on .fr-dot{background:#4ade80;border-color:var(--bg)}
.fr-panel{display:flex;flex-direction:column;gap:8px;padding:2px}
.fr-sw{display:flex;align-items:center;gap:10px;min-width:0}
.fr-sw>span{flex:1;min-width:0;line-height:1.25}
.fr-sw .toggle{margin:0}
.fr-h{color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.06em;margin-top:2px}
.fr-presets{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
.fr-chip{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;min-width:0;min-height:62px;padding:6px 2px;background:var(--panel2);border:1px solid var(--line);border-radius:8px;cursor:pointer;color:var(--text)}
.fr-chip:hover{border-color:var(--accent)}
.fr-chip.sel{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 24%,var(--panel2))}
.fr-chip .gl{border:1.5px solid currentColor;border-radius:2px;opacity:.85}
.fr-chip b{font-weight:600;font-size:12px;white-space:nowrap}
.fr-chip i{font-style:normal;font-size:10px;color:var(--dim);white-space:nowrap}
.fr-size{display:flex;align-items:center;gap:6px;min-width:0}
.fr-size input[type=number]{flex:1;min-width:0;width:0;background:var(--panel2);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:6px 8px}
.fr-size .x{color:var(--dim)}
.fr-size .ar{min-width:44px;text-align:right;color:var(--dim);font-size:12px}
.fr-lock{flex:none;width:32px;height:32px;display:grid;place-items:center;border-radius:8px;border:1px solid var(--line);background:var(--panel2);color:var(--dim);cursor:pointer;padding:0}
.fr-lock.on{color:#fff;background:var(--accent);border-color:var(--accent)}
.fr-dim{display:flex;align-items:center;gap:8px}
.fr-dim span{flex:none;color:var(--dim)}
.fr-dim input{flex:1;min-width:0;accent-color:var(--accent)}
.fr-dim output{flex:none;width:36px;text-align:right;color:var(--dim)}
.fr-acts{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.fr-acts .btn{display:flex;align-items:center;justify-content:center;gap:6px;min-width:0;text-align:center;line-height:1.2;padding:7px 8px}
.fr-acts .btn.wide{grid-column:1/-1}
.fr-acts .btn.danger:hover{border-color:#ff6b62;color:#ff6b62}
.fr-acts .btn.act{background:var(--accent);border-color:var(--accent);color:#fff}
.fr-hint{color:var(--dim);font-size:11px;line-height:1.3}
.modal input:disabled,.modal select:disabled{opacity:.4;cursor:default}
`

export interface PanelCtx {
  app: App
  editing: () => boolean
  setEditing: (on: boolean) => void
  getLock: () => boolean
  setLock: (v: boolean) => void
  dim: () => number
  setDim: (v: number) => void
  create: (w: number, h: number, preset?: string) => void
  fit: () => void
}

const sw = (on: boolean, text: ReturnType<typeof tk>, set: (v: boolean) => void): HTMLElement => {
  const tg = h('button', { class: 'toggle' + (on ? ' on' : ''), type: 'button', role: 'switch', 'aria-checked': String(on) })
  tg.addEventListener('click', () => {
    const v = !tg.classList.contains('on')
    tg.classList.toggle('on', v)
    tg.setAttribute('aria-checked', String(v))
    set(v)
  })
  return h('label', { class: 'fr-sw' }, tg, h('span', { text }))
}

/** Presets grid: a mini aspect glyph, the short name and the pixel size. */
function presetGrid(c: PanelCtx, current: string | undefined): HTMLElement {
  const g = h('div', { class: 'fr-presets' })
  for (const p of FRAME_PRESETS) {
    const k = 20 / Math.max(p.w, p.h)
    const gl = h('span', { class: 'gl' })
    gl.style.width = Math.max(6, Math.round(p.w * k)) + 'px'
    gl.style.height = Math.max(6, Math.round(p.h * k)) + 'px'
    g.append(h('button', { class: 'fr-chip' + (p.id === current ? ' sel' : ''), type: 'button', 'data-tip': tk('frame.preset.' + p.id), 'data-preset': p.id, onclick: () => c.create(p.w, p.h, p.id) }, gl, h('b', { text: tk('frame.preset.' + p.id + '.short') }), h('i', { text: `${p.w}×${p.h}` })))
  }
  return g
}

/** Renders the Frame settings panel into a popover body. `redo` re-renders it after a structural change. */
export function renderPanel(c: PanelCtx, body: HTMLElement, redo: () => void): void {
  const doc = c.app.doc
  const f = getFrame(doc)
  body.replaceChildren()
  const root = h('div', { class: 'fr-panel' })
  body.append(root)
  const wi = h('input', { type: 'number', min: MIN_FRAME, max: MAX_FRAME, value: f?.w ?? 1080, 'aria-label': tk('frame.width') })
  const hi = h('input', { type: 'number', min: MIN_FRAME, max: MAX_FRAME, value: f?.h ?? 1920, 'aria-label': tk('frame.height') })
  if (!f) {
    root.append(h('div', { class: 'fr-hint', text: tk('frame.none') }), h('div', { class: 'fr-h', text: tk('frame.presets') }), presetGrid(c, undefined))
    root.append(h('div', { class: 'fr-h', text: tk('frame.custom') }), h('div', { class: 'fr-size' }, wi, h('span', { class: 'x', text: '×' }), hi), h('div', { class: 'fr-acts' }, h('button', { class: 'btn act wide', type: 'button', text: tk('frame.create'), onclick: () => c.create(Number(wi.value), Number(hi.value)) })))
    return
  }
  const apply = (field: 'w' | 'h'): void => {
    const cur = getFrame(doc)!
    let w = Number(wi.value)
    let hh = Number(hi.value)
    if (c.getLock()) {
      const s = lockedSize(cur, field, field === 'w' ? w : hh)
      w = s.w
      hh = s.h
    }
    const cx = cur.x + cur.w / 2
    const cy = cur.y + cur.h / 2
    editFrame(doc, { w, h: hh, x: Math.round(cx - w / 2), y: Math.round(cy - hh / 2), preset: undefined }, t('frame.title'))
    const n = getFrame(doc)!
    wi.value = String(n.w)
    hi.value = String(n.h)
    ar.textContent = aspectLabel(n.w, n.h)
  }
  wi.addEventListener('change', () => apply('w'))
  hi.addEventListener('change', () => apply('h'))
  const ar = h('span', { class: 'ar', text: aspectLabel(f.w, f.h) })
  const lock = h('button', { class: 'fr-lock' + (c.getLock() ? ' on' : ''), type: 'button', 'data-tip': tk('frame.lock'), 'aria-pressed': String(c.getLock()) }, icon('lock', 15))
  lock.addEventListener('click', () => {
    c.setLock(!c.getLock())
    lock.classList.toggle('on', c.getLock())
    lock.setAttribute('aria-pressed', String(c.getLock()))
  })
  const dim = h('input', { type: 'range', min: 10, max: 90, value: Math.round(c.dim() * 100) })
  const dimOut = h('output', { text: Math.round(c.dim() * 100) + '%' })
  dim.addEventListener('input', () => {
    c.setDim(Number(dim.value) / 100)
    dimOut.textContent = dim.value + '%'
  })
  const center = (): void => {
    const b = doc.isInfinite ? doc.contentBounds({ tight: true, visibleOnly: true }) : null
    const cx = b ? b.x + b.w / 2 : doc.isInfinite ? c.app.view.cx : doc.width / 2
    const cy = b ? b.y + b.h / 2 : doc.isInfinite ? c.app.view.cy : doc.height / 2
    const cur = getFrame(doc)!
    editFrame(doc, { x: Math.round(cx - cur.w / 2), y: Math.round(cy - cur.h / 2) }, t('frame.title'))
  }
  const editBtn = h('button', { class: 'btn wide' + (c.editing() ? ' act' : ''), type: 'button', text: c.editing() ? tk('frame.editDone') : tk('frame.edit') })
  editBtn.addEventListener('click', () => {
    c.setEditing(!c.editing())
    redo()
  })
  root.append(
    sw(f.enabled, tk('frame.clip'), (v) => editFrame(doc, { enabled: v }, t('frame.title'))),
    sw(f.visible, tk('frame.show'), (v) => editFrame(doc, { visible: v }, t('frame.title'))),
    h('div', { class: 'fr-h', text: tk('frame.presets') }),
    presetGrid(c, f.preset),
    h('div', { class: 'fr-h', text: tk('frame.custom') }),
    h('div', { class: 'fr-size' }, wi, h('span', { class: 'x', text: '×' }), hi, lock, ar),
    h('div', { class: 'fr-dim' }, h('span', { text: tk('frame.dim') }), dim, dimOut),
    h(
      'div',
      { class: 'fr-acts' },
      editBtn,
      h('button', { class: 'btn', type: 'button', text: tk('frame.center'), onclick: center }),
      h('button', { class: 'btn', type: 'button', text: tk('frame.fit'), onclick: () => c.fit() }),
      h('button', {
        class: 'btn danger wide',
        type: 'button',
        text: tk('frame.remove'),
        onclick: () => {
          c.setEditing(false)
          editFrame(doc, null, t('frame.title'))
          c.app.notify(t('frame.removed'))
          redo()
        }
      })
    ),
    h('div', { class: 'fr-hint', text: tk('frame.snap') })
  )
}
