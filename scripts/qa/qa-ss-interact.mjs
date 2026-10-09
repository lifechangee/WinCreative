// Smart selection interaction QA through the REAL pointer path: hover preview, click, Alt-click, right click, pen eraser end, box drag,
// marker removal, Backspace, Esc, Refine in view, undo, mode switch, Russian bar, model download UI state.
// usage: node scripts/qa/qa-ss-interact.mjs <img.jpg> <outdir> [lang]
import * as L from './ss-lib.mjs'
import fs from 'node:fs'
import path from 'node:path'

const [img, outDir, lang = 'en'] = process.argv.slice(2)
fs.mkdirSync(outDir, { recursive: true })
const { app, page, errs } = await L.launch({ lang })
const res = []
const check = (n, ok, x = '') => { res.push({ check: n, ok: ok ? 'PASS' : 'FAIL', info: String(x) }) }
const S = () => page.evaluate(() => { const c = window.brushwork_smartselect.c; return { active: c.active, pts: c.session?.points.map((p) => p.label) ?? null, box: !!c.session?.box, has: c.app.selection.hasSelection(), prev: !!c.preview, busy: !!c.busy } })
const area = () => page.evaluate(() => { const s = window.brushwork_app.selection; return s.data ? s.data.reduce((t, v) => t + (v > 127 ? 1 : 0), 0) : 0 })
try {
  await L.loadImage(page, img)
  // open through the Selection menu like a user
  await page.click('.tb-left .tb-btn:nth-child(4)')
  await page.waitForTimeout(250)
  const items = await page.$$eval('.popover .menu-item', (els) => els.map((e) => e.textContent))
  check('Smart selection is the first Selection menu entry', /smart selection|умное выделение/i.test(items[0] ?? ''), items.slice(0, 3).join(' | '))
  await page.click('.popover .menu-item >> nth=0')
  await page.waitForTimeout(300)
  await L.waitIdle(page, 120000)
  check('tool opens', (await S()).active)
  await L.shot(page, path.join(outDir, `01-open-${lang}.png`))

  // hover preview
  const p = await L.docToClient(page, 600, 450)
  await page.mouse.move(p.x - 30, p.y)
  await page.mouse.move(p.x, p.y, { steps: 4 })
  await page.waitForTimeout(500)
  check('hover shows a live preview (nothing selected yet)', (await S()).prev && !(await S()).has)
  await L.shot(page, path.join(outDir, `02-hover-${lang}.png`))

  // click
  await page.mouse.down(); await page.mouse.up()
  await L.waitIdle(page)
  let s = await S()
  check('click selects (positive marker)', s.has && JSON.stringify(s.pts) === '[1]', JSON.stringify(s))
  const a1 = await area()
  // Alt+click on the head region removes
  await L.click(page, 760, 330, { alt: true })
  await L.waitIdle(page)
  s = await S()
  check('Alt+click adds a negative point', JSON.stringify(s.pts) === '[1,0]', JSON.stringify(s.pts))
  const eyed = await page.evaluate(() => window.brushwork_app.input.hasMode('eyedropper'))
  check('Alt is not stolen by the eyedropper while the tool is open', !eyed)
  const a2 = await area()
  check('negative point shrinks the selection', a2 < a1, `${a1} -> ${a2}`)
  await L.shot(page, path.join(outDir, `03-negative-${lang}.png`))
  // right click = negative
  await L.click(page, 900, 600, { button: 'right' })
  await L.waitIdle(page)
  s = await S()
  check('right click adds a negative point', s.pts?.length === 3 && s.pts[2] === 0, JSON.stringify(s.pts))
  // click on a marker removes it
  const m = await L.docToClient(page, 900, 600)
  await page.mouse.move(m.x, m.y); await page.mouse.down(); await page.mouse.up()
  await L.waitIdle(page)
  s = await S()
  check('clicking a marker removes that point', s.pts?.length === 2, JSON.stringify(s.pts))
  // Backspace removes the last point
  await page.keyboard.press('Backspace')
  await L.waitIdle(page)
  s = await S()
  check('Backspace removes the last point', s.pts?.length === 1, JSON.stringify(s.pts))
  // negative toggle
  await page.evaluate(() => { window.brushwork_smartselect.ss.negative = true })
  await L.click(page, 760, 330)
  await L.waitIdle(page)
  s = await S()
  check('"- Remove area" toggle makes the next click negative', s.pts?.[1] === 0, JSON.stringify(s.pts))
  await page.evaluate(() => { window.brushwork_smartselect.ss.negative = false })
  // pen eraser end (pointer events with buttons=32)
  await page.evaluate(({ x, y }) => {
    const cv = window.brushwork_app.canvas
    const o = { pointerId: 77, pointerType: 'pen', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true, pressure: 0.5 }
    cv.dispatchEvent(new PointerEvent('pointerdown', { ...o, button: 5, buttons: 32 }))
    cv.dispatchEvent(new PointerEvent('pointerup', { ...o, button: 5, buttons: 0 }))
  }, await L.docToClient(page, 700, 200))
  await L.waitIdle(page)
  s = await S()
  check('pen eraser end adds a negative point', s.pts?.length === 3 && s.pts[2] === 0, JSON.stringify(s.pts))
  // Esc cancels the session -> selection back to nothing
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  s = await S()
  check('Esc cancels the session', !s.has && s.pts === null, JSON.stringify(s))
  // box drag
  const b0 = await L.docToClient(page, 330, 120)
  const b1 = await L.docToClient(page, 900, 700)
  await page.mouse.move(b0.x, b0.y); await page.mouse.down()
  await page.mouse.move((b0.x + b1.x) / 2, (b0.y + b1.y) / 2, { steps: 6 }); await page.mouse.move(b1.x, b1.y, { steps: 6 })
  await L.shot(page, path.join(outDir, `04-box-drag-${lang}.png`))
  await page.mouse.up()
  await L.waitIdle(page)
  s = await S()
  check('dragging a box selects (box prompt)', s.box && s.has, JSON.stringify(s))
  // Next object keeps the selection
  await page.keyboard.press('n')
  await page.waitForTimeout(200)
  s = await S()
  check('N commits and starts the next object', s.has && s.pts === null)
  // undo = one step
  const un = await page.evaluate(() => { const d = window.brushwork_app.doc; const before = d.history.undoCount; d.undo(); return { before, after: d.history.undoCount, has: window.brushwork_app.selection.hasSelection() } })
  check('undo removes the committed smart selection in one step', un.before - un.after === 1 && !un.has, JSON.stringify(un))
  // refine in view: zoom into the object and re-analyse
  await page.evaluate(() => { const a = window.brushwork_app; a.setView({ ...a.view, zoom: a.view.zoom * 2.5, cx: 600, cy: 450 }) })
  await page.waitForTimeout(200)
  await page.click('.ss-bar button:has-text("Refine in view"), .ss-bar button:has-text("Уточнить в окне")')
  await L.waitIdle(page, 120000)
  const rv = await page.evaluate(() => { const c = window.brushwork_smartselect.c; return { region: c.engine.encodedGeom?.region } })
  check('Refine in view re-encodes the visible region only', rv.region && rv.region.w < 700, JSON.stringify(rv.region))
  await L.click(page, 600, 450)
  await L.waitIdle(page)
  check('selection works on the zoomed region', (await S()).has)
  await L.shot(page, path.join(outDir, `05-refine-view-${lang}.png`))
  // mode switch inside the bar: Brush
  await page.click('.ss-bar .ss-mode button:has-text("Brush"), .ss-bar .ss-mode button:has-text("Кисть")')
  await page.waitForTimeout(300)
  check('Brush mode switches from the bar', await page.evaluate(() => window.brushwork_smartselect.ss.mode === 'brush'))
  check('Precise shows size + Download (not installed here)', (await page.textContent('.ss-bar .ss-modes')).match(/MB|МБ/) && /Download|Скачать/.test(await page.textContent('.ss-bar .ss-modes')))
  await L.shot(page, path.join(outDir, `06-brush-bar-${lang}.png`))
} catch (e) {
  console.log('ERR', e)
}
console.table(res)
console.log(errs.filter((e) => !/VerifyEachNode/.test(e)).slice(0, 8).join('\n'))
await app.close()
process.exit(res.some((r) => r.ok === 'FAIL') ? 1 : 0)
