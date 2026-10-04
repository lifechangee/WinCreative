import { h } from '../../ui/dom'
import { I18nRef, getLang, onLangChange, t, tk } from '../../i18n'

const CSS = `
.an-modal-bg { position: fixed; inset: 0; z-index: 400; background: #000a; display: grid; place-items: center; }
.an-modal { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 20px 60px #000c; min-width: 360px; max-width: min(92vw, 900px); max-height: 92vh; display: flex; flex-direction: column; }
.an-modal header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px 6px; font-weight: 600; font-size: 15px; }
.an-modal .an-body { padding: 8px 16px 12px; overflow: auto; }
.an-modal footer { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 16px 14px; }
.an-btn { background: var(--panel2); color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 7px 14px; cursor: pointer; }
.an-btn:hover:not([disabled]) { background: #3d3d43; }
.an-btn[disabled] { opacity: .45; cursor: default; }
.an-btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.an-btn.small { padding: 4px 9px; font-size: 12px; }
.an-grid { display: grid; grid-template-columns: 130px 1fr; gap: 8px 10px; align-items: center; }
.an-grid label { color: var(--dim); }
.an-grid select, .an-grid input[type=number], .an-grid input[type=text] { background: var(--panel2); color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 5px 7px; min-width: 0; width: 100%; }
.an-note { color: var(--dim); font-size: 12px; margin: 8px 0 0; line-height: 1.4; }
.an-progress { height: 8px; background: var(--panel2); border-radius: 4px; overflow: hidden; margin-top: 10px; }
.an-progress > i { display: block; height: 100%; width: 0; background: var(--accent); transition: width .1s; }
.an-tabs { display: flex; gap: 4px; margin-bottom: 8px; }
.an-stat { display: flex; justify-content: space-between; padding: 3px 0; border-bottom: 1px solid #ffffff0d; }
.an-stat span:first-child { color: var(--dim); }
.an-h { margin: 12px 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--dim); }
.an-strip { position: fixed; left: 70px; right: 12px; bottom: 10px; z-index: 56; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 8px 30px #0008; display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; }
.an-strip .an-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.an-frames { display: flex; gap: 6px; overflow-x: auto; padding: 2px 2px 4px; flex: 1; min-height: 78px; align-items: stretch; }
.an-frame { position: relative; flex: none; width: 88px; height: 70px; border-radius: 8px; border: 2px solid var(--line); background: #fff center/contain no-repeat; cursor: pointer; overflow: hidden; }
.an-frame.sel { border-color: var(--accent); }
.an-frame.drop { border-color: #f5a524; }
.an-frame.bg::after, .an-frame.fg::after { content: attr(data-tag); position: absolute; left: 3px; top: 3px; background: #000b; color: #fff; font-size: 10px; padding: 1px 5px; border-radius: 4px; }
.an-frame .n { position: absolute; right: 4px; bottom: 2px; font-size: 11px; color: #fff; text-shadow: 0 0 3px #000, 0 0 3px #000; }
.an-frame .hold { position: absolute; left: 4px; bottom: 2px; font-size: 10px; color: #ffd; text-shadow: 0 0 3px #000; }
.an-strip select, .an-strip input[type=number] { background: var(--panel2); color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 3px 5px; }
.an-strip input[type=number] { width: 58px; }
.an-strip .lbl { color: var(--dim); font-size: 12px; }
.an-strip input[type=color] { width: 26px; height: 22px; padding: 0; border: 1px solid var(--line); background: none; }
.an-player canvas { display: block; background: #fff; max-width: 100%; max-height: 62vh; margin: 0 auto; border-radius: 6px; }
.an-player input[type=range] { width: 100%; accent-color: var(--accent); }
`

let styled = false
export function ensureStyles(): void {
  if (styled) return
  styled = true
  const s = document.createElement('style')
  s.textContent = CSS
  document.head.append(s)
}

export interface Modal {
  el: HTMLElement
  body: HTMLElement
  footer: HTMLElement
  close(): void
  /** Re-run `cb` on language change while the dialog is open (for text set with plain t()). */
  onLang(cb: () => void): void
}

/** Simple centered modal dialog. */
export function modal(title: string | I18nRef, onClose?: () => void): Modal {
  ensureStyles()
  const body = h('div', { class: 'an-body' })
  const footer = h('footer')
  const bg = h('div', { class: 'an-modal-bg' })
  const unsubs: (() => void)[] = []
  const close = (): void => {
    unsubs.forEach((u) => u())
    bg.remove()
    document.removeEventListener('keydown', onKey, true)
    onClose?.()
  }
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      close()
    }
  }
  document.addEventListener('keydown', onKey, true)
  const x = h('button', { class: 'an-btn small', icon: 'clear', iconSize: 14, onclick: close })
  const box = h('div', { class: 'an-modal' }, h('header', null, h('span', { text: title }), x), body, footer)
  bg.append(box)
  bg.addEventListener('pointerdown', (e) => {
    if (e.target === bg) e.stopPropagation()
  })
  document.body.append(bg)
  return { el: bg, body, footer, close, onLang: (cb) => void unsubs.push(onLangChange(cb)) }
}

export const btn = (label: string | I18nRef, onclick: () => void, cls = ''): HTMLButtonElement => h('button', { class: 'an-btn ' + cls, text: label, onclick })

export function select<T extends string>(options: [T, string | I18nRef][], value: T, onchange: (v: T) => void): HTMLSelectElement {
  const s = h('select')
  for (const [v, l] of options) s.append(h('option', { value: v, text: l }))
  s.value = value
  s.addEventListener('change', () => onchange(s.value as T))
  return s
}

export function numberInput(value: number, min: number, max: number, onchange: (v: number) => void, step = 1): HTMLInputElement {
  const i = h('input', { type: 'number', min: String(min), max: String(max), step: String(step), value: String(value) })
  i.addEventListener('change', () => {
    const v = Math.min(max, Math.max(min, Number(i.value) || min))
    i.value = String(v)
    onchange(v)
  })
  return i
}

export function progressBar(): { el: HTMLElement; set(f: number): void } {
  const fill = h('i')
  return { el: h('div', { class: 'an-progress' }, fill), set: (f) => void (fill.style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + '%') }
}

/** Fixed-decimals number in the current language's decimal separator ("1,5" in Russian). */
export const fx = (n: number, digits: number): string => {
  const s = n.toFixed(digits)
  return getLang() === 'ru' ? s.replace('.', ',') : s
}

export const fmtBytes = (n: number): string =>
  n > 1e9 ? t('animio.size.gb', { n: fx(n / 1e9, 2) }) : n > 1e6 ? t('animio.size.mb', { n: fx(n / 1e6, 1) }) : n > 1e3 ? t('animio.size.kb', { n: (n / 1e3).toFixed(0) }) : t('animio.size.b', { n })

/** Ask the user before a destructive action. */
export function confirmDialog(title: string | I18nRef, text: string | I18nRef, okLabel: string | I18nRef = tk('core.common.ok')): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false
    const finish = (v: boolean): void => {
      if (!done) {
        done = true
        resolve(v)
      }
    }
    const m = modal(title, () => finish(false))
    m.body.append(h('p', { text }))
    m.footer.append(
      btn(tk('core.common.cancel'), () => m.close()),
      btn(okLabel, () => {
        finish(true)
        m.close()
      }, 'primary')
    )
  })
}
