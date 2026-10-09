import * as L from './ss-lib.mjs'
import fs from 'node:fs'
const SP = process.argv[2]
const { app, page } = await L.launch()
const CASES = [['p1074.jpg', [[[500, 350], [600, 480], [700, 380]]]], ['p1025.jpg', [[[560, 300], [600, 520], [520, 620]]]], ['p659.jpg', [[[500, 300], [650, 450], [800, 200]]]], ['p237.jpg', [[[420, 400], [560, 520], [700, 420]]]]]
const VARS = [{ iterations: 0 }, { iterations: 1 }, { iterations: 2 }, { iterations: 1, edge: 2.5, colour: 4 }, { iterations: 1, edge: 8, colour: 1.5 }, { iterations: 2, edge: 3, colour: 3 }]
const tiles = []
for (const [img, strokes] of CASES) {
  await L.loadImage(page, SP + '/img/' + img)
  for (const v of VARS) {
    await page.evaluate((v) => { const b = window.brushwork_smartselect; b.ss.brushOpts = v; b.c.deactivate(false); b.ss.mode = 'brush'; b.c.activate() }, v)
    for (const st of strokes) {
      const p0 = await L.docToClient(page, ...st[0]); await page.mouse.move(p0.x, p0.y); await page.mouse.down()
      for (const q of st.slice(1)) { const p = await L.docToClient(page, ...q); await page.mouse.move(p.x, p.y, { steps: 12 }) }
      await page.mouse.up(); await L.waitIdle(page, 120000)
    }
    const m = await L.selectionMask(page)
    tiles.push({ img, v: JSON.stringify(v), m })
    await page.evaluate(() => { window.brushwork_smartselect.c.finishSession(false); window.brushwork_app.selection.clear() })
  }
}
const png = await page.evaluate(async (tiles) => {
  const cell = 200, cols = 6
  const cv = document.createElement('canvas'); cv.width = cols * cell; cv.height = Math.ceil(tiles.length / cols) * cell
  const c = cv.getContext('2d'); c.fillStyle = '#333'; c.fillRect(0, 0, cv.width, cv.height)
  tiles.forEach((t, i) => {
    const bin = atob(t.m.b64); const oc = document.createElement('canvas'); oc.width = t.m.w; oc.height = t.m.h
    const id = new ImageData(t.m.w, t.m.h)
    for (let k = 0; k < bin.length; k++) { const v = bin.charCodeAt(k); id.data[k * 4] = id.data[k * 4 + 1] = id.data[k * 4 + 2] = v; id.data[k * 4 + 3] = 255 }
    oc.getContext('2d').putImageData(id, 0, 0)
    c.drawImage(oc, (i % cols) * cell, Math.floor(i / cols) * cell, cell, cell * t.m.h / t.m.w)
  })
  return cv.toDataURL('image/png').split(',')[1]
}, tiles)
fs.writeFileSync(SP + '/sweep.png', Buffer.from(png, 'base64'))
await app.close()
