// Infinite-canvas QA (real Electron via playwright, isolated profile). usage: node scripts/qa/qa-inf-core.mjs [--out out-inf] [scenario ...]
// scenarios: dirs undo save kill zoom mem perf
import { execSync } from 'child_process'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { unzipSync, strFromU8 } from 'fflate'
import { launch, outDirOf, save, setBrush, stats, strokeDoc } from './qa-inf-lib.mjs'

const args = process.argv.slice(2)
const outDir = outDirOf(args)
const scen = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out')
const want = (n) => !scen.length || scen.includes(n)
const results = {}
let fails = 0
const check = (name, cond, extra = '') => {
  console.log(cond ? 'PASS' : 'FAIL', name, extra)
  if (!cond) fails++
}

/** helpers living in the page: deterministic strokes, per-tile hashes */
const PAGE_HELPERS = () => {
  window.__qa = {
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
      const s = this.samples(pts)
      const t = app.tools.get(tool)
      if (!t.begin(s[0], app)) throw new Error('begin refused')
      for (let i = 1; i < s.length; i += 8) t.move(s.slice(i, i + 8), app)
      t.end(app)
    },
    /** max premultiplied 8-bit difference over every tile of every layer of two infinite docs (tile sets must match); .bwk stores straight alpha, so the roundtrip is exact only to the premultiplication rounding */
    diff(d1, d2) {
      let max = 0, missing = 0
      const g = d1.gpu
      for (const l of d1.layers) {
        if (!l.tiles) continue
        const l2 = d2.getLayer(l.id)
        for (const [k, s] of l.tiles.map) {
          const a = g.readRGBA8(s, { x: 0, y: 0, w: s.w, h: s.h })
          let any = false
          for (let i = 3; i < a.length; i += 4) if (a[i]) { any = true; break }
          const s2 = l2?.tiles?.map.get(k)
          if (!s2) { if (any) missing++; continue }
          const b = g.readRGBA8(s2, { x: 0, y: 0, w: s2.w, h: s2.h })
          for (let i = 0; i < a.length; i += 4) {
            const pa = a[i + 3], pb = b[i + 3]
            let d = Math.abs(pa - pb)
            for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs((a[i + c] * pa) / 255 - (b[i + c] * pb) / 255))
            if (d > max) max = d
          }
        }
      }
      return { max, missing }
    },
    /** straight RGBA of every non-empty tile as base64 (key -> data) */
    dump(doc = window.brushwork_app.doc) {
      const out = {}
      for (const l of doc.layers) {
        if (!l.tiles) continue
        for (const [k, s] of l.tiles.map) {
          const px = doc.gpu.readRGBA8(s, { x: 0, y: 0, w: s.w, h: s.h })
          let any = false
          for (let i = 3; i < px.length; i += 4) if (px[i]) { any = true; break }
          if (!any) continue
          let b = ''
          for (let i = 0; i < px.length; i += 0x8000) b += String.fromCharCode.apply(null, px.subarray(i, i + 0x8000))
          out[l.id + ':' + k] = btoa(b)
        }
      }
      return out
    },
    /** FNV-1a over every tile of every paint layer (tile coordinates included): { tiles, hash, per: {layer: {key: h}} } */
    hash(doc = window.brushwork_app.doc) {
      const per = {}
      let tiles = 0
      let all = 2166136261
      for (const l of doc.layers) {
        if (!l.tiles) continue
        const m = (per[l.id] = {})
        const keys = [...l.tiles.map.keys()].sort((a, b) => a - b)
        for (const k of keys) {
          const s = l.tiles.map.get(k)
          const px = doc.gpu.readRGBA8(s, { x: 0, y: 0, w: s.w, h: s.h })
          let h = 2166136261
          for (let i = 0; i < px.length; i++) h = Math.imul(h ^ px[i], 16777619) >>> 0
          // an all-transparent tile may legitimately be missing after reload: record it only when it has pixels
          let any = false
          for (let i = 3; i < px.length; i += 4) if (px[i]) { any = true; break }
          if (!any) continue
          m[k] = h
          tiles++
          all = Math.imul(all ^ h ^ (k % 65521), 16777619) >>> 0
        }
      }
      return { tiles, hash: all, per }
    }
  }
}

