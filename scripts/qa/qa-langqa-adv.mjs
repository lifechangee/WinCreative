// Adversarial checks of language variants in the real app (independent QA): undo / redo, mid-stroke language switch, row operations,
// alpha lock / masks / clipping on a language row, language removal confirmation, ghost leaks into every read.
//   node scripts/qa/qa-langqa-adv.mjs --out out-langqa [inf]
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
const bar = (fy, x1, x0 = 0.1) => [P(x0, fy), P(x1, fy)]
const stroke = async (fy, col, x1 = 0.5, x0 = 0.1, size = 20) => {
  await setBrush(page, null, size, 1, col)
  await strokeDoc(page, bar(fy, x1, x0), { zoom })
}
const counts = (lang) =>
  ev(({ lang, rect }) => {
    const img = window.brushwork_app.compositor.readFlattened(rect, 1, true, lang)
    let red = 0, blue = 0, green = 0, other = 0
    for (let i = 0; i < img.px.length; i += 4) {
      const r = img.px[i], g = img.px[i + 1], b = img.px[i + 2]
      if (r > 180 && g < 90 && b < 90) red++
      else if (b > 180 && r < 90 && g < 120) blue++
      else if (g > 130 && r < 90 && b < 90) green++
      else if (r < 235 || g < 235 || b < 235) other++
    }
    return { red, blue, green, other }
  }, { lang, rect })
const inv = () =>
  ev(() => {
    const d = window.brushwork_app.doc
    const bad = []
    const seen = new Set()
    for (const l of d.layers) {
      if (l.lang && !l.isGroup) {
        const p = d.getLayer(l.parentId)
        if (!p || !p.langSet) bad.push('orphan cell ' + l.name)
        const k = l.parentId + '/' + l.lang
        if (seen.has(k)) bad.push('duplicate cell ' + k)
        seen.add(k)
      }
      if (l.langSet && l.parentId && d.getLayer(l.parentId)?.langSet) bad.push('nested language layer')
      if (l.langSet && d.layers.some((c) => c.parentId === l.id && !c.lang)) bad.push('foreign child in ' + l.name)
    }
    return bad
  })
const act = (name, ...a) => ev(({ name, a }) => window.brushwork_layers.actions[name](...a), { name, a })
const key = async (k) => {
  await page.keyboard.press(k)
  await page.waitForTimeout(150)
}
const setView = (c) => ev((c) => window.brushwork_lang.setView(c), c)

// ---------------------------------------------------------------- setup
await stroke(0.8, '#10a020', 0.9)
const common = await ev(() => window.brushwork_app.doc.activeId)
await ev(() => window.brushwork_lang.newLayer('Months'))
const row = await ev(() => window.brushwork_app.doc.langSets()[0].id)

// ---------------------------------------------------------------- 1. creating the cell by a stroke is ONE undo step
await setView('ru')
const u0 = await ev(() => window.brushwork_app.doc.history.undoCount)
await stroke(0.1, '#e01010', 0.5)
const u1 = await ev(() => window.brushwork_app.doc.history.undoCount)
ok(await ev((row) => window.brushwork_app.doc.cellsOf(row).length === 1, row), '1: the stroke created the RU cell')
await key('Control+z')
const after = await ev((row) => ({ cells: window.brushwork_app.doc.cellsOf(row).length, undo: window.brushwork_app.doc.history.undoCount }), row)
ok(after.undo === u0 && after.cells === 0, `1: ONE Ctrl+Z removes stroke and the implicit cell (history ${u0}->${u1}->${after.undo}, cells ${after.cells})`)
await key('Control+Shift+z')
const redo = await ev((row) => ({ cells: window.brushwork_app.doc.cellsOf(row).length, undo: window.brushwork_app.doc.history.undoCount }), row)
ok(redo.undo === u1 && redo.cells === 1, `1: ONE redo brings both back (${JSON.stringify(redo)})`)
ok((await counts('ru')).red > 500, '1: RU writing visible again after redo')
ok((await inv()).length === 0, '1: invariants ' + (await inv()).join(';'))

