// Cursor / prediction jitter harness. usage: node qa-cursor.mjs [--out out-cursor]
// Emulates 125-240 Hz pen/mouse input (coalesced sub-samples + noisy predicted events), records the rendered brush-cursor
// centre and the prediction-overlay tip every animation frame, and reports backtracking + deviation from the raw pointer.
import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
const args = process.argv.slice(2)
const outDir = resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : 'out-cursor')
const tmp = mkdtempSync(join(tmpdir(), 'bw-cur-'))
const app = await electron.launch({ args: [join(outDir, 'main', 'index.js'), `--user-data-dir=${join(tmp, 'ud')}`], env: { ...process.env, BW_GALLERY_DIR: join(tmp, 'gallery') }, timeout: 60000 })
const page = await app.firstWindow()
await page.waitForFunction(() => !!window.brushwork_app, null, { timeout: 60000 })
await page.waitForTimeout(2500)
const res = await page.evaluate(async () => {
  const a = window.brushwork_app
  a.newDocument(2048, 2048); a.state.setTool('brush'); a.state.setPreset('brush', 'hard-round'); a.state.setSize(30)
  const cur = document.getElementById('brush-cursor')
  const cvr = a.canvas.getBoundingClientRect()
  const overlay = a.canvas.nextElementSibling
  const out = {}
  for (const scen of [{ n: 'pen-draw', pen: true, down: true, hz: 240 }, { n: 'mouse-draw', pen: false, down: true, hz: 125 }, { n: 'pen-hover', pen: true, down: false, hz: 240 }, { n: 'mouse-hover', pen: false, down: false, hz: 125 }]) {
    const id = 500 + Math.floor(Math.random() * 1000)
    const T = 1600
    const truth = (t) => ({ x: cvr.left + 300 + 250 * Math.sin(t / 420) + t * 0.15, y: cvr.top + 300 + 160 * Math.sin(t / 310) })
    const mk = (type, p, extra = {}) => new PointerEvent(type, { pointerId: id, pointerType: scen.pen ? 'pen' : 'mouse', isPrimary: true, clientX: p.x, clientY: p.y, pressure: scen.down ? 0.5 : 0, bubbles: true, cancelable: true, button: 0, buttons: scen.down ? 1 : 0, ...extra })
    const rng = (() => { let s = 12345; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) })()
    const rows = []
    let lastRaw = truth(0)
    if (scen.down) a.canvas.dispatchEvent(mk('pointerdown', lastRaw))
    else a.canvas.dispatchEvent(mk('pointermove', lastRaw))
    const t0 = performance.now()
    let lastEv = -1e9
    await new Promise((done) => {
      const frame = () => {
        const now = performance.now() - t0
        const step = 1000 / scen.hz
        const due = []
        if (lastEv < -1e8) lastEv = now - step
        while (lastEv + step <= now) { lastEv += step; due.push(lastEv) }
        if (due.length) {
          const pts = due.map((t) => truth(t))
          const last = pts[pts.length - 1]
          const vx = pts.length > 1 ? (last.x - pts[0].x) / (pts.length - 1) : 2
          const vy = pts.length > 1 ? (last.y - pts[0].y) / (pts.length - 1) : 0
          const n = 1 + Math.floor(rng() * 3)
          const pred = []
          for (let k = 1; k <= n; k++) pred.push(mk('pointermove', { x: last.x + vx * k * 2 + (rng() - 0.5) * 6, y: last.y + vy * k * 2 + (rng() - 0.5) * 6 }))
          const co = pts.map((p) => mk('pointermove', p))
          const ev = mk('pointermove', last)
          Object.defineProperty(ev, 'getCoalescedEvents', { value: () => co })
          Object.defineProperty(ev, 'getPredictedEvents', { value: () => pred })
          a.canvas.dispatchEvent(ev)
          lastRaw = last
        }
        requestAnimationFrame(() => {
          const r = cur.getBoundingClientRect()
          const shown = getComputedStyle(cur).display !== 'none'
          let tip = null
          try {
            const dpr = window.devicePixelRatio || 1
            const x0 = Math.max(0, Math.round((lastRaw.x - cvr.left - 90) * dpr)), y0 = Math.max(0, Math.round((lastRaw.y - cvr.top - 90) * dpr))
            const w = Math.round(180 * dpr), h = Math.round(180 * dpr)
            const d = overlay.getContext('2d').getImageData(x0, y0, w, h).data
            let best = -1e9
            for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 40) { const px = (x0 + x) / dpr + cvr.left; if (px - lastRaw.x > best) { best = px - lastRaw.x; tip = { x: px, y: (y0 + y) / dpr + cvr.top } } }
          } catch {}
          if (shown) rows.push({ cx: r.left + r.width / 2, cy: r.top + r.height / 2, rx: lastRaw.x, ry: lastRaw.y, tip })
          if (now > T) { done(); return }
          frame()
        })
      }
      frame()
    })
    if (scen.down) a.canvas.dispatchEvent(mk('pointerup', lastRaw, { buttons: 0, pressure: 0 }))
    let rev = 0, moves = 0, revPx = 0
    const dev = []
    for (let i = 1; i < rows.length; i++) {
      const dx = rows[i].rx - rows[i - 1].rx, dy = rows[i].ry - rows[i - 1].ry
      const mag = Math.hypot(dx, dy)
      if (mag < 0.5) continue
      moves++
      const proj = ((rows[i].cx - rows[i - 1].cx) * dx + (rows[i].cy - rows[i - 1].cy) * dy) / mag
      if (proj < -0.25) { rev++; revPx += -proj }
    }
    for (const r of rows) dev.push(Math.hypot(r.cx - r.rx, r.cy - r.ry))
    dev.sort((x, y) => x - y)
    let tipRev = 0, tipN = 0, tipBack = 0
    for (let i = 1; i < rows.length; i++) {
      if (!rows[i].tip || !rows[i - 1].tip) continue
      const dx = rows[i].rx - rows[i - 1].rx, dy = rows[i].ry - rows[i - 1].ry
      const mag = Math.hypot(dx, dy); if (mag < 0.5) continue
      tipN++
      const proj = ((rows[i].tip.x - rows[i - 1].tip.x) * dx + (rows[i].tip.y - rows[i - 1].tip.y) * dy) / mag
      if (proj < -1) { tipRev++; tipBack = Math.max(tipBack, -proj) }
    }
    out[scen.n] = { frames: rows.length, reversals: rev, reversalRate: +(rev / Math.max(1, moves)).toFixed(3), revPxSum: +revPx.toFixed(1), devMedian: +(dev[dev.length >> 1] ?? 0).toFixed(2), devMax: +(dev[dev.length - 1] ?? 0).toFixed(2), tipFrames: tipN, tipReversals: tipRev, tipMaxBack: +tipBack.toFixed(1) }
    await new Promise((r) => setTimeout(r, 100))
  }
  return out
})
console.log(JSON.stringify(res, null, 1))
await app.close()
