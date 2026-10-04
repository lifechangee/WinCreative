import { _electron as electron } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const out = 'out-tr1', shots = 'qa-screens/tr1'
fs.mkdirSync(shots, { recursive: true })
const ud = path.join(os.tmpdir(), 'bw-tr1-' + Date.now())
const app = await electron.launch({ args: [`${out}/main/index.js`, '--user-data-dir=' + ud], cwd: process.cwd(), env: { ...process.env, APPDATA: ud, BW_LANG: process.env.LANG_ ?? 'ru' } })
const page = await app.firstWindow()
const errs = []
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errs.push(m.type() + ': ' + m.text()))
page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message))
await page.waitForTimeout(3000)
await page.setViewportSize({ width: 1280, height: 800 }).catch(() => {})
const shot = async (n) => { await page.waitForTimeout(500); await page.screenshot({ path: path.join(shots, n + '.png') }) }
await page.locator('button', { hasText: /^(Закрыть|Close)$/ }).first().click().catch(() => {})
await page.waitForTimeout(500)
await page.locator('.tb-icon').first().click()
await page.waitForTimeout(1200)
console.log(errs.slice(0,8)); console.log('bl-panel', await page.locator('.bl-panel').count(), 'rows', await page.locator('.bl-row').count())
await shot('01-library')
// context menu on a brush row
await page.locator('.bl-row').nth(2).click({ button: 'right' })
await shot('02-brushmenu')
await page.locator('.bl-foot').click({ position: { x: 4, y: 4 } })
console.log(await page.evaluate(() => [...document.querySelectorAll('.popover *')].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible').map((e) => e.className + ':' + e.scrollWidth + '/' + e.clientWidth).slice(0, 8)))
// sets menu
await page.locator('.bl-set').nth(3).click({ button: 'right' })
await shot('03-setmenu')
await page.locator('.bl-foot').click({ position: { x: 4, y: 4 } })
// open studio: click selected row
await page.locator('.bl-row.sel').first().click().catch(() => {})
await page.waitForTimeout(500)
if (!(await page.locator('.bs-root').count())) { await page.locator('.bl-row').first().click(); await page.locator('.bl-row.sel').first().click() }
await shot('04-studio-path')
const n = await page.locator('.bs-nav button').count()
for (let i = 1; i < n; i++) { await page.locator('.bs-nav button').nth(i).click(); await shot('05-studio-' + String(i).padStart(2, '0')) }
await page.keyboard.press('Escape')
await page.locator('.bs-root .bs-btn', { hasText: /Отмена|Cancel/ }).first().click().catch(() => {})
// guide editor via Actions menu
await page.locator('.tb-left .tb-btn').nth(1).click()
await shot('06-actions')
await page.locator('text=/Правка направляющих|Edit Drawing Guide/').first().click()
await shot('07-guide-editor')
for (const l of ['Изометрия', 'Перспектива', 'Симметрия']) { await page.locator('.bwf-seg button', { hasText: l }).first().click().catch(() => {}); await shot('08-guide-' + l) }
await page.locator('.bwf-panel.open .bwf-head button').click().catch(() => {})
await page.locator('.tb-left .tb-btn').nth(1).click()
await page.locator('text=/QuickShape и|QuickShape &/').first().click()
await shot('09-quickshape')
await page.locator('.bwf-panel.open .bwf-head button').click().catch(() => {})
await page.locator('.tb-left .tb-btn').nth(1).click()
await page.locator('text=/Стиль текста|Text style/').first().click()
await shot('10-textstyle')
await page.locator('.bwf-panel.open .bwf-head button').click().catch(() => {})
await page.locator('.tb-left .tb-btn').nth(1).click()
await page.locator('text=/Окно референса|Reference window/').first().click()
await shot('11-reference')
console.log('console problems:', errs.length)
for (const e of errs.slice(0, 20)) console.log('  ' + e.slice(0, 200))
await app.close()
