// Screenshots + layout checks of the tutorial (lessons list, guide, coach marks, hints) in a language at a viewport size.
//   node scripts/qa/qa-tutorial.mjs [--out out-tut] [--lang ru|en] [--size 1280x720] [--shots qa-screens/tutorial]
import { _electron as electron } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const out = opt('--out', 'out-tut')
const lang = opt('--lang', 'en')
const [W, H] = opt('--size', '1280x720').split('x').map(Number)
const shots = opt('--shots', 'qa-screens/tutorial')
fs.mkdirSync(shots, { recursive: true })
const ud = path.join(os.tmpdir(), 'bw-tut-' + Date.now())
const app = await electron.launch({ args: [`${out}/main/index.js`, '--user-data-dir=' + ud], cwd: process.cwd(), env: { ...process.env, APPDATA: ud, BW_LANG: lang } })
const page = await app.firstWindow()
const errs = []
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errs.push(m.type() + ': ' + m.text()))
page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message))
await page.waitForTimeout(2500)
await page.setViewportSize({ width: W, height: H }).catch(() => {})
await page.waitForTimeout(400)
const tag = `${lang}-${W}x${H}`
const shot = async (name) => {
  await page.waitForTimeout(450)
  await page.screenshot({ path: path.join(shots, `${tag}-${name}.png`) })
}
// NOTE: main/index.ts reuses %APPDATA%/brushwork whenever it exists, so --user-data-dir does NOT isolate the profile. Snapshot the
// tutorial state and put it back at the end so the real progress / welcome flag is never changed by this script.
const KEY = 'wincreative.tutorial.v1'
const before = await page.evaluate((k) => localStorage.getItem(k), KEY)
await page.evaluate((k) => localStorage.removeItem(k), KEY)
await page.reload() // the tutorial store reads localStorage at start-up
await page.waitForTimeout(2500)
await page.setViewportSize({ width: W, height: H }).catch(() => {})
await page.waitForTimeout(400)

// ---- dialogs
await page.locator('.tb-help').click()
await shot('01-lessons')
await page.locator('.tt-tabs button').nth(1).click()
await shot('02-guide')
await page.locator('.tt-search').fill(lang === 'ru' ? 'кноп' : 'button')
await shot('03-guide-search')
await page.keyboard.press('Escape')
await page.evaluate(() => window.brushwork_tutorial.close())

// ---- every step: measure the coach mark
const problems = []
const info = await page.evaluate(async () => {
  const T = window.brushwork_tutorial
  const res = []
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  for (const l of T.LESSONS) {
    T.runner.start(l.id)
    for (let i = 0; i < l.steps.length; i++) {
      T.runner.goto(i)
      await sleep(320)
      const card = document.querySelector('.tt-card')
      const r = card.getBoundingClientRect()
      const spot = document.querySelector('.tt-spot')
      const s = spot.style.display === 'block' ? spot.getBoundingClientRect() : null
      const overlap = s ? Math.min(r.right, s.right) - Math.max(r.left, s.left) > 4 && Math.min(r.bottom, s.bottom) - Math.max(r.top, s.top) > 4 : false
      res.push({ id: l.id + '.' + l.steps[i].id, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), onscreen: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, scrolls: card.querySelector('.tt-inner').scrollHeight > card.querySelector('.tt-inner').clientHeight + 1, hscroll: card.querySelector('.tt-inner').scrollWidth > card.querySelector('.tt-inner').clientWidth + 1, overlap, spot: !!s })
    }
    T.runner.stop(true)
  }
  return res
})
for (const r of info) if (!r.onscreen || r.overlap || r.hscroll || r.scrolls) problems.push(r)
const maxH = Math.max(...info.map((r) => r.h))
console.log(`${tag}: ${info.length} steps checked, tallest card ${maxH}px, problems: ${problems.length}`)
for (const p of problems) console.log('  ', JSON.stringify(p))

// ---- a handful of pictures
const step = async (lesson, i, name, prep) => {
  await page.evaluate(([l, n]) => { window.brushwork_tutorial.runner.start(l); window.brushwork_tutorial.runner.goto(n) }, [lesson, i])
  if (prep) await prep()
  await shot(name)
}
await step('basics', 2, '10-basics-size')
await step('pen', 0, '11-pen-pressure')
await step('pen', 1, '12-pen-tilt')
await step('penSetup', 1, '13-pen-remap')
await step('nav', 0, '14-nav-pinch')
await step('color', 2, '15-color-drop')
await step('layers', 0, '16-layers-open')
await step('layers', 1, '17-layers-add', async () => { await page.locator('.tb-layers').click(); await page.waitForTimeout(200) })
await step('adjust', 0, '18-adjust-menu', async () => { await page.locator('.tb-left .tb-btn').nth(2).click(); await page.waitForTimeout(200) })
await step('shapes', 0, '19-shapes')
await step('basics', 5, '20-basics-last')
await page.evaluate(() => { const T = window.brushwork_tutorial; T.runner.start('basics'); T.runner.goto(5); T.runner.next() })
await shot('21-complete')
await page.evaluate(() => window.brushwork_tutorial.runner.stop(true))
// hint + welcome
await page.evaluate(() => window.brushwork_tutorial.showHint(window.brushwork_tutorial.HINTS[1], true))
await shot('22-hint')
await page.evaluate(() => document.querySelector('.tt-hint')?.remove())
await page.keyboard.press('F1')
await shot('23-f1-sheet')
await page.keyboard.press('Escape')
await page.keyboard.press('Control+,')
await page.waitForTimeout(300)
await page.evaluate(() => { const p = document.querySelector('.prefs-pane'); p.scrollTop = p.scrollHeight })
await shot('25-prefs-tips')
await page.keyboard.press('Escape')
await page.evaluate(() => window.brushwork_tutorial.welcome())
await shot('24-welcome')
await page.evaluate(() => document.querySelector('.tt-back')?.remove())
await page.waitForTimeout(400)
await page.evaluate(([k, v]) => (v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v)), [KEY, before])
console.log('console problems:', errs.length)
for (const e of errs.slice(0, 15)) console.log('  ' + e.slice(0, 200))
await app.close()
try { fs.rmSync(ud, { recursive: true, force: true }) } catch {}
