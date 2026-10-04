// Brush QA driver: node qa-brush.mjs <outDir> <mode> [args]   (mode: sweep | one)
import { _electron as electron } from 'playwright-core'
import fs from 'fs'
import path from 'path'
const OUT = process.argv[2] || 'out-brush'
const mode = process.argv[3] || 'sweep'
const tag = process.env.QA_TAG || 'after'
const dir = path.resolve('qa-brush', tag)
fs.mkdirSync(dir, { recursive: true })
export async function launch() {
  const ud = process.env.TEMP + '\bw-brush-qa-' + Date.now()
  const app = await electron.launch({ args: [OUT + '/main/index.js', '--user-data-dir=' + ud], cwd: process.cwd(), env: { ...process.env, BW_BRUSH_QA: '1' } })
  const page = await app.firstWindow()
  const errs = []
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
  page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message))
  await page.waitForFunction(() => !!window.__bwqa, null, { timeout: 30000 })
  return { app, page, errs }
}
const save = (name, dataUrl) => fs.writeFileSync(path.join(dir, name), Buffer.from(dataUrl.split(',')[1], 'base64'))
if (true) {
  const { app, page, errs } = await launch()
  if (mode === 'sweep') {
    const sizes = (process.env.QA_SIZES || '1,2,3,5,10,40,200').split(',').map(Number)
    const only = process.env.QA_IDS ? process.env.QA_IDS.split(',') : null
    const ids = (await page.evaluate(() => window.__bwqa.ids())).filter((b) => !only || only.includes(b.id))
    console.log('presets', ids.length)
    const rows = []
    const t0 = Date.now()
    for (const b of ids) for (const s of sizes) {
      const r = await page.evaluate(([id, size]) => window.__bwqa.runCase(id, size, { images: true }), [b.id, s])
      const { pngT, pngW, ...m } = r
      save(`${b.id}_${s}_transparent.png`, pngT)
      save(`${b.id}_${s}_white.png`, pngW)
      rows.push({ ...m, cat: b.cat })
    }
    fs.writeFileSync(path.join(dir, 'metrics.json'), JSON.stringify(rows, null, 1))
    console.log('done', rows.length, 'cases in', ((Date.now() - t0) / 1000).toFixed(0), 's; errors:', errs.slice(0, 5))
  }
  await app.close()
}
