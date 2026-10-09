// Animation Assist / Page Assist with a language layer (independent QA): the language row is ONE frame; it shows (and exports) the view language.
//   node scripts/qa/qa-langqa-anim.mjs --out out-langqa
import { launch, newDoc, outDirOf, setBrush, strokeDoc } from './qa-inf-lib.mjs'

const args = process.argv.slice(2)
const { app, page, errors } = await launch(outDirOf(args))
let fail = 0
const ok = (c, m) => {
  console.log((c ? 'PASS ' : 'FAIL ') + m)
  if (!c) fail++
}
const ev = (fn, arg) => page.evaluate(fn, arg)
for (const kind of ['fixed', 'infinite']) {
  await newDoc(page, kind, kind === 'infinite' ? 4096 : 1080, kind === 'infinite' ? 4096 : 1920)
  await page.waitForTimeout(500)
  const rect = await ev((kind) => {
    if (kind === 'infinite') window.brushwork_frame.createFrame(1080, 1920)
    const f = kind === 'infinite' ? window.brushwork_frame.getFrame() : { x: 0, y: 0, w: 1080, h: 1920 }
    return { x: f.x, y: f.y, w: f.w, h: f.h }
  }, kind)
  const P = (fx, fy) => [rect.x + fx * rect.w, rect.y + fy * rect.h]
  await setBrush(page, null, 20, 1, '#10a020')
  await strokeDoc(page, [P(0.1, 0.8), P(0.9, 0.8)], { zoom: 0.4 })
  await ev(() => window.brushwork_lang.newLayer('Months'))
  for (const [c, col] of [['ru', '#e01010'], ['en', '#1010e0']]) {
    await ev((c) => window.brushwork_lang.setView(c), c)
    await setBrush(page, null, 20, 1, col)
    await strokeDoc(page, [P(0.1, 0.2), P(0.6, 0.2)], { zoom: 0.4 })
  }
  const res = await ev(async ({ rect }) => {
    const an = window.brushwork_animio.anim
    const doc = window.brushwork_app.doc
    an.setEnabled(true)
    const frames = an.frames()
    const idx = frames.findIndex((f) => f.langSet)
    an.setCurrent(idx)
    await new Promise((r) => setTimeout(r, 400))
    const out = { frames: frames.length, idx }
    const count = (b) => { let red = 0, blue = 0; for (let i = 0; i < b.data.length; i += 4) { const r = b.data[i], g = b.data[i + 1], bb = b.data[i + 2]; if (r > 180 && g < 90 && bb < 90) red++; else if (bb > 180 && r < 90 && g < 120) blue++ } return { red, blue } }
    for (const lang of ['en', 'ru']) {
      doc.setViewLang(lang)
      await new Promise((r) => setTimeout(r, 400))
      const list = [frames[idx]]
      const b = an.renderer().bitmap(list, { paper: [1, 1, 1], size: { width: 270, height: 480 } })
      out['export_' + lang] = count(b)
      const px = window.brushwork_app.compositor.readFlattened(rect, 0.25, true)
      out['screen_' + lang] = count({ data: px.px })
    }
    an.setEnabled(false)
    return out
  }, { rect })
  console.log(kind, JSON.stringify(res))
  ok(res.idx >= 0 && res.export_en.blue > 100 && res.export_en.red === 0 && res.export_ru.red > 100 && res.export_ru.blue === 0, `${kind}: Animation Assist exports the language row in the view language`)
  ok(res.screen_en.red === 0 && res.screen_ru.blue === 0, `${kind}: Animation Assist screen follows the view language`)
}
console.log('errors', errors.length ? errors.slice(0, 5) : 'none')
await app.close()
process.exit(fail ? 1 : 0)
