// Perf / robustness harness (playwright-driven real Electron). usage: node qa-perf.mjs [--out out-perf] [scenario ...]
// scenarios: save4k autosave4k stress
import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const args = process.argv.slice(2)
const outDir = resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : 'out-perf')
const scenarios = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out')
const want = (n) => !scenarios.length || scenarios.includes(n)

export async function launch(env = {}, ud) {
  const tmp = mkdtempSync(join(tmpdir(), 'bw-perf-'))
  const app = await electron.launch({
    args: [join(outDir, 'main', 'index.js'), `--user-data-dir=${ud ?? join(tmp, 'ud')}`],
    env: { ...process.env, BW_PERF_TEST: '1', BW_GALLERY_DIR: join(tmp, 'gallery'), ...env },
    timeout: 60000
  })
  const page = await app.firstWindow()
  page.setDefaultTimeout(120000)
  await page.waitForFunction(() => !!window.brushwork_app && !!window.brushwork_io?.gallery, null, { timeout: 60000 })
  await page.waitForTimeout(1500)
  return { app, page, tmp }
}

const MONITOR = () => {
  const m = (window.__fm = { last: performance.now(), gaps: [], long: [], on: true })
  const tick = (t) => {
    const g = t - m.last
    m.last = t
    if (m.on) m.gaps.push(g)
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  try {
    new PerformanceObserver((l) => l.getEntries().forEach((e) => m.on && m.long.push(Math.round(e.duration)))).observe({ entryTypes: ['longtask'] })
  } catch {}
  m.stalls = []
  let lt = performance.now()
  setInterval(() => { const n = performance.now(); if (m.on && n - lt > 12) m.stalls.push(Math.round(n - lt)); lt = n }, 2)
  window.__fmReset = () => { m.gaps = []; m.long = []; m.stalls = [] }
  window.__fmRead = () => {
    const g = m.gaps.slice().sort((a, b) => a - b)
    return { frames: g.length, max: Math.round(Math.max(0, ...g)), p99: Math.round(g[Math.floor(g.length * 0.99)] ?? 0), over33: g.filter((x) => x > 33.4).length, long: m.long.slice(), bigAt: m.gaps.map((x, i) => (x > 30 ? i + ':' + Math.round(x) : null)).filter(Boolean), stalls: m.stalls.slice().sort((a, b) => b - a).slice(0, 12) }
  }
}

export async function make4k(page, layers = 30) {
  return page.evaluate(async (n) => {
    const app = window.brushwork_app
    app.newDocument(3840, 2160)
    const doc = app.doc
    for (let i = 1; i < n; i++) doc.addLayer({ name: 'L' + i })
    let seed = 12345
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
    for (const l of doc.layers) {
      const w = 900, h = 600
      const d = new Uint8ClampedArray(w * h * 4)
      const r = rnd() * 255, g = rnd() * 255, b = rnd() * 255
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4
        d[o] = (r + x * 0.2 + rnd() * 30) & 255; d[o + 1] = (g + y * 0.3 + rnd() * 30) & 255; d[o + 2] = (b + (x + y) * 0.1) & 255; d[o + 3] = 200
      }
      app.gpu.uploadRGBA8(l.pixels, Math.floor(rnd() * 2800), Math.floor(rnd() * 1500), w, h, d)
    }
    doc.emitCommit('layer-props', null, null, 'setup')
    app.renderNow()
    return { layers: doc.layers.length, fmt: doc.format }
  }, layers)
}

async function stroke(page, y = 500) {
  const box = await page.evaluate(() => { const r = window.brushwork_app.canvas.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } })
  const x0 = box.x + box.w * 0.3
  await page.mouse.move(x0, box.y + y)
  await page.mouse.down()
  for (let i = 0; i < 30; i++) await page.mouse.move(x0 + i * 10, box.y + y + Math.sin(i / 4) * 30, { steps: 2 })
  await page.mouse.up()
}

