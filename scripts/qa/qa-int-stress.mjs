// 0.3.0 cross-feature stress on an INFINITE document (Playwright + real Electron). A seeded, scripted "session" mixes far-apart strokes, eraser/smudge, undo/redo
// bursts, selection + transform, adjustments (with/without selection), smart cut-outs, frame create/toggle, PNG/PSD export (frame / content), convert to fixed and back,
// background autosave, time-lapse recording and memory eviction under tiny budgets; periodically saves -> reloads -> compares per-tile hashes.
// At the end: texture/tile counts must return to the baseline after the document is closed.
// usage: [BW_EXE=...] node scripts/qa/qa-int-stress.mjs [--out out-integ] [--iters 150] [--seed 7] [--gpu 64] [--cpu 4] [--sessions 3] [--no op1,op2] [--only op1,op2]
// --sessions N: N sessions back to back (first one on a fresh doc, the others after closing it), each --iters long. Memory/handle samples go to <tmp>/bw-stress-metrics.log (+ main diag.log).
import { launch, outDirOf, reporter, sleep, stats } from './qa-int-lib.mjs'
import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const ITERS = +opt('--iters', 150)
const SEED = +opt('--seed', 7)
const outDir = outDirOf(args)
const { check, done } = reporter()
const SESSIONS = +opt('--sessions', 0)
const NO = new Set((opt('--no', '') || '').split(',').filter(Boolean))
const ONLY = new Set((opt('--only', '') || '').split(',').filter(Boolean))
const diagDir = mkdtempSync(join(tmpdir(), 'bw-diag-'))
const diagLog = join(diagDir, 'diag.log')
const { app, page, errors } = await launch(outDir, { env: { BW_DIAG_METRICS: '1', BW_DIAG_LOG: diagLog }, args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] })
console.log('diag log:', diagLog)
process.on('unhandledRejection', (e) => {
  console.log('FATAL (crash?)', crashed, String(e?.message ?? e).slice(0, 300))
  try { console.log(readFileSync(diagLog, 'utf8').split(String.fromCharCode(10)).filter((l) => !/ metrics /.test(l)).join(String.fromCharCode(10))) } catch {}
  process.exit(3)
})
await app.evaluate(({ app: a }) => { a.on('render-process-gone', (_e, _wc, d) => process.stdout.write('RPG ' + JSON.stringify(d) + String.fromCharCode(10))); a.on('child-process-gone', (_e, d) => process.stdout.write('CPG ' + JSON.stringify(d) + String.fromCharCode(10))) })
let lastOp = '', lastTiles = ''
const mlog = join(diagDir, 'metrics.log')
page.on('console', (m) => { const t = m.text(); if (t.startsWith('[stress] mem')) { appendFileSync(mlog, new Date().toISOString() + ' ' + t + String.fromCharCode(10)); return } if (t.startsWith('[stress]')) { lastOp = t; if (t.includes(' tiles ')) lastTiles = t; appendFileSync(mlog, new Date().toISOString() + ' ' + t + String.fromCharCode(10)) } })
import('node:fs').then(({ appendFileSync }) => { app.process().stderr?.on('data', (d) => appendFileSync(process.env.TEMP + '/bw-stress-stderr.log', String(d))); app.process().stdout?.on('data', (d) => appendFileSync(process.env.TEMP + '/bw-stress-stderr.log', String(d))) })
let crashed = false
page.on('crash', () => { crashed = true; console.log('RENDERER CRASHED after', lastOp, lastTiles) })

// ---- tiny budgets (eviction + scratch spill), then reload
await page.evaluate(([g, c]) => localStorage.setItem('bw.tileMem', JSON.stringify({ gpuMB: g, cpuMB: c })), [+opt('--gpu', 64), +opt('--cpu', 4)])
await page.reload()
await page.waitForFunction(() => !!window.brushwork_app && !!window.brushwork_io?.gallery && !!window.brushwork_infinite)
await sleep(1500)
await page.evaluate(`(${(await import('./qa-int-lib.mjs')).PAGE_HELPERS.toString()})()`)