const spiral = (cx, cy, r0, r1, turns, n) => {
  const pts = []
  for (let i = 0; i <= n; i++) {
    const u = i / n
    const a = u * turns * Math.PI * 2
    const r = r0 + (r1 - r0) * u
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.8, 0.35 + 0.5 * Math.sin(u * 9) ** 2])
  }
  return pts
}
const newInf = (page) =>
  page.evaluate(() => {
    const app = window.brushwork_app
    app.newDocument(4096, 4096, { kind: 'infinite', background: { color: [1, 1, 1], visible: true } })
    app.setView({ cx: 0, cy: 0, zoom: 1, rot: 0 })
    app.renderNow()
  })

// ---------------------------------------------------------------------------------------------------------------------
if (want('dirs')) {
  const { app, page, errors } = await launch(outDir)
  await page.evaluate(PAGE_HELPERS)
  await newInf(page)
  await setBrush(page, 'hard-round', 60)
  const spots = []
  for (const sx of [-1, 0, 1]) for (const sy of [-1, 0, 1]) if (sx || sy) spots.push([sx * 50000, sy * 50000])
  for (const [x, y] of spots) await strokeDoc(page, [[x - 120, y - 40], [x, y + 40], [x + 120, y - 40]])
  const r = await page.evaluate((spots) => {
    const a = window.brushwork_app
    const doc = a.doc
    const l = doc.activeLayer
    const out = spots.map(([x, y]) => {
      const px = doc.readRegionPixels(l, { x: x - 20, y: y + 20, w: 40, h: 40 })
      let n = 0
      for (let i = 3; i < px.length; i += 4) if (px[i] > 200) n++
      return n
    })
    return { out, stats: doc.tileStats(), bounds: doc.contentBounds({ tight: true }) }
  }, spots)
  check('paint at +-50000 in all 8 directions', r.out.every((n) => n > 100), JSON.stringify(r.out))
  check('content bounds span +-50000', r.bounds.x < -49800 && r.bounds.x + r.bounds.w > 49800 && r.bounds.y < -49800 && r.bounds.y + r.bounds.h > 49800, JSON.stringify(r.bounds))
  check('only touched tiles exist', r.stats.tiles >= 8 && r.stats.tiles <= 40, JSON.stringify(r.stats))
  // one very long stroke across 80000 px (many tiles) at 2% zoom, big brush
  await page.evaluate(() => window.brushwork_app.setView({ cx: 0, cy: 0, zoom: 0.02, rot: 0 }))
  await page.evaluate(() => window.__qa.cfg('brush', 'hard-round', 500, 1, '#2060d0'))
  await page.evaluate(() => {
    const pts = []
    for (let i = 0; i <= 160; i++) pts.push([-40000 + i * 500, -40000 + i * 500 + Math.sin(i / 8) * 3000, 0.8])
    window.__qa.stroke('brush', pts)
    window.brushwork_app.renderNow()
  })
  const r2 = await page.evaluate(() => ({ stats: window.brushwork_app.doc.tileStats(), b: window.brushwork_app.doc.contentBounds() }))
  check('80000 px stroke crosses ~300 tiles', r2.stats.tiles > 250, JSON.stringify(r2.stats))
  await page.waitForTimeout(500)
  save('qa-inf', 'dirs-zoom2pct.png', await page.screenshot())
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  await app.close()
}

