// QA driver for out-feat: node qa-feat.mjs <script.mjs>  (script exports default async ({page,app,shot,draw}) => ...)
import { _electron as electron } from 'playwright-core'
import fs from 'fs'
import path from 'path'
export async function run(fn, { width = 1440, height = 900 } = {}) {
  const ud = path.join(process.env.TEMP, 'bw-feat-' + Date.now())
  const app = await electron.launch({ args: ['out-feat/main/index.js', '--user-data-dir=' + ud], cwd: process.cwd(), env: { ...process.env, BW_GALLERY_DIR: path.join(ud, 'gal') } })
  const page = await app.firstWindow()
  const errs = []
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
  page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message))
  await page.waitForFunction(() => !!window.brushwork_app, null, { timeout: 30000 })
  await page.waitForTimeout(1500)
  fs.mkdirSync('qa-feat', { recursive: true })
  const shot = (n) => page.screenshot({ path: `qa-feat/${n}.png` })
  const draw = async (pts) => { await page.mouse.move(...pts[0]); await page.mouse.down(); for (const p of pts.slice(1)) await page.mouse.move(...p, { steps: 3 }); await page.mouse.up() }
  try { await Promise.race([fn({ page, app, shot, draw }), new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 90000))]) } catch (e) { console.log('ERR', e.message) }
  console.log("console errors:", errs.slice(0, 10))
  await Promise.race([app.close().catch(() => {}), new Promise((r) => setTimeout(r, 4000))]); process.exit(0)
}
