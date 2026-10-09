// Independent QA of the language-variants workflow driven ONLY through the real UI (clicks, pointer strokes, keys).
//   node scripts/qa/qa-langqa-flow.mjs --out out-langqa [inf|fixed] [--langs 2|3|4] [--lang ru]
import { launch, newDoc, outDirOf, setBrush, strokeDoc } from './qa-inf-lib.mjs'
import { execFileSync } from 'child_process'
import { mkdirSync, existsSync } from 'fs'
import { resolve } from 'path'

const args = process.argv.slice(2)
const kind = args.includes('fixed') ? 'fixed' : 'inf'
const nLangs = args.includes('--langs') ? Number(args[args.indexOf('--langs') + 1]) : 2
const uiLang = args.includes('--lang') ? args[args.indexOf('--lang') + 1] : 'en'
const dir = resolve('qa-screens/langqa')
mkdirSync(dir, { recursive: true })
const slash = (p) => p.replaceAll(String.fromCharCode(92), '/')
let fail = 0
const ok = (c, m) => {
  console.log((c ? 'PASS ' : 'FAIL ') + m)
  if (!c) fail++
}
const COL = { en: '#1010e0', ru: '#e01010', de: '#e0a010', fr: '#a010e0' }
const NAME = { en: 'English', ru: 'Русский', de: 'Deutsch', fr: 'Français' }
const codes = ['en', 'ru', 'de', 'fr'].slice(0, nLangs)
const probe = (f) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,nb_read_frames:format=duration', '-of', 'json', f]).toString())

const { app, page, errors } = await launch(outDirOf(args), { BW_LANG: uiLang })
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 720))
const shot = (n) => page.screenshot({ path: resolve(dir, `${kind}${nLangs}-${uiLang}-${n}.png`) })
const panelOpen = () => page.evaluate(() => !!document.querySelector('.lp-top'))
const openPanel = async () => {
  if (!(await panelOpen())) {
    await page.keyboard.press('l')
    await page.waitForTimeout(350)
  }
}
const clickLang = async (c) => {
  await openPanel()
  await page.click(`.lg-seg button[data-lang=${c}]`)
  await page.waitForTimeout(120)
}
const colours = (lang, rect) =>
  page.evaluate(({ lang, rect }) => {
    const img = window.brushwork_app.compositor.readFlattened(rect, 1, true, lang)
    const c = { red: 0, blue: 0, green: 0, amber: 0, purple: 0 }
    for (let i = 0; i < img.px.length; i += 4) {
      const r = img.px[i], g = img.px[i + 1], b = img.px[i + 2]
      if (r > 180 && g < 90 && b < 90) c.red++
      else if (b > 180 && r < 90 && g < 120) c.blue++
      else if (g > 130 && r < 90 && b < 90) c.green++
      else if (r > 180 && g > 120 && g < 200 && b < 80) c.amber++
      else if (r > 120 && r < 200 && b > 150 && g < 60) c.purple++
    }
    return c
  }, { lang, rect })
const key = { en: 'blue', ru: 'red', de: 'amber', fr: 'purple' }