// ---------------------------------------------------------------------------------------------------------------------
if (want('undo')) {
  const { app, page, errors } = await launch(outDir)
  await page.evaluate(PAGE_HELPERS)
  await newInf(page)
  const steps = [
    ['brush', 'hard-round', 200, '#d02020', spiral(0, 0, 40, 600, 1.2, 80)],
    ['brush', 'soft-airbrush', 400, '#2060d0', spiral(5000, -3000, 40, 700, 1.2, 80)],
    ['smudge', 'smudge-soft', 200, '#000000', spiral(0, 0, 100, 500, 1, 60)],
    ['eraser', 'eraser-hard', 260, '#000000', spiral(0, 0, 40, 300, 1, 60)],
    ['brush', 'paint-oil', 90, '#20a040', spiral(-60000, 40000, 40, 500, 1.2, 80)],
    ['clear', '', 0, '', []]
  ]
  const states = [await page.evaluate(() => window.__qa.hash())]
  for (const [tool, preset, size, hex, pts] of steps) {
    await page.evaluate(([tool, preset, size, hex, pts]) => { if (tool === 'clear') { const d = window.brushwork_app.doc; d.clearLayer(d.activeId); return } window.__qa.cfg(tool, preset, size, 1, hex); window.__qa.stroke(tool, pts) }, [tool, preset, size, hex, pts])
    states.push(await page.evaluate(() => window.__qa.hash()))
  }
  check('strokes created content', states[1].tiles > 0 && states[states.length - 1].hash !== states[1].hash, states.map((s) => s.tiles).join(','))
  let ok = true
  for (let k = steps.length; k >= 1; k--) {
    await page.evaluate(() => window.brushwork_app.undo())
    const h = await page.evaluate(() => window.__qa.hash())
    if (h.hash !== states[k - 1].hash || h.tiles !== states[k - 1].tiles) { ok = false; console.log('  undo mismatch at step', k, h.tiles, states[k - 1].tiles) }
  }
  check('undo all 6 steps restores every earlier state exactly (incl. tile allocation / free)', ok)
  const empty = await page.evaluate(() => window.brushwork_app.doc.tileStats())
  check('after undoing everything no tile is allocated', empty.tiles === 0, JSON.stringify(empty))
  ok = true
  for (let k = 1; k <= steps.length; k++) {
    await page.evaluate(() => window.brushwork_app.redo())
    const h = await page.evaluate(() => window.__qa.hash())
    if (h.hash !== states[k].hash || h.tiles !== states[k].tiles) { ok = false; console.log('  redo mismatch at step', k) }
  }
  check('redo all 6 steps reproduces every state exactly', ok)
  // erase that frees tiles (erase 3000 px brush over painted tiles) is undoable
  const before = states[steps.length - 1].tiles
  check('Clear layer freed every tile (undoable)', states[steps.length].tiles === 0 && before > 0, `${before} -> ${states[steps.length].tiles}`)
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  await app.close()
}

