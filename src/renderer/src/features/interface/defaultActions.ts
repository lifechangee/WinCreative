import type { App } from '../../app/app'
import { sizeFromSlider, sliderFromSize, ToolId } from '../../app/state'
import { ActionDef, findMenuAction, getAction, registerAction } from '../../input/actions'
import { zoomAt } from '../../core/viewTransform'
import { panels, UIContext } from '../../ui/registry'
import { prefs } from '../../input/prefs'
import { t, tk } from '../../i18n'
import { isUIHidden, setUIHidden, toggleFullscreen } from './appearance'

/** Registers every built-in bindable action (shortcuts, QuickMenu slots, pen buttons, gestures). */
export function registerDefaultActions(app: App, getUI: () => UIContext | null): void {
  const reg = (d: ActionDef): void => registerAction(d)
  const toast = (m: string): void => app.notify(m)

  // ---- tools
  const tool = (id: ToolId, key: string): void =>
    reg({ id: 'tool.' + id, label: tk('core.action.tool.' + id), category: 'Tools', defaultKeys: [key], run: () => app.state.setTool(id) })
  tool('brush', 'B')
  tool('smudge', 'S')
  tool('eraser', 'E')
  let prev: ToolId = 'brush'
  let cur: ToolId = app.state.tool
  app.state.events.on('tool', () => {
    if (app.state.tool !== cur) {
      prev = cur
      cur = app.state.tool
    }
  })
  reg({ id: 'tool.prev', label: tk('core.action.tool.prev'), category: 'Tools', defaultKeys: ['Shift+X'], run: () => app.state.setTool(prev) })
  reg({ id: 'tool.eyedropper', label: tk('core.action.tool.eyedropper'), category: 'Tools', defaultKeys: ['I', 'Alt'], mode: 'eyedropper' })
  reg({ id: 'tool.eraserHold', label: tk('core.action.tool.eraserHold'), category: 'Tools', mode: 'eraser' })
  reg({ id: 'nav.pan', label: tk('core.action.nav.pan'), category: 'Navigation', defaultKeys: ['Space'], mode: 'pan' })
  reg({ id: 'nav.rotate', label: tk('core.action.nav.rotate'), category: 'Navigation', defaultKeys: ['R'], mode: 'rotate' })
  reg({ id: 'nav.zoom', label: tk('core.action.nav.zoom'), category: 'Navigation', defaultKeys: ['Z'], mode: 'zoom' })

  // ---- view
  const zoomBy = (f: number): void => {
    const s = app.cssSize()
    app.setView(zoomAt(app.view, s.w / 2, s.h / 2, f, s.w, s.h))
  }
  reg({ id: 'view.zoomIn', label: tk('core.action.view.zoomIn'), category: 'View', defaultKeys: ['Ctrl+=', 'Ctrl+Shift+='], repeat: true, run: () => zoomBy(1.25) })
  reg({ id: 'view.zoomOut', label: tk('core.action.view.zoomOut'), category: 'View', defaultKeys: ['Ctrl+-'], repeat: true, run: () => zoomBy(0.8) })
  reg({ id: 'view.fit', label: tk('core.action.view.fit'), category: 'View', defaultKeys: ['0', 'Ctrl+0'], run: () => app.fit() })
  reg({
    id: 'view.zoom100',
    label: tk('core.action.view.zoom100'),
    category: 'View',
    defaultKeys: ['Ctrl+1'],
    run: () => zoomBy(1 / app.view.zoom)
  })
  reg({ id: 'view.mirror', label: tk('core.action.view.mirror'), category: 'View', run: () => app.toggleMirror() })
  reg({ id: 'view.resetRotation', label: tk('core.action.view.resetRotation'), category: 'View', defaultKeys: ['Shift+0'], run: () => app.setView({ ...app.view, rot: 0 }) })

  // ---- brush
  const stepSize = (dir: 1 | -1, big: boolean): void => {
    const cur = app.state.settings.size
    const t = sliderFromSize(cur)
    let next = Math.round(sizeFromSlider(t + dir * (big ? 0.08 : 0.03)))
    if (dir > 0 && next <= cur) next = cur + 1
    if (dir < 0 && next >= cur) next = cur - 1
    app.state.setSize(next)
  }
  reg({ id: 'brush.sizeUp', label: tk('core.action.brush.sizeUp'), category: 'Brush', defaultKeys: [']'], repeat: true, run: () => stepSize(1, false) })
  reg({ id: 'brush.sizeDown', label: tk('core.action.brush.sizeDown'), category: 'Brush', defaultKeys: ['['], repeat: true, run: () => stepSize(-1, false) })
  reg({ id: 'brush.opacityUp', label: tk('core.action.brush.opacityUp'), category: 'Brush', defaultKeys: ['Shift+]'], repeat: true, run: () => app.state.setOpacity(app.state.settings.opacity + 0.05) })
  reg({ id: 'brush.opacityDown', label: tk('core.action.brush.opacityDown'), category: 'Brush', defaultKeys: ['Shift+['], repeat: true, run: () => app.state.setOpacity(app.state.settings.opacity - 0.05) })

  // ---- edit
  reg({ id: 'edit.undo', label: tk('core.action.edit.undo'), category: 'Edit', defaultKeys: ['Ctrl+Z'], repeat: true, run: () => app.undo() })
  reg({ id: 'edit.redo', label: tk('core.action.edit.redo'), category: 'Edit', defaultKeys: ['Ctrl+Shift+Z', 'Ctrl+Y'], repeat: true, run: () => app.redo() })
  // Actions provided by other modules (selection, transform, layers...) are looked up in the registered menus, so
  // they work as soon as that module adds the menu item. Modules may also registerAction() with the same id.
  const alias = (id: string, category: string, keys: string[], re: RegExp, fallback?: (ui: UIContext | null) => void): void =>
    reg({
      id,
      label: tk('core.action.' + id),
      category,
      defaultKeys: keys,
      run: (env) => {
        const m = findMenuAction(re)
        if (m) m.run!(env)
        else if (fallback) fallback(getUI())
        else toast(t('core.action.unavailable', { name: t('core.action.' + id) }))
      }
    })
  alias('edit.cut', 'Edit', ['Ctrl+X'], /^cut$/i)
  alias('edit.copy', 'Edit', ['Ctrl+C'], /^copy$/i)
  alias('edit.paste', 'Edit', ['Ctrl+V'], /^paste$/i)
  alias('edit.pasteMenu', 'Edit', [], /copy\s*(&|and)\s*paste/i)
  alias('select.all', 'Selection', ['Ctrl+A'], /^select all$/i)
  alias('select.deselect', 'Selection', ['Ctrl+D'], /^(deselect|select none)$/i)
  // Photoshop convention: Ctrl+I = invert colours (layers module), Ctrl+Shift+I = invert selection
  alias('select.invert', 'Selection', ['Ctrl+Shift+I'], /^invert( selection)?$/i)
  alias('transform', 'Selection', ['Ctrl+T'], /^(transform|freeform|free transform)$/i)
  alias('transform.flipH', 'Selection', [], /^flip horizontal(ly)?$/i)
  alias('transform.flipV', 'Selection', [], /^flip vertical(ly)?$/i)
  alias('layer.merge', 'Layers', [], /^merge( layer)?( down)?$/i)

  // ---- layers
  // layer.new / layer.duplicate are registered by the layers module (selection-aware); these are fallbacks only
  const regIfMissing = (d: ActionDef): void => {
    if (!getAction(d.id)) reg(d)
  }
  regIfMissing({ id: 'layer.new', label: tk('core.action.layer.new'), category: 'Layers', defaultKeys: ['Ctrl+Shift+N'], run: () => void app.doc.addLayer() })
  reg({
    id: 'layer.delete',
    label: tk('core.action.layer.delete'),
    category: 'Layers',
    defaultKeys: ['Ctrl+Shift+Delete'],
    run: () => (app.doc.layers.length > 1 ? app.doc.deleteLayer(app.doc.activeLayer.id) : toast(t('core.toast.lastLayer')))
  })
  regIfMissing({ id: 'layer.duplicate', label: tk('core.action.layer.duplicate'), category: 'Layers', defaultKeys: ['Ctrl+J'], run: () => void app.doc.duplicateLayer(app.doc.activeLayer.id) })
  reg({
    id: 'layer.clear',
    label: tk('core.action.layer.clear'),
    category: 'Layers',
    defaultKeys: ['Delete'],
    run: (env) => {
      const m = findMenuAction(/^clear( layer)?$/i)
      // with a selection Delete clears the selected pixels; otherwise it clears the whole layer
      if (m && app.selection?.hasSelection()) m.run!(env)
      else if (app.doc.activeLayer.locked) toast(t('core.toast.layerLocked'))
      else {
        app.doc.clearLayer(app.doc.activeLayer.id)
        toast(t('core.toast.layerCleared'))
      }
    }
  })

  // ---- interface
  const openPanel = (id: string, anchorSel: string): void => {
    const ui = getUI()
    const p = panels.get(id)
    const anchor = document.querySelector<HTMLElement>(anchorSel) ?? document.querySelector<HTMLElement>('.topbar')
    if (!ui || !p || !anchor) return
    ui.popovers.toggle(id, anchor, (body) => p.render(body, ui), { align: 'right', width: p.width, title: p.title })
  }
  reg({ id: 'ui.layers', label: tk('core.action.ui.layers'), category: 'Interface', defaultKeys: ['L'], run: () => openPanel('layers', '.topbar .tb-layers') })
  reg({ id: 'ui.color', label: tk('core.action.ui.color'), category: 'Interface', defaultKeys: ['C'], run: () => openPanel('color', '.topbar .tb-color') })
  reg({
    id: 'ui.brushLibrary',
    label: tk('core.action.ui.brushLibrary'),
    category: 'Interface',
    defaultKeys: ['Shift+B'],
    run: () => openPanel('lib-' + app.state.tool, '.topbar .tb-icon.sel')
  })
  reg({ id: 'ui.hideUI', label: tk('core.action.ui.hideUI'), category: 'Interface', defaultKeys: ['Tab'], run: () => setUIHidden(!isUIHidden(), app) })
  reg({ id: 'ui.fullscreen', label: tk('core.action.ui.fullscreen'), category: 'Interface', defaultKeys: ['F11', 'Ctrl+F'], run: () => toggleFullscreen(app) })
  reg({
    id: 'ui.theme',
    label: tk('core.action.ui.theme'),
    category: 'Interface',
    run: () => prefs.set('theme', prefs.v.theme === 'dark' ? 'light' : 'dark')
  })
}
