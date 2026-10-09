// Language-variants leftovers (Russian UI, 1280 px window): layer-count label on one line, clipping mask item off above a group / language row
// (with a translated tooltip), time-lapse editor opens on the canvas's current view language.
//   node scripts/qa/qa-lang-leftovers.mjs --out out-merge
import { launch, newDoc, outDirOf } from './qa-inf-lib.mjs'

const args = process.argv.slice(2)
const { app, page, errors } = await launch(outDirOf(args), { BW_LANG: 'ru' })
let fail = 0
const ok = (c, m) => {
  console.log((c ? 'PASS ' : 'FAIL ') + m)
  if (!c) fail++
}
const openPanel = async () => {
  await page.waitForTimeout(200)
  await page.evaluate(() => { if (!document.querySelector('.lp-top')) document.querySelector('.tb-layers')?.click() })
  await page.waitForTimeout(200)
}
try {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 800))
  await page.waitForTimeout(600)
  await newDoc(page, 'fixed', 1080, 1080)
  await openPanel()
  await page.waitForSelector('.lp-top')
  const lab = await page.evaluate(() => {
    const el = document.querySelector('.lp-top .grow')
    const r = el.getBoundingClientRect()
    const lh = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.3
    return { text: el.textContent, h: r.height, lh, w: window.innerWidth }
  })
  ok(lab.h <= lab.lh * 1.2 && lab.w <= 1300, `layer-count label "${lab.text}" is one line at ${lab.w} px (height ${lab.h.toFixed(1)} of line ${lab.lh.toFixed(1)})`)

  // clipping mask above a group / a language row
  const setup = async (kind) => {
    await page.evaluate((kind) => {
      const d = window.brushwork_app.doc
      if (kind === 'group') {
        const b = d.addLayer()
        d.groupLayers([typeof b === 'string' ? b : b.id])
      } else window.brushwork_lang.newLayer('Months')
      d.addLayer() // active = the new layer, directly above the group / row
    }, kind)
    await page.waitForTimeout(200)
  }
  const optionState = async () => {
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.layer-row.sel')]
      rows[rows.length - 1].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    })
    await page.waitForTimeout(150)
    const r = await page.evaluate(() => {
      const b = [...document.querySelectorAll('.menu-item')].find((x) => x.textContent.includes('Обтравочная маска'))
      return b ? { disabled: b.disabled, title: b.title } : null
    })
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.title === 'Назад' || x.title === 'Back'); b?.click() })
    return r
  }
  await setup('group')
  const g = await optionState()
  ok(!!g && g.disabled && /групп/.test(g.title), `clipping mask above a group: disabled with a Russian tooltip (${JSON.stringify(g)})`)
  await newDoc(page, 'fixed', 1080, 1080)
  await openPanel()
  await setup('lang')
  const l = await optionState()
  ok(!!l && l.disabled && /язык/.test(l.title), `clipping mask above a language row: disabled with a Russian tooltip (${JSON.stringify(l)})`)
  await newDoc(page, 'fixed', 1080, 1080)
  await openPanel()
  await page.evaluate(() => { window.brushwork_app.doc.addLayer() })
  await page.waitForTimeout(150)
  const p = await optionState()
  ok(!!p && !p.disabled, `clipping mask above a paint layer stays enabled (${JSON.stringify(p)})`)

  // the time-lapse editor opens on the view language
  await newDoc(page, 'fixed', 1080, 1080)
  const v = await page.evaluate(async () => {
    const d = window.brushwork_app.doc
    d.editLangs([{ code: 'en', name: 'English' }, { code: 'ru', name: 'Russian' }, { code: 'de', name: 'Deutsch' }])
    window.brushwork_lang.newLayer('Months')
    d.setViewLang('de')
    const rec = window.brushwork_animio.tl.current
    await rec.flush()
    for (let i = 0; i < 40 && rec.count < 1; i++) await new Promise((r) => setTimeout(r, 100))
    await window.brushwork_animio.tle.open()
    await new Promise((r) => setTimeout(r, 300))
    const out = { variant: rec.variantKey, view: d.viewLang, count: rec.count, open: !!document.querySelector('.tle, [class*=tle]') }
    window.brushwork_animio.tle.close()
    return out
  })
  ok(v.variant === 'de' && v.view === 'de', `time-lapse editor opens on the view language (${JSON.stringify(v)})`)
} catch (e) {
  console.log('SCRIPT ERROR', e)
  fail++
}
console.log('errors', errors.length ? errors.slice(0, 5) : 'none')
await app.close()
process.exit(fail ? 1 : 0)