// ---- page-side instrumentation: live texture counter, GL error log, hash of any document
await page.evaluate(() => {
  const gl = window.brushwork_app.gpu.gl
  const S = (window.__s = { tex: 0, glErr: {}, ops: {}, opErr: [], t: [] })
  const ct = gl.createTexture.bind(gl)
  const dt = gl.deleteTexture.bind(gl)
  gl.createTexture = () => (S.tex++, ct())
  gl.deleteTexture = (t) => (t && S.tex--, dt(t))
  S.obj = { fbo: 0, buf: 0, vao: 0, sync: 0, prog: 0, rb: 0 }
  for (const [k, c, d] of [['fbo', 'createFramebuffer', 'deleteFramebuffer'], ['buf', 'createBuffer', 'deleteBuffer'], ['vao', 'createVertexArray', 'deleteVertexArray'], ['sync', 'fenceSync', 'deleteSync'], ['prog', 'createProgram', 'deleteProgram'], ['rb', 'createRenderbuffer', 'deleteRenderbuffer']]) {
    const cf = gl[c].bind(gl), df = gl[d].bind(gl)
    gl[c] = (...a) => (S.obj[k]++, cf(...a))
    gl[d] = (o) => (o && S.obj[k]--, df(o))
  }
  window.__lost = 0
  window.brushwork_app.gpu.canvas.addEventListener('webglcontextlost', () => { window.__lost++ })
  setInterval(() => {
    const m = performance.memory
    console.log('[stress] mem heap=' + (m.usedJSHeapSize / 1048576).toFixed(0) + ' total=' + (m.totalJSHeapSize / 1048576).toFixed(0) + ' tex=' + S.tex + ' ' + JSON.stringify(S.obj) + ' tiles=' + JSON.stringify(window.brushwork_app.doc.tileStats()))
  }, 1000)
  window.__hashOf = (doc, release = false) => {
    const out = {}
    const g = window.brushwork_app.gpu
    doc.layers.forEach((l, li) => {
      if (!l.tiles) return
      for (const k of l.tiles.keys()) {
        const s = l.tiles.getKey(k)
        if (!s) continue
        const px = g.readRGBA8(s, { x: 0, y: 0, w: s.w, h: s.h })
        let h = 2166136261, any = false
        for (let i = 0; i < px.length; i += 4) {
          if (!px[i + 3]) continue
          any = true
          h = Math.imul(h ^ px[i + 3], 16777619)
          if (px[i + 3] === 255) { h = Math.imul(h ^ px[i], 16777619); h = Math.imul(h ^ px[i + 1], 16777619); h = Math.imul(h ^ px[i + 2], 16777619) }
        }
        if (any) out[li + ':' + k] = h >>> 0
        if (release) l.tiles.free(k) // a disposable copy: give every tile back right away (restoring ALL tiles of a big document at once would exhaust the GPU)
      }
    })
    return out
  }
})
const newInf = () => page.evaluate(() => { const a = window.brushwork_app; a.newDocument(2048, 2048, { kind: 'infinite', background: { color: [1, 1, 1], visible: true } }); a.setView({ cx: 0, cy: 0, zoom: 0.05, rot: 0 }) })
const settle = async (ms = 1500) => { await page.evaluate(async (ms) => { for (let i = 0; i < ms / 50; i++) { window.brushwork_app.renderNow(); await new Promise((r) => setTimeout(r, 50)) } }, ms) }
const counts = () => page.evaluate(() => ({ tex: window.__s.tex, tiles: window.brushwork_app.doc.tileStats().tiles }))

// ---- baseline: an empty infinite document
await newInf()
await settle()
const base = await counts()
const heap0 = await page.evaluate(() => performance.memory.usedJSHeapSize)
console.log('baseline (empty infinite doc):', JSON.stringify(base))

