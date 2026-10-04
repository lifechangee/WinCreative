import type { App } from '../app/app'
import { actionEnv, getAction, listActions, registerAction } from './actions'
import { tk } from '../i18n'
import { prefs } from './prefs'
import { comboFromEvent, ShortcutMap } from './shortcutMap'

export interface ShortcutHooks {
  save(): void
  open(): void
  newDoc(): void
}

/** The live binding table (defaults from registered actions + user overrides from prefs). */
export const shortcutMap = new ShortcutMap(
  () => listActions(),
  prefs.v.shortcuts
)

/** Re-read overrides after prefs were reset / reloaded. */
export function syncShortcutOverrides(): void {
  shortcutMap.overrides = prefs.v.shortcuts
}

export function saveShortcuts(): void {
  prefs.v.shortcuts = shortcutMap.overrides
  prefs.touch('shortcuts')
}

const isTyping = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

/**
 * Keyboard shortcuts. Everything is an action (input/actions.ts) bound through the ShortcutMap, so the
 * shortcut editor in Preferences can rebind anything. Hold-type actions (Space = pan, R = rotate, I / Alt =
 * eyedropper) stay active while the key is down.
 */
export function installShortcuts(app: App, hooks: ShortcutHooks): void {
  registerAction({ id: 'file.save', label: tk('core.action.file.save'), category: 'File', defaultKeys: ['Ctrl+S'], run: () => hooks.save() })
  registerAction({ id: 'file.open', label: tk('core.action.file.open'), category: 'File', defaultKeys: ['Ctrl+O'], run: () => hooks.open() })
  registerAction({ id: 'file.new', label: tk('core.action.file.new'), category: 'File', defaultKeys: ['Ctrl+N'], run: () => hooks.newDoc() })

  const held = new Map<string, { mode: NonNullable<ReturnType<typeof getAction>>['mode']; src: string }>()
  const keyId = (e: KeyboardEvent): string => e.code || e.key

  window.addEventListener('keydown', (e) => {
    if (isTyping(e.target) || (e.target as HTMLElement | null)?.closest?.('.modal, .keycapture')) return
    const combo = comboFromEvent(e)
    const id = shortcutMap.actionFor(combo)
    if (!id) return
    const a = getAction(id)
    if (!a) return
    if (e.repeat && !a.repeat) {
      e.preventDefault()
      return
    }
    e.preventDefault()
    if (a.mode) {
      if (!held.has(keyId(e))) {
        const src = 'key:' + combo
        held.set(keyId(e), { mode: a.mode, src })
        app.input.beginMode(a.mode, src)
      }
      return
    }
    a.run?.(actionEnv(app.input.lastClient()))
  })
  window.addEventListener('keyup', (e) => {
    const h = held.get(keyId(e))
    if (h && h.mode) {
      held.delete(keyId(e))
      app.input.endMode(h.mode, h.src)
    }
    // modifier released while a modifier-combo hold is active (e.g. Alt eyedropper)
    if (e.key === 'Alt' || e.key === 'Control' || e.key === 'Shift') {
      for (const [k, v] of [...held]) {
        if (k === e.code) continue
        if (v.src === 'key:' + comboFromEvent(e) || v.src === 'key:' + e.key) {
          held.delete(k)
          if (v.mode) app.input.endMode(v.mode, v.src)
        }
      }
    }
  })
  window.addEventListener('blur', () => held.clear())
}
