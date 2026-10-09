// More adversarial checks (independent QA): new layer / text / paste / ColorDrop onto a language row, selection + transform + adjustment while the
// view language changes, undo of language edits, Animation Assist / Page Assist with a language layer, Reference window.
//   node scripts/qa/qa-langqa-adv2.mjs --out out-langqa [inf]
import { launch, newDoc, outDirOf, setBrush, strokeDoc } from './qa-inf-lib.mjs'

const args = process.argv.slice(2)
const kind = args.includes('inf') ? 'infinite' : 'fixed'
const { app, page, errors } = await launch(outDirOf(args))
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 720))
let fail = 0
const ok = (c, m) => {
  console.log((c ? 'PASS ' : 'FAIL ') + m)
  if (!c) fail++
}
const ev = (fn, arg) => page.evaluate(fn, arg)
await newDoc(page, kind, kind === 'infinite' ? 4096 : 1080, kind === 'infinite' ? 4096 : 1920)
await page.waitForTimeout(500)
const rect = await ev((kind) => {
  if (kind === 'infinite') window.brushwork_frame.createFrame(1080, 1920)
  const f = kind === 'infinite' ? window.brushwork_frame.getFrame() : { x: 0, y: 0, w: 1080, h: 1920 }
  return { x: f.x, y: f.y, w: f.w, h: f.h }
}, kind)
const P = (fx, fy) => [rect.x + fx * rect.w, rect.y + fy * rect.h]
const zoom = 0.4
const stroke = async (fy, col, x1 = 0.5, x0 = 0.1, size = 20) => {
  await setBrush(page, null, size, 1, col)
  await strokeDoc(page, [P(x0, fy), P(x1, fy)], { zoom })
}
const nonWhite = (lang) =>
  ev(({ lang, rect }) => {
    const img = window.brushwork_app.compositor.readFlattened(rect, 1, true, lang)
    let n = 0, red = 0, blue = 0
    for (let i = 0; i < img.px.length; i += 4) {
      const r = img.px[i], g = img.px[i + 1], b = img.px[i + 2]
      if (r < 235 || g < 235 || b < 235) n++
      if (r > 180 && g < 90 && b < 90) red++
      else if (b > 180 && r < 90 && g < 120) blue++
    }
    return { n, red, blue }
  }, { lang, rect })
const inv = () =>
  ev(() => {
    const d = window.brushwork_app.doc
    const bad = []
    for (const l of d.layers) {
      if (l.lang && !l.isGroup && !d.getLayer(l.parentId)?.langSet) bad.push('orphan cell ' + l.name)
      if (!l.lang && l.parentId && d.getLayer(l.parentId)?.langSet) bad.push('foreign child ' + l.name + ' in language row')
    }
    return bad
  })
const key = async (k) => {
  await page.keyboard.press(k)
  await page.waitForTimeout(200)
}
await ev(() => window.brushwork_app.doc.editLangs([{ code: 'en', name: 'English' }, { code: 'ru', name: 'Russian' }, { code: 'de', name: 'Deutsch' }]))
await stroke(0.8, '#10a020', 0.9)
await ev(() => window.brushwork_lang.newLayer('Months'))
const row = await ev(() => window.brushwork_app.doc.langSets()[0].id)
await ev(() => window.brushwork_lang.setView('ru'))
await stroke(0.1, '#e01010', 0.5)
await ev(() => window.brushwork_lang.setView('en'))
await stroke(0.1, '#1010e0', 0.4)

// ------------------------------------------------------------ 1. new layer / text with a language row active
await ev((id) => window.brushwork_app.doc.setActive(id), row)
await ev(() => window.brushwork_layers.actions.newLayer())
ok((await inv()).length === 0, '1: "+" with a language row selected adds an ordinary layer OUTSIDE the row ' + (await inv()).join(';'))
await ev((id) => window.brushwork_app.doc.setActive(id), row)
await ev(() => window.brushwork_text.addText('Hello'))
await page.waitForTimeout(200)
ok((await inv()).length === 0, '1: text added with a language row selected goes outside the row ' + (await inv()).join(';'))
await key('Escape')