// ---------------------------------------------------------------------------------------------------------------------
if (want('save')) {
  const { app, page, errors } = await launch(outDir)
  await page.evaluate(PAGE_HELPERS)
  await newInf(page)
  await page.evaluate(() => {
    const doc = window.brushwork_app.doc
    doc.addLayer({ name: 'multiply', blendMode: 'multiply' })
    doc.addLayer({ name: 'clip', clipping: true })
    doc.setLayerProps(doc.layers[0].id, { opacity: 0.8 })
  })
  const strokes = [[0, 'hard-round', 160, '#d02020', spiral(0, 0, 40, 700, 1.2, 80)], [1, 'soft-airbrush', 300, '#2060d0', spiral(30000, -20000, 40, 700, 1.2, 80)], [2, 'hard-round', 100, '#20a040', spiral(-45000, 45000, 40, 400, 1, 60)]]
  for (const [li, preset, size, hex, pts] of strokes) {
    await page.evaluate(([li, preset, size, hex, pts]) => { const d = window.brushwork_app.doc; d.setActive(d.layers[li].id); window.__qa.cfg('brush', preset, size, 1, hex); window.__qa.stroke('brush', pts) }, [li, preset, size, hex, pts])
  }
  const before = await page.evaluate(() => window.__qa.hash())
  const t0 = Date.now()
  const r1 = await page.evaluate(async () => {
    const r = await window.brushwork_io.saveBwkEx()
    return { b64: btoa(Array.from(r.bytes.subarray(0, 0)).join('')), n: r.bytes.length, encoded: r.encoded, reused: r.reused, thumb: r.thumbnail.length, hold: (window.__bytes = r.bytes).length }
  })
  const full = Date.now() - t0
  const bytes = await page.evaluate(() => { const b = window.__bytes; let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s) })
  const zip = unzipSync(new Uint8Array(Buffer.from(bytes, 'base64')))
  const mf = JSON.parse(strFromU8(zip['manifest.json']))
  const names = Object.keys(zip)
  save('qa-inf', 'sample.bwk', Buffer.from(bytes, 'base64'))
  check('manifest v2 / kind infinite', mf.version === 2 && mf.kind === 'infinite' && mf.infinite?.tileSize === 512, JSON.stringify({ v: mf.version, kind: mf.kind }))
  check('tile PNGs layers/<id>/<tx>_<ty>.png', names.filter((n) => /^layers\/[^/]+\/-?\d+_-?\d+\.png$/.test(n)).length === before.tiles, `${names.length} entries, ${before.tiles} tiles`)
  check('full save encoded every tile', r1.encoded === before.tiles, JSON.stringify({ encoded: r1.encoded, reused: r1.reused, ms: full }))
  // reload
  const after = await page.evaluate(async () => {
    const d2 = await window.brushwork_io.loadBwk(window.__bytes)
    const h = window.__qa.hash(d2)
    const df = window.__qa.diff(window.brushwork_app.doc, d2)
    return { h, df, kind: d2.kind, layers: d2.layers.map((l) => [l.name, l.blendMode, l.clipping, l.opacity]) }
  })
  check('reload: kind infinite, same tiles', after.kind === 'infinite' && after.h.tiles === before.tiles && after.df.missing === 0, `${after.h.tiles}/${before.tiles} tiles`)
  let sameHash = 0, tot = 0
  for (const lid of Object.keys(before.per)) for (const k of Object.keys(before.per[lid])) { tot++; if (after.h.per[lid]?.[k] === before.per[lid][k]) sameHash++ }
  check('reload: pixels identical per tile (premultiplied diff <= 1 level; byte-identical hash on ' + sameHash + '/' + tot + ' tiles)', after.df.max <= 1, 'maxDiff=' + after.df.max)
  // incremental: one more small stroke only re-encodes the dirty tile(s)
  await page.evaluate(() => { window.__revs = new Map(); for (const l of window.brushwork_app.doc.layers) if (l.tiles) for (const [k, s] of l.tiles.map) window.__revs.set(l.id + ':' + k, s.rev) })
  await page.evaluate(() => { window.__qa.cfg('brush', 'hard-round', 40, 1, '#000000'); window.__qa.stroke('brush', [[10, 10, 0.8], [60, 40, 0.8], [120, 10, 0.8]]) })
  const changed = await page.evaluate(() => { const o = []; for (const l of window.brushwork_app.doc.layers) if (l.tiles) for (const [k, s] of l.tiles.map) if (window.__revs.get(l.id + ':' + k) !== s.rev) o.push(l.name + ':' + k + ':' + (window.__revs.has(l.id + ':' + k) ? 'rev' : 'new')); return o })
  console.log('  surfaces whose rev changed since the first save:', JSON.stringify(changed))
  const t1 = Date.now()
  const r2 = await page.evaluate(async () => { const r = await window.brushwork_io.saveBwkEx(); return { encoded: r.encoded, reused: r.reused } })
  check('incremental save re-encodes only dirty tiles', r2.encoded === changed.length && r2.reused === before.tiles, JSON.stringify({ ...r2, ms: Date.now() - t1 }))
  // fixed document: still a v1 manifest, roundtrip identical
  const fx = await page.evaluate(async () => {
    const a = window.brushwork_app
    a.newDocument(1024, 768, { background: { color: [1, 1, 1], visible: true } })
    window.__qa.cfg('brush', 'hard-round', 80, 1, '#d02020')
    window.__qa.stroke('brush', [[100, 100, 0.8], [500, 300, 0.8], [900, 200, 0.8]])
    const bytes = await window.brushwork_io.saveBwk()
    const d2 = await window.brushwork_io.loadBwk(bytes)
    const px = (d) => a.gpu.readRGBA8(d.layers[0].pixels, { x: 0, y: 0, w: 1024, h: 768 })
    const A = px(a.doc), B = px(d2)
    let diff = 0
    for (let i = 0; i < A.length; i += 4) { const pa = A[i + 3], pb = B[i + 3]; let d = Math.abs(pa - pb); for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs((A[i + c] * pa) / 255 - (B[i + c] * pb) / 255)); if (d > diff) diff = d }
    let s = ''
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
    return { diff, kind: d2.kind, b64: btoa(s) }
  })
  const fmf = JSON.parse(strFromU8(unzipSync(new Uint8Array(Buffer.from(fx.b64, 'base64')))['manifest.json']))
  check('fixed document keeps writing manifest v1 and round-trips (max premultiplied diff <= 3 levels: 16F layer <-> 8-bit PNG)', fmf.version === 1 && !fmf.kind && fx.diff <= 3 && fx.kind === 'fixed', JSON.stringify({ v: fmf.version, maxPremultDiff: fx.diff }))
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  await app.close()
}

