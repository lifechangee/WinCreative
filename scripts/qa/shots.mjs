// README screenshots: paints a sunset scene with synthetic strokes in an isolated profile and captures the main UI surfaces.
//   npx electron-vite build --outDir out-shots && node scripts/qa/shots.mjs [--out out-shots] [--lang en] [--dir docs/screenshots] [--size 1360x860]
import { _electron as electron } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const out = opt('--out', 'out-shots')
const lang = opt('--lang', 'en')
const dir = opt('--dir', 'docs/screenshots')
const [W, H] = opt('--size', '1360x860').split('x').map(Number)
fs.mkdirSync(dir, { recursive: true })
const ud = path.join(os.tmpdir(), 'bw-shots-' + Date.now()) // isolated profile (APPDATA override: see main/index.ts userData migration)
const app = await electron.launch({ args: [`${out}/main/index.js`, '--user-data-dir=' + ud], cwd: process.cwd(), env: { ...process.env, APPDATA: ud, BW_LANG: lang } })
const page = await app.firstWindow()
await page.waitForTimeout(3500)
await page.setViewportSize({ width: W, height: H }).catch(() => {})
await page.evaluate(() => window.brushwork_tutorial?.close?.())
await page.keyboard.press('Escape')
await page.waitForTimeout(400)

const box = await page.evaluate(() => {
  const r = window.brushwork_app.canvas.getBoundingClientRect()
  return { x: r.left, y: r.top, w: r.width, h: r.height }
})
const P = (fx, fy) => [box.x + box.w * fx, box.y + box.h * fy]
const brush = (id, size, hsv, opacity = 1) =>
  page.evaluate(([id, size, hsv, opacity]) => {
    const s = window.brushwork_app.state
    s.setPreset('brush', id)
    s.setSize(size)
    s.setOpacity(opacity)
    s.setColor(hsv)
  }, [id, size, hsv, opacity])
const newLayer = (name) => page.evaluate((n) => window.brushwork_app.doc.addLayer({ name: n }), name)
async function stroke(pts, steps = 3) {
  const [x0, y0] = P(...pts[0])
  await page.mouse.move(x0, y0)
  await page.mouse.down()
  for (const p of pts.slice(1)) {
    const [x, y] = P(...p)
    await page.mouse.move(x, y, { steps })
  }
  await page.mouse.up()
}
const wave = (y0, amp, x0 = 0.02, x1 = 0.98, n = 40, f = 9, ph = 0) => Array.from({ length: n }, (_, i) => { const t = i / (n - 1); return [x0 + (x1 - x0) * t, y0 + Math.sin(t * f + ph) * amp] })

