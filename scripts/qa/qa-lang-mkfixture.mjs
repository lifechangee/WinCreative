// Makes tests/fixtures/v0.3.0.bwk with the 0.3.0 code base (build in ./out, made BEFORE the language-variants work): an infinite canvas with a
// frame, three strokes, a time-lapse recording and a time-lapse edit (version 1 model). usage: node scripts/qa/qa-lang-mkfixture.mjs --out out
import { launch, newDoc, outDirOf, setBrush, strokeDoc } from './qa-inf-lib.mjs'
import { writeFileSync } from 'node:fs'
const { app, page } = await launch(outDirOf(process.argv.slice(2)))
await newDoc(page, 'infinite', 4096, 4096)
await page.evaluate(() => window.brushwork_frame.createFrame(1080, 1920))
await page.waitForTimeout(600)
const f = await page.evaluate(() => window.brushwork_frame.getFrame())
await setBrush(page, null, 24, 1, '#2040c0')
for (let i = 0; i < 3; i++) await strokeDoc(page, [[f.x + 150, f.y + 300 + i * 400], [f.x + 900, f.y + 500 + i * 400]], { zoom: 0.4 })
await page.waitForTimeout(800)
const b64 = await page.evaluate(async () => {
  const rec = window.brushwork_animio.tl.current
  await rec.flush()
  const e = rec.edit
  rec.setEdit({ ...e, globalSpeed: 2, pauses: [{ id: 1, at: 2, seconds: 1.5 }], nextId: 2 })
  const bytes = await window.brushwork_io.saveBwk()
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
})
writeFileSync('tests/fixtures/v0.3.0.bwk', Buffer.from(b64, 'base64'))
console.log('written', Buffer.from(b64, 'base64').length, 'bytes')
await app.close()