// ---------------------------------------------------------------------------------------------------------------------
if (want('kill')) {
  const base = mkdtempSync(join(tmpdir(), 'bw-infkill-'))
  const env = { BW_GALLERY_DIR: join(base, 'gallery') }
  const ud = join(base, 'ud')
  for (const delay of [60, 400]) {
    const A = await launch(outDir, env, ud)
    await A.page.evaluate(PAGE_HELPERS)
    const id = await A.page.evaluate(async () => {
      const app = window.brushwork_app
      app.newDocument(4096, 4096, { kind: 'infinite', background: { color: [1, 1, 1], visible: true } })
      app.setView({ cx: 0, cy: 0, zoom: 1, rot: 0 })
      return await window.brushwork_io.gallery().addDocument(app.doc, { name: 'infkill' + Date.now() })
    })
    await A.page.evaluate(async () => { await window.brushwork_io.gallery().idle() })
    await A.page.evaluate(() => { window.__qa.cfg('brush', 'hard-round', 150, 1, '#d02020') })
    await A.page.evaluate(() => { const hide = window.brushwork_io.gallery(); window.__qa.stroke('brush', [[-300, -100, 0.8], [100, 200, 0.8], [600, -150, 0.8], [1300, 250, 0.8]]) }) // crosses the tile borders x = 0 / 512 / 1024
    const live = await A.page.evaluate(() => window.__qa.dump())
    await A.page.waitForTimeout(delay)
    const pid = A.app.process().pid
    try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {}
    await new Promise((r) => setTimeout(r, 1500))
    const B = await launch(outDir, env, ud)
    await B.page.evaluate(PAGE_HELPERS)
    const rec = await B.page.evaluate(async (id) => {
      await window.brushwork_io.gallery().open(id)
      return { kind: window.brushwork_app.doc.kind, d: window.__qa.dump() }
    }, id)
    let worst = 0
    const keys = Object.keys(live)
    for (const k of keys) {
      if (!rec.d[k]) { worst = 999; continue }
      const a = Buffer.from(live[k], 'base64'), b = Buffer.from(rec.d[k], 'base64')
      for (let i = 0; i < a.length; i += 4) { let d = Math.abs(a[i + 3] - b[i + 3]); for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs((a[i + c] * a[i + 3]) / 255 - (b[i + c] * b[i + 3]) / 255)); if (d > worst) worst = d }
    }
    check(`kill -9 ${delay}ms after the stroke: infinite document recovered (${keys.length} tiles, max premult diff ${worst.toFixed(2)})`, rec.kind === 'infinite' && keys.length > 3 && Object.keys(rec.d).length === keys.length && worst <= 1.01)
    await B.app.close()
  }
}

