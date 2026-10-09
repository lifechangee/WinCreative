// Model download UI: never automatic; Download shows progress + Cancel in the bar; Cancel leaves nothing behind; (optional) full download -> mode usable -> delete.
// usage: node scripts/qa/qa-ss-download.mjs <outdir> [--full]
import * as L from './ss-lib.mjs'
import fs from 'node:fs'
import path from 'node:path'
const [outDir, full] = process.argv.slice(2)
fs.mkdirSync(outDir, { recursive: true })
const { app, page, ud } = await L.launch()
const res = []
const check = (n, ok, x = '') => res.push({ check: n, ok: ok ? 'PASS' : 'FAIL', info: String(x) })
const modelsDir = path.join(ud, 'models', 'precise')
await L.loadImage(page, process.argv[1] + '/../img/p237.jpg').catch(() => L.loadImage(page, { rgba: new Uint8ClampedArray(64 * 64 * 4).fill(200), w: 64, h: 64 }))
await page.evaluate(() => window.brushwork_smartselect.c.activate())
await page.waitForTimeout(800)
check('nothing is downloaded automatically', !fs.existsSync(modelsDir))
const txt = () => page.textContent('.ss-bar .ss-modes')
check('Precise entry shows its size and a Download button', /MB/.test(await txt()) && /Download/.test(await txt()), await txt())
await page.click('.ss-bar button:has-text("Download")')
await page.waitForTimeout(9000)
check('progress and Cancel appear while downloading', /Downloading/.test(await txt()) && /Cancel/.test(await txt()), await txt())
await L.shot(page, path.join(outDir, 'download-progress.png'))
const prog = await page.evaluate(() => { const i = document.querySelector('.ss-prog i'); return i ? i.style.width : null })
check('progress bar advances', prog && parseFloat(prog) > 0, prog)
await page.click('.ss-bar button:has-text("Cancel")')
await page.waitForTimeout(1500)
check('Cancel returns to the Download state', /Download/.test(await txt()) && !/Downloading/.test(await txt()), await txt())
const leftovers = fs.existsSync(modelsDir) ? fs.readdirSync(modelsDir) : []
check('cancel leaves nothing behind', leftovers.length === 0, leftovers.join(','))
check('model is not installed after cancel', !(await page.evaluate(() => window.smartselectApi.status())).find((m) => m.id === 'precise').installed)
if (full === '--full') {
  await page.click('.ss-bar button:has-text("Download")')
  await page.waitForFunction(() => /✕/.test(document.querySelector('.ss-bar .ss-modes')?.textContent ?? ''), null, { timeout: 600000, polling: 1000 })
  check('full download installs the model (SHA-256 verified in main)', (await page.evaluate(() => window.smartselectApi.status())).find((m) => m.id === 'precise').installed)
  await page.click('.ss-bar .ss-mode button:has-text("Precise")')
  await L.waitIdle(page, 240000)
  check('Precise mode loads and analyses', (await page.evaluate(() => window.brushwork_smartselect.c.engine.loadedModel)) === 'precise')
  await page.click('.ss-bar button[title^="Delete"]')
  await page.waitForTimeout(800)
  check('delete from the same place removes the files', !fs.existsSync(modelsDir) && /Download/.test(await txt()))
}
console.table(res)
await app.close()
process.exit(res.some((r) => r.ok === 'FAIL') ? 1 : 0)
