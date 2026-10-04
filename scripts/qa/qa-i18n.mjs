// Screenshots the app in Russian / English and exercises live language switching.
//   node scripts/qa/qa-i18n.mjs [--out out-i18n] [--shots qa-screens/i18n]
import { _electron as electron } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const out = opt('--out', 'out-i18n')
const shots = opt('--shots', 'qa-screens/i18n')
fs.mkdirSync(shots, { recursive: true })
const ud = path.join(os.tmpdir(), 'bw-i18n-' + Date.now())
const app = await electron.launch({ args: [`${out}/main/index.js`, '--user-data-dir=' + ud], cwd: process.cwd(), env: { ...process.env, APPDATA: ud, BW_LANG: opt('--lang', 'ru') } }) // APPDATA: isolate from the real profile (main reuses %APPDATA%/brushwork when it exists)
const page = await app.firstWindow()
const errs = []
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errs.push(m.type() + ': ' + m.text()))
page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message))
await page.waitForTimeout(3000)
await page.setViewportSize({ width: 1280, height: 800 }).catch(() => {})
const shot = async (name) => {
  await page.waitForTimeout(350)
  await page.screenshot({ path: path.join(shots, name + '.png') })
}
const click = async (sel) => page.locator(sel).first().click()
await shot('01-main')
// top bar menus
for (const [i, n] of ['gallery', 'actions', 'adjustments', 'selection', 'transform'].entries()) {
  await page.locator('.tb-left .tb-btn').nth(i).click()
  await shot('02-menu-' + n)
  await page.keyboard.press('Escape')
}
await click('.tb-layers')
await shot('03-layers')
await page.keyboard.press('Escape')
await click('.tb-color')
await shot('03b-color')
await page.keyboard.press('Escape')
await page.locator('.tb-icon').first().click()
await page.locator('.tb-icon').first().click()
await shot('04-brush-library')
await page.keyboard.press('Escape')
await page.hover('.vslider')
await page.waitForTimeout(800)
await shot('05-tooltip')
// cheat sheet
await page.keyboard.press('F1')
await shot('06-cheatsheet')
await page.keyboard.press('Escape')
await page.mouse.click(600, 400)
// new canvas dialog via Ctrl+N
await page.keyboard.press('Control+n')
await shot('07-newdoc')
await page.keyboard.press('Escape')
await page.locator('.modal-back').evaluate((e) => e.remove()).catch(() => {})
// preferences
await page.keyboard.press('Control+,')
await shot('08-prefs-interface')
for (const [i, n] of ['pressure', 'gestures', 'pen', 'shortcuts', 'quickmenu', 'diagnostics', 'advanced'].entries()) {
  await page.locator('.prefs-tabs button').nth(i + 1).click()
  await shot('09-prefs-' + n)
}
// live switch to English and back
await page.locator('.prefs-tabs button').nth(0).click()
const sel = page.locator('.prefs-pane select').first()
await sel.selectOption('en')
await shot('10-prefs-switched-en')
const enTitle = await page.locator('.tb-left .tb-btn').first().textContent()
await sel.selectOption('ru')
await shot('11-prefs-switched-ru')
const ruTitle = await page.locator('.tb-left .tb-btn').first().textContent()
console.log('live switch: en ->', enTitle, '| ru ->', ruTitle)
console.log('html lang:', await page.evaluate(() => document.documentElement.lang))
console.log('console problems:', errs.length)
for (const e of errs.slice(0, 20)) console.log('  ' + e.slice(0, 200))
await app.close()
try { fs.rmSync(ud, { recursive: true, force: true }) } catch {}
