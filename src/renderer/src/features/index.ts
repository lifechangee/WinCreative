import type { App } from '../app/app'
import * as brushes from './brushes'
import * as layers from './layers'
import * as color from './color'
import * as adjustments from './adjustments'
import * as selectxform from './selectxform'
import * as guides from './guides'
import * as animio from './animio'
import * as interfaceFeat from './interface'
import * as profiles from './profiles'
import * as psdimport from './psdimport'
import * as tutorial from './tutorial'

const modules = { brushes, layers, color, adjustments, selectxform, guides, animio, profiles, psdimport, interface: interfaceFeat, tutorial }

export function installFeatures(app: App, ui: unknown): void {
  for (const [name, m] of Object.entries(modules)) {
    try {
      m.install(app, ui)
    } catch (e) {
      console.error(`Feature '${name}' failed to install`, e)
    }
  }
}

// BW_PERF_SELFTEST=1: robustness / performance self-test (perf/selftest.ts)
void window.bwGallery?.env('BW_PERF_SELFTEST').then((v) => {
  if (v !== '1') return
  void import('../perf/selftest').then(async (m) => {
    const app = (window as any).brushwork_app as App
    const ok = await m.runPerfSelfTest(app)
    await window.brushwork?.selfTestDone({ ok })
  })
})

// BW_INTEG_TEST=1: cross-module integration test (integration/selftest.ts), run after every module is installed
void window.bwGallery?.env('BW_INTEG_TEST').then((v) => {
  if (v !== '1') return
  void import('../integration/selftest').then(async (m) => {
    const app = (window as any).brushwork_app as App
    const ok = await m.runIntegrationSelfTest(app)
    await window.brushwork?.selfTestDone({ ok })
  })
})
