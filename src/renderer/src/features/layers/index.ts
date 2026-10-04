import type { App } from '../../app/app'
import { h } from '../../ui/dom'
import { renderLayerPanel } from '../../ui/layerPanel'
import { registerAction } from '../../input/actions'
import { registerMenuItem, registerPanel, UIContext } from '../../ui/registry'
import { tk, t, type I18nText } from '../../i18n'
import { actionsFor } from './actions'
import { layerHooks } from './ops'

/**
 * Feature module 'layers' — installed once at startup after buildUI().
 * Owns: layer panel registration, Add menu (insert file/photo/text), Copy/Paste menu + shortcuts,
 * layer shortcuts. Debug/integration handle: window.brushwork_layers.
 */
export function install(app: App, uiArg: unknown): void {
  const ui = uiArg as UIContext
  const act = actionsFor(app, (m) => ui.toast(m))

  registerPanel({ id: 'layers', title: tk('layers.panel.title'), width: 340, render: renderLayerPanel })

  // ---- Copy/Paste menu popover (three-finger swipe down equivalent: Ctrl+Alt+C, or call openCopyPasteMenu)
  const openCopyPasteMenu = (x = window.innerWidth / 2, y = 120): void => {
    const anchor = h('div', { style: `position:fixed;left:${x}px;top:${y}px;width:1px;height:1px;pointer-events:none` })
    document.body.append(anchor)
    const has = !!(app as any).selection?.hasSelection?.()
    ui.popovers.open(
      'copypaste',
      anchor,
      (body, close) => {
        const it = (label: string, fn: () => void, hint = ''): void => {
          body.append(
            h(
              'button',
              {
                class: 'menu-item',
                onclick: () => {
                  close()
                  fn()
                }
              },
              h('span', { text: label }),
              hint ? h('span', { class: 'kbd', text: hint }) : null
            )
          )
        }
        it(t('layers.menu.cut'), act.cut, 'Ctrl+X')
        it(t('layers.menu.copy'), act.copy, 'Ctrl+C')
        it(t('layers.menu.copyAll'), act.copyAll, 'Ctrl+Shift+C')
        it(t(has ? 'layers.menu.duplicateSelection' : 'layers.menu.duplicateLayer'), act.duplicateSel, 'Ctrl+J')
        it(t('layers.menu.cutPaste'), act.cutAndPaste, 'Ctrl+Shift+J')
        it(t('layers.menu.paste'), act.paste, 'Ctrl+V')
        return () => anchor.remove()
      },
      { width: 210, title: t('layers.menu.copyPaste') }
    )
  }

  // ---- menus (Actions menu > Add / Copy & Paste sections)
  const M = (id: string, label: I18nText, run: () => void, extra: { shortcut?: string; separator?: boolean; disabled?: boolean; group?: string } = {}): void =>
    registerMenuItem('actions', { id, label, run, ...extra })
  M('add-file', tk('layers.menu.add.insertFile'), act.insertFile, { separator: true, group: 'add' })
  M('add-photo', tk('layers.menu.add.insertPhoto'), act.insertPhoto, { group: 'add' })
  registerMenuItem('actions', { id: 'add-camera', label: tk('layers.menu.add.takePhoto'), group: 'add', disabled: true })
  M('add-text', tk('layers.menu.add.addText'), () => (layerHooks.addText ? layerHooks.addText() : ui.toast(t('layers.toast.textToolNotAvailable'))), { group: 'add' })
  M('cp-cut', tk('layers.menu.cut'), act.cut, { shortcut: 'Ctrl+X', separator: true })
  M('cp-copy', tk('layers.menu.copy'), act.copy, { shortcut: 'Ctrl+C' })
  M('cp-copyall', tk('layers.menu.copyAll'), act.copyAll, { shortcut: 'Ctrl+Shift+C' })
  M('cp-dup', tk('layers.menu.duplicateInPlace'), act.duplicateSel, { shortcut: 'Ctrl+J' })
  M('cp-cutpaste', tk('layers.menu.cutPaste'), act.cutAndPaste, { shortcut: 'Ctrl+Shift+J' })
  M('cp-paste', tk('layers.menu.paste'), act.paste, { shortcut: 'Ctrl+V' })
  M('cp-menu', tk('layers.menu.copyPasteMenu'), () => openCopyPasteMenu(), { shortcut: 'Ctrl+Alt+C' })
  M('layer-flatten', tk('layers.menu.flattenAll'), act.flatten, { separator: true })

  // ---- shortcuts
  // All keys go through the shared action registry (input/shortcuts.ts) so they are rebindable and cannot double-fire.
  // Ctrl+X / Ctrl+C / Ctrl+V resolve to the Cut / Copy / Paste menu items above via the interface module's aliases.
  const A = (id: string, label: I18nText, keys: string[], run: () => void): void =>
    registerAction({ id, label, category: 'Layers', defaultKeys: keys, run })
  A('layer.copyAll', tk('layers.action.copyAll'), ['Ctrl+Shift+C'], () => act.copyAll())
  A('layer.duplicate', tk('layers.action.duplicate'), ['Ctrl+J'], () => act.duplicateSel())
  A('layer.cutPaste', tk('layers.action.cutPaste'), ['Ctrl+Shift+J'], () => act.cutAndPaste())
  A('layer.new', tk('layers.action.new'), ['Ctrl+Shift+N'], () => act.newLayer())
  A('layer.group', tk('layers.action.group'), ['Ctrl+G'], () => act.newGroup())
  A('layer.ungroup', tk('layers.action.ungroup'), ['Ctrl+Shift+G'], () => act.ungroup())
  A('layer.mergeDown', tk('layers.action.mergeDown'), ['Ctrl+E'], () => act.mergeSmart())
  A('layer.flatten', tk('layers.action.flatten'), ['Ctrl+Shift+E'], () => act.flatten())
  A('layer.invertColors', tk('layers.action.invertColors'), ['Ctrl+I'], () => act.invert())
  A('layer.copyPasteMenu', tk('layers.action.copyPasteMenu'), ['Ctrl+Alt+C'], () => openCopyPasteMenu())
  A('layer.up', tk('layers.action.up'), ['PageUp'], () => act.step(1))
  A('layer.down', tk('layers.action.down'), ['PageDown'], () => act.step(-1))

  ;(window as any).brushwork_layers = { actions: act, hooks: layerHooks, openCopyPasteMenu }

  void window.brushworkClip?.testMode().then(async (on) => {
    if (!on) return
    await new Promise((r) => setTimeout(r, 800))
    const { runLayersSelfTest } = await import('./selftest')
    const ok = await runLayersSelfTest(app, (s) => void window.brushworkClip!.testLog(s))
    await window.brushworkClip!.testDone(ok)
  })
}
