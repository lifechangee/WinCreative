import { _electron as electron } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const ud = path.join(os.tmpdir(), 'bw-live-' + Date.now())
const app = await electron.launch({ args: ['out-audit/main/index.js', '--user-data-dir=' + ud], cwd: process.cwd(), env: { ...process.env, APPDATA: ud, BW_LANG: 'ru' } })
const page = await app.firstWindow()
await page.waitForTimeout(3500)
await page.setViewportSize({ width: 1280, height: 800 })
const shots = 'qa-screens/audit/live'
fs.mkdirSync(shots, { recursive: true })
const texts = () => page.evaluate(() => {
  const out = []
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' }
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let n
  while ((n = w.nextNode())) { const p = n.parentElement; if (p && !/^(SCRIPT|STYLE|OPTION)$/.test(p.tagName) && vis(p) && n.textContent.trim()) out.push(n.textContent.trim()) }
  for (const el of document.querySelectorAll('[title],[data-tip],[placeholder]')) if (vis(el)) for (const a of ['title', 'data-tip', 'placeholder']) { const v = el.getAttribute(a); if (v) out.push(v) }
  return out
})
const setLang = async (l) => {
  await page.keyboard.press('Control+,')
  await page.waitForTimeout(500)
  await page.locator('.prefs-tabs button').nth(0).click()
  await page.locator('.prefs-pane select').first().selectOption(l)
  await page.waitForTimeout(600)
}
const closePrefs = async () => { await page.evaluate(() => document.querySelectorAll('.modal-back').forEach((e) => e.remove())) }
const report = async (name, lang) => {
  const t = await texts()
  const bad = t.filter((s) => (lang === 'en' ? /[А-Яа-яЁё]{3,}/.test(s) : /(^|[^A-Za-z])[A-Za-z]{4,}/.test(s) && !/WinCreative|Ctrl|Shift|QuickShape|QuickMenu|ColorDrop|Language|English|Photoshop|Wacom|Windows|StreamLine|Bloom|Pointer|Pencil|Segoe|Arial|Font/i.test(s)))
  console.log(`[${name}] -> ${lang}: ${bad.length} stale`, [...new Set(bad)].slice(0, 12))
  await page.screenshot({ path: `${shots}/${name}-${lang}.png` })
}
const openMenu = async (i) => { await page.locator('.tb-left .tb-btn').nth(i).click(); await page.waitForTimeout(300) }
// A: adjustment bar+panel open
await openMenu(2); await page.locator('.popover .menu-item').nth(1).click(); await page.waitForTimeout(600)
await setLang('en'); await closePrefs(); await report('adjust', 'en')
await setLang('ru'); await closePrefs(); await report('adjust', 'ru')
await page.keyboard.press('Escape')
// B: gallery open
await openMenu(0); await page.locator('.popover .menu-item').first().click(); await page.waitForTimeout(700)
await setLang('en'); await closePrefs(); await report('gallery', 'en')
await setLang('ru'); await closePrefs(); await report('gallery', 'ru')
await page.evaluate(() => document.querySelectorAll('.bw-gallery.open').forEach((e) => e.classList.remove('open')))
// C: layers panel + color panel
await page.locator('.tb-layers').click(); await page.waitForTimeout(300)
await setLang('en'); await closePrefs(); await report('layers', 'en')
await setLang('ru'); await closePrefs(); await report('layers', 'ru')
await page.keyboard.press('Escape')
await page.locator('.tb-color').click(); await page.waitForTimeout(300)
await setLang('en'); await closePrefs(); await report('color', 'en')
await setLang('ru'); await closePrefs(); await report('color', 'ru')
await page.keyboard.press('Escape')
// D: selection bar + xform bar
await openMenu(3); await page.locator('.popover .menu-item').nth(2).click(); await page.waitForTimeout(400)
await setLang('en'); await closePrefs(); await report('selbar', 'en')
await setLang('ru'); await closePrefs(); await report('selbar', 'ru')
await openMenu(4); await page.locator('.popover .menu-item').nth(0).click(); await page.waitForTimeout(400)
await setLang('en'); await closePrefs(); await report('xfbar', 'en')
await setLang('ru'); await closePrefs(); await report('xfbar', 'ru')
// E: page assist + anim strip
await page.keyboard.press('Escape')
await openMenu(1); await page.locator('.popover .menu-item', { hasText: 'Помощник анимации' }).click(); await page.waitForTimeout(500)
await setLang('en'); await closePrefs(); await report('anim', 'en')
await setLang('ru'); await closePrefs(); await report('anim', 'ru')
await app.close()
