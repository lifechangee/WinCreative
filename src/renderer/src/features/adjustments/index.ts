import type { App } from '../../app/app'
import { registerMenuItem } from '../../ui/registry'
import { ADJUSTMENTS } from './defs'
import { adjName } from './labels'
import { AdjustmentSession, runAdjustment, setSelectionMaskProvider } from './session'
import { AdjustmentUI } from './ui'
import { runAdjustmentsSelfTest } from './selftest'

export { runAdjustment, setSelectionMaskProvider, AdjustmentSession }
export { ADJUSTMENTS }

/** Feature module 'adjustments' — installed once at startup after buildUI(). */
export function install(app: App, ui: unknown): void {
  void ui
  const aui = new AdjustmentUI(app)
  ;(app as unknown as { adjustments: unknown }).adjustments = { ui: aui, open: (id: string) => aui.open(id), run: (id: string, p?: Record<string, number>) => runAdjustment(app, id, p), definitions: ADJUSTMENTS }
  const seps = new Set(['gaussian', 'liquify', 'noise'])
  for (const d of ADJUSTMENTS) registerMenuItem('adjustments', { id: 'adj-' + d.id, label: () => adjName(d), separator: seps.has(d.id), run: () => aui.open(d.id) })

  window.brushwork?.isSelfTest().then((on) => {
    if (on) (window as unknown as { __adjSelfTest: unknown }).__adjSelfTest = runAdjustmentsSelfTest(app)
  })

  // While an adjustment is open, Ctrl+Z steps back inside the adjustment instead of the document history (redo is swallowed).
  app.addHistoryInterceptor(
    'adjustments',
    (kind) => {
      const s = aui.session
      if (!s || s.isClosed) return false
      if (kind === 'undo') void s.undo()
      return true
    },
    100
  )
}
