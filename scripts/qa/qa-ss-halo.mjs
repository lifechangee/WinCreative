// Halo check: cut-out edges at 4x on magenta and white, with and without "Decontaminate colours".
// usage: node scripts/qa/qa-ss-halo.mjs <img.jpg> <outfile.png> <clickX> <clickY> <cropX> <cropY> [w h]
import * as L from './ss-lib.mjs'
import fs from 'node:fs'
const [img, out, cx, cy, kx, ky, kw = '120', kh = '80'] = process.argv.slice(2)
const { app, page } = await L.launch()
await L.loadImage(page, img)
await L.openTool(page, 'fast')
await L.waitIdle(page, 120000)
await L.click(page, +cx, +cy)
await L.waitIdle(page)
await page.evaluate(() => window.brushwork_smartselect.c.finishSession(true))
const png = await page.evaluate(async ({ kx, ky, kw, kh }) => {
  const app = window.brushwork_app
  const cv = document.createElement('canvas')
  const Z = 4
  cv.width = kw * Z * 2 + 10
  cv.height = kh * Z * 2 + 10
  const c = cv.getContext('2d')
  c.imageSmoothingEnabled = false
  let row = 0
  for (const decon of [false, true]) {
    window.brushwork_smartselect.ss.decontaminate = decon
    await window.brushwork_smartselect.cut('copy')
    const px = app.gpu.readRGBA8(app.doc.activeLayer.pixels, { x: kx, y: ky, w: kw, h: kh })
    const oc = document.createElement('canvas'); oc.width = kw; oc.height = kh
    oc.getContext('2d').putImageData(new ImageData(px, kw, kh), 0, 0)
    ;['#ff00ff', '#ffffff'].forEach((bg, col) => { c.fillStyle = bg; c.fillRect(col * (kw * Z + 10), row * (kh * Z + 10), kw * Z, kh * Z); c.drawImage(oc, col * (kw * Z + 10), row * (kh * Z + 10), kw * Z, kh * Z) })
    app.doc.undo()
    row++
  }
  return cv.toDataURL('image/png').split(',')[1]
}, { kx: +kx, ky: +ky, kw: +kw, kh: +kh })
fs.writeFileSync(out, Buffer.from(png, 'base64'))
await app.close()
