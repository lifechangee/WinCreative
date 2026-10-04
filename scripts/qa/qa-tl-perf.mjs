// Time-lapse editor with a long recording (injected frames): open time, scrub / scroll / playback smoothness, memory.
// node scripts/qa/qa-tl-perf.mjs [outDir] [frames]
import { _electron as electron } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const out = process.argv[2] ?? 'out-tl'
const N = Number(process.argv[3] ?? 3000)
const shots = 'qa-screens/tl'
fs.mkdirSync(shots, { recursive: true })
const ud = path.join(os.tmpdir(), 'bw-tlp-' + Date.now())
const app = await electron.launch({ args: [`${out}/main/index.js`, '--user-data-dir=' + ud], cwd: process.cwd(), env: { ...process.env, APPDATA: ud, BW_LANG: 'en' }, timeout: 60000 })
const page = await app.firstWindow()
page.setDefaultTimeout(30000)
const errs = []
page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message))
await page.waitForTimeout(3000)
await page.setViewportSize({ width: 1280, height: 720 }).catch(() => {})
await page.locator('button', { hasText: /^(Закрыть|Close)$/ }).first().click({ timeout: 2000 }).catch(() => {})
await page.evaluate(() => window.brushwork_app.newDocument(1600, 1000))
await page.waitForTimeout(1200)
let fails = 0
const check = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + ' ' + x); if (!c) fails++ }

// inject N frames: a drawing that grows, with undo/redo noise (every 40th frame is an undone branch)
const inj = await page.evaluate(async (N) => {
  const rec = window.brushwork_animio.tl.current
  await rec.flush()
  const api = window.animio.tl
  const mk = async (i) => {
    const c = new OffscreenCanvas(1280, 800)
    const g = c.getContext('2d')
    g.fillStyle = '#fff'; g.fillRect(0, 0, 1280, 800)
    g.lineWidth = 6
    for (let k = 0; k <= i; k += Math.max(1, Math.floor(i / 40))) { g.strokeStyle = `hsl(${(k * 7) % 360} 70% 50%)`; g.beginPath(); g.moveTo(40 + (k % 50) * 24, 60 + (k % 17) * 40); g.lineTo(300 + ((k * 3) % 40) * 20, 700 - (k % 23) * 25); g.stroke() }
    g.fillStyle = '#000'; g.font = '48px sans-serif'; g.fillText('frame ' + i, 40, 780)
    return new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.6 })).arrayBuffer())
  }
  const cache = []
  for (let i = 0; i < 60; i++) cache.push(await mk(i * Math.floor(N / 60)))
  await api.start(rec.id)
  const parents = [-1]
  let cur = 0
  const t0 = performance.now()
  for (let i = 0; i < N; i++) {
    let t = 'stroke'
    if (i % 40 === 20) { parents.push(cur); cur = parents.length - 1; t = 'stroke' } // a stroke that will be undone
    else if (i % 40 === 21) { cur = parents[cur]; t = 'undo' }
    else { parents.push(cur); cur = parents.length - 1 }
    await api.append(rec.id, cache[Math.floor((i / N) * 60)], 33, { t, s: cur })
  }
  rec.tracker.parents.length = 0
  rec.tracker.parents.push(...parents)
  rec.tracker.curr = cur
  rec.count = N
  return { ms: Math.round(performance.now() - t0), parents: parents.length }
}, N)
console.log('injected', JSON.stringify(inj))

const heap = () => page.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 1e6))
const h0 = await heap()
const t0 = Date.now()
await page.locator('.tb-left .tb-tab').click()
await page.waitForSelector('.tle .tle-cv')
const openMs = Date.now() - t0
await page.waitForTimeout(1500)
check('opens with ' + N + ' frames quickly', openMs < 3000, openMs + ' ms')
await page.screenshot({ path: path.join(shots, 'perf-01-open.png') })
// scroll + zoom stress: measure frame cost of draw via rAF deltas
const scrollStats = await page.evaluate(async () => {
  const sc = document.querySelector('.tle-scroll')
  const zin = document.querySelector('.tle-tlbar .tle-btn.tle-icon:nth-of-type(2)')
  const buttons = [...document.querySelectorAll('.tle-tlbar .tle-btn.tle-icon')]
  buttons[1].click(); buttons[1].click(); buttons[1].click(); buttons[1].click(); buttons[1].click()
  await new Promise((r) => setTimeout(r, 300))
  const deltas = []
  let last = performance.now()
  const max = sc.scrollWidth - sc.clientWidth
  for (let i = 0; i < 120; i++) {
    sc.scrollLeft = (max * i) / 120
    await new Promise((r) => requestAnimationFrame(r))
    const n = performance.now(); deltas.push(n - last); last = n
  }
  deltas.sort((a, b) => a - b)
  return { scrollWidth: sc.scrollWidth, p50: deltas[60], p95: deltas[114], max: deltas[119] }
})
console.log('scroll', JSON.stringify(scrollStats))
check('timeline scroll stays smooth (p95 < 50 ms)', scrollStats.p95 < 50, JSON.stringify(scrollStats))
await page.screenshot({ path: path.join(shots, 'perf-02-zoomed.png') })
// playback at 12x for 3 s: count displayed frames
const play = await page.evaluate(async () => {
  const cv = document.querySelector('.tle-canvas')
  let draws = 0
  const orig = cv.getContext('2d').drawImage.bind(cv.getContext('2d'))
  cv.getContext('2d').drawImage = (...a) => { draws++; return orig(...a) }
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Home', key: 'Home', bubbles: true }))
  const speed = document.querySelector('.tle-card input.tle-num')
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }))
  const t0 = performance.now()
  let frames = 0
  const lastTime = document.querySelector('.tle-time')
  await new Promise((r) => { const f = () => { frames++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else r() }; requestAnimationFrame(f) })
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }))
  return { draws, rafs: frames, label: lastTime.textContent }
})
console.log('play', JSON.stringify(play))
check('preview keeps up during playback (>= 20 decoded frames/s)', play.draws >= 60, JSON.stringify(play))
// step + scrub latency
const scrub = await page.evaluate(async () => {
  const sc = document.querySelector('.tle-scroll')
  const inner = document.querySelector('.tle-inner')
  const r = sc.getBoundingClientRect()
  const ts = []
  for (let i = 0; i < 30; i++) {
    const t0 = performance.now()
    inner.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left + 40 + i * 30, clientY: r.top + 40, pointerId: 5, pointerType: 'mouse', button: 0, bubbles: true }))
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    ts.push(performance.now() - t0)
  }
  ts.sort((a, b) => a - b)
  return { p50: ts[15], p95: ts[28] }
})
console.log('scrub', JSON.stringify(scrub))
const h1 = await heap()
console.log('heap MB', h0, '->', h1)
check('memory stays bounded (heap growth < 200 MB)', h1 - h0 < 200, `${h0} -> ${h1}`)
const info = await page.evaluate(() => document.querySelector('.tle-side').innerText.match(/\d+ undone actions? hidden[^\n]*/)?.[0])
console.log('hidden info:', info)
check('hidden undone actions reported', /undone actions hidden/.test(info ?? ''))
console.log('errors', errs.slice(0, 5))
console.log(fails ? 'FAILED ' + fails : 'ALL OK')
await app.close()
process.exit(fails ? 1 : 0)