// ---- the session
await newInf()
await page.evaluate(() => { window.brushwork_io.gallery().delayMs = 1500; window.__qa.startFm() })
const session = (SEED, ITERS) => page.evaluate(
  async ({ ITERS, SEED, NO, ONLY }) => {
    const app = window.brushwork_app
    const S = window.__s
    let seed = SEED
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
    const ri = (a, b) => Math.floor(a + rnd() * (b - a))
    const pick = (a) => a[ri(0, a.length)]
    const hex = () => '#' + [0, 0, 0].map(() => ri(20, 235).toString(16).padStart(2, '0')).join('')
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const sel = window.brushwork_selection
    let frameMade = false
    const far = () => [ri(-60000, 60000), ri(-40000, 40000)]
    const selRect = (cx, cy, w, h) => {
      const rect = { x: cx, y: cy, w, h }
      sel.setFromRegion(rect, new Uint8Array(w * h).fill(255), 'qa')
    }
    const ops = {
      stroke() {
        const [x, y] = rnd() < 0.5 ? [ri(-3000, 3000), ri(-2000, 2000)] : far()
        window.__qa.cfg('brush', 'hard-round', ri(20, 400), 1, hex())
        const pts = []
        for (let i = 0; i < 6; i++) pts.push([x + i * ri(40, 160), y + ri(-200, 200), 0.3 + rnd() * 0.6])
        window.__qa.stroke('brush', pts)
      },
      cluster() {
        const [x, y] = far()
        window.__qa.cfg('brush', 'hard-round', ri(100, 600), 1, hex())
        for (let k = 0; k < 6; k++) window.__qa.stroke('brush', [[x + k * 700, y, 0.7], [x + k * 700 + 600, y + 400, 0.7]])
      },
      eraser() {
        const l = app.doc.contentBounds({ tight: false })
        if (!l) return
        window.__qa.cfg('eraser', 'hard-round', ri(80, 500), 1, '#000000')
        window.__qa.stroke('eraser', [[l.x + rnd() * l.w, l.y + rnd() * l.h, 0.7], [l.x + rnd() * l.w, l.y + rnd() * l.h, 0.7]])
      },
      smudge() {
        const l = app.doc.contentBounds({ tight: false })
        if (!l) return
        const x = l.x + rnd() * l.w
        const y = l.y + rnd() * l.h
        window.__qa.cfg('smudge', 'hard-round', 120, 1, '#000000')
        window.__qa.stroke('smudge', [[x, y, 0.7], [x + 300, y + 100, 0.7], [x + 600, y, 0.7]])
      },
      undoRedo() {
        const k = ri(1, 9)
        for (let i = 0; i < k; i++) app.doc.undo()
        const r = ri(0, k + 1)
        for (let i = 0; i < r; i++) app.doc.redo()
      },
      async selXform() {
        const b = app.doc.contentBounds({ tight: false })
        if (!b) return
        const w = ri(200, 1400), h = ri(200, 1400)
        selRect(Math.round(b.x + rnd() * Math.max(1, b.w - w)), Math.round(b.y + rnd() * Math.max(1, b.h - h)), w, h)
        const T = window.brushwork_xform
        T.start('freeform')
        if (T.session) T.session.nudge(ri(-3000, 3000), ri(-2000, 2000))
        T.closeAll(rnd() < 0.8)
        sel.clear()
      },
      async adjust() {
        const b = app.doc.contentBounds({ tight: false })
        if (b && rnd() < 0.5) selRect(Math.round(b.x), Math.round(b.y), Math.min(1500, Math.round(b.w)), Math.min(1500, Math.round(b.h)))
        app.adjustments.run(pick(['hsb', 'gaussian', 'sharpen', 'noise', 'colorBalance']), { hue: ri(-120, 120), sat: ri(-40, 40), bri: ri(-30, 30) })
        sel.clear()
      },
      async smartCut() {
        const b = app.doc.contentBounds({ tight: false })
        if (!b) return
        const w = Math.min(900, Math.round(b.w)), h = Math.min(900, Math.round(b.h))
        selRect(Math.round(b.x + rnd() * Math.max(1, b.w - w)), Math.round(b.y + rnd() * Math.max(1, b.h - h)), w, h)
        await window.brushwork_smartselect.cut(pick(['copy', 'cut', 'removeBg', 'copyObject']))
        sel.clear()
      },
      frame() {
        const F = window.brushwork_frame
        if (!frameMade) { F.createFrame(1920, 1080); frameMade = true } else F.toggle()
      },
      async exportImg() {
        const fmt = pick(['png', 'png', 'psd'])
        console.log('[stress] export ' + fmt + ' frame=' + JSON.stringify(window.brushwork_frame.getFrame()) + ' bounds=' + JSON.stringify(app.doc.contentBounds({ tight: false })) + ' layers=' + JSON.stringify(app.doc.layers.map((l) => [l.blendMode, +l.opacity.toFixed(2), l.visible, !!l.mask, l.clipping, l.isGroup, l.tiles?.count])) + ' view=' + JSON.stringify(app.view))
        const b = await window.brushwork_io.encodeDocument(fmt, { quality: 0.9, transparent: true })
        if (!b || b.length < 100) throw new Error('empty export ' + fmt)
      },
      async saveReload() {
        console.log('[stress] tiles ' + JSON.stringify(app.doc.tileStats()))
        console.log('[stress] step save')
        const x = await window.brushwork_io.saveBwkEx()
        console.log('[stress] step load ' + x.bytes.length)
        const d2 = await window.brushwork_io.loadBwk(x.bytes)
        console.log('[stress] step hash a')
        const a = window.__hashOf(app.doc)
        console.log('[stress] step hash b')
        const b = window.__hashOf(d2, true)
        const ka = Object.keys(a), kb = Object.keys(b)
        const bad = ka.filter((k) => a[k] !== b[k]).length + kb.filter((k) => !(k in a)).length
        d2.dispose()
        if (bad) throw new Error(`save/reload mismatch: ${bad} tiles differ of ${ka.length}`)
      },
      layers() {
        const d = app.doc
        const r = rnd()
        if (r < 0.4) d.addLayer()
        else if (r < 0.7 && d.layers.length > 1) d.setLayerProps(d.activeId, { blendMode: pick(['multiply', 'screen', 'normal']), opacity: 0.4 + rnd() * 0.6 })
        else if (d.layers.length > 2) d.removeLayer?.(d.activeId)
      }
    }
    const table0 = [['stroke', 24], ['cluster', 6], ['eraser', 5], ['smudge', 4], ['undoRedo', 10], ['selXform', 7], ['adjust', 7], ['smartCut', 5], ['frame', 3], ['exportImg', 4], ['saveReload', 3], ['layers', 4]]
    const table = table0.filter(([n]) => !NO.includes(n) && (!ONLY.length || ONLY.includes(n)))
    const total = table.reduce((s, [, w]) => s + w, 0)
    const choose = () => { let r = rnd() * total; for (const [n, w] of table) if ((r -= w) < 0) return n; return 'stroke' }
    const log = []
    for (let i = 0; i < ITERS; i++) {
      const name = i % 40 === 39 && !NO.includes('saveReload') && (!ONLY.length || ONLY.includes('saveReload')) ? 'saveReload' : choose()
      const t0 = performance.now()
      console.log('[stress] #' + i + ' ' + name)
      try {
        await ops[name]()
      } catch (e) {
        if (!/Nothing to export/.test(String(e?.message))) S.opErr.push(`#${i} ${name}: ${e?.message ?? e}`) // an empty / too-wide export refusing politely is not an error
      }
      const dt = performance.now() - t0
      S.ops[name] = (S.ops[name] ?? 0) + 1
      log.push([name, dt])
      const err = app.gpu.gl.getError()
      if (err) S.glErr[name] = (S.glErr[name] ?? 0) + 1
      app.renderNow()
      if (i % 5 === 0) await sleep(60) // let the autosave / eviction / journal breathe
    }
    return log
  },
  { ITERS, SEED, NO: [...NO], ONLY: [...ONLY] }
)
const rows = await session(SEED, ITERS)
await settle(2500)
const S = await page.evaluate(() => window.__s)
const gaps = await page.evaluate(() => window.__qa.stopFm())
const opMs = {}
for (const [n, ms] of rows) (opMs[n] ??= []).push(ms)
console.log('ops run:', JSON.stringify(S.ops))
console.log('per-op ms (n / mean / p95 / max):', Object.entries(opMs).map(([n, a]) => { const s = stats(a); return `${n} ${s.n}/${s.mean.toFixed(0)}/${s.p95.toFixed(0)}/${s.max.toFixed(0)}` }).join('  '))
console.log('frame gaps while idle between ops:', JSON.stringify(stats(gaps)))
check('no operation threw', S.opErr.length === 0, S.opErr.slice(0, 5).join(' | '))
check('no GL error after any operation', Object.keys(S.glErr).length === 0, JSON.stringify(S.glErr))
const st = await page.evaluate(() => window.brushwork_app.doc.tileStats())
console.log('final tile stats:', JSON.stringify(st))

