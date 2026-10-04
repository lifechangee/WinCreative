import type { App } from '../app/app'
import { Emitter } from '../core/events'
import { I18nText, has, inLang, resolveText, t } from '../i18n'
import { menus, MenuId, menuGroupLabel, menuItemParts } from '../ui/registry'
import type { UIContext } from '../ui/registry'

/** Pointer "modes" that stay active while a key or pen button is held. */
export type InputMode = 'pan' | 'rotate' | 'zoom' | 'eyedropper' | 'eraser'

export interface ActionEnv {
  app: App
  ui: UIContext | null
  /** client position of the trigger (pen / finger) when known */
  at?: { x: number; y: number }
}

export interface ActionDef {
  id: string
  /** display name: i18n key, `tk()` ref, `() => string` or literal. Read it through `actionLabel(a)`. */
  label: I18nText
  /** grouping id ('Tools', 'View', ... - translated by `core.category.<id>`); show it through `actionCategory(a)` */
  category: string
  /** default shortcut combos, e.g. 'Ctrl+Z' (see shortcutMap.comboFromEvent) */
  defaultKeys?: string[]
  /** hold-type action: active while the trigger is held (key / pen button / touch-hold) */
  mode?: InputMode
  /** allow OS key auto-repeat to re-run the action while the key is held */
  repeat?: boolean
  run?(env: ActionEnv): void
}

const registry = new Map<string, ActionDef>()

/** Fires after a bindable action ran (shortcut, pen button, gesture, QuickMenu...). Used by the tutorial. */
export const actionEvents = new Emitter<{ run: { id: string } }>()

/**
 * Extension point: register an action that can be bound to shortcuts, QuickMenu slots, pen buttons and
 * gestures. Other modules may call this at any time (later registrations replace by id).
 */
export function registerAction(def: ActionDef): void {
  registry.set(def.id, def)
}

const MENU_IDS: MenuId[] = ['gallery', 'actions', 'adjustments', 'selection', 'transform']

const menuActionOf = (m: MenuId, it: (typeof menus)[MenuId][number]): ActionDef => ({
  id: `menu:${m}:${it.id}`,
  label: () => {
    const { group, text } = menuItemParts(it)
    return `${t('ui.menu.' + m)}: ${group ? menuGroupLabel(group) + ': ' : ''}${text}`
  },
  category: 'Menus',
  run: (env) => void it.run!(env.ui as UIContext)
})

/** Every menu item registered through ui/registry becomes a bindable action `menu:<menu>:<id>`. */
function menuActions(): ActionDef[] {
  const out: ActionDef[] = []
  for (const m of MENU_IDS) for (const it of menus[m]) if (!it.disabled && it.run) out.push(menuActionOf(m, it))
  return out
}

/** Localised action name in the current language. */
export const actionLabel = (a: ActionDef): string => resolveText(a.label)
/** Localised category heading; unknown categories pass through unchanged. */
export const actionCategory = (a: ActionDef): string => (has('core.category.' + a.category) ? t('core.category.' + a.category) : a.category)

export function listActions(): ActionDef[] {
  return [...registry.values(), ...menuActions()]
}

export function getAction(id: string): ActionDef | undefined {
  return registry.get(id) ?? menuActions().find((a) => a.id === id)
}

/**
 * Find a menu item action by a regex over the item's ENGLISH label (language independent; used for cross-module
 * aliases such as Copy / Paste). Keep an English label reachable for items that should be found this way.
 */
export function findMenuAction(re: RegExp): ActionDef | undefined {
  for (const m of MENU_IDS) {
    for (const it of menus[m]) {
      if (it.disabled || !it.run) continue
      if (re.test(inLang('en', () => resolveText(it.label)))) return menuActionOf(m, it)
    }
  }
  return undefined
}

export function runAction(id: string, env: ActionEnv): boolean {
  if (!id || id === 'none') return false
  const a = getAction(id)
  if (!a || !a.run) return false
  try {
    a.run(env)
  } catch (e) {
    console.error(`[action ${id}]`, e)
  }
  actionEvents.emit('run', { id })
  return true
}

let boundApp: App | null = null
let boundUI: UIContext | null = null
/** Called once by features/interface to give actions access to the app and UI. */
export function bindActionEnv(app: App, ui: UIContext | null): void {
  boundApp = app
  boundUI = ui
}
export function actionEnv(at?: { x: number; y: number }): ActionEnv {
  return { app: boundApp as App, ui: boundUI, at }
}