const results = {}
async function main() {
  if (want('save4k')) {
    const { app, page } = await launch()
    await page.evaluate(MONITOR)
    console.log('setup', await make4k(page))
    await page.waitForTimeout(500)
    await page.evaluate(() => window.__fmReset())
    const r = await page.evaluate(async () => {
      const app = window.brushwork_app
      const t = performance.now()
      const bytes = await window.brushwork_io.saveBwk()
      return { ms: Math.round(performance.now() - t), size: bytes.length }
    })
    const fm = await page.evaluate(() => window.__fmRead())
    results.save4k = { ...r, frame: fm }
    console.log('save4k (manual full save):', JSON.stringify(results.save4k))
    await app.close()
  }
  if (want('autosave4k')) {
    const { app, page } = await launch()
    await page.evaluate(MONITOR)
    console.log('setup', await make4k(page))
    await page.evaluate(async () => {
      const store = window.brushwork_io.gallery()
      const app = window.brushwork_app
      window.__saves = []
      const orig = store.runJob.bind(store)
      store.runJob = async (...a) => { const t = performance.now(); const r = await orig(...a); window.__saves.push(Math.round(performance.now() - t) + ':' + r + ':enc' + store.lastSave.encoded + '/' + store.lastSave.reused); return r }
      await store.addDocument(app.doc)
    })
    await page.waitForTimeout(1500)
    // first: stroke on the top layer then wait for autosave (frames measured while drawing AND while saving)
    for (let round = 0; round < 3; round++) {
      await page.evaluate(() => { window.__saves.length = 0; window.__fmReset() })
      await stroke(page, 400 + round * 60)
      const drawFm = await page.evaluate(() => window.__fmRead())
      // keep drawing after autosave started: second stroke 2.0s later overlaps the save when it is slow
      await page.waitForTimeout(1900)
      await stroke(page, 700 + round * 40)
      await page.waitForFunction(() => window.__saves.length >= 1, null, { timeout: 60000 })
      await page.waitForTimeout(3000)
      const fm = await page.evaluate(() => window.__fmRead())
      const saves = await page.evaluate(() => window.__saves.slice())
      console.log(`autosave round ${round}: saves(ms)=${JSON.stringify(saves)} draw-frames=${JSON.stringify(drawFm)} all-frames=${JSON.stringify(fm)}`)
      results['autosave' + round] = { saves, fm }
    }
    await app.close()
  }
  if (want('kill')) {
    const { mkdtempSync: mk } = await import('fs')
    const { execSync } = await import('child_process')
    const base = mk(join(tmpdir(), 'bw-kill-'))
    const env = { BW_GALLERY_DIR: join(base, 'gallery') }
    const ud = join(base, 'ud')
    for (const delay of (process.env.DELAYS ?? '40,120,400').split(',').map(Number)) {
      const A = await launch(env, ud)
      const id = await A.page.evaluate(async () => {
        const app = window.brushwork_app
        app.newDocument(3840, 2160)
        const doc = app.doc
        for (let i = 1; i < 6; i++) doc.addLayer({ name: 'L' + i })
        app.state.setTool('brush'); app.state.setPreset('brush', 'hard-round'); app.state.setSize(40)
        app.fit(); app.renderNow()
        const store = window.brushwork_io.gallery()
        return await store.addDocument(doc, { name: 'killtest' })
      })
      await A.page.evaluate(async () => { await window.brushwork_io.gallery().idle() })
      const box = await A.page.evaluate(() => { const r = window.brushwork_app.canvas.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } })
      const y = box.y + 300 + delay
      await A.page.mouse.move(box.x + box.w * 0.35, y)
      await A.page.mouse.down()
      for (let i = 1; i <= 12; i++) await A.page.mouse.move(box.x + box.w * 0.35 + i * 12, y + Math.sin(i / 2) * 20)
      await A.page.mouse.up()
      const probe = await A.page.evaluate(() => { const app = window.brushwork_app; return { undo: app.doc.history.undoCount } })
      await A.page.waitForTimeout(delay)
      const pid = A.app.process().pid
      try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {}
      await new Promise((r) => setTimeout(r, 1500))
      if (process.env.DUMP) {
        const fs = await import('fs'); const { unzipSync, strFromU8 } = await import('fflate')
        const gdir = join(base, 'gallery', 'Gallery')
        const zip = unzipSync(new Uint8Array(fs.readFileSync(join(gdir, id + '.bwk'))), { filter: (f) => f.name === 'manifest.json' })
        const mf = JSON.parse(strFromU8(zip['manifest.json']))
        const j = new Uint8Array(fs.readFileSync(join(gdir, id + '.jrn')))
        const dv = new DataView(j.buffer); let o = 0; const ents = []
        while (o + 8 <= j.length) { const hl = dv.getUint32(o, true), dl = dv.getUint32(o + 4, true); if (o + 8 + hl + dl > j.length) { ents.push('TORN'); break } ents.push(strFromU8(j.subarray(o + 8, o + 8 + hl))); o += 8 + hl + dl }
        console.log('  manifest.journal=', JSON.stringify(mf.extra?.journal), 'entries=', ents)
      }
      const B = await launch(env, ud)
      const rec = await B.page.evaluate(async (id) => {
        const app = window.brushwork_app
        const store = window.brushwork_io.gallery()
        const j = await window.bwGallery.read(id + '.jrn')
        const jl = j ? j.length : 0
        const toasts = []
        app.events.on('toast', (m) => toasts.push(m))
        await store.open(id)
        window.__toasts = toasts
        const doc = app.doc
        let best = 0
        for (const l of doc.layers) { const px = app.gpu.readRGBA8(l.pixels, { x: 0, y: 0, w: doc.width, h: doc.height }); for (let i = 3; i < px.length; i += 4) if (px[i] > best) best = px[i] }
        return { layers: doc.layers.length, maxAlpha: best, journalBytesAtLaunch: jl, toasts }
      }, id)
      console.log(`kill -9 ${delay}ms after stroke: journal=${rec.journalBytesAtLaunch}B recovered maxAlpha=${rec.maxAlpha} (${rec.maxAlpha > 200 ? 'STROKE SURVIVED' : 'STROKE LOST'}) toasts=${JSON.stringify(rec.toasts)}`)
      results['kill' + delay] = rec
      await B.app.close()
    }
  }
  if (want('throttled-suite')) {
    // the whole in-app perf/robustness suite (synthetic taps + strokes bursts, hammer, journal ...) with the CPU throttled 6x via CDP
    const tmp = mkdtempSync(join(tmpdir(), 'bw-perf-'))
    const app = await electron.launch({ args: [join(outDir, 'main', 'index.js'), `--user-data-dir=${join(tmp, 'ud')}`], env: { ...process.env, BW_PERF_SELFTEST: '1', BW_GALLERY_DIR: join(tmp, 'gallery') }, timeout: 60000 })
    const page = await app.firstWindow()
    const lines = []
    page.on('console', (m) => { if (/\[perf\]/.test(m.text())) lines.push(m.text().replace(/ \(file:.*$/, '')) })
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.THROTTLE ?? 6) })
    const t0 = Date.now()
    while (!lines.some((l) => /done, failures/.test(l)) && Date.now() - t0 < 300000) await new Promise((r) => setTimeout(r, 500))
    console.log(lines.join(String.fromCharCode(10)))
    results.throttledSuite = { fails: lines.filter((l) => /FAIL/.test(l)).length, secs: Math.round((Date.now() - t0) / 1000) }
    await app.close().catch(() => {})
  }
  if (want('draw4k')) {
    // continuous drawing on a 4K canvas: frame gaps while a brush is moving (timelapse on/off, brush preset)
    for (const cfg of (process.env.CFGS ?? 'hard-round:tl,hard-round:notl,paint-oil:tl,paint-oil:notl').split(',')) {
      const [preset, tl] = cfg.split(':')
      const { app, page } = await launch()
      await page.evaluate(MONITOR)
      await page.evaluate(({ preset, tl, size }) => {
        const app = window.brushwork_app
        app.newDocument(3840, 2160)
        app.state.setTool('brush'); app.state.setPreset('brush', preset); app.state.setSize(Number(size))
        app.state.setColor({ h: 20, s: 0.8, v: 0.8 })
        app.fit(); app.renderNow()
        const rec = window.brushwork_animio?.tl?.current
        window.__tl = rec ? { on: rec.enabled } : null
        if (rec) rec.setEnabled(tl === 'tl')
        for (let i = 1; i < 8; i++) app.doc.addLayer({ name: 'L' + i })
        return window.brushwork_io.gallery().addDocument(app.doc)
      }, { preset, tl, size: process.env.SIZE ?? 60 })
      if (process.env.PROF) await page.evaluate(() => {
        const app = window.brushwork_app
        const prof = (window.__prof = {})
        const wrap = (o, n, label) => { const f = o[n].bind(o); o[n] = (...a) => { const t = performance.now(); const r = f(...a); const d = performance.now() - t; const p = (prof[label] ??= { n: 0, tot: 0, max: 0 }); p.n++; p.tot += d; if (d > p.max) p.max = d; return r } }
        wrap(app.engine, 'end', 'engine.end'); wrap(app.engine, 'stamp', 'engine.stamp'); wrap(app.engine, 'begin', 'engine.begin')
        wrap(app.compositor, 'compose', 'compose'); wrap(app.compositor, 'present', 'present')
        wrap(app.input.h, 'strokeMove', 'strokeMove'); wrap(app.input.h, 'strokeBegin', 'strokeBegin'); wrap(app.input.h, 'strokeEnd', 'strokeEnd')
        wrap(app.doc, 'emitCommit', 'emitCommit')
        const gl = app.gpu.gl
        const og = gl.getBufferSubData.bind(gl)
        prof.gbsd = []
        gl.getBufferSubData = (...a) => { const t = performance.now(); og(...a); prof.gbsd.push([Math.round(performance.now() - t), (a[2]?.byteLength ?? 0) >> 10, a[4] ?? 0]) }
        const pr = app.input.predictor
        prof.upd = []
        app.input.predictor = (f, pts) => { const t = performance.now(); pr(f, pts); prof.upd.push(Math.round((performance.now() - t) * 10) / 10) }
        const gp = PointerEvent.prototype.getPredictedEvents
        prof.gpe = []
        PointerEvent.prototype.getPredictedEvents = function () { const t = performance.now(); const r = gp.call(this); prof.gpe.push(Math.round((performance.now() - t) * 10) / 10); return r }
      })
      await page.waitForTimeout(Number(process.env.WAIT ?? 4500))
      const box = await page.evaluate(() => { const r = window.brushwork_app.canvas.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } })
      if (process.env.NOPREDICTOR) await page.evaluate(() => { window.brushwork_app.input.predictor = null })
      if (process.env.NOPRED) await page.evaluate(() => { PointerEvent.prototype.getPredictedEvents = undefined })
      if (process.env.COUNTPRED) await page.evaluate(() => { window.__pc = 0; const o = PointerEvent.prototype.getPredictedEvents; PointerEvent.prototype.getPredictedEvents = function () { const r = o.call(this); window.__pc += r.length; return r } })
      if (!process.env.NOHOVER) { await page.mouse.move(box.x + box.w * 0.5, box.y + box.h * 0.5); await page.mouse.move(box.x + box.w * 0.52, box.y + box.h * 0.5); await page.waitForTimeout(400) }
      let cdpP = null
      if (process.env.CPUPROF) { cdpP = await page.context().newCDPSession(page); await cdpP.send('Profiler.enable'); await cdpP.send('Profiler.setSamplingInterval', { interval: 250 }); await cdpP.send('Profiler.start') }
      await page.evaluate(() => window.__fmReset())
      for (let s = 0; s < 10; s++) {
        const cx = box.x + box.w * 0.3, cy = box.y + box.h * (0.2 + s * 0.06)
        await page.mouse.move(cx, cy)
        await page.mouse.down()
        for (let i = 0; i < 90; i++) await page.mouse.move(cx + i * Number(process.env.STEP ?? 6), cy + Math.sin(i / 8) * 40)
        await page.mouse.up()
        await page.waitForTimeout(700)
      }
      if (cdpP) {
        const { profile } = await cdpP.send('Profiler.stop')
        const self = new Map()
        const byId = new Map(profile.nodes.map((n) => [n.id, n]))
        const dts = profile.timeDeltas
        profile.samples.forEach((id, i) => { const n = byId.get(id); const k = (n.callFrame.functionName || '(anon)') + ' ' + n.callFrame.url.split('/').pop() + ':' + n.callFrame.lineNumber; self.set(k, (self.get(k) ?? 0) + dts[i] / 1000) })
        console.log('  cpu top: ' + [...self.entries()].filter(([k]) => !/^\(idle\)|\(program\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => k + '=' + v.toFixed(0) + 'ms').join(String.fromCharCode(10) + '           '))
      }
      const fm = await page.evaluate(() => window.__fmRead())
      if (process.env.COUNTPRED) console.log('  predicted events seen:', await page.evaluate(() => window.__pc))
      console.log(`draw4k ${preset} timelapse=${tl}: ${JSON.stringify(fm)}`)
      if (process.env.PROF) console.log('  upd first10', JSON.stringify(await page.evaluate(() => window.__prof.upd.slice(0, 10))), 'max', await page.evaluate(() => Math.max(...window.__prof.upd)), 'gpe first10', JSON.stringify(await page.evaluate(() => window.__prof.gpe.slice(0, 10))), 'max', await page.evaluate(() => Math.max(...window.__prof.gpe)))
      if (process.env.PROF) console.log('  gbsd', JSON.stringify(await page.evaluate(() => { const a = window.__prof.gbsd.slice().sort((x, y) => y[0] - x[0]); return { n: a.length, tot: a.reduce((t, x) => t + x[0], 0), top: a.slice(0, 8) } })))
      if (process.env.PROF) console.log('  prof', JSON.stringify(await page.evaluate(() => Object.fromEntries(Object.entries(window.__prof).filter(([k]) => k !== 'gbsd').map(([k, v]) => [k, `n=${v.n} avg=${(v.tot / v.n).toFixed(2)} max=${v.max.toFixed(1)}`])))))
      results['draw4k-' + cfg] = fm
      await app.close()
    }
  }
  if (want('latency')) {
    const { app, page } = await launch()
    await page.evaluate(() => {
      const app = window.brushwork_app
      app.newDocument(2048, 2048)
      app.state.setTool('brush'); app.state.setPreset('brush', 'hard-round'); app.state.setSize(20)
      app.fit(); app.renderNow()
      window.__ev = []
      app.canvas.addEventListener('pointermove', (e) => {
        if (!(e.buttons & 1)) return
        const pr = e.getPredictedEvents ? e.getPredictedEvents() : []
        window.__ev.push({ t: e.timeStamp, x: e.clientX, y: e.clientY, tip: app.strokeTip, pred: pr.map((q) => ({ t: q.timeStamp, x: q.clientX, y: q.clientY })) })
      }, true)
    })
    await page.waitForTimeout(1500)
    const box = await page.evaluate(() => { const r = window.brushwork_app.canvas.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } })
    for (let k = 0; k < 4; k++) {
      const cx = box.x + box.w * 0.3, cy = box.y + box.h * (0.3 + k * 0.1)
      await page.mouse.move(cx, cy)
      await page.mouse.down()
      for (let i = 0; i < 120; i++) await page.mouse.move(cx + i * 6, cy + Math.sin(i / 10) * 60)
      await page.mouse.up()
    }
    const ev = await page.evaluate(() => window.__ev)
    // lead / accuracy of the last predicted point of every event vs. the real pointer position when that time arrives
    let n = 0, lead = 0, err = 0, dist = 0, plain = 0
    const real = ev.filter((e) => true)
    for (let i = 0; i < real.length; i++) {
      const e = real[i]
      if (!e.pred.length) continue
      const q = e.pred[e.pred.length - 1]
      const horizon = q.t - e.t
      // real pointer position at time q.t: interpolate between real events around it
      let j = i + 1
      while (j < real.length && real[j].t < q.t) j++
      if (j >= real.length) break
      const a = real[j - 1], b = real[j]
      const f = b.t > a.t ? (q.t - a.t) / (b.t - a.t) : 0
      const rx = a.x + (b.x - a.x) * f, ry = a.y + (b.y - a.y) * f
      n++; lead += horizon; err += Math.hypot(q.x - rx, q.y - ry)
      dist += Math.hypot(q.x - e.x, q.y - e.y)
      plain += Math.hypot(e.x - rx, e.y - ry) // error of NOT predicting (showing the last real point at time q.t)
    }
    const res = { events: real.length, withPrediction: n, meanHorizonMs: +(lead / n).toFixed(1), meanLeadPx: +(dist / n).toFixed(1), errWithPredictionPx: +(err / n).toFixed(1), errWithoutPredictionPx: +(plain / n).toFixed(1) }
    res.errReduction = +(1 - res.errWithPredictionPx / res.errWithoutPredictionPx).toFixed(2)
    console.log('latency (real Chromium predicted events, CDP mouse):', JSON.stringify(res))
    results.latency = res
    await app.close()
  }
  if (want('stress')) {
    const { app, page } = await launch()
    const cdp = await page.context().newCDPSession(page)
    const rate = Number(process.env.THROTTLE ?? 6)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate })
    const N = Number(process.env.N ?? 60)
    const info = await page.evaluate(() => {
      const app = window.brushwork_app
      app.newDocument(2048, 2048)
      app.state.setTool('brush')
      app.fit()
      app.renderNow()
      const r = app.canvas.getBoundingClientRect()
      window.__docPx = (cx, cy) => {
        // client -> doc
        const v = app.view, s = app.cssSize()
        const px = cx - r.left - s.w / 2, py = cy - r.top - s.h / 2
        const c = Math.cos(-v.rot), sn = Math.sin(-v.rot)
        return { x: (c * px - sn * py) / v.zoom + v.cx, y: (sn * px + c * py) / v.zoom + v.cy }
      }
      window.__alphaAt = (cx, cy) => {
        const d = window.__docPx(cx, cy)
        const x = Math.round(d.x), y = Math.round(d.y)
        const l = app.doc.activeLayer
        let m = 0
        const px = app.gpu.readRGBA8(l.pixels, { x: x - 3, y: y - 3, w: 7, h: 7 })
        for (let i = 3; i < px.length; i += 4) m = Math.max(m, px[i])
        return m
      }
      return { l: r.left, t: r.top, w: r.width, h: r.height, undo: app.doc.history.undoCount }
    })
    const jobs = []
    const cols = 10
    for (let i = 0; i < N; i++) {
      const x = info.l + info.w * 0.3 + (i % cols) * Math.min(60, (info.w * 0.4) / cols)
      const y = info.t + 120 + Math.floor(i / cols) * 70
      const kind = i % 3 === 0 ? 'tap' : i % 3 === 1 ? 'short' : 'stroke'
      jobs.push({ x, y, kind })
    }
    const t0 = Date.now()
    for (const j of jobs) {
      await page.mouse.move(j.x, j.y)
      await page.mouse.down()
      if (j.kind !== 'tap') {
        const n = j.kind === 'short' ? 2 : 8
        for (let k = 1; k <= n; k++) await page.mouse.move(j.x + k * 3, j.y + k, { steps: 1 })
      }
      await page.mouse.up()
      if (process.env.GAP) await page.waitForTimeout(Number(process.env.GAP))
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
    await page.waitForTimeout(500)
    const res = await page.evaluate((jobs) => {
      const app = window.brushwork_app
      const lost = []
      jobs.forEach((j, i) => { if (window.__alphaAt(j.x, j.y) < 10) lost.push(i + ':' + j.kind) })
      return { undo: app.doc.history.undoCount, lost }
    }, jobs)
    console.log(`stress x${rate}: jobs=${N} undo=${res.undo} lostDots=${res.lost.length} ${JSON.stringify(res.lost)} (${Date.now() - t0}ms)`)
    results.stress = { jobs: N, undo: res.undo, lost: res.lost }
    await app.close()
  }
}
await main()
console.log('RESULTS', JSON.stringify(results))
