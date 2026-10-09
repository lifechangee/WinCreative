import type { App } from '../../app/app'
import { t, tk } from '../../i18n'
import { registerBwkExtension } from '../../io/bwk'
import { viewportRect } from '../frame/workRect'
import { registerMenuItem } from '../../ui/registry'
import { GuideManager } from './guideManager'
import { buildGuidePanel } from './guidePanel'
import { Overlay } from './overlay'
import { buildQuickShapePanel, QuickShape } from './quickshape'
import { snapTargetsFor } from './model'
import { installReference } from './reference'
import { installText } from './text/install'
import { registerGuidesSelfTest } from './selftest'

/**
 * Feature module 'guides': Drawing Guides + Drawing Assist (28), QuickShape/StreamLine (29), Text layers (31),
 * Reference window (32). Hooks into the stroke pipeline through tools/strokeHooks.ts.
 */
export function install(app: App, ui: unknown): void {
  void ui
  const overlay = new Overlay(app)
  const mgr = new GuideManager(app, overlay)
  const guidePanel = buildGuidePanel(app, mgr)
  // Transform snapping: grid lines / symmetry axes / vanishing points (read by selectxform TransformSession.targets)
  ;(app as unknown as { guides: unknown }).guides = { snapTargets: () => snapTargetsFor(mgr.state, app.doc.width, app.doc.height, app.doc.isInfinite ? viewportRect(app) : undefined) }
  const qs = new QuickShape(app, overlay, mgr)
  const qsPanel = buildQuickShapePanel(app)

  const refreshMenu = (): void => {
    registerMenuItem('actions', {
      id: 'guide-toggle',
      label: () => t(mgr.state.enabled ? 'guides.menu.guideOn' : 'guides.menu.guideOff'),
      separator: true,
      run: () => mgr.set({ enabled: !mgr.state.enabled })
    })
    const aid = app.doc.activeId
    registerMenuItem('actions', {
      id: 'guide-assist',
      label: () => t(mgr.assistOn(aid) ? 'guides.menu.assistOn' : 'guides.menu.assistOff'),
      run: () => {
        const id = app.doc.activeId
        mgr.setAssist(id, !mgr.assistOn(id))
        if (mgr.assistOn(id) && !mgr.state.enabled) mgr.set({ enabled: true })
        refreshMenu()
      }
    })
    registerMenuItem('actions', { id: 'guide-edit', label: tk('guides.menu.editDrawingGuide'), run: () => guidePanel.open() })
    registerMenuItem('actions', { id: 'quickshape-settings', label: tk('guides.menu.quickshapeAndStreamline'), run: () => qsPanel.open() })
  }
  refreshMenu()
  mgr.events.on('change', refreshMenu)
  app.doc.events.on('layers', refreshMenu)
  app.events.on('doc', (d) => {
    d.events.on('layers', refreshMenu)
    refreshMenu()
  })

  registerBwkExtension({
    id: 'guides',
    save: (doc) => ({ extra: mgr.exportState(doc) }),
    load: (doc, extra) => mgr.setFor(doc, extra)
  })

  ;(app as unknown as { textLayers: unknown }).textLayers = installText(app, overlay)
  installReference(app)
  registerGuidesSelfTest(app, mgr, qs)
  ;(window as any).brushwork_guides = mgr
}