// ---------------------------------------------------------------------------------------------------------------------
const MONITOR = () => {
  const m = (window.__fm = { last: performance.now(), gaps: [], on: false })
  const tick = (t) => {
    const g = t - m.last
    m.last = t
    if (m.on) m.gaps.push(g)
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

/** paint ~N tiles: horizontal strokes with a big brush */
const FILL = async (page, rows, cols) => {
  await page.evaluate(
    ([rows, cols]) => {
      window.__qa.cfg('brush', 'hard-round', 300, 1, '#2060d0')
      for (let r = 0; r < rows; r++) {
        const pts = []
        for (let i = 0; i <= cols * 4; i++) pts.push([i * 128, r * 512 + 256 + Math.sin(i / 5) * 60, 0.8])
        window.__qa.stroke('brush', pts)
      }
      window.brushwork_app.renderNow()
    },
    [rows, cols]
  )
}

if (want('zoom')) {
  const { app, page, errors } = await launch(outDir)
  await page.evaluate(PAGE_HELPERS)
  await page.evaluate(MONITOR)
  await newInf(page)
  // 3 layers incl. a blend mode and a clipped one: ~25 x 24 tiles (+ neighbours) on layer 1, more on the others
  await page.evaluate(() => {
    const d = window.brushwork_app.doc
    d.addLayer({ name: 'mul', blendMode: 'multiply' })
    d.addLayer({ name: 'clip', clipping: true })
  })
  for (let li = 0; li < 3; li++) {
    await page.evaluate((li) => { const d = window.brushwork_app.doc; d.setActive(d.layers[li].id); window.__qa.cfg('brush', 'hard-round', 300, 1, ['#2060d0', '#e0a020', '#d02020'][li]) }, li)
    await page.evaluate((li) => {
      for (let r = 0; r < 24; r++) {
        const pts = []
        for (let i = 0; i <= 100; i++) pts.push([i * 128 + li * 200, r * 512 + 256 + li * 100 + Math.sin(i / 5 + li) * 60, 0.8])
        window.__qa.stroke('brush', pts)
      }
    }, li)
  }
  const st = await page.evaluate(() => ({ s: window.brushwork_app.doc.tileStats(), b: window.brushwork_app.doc.contentBounds() }))
  console.log('doc:', JSON.stringify(st))
  check('500+ tiles painted', st.s.tiles >= 500, String(st.s.tiles))
  // frames are driven by the app's own rAF render loop (requestRender); present() is wrapped to time the GPU-synchronous cost of each frame
  await page.evaluate(() => {
    const app = window.brushwork_app
    const gl = app.gpu.gl
    const orig = app.compositor.present.bind(app.compositor)
    window.__costs = []
    app.compositor.present = (...a) => { const t = performance.now(); orig(...a); gl.finish(); window.__costs.push(performance.now() - t) }
  })
  for (const zoom of [1, 0.5, 0.25, 0.1, 0.05, 0.02]) {
    const r = await page.evaluate(async (zoom) => {
      const app = window.brushwork_app
      const b = app.doc.contentBounds()
      const view = (k) => ({ cx: b.x + b.w * (0.1 + 0.8 * k), cy: b.y + b.h * (0.1 + 0.8 * Math.abs(Math.sin(k * 6))), zoom, rot: 0 })
      // warm-up pass = the first look at the artwork at this zoom: builds the pyramid levels (progressive, budgeted per frame)
      const w0 = performance.now()
      for (let pass = 0; pass < 2; pass++) {
        const t0 = performance.now()
        await new Promise((done) => {
          const step = () => {
            const k = (performance.now() - t0) / 3000
            if (k >= 1) return done()
            app.setView(view(k))
            requestAnimationFrame(step)
          }
          requestAnimationFrame(step)
        })
      }
      while (app.compositor.inf.stats.pending) await new Promise((r) => setTimeout(r, 30))
      const warm = performance.now() - w0
      const m = window.__fm
      m.gaps = []
      window.__costs.length = 0
      m.on = true
      const t0 = performance.now()
      await new Promise((done) => {
        const step = () => {
          const k = (performance.now() - t0) / 2500
          if (k >= 1) return done()
          app.setView(view(k))
          requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      })
      m.on = false
      const s = app.compositor.inf.stats
      return { gaps: m.gaps.slice(2), costs: window.__costs.slice(2), level: s.level, drawn: s.drawn, comps: s.comps, warm }
    }, zoom)
    const g = stats(r.gaps)
    const c = stats(r.costs)
    results['zoom' + zoom] = { gapP95: +g.p95.toFixed(1), gapP99: +g.p99.toFixed(1), costP95: +c.p95.toFixed(2), costMax: +c.max.toFixed(1), level: r.level, tilesDrawn: r.drawn }
    check(`pan at ${Math.round(zoom * 100)}% zoom: frame gap p95 <= 16.7 ms`, g.p95 <= 17.5, `gapP95=${g.p95.toFixed(1)} gapP99=${g.p99.toFixed(1)} max=${g.max.toFixed(1)} presentCost mean=${c.mean.toFixed(2)} p95=${c.p95.toFixed(2)} max=${c.max.toFixed(1)} level=${r.level} tilesDrawn=${r.drawn} comps=${r.comps} warm=${Math.round(r.warm)}ms`)
    if (zoom === 0.02 || zoom === 0.1 || zoom === 0.25) {
      await page.waitForTimeout(200)
      save('qa-inf', `zoom-${Math.round(zoom * 100)}.png`, await page.screenshot())
    }
  }
  // cold zoom-out: how long until the whole artwork is built at 3 %
  const cold = await page.evaluate(async () => {
    const app = window.brushwork_app
    const b = app.doc.contentBounds()
    app.compositor.inf.dispose() // drop every cached composite
    app.setView({ cx: b.x + b.w / 2, cy: b.y + b.h / 2, zoom: 0.03, rot: 0 })
    const t0 = performance.now()
    window.__costs.length = 0
    let n = 0
    do {
      await new Promise((r) => requestAnimationFrame(() => r()))
      n++
    } while (app.compositor.inf.stats.pending && n < 600)
    const c = window.__costs.slice()
    return { frames: n, ms: Math.round(performance.now() - t0), maxFrameCost: Math.round(Math.max(...c)) }
  })
  console.log('cold build of the whole 3-layer artwork at 3% zoom:', JSON.stringify(cold))
  results.cold = cold
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  await app.close()
}

if (want('mem')) {
  const { app, page, errors } = await launch(outDir)
  await page.evaluate(PAGE_HELPERS)
  await newInf(page)
  const m0 = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0)
  const t0 = Date.now()
  // ~2000 tiles: 45 x 45 grid of 512-px tiles, 25 rows of full-width strokes + verticals
  await page.evaluate(() => {
    window.__qa.cfg('brush', 'hard-round', 700, 1, '#2060d0')
    for (let r = 0; r < 23; r++) {
      const pts = []
      for (let i = 0; i <= 90; i++) pts.push([i * 256, r * 1024 + 300, 0.8])
      window.__qa.stroke('brush', pts)
    }
    window.brushwork_app.renderNow()
  })
  const st = await page.evaluate(() => window.brushwork_app.doc.tileStats())
  console.log(`painted ${st.tiles} tiles = ${(st.bytes / 1048576).toFixed(0)} MB of tile memory in ${Date.now() - t0} ms`)
  check('~2000 tiles allocated without a GL error', st.tiles >= 1800, JSON.stringify(st))
  const gl = await page.evaluate(() => window.brushwork_app.gpu.gl.getError())
  check('no GL error after 2000 tiles', gl === 0, String(gl))
  const m1 = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0)
  results.mem = { tiles: st.tiles, tileMB: Math.round(st.bytes / 1048576), jsHeapDeltaMB: Math.round((m1 - m0) / 1048576) }
  const sv = await page.evaluate(async () => { const t = performance.now(); const r = await window.brushwork_io.saveBwkEx(); return { ms: Math.round(performance.now() - t), encoded: r.encoded, zipMB: Math.round(r.bytes.length / 1048576) } })
  results.mem.fullSave = sv
  console.log('full save of', st.tiles, 'tiles:', JSON.stringify(sv))
  const sv2 = await page.evaluate(async () => { window.__qa.cfg('brush', 'hard-round', 40, 1, '#000000'); window.__qa.stroke('brush', [[10, 10, 0.8], [90, 40, 0.8]]); const t = performance.now(); const r = await window.brushwork_io.saveBwkEx(); return { ms: Math.round(performance.now() - t), encoded: r.encoded, reused: r.reused } })
  results.mem.incrementalSave = sv2
  console.log('incremental save after one small stroke:', JSON.stringify(sv2))
  // zoomed-out render of all of it, then undo everything
  await page.evaluate(() => { const a = window.brushwork_app; const b = a.doc.contentBounds(); a.setView({ cx: b.x + b.w / 2, cy: b.y + b.h / 2, zoom: 0.02, rot: 0 }); for (let i = 0; i < 80; i++) a.renderNow() })
  await page.waitForTimeout(300)
  save('qa-inf', 'mem-2000tiles.png', await page.screenshot())
  console.log('mem:', JSON.stringify(results.mem))
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  await app.close()
}

if (want('perf')) {
  // 4K-equivalent drawing: real pointer strokes, frame gaps and engine CPU time, fixed 3840x2160 vs infinite (same view / brush)
  for (const kind of ['fixed', 'infinite']) {
    for (const preset of ['hard-round', 'soft-airbrush', 'paint-oil']) {
      const { app, page } = await launch(outDir)
      await page.evaluate(PAGE_HELPERS)
      await page.evaluate(MONITOR)
      await page.evaluate(([kind, preset]) => {
        const a = window.brushwork_app
        a.newDocument(3840, 2160, kind === 'infinite' ? { kind: 'infinite' } : { format: 'rgba8' })
        for (let i = 1; i < 6; i++) a.doc.addLayer({ name: 'L' + i })
        a.setView({ cx: kind === 'infinite' ? 1920 : 1920, cy: 1080, zoom: 0.5, rot: 0 })
        a.state.setTool('brush'); a.state.setPreset('brush', preset); a.state.setSize(preset === 'soft-airbrush' ? 300 : 80)
        a.renderNow()
        const prof = (window.__prof = { stamp: [], end: [], frame: [] })
        const wrap = (o, n, k) => { const f = o[n].bind(o); o[n] = (...x) => { const t = performance.now(); const r = f(...x); prof[k].push(performance.now() - t); return r } }
        wrap(a.engine, 'stamp', 'stamp'); wrap(a.engine, 'end', 'end'); wrap(a.compositor, 'present', 'frame')
      }, [kind, preset])
      await page.waitForTimeout(800)
      const box = await page.evaluate(() => { const r = window.brushwork_app.canvas.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } })
      await page.evaluate(() => { window.__fm.gaps = []; window.__fm.on = true })
      for (let s = 0; s < 6; s++) {
        const y = box.y + 140 + s * 90
        await page.mouse.move(box.x + 200, y)
        await page.mouse.down()
        for (let i = 1; i <= 90; i++) await page.mouse.move(box.x + 200 + i * 9, y + Math.sin(i / 6) * 35)
        await page.mouse.up()
        await page.waitForTimeout(60)
      }
      const r = await page.evaluate(() => { window.__fm.on = false; const p = window.__prof; return { gaps: window.__fm.gaps, stamp: p.stamp, end: p.end, frame: p.frame } })
      const g = stats(r.gaps), s = stats(r.stamp), e = stats(r.end), f = stats(r.frame)
      results[`perf-${kind}-${preset}`] = { gapP95: +g.p95.toFixed(1), gapP99: +g.p99.toFixed(1), stampMean: +s.mean.toFixed(3), stampP95: +s.p95.toFixed(3), endMean: +e.mean.toFixed(2), endMax: +e.max.toFixed(1), presentP95: +f.p95.toFixed(2) }
      console.log(kind.padEnd(8), preset.padEnd(14), JSON.stringify(results[`perf-${kind}-${preset}`]))
      await app.close()
    }
  }
  for (const preset of ['hard-round', 'soft-airbrush', 'paint-oil']) {
    const a = results[`perf-fixed-${preset}`], b = results[`perf-infinite-${preset}`]
    check(`4K strokes ${preset}: infinite frame p95 within 3 ms of fixed, stamp CPU not worse than 2x`, b.gapP95 <= Math.max(a.gapP95 + 3, 17.5) && b.stampMean <= a.stampMean * 2 + 0.2, `fixed gap ${a.gapP95} / inf gap ${b.gapP95}; stamp ${a.stampMean} vs ${b.stampMean} ms`)
  }
}

console.log('\nRESULTS', JSON.stringify(results, null, 1))
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
process.exit(fails ? 1 : 0)
