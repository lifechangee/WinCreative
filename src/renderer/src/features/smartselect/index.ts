import type { App } from '../../app/app'
import { registerAction } from '../../input/actions'
import { tk, t } from '../../i18n'
import { menus, registerMenuItem } from '../../ui/registry'
import { barExtras } from '../selectxform/bar'
import { SmartBar } from './bar'
import { runCutAction, type CutAction } from './cutout'
import { SmartSelect } from './smart'
import { saveSs, ss } from './settings'

/** Feature module 'smartselect': AI / brush object selection and cut-out actions. Exposes `window.brushwork_smartselect` for QA. */
export function install(app: App, ui: unknown): void {
  void ui
  const c = new SmartSelect(app)
  const bar = new SmartBar(c, app)
  ;(window as any).brushwork_smartselect = { c, bar, ss, save: saveSs, cut: (a: CutAction) => runCutAction(app, c.engine, a) }

  // only one tool owns the pointer: leaving to any other tool / override closes Smart selection
  const origOverride = app.setToolOverride.bind(app)
  app.setToolOverride = (tool, opts) => {
    if (c.active && tool !== c.tool) c.deactivate(true)
    origOverride(tool, opts)
  }
  // a real tool change (B / E / toolbar) closes Smart selection; the pen's eraser end (temporary eraser) must not
  let lastTool = app.state.tool
  app.state.events.on('tool', () => {
    const changed = app.state.tool !== lastTool
    lastTool = app.state.tool
    if (c.active && changed) c.deactivate(true)
  })
  app.events.on('doc', () => {
    c.abandon()
    c.engine.release()
  })
  // Undo / redo during a session: Undo drops the unfinished attempt (like the transform tool), Redo is ignored
  app.addHistoryInterceptor(
    'smartselect',
    (kind) => {
      if (!c.session) return false
      if (kind === 'undo') c.finishSession(false)
      return true
    },
    40
  )
  window.addEventListener('keydown', (e) => {
    if (!c.active) return
    const el = e.target as HTMLElement | null
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
    if (e.ctrlKey || e.metaKey) return
    if (e.key === 'Enter') c.deactivate(true)
    else if (e.key === 'Escape') {
      if (c.session) c.finishSession(false)
      else c.deactivate(true)
    } else if (e.key.toLowerCase() === 'n' && !e.altKey) c.nextObject()
    else if (e.key === 'Backspace' && c.session) {
      e.preventDefault()
      if (c.session.mode === 'brush') c.undoLastStroke()
      else if (c.session.points.length) c.removePoint(c.session.points.length - 1)
    }
  })

  const open = (): void => c.activate()
  barExtras.push({ id: 'smart', label: () => t('smartselect.bar.openTool'), tip: () => t('smartselect.bar.openTool.tip'), run: open })

  registerMenuItem('selection', { id: 'sel-smart', label: tk('smartselect.menu.smart'), run: open, shortcut: 'W' })
  const sm = menus.selection // Smart selection leads the menu
  sm.unshift(sm.splice(sm.findIndex((x) => x.id === 'sel-smart'), 1)[0])
  const cut = (id: string, key: string, a: CutAction, sep = false, keys?: string[]): void => {
    registerMenuItem('selection', { id, label: tk(key), run: () => void runCutAction(app, c.engine, a), separator: sep, ...(keys ? { shortcut: keys[0] } : {}) })
    registerAction({ id: 'smartselect.' + a, label: tk(key), category: 'Selection', defaultKeys: keys, run: () => void runCutAction(app, c.engine, a) })
  }
  cut('sel-smart-cut', 'smartselect.menu.cutNew', 'cut', true)
  cut('sel-smart-copy', 'smartselect.menu.copyNew', 'copy')
  cut('sel-smart-removebg', 'smartselect.menu.removeBg', 'removeBg')
  cut('sel-smart-copyobj', 'smartselect.menu.copyObject', 'copyObject')
  // BW_SS_TEST=1: run the self-test (selftest.ts) with the bundled model
  void window.smartselectApi?.testMode().then((on) => {
    if (!on) return
    void import('./selftest').then(async (m) => {
      const log = (x: string): void => void window.smartselectApi?.testLog(x)
      const ok = await m.runSmartSelectSelfTest(app, c, log)
      await window.smartselectApi?.testDone(ok)
    })
  })

  registerAction({ id: 'smartselect.open', label: tk('smartselect.menu.smart'), category: 'Selection', defaultKeys: ['W'], run: open })
}
