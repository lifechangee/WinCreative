// Helpers for the 0.3.0 integration QA scripts (Playwright + Electron, isolated profile, optional packaged exe via BW_EXE).
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

export const outDirOf = (args) => resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : 'out-integ')
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function launch(outDir, { env = {}, ud, args = [], gallery, perf = true } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'bw-int-'))
  const exe = process.env.BW_EXE
  const userData = ud ?? join(tmp, 'ud')
  const app = await electron.launch({
    ...(exe ? { executablePath: exe } : {}),
    args: [...(exe ? [] : [join(outDir, 'main', 'index.js')]), `--user-data-dir=${userData}`, ...args],
    // perf=false: no BW_*TEST variable at all, so the single-instance lock is active exactly like a real launch
    env: { ...process.env, ...(perf ? { BW_PERF_TEST: '1' } : {}), BW_GALLERY_DIR: gallery ?? join(tmp, 'gallery'), BW_LANG: 'en', BW_NO_WINSTATE: '1', ...env },
    timeout: 60000
  })
  const page = await app.firstWindow()
  page.setDefaultTimeout(60000)
  const errors = []
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console.error ' + m.text().slice(0, 300))
  })
  await page.waitForFunction(() => !!window.brushwork_app && !!window.brushwork_io?.gallery, null, { timeout: 60000 })
  await page.waitForTimeout(1200)
  await page.evaluate(PAGE_HELPERS)
  return { app, page, tmp, userData, errors }
}

/** helpers living in the page */
export const PAGE_HELPERS = () => {
  const q = (window.__qa = {
    samples: (pts, dt = 8) => pts.map((p, i) => ({ x: p[0], y: p[1], pressure: p[2] ?? 0.6, tiltX: 0, tiltY: 0, twist: 0, t: 1000 + i * dt, pointerType: 'pen' })),
    cfg(tool, preset, size, opacity, hex) {
      const st = window.brushwork_app.state
      st.setTool(tool)
      if (preset) st.setPreset(tool, preset)
      st.settings.size = size
      st.settings.opacity = opacity
      const [r, g, b] = hex.match(/[0-9a-f]{2}/gi).map((x) => parseInt(x, 16) / 255)
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn
      let hh = 0
      if (d > 0) hh = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
      st.setColor({ h: hh * 60, s: mx ? d / mx : 0, v: mx }, false)
    },
    stroke(tool, pts) {
      const app = window.brushwork_app
      const s = q.samples(pts)
      const t = app.tools.get(tool)
      if (!t.begin(s[0], app)) throw new Error('begin refused')
      for (let i = 1; i < s.length; i += 8) t.move(s.slice(i, i + 8), app)
      t.end(app)
    },
    /** FNV-1a hash of the straight RGBA of every tile of every layer: { 'layerIdx:tx_ty': hash } (empty tiles skipped) */
    hash() {
      const app = window.brushwork_app
      const out = {}
      app.doc.layers.forEach((l, li) => {
        if (!l.tiles) return
        for (const k of l.tiles.keys()) {
          const s = l.tiles.getKey(k)
          if (!s) continue
          const px = app.gpu.readRGBA8(s, { x: 0, y: 0, w: s.w, h: s.h })
          let h = 2166136261, any = false
          for (let i = 0; i < px.length; i += 4) {
            if (px[i + 3]) any = true
            else continue
            // alpha always; colour only where opaque (a straight-alpha PNG round trip rounds the colour of translucent texels)
            h = Math.imul(h ^ px[i + 3], 16777619)
            if (px[i + 3] === 255) { h = Math.imul(h ^ px[i], 16777619); h = Math.imul(h ^ px[i + 1], 16777619); h = Math.imul(h ^ px[i + 2], 16777619) }
          }
          if (any) out[li + ':' + k] = h >>> 0
        }
      })
      return out
    },
    /** frame-gap monitor: rAF deltas */
    fm: { on: false, gaps: [], last: 0 },
    startFm() {
      q.fm.gaps = []
      q.fm.last = performance.now()
      q.fm.on = true
      const tick = (t) => {
        if (!q.fm.on) return
        if (t - q.fm.last > 30) (q.fm.big ??= []).push([Math.round(q.fm.last), Math.round(t - q.fm.last)])
        q.fm.gaps.push(t - q.fm.last)
        q.fm.last = t
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    },
    stopFm() {
      q.fm.on = false
      return q.fm.gaps
    }
  })
}

export const stats = (a) => {
  const s = [...a].sort((x, y) => x - y)
  const qf = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0
  return { n: s.length, mean: s.reduce((x, y) => x + y, 0) / Math.max(1, s.length), p50: qf(0.5), p95: qf(0.95), p99: qf(0.99), max: s[s.length - 1] ?? 0 }
}

export function reporter() {
  const res = []
  return {
    check(name, ok, info = '') {
      res.push({ name, ok: !!ok })
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  [' + info + ']' : ''}`)
    },
    done() {
      const bad = res.filter((r) => !r.ok)
      console.log(`\n${res.length - bad.length}/${res.length} passed`)
      return bad.length ? 1 : 0
    }
  }
}
