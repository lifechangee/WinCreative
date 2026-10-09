import type { App } from '../../app/app'
import { budgetLevel } from '../../core/tiles'
import type { Document } from '../../doc/document'
import { registerAction } from '../../input/actions'
import { onLangChange, t, tk } from '../../i18n'
import { h } from '../../ui/dom'
import { registerMenuItem } from '../../ui/registry'
import { fixedToInfinite, infiniteToFixed } from './convert'
import type { Rect } from '../../core/types'

/**
 * Feature module 'infinite': navigation helpers and the HUD of infinite canvases (docs/INFINITE_CANVAS.md).
 *  - Actions menu / bindable actions: Go to origin, Fit content, dot grid on/off
 *  - HUD (bottom left): view centre in document coordinates + zoom, shown on infinite documents only
 *  - GPU memory warnings when the painted area grows very large (Canvas Information shows the numbers)
 */
export function install(app: App, _ui?: unknown): void {
  void _ui
  // QA handle (scripts/qa/qa-int-stress.mjs): the conversions without their dialogs; the caller adopts the returned document
  ;(window as unknown as { brushwork_infinite: unknown }).brushwork_infinite = { toFixed: (r: Rect) => infiniteToFixed(app.gpu, app.doc, r), toInfinite: () => fixedToInfinite(app.gpu, app.doc) }
  registerAction({ id: 'view.goOrigin', label: tk('ui.inf.goOrigin'), category: 'View', run: () => app.goToOrigin() })
  registerAction({ id: 'view.fitContent', label: tk('ui.inf.fitContent'), category: 'View', run: () => app.fitContent() })
  registerAction({ id: 'view.dotGrid', label: tk('ui.inf.grid'), category: 'View', run: () => toggleGrid(app) })
  registerMenuItem('actions', { id: 'inf-origin', group: 'canvas', label: tk('ui.inf.goOrigin'), separator: true, run: () => app.goToOrigin() })
  registerMenuItem('actions', { id: 'inf-fit', group: 'canvas', label: tk('ui.inf.fitContent'), run: () => app.fitContent() })
  registerMenuItem('actions', { id: 'inf-grid', group: 'canvas', label: tk('ui.inf.grid'), run: () => toggleGrid(app) })

  const hud = h('div', { class: 'bw-inf-hud' })
  Object.assign(hud.style, {
    position: 'absolute',
    left: '12px',
    top: '12px', // top-left: the bottom edge belongs to the Animation / Page Assist strips and the selection bars
    padding: '3px 9px',
    borderRadius: '6px',
    font: '12px/1.4 system-ui, sans-serif',
    background: 'rgba(0,0,0,0.5)',
    color: '#fff',
    pointerEvents: 'none',
    zIndex: '6',
    display: 'none',
    fontVariantNumeric: 'tabular-nums'
  })
  app.canvas.parentElement!.append(hud)
  const paint = (): void => {
    const inf = app.doc.isInfinite
    hud.style.display = inf ? 'block' : 'none'
    if (!inf) return
    hud.textContent = t('ui.inf.hud', { x: Math.round(app.view.cx), y: Math.round(app.view.cy), zoom: Math.round(app.view.zoom * 100) })
  }
  app.events.on('view', paint)
  app.events.on('doc', () => {
    watch(app.doc)
    paint()
  })
  onLangChange(paint)

  const warned = new WeakMap<Document, number>()
  const watch = (doc: Document): void => {
    if (!doc.isInfinite || warned.has(doc)) return
    warned.set(doc, 0)
    doc.events.on('commit', (e) => {
      if (e.type !== 'stroke' && e.type !== 'smudge' && e.type !== 'redo') return
      const bytes = doc.tileStats().bytes
      const lvl = budgetLevel(bytes)
      if (lvl > (warned.get(doc) ?? 0)) {
        warned.set(doc, lvl)
        app.notify(t(lvl === 2 ? 'ui.inf.memHard' : 'ui.inf.memWarn', { mb: Math.round(bytes / 1048576) }))
      }
    })
  }
  watch(app.doc)
  paint()

  void window.bwGallery?.env('BW_INF_BENCH').then((v) => {
    if (v !== '1') return
    void import('./bench').then(async (m) => {
      const ok = await m.runInfiniteBench(app)
      await window.brushwork?.selfTestDone({ ok })
    })
  })

  // BW_INF_SELFTEST=1: infinite canvas self-test (features/infinite/selftest.ts)
  void window.bwGallery?.env('BW_INF_SELFTEST').then((v) => {
    if (v !== '1') return
    void import('./selftest').then(async (m) => {
      const ok = await m.runInfiniteSelfTest(app)
      await window.brushwork?.selfTestDone({ ok })
    })
  })
}

function toggleGrid(app: App): void {
  const doc = app.doc
  if (!doc.isInfinite) return
  doc.infinite.grid = !doc.infinite.grid
  app.notify(t(doc.infinite.grid ? 'ui.inf.gridOn' : 'ui.inf.gridOff'))
  doc.events.emit('change', { rect: null })
}