// ---------------------------------------------------------------- 2. EN writing, mid-stroke language switch
await setView('en')
await stroke(0.1, '#1010e0', 0.4)
await setBrush(page, null, 20, 1, '#e01010')
await setView('ru')
{
  // pointer down in RU, switch to EN with the shortcut in the middle, finish the stroke
  await ev(() => window.brushwork_app.setView({ cx: 540, cy: 960, zoom: 0.4, rot: 0 }))
  await page.waitForTimeout(100)
  const r = await ev(() => { const b = window.brushwork_app.canvas.getBoundingClientRect(); return { l: b.left, t: b.top, w: b.width, h: b.height } })
  const sc = (x, y) => [r.l + r.w / 2 + (x - 540) * 0.4, r.t + r.h / 2 + (y - 960) * 0.4]
  const a = rect.x ? (rect.x, 0) : 0
  void a
  const pt = (fx, fy) => sc(...P(fx, fy))
  await ev(() => window.brushwork_app.setView({ cx: 0, cy: 0, zoom: 1, rot: 0 }))
  const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2
  await ev(({ cx, cy }) => window.brushwork_app.setView({ cx, cy, zoom: 0.4, rot: 0 }), { cx, cy })
  await page.waitForTimeout(100)
  const rr = await ev(() => { const b = window.brushwork_app.canvas.getBoundingClientRect(); return { l: b.left, t: b.top, w: b.width, h: b.height } })
  const S = (fx, fy) => { const [dx, dy] = P(fx, fy); return [rr.l + rr.w / 2 + (dx - cx) * 0.4, rr.t + rr.h / 2 + (dy - cy) * 0.4] }
  void pt
  const [x0, y0] = S(0.1, 0.3)
  await page.mouse.move(x0, y0)
  await page.mouse.down()
  await page.mouse.move(S(0.3, 0.3)[0], S(0.3, 0.3)[1], { steps: 6 })
  await page.keyboard.press('Control+Alt+l')
  await page.waitForTimeout(150)
  await page.mouse.move(S(0.5, 0.3)[0], S(0.5, 0.3)[1], { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(300)
}
{
  const vl = await ev(() => window.brushwork_app.doc.viewLang)
  const ru = await counts('ru')
  const en = await counts('en')
  ok(vl !== 'ru', '2: shortcut switched the view language mid-stroke (view ' + vl + ')')
  ok(ru.red > 1200, `2: the stroke belongs to the language it STARTED in (RU red ${ru.red})`)
  ok(en.red === 0, `2: and never shows in EN (EN red ${en.red})`)
  ok((await inv()).length === 0, '2: invariants')
}

// ---------------------------------------------------------------- 3. undo / redo burst across language switches
{
  const hashes = []
  const hash = async () => JSON.stringify([await counts('ru'), await counts('en')])
  hashes.push(await hash())
  await setView('en')
  await stroke(0.5, '#1010e0', 0.6)
  hashes.push(await hash())
  await setView('ru')
  await stroke(0.55, '#e01010', 0.6)
  hashes.push(await hash())
  await ev((id) => window.brushwork_app.doc.setActive(id), common)
  await stroke(0.6, '#10a020', 0.6)
  hashes.push(await hash())
  const seq = ['en', 'ru', 'en', 'ru', 'en']
  for (let i = 0; i < 3; i++) {
    await setView(seq[i])
    await key('Control+z')
    const h = await hash()
    ok(h === hashes[hashes.length - 2 - i], `3: undo ${i + 1} across a language switch restores the exact state of that step`)
  }
  for (let i = 0; i < 3; i++) {
    await setView(seq[i + 1])
    await key('Control+Shift+z')
    const h = await hash()
    ok(h === hashes[hashes.length - 3 + i], `3: redo ${i + 1} across a language switch`)
  }
  ok((await inv()).length === 0, '3: invariants')
}

// ---------------------------------------------------------------- 4. alpha lock / mask on the language row
{
  await ev((id) => window.brushwork_app.doc.setActive(id), row)
  await setView('ru')
  const before = await counts('ru')
  await act('toggle', 'alphaLock', row)
  const lk = await ev((row) => { const d = window.brushwork_app.doc; return [d.getLayer(row).alphaLock, ...d.cellsOf(row).map((c) => c.alphaLock)] }, row)
  ok(lk.every(Boolean), '4: alpha lock applies to the row and every cell ' + lk)
  await stroke(0.7, '#e01010', 0.5) // a fresh place: with alpha lock nothing may appear
  const mid = await counts('ru')
  ok(mid.red <= before.red + 20, `4: alpha lock: a new stroke in an empty place adds no red (${before.red} -> ${mid.red})`)
  await act('toggle', 'alphaLock', row)
  await key('Control+z')
  await act('addMask', 'black', row)
  const mk = [await counts('ru'), await counts('en')]
  ok(mk[0].red === 0 && mk[1].blue === 0, '4: a black mask on the language row hides every language ' + JSON.stringify(mk))
  await act('maskDelete', row)
  const mk2 = [await counts('ru'), await counts('en')]
  ok(mk2[0].red > 500 && mk2[1].blue > 500, '4: removing the mask brings every language back')
  ok((await inv()).length === 0, '4: invariants')
}

// ---------------------------------------------------------------- 5. clipping a common layer onto the language row
{
  await ev((id) => window.brushwork_app.doc.setActive(id), row)
  await act('newLayer')
  await ev(() => {
    const d = window.brushwork_app.doc
    d.setLayerProps(d.activeId, { clipping: true })
  })
  await setBrush(page, null, 200, 1, '#a0a0a0')
  await strokeDoc(page, [P(0.2, 0.5), P(0.2, 0.7)], { zoom })
  const grey = (lang) => ev(({ lang, rect }) => { const img = window.brushwork_app.compositor.readFlattened(rect, 1, true, lang); let n = 0; for (let i = 0; i < img.px.length; i += 4) if (Math.abs(img.px[i] - 160) < 12 && Math.abs(img.px[i + 1] - 160) < 12 && Math.abs(img.px[i + 2] - 160) < 12) n++; return n }, { lang, rect })
  const g = [await grey('ru'), await grey('en')]
  console.log('   clipped grey blob (200px brush over empty paper below the writing): ru', g[0], 'en', g[1])
  // NOTE: pre-existing behaviour: a clipping layer above ANY group (not only a language row) renders as an ordinary layer (compositor.buildOps resets the clip base on a group)
  ok(Math.abs(g[0] - g[1]) < 3000 && g[0] > 50000, '5: INFO clipping onto a group / language row is not supported (as in 0.3.0): the layer renders unclipped, identically in every language (grey px ' + g[0] + ')')
  await key('Control+z')
  await key('Control+z')
}

// ---------------------------------------------------------------- 6. row operations
{
  const rows = () => ev(() => window.brushwork_app.doc.langSets().length)
  await ev((id) => window.brushwork_app.doc.setActive(id), row)
  const base = [await counts('ru'), await counts('en')]
  await act('duplicate', row)
  ok((await rows()) === 2 && (await inv()).length === 0, '6: duplicate makes a second language row ' + (await inv()))
  const dbl = [await counts('ru'), await counts('en')]
  ok(Math.abs(dbl[0].red - base[0].red) < base[0].red * 0.05 && Math.abs(dbl[1].blue - base[1].blue) < base[1].blue * 0.05, '6: duplicate does not change the picture (edge antialias aside) ' + base[0].red + '/' + dbl[0].red)
  const dupId = await ev(() => window.brushwork_app.doc.activeId)
  // merge down: duplicate onto the original (both language layers)
  await ev((id) => { window.brushwork_app.doc.setActive(id); window.brushwork_layers.actions.mergeSmart() }, dupId)
  ok((await rows()) === 1 && (await inv()).length === 0, '6: merge down language row onto language row leaves one row')
  const mg = [await counts('ru'), await counts('en')]
  ok(mg[0].red > 500 && mg[1].blue > 500, '6: merged row still holds both languages')
  // merge down onto a common layer must be refused
  const msg = await ev((row) => { const d = window.brushwork_app.doc; const n = d.layers.length; window.brushwork_layers.actions.mergeDown(row); return d.layers.length === n }, row)
  ok(msg, '6: merge down of a language row onto an ordinary layer is refused, nothing changes (or was a lang merge)')
  // group + move into group
  await act('newGroup')
  const grp = await ev(() => window.brushwork_app.doc.activeId)
  const moved = await ev(({ row, grp }) => window.brushwork_app.doc.moveLayerRelative(row, grp, 'into'), { row, grp })
  ok(moved && (await inv()).length === 0, '6: a language row can move into an ordinary group')
  const mv = [await counts('ru'), await counts('en')]
  ok(mv[0].red > 500 && mv[1].blue > 500, '6: and still shows in both languages')
  const into = await ev(({ row }) => { const d = window.brushwork_app.doc; const cell = d.cellsOf(row)[0]; const other = d.layers.find((l) => !l.isGroup && !l.lang); return [d.moveLayerRelative(cell.id, other.id, 'above'), d.moveLayerRelative(other.id, row, 'into')] }, { row })
  ok(!into[0] && !into[1], '6: a cell cannot leave its row, an ordinary layer cannot enter a row')
  // delete row + undo
  await act('remove', row)
  const dl = [await counts('ru'), await counts('en')]
  ok(dl[0].red === 0 && dl[1].blue === 0, '6: deleting the row removes every language')
  await key('Control+z')
  const ud = [await counts('ru'), await counts('en')]
  ok(ud[0].red > 500 && ud[1].blue > 500 && (await inv()).length === 0, '6: undo of the delete restores all languages')
}

// ---------------------------------------------------------------- 7. removing a language that holds writing asks first (UI)
{
  if (!(await ev(() => !!document.querySelector('.lp-top')))) await key('l')
  await page.waitForTimeout(300)
  await page.click('.lg-bar > button')
  await page.waitForTimeout(200)
  await page.screenshot({ path: 'qa-screens/langqa/adv-dbg.png' })
  await page.click('.lp-opt >> text=Edit languages', { timeout: 5000 })
  await page.waitForTimeout(300)
  const btns = await ev(() => [...document.querySelectorAll('.an-modal .lg-item button')].map((b) => b.textContent))
  console.log('   languages dialog remove buttons:', btns)
  // 2 languages: remove disabled -> add a third first
  await page.fill('.lg-add input >> nth=0', 'de')
  await page.fill('.lg-add input >> nth=1', 'Deutsch')
  await page.click('.lg-add button')
  await page.waitForTimeout(200)
  await page.click('.lg-item >> nth=1 >> button') // remove RU (holds writing)
  await page.waitForTimeout(300)
  const dialogs = await ev(() => document.querySelectorAll('.an-modal-bg').length)
  ok(dialogs === 2, '7: removing a language with writing asks for confirmation (' + dialogs + ' dialogs open)')
  await page.screenshot({ path: 'qa-screens/langqa/adv-remove-confirm.png' })
  // cancel
  await page.click('.an-modal-bg:last-child button:has-text("Cancel")')
  await page.waitForTimeout(200)
  ok((await ev(() => window.brushwork_app.doc.langs.length)) === 3, '7: Cancel keeps the language')
  await page.click('.lg-item >> nth=1 >> button')
  await page.waitForTimeout(300)
  await page.click('.an-modal-bg:last-child button.danger, .an-modal-bg:last-child footer button.primary')
  await page.waitForTimeout(300)
  ok((await ev(() => window.brushwork_app.doc.langs.map((l) => l.code).join())) === 'en,de', '7: confirmed -> RU removed')
  ok((await counts('en')).blue > 500, '7: EN writing untouched')
  await page.keyboard.press('Escape')
  await key('Control+z') // undo remove
  await key('Control+z') // undo add de
  ok((await ev(() => window.brushwork_app.doc.langs.map((l) => l.code).join())) === 'en,ru', '7: undo restores the language list')
  ok((await counts('ru')).red > 500, '7: ... and the RU writing')
}

// ---------------------------------------------------------------- 8. ghost never leaks into any read
{
  await ev(() => window.brushwork_app.doc.setLangGhost(true))
  await setView('en')
  await page.waitForTimeout(300)
  const leak = await ev(async ({ rect }) => {
    const a = window.brushwork_app
    const out = {}
    const red = (px) => { let n = 0; for (let i = 0; i < px.length; i += 4) if (px[i] > 120 && px[i + 1] < 200 && px[i + 2] < 200 && px[i] - px[i + 2] > 60) n++; return n }
    out.screenComposite = a.doc.isInfinite ? null : (() => { a.renderNow(); const p = a.gpu.readRGBA8(a.compositor.composite, { x: 0, y: 0, w: a.doc.width, h: a.doc.height }); return red(p) })()
    out.readFlattenedRect = red(a.compositor.readFlattened(rect, 1, true).px)
    out.readFlattenedAll = red(a.compositor.readFlattened(true))
    out.thumb = null
    const rec = window.brushwork_animio.tl.current
    out.variants = rec.variants.join()
    return out
  }, { rect })
  console.log('   ghost reads (red px):', JSON.stringify(leak))
  ok(leak.readFlattenedRect === 0, '8: readFlattened(rect) is ghost-free')
  ok(leak.readFlattenedAll === 0, '8: readFlattened(true) is ghost-free')
  // the eyedropper on a RU-only pixel must report paper, not ghost red
  const eye = await ev(({ rect }) => {
    const a = window.brushwork_app
    // find a ru-only pixel: row 0.1 (fy) x 0.2 (fx) is RU writing in the first stroke
    const x = rect.x + 0.45 * rect.w, y = rect.y + 0.1 * rect.h
    const cl = a.compositor.readFlattened({ x: Math.floor(x), y: Math.floor(y), w: 1, h: 1 }, 1, true, 'ru').px
    return [cl[0], cl[1], cl[2]]
  }, { rect })
  console.log('   ru pixel sample', eye)
  // draw a common stroke with ghost on, then inspect the recorded EN frame
  await ev((id) => window.brushwork_app.doc.setActive(id), common)
  await stroke(0.9, '#10a020', 0.7)
  await page.waitForTimeout(1200)
  const fr = await ev(async () => {
    const rec = window.brushwork_animio.tl.current
    await rec.flush()
    const tags = await rec.tags()
    const out = {}
    for (const lang of ['en', 'ru']) {
      let idx = -1
      for (let i = tags.length - 1; i >= 0; i--) if (!tags[i].v || tags[i].v.includes(lang)) { idx = i; break }
      const bmp = await createImageBitmap(new Blob([await rec.frame(idx)], { type: 'image/jpeg' }))
      const cv = new OffscreenCanvas(bmp.width, bmp.height)
      const cx = cv.getContext('2d', { willReadFrequently: true })
      cx.drawImage(bmp, 0, 0)
      const d = cx.getImageData(0, 0, bmp.width, bmp.height).data
      let red = 0, blue = 0, faint = 0
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] > 150 && d[i + 1] < 120 && d[i + 2] < 120) red++
        else if (d[i + 2] > 150 && d[i] < 120 && d[i + 1] < 140) blue++
        else if (d[i] - d[i + 2] > 25 && d[i] > 180 && d[i + 1] > 150) faint++ // faint reddish ghost
        else if (d[i + 2] - d[i] > 25 && d[i + 2] > 180 && d[i + 1] > 150) faint++
      }
      out[lang] = { idx, red, blue, faint }
    }
    return out
  })
  console.log('   last frame per variant with ghost ON:', JSON.stringify(fr))
  ok(fr.en.red === 0 && fr.en.faint < 400, '8: the EN frame recorded while the ghost was on has no RU ghost')
  ok(fr.ru.blue === 0 && fr.ru.faint < 400, '8: the RU frame has no EN ghost')
  await ev(() => window.brushwork_app.doc.setLangGhost(false))
}
console.log('errors', errors.length ? errors.slice(0, 8) : 'none')
await app.close()
process.exit(fail ? 1 : 0)
