// Smart selection quality QA: drives the real app, selects objects by click / box / brush on test pictures and writes contact sheets
// (original + mask outline | cut-out on checkerboard | cut-out on magenta) plus timing numbers.
// usage: node scripts/qa/qa-smartselect.mjs <imgdir> <outdir> [fast|precise|brush|all] [userDataDir]
import * as L from './ss-lib.mjs'
import fs from 'node:fs'
import path from 'node:path'

const [imgDir, outDir, which = 'all', ud] = process.argv.slice(2)
fs.mkdirSync(outDir, { recursive: true })
const CASES = [
  { img: 'p237.jpg', name: 'lab', clicks: [[600, 450]], brush: [[[420, 400], [560, 520], [700, 420]]] },
  { img: 'p1025.jpg', name: 'pug-blanket', clicks: [[600, 450]], brush: [[[560, 300], [600, 520], [520, 620]]] },
  { img: 'p1074.jpg', name: 'lioness', clicks: [[590, 470]], brush: [[[500, 350], [600, 480], [700, 380]]] },
  { img: 'p659.jpg', name: 'husky', clicks: [[620, 420]], brush: [[[500, 300], [650, 450], [800, 200]]] },
  { img: 'p1062.jpg', name: 'pug-bed', clicks: [[360, 520]], brush: [[[330, 480], [500, 560], [560, 300]]] }
]

const SHEET = async (page, name) => {
  return page.evaluate(async (name) => {
    const app = window.brushwork_app
    const svc = app.selection
    const b = svc.bounds()
    if (!b) return null
    const W = app.doc.width
    const m = 24
    const x0 = Math.max(0, b.x - m), y0 = Math.max(0, b.y - m)
    const x1 = Math.min(W, b.x + b.w + m), y1 = Math.min(app.doc.height, b.y + b.h + m)
    const w = x1 - x0, h = y1 - y0
    const src = app.gpu.readRGBA8(app.doc.layers[0].pixels, { x: x0, y: y0, w, h })
    const before = app.doc.layers.length
    await window.brushwork_smartselect.cut('copy')
    const nl = app.doc.activeLayer
    const cut = app.gpu.readRGBA8(nl.pixels, { x: x0, y: y0, w, h })
    const k = Math.min(1, 520 / Math.max(w, h))
    const pw = Math.round(w * k), ph = Math.round(h * k)
    const cv = document.createElement('canvas')
    cv.width = pw * 3 + 20
    cv.height = ph
    const c = cv.getContext('2d')
    const mk = (data) => { const oc = document.createElement('canvas'); oc.width = w; oc.height = h; oc.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0); return oc }
    c.imageSmoothingQuality = 'high'
    // panel 1: original with 50% mask tint outside + contour
    const o = new Uint8ClampedArray(src)
    const sd = svc.data
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const a = sd[(y0 + y) * W + x0 + x] / 255, i = (y * w + x) * 4
      const t = 1 - a
      o[i] = o[i] * (1 - 0.6 * t) + 20 * 0.6 * t
      o[i + 1] = o[i + 1] * (1 - 0.6 * t) + 20 * 0.6 * t
      o[i + 2] = o[i + 2] * (1 - 0.6 * t) + 120 * 0.6 * t
    }
    c.drawImage(mk(o), 0, 0, pw, ph)
    // panel 2: checkerboard, panel 3: magenta
    const bg = (px0, fn) => { c.save(); c.translate(px0, 0); fn(); c.drawImage(mk(cut), 0, 0, pw, ph); c.restore() }
    bg(pw + 10, () => { for (let y = 0; y < ph; y += 12) for (let x = 0; x < pw; x += 12) { c.fillStyle = ((x + y) / 12) % 2 ? '#ccc' : '#fff'; c.fillRect(x, y, 12, 12) } })
    bg(2 * pw + 20, () => { c.fillStyle = '#ff00ff'; c.fillRect(0, 0, pw, ph) })
    app.doc.undo()
    return { png: cv.toDataURL('image/png').split(',')[1], layers: before, w, h }
  }, name)
}

const run = async (mode) => {
  const { app, page, errs } = await L.launch({ userData: ud })
  const rows = []
  try {
    for (const cs of CASES) {
      await L.loadImage(page, path.join(imgDir, cs.img))
      await L.openTool(page, mode)
      const t0 = Date.now()
      await L.waitIdle(page, 240000)
      const prep = Date.now() - t0
      if (mode === 'brush') {
        for (const stroke of cs.brush) {
          const p0 = await L.docToClient(page, ...stroke[0])
          await page.mouse.move(p0.x, p0.y)
          await page.mouse.down()
          for (const q of stroke.slice(1)) { const p = await L.docToClient(page, ...q); await page.mouse.move(p.x, p.y, { steps: 12 }) }
          await page.mouse.up()
          await L.waitIdle(page, 120000)
        }
      } else {
        for (const [x, y] of cs.clicks) { await L.click(page, x, y); await L.waitIdle(page, 120000) }
      }
      const stats = await page.evaluate(() => ({ ...window.brushwork_smartselect.c.engine.stats }))
      await page.evaluate(() => window.brushwork_smartselect.c.finishSession(true))
      const sheet = await SHEET(page, cs.name)
      if (sheet) fs.writeFileSync(path.join(outDir, `${mode}-${cs.name}.png`), Buffer.from(sheet.png, 'base64'))
      await L.shot(page, path.join(outDir, `${mode}-${cs.name}-app.png`))
      rows.push({ case: cs.name, mode, prepMs: prep, ep: stats.ep, encodeMs: Math.round(stats.lastEncodeMs), decodeMs: Math.round(stats.lastDecodeMs), sheet: !!sheet })
      await page.evaluate(() => { window.brushwork_app.selection.clear(); window.brushwork_smartselect.c.deactivate(false) })
    }
  } catch (e) { console.log('ERR', mode, e) }
  console.log(errs.filter((e) => !/VerifyEachNode/.test(e)).slice(0, 6).join('\n'))
  await app.close()
  return rows
}
const modes = which === 'all' ? ['fast', 'precise', 'brush'] : [which]
for (const m of modes) console.table(await run(m))
