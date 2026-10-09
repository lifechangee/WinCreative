import type { App } from '../app/app'
import { Emitter } from '../core/events'
import { I18nRef, I18nText, inLang, resolveText, t } from '../i18n'
import { blockedMenuItem, notAvailable } from '../doc/infiniteGuard'
import type { PopoverHost } from './popover'

/** Passed to menu items and panels. */
export interface UIContext {
  app: App
  popovers: PopoverHost
  toast(msg: string): void
  showNewDocumentDialog(): void
  saveDocument(): Promise<void>
  openDocument(): Promise<void>
}

export type MenuId = 'gallery' | 'actions' | 'adjustments' | 'selection' | 'transform'

export interface MenuItem {
  id: string
  /** display text: an i18n key, a `tk()` ref, a `() => string` resolver or (legacy) a literal English string */
  label: I18nText
  /**
   * Sub-heading in the Actions menu: 'add' | 'video' | 'canvas' | 'share' (headings live in `ui.menu.group.*`). Items of a
   * group are gathered under one small heading and the label is shown WITHOUT the group prefix. Legacy English labels of
   * the form 'Add: ...' / 'Video: ...' / 'Canvas: ...' / 'Share: ...' are detected automatically.
   */
  group?: string
  shortcut?: string
  /** action id whose CURRENT binding (incl. user rebinds) is shown instead of the static `shortcut` */
  action?: string
  /** greyed-out stub */
  disabled?: boolean
  /** thin divider before this item */
  separator?: boolean
  run?(ctx: UIContext): void | Promise<void>
}

/** Fires when a top-bar menu item is clicked (tutorial progress detection). */
export const menuEvents = new Emitter<{ run: { menu: MenuId; id: string } }>()

export const menus: Record<MenuId, MenuItem[]> = {
  gallery: [],
  actions: [],
  adjustments: [],
  selection: [],
  transform: []
}

/** Extension point: add an item to a top-bar menu (Actions, Adjustments, Selection, Transform, Gallery). */
export function registerMenuItem(menu: MenuId, item: MenuItem): void {
  const list = menus[menu]
  const run = item.run
  // infinite canvas: items that touch whole layers / selections are refused with a toast until they are migrated to the tile model
  if (run) item = { ...item, run: (ctx) => (ctx.app.doc.isInfinite && blockedMenuItem(menu, item.id) ? notAvailable() : run.call(item, ctx)) }
  const i = list.findIndex((m) => m.id === item.id)
  if (i >= 0) list[i] = item
  else list.push(item)
}

const LEGACY_GROUP = /^(Add|Video|Canvas|Share):\s*/

/** Group id (lower case, '' = none) and prefix-free display text of a menu item, in the current language. */
export function menuItemParts(it: MenuItem): { group: string; text: string } {
  const text = resolveText(it.label)
  if (it.group) return { group: it.group.toLowerCase(), text }
  const m = LEGACY_GROUP.exec(inLang('en', () => resolveText(it.label)))
  if (!m) return { group: '', text }
  return { group: m[1].toLowerCase(), text: text.replace(/^[^:]+:\s*/, '') } // "Add: x" / "Добавить: x" -> "x"
}
/** Localised heading of a menu group id. */
export const menuGroupLabel = (group: string): string => t('ui.menu.group.' + group)

/**
 * Extension point: a right-hand popover panel (Layers, Color, Brush library, ...).
 * `render` fills `body`; return a cleanup function to run when it closes.
 */
export interface PanelDef {
  id: string
  /** i18n key, `tk()` ref, resolver or literal */
  title: I18nText
  width?: number
  render(body: HTMLElement, ctx: UIContext): (() => void) | void
}
export const panels = new Map<string, PanelDef>()
export const registerPanel = (p: PanelDef): void => void panels.set(p.id, p)

/** A top-bar tab that is not a menu: it switches the whole workspace (e.g. the Time-lapse editor). */
export interface TopTab {
  id: string
  /** `tk()` ref */
  label: I18nRef
  run(ctx: UIContext): void
}
export const topTabs: TopTab[] = []
const activeTabs = new Set<string>()
export const topTabEvents = new Emitter<{ change: void }>()
export const isTopTabActive = (id: string): boolean => activeTabs.has(id)
/** Extension point: add a tab after Gallery / Actions / Adjustments / Selection / Transform. */
export function registerTopTab(tab: TopTab): void {
  const i = topTabs.findIndex((x) => x.id === tab.id)
  if (i >= 0) topTabs[i] = tab
  else topTabs.push(tab)
  topTabEvents.emit('change', undefined)
}
/** Highlight a tab while its workspace is shown. */
export function setTopTabActive(id: string, on: boolean): void {
  if (on) activeTabs.add(id)
  else activeTabs.delete(id)
  topTabEvents.emit('change', undefined)
}