// ---- final save -> reload compare, through the gallery pipeline (verified write, atomic rename)
await page.evaluate(async () => { await window.brushwork_io.gallery().saveDocument(window.brushwork_app.doc) })
const fin = await page.evaluate(async () => {
  const app = window.brushwork_app
  const st = window.brushwork_io.gallery()
  const id = st.idOf(app.doc)
  const bytes = await window.bwGallery.read(id + '.bwk')
  const d2 = await window.brushwork_io.loadBwk(bytes)
  const a = window.__hashOf(app.doc)
  const b = window.__hashOf(d2, true)
  const ka = Object.keys(a)
  const bad = ka.filter((k) => a[k] !== b[k]).length + Object.keys(b).filter((k) => !(k in a)).length
  d2.dispose()
  return { tiles: ka.length, bad, bytes: bytes.length }
})
check('final gallery file reloads with identical tile hashes', fin.bad === 0, JSON.stringify(fin))

// ---- close the document: textures / tiles back to baseline
const heap1 = await page.evaluate(() => performance.memory.usedJSHeapSize)
await newInf()
await settle(3000)
const after = await counts()
await page.evaluate(() => window.gc?.())
await sleep(300)
const heap2 = await page.evaluate(() => performance.memory.usedJSHeapSize)
console.log('after closing:', JSON.stringify(after), 'baseline', JSON.stringify(base), `JS heap MB: base ${(heap0 / 1048576).toFixed(0)} / end of session ${(heap1 / 1048576).toFixed(0)} / after close ${(heap2 / 1048576).toFixed(0)}`)
// pooled surfaces (stroke buffers, FX temporaries, pyramid scratch) stay allocated by design: the first close shows the warm pool, later cycles must not grow
const heaps = [heap2]
const procMem = () => app.evaluate(({ app: a }) => { const o = {}; for (const m of a.getAppMetrics()) if (m.type === 'Tab' || m.type === 'GPU') o[m.type] = Math.round(m.memory.privateBytes / 1024); return o })
const memAfterClose = [await procMem()]
const cyc = []
const NCYC = SESSIONS ? SESSIONS - 1 : 2
for (let c = 0; c < NCYC; c++) {
  console.log('session', c + 2, 'of', NCYC + 1)
  await page.evaluate(() => window.__qa.startFm())
  await session(SEED + 100 + c, SESSIONS ? ITERS : Math.max(30, Math.round(ITERS / 3)))
  await settle(1500)
  await newInf()
  await settle(3000)
  cyc.push((await counts()).tex)
  await page.evaluate(() => window.gc?.())
  await sleep(1500)
  memAfterClose.push(await procMem())
  heaps.push(await page.evaluate(() => performance.memory.usedJSHeapSize))
}
console.log('JS heap MB after each close (post-GC):', heaps.map((x) => (x / 1048576).toFixed(0)).join(' '))
check('leak: JS heap after close is bounded (<= 300 MB over the cold baseline) and does not grow between closes (<= 80 MB)', heaps.every((x) => x - heap0 < 300 * 1048576) && heaps[heaps.length - 1] - heaps[Math.min(1, heaps.length - 1)] < 80 * 1048576, heaps.map((x) => (x / 1048576).toFixed(0)).join(' '))
console.log('GL textures after close: cycle0', after.tex, 'cycle1', cyc[0], 'cycle2', cyc[1], '(relative counter; baseline of the empty doc', base.tex + ')')
// the stroke-buffer pool (SurfacePool, cap 64 RGBA16F tiles) is filled or empty depending on which ops ran last: the count may vary by the pool size but must stay bounded and come back down
check('leak: live GL textures stay within the pooled bound after every close (warm + 64 pool + 16)', cyc.every((n) => n <= after.tex + 64 + 16) && Math.min(...cyc) <= after.tex + 8, `${after.tex} -> ${cyc.join(' -> ')}`)
console.log('process private MB after each close (renderer / GPU):', memAfterClose.map((m) => `${m.Tab}/${m.GPU}`).join('  '))
if (memAfterClose.length > 2) {
  // index 0 is the cold first close (pools not warm yet); compare the follow-up closes: the second half must not sit above the first half
  const f = memAfterClose.slice(1)
  const h = Math.max(1, Math.floor(f.length / 2))
  const avg = (a, k) => a.reduce((x, m) => x + (m[k] ?? 0), 0) / a.length
  const dT = avg(f.slice(-h), 'Tab') - avg(f.slice(0, h), 'Tab')
  const dG = avg(f.slice(-h), 'GPU') - avg(f.slice(0, h), 'GPU')
  const bounded = memAfterClose.every((m) => m.Tab < 1200 && m.GPU < 1500)
  check('flat memory: renderer / GPU private bytes after closing stay bounded (< 1.2 / 1.5 GB) and, with >= 4 follow-up closes, do not grow (later vs earlier <= 250 MB)', bounded && (f.length < 4 || (dT <= 250 && dG <= 250)), `renderer ${dT.toFixed(0)} MB, gpu ${dG.toFixed(0)} MB`)
}
const objs = await page.evaluate(() => window.__s.obj)
console.log('GL object counters after all sessions:', JSON.stringify(objs), 'context losses', await page.evaluate(() => window.__lost))
check('no webgl context loss', (await page.evaluate(() => window.__lost)) === 0)
check('no renderer crash', !crashed)
check('leak: tile count is 0 for the new document', after.tiles === 0)

const errs = errors.filter((e) => !/Failed to load resource|net::ERR/.test(e))
check('no console errors during the whole session', errs.length === 0, errs.slice(0, 4).join(' | '))
await app.close()
process.exit(done())
