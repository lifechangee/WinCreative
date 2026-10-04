// Russian screenshots of color panel, time-lapse dialogs, animation timeline, crop dialog (agent QA).
import { _electron as electron } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const out = 'out-tr2'
const shots = 'qa-screens/tr2'
fs.mkdirSync(shots, { recursive: true })
const ud = path.join(os.tmpdir(), 'bw-tr2-' + Date.now())
const app = await electron.launch({ args: [`${out}/main/index.js`, '--user-data-dir=' + ud], cwd: process.cwd(), env: { ...process.env, APPDATA: ud, BW_LANG: 'ru' } })
const page = await app.firstWindow()
const errs = []
page.on('console', (m) => (m.type() === 'error') && errs.push(m.text()))
page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message))
await page.waitForTimeout(3000)
await page.setViewportSize({ width: 1280, height: 800 }).catch(() => {})
const shot = async (name) => {
  await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(shots, name + '.png') })
}
// draw a stroke so time-lapse has frames
await page.mouse.move(450, 250)
await page.mouse.down()
for (let i = 0; i < 30; i++) await page.mouse.move(450 + i * 8, 250 + Math.sin(i / 4) * 60, { steps: 2 })
await page.mouse.up()
await page.waitForTimeout(500)

// colour panel tabs
await page.locator('.tb-color').first().click()
await shot('c0-disc')
for (const [i, n] of ['classic', 'harmony', 'value', 'palettes'].entries()) {
  await page.locator('.bw-tab').nth(i + 1).click()
  await shot('c' + (i + 1) + '-' + n)
}
await page.locator('.bw-settings summary').click().catch(() => {})
await shot('c5-settings')
await page.locator('.bw-icon-btn[title]').nth(4).click().catch(() => {})
await shot('c6-palette-menu')
await page.keyboard.press('Escape')
await page.keyboard.press('Escape')

const openActions = async () => {
  await page.locator('.tb-left .tb-btn').nth(1).click()
  await page.waitForTimeout(300)
}
const pick = async (text) => {
  await page.locator('.popover, .menu, body').first().getByText(text, { exact: false }).first().click()
  await page.waitForTimeout(500)
}
await openActions()
await shot('m-actions')
await pick('Кадрирование и размер холста')
await shot('d-crop')
await page.locator('.an-modal footer button').filter({ hasText: 'Отмена' }).click()
await openActions()
await pick('Сведения о холсте')
await shot('d-info')
await page.keyboard.press('Escape')
await openActions()
await pick('Настройки таймлапса')
await shot('d-tl-settings')
await page.keyboard.press('Escape')
await openActions()
await pick('Экспорт видео таймлапса')
await shot('d-tl-export')
await page.keyboard.press('Escape')
await openActions()
await pick('Повтор таймлапса')
await shot('d-tl-replay')
await page.keyboard.press('Escape')
await openActions()
await pick('Экспорт изображения')
await shot('d-export-image')
await page.keyboard.press('Escape')
await openActions()
await pick('Помощник анимации')
await shot('d-anim-strip')
await openActions()
await pick('Помощник анимации')
await openActions()
await pick('Помощник страниц')
await shot('d-page-strip')
console.log('errors:', errs.length)
for (const e of errs.slice(0, 20)) console.log('  ' + e.slice(0, 200))
await app.close()
try { fs.rmSync(ud, { recursive: true, force: true }) } catch {}