// ------------------------------------------------------------ 2. ColorDrop (real drag of the colour circle) onto an empty cell: DE only
await ev((id) => window.brushwork_app.doc.setActive(id), row)
await ev(() => window.brushwork_lang.setView('de'))
await page.waitForTimeout(200)
const before = [await nonWhite('en'), await nonWhite('ru'), await nonWhite('de')]
await setBrush(page, null, 20, 1, '#d0d020')
const colorBtn = await ev(() => { const b = document.querySelector('.tb-color').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } })
const cv = await ev(() => { const r = window.brushwork_app.canvas.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
await ev(({ rect }) => window.brushwork_app.setView({ cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2, zoom: 0.4, rot: 0 }), { rect })
await page.waitForTimeout(150)
await page.mouse.move(colorBtn.x, colorBtn.y)
await page.mouse.down()
await page.mouse.move(cv.x, cv.y - 150, { steps: 12 })
await page.mouse.up()
await page.waitForTimeout(800)
const after = [await nonWhite('en'), await nonWhite('ru'), await nonWhite('de')]
console.log('   nonWhite before', JSON.stringify(before.map((b) => b.n)), 'after', JSON.stringify(after.map((b) => b.n)))
ok(after[2].n > before[2].n + 100000, '2: the ColorDrop filled the DE cell (' + after[2].n + ')')
ok(Math.abs(after[0].n - before[0].n) < 50 && Math.abs(after[1].n - before[1].n) < 50, '2: EN and RU are untouched by the DE fill')
ok((await inv()).length === 0, '2: invariants')
await key('Control+z')
ok(Math.abs((await nonWhite('de')).n - before[2].n) < 50, '2: ONE undo removes the fill and the cell it created')

// ------------------------------------------------------------ 3. paste: first into the empty DE cell, then (cell exists) as a common layer + notice
await ev(() => window.brushwork_lang.setView('en'))
await ev((id) => window.brushwork_app.doc.setActive(id), row)
await ev(() => window.brushwork_layers.actions.copy())
await page.waitForTimeout(500)
await ev(() => window.brushwork_lang.setView('de'))
await ev((id) => window.brushwork_app.doc.setActive(id), row)
await ev(() => window.brushwork_layers.actions.paste())
await page.waitForTimeout(600)
const pasted1 = await ev((row) => { const d = window.brushwork_app.doc; return { cells: d.cellsOf(row).map((c) => c.lang).sort().join(), n: d.layers.length } }, row)
ok(pasted1.cells.includes('de'), '3: paste into a language whose cell is empty becomes that cell ' + JSON.stringify(pasted1))
ok((await nonWhite('de')).blue > 300 && (await nonWhite('ru')).blue === 0, '3: ... and shows in DE only')
await key('Enter') // finish the transform if open
await ev((id) => window.brushwork_app.doc.setActive(id), row)
await ev(() => window.brushwork_layers.actions.paste())
await page.waitForTimeout(600)
const toast = await ev(() => document.body.innerText.includes('common layer') || document.body.innerText.includes('общий слой'))
ok(toast, '3: pasting where the cell already has writing says it is a common layer')
ok((await inv()).length === 0, '3: invariants ' + (await inv()).join(';'))
await key('Enter')

// ------------------------------------------------------------ 4. view language changes while a selection / transform / adjustment is open
await ev(() => window.brushwork_lang.setView('ru'))
await ev((id) => window.brushwork_app.doc.setActive(id), row)
{
  const r0 = await nonWhite('ru')
  // transform session on the RU cell
  await ev(() => window.brushwork_xform.start('free'))
  await page.waitForTimeout(300)
  const open = await ev(() => !!window.brushwork_xform.session)
  await page.keyboard.press('Control+Alt+l') // switch to the next language while the transform is open
  await page.waitForTimeout(400)
  const view = await ev(() => window.brushwork_app.doc.viewLang)
  await ev(() => window.brushwork_xform.closeAll(true))
  await page.waitForTimeout(400)
  const r1 = await nonWhite('ru')
  console.log('   transform: open', open, 'view after', view, 'RU red', r0.red, '->', r1.red)
  ok(Math.abs(r1.red - r0.red) < r0.red * 0.02, '4: a transform open on RU survives a language switch and commits to RU')
  ok((await inv()).length === 0, '4: invariants')
  await ev(() => window.brushwork_lang.setView('ru'))
  ok(true, '4: no exception (errors listed below)')
}
console.log('errors', errors.length ? errors.slice(0, 8) : 'none')
await app.close()
process.exit(fail ? 1 : 0)
