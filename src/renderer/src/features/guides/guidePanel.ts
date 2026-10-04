import type { App } from '../../app/app'
import { I18nText, tk } from '../../i18n'
import { h } from '../../ui/dom'
import type { GuideManager } from './guideManager'
import { GuideType } from './model'
import { floatPanel, FloatPanel, segRow, sliderRow, toggleRow } from './widgets'

/** The Drawing Guide editor: type, options, per-layer Drawing Assist. Non-modal so guide handles stay draggable. */
export function buildGuidePanel(app: App, mgr: GuideManager): FloatPanel {
  const panel = floatPanel(tk('guides.panel.drawingGuide'), 340, { right: 16, top: 60 })
  const g = () => mgr.state
  const updaters: (() => void)[] = []
  const add = <T extends { el: HTMLElement; update(): void }>(w: T, into: HTMLElement = panel.body): T => {
    into.append(w.el)
    updaters.push(w.update)
    return w
  }

  add(toggleRow(tk('guides.panel.drawingGuideOn'), () => g().enabled, (v) => mgr.set({ enabled: v })))
  add(
    segRow<GuideType>(
      [
        ['grid', tk('guides.panel.grid2d')],
        ['iso', tk('guides.panel.isometric')],
        ['perspective', tk('guides.panel.perspective')],
        ['symmetry', tk('guides.panel.symmetry')]
      ],
      () => g().type,
      (v) => mgr.set({ type: v })
    )
  )

  // ---- common
  add(sliderRow(tk('core.common.opacity'), 5, 100, 1, () => g().opacity * 100, (v) => mgr.set({ opacity: v / 100 }), (v) => Math.round(v) + '%'))
  add(sliderRow(tk('guides.panel.thickness'), 0.5, 8, 0.5, () => g().thickness, (v) => mgr.set({ thickness: v }), (v) => v.toFixed(1)))
  const size = add(sliderRow(tk('guides.panel.gridSize'), 8, 400, 1, () => g().gridSize, (v) => mgr.set({ gridSize: v }), (v) => Math.round(v) + 'px'))
  add(sliderRow(tk('guides.panel.colour'), 0, 360, 1, () => g().hue, (v) => mgr.set({ hue: v }), (v) => Math.round(v) + '°', 'bwf-hue'))

  // ---- type specific sections
  const secGrid = h('div')
  const secIso = h('div')
  const secPersp = h('div')
  const secSym = h('div')
  add(sliderRow(tk('guides.panel.rotation'), -90, 90, 1, () => g().gridRotation, (v) => mgr.set({ gridRotation: v }), (v) => Math.round(v) + '°'), secGrid)
  secIso.append(h('div', { class: 'bwf-sec', text: tk('guides.panel.plane') }))
  add(
    segRow(
      [
        ['all', tk('guides.panel.all')],
        ['top', tk('guides.panel.top')],
        ['left', tk('guides.panel.left')],
        ['right', tk('guides.panel.right')]
      ] as ['all' | 'top' | 'left' | 'right', I18nText][],
      () => g().isoPlane,
      (v) => mgr.set({ isoPlane: v })
    ),
    secIso
  )
  secPersp.append(h('div', { class: 'bwf-sec', text: tk('guides.panel.vanishingPoints') }))
  add(
    segRow<number>(
      [
        [1, tk('guides.panel.vp1')],
        [2, tk('guides.panel.vp2')],
        [3, tk('guides.panel.vp3')]
      ],
      () => g().vps.length,
      (v) => mgr.setVpCount(v as 1 | 2 | 3)
    ),
    secPersp
  )
  secPersp.append(
    h('div', { class: 'bwf-note', text: tk('guides.panel.tapTheCanvasTo') }),
    h('button', { class: 'bwf-btn', text: tk('guides.panel.deleteSelectedPoint'), onclick: () => mgr.deleteVp(mgr.selVp) })
  )
  secSym.append(h('div', { class: 'bwf-sec', text: tk('guides.panel.symmetry') }))
  add(
    segRow(
      [
        ['vertical', tk('guides.panel.vertical')],
        ['horizontal', tk('guides.panel.horizontal')],
        ['quadrant', tk('guides.panel.quadrant')],
        ['radial', tk('guides.panel.radial')]
      ] as ['vertical' | 'horizontal' | 'quadrant' | 'radial', I18nText][],
      () => g().symKind,
      (v) => mgr.set({ symKind: v })
    ),
    secSym
  )
  const segs = add(sliderRow(tk('guides.panel.segments'), 2, 24, 1, () => g().symSegments, (v) => mgr.set({ symSegments: Math.round(v) }), (v) => String(Math.round(v))), secSym)
  const rot = add(toggleRow(tk('guides.panel.rotationalSymmetryNoMirroring'), () => g().symRotational, (v) => mgr.set({ symRotational: v })), secSym)
  secSym.append(
    h('div', { class: 'bwf-note', text: tk('guides.panel.dragTheCentreAnd') }),
    h('button', {
      class: 'bwf-btn',
      text: tk('guides.panel.resetAxis'),
      onclick: () => mgr.set({ symAngle: 0, symCenter: { x: app.doc.width / 2, y: app.doc.height / 2 } })
    })
  )
  panel.body.append(secGrid, secIso, secPersp, secSym)

  // ---- Drawing Assist
  panel.body.append(h('div', { class: 'bwf-sec', text: tk('guides.panel.drawingAssist') }))
  const assistActive = add(
    toggleRow(
      tk('guides.panel.assistedDrawingActiveLayer'),
      () => mgr.assistOn(app.doc.activeId),
      (v) => {
        mgr.setAssist(app.doc.activeId, v)
        if (v && !g().enabled) mgr.set({ enabled: true })
      }
    )
  )
  const layerList = h('div', { class: 'bwf-list' })
  panel.body.append(layerList, h('div', { class: 'bwf-note', text: tk('guides.panel.assistSnapsStrokesTo') }))
  const renderLayers = (): void => {
    layerList.replaceChildren()
    for (const l of [...app.doc.layers].reverse()) {
      const cb = h('input', { type: 'checkbox' }) as HTMLInputElement
      cb.checked = mgr.assistOn(l.id)
      cb.addEventListener('change', () => mgr.setAssist(l.id, cb.checked))
      layerList.append(h('label', { class: 'it', style: 'display:flex;gap:8px;align-items:center' }, cb, h('span', { text: l.name })))
    }
  }

  const sync = (): void => {
    const t = g().type
    secGrid.style.display = t === 'grid' ? '' : 'none'
    secIso.style.display = t === 'iso' ? '' : 'none'
    secPersp.style.display = t === 'perspective' ? '' : 'none'
    secSym.style.display = t === 'symmetry' ? '' : 'none'
    size.el.style.display = t === 'symmetry' ? 'none' : ''
    const radial = g().symKind === 'radial'
    segs.el.style.display = radial ? '' : 'none'
    rot.el.style.display = radial ? '' : 'none'
    for (const u of updaters) u()
    assistActive.update()
    renderLayers()
  }
  mgr.events.on('change', () => void (panel.isOpen && sync()))
  const onLayers = (): void => void (panel.isOpen && sync())
  const hook = (): void => {
    app.doc.events.on('layers', onLayers)
  }
  hook()
  app.events.on('doc', hook)
  const baseOpen = panel.open
  panel.open = (): void => {
    baseOpen()
    // like Procreate: opening the editor turns the guide on
    if (!mgr.state.enabled) mgr.set({ enabled: true })
    mgr.setEditing(true)
    sync()
  }
  panel.onClose = (): void => mgr.setEditing(false)
  sync()
  return panel
}