await newDoc(page, kind === 'inf' ? 'infinite' : 'fixed', kind === 'inf' ? 4096 : 1080, kind === 'inf' ? 4096 : 1920)
await page.waitForTimeout(500)
const rect = await page.evaluate((kind) => {
  if (kind === 'inf') window.brushwork_frame.createFrame(1080, 1920)
  const f = kind === 'inf' ? window.brushwork_frame.getFrame() : { x: 0, y: 0, w: 1080, h: 1920 }
  return { x: f.x, y: f.y, w: f.w, h: f.h }
}, kind)
await page.waitForTimeout(500)
const P = (fx, fy) => [rect.x + fx * rect.w, rect.y + fy * rect.h]
const zoom = 0.4
const bar = (fy, x1, x0 = 0.1) => [P(x0, fy), P(x1, fy)]
// 1. common line + labels
await setBrush(page, null, 18, 1, '#10a020')
await strokeDoc(page, [P(0.1, 0.75), P(0.3, 0.55), P(0.5, 0.62), P(0.7, 0.35), P(0.9, 0.25)], { zoom })
for (let i = 0; i < 3; i++) await strokeDoc(page, bar(0.92, 0.25 + i * 0.3, 0.1 + i * 0.3), { zoom })
// 2. add the language layer through the Lang. button + dialog; extra languages through "Edit languages..."
await openPanel()
await page.click('.lp-top button:nth-child(5)')
await page.waitForTimeout(250)
if (nLangs > 2) {
  await page.click('.an-modal button >> nth=1') // "Edit languages..."
  await page.waitForTimeout(250)
  for (const c of codes.slice(2)) {
    await page.fill('.lg-add input >> nth=0', c)
    await page.fill('.lg-add input >> nth=1', NAME[c])
    await page.click('.lg-add button')
    await page.waitForTimeout(150)
  }
  await page.keyboard.press('Escape') // closes the languages dialog only
  await page.waitForTimeout(200)
}
await shot('0-newdialog')
await page.click('.an-modal footer button.primary')
await page.waitForTimeout(400)
ok((await page.evaluate(() => window.brushwork_app.doc.langSets().length)) === 1, 'language layer created')
// 3. write the "month" captions: every language except the first; the first afterwards
const order = [...codes.slice(1), codes[0]]
for (const c of order) {
  await clickLang(c)
  await setBrush(page, null, 20, 1, COL[c])
  for (let i = 0; i < 6; i++) await strokeDoc(page, bar(0.06 + i * 0.05, 0.3 + (i % 3) * 0.1 + (c.charCodeAt(0) % 5) * 0.03), { zoom })
  await page.mouse.move(400, 600)
  const co = await colours(c, rect)
  ok(co[key[c]] > 300, `${c}: own writing visible (${co[key[c]]})`)
  for (const o of codes) if (o !== c) {
    const cc = await colours(c, rect)
    ok(cc[key[o]] === 0, `view ${c}: no ${o} writing (${key[o]} px ${cc[key[o]]})`)
  }
  await shot('1-view-' + c)
}
// a common stroke after all the writing
await page.evaluate(() => {
  const d = window.brushwork_app.doc
  const g = d.layers.find((l) => !l.isGroup && !l.lang)
  d.setActive(g.id)
})
await setBrush(page, null, 18, 1, '#10a020')
await strokeDoc(page, bar(0.85, 0.9, 0.5), { zoom })
await page.waitForTimeout(700)
// 4. time-lapse tab -> variants -> fit -> compare -> export, through clicks
await page.click('button:text-is("Time-lapse"), button:text-is("Таймлапс")')
await page.waitForTimeout(1200)
await shot('2-tle')
const variantBtns = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent.trim()))
ok(codes.every((c) => variantBtns.includes(c.toUpperCase())), 'variant switcher shows all languages')
const fit = async (c, secs) => {
  await page.click(`button:text-is("${c.toUpperCase()}")`)
  await page.waitForTimeout(300)
  const inp = await page.evaluateHandle(() => [...document.querySelectorAll('input.tle-num')].find((i) => /^\d+:\d\d/.test(i.value)))
  await inp.asElement().fill(`0:${secs}`)
  await inp.asElement().press('Enter')
  await page.waitForTimeout(300)
}
const want = {}
codes.forEach((c, i) => (want[c] = i === 0 ? 30 : i === 1 ? 40 : 35))
for (const c of codes) await fit(c, want[c])
await shot('3-fit')
await page.click('button:has-text("Compare versions"), button:has-text("Сравн")')
await page.waitForTimeout(900)
await shot('4-compare')
await page.click('button:has-text("Back to editing"), button:has-text("Назад к монтажу")')
await page.waitForTimeout(300)
// export all
const base = slash(resolve(dir, `${kind}${nLangs}-${uiLang}-out.mp4`))
await app.evaluate(({ dialog }, p) => {
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: p })
}, base)
await page.click('button:has-text("Export video"), button:has-text("Экспорт")')
await page.waitForTimeout(600)
await shot('5-export')
await page.click('.an-modal footer button.primary')
await page.waitForTimeout(2500)
await page.waitForFunction(() => !document.querySelector('.an-modal footer button.primary')?.disabled, null, { timeout: 400000 })
await page.waitForTimeout(1000)
await shot('6-exported')
for (const c of codes) {
  const f = base.replace('.mp4', `.${c}.mp4`)
  ok(existsSync(f), 'exists ' + f.split('/').pop())
  if (!existsSync(f)) continue
  const j = probe(f)
  ok(Math.abs(Number(j.format.duration) - want[c]) < 0.6, `${c}: duration ${j.format.duration}s (want ${want[c]}), frames ${j.streams[0].nb_read_frames}, ${j.streams[0].width}x${j.streams[0].height}`)
  const dur = Number(j.format.duration)
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', f, '-vf', `fps=12/${dur},scale=180:-1,tile=6x2`, '-frames:v', '1', f.replace('.mp4', '-sheet.png')])
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-vf', 'fps=1/2,scale=270:480', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 })
  const fr = 270 * 480 * 3
  const bad = { red: 0, blue: 0 }
  let ownLast = 0
  for (let k = 0; k * fr < raw.length; k++) {
    let red = 0, blue = 0
    for (let i = k * fr; i < (k + 1) * fr; i += 3) {
      const r = raw[i], g = raw[i + 1], b = raw[i + 2]
      if (r > 170 && g < 110 && b < 110) red++
      else if (b > 170 && r < 110 && g < 130) blue++
    }
    if (c !== 'ru') bad.red += red
    if (c !== 'en') bad.blue += blue
    if ((k + 1) * fr >= raw.length) ownLast = c === 'en' ? blue : c === 'ru' ? red : 1000
  }
  ok(bad.red === 0 && bad.blue === 0, `${c}: no foreign writing in sampled frames ${JSON.stringify(bad)}`)
  ok(ownLast > 100, `${c}: finale shows own writing (${ownLast})`)
}
console.log('errors', errors.length ? errors.slice(0, 6) : 'none')
await app.close()
process.exit(fail ? 1 : 0)