// ---- sky (soft airbrush bands, dark blue -> violet -> orange)
await newLayer('Sky')
const bands = [[232, 0.8, 0.28, 0.02], [236, 0.75, 0.38, 0.1], [262, 0.55, 0.52, 0.2], [300, 0.5, 0.7, 0.3], [340, 0.55, 0.88, 0.4], [18, 0.7, 1, 0.5], [34, 0.7, 1, 0.58], [250, 0.7, 0.3, 0.68], [245, 0.7, 0.28, 0.76]]
for (const [h, s, v, y] of bands) {
  await brush('soft-airbrush', 330, { h, s, v })
  for (const dy of [-0.03, 0.03]) await stroke(wave(y + dy, 0.01, 0.0, 1.0, 14, 5))
}
await brush('soft-airbrush', 330, { h: 240, s: 0.7, v: 0.3 })
for (const y of [0.85, 0.95]) await stroke(wave(y, 0.01, 0.0, 1.0, 14, 5))
// ---- stars
await newLayer('Stars')
await brush('el-stars', 40, { h: 55, s: 0.12, v: 1 }, 0.9)
await stroke(wave(0.08, 0.04, 0.05, 0.95, 26, 6))
await stroke(wave(0.17, 0.035, 0.05, 0.6, 18, 4, 1))
// ---- sun
await newLayer('Sun')
await brush('soft-airbrush', 700, { h: 30, s: 0.5, v: 1 }, 1)
await stroke([[0.66, 0.52], [0.661, 0.521]])
await brush('hard-round', 300, { h: 48, s: 0.2, v: 1 })
await stroke([[0.66, 0.52], [0.661, 0.521]])
// ---- clouds
await newLayer('Clouds')
await brush('soft-airbrush', 140, { h: 335, s: 0.4, v: 1 }, 0.6)
await stroke(wave(0.34, 0.008, 0.08, 0.42, 14, 3))
await stroke(wave(0.4, 0.008, 0.5, 0.92, 14, 3, 2))
// ---- mountains (dense rows of flat brush strokes along a ridge line)
await newLayer('Mountains')
const ridge = (y, k, ph) => Array.from({ length: 32 }, (_, i) => { const t = i / 31; return [t, y - Math.abs(Math.sin(t * k + ph)) * 0.13 - Math.sin(t * k * 2.3) * 0.015] })
const mount = async (y, k, ph, hsv, rows) => {
  await brush('paint-flat', 170, hsv)
  const base = ridge(y, k, ph)
  for (let r = 0; r < rows; r++) await stroke(base.map(([x, yy]) => [x, yy + r * 0.05]), 2)
}
await mount(0.63, 4.2, 0.4, { h: 275, s: 0.45, v: 0.5 }, 5)
await mount(0.72, 5.6, 1.9, { h: 258, s: 0.55, v: 0.3 }, 6)
// ---- water with reflections
await newLayer('Water')
await brush('paint-flat', 150, { h: 245, s: 0.6, v: 0.34 })
for (let i = 0; i < 6; i++) await stroke(wave(0.86 + i * 0.035, 0.004, 0.0, 1.0, 22, 14, i))
await brush('soft-airbrush', 70, { h: 38, s: 0.6, v: 1 }, 0.8)
for (let i = 0; i < 6; i++) await stroke(wave(0.82 + i * 0.03, 0.003, 0.6 + i * 0.01, 0.72 - i * 0.01, 10, 12, i))
// ---- rim light along the front ridge
await newLayer('Rim light')
await brush('soft-airbrush', 36, { h: 28, s: 0.7, v: 1 }, 0.8)
await stroke(ridge(0.72, 5.6, 1.9).filter((_, i) => i > 3 && i < 29).map(([x, y]) => [x, y - 0.036]), 2)
await page.waitForTimeout(800)
await page.evaluate(() => window.brushwork_app.renderNow?.())
await page.mouse.move(box.x + box.w * 0.5, box.y - 4) // park the cursor outside the artwork
await page.waitForTimeout(500)

const shot = async (name) => {
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(dir, name + '.png') })
}
const reload = async () => {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
}
const openMenu = async (i) => {
  await page.locator('.tb-left .tb-btn').nth(i).click()
  await page.waitForTimeout(400)
}

await shot('main')
// brush library
await brush('soft-airbrush', 40, { h: 40, s: 0.5, v: 1 })
await page.keyboard.press('Escape')
await page.locator('.tb-icon').first().click()
await shot('brushes')
await reload()
// layers panel
await page.locator('.tb-layers').click()
await shot('layers')
await reload()
await page.locator('.tb-layers').click().catch(() => {}) // toggle closed if still open
await reload()
// color panel
await page.locator('.tb-color').click()
await shot('color')
await reload()
// adjustments menu -> first item (opens its live panel on the artwork)
await openMenu(2)
await shot('adjustments-menu')
await page.locator('.popover .menu-item').nth(Number(opt('--adj', 10))).click()
await page.waitForTimeout(800)
{ const [cx, cy] = P(0.5, 0.5); await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 140, cy, { steps: 8 }); await page.mouse.up() }
await page.mouse.move(box.x + box.w * 0.5, box.y - 4)
await shot('adjustment')
await reload()
// tutorial
await page.locator('.tb-help').click()
await shot('tutorial')

await app.close()
fs.rmSync(ud, { recursive: true, force: true })
