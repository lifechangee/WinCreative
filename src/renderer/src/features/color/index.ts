import type { App } from '../../app/app'
import { registerAction } from '../../input/actions'
import { t, tk } from '../../i18n'
import { registerMenuItem, registerPanel } from '../../ui/registry'
import type { UIContext } from '../../ui/registry'
import { renderColorPanel } from '../../ui/colorPanel'
import { attachColorDrag, fillAt, fillLast, fillLayer } from './colorDrop'
import { hsvToHex } from './colorMath'
import { Eyedropper } from './eyedropper'
import { installGallery } from './gallery'
import { palettesFromBytes } from './paletteIO'
import { paletteStore } from './paletteStore'
import { makePalette } from './palettes'
import { registerResourceImporter } from './resourceImport'
import { runColorSelfTest } from './selftest'
import { shared } from './shared'
import { ensureColorStyles } from './styles'

export { fillAt, fillLast, fillLayer, registerSelectionMaskProvider } from './colorDrop'
export { Eyedropper } from './eyedropper'
export { shared as colorShared } from './shared'
export * as gallery from './gallery'

/** Feature module 'color' — colour panel, eyedropper, ColorDrop and the Gallery. Installed once after buildUI(). */
export function install(app: App, ui: unknown): void {
  const ctx = ui as UIContext
  ensureColorStyles()
  shared.app = app
  const eye = (shared.eyedropper = new Eyedropper(app))
  app.input.hooks.eyedrop = eye.hook
  ;(app as any).eyedropper = eye

  // wider panel than the default registration in ui/index.ts
  registerPanel({ id: 'color', title: tk('color.panel.title'), width: 300, render: renderColorPanel })

  // ColorDrop: drag the top-bar colour circle onto the canvas
  const dot = document.querySelector<HTMLElement>('.tb-color')
  if (dot) attachColorDrag(app, dot, () => hsvToHex(app.state.color), () => app.state.rgb)

  registerAction({ id: 'color.swap', label: tk('color.action.swap'), category: 'Color', defaultKeys: ['X'], run: () => app.state.swapColors() })
  registerAction({ id: 'color.fillLast', label: tk('color.action.fillLast'), category: 'Color', run: () => void fillLast(app) })
  registerAction({ id: 'color.fillLayer', label: tk('color.action.fillLayer'), category: 'Color', run: () => void fillLayer(app) })
  registerAction({ id: 'color.recolorLayer', label: tk('color.action.recolorLayer'), category: 'Color', run: () => void fillLayer(app, true) })
  registerAction({ id: 'color.eyedropperArm', label: tk('color.action.eyedropperArm'), category: 'Color', run: () => eye.arm(true) })

  registerMenuItem('actions', { id: 'color-fill-layer', label: tk('color.action.fillLayer'), separator: true, run: () => void fillLayer(app) })
  registerMenuItem('actions', { id: 'color-recolor-layer', label: tk('color.action.recolorLayer'), run: () => void fillLayer(app, true) })
  registerMenuItem('actions', { id: 'color-fill-last', label: tk('color.action.fillLast'), run: () => void fillLast(app) })
  registerMenuItem('selection', { id: 'color-fill-selection', label: tk('color.menu.colorFill'), separator: true, run: () => void fillLayer(app) })

  installGallery(app, ctx)
  // .swatches / .ase chosen in the Gallery's Import become palettes
  registerResourceImporter({
    exts: ['swatches', 'ase'],
    run: async (bytes, name) => {
      const list = await palettesFromBytes(bytes, name)
      for (const q of list) paletteStore().add(makePalette(q.name, q.colors))
      return t('color.palette.imported', { count: list.length })
    }
  })

  void window.bwGallery?.env('BW_COLOR_SELFTEST').then((v) => {
    if (v === '1') void runColorSelfTest(app, ctx)
  })
}
