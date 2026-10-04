import { I18nRef, tk } from '../../i18n'
import { h } from '../../ui/dom'

/** Tiny modal helpers (Electron has no window.prompt / confirm we can rely on). */
export function askText(title: string | I18nRef, initial = '', okLabel: string | I18nRef = tk('core.common.ok')): Promise<string | null> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'text', value: initial, class: 'bw-text-input' })
    const done = (v: string | null): void => {
      back.remove()
      resolve(v)
    }
    const ok = h('button', { class: 'primary', text: okLabel, onclick: () => done(input.value.trim() || null) })
    const back = h(
      'div',
      { class: 'modal-back' },
      h('div', { class: 'modal bw-small-modal' }, h('h3', { text: title }), input, h('div', { class: 'row end' }, h('button', { text: tk('core.common.cancel'), onclick: () => done(null) }), ok))
    )
    back.addEventListener('pointerdown', (e) => e.target === back && done(null))
    input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') done(input.value.trim() || null)
      else if (e.key === 'Escape') done(null)
    })
    document.body.append(back)
    input.focus()
    input.select()
  })
}

export function confirmDialog(title: string | I18nRef, message: string | I18nRef, okLabel: string | I18nRef = tk('core.common.delete'), danger = true): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (v: boolean): void => {
      back.remove()
      resolve(v)
    }
    const back = h(
      'div',
      { class: 'modal-back' },
      h(
        'div',
        { class: 'modal bw-small-modal' },
        h('h3', { text: title }),
        h('p', { class: 'bw-msg', text: message }),
        h('div', { class: 'row end' }, h('button', { text: tk('core.common.cancel'), onclick: () => done(false) }), h('button', { class: danger ? 'primary danger' : 'primary', text: okLabel, onclick: () => done(true) }))
      )
    )
    back.addEventListener('pointerdown', (e) => e.target === back && done(false))
    document.body.append(back)
  })
}

/** Small anchored context menu (closes on outside press / Escape). */
export function contextMenu(x: number, y: number, items: { label: string | I18nRef; danger?: boolean; disabled?: boolean; run: () => void }[]): void {
  const menu = h('div', { class: 'bw-ctx' })
  const close = (): void => {
    menu.remove()
    window.removeEventListener('pointerdown', outside, true)
    window.removeEventListener('keydown', esc, true)
  }
  const outside = (e: Event): void => {
    if (!menu.contains(e.target as Node)) close()
  }
  const esc = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close()
  }
  for (const it of items)
    menu.append(
      h('button', {
        class: 'bw-ctx-item' + (it.danger ? ' danger' : ''),
        text: it.label,
        disabled: !!it.disabled,
        onclick: () => {
          close()
          it.run()
        }
      })
    )
  document.body.append(menu)
  const r = menu.getBoundingClientRect()
  menu.style.left = Math.max(4, Math.min(window.innerWidth - r.width - 4, x)) + 'px'
  menu.style.top = Math.max(4, Math.min(window.innerHeight - r.height - 4, y)) + 'px'
  setTimeout(() => {
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('keydown', esc, true)
  }, 0)
}

/** Press-and-hold (or right-click) helper. `onHold` fires after `ms` without moving. */
export function onLongPress(el: HTMLElement, onHold: (x: number, y: number) => void, ms = 500): void {
  let timer = 0
  let sx = 0
  let sy = 0
  const clear = (): void => clearTimeout(timer)
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    sx = e.clientX
    sy = e.clientY
    clear()
    timer = window.setTimeout(() => {
      onHold(sx, sy)
      // swallow the click that follows the release
      const swallow = (c: Event): void => c.stopImmediatePropagation()
      window.addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => window.removeEventListener('click', swallow, true), 800)
    }, ms)
  })
  el.addEventListener('pointermove', (e) => {
    if (Math.hypot(e.clientX - sx, e.clientY - sy) > 6) clear()
  })
  for (const t of ['pointerup', 'pointercancel', 'pointerleave'] as const) el.addEventListener(t, clear)
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    clear()
    onHold(e.clientX, e.clientY)
  })
}
