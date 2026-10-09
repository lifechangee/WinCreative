// Screens of the language-variants UI for review: EN / RU at 1280x720 and 1920x1080 -> qa-screens/langqa/ui-<lang>-<WxH>-<name>.png
//   node scripts/qa/qa-langqa-shots.mjs --out out-langqa [--lang en|ru] [--size 1280x720]
import { launch, newDoc, outDirOf, setBrush, strokeDoc } from './qa-inf-lib.mjs'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
const langs = args.includes('--lang') ? [args[args.indexOf('--lang') + 1]] : ['en', 'ru']
const sizes = args.includes('--size') ? [args[args.indexOf('--size') + 1]] : ['1280x720', '1920x1080']
const dir = resolve('qa-screens/langqa')
mkdirSync(dir, { recursive: true })

for (const lang of langs) {
  for (const size of sizes) {
    const [W, H] = size.split('x').map(Number)
    const { app, page, errors } = await launch(outDirOf(args), { BW_LANG: lang })
    await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [W, H])
    await page.waitForTimeout(800)
    const shot = (name) => page.screenshot({ path: resolve(dir, `ui-${lang}-${size}-${name}.png`) })
    const ev = (fn, a) => page.evaluate(fn, a)
    await newDoc(page, 'infinite', 4096, 4096)
    await page.waitForTimeout(400)
    const rect = await ev(() => {
      window.brushwork_frame.createFrame(1080, 1920)
      const f = window.brushwork_frame.getFrame()
      return { x: f.x, y: f.y, w: f.w, h: f.h }
    })
    const P = (fx, fy) => [rect.x + fx * rect.w, rect.y + fy * rect.h]
    const zoom = H > 800 ? 0.5 : 0.36
    await setBrush(page, null, 18, 1, '#10a020')
    await strokeDoc(page, [P(0.1, 0.8), P(0.4, 0.5), P(0.9, 0.2)], { zoom })
    await ev(() => window.brushwork_lang.newLayer(window.brushwork_app.doc.langs.length ? 'Months' : ''))
    for (const [c, col, n] of [['ru', '#e01010', 3], ['en', '#1010e0', 2]]) {
      await ev((c) => window.brushwork_lang.setView(c), c)
      await setBrush(page, null, 20, 1, col)
      for (let i = 0; i < n; i++) await strokeDoc(page, [P(0.1, 0.06 + i * 0.05), P(0.45 + i * 0.1, 0.06 + i * 0.05)], { zoom })
    }
    await ev(() => { const d = window.brushwork_app.doc; d.setActive(d.langSets()[0].id) })
    await page.waitForTimeout(500)
    // a THIRD language added after the recording started (shows the "added later" note)
    await ev(() => window.brushwork_app.doc.editLangs([...window.brushwork_app.doc.langs, { code: 'de', name: 'Deutsch' }]))
    await ev(() => window.brushwork_lang.setView('de'))
    await ev(() => window.brushwork_lang.setView('en'))
    await page.keyboard.press('l')
    await page.waitForTimeout(600)
    await shot('1-layers')
    await page.click('.lg-bar > button')
    await page.waitForTimeout(300)
    await shot('2-lang-menu')
    await page.click('.lp-opt >> text=/Edit languages|Настроить языки/')
    await page.waitForTimeout(300)
    await shot('3-languages-dialog')
    await page.click('.lg-item >> nth=1 >> button')
    await page.waitForTimeout(300)
    await shot('4-remove-confirm')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
    // new language layer dialog
    if (!(await ev(() => !!document.querySelector('.lp-top')))) await page.keyboard.press('l')
    await page.waitForTimeout(400)
    if (await ev(() => !!document.querySelector('.lp-opt'))) await page.click('.lp-opt-head button')
    await page.click('.lp-top button:nth-child(5)')
    await page.waitForTimeout(300)
    await shot('5-new-dialog')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
    // toasts
    await page.keyboard.press('Control+Alt+l')
    await page.waitForTimeout(500)
    await shot('6-toast-switch')
    await page.keyboard.press('Control+Alt+l')
    // row options
    await page.waitForTimeout(300)
    await ev(() => window.brushwork_layers.actions.flatten())
    await page.waitForTimeout(400)
    await shot('7-toast-flatten-refused')
    // time-lapse editor
    await page.mouse.click(W / 2, H / 2 + 40)
    await ev(async () => { await window.brushwork_animio.tl.current.flush() })
    await page.click('button.tb-tab:last-of-type, .topbar button:text-is("Time-lapse"), .topbar button:text-is("Таймлапс")')
    await page.waitForTimeout(1200)
    await ev(() => window.brushwork_animio.tle.editor().core.setVariant('de'))
    await page.waitForTimeout(500)
    await shot('8-timelapse-de-late')
    await ev(() => window.brushwork_animio.tle.editor().core.setVariant('ru'))
    await page.waitForTimeout(400)
    await shot('9-timelapse-ru')
    await page.click('text=/Compare versions|Сравнить версии/')
    await page.waitForTimeout(1000)
    await ev(() => window.brushwork_animio.tle.editor().compare().setTime(1e9))
    await page.waitForTimeout(500)
    await shot('10-compare-moment')
    await page.click('text=/By video time|По времени видео/')
    await page.waitForTimeout(600)
    await shot('11-compare-time')
    await page.click('text=/Back to editing|Назад к монтажу/')
    await page.waitForTimeout(300)
    await page.click('.tle-head >> text=/Export video|Экспорт видео/')
    await page.waitForTimeout(700)
    await shot('12-export')
    await page.keyboard.press('Escape')
    console.log(lang, size, 'errors', errors.length ? errors.slice(0, 4) : 'none')
    await app.close()
  }
}
