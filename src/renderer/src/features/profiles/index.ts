import type { App } from '../../app/app'
import { registerAction } from '../../input/actions'
import { tk } from '../../i18n'
import { convertPixels8, spaceFromLabel } from '../../io/colorProfile'
import { registerMenuItem } from '../../ui/registry'
import { registerResourceImporter } from '../color/resourceImport'
import { docMeta, profileListeners } from '../animio/docMeta'
import { assignProfile, convertDocument, docSpace, importIccProfile } from './convert'
import { openProfileDialog } from './dialog'

/**
 * Feature module 'profiles': colour profile UI and display colour space.
 * Display P3 canvases are shown through a Display P3 drawing buffer, so wide-gamut displays show the extra colours and
 * other displays get a correct conversion from the browser.
 */
export function install(app: App, ui: unknown): void {
  void ui
  const gl = app.gpu.gl as WebGL2RenderingContext & { drawingBufferColorSpace?: string }
  const sync = (): void => {
    const want = spaceFromLabel(docMeta(app.doc).profile)?.id === 'p3' ? 'display-p3' : 'srgb'
    if ('drawingBufferColorSpace' in gl && gl.drawingBufferColorSpace !== want) {
      try {
        gl.drawingBufferColorSpace = want
        app.requestRender()
      } catch {
        /* colour space not supported by this build */
      }
    }
  }
  profileListeners.add((d) => d === app.doc && sync())
  app.events.on('doc', sync)
  sync()
  // .icc / .icm chosen in the Gallery's Import: applies to the current canvas
  registerResourceImporter({ exts: ['icc', 'icm'], run: async (bytes) => importIccProfile(app, bytes).message })
  registerMenuItem('actions', { id: 'canvas-profile', group: 'canvas', label: tk('color.profile.menu'), run: () => openProfileDialog(app) })
  registerAction({ id: 'canvas.profile', label: tk('color.profile.action'), category: 'View', run: () => openProfileDialog(app) })
  ;(window as any).brushwork_profiles = { assign: (l: string) => assignProfile(app, l), convert: (id: string) => convertDocument(app, spaceFromId(id)), importIcc: (b: Uint8Array) => importIccProfile(app, b), space: () => docSpace(app.doc).id, convertPixels8, spaces: SPACES, colorSpace: () => (gl as { drawingBufferColorSpace?: string }).drawingBufferColorSpace }
}

import { SPACES } from '../../io/colorProfile'
const spaceFromId = (id: string): (typeof SPACES)[number] => SPACES.find((s) => s.id === id) ?? SPACES[0]
