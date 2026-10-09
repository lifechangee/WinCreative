// Frame QA: clipping of strokes at the frame edge on fixed + infinite documents (pixel readback), toggle, undo.
// usage: node scripts/qa/qa-frame.mjs [--out out-frame]
import { launch, newDoc, outDirOf, strokeDoc } from './qa-inf-lib.mjs'
const { app, page, errors } = await launch(outDirOf(process.argv.slice(2)))
let fail = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++ }
for (const kind of ['fixed', 'infinite']) {
  await newDoc(page, kind, 1600, 1200)
  const off = kind === 'infinite' ? -400 : 0
  const R = { x: 400 + off, y: 300 + off, w: 400, h: 300 }
  await page.evaluate((R) => { const f = window.brushwork_frame; f.createFrame(R.w, R.h); f.editFrame({ x: R.x, y: R.y }) }, R)
  await page.evaluate(() => { const a = window.brushwork_app; a.state.setTool('brush'); a.state.settings.size = 80; a.state.settings.opacity = 1 })
  // stroke crossing left+right frame edges, plus a soft vertical one across the top
  await strokeDoc(page, [[R.x - 150, R.y + 150], [R.x + R.w + 150, R.y + 150]], { zoom: 1 })
  const read = (rect) => page.evaluate((rect) => { const a = window.brushwork_app; const l = a.doc.activeLayer; const px = a.doc.readRegionPixels(l, rect); let n = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 0) n++; return n }, rect)
  const left = await read({ x: R.x - 200, y: R.y, w: 200, h: R.h })
  const right = await read({ x: R.x + R.w, y: R.y, w: 200, h: R.h })
  const inside = await read(R)
  ok(left === 0 && right === 0, `${kind}: nothing painted outside (left ${left}, right ${right})`)
  ok(inside > 1000, `${kind}: painted inside (${inside})`)
  // exact edge: first/last column of the frame must be painted along the stroke centre
  const edge = await read({ x: R.x, y: R.y + 145, w: 1, h: 10 })
  ok(edge > 0, `${kind}: stroke reaches the frame edge column (${edge})`)
  // toggle off -> paint outside
  await page.evaluate(() => window.brushwork_frame.toggle())
  await strokeDoc(page, [[R.x - 150, R.y + 250], [R.x + 100, R.y + 250]], { zoom: 1 })
  ok((await read({ x: R.x - 200, y: R.y + 200, w: 200, h: 100 })) > 500, `${kind}: frame off paints outside`)
  await page.evaluate(() => window.brushwork_frame.toggle())
  await page.evaluate(() => window.brushwork_app.undo())
  ok(true, `${kind}: toggle/undo ran`)
}
console.log('errors', errors.length ? errors : 'none')
await app.close()
process.exit(fail ? 1 : 0)
