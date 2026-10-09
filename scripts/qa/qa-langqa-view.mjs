// Frameless infinite canvas + language variants: the recorded per-variant frames (GPU downscale path) must equal what the screen shows in that
// language (oracle = a real screenshot of the canvas), and carry only that language's writing.
//   node scripts/qa/qa-langqa-view.mjs --out out-langqa
import { launch, newDoc, outDirOf, setBrush, strokeDoc } from './qa-inf-lib.mjs'

const args = process.argv.slice(2)
const { app, page, errors } = await launch(outDirOf(args))
let fail = 0
const ok = (c, m) => {
  console.log((c ? 'PASS ' : 'FAIL ') + m)
  if (!c) fail++
}
await newDoc(page, 'infinite', 4096, 4096)
await page.waitForTimeout(500)
const zoom = 0.5
await setBrush(page, null, 18, 1, '#10a020')
await strokeDoc(page, [[-300, 200], [-100, -100], [100, 50], [300, -200]], { zoom })
await page.evaluate(() => window.brushwork_lang.newLayer('Months'))
for (const [c, col, y] of [['ru', '#e01010', -250], ['en', '#1010e0', -200]]) {
  await page.evaluate((l) => window.brushwork_lang.setView(l), c)
  await setBrush(page, null, 20, 1, col)
  for (let i = 0; i < 3; i++) await strokeDoc(page, [[-300, y + i * 30], [-150 + i * 40, y + i * 30]], { zoom })
}
await page.evaluate(() => {
  const d = window.brushwork_app.doc
  d.setActive(d.layers.find((l) => !l.isGroup && !l.lang).id)
})
await setBrush(page, null, 18, 1, '#10a020')
await strokeDoc(page, [[-300, 260], [300, 260]], { zoom })
await page.waitForTimeout(1500)
await page.evaluate(() => window.brushwork_animio.tl.current.flush())

// a rotated + mirrored view: one more common stroke drawn through the real pointer path, then the frames are compared again
const ROT = args.includes('plain') ? 0 : 1
if (ROT) {
  await page.evaluate(() => window.brushwork_app.setView({ cx: 0, cy: 0, zoom: 0.5, rot: 0.5, mirror: true }))
  await page.waitForTimeout(200)
  const c = await page.evaluate(() => { const b = window.brushwork_app.canvas.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } })
  await page.mouse.move(c.x - 150, c.y + 120)
  await page.mouse.down()
  await page.mouse.move(c.x + 150, c.y + 160, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(1500)
  await page.evaluate(() => window.brushwork_animio.tl.current.flush())
}
for (const lang of ['ru', 'en']) {
  await page.evaluate((l) => window.brushwork_lang.setView(l), lang)
  await page.waitForTimeout(500)
  const rect = await page.evaluate(() => {
    const r = window.brushwork_app.canvas.getBoundingClientRect()
    return { x: r.left, y: r.top, width: r.width, height: r.height }
  })
  const shotBuf = await page.screenshot({ clip: rect })
  const { writeFileSync } = await import('fs')
  writeFileSync(`qa-screens/langqa/view-${lang}-screen.png`, shotBuf)
  const png = shotBuf.toString('base64')
  const res = await page.evaluate(async ({ png, lang }) => {
    const rec = window.brushwork_animio.tl.current
    await rec.flush()
    const tags = await rec.tags()
    let idx = -1
    for (let i = tags.length - 1; i >= 0; i--) if (!tags[i].v || tags[i].v.includes(lang)) { idx = i; break }
    const jpg = await rec.frame(idx)
    window.__jpg = Array.from(jpg)
    const bmp = await createImageBitmap(new Blob([jpg], { type: 'image/jpeg' }))
    const shot = await createImageBitmap(new Blob([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], { type: 'image/png' }))
    const W = bmp.width, H = bmp.height
    const cv = new OffscreenCanvas(W, H)
    const cx = cv.getContext('2d', { willReadFrequently: true })
    cx.drawImage(bmp, 0, 0)
    const a = cx.getImageData(0, 0, W, H).data
    cx.imageSmoothingQuality = 'high'
    cx.drawImage(shot, 0, 0, W, H)
    const b = cx.getImageData(0, 0, W, H).data
    let sum = 0, big = 0, red = 0, blue = 0
    let cnt = 0
    for (let i = 0; i < a.length; i += 4) {
      const px = (i / 4) % W // the screen also shows the tool pill (left) and the position badge (top-left): not part of the picture
      if (px < 110 || Math.floor(i / 4 / W) < 50) continue
      cnt++
      const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
      sum += d / 3
      if (d > 150) big++
      if (a[i] > 170 && a[i + 1] < 110 && a[i + 2] < 110) red++
      else if (a[i + 2] > 170 && a[i] < 110 && a[i + 1] < 130) blue++
    }
    return { n: tags.length, idx, tag: tags[idx], W, H, mean: sum / cnt, big: big / cnt, red, blue, areaR: tags[idx].r }
  }, { png, lang })
  writeFileSync(`qa-screens/langqa/view-${lang}-frame.jpg`, Buffer.from(await page.evaluate(() => window.__jpg)))
  console.log(lang, JSON.stringify(res))
  ok(res.mean < 6 && res.big < 0.01, `${lang}: last recorded frame equals the screen (mean diff ${res.mean.toFixed(2)}, big ${(res.big * 100).toFixed(2)}%)`)
  ok(lang === 'ru' ? res.red > 100 && res.blue === 0 : res.blue > 100 && res.red === 0, `${lang}: frame holds only its own writing (red ${res.red}, blue ${res.blue})`)
}
console.log('errors', errors.length ? errors.slice(0, 5) : 'none')
await app.close()
process.exit(fail ? 1 : 0)
