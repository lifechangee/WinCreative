import './interface.css'
import type { App } from '../../app/app'
import { actionEnv, bindActionEnv, registerAction, runAction } from '../../input/actions'
import { installHoverAdjust } from '../../input/hoverAdjust'
import { prefs } from '../../input/prefs'
import { syncShortcutOverrides } from '../../input/shortcuts'
import { registerMenuItem } from '../../ui/registry'
import type { UIContext } from '../../ui/registry'
import { applyAppearance, installCursor, installDprWatcher, installDynamicScaling, installTooltips, installZoomHud } from './appearance'
import { tk } from '../../i18n'
import { installCheatSheet, openCheatSheet } from './cheatsheet'
import { registerDefaultActions } from './defaultActions'
import { createEyedropper } from './eyedropper'
import { openAbout, openHelp, openWhatsNew } from './help'
import { openPrefs } from './prefsDialog'
import { toggleProjector } from './projector'
import { registerQuickMenuActions } from './quickMenu'
import { runInterfaceSelfTest } from './selftest'

/** Push preference values into the app state / DOM. */
function syncState(app: App): void {
  const p = prefs.v
  const st = app.state
  st.pressureCurve = { points: p.pressureCurve.map((q) => [...q] as [number, number]) }
  st.mousePressure = p.mousePressure
  st.touchDraws = p.touchDraws
  st.paintWithTouchWhenPenNear = !p.palmRejection
  st.smoothingOverride = p.streamline
  app.input.calibrator.enabled = p.autoCalibrate
  document.documentElement.style.setProperty('--selection-mask', String(p.selectionMaskVisibility))
  applyAppearance()
}

/** Feature module 'interface' - installed once at startup after buildUI(). */
export function install(app: App, ui: unknown): void {
  const uiCtx = ui as UIContext
  bindActionEnv(app, uiCtx)
  registerDefaultActions(app, () => uiCtx)
  registerQuickMenuActions()
  installCheatSheet()

  registerAction({ id: 'ui.prefs', label: tk('interface.action.prefs'), category: 'Interface', defaultKeys: ['Ctrl+,'], run: () => openPrefs(app) })
  registerAction({ id: 'ui.diagnostics', label: tk('interface.action.diagnostics'), category: 'Interface', run: () => openPrefs(app, 'diagnostics') })
  registerAction({ id: 'ui.help', label: tk('interface.action.help'), category: 'Interface', run: () => openHelp() })

  registerAction({ id: 'view.project', label: tk('interface.action.project'), category: 'View', run: () => void toggleProjector(app) })
  registerMenuItem('actions', { id: 'project-canvas', group: 'canvas', label: tk('interface.menu.project'), run: () => void toggleProjector(app) })
  registerMenuItem('actions', { id: 'prefs', label: tk('interface.menu.prefs'), shortcut: 'Ctrl+,', separator: true, run: () => openPrefs(app) })
  registerMenuItem('actions', { id: 'prefs-pressure', label: tk('interface.menu.pressure'), run: () => openPrefs(app, 'pressure') })
  registerMenuItem('actions', { id: 'prefs-gestures', label: tk('interface.menu.gestures'), run: () => openPrefs(app, 'gestures') })
  registerMenuItem('actions', { id: 'prefs-shortcuts', label: tk('interface.menu.shortcuts'), run: () => openPrefs(app, 'shortcuts') })
  registerMenuItem('actions', { id: 'prefs-diag', label: tk('interface.menu.diagnostics'), run: () => openPrefs(app, 'diagnostics') })
  registerMenuItem('actions', { id: 'cheatsheet', label: tk('interface.menu.cheatsheet'), shortcut: 'F1', run: () => openCheatSheet() })
  registerMenuItem('actions', { id: 'help', label: tk('interface.menu.help'), separator: true, run: () => openHelp() })
  registerMenuItem('actions', { id: 'whatsnew', label: tk('interface.menu.whatsnew'), run: () => openWhatsNew() })
  registerMenuItem('actions', { id: 'about', label: tk('interface.menu.about'), run: () => openAbout() })

  // input wiring
  app.input.hooks.action = (id, env) => void runAction(id, actionEnv(env.at))
  // the colour module installs a richer eyedropper on this hook; ours is only a fallback
  if (!app.input.hooks.eyedrop) app.input.hooks.eyedrop = createEyedropper(app)
  installCursor(app)
  installZoomHud(app)
  installDynamicScaling(app)
  installDprWatcher(app)
  installTooltips()
  installHoverAdjust(app)

  syncShortcutOverrides()
  syncState(app)
  prefs.events.on('change', () => syncState(app))

  void window.bwGallery?.env('BW_INTERFACE_SELFTEST').then((v) => {
    if (v === '1') void runInterfaceSelfTest(app)
  })
}
