// Smart selection on an INFINITE canvas with a real photo far from the origin (negative coords, across tile borders):
// click select, all 4 cut-outs, undo/redo, frame clipping, save + reload. Screenshots / sheets go to <outdir> (qa-screens/ss).
// usage: node scripts/qa/qa-ss-inf.mjs <photo.jpg> <outdir>
import * as L from './ss-lib.mjs'
import fs from 'node:fs'
import path from 'node:path'
const [img, outDir] = process.argv.slice(2)
fs.mkdirSync(outDir, { recursive: true })
const { app, page, errs } = await L.launch()
const res = []
const check = (n, ok, x = '') => res.push({ check: n, ok: ok ? 'PASS' : 'FAIL', info: String(x) })
const OX = -3333, OY = -2222
try {
  const b64 = fs.readFileSync(img).toString('base64')
  const dim = await page.evaluate(async ({ b64, OX, OY }) => {
    const a = window.brushwork_app
    const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/jpeg' }))
    const oc = new OffscreenCanvas(bmp.width, bmp.height); const cx = oc.getContext('2d'); cx.drawImage(bmp, 0, 0)
    const d = cx.getImageData(0, 0, bmp.width, bmp.height).data
    const doc = a.newDocument(2048, 2048, { kind: 'infinite' })
    const s = a.gpu.surface(bmp.width, bmp.height, doc.format); a.gpu.uploadRGBA8(s, 0, 0, bmp.width, bmp.height, d)
    doc.writeRegion(doc.activeLayer, { x: OX, y: OY, w: bmp.width, h: bmp.height }, s); s.dispose()
    a.setView({ ...a.view, cx: OX + bmp.width / 2, cy: OY + bmp.height / 2, zoom: 0.9 })
    return { w: bmp.width, h: bmp.height }
  }, { b64, OX, OY })
  await L.openTool(page, 'fast')
  await L.waitIdle(page, 120000)
  await L.click(page, OX + dim.w / 2 - 20, OY + dim.h * 0.56)
  await L.waitIdle(page)
  const sb = await page.evaluate(() => window.brushwork_app.selection.bounds())
  check('click selects on the infinite canvas (bounds in negative document space)', !!sb && sb.x < -2000 && sb.w > 200, JSON.stringify(sb))
  await L.shot(page, path.join(outDir, 'inf-01-selected.png'))
  await page.evaluate(() => window.brushwork_smartselect.c.finishSession(true))
  const n0 = await page.evaluate(() => window.brushwork_app.doc.layers.length)
  const st = (a) => page.evaluate((a) => window.brushwork_smartselect.cut(a).then(() => ({ layers: window.brushwork_app.doc.layers.length, mask: !!window.brushwork_app.doc.activeLayer.mask })), a)
  const undo = () => page.evaluate(() => window.brushwork_app.doc.undo())
  const redo = () => page.evaluate(() => window.brushwork_app.doc.redo())
  const hideBase = (hide) => page.evaluate((hide) => { const d = window.brushwork_app.doc; d.layers[0].visible = !hide; window.brushwork_app.requestRender() }, hide)
  // cut -> screenshot with the base layer hole visible
  let r = await st('cut')
  check('cut to new layer', r.layers === n0 + 1)
  await page.waitForTimeout(400)
  await L.shot(page, path.join(outDir, 'inf-02-cut-hole.png'))
  await undo(); check('cut undone in 1 step', (await page.evaluate(() => window.brushwork_app.doc.layers.length)) === n0)
  await redo(); check('cut redone', (await page.evaluate(() => window.brushwork_app.doc.layers.length)) === n0 + 1)
  await undo()
  await page.evaluate(() => { const d = window.brushwork_app.doc; d.setActive(d.layers[0].id) })
  r = await st('copy')
  check('copy to new layer', r.layers === n0 + 1)
  await hideBase(true); await page.waitForTimeout(400)
  await L.shot(page, path.join(outDir, 'inf-03-copy-layer-only.png'))
  await hideBase(false)
  await undo()
  await page.evaluate(() => { const d = window.brushwork_app.doc; d.setActive(d.layers[0].id) })
  r = await st('removeBg')
  check('remove background = layer mask', r.mask)
  await page.waitForTimeout(400)
  await L.shot(page, path.join(outDir, 'inf-04-removebg.png'))
  // save + reload with the mask
  const ok = await page.evaluate(async () => {
    const bytes = await window.brushwork_io.saveBwk()
    const d2 = await window.brushwork_io.loadBwk(bytes)
    const l = d2.layers[0]
    return { size: bytes.length, infinite: d2.isInfinite, mask: !!l.mask, bounds: l.tiles?.bounds() }
  })
  check('save + reload keeps tiles and mask', ok.infinite && ok.mask && ok.bounds && ok.bounds.x < -2000, JSON.stringify(ok))
  await undo()
  // frame clips the result
  await page.evaluate(({ OX, OY, w, h }) => { const f = window.brushwork_frame; f.createFrame(600, 400); f.editFrame({ x: OX + w / 2 - 300, y: OY + h / 2 - 200 }) }, { OX, OY, w: dim.w, h: dim.h })
  await page.evaluate(() => { const d = window.brushwork_app.doc; d.setActive(d.layers[0].id) })
  await L.click(page, OX + dim.w / 2 - 20, OY + dim.h * 0.56)
  await L.waitIdle(page)
  await page.evaluate(() => window.brushwork_smartselect.c.finishSession(true))
  const fb = await page.evaluate(async () => {
    const f = window.brushwork_frame.getFrame()
    await window.brushwork_smartselect.cut('copy')
    const d = window.brushwork_app.doc
    const l = d.activeLayer
    const cnt = (r) => { const px = d.readRegionPixels(l, r); let n = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 0) n++; return n }
    return { left: cnt({ x: f.x - 300, y: f.y, w: 300, h: f.h }), top: cnt({ x: f.x, y: f.y - 300, w: f.w, h: 300 }), inside: cnt(f) }
  })
  check('frame: the cut-out is clipped by the frame (nothing outside, content inside)', fb.left === 0 && fb.top === 0 && fb.inside > 1000, JSON.stringify(fb))
  await page.evaluate(() => { const d = window.brushwork_app.doc; d.layers[0].visible = false; window.brushwork_app.requestRender() })
  await page.waitForTimeout(400)
  await L.shot(page, path.join(outDir, 'inf-05-frame.png'))
} catch (e) { console.log('ERR', e) }
console.table(res)
console.log(errs.filter((e) => !/VerifyEachNode/.test(e)).slice(0, 6).join('\n'))
await app.close()
process.exit(res.some((r) => r.ok === 'FAIL') ? 1 : 0)
