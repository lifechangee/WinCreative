import './styles.css'
import { App } from './app/app'
import { buildUI } from './ui'
import { runSelfTest } from './selftest'
import { installFeatures } from './features'
import { bootI18n } from './i18n/boot'
import { t } from './i18n'

const canvas = document.getElementById('gl') as HTMLCanvasElement
const cursor = document.getElementById('brush-cursor') as HTMLElement
const root = document.getElementById('app')!

bootI18n() // language from prefs / OS before any UI text is created

try {
  const app = new App(canvas, cursor)
  const ui = buildUI(app, root)
  installFeatures(app, ui)
  ;(window as any).brushwork_app = app // debugging / extension hook
  ;(window as any).brushwork_ui = ui
  window.brushwork?.isSelfTest().then((on) => {
    if (on) void runSelfTest(app)
  })
} catch (e) {
  console.error('Startup failed', e)
  root.append(Object.assign(document.createElement('pre'), { className: 'fatal', textContent: t('core.app.startFailed') + '\n' + (e as Error).message }))
}
