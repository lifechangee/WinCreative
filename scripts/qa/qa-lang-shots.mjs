// Screenshots of the language-variants UI at 1280x720 in EN and RU -> qa-screens/lang/<lang>-*.png
//   node scripts/qa/qa-lang-shots.mjs [--out out-lang] [--lang en|ru]
import { launch, newDoc, outDirOf, setBrush, strokeDoc } from './qa-inf-lib.mjs'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
const langs = args.includes('--lang') ? [args[args.indexOf('--lang') + 1]] : ['en', 'ru']
const dir = resolve('qa-screens/lang')
mkdirSync(dir, { recursive: true })

for (const lang of langs) {
  const { app, page, errors } = await launch(outDirOf(args), { BW_LANG: lang })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 720))
  await page.waitForTimeout(800)
  const shot = (name) => page.screenshot({ path: resolve(dir, `${lang}-${name}.png`) })
  await newDoc(page, 'infinite', 4096, 4096)
  await page.waitForTimeout(400)
  const rect = await page.evaluate(() => {
    window.brushwork_frame.createFrame(1080, 1920)
    const f = window.brushwork_frame.getFrame()
    return { x: f.x, y: f.y, w: f.w, h: f.h }
  })
  const bar = (fy, x1) => [[rect.x + 0.1 * rect.w, rect.y + fy * rect.h], [rect.x + x1 * rect.w, rect.y + fy * rect.h]]
  const common = await page.evaluate(() => window.brushwork_app.doc.activeId)
  await setBrush(page, null, 18, 1, '#10a020')
  await strokeDoc(page, [[rect.x + 0.1 * rect.w, rect.y + 0.8 * rect.h], [rect.x + 0.4 * rect.w, rect.y + 0.5 * rect.h], [rect.x + 0.9 * rect.w, rect.y + 0.2 * rect.h]], { zoom: 0.36 })
  await page.evaluate(() => window.brushwork_lang.newLayer(window.brushwork_app.doc.langs.length ? 'Months' : ''))
  for (const [code, col] of [['ru', '#e01010'], ['en', '#1010e0']]) {
    await page.evaluate((c) => window.brushwork_lang.setView(c), code)
    await setBrush(page, null, 20, 1, col)
    for (let i = 0; i < 3; i++) await strokeDoc(page, bar(0.08 + i * 0.05, 0.45 + i * 0.1), { zoom: 0.36 })
  }
  await page.evaluate((id) => window.brushwork_app.doc.setActive(id), common)
  await strokeDoc(page, bar(0.9, 0.9), { zoom: 0.36 })
  await page.waitForTimeout(500)
  // layers panel (key L)
  await page.keyboard.press('l')
  await page.waitForTimeout(700)
  await page.evaluate(() => {
    const d = window.brushwork_app.doc
    d.setActive(d.langSets()[0].id)
  })
  await page.waitForTimeout(400)
  await shot('layers')
  // languages dialog from the panel menu
  await page.evaluate(() => window.brushwork_action?.('lang.edit'))
  await page.evaluate(() => document.querySelector('.lg-bar .lp-btn')?.click())
  await page.waitForTimeout(300)
  await shot('layers-menu')
  await page.evaluate(() => document.querySelector('.lp-opt .menu-item')?.click())
  await page.waitForTimeout(300)
  await shot('languages-dialog')
  await page.keyboard.press('Escape')
  await page.evaluate(() => document.querySelector('.lp-opt-head .lp-btn')?.click())
  await page.keyboard.press('l') // close the panel
  await page.waitForTimeout(300)
  // time-lapse editor
  await page.evaluate(async () => {
    await window.brushwork_animio.tl.current.flush()
    await window.brushwork_animio.tle.open()
  })
  await page.waitForTimeout(1200)
  await page.evaluate(() => window.brushwork_animio.tle.editor().core.setVariant('ru'))
  await page.waitForTimeout(500)
  await shot('timelapse')
  await page.evaluate(async () => void (await window.brushwork_animio.tle.editor().openCompareForTest()))
  await page.waitForTimeout(900)
  await page.evaluate(() => window.brushwork_animio.tle.editor().compare().setTime(1e9))
  await page.waitForTimeout(500)
  await shot('compare')
  await page.evaluate(() => window.brushwork_animio.tle.editor().closeCompareForTest())
  await page.evaluate(() => window.brushwork_animio.tle.editor().openExport())
  await page.waitForTimeout(700)
  await shot('export')
  console.log(lang, 'errors', errors.length ? errors.slice(0, 5) : 'none')
  await app.close()
}
