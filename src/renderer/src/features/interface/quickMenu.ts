import { actionEnv, actionLabel, getAction, registerAction, runAction } from '../../input/actions'
import { prefs } from '../../input/prefs'
import { tk } from '../../i18n'
import { h } from '../../ui/dom'

let el: HTMLElement | null = null
let menuIndex = 0
let offOutside: (() => void) | null = null

export function closeQuickMenu(): void {
  el?.remove()
  el = null
  offOutside?.()
  offOutside = null
}

export const isQuickMenuOpen = (): boolean => !!el

/** Short label for a slot button. */
export function slotLabel(id: string): string {
  if (!id || id === 'none') return '+'
  const a = getAction(id)
  if (!a) return id
  return actionLabel(a).replace(/^[^:]*:\s*/, '').replace(/\s*\((hold|удерж).*\)/i, '')
}

/**
 * Build the radial menu DOM (6 slots around a centre button). Used for the live QuickMenu and for the
 * customisation preview (`onSlot` overrides the default run-action behaviour).
 */
export function buildRadial(menu: string[], index: number, total: number, opts: { radius?: number; onSlot?: (i: number, b: HTMLElement) => void; onCenter?: () => void }): HTMLElement {
  const root = h('div', { class: 'qm-radial', style: 'position:absolute;left:0;top:0;width:0;height:0' })
  const R = opts.radius ?? 92
  root.append(h('div', { class: 'qm-ring', style: `width:${R * 2}px;height:${R * 2}px;margin:${-R}px 0 0 ${-R}px` }))
  menu.slice(0, 6).forEach((id, i) => {
    const ang = (-90 + i * 60) * (Math.PI / 180)
    const b = h('button', { class: 'qm-slot' + (id === 'none' || !id ? ' empty' : ''), style: `left:${Math.cos(ang) * R}px;top:${Math.sin(ang) * R}px;animation-delay:${i * 22}ms`, 'data-tip': slotLabel(id) }, slotLabel(id))
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      opts.onSlot?.(i, b)
    })
    root.append(b)
  })
  const c = h('button', { class: 'qm-center', 'data-tip': total > 1 ? tk('interface.quickmenu.next') : tk('interface.action.quickMenu') }, `${index + 1}/${total}`)
  c.addEventListener('click', (e) => {
    e.stopPropagation()
    opts.onCenter?.()
  })
  root.append(c)
  return root
}

/** Open the radial QuickMenu centred on client coordinates (or the window centre). */
export function openQuickMenu(at?: { x: number; y: number }): void {
  closeQuickMenu()
  const menus = prefs.v.quickMenus
  if (!menus.length) return
  menuIndex = Math.min(menuIndex, menus.length - 1)
  const R = 92
  const margin = R + 50
  const x = Math.min(window.innerWidth - margin, Math.max(margin, at?.x ?? window.innerWidth / 2))
  const y = Math.min(window.innerHeight - margin, Math.max(margin + 40, at?.y ?? window.innerHeight / 2))
  const root = h('div', { class: 'qm', style: `left:${x}px;top:${y}px` })
  el = root
  const render = (): void => {
    root.replaceChildren(
      buildRadial(menus[menuIndex], menuIndex, menus.length, {
        radius: R,
        onSlot: (i) => {
          const id = menus[menuIndex][i]
          closeQuickMenu()
          if (id && id !== 'none') runAction(id, actionEnv({ x, y }))
        },
        onCenter: () => {
          if (menus.length > 1) {
            menuIndex = (menuIndex + 1) % menus.length
            render()
          } else closeQuickMenu()
        }
      })
    )
  }
  render()
  document.body.append(root)
  const out = (e: PointerEvent): void => {
    if (!root.contains(e.target as Node)) closeQuickMenu()
  }
  const key = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') closeQuickMenu()
    else if (/^[1-6]$/.test(e.key)) {
      const id = menus[menuIndex][Number(e.key) - 1]
      closeQuickMenu()
      if (id && id !== 'none') runAction(id, actionEnv({ x, y }))
    }
  }
  // delay so the very event that opened the menu does not close it
  const t = window.setTimeout(() => {
    document.addEventListener('pointerdown', out, true)
    window.addEventListener('keydown', key, true)
  }, 60)
  offOutside = () => {
    clearTimeout(t)
    document.removeEventListener('pointerdown', out, true)
    window.removeEventListener('keydown', key, true)
  }
}

export function registerQuickMenuActions(): void {
  registerAction({
    id: 'ui.quickMenu',
    label: tk('interface.action.quickMenu'),
    category: 'Interface',
    defaultKeys: ['Q'],
    run: (env) => (isQuickMenuOpen() ? closeQuickMenu() : openQuickMenu(env.at))
  })
}
