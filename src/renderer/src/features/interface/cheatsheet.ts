import { actionCategory, actionLabel, listActions, registerAction } from '../../input/actions'
import { TLE_SHORTCUTS } from '../animio/tlKeys'
import { onLangChange, t, tk } from '../../i18n'
import { prefs } from '../../input/prefs'
import { shortcutMap } from '../../input/shortcuts'
import { h } from '../../ui/dom'

let sheet: HTMLElement | null = null

export const isSheetOpen = (): boolean => !!sheet

export function closeCheatSheet(): void {
  sheet?.remove()
  sheet = null
}

/** Full-screen overlay listing every shortcut, grouped by category. */
export function openCheatSheet(): void {
  closeCheatSheet()
  const groups = new Map<string, { label: string; keys: string[] }[]>()
  for (const a of listActions()) {
    const keys = shortcutMap.keysFor(a.id)
    if (!keys.length) continue
    const cat = actionCategory(a)
    const g = groups.get(cat) ?? []
    g.push({ label: actionLabel(a), keys })
    groups.set(cat, g)
  }
  const cols = h('div', { class: 'cols' })
  for (const [cat, items] of groups) {
    const g = h('div', { class: 'grp' }, h('h4', { text: cat }))
    for (const it of items) g.append(h('div', { class: 'it' }, h('span', { text: it.label }), h('span', null, ...it.keys.map((k) => h('kbd', { text: k })))))
    cols.append(g)
  }
  // the time-lapse editor has its own keys (they only act while it is open)
  const tle = h('div', { class: 'grp' }, h('h4', { text: tk('animio.tle.cheat.title') }))
  for (const it of TLE_SHORTCUTS) tle.append(h('div', { class: 'it' }, h('span', { text: t(it.label) }), h('span', null, ...it.keys.map((k) => h('kbd', { text: k })))))
  cols.append(tle)
  sheet = h('div', { class: 'sheet-back', onclick: () => closeCheatSheet() }, h('div', { class: 'sheet' }, h('h2', { text: tk('interface.cheat.title') }), cols, h('p', { class: 'kbd', text: tk('interface.cheat.hint') })))
  document.body.append(sheet)
}

export function installCheatSheet(): void {
  onLangChange(() => sheet && openCheatSheet()) // re-render the open sheet in the new language
  registerAction({
    id: 'ui.cheatsheet',
    label: tk('interface.action.cheatsheet'),
    category: 'Interface',
    defaultKeys: ['Shift+/', 'F1'],
    run: () => (isSheetOpen() ? closeCheatSheet() : openCheatSheet())
  })
  // Procreate style: hold Ctrl alone for ~0.9 s to peek at the list
  let timer = 0
  let byHold = false
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Control' && !e.repeat) {
      clearTimeout(timer)
      if (!prefs.v.showShortcutsOnCtrlHold) return
      timer = window.setTimeout(() => {
        byHold = true
        openCheatSheet()
      }, 900)
    } else if (e.key !== 'Control') {
      clearTimeout(timer)
      if (byHold) {
        byHold = false
        closeCheatSheet()
      }
      if (e.key === 'Escape') closeCheatSheet()
    }
  })
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Control') {
      clearTimeout(timer)
      if (byHold) {
        byHold = false
        closeCheatSheet()
      }
    }
  })
  window.addEventListener('blur', () => {
    clearTimeout(timer)
    if (byHold) {
      byHold = false
      closeCheatSheet()
    }
  })
}
