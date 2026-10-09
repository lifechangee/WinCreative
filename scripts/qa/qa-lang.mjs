// Language variants end-to-end (docs/LANGUAGE_VARIANTS.md): the user's workflow on an infinite canvas with a 1080x1920 frame and on a fixed canvas.
//   node scripts/qa/qa-lang.mjs [--out out-lang] [inf] [fixed]
// Draws a common chart, a language layer with RU then EN writing, records, exports name.en.mp4 / name.ru.mp4, probes them with ffprobe,
// extracts frames with ffmpeg into qa-screens/lang/ and checks the pixels: the EN video never shows RU writing and vice versa.
import { launch, newDoc, outDirOf, setBrush, strokeDoc } from './qa-inf-lib.mjs'
import { execFileSync } from 'child_process'
import { mkdirSync, existsSync } from 'fs'
import { resolve } from 'path'

const args = process.argv.slice(2)
const kinds = args.filter((a) => a === 'inf' || a === 'fixed')
const run = kinds.length ? kinds : ['inf', 'fixed']
const dir = resolve('qa-screens/lang')
mkdirSync(dir, { recursive: true })
const slash = (p) => p.replaceAll(String.fromCharCode(92), '/')
let fail = 0
const ok = (c, m) => {
  console.log((c ? 'PASS ' : 'FAIL ') + m)
  if (!c) fail++
}
const probe = (f) => execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,nb_read_frames:format=duration', '-of', 'json', f]).toString()
const grab = (f, t, png) => execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', String(t), '-i', f, '-vframes', '1', png])

const { app, page, errors } = await launch(outDirOf(args))

/** colour counts of the picture: how many pixels are "red-ish" (RU writing) / "blue-ish" (EN writing) / green (common) */
async function colours(lang, rect) {
  return page.evaluate(({ lang, rect }) => {
    const a = window.brushwork_app
    const img = a.compositor.readFlattened(rect, 1, true, lang)
    let red = 0, blue = 0, green = 0
    for (let i = 0; i < img.px.length; i += 4) {
      const r = img.px[i], g = img.px[i + 1], b = img.px[i + 2]
      if (r > 180 && g < 90 && b < 90) red++
      else if (b > 180 && r < 90 && g < 120) blue++
      else if (g > 150 && r < 90 && b < 90) green++
    }
    return { red, blue, green }
  }, { lang, rect })
}

async function scenario(kind) {
  console.log('==== ' + kind)
  const W = kind === 'inf' ? 4096 : 1080
  const H = kind === 'inf' ? 4096 : 1920
  await newDoc(page, kind === 'inf' ? 'infinite' : 'fixed', W, H)
  await page.waitForTimeout(500)
  // the work area: a 1080x1920 frame on the infinite canvas, the whole canvas on the fixed one
  const rect = await page.evaluate((kind) => {
    if (kind === 'inf') window.brushwork_frame.createFrame(1080, 1920)
    const f = kind === 'inf' ? window.brushwork_frame.getFrame() : { x: 0, y: 0, w: 1080, h: 1920 }
    return { x: f.x, y: f.y, w: f.w, h: f.h }
  }, kind)
  await page.waitForTimeout(500)
  const P = (fx, fy) => [rect.x + fx * rect.w, rect.y + fy * rect.h]
  const zoom = 0.45
  const ex = (pts) => pts.map(([a, b]) => P(a, b))
  await page.evaluate(() => (window.brushwork_app.state.settings.size = 18))
  // 1. common chart on the normal layer: a line and "model names" (short bars)
  await setBrush(page, null, 18, 1, '#10a020')
  await strokeDoc(page, ex([[0.1, 0.7], [0.3, 0.5], [0.5, 0.58], [0.7, 0.3], [0.9, 0.2]]), { zoom })
  await strokeDoc(page, ex([[0.1, 0.9], [0.25, 0.9]]), { zoom })
  await strokeDoc(page, ex([[0.4, 0.9], [0.55, 0.9]]), { zoom })
  // 2. language layer, RU writing
  const common = await page.evaluate(() => window.brushwork_app.doc.activeId)
  await page.evaluate(() => window.brushwork_lang.newLayer('Months'))
  await page.waitForTimeout(200)
  await page.evaluate(() => window.brushwork_lang.setView('ru'))
  await setBrush(page, null, 20, 1, '#e01010')
  await strokeDoc(page, ex([[0.1, 0.1], [0.3, 0.1]]), { zoom })
  await strokeDoc(page, ex([[0.1, 0.15], [0.4, 0.15]]), { zoom })
  let cRu = await colours('ru', rect)
  let cEn = await colours('en', rect)
  ok(cRu.red > 500 && cEn.red === 0, kind + ': RU writing is visible in RU only ' + JSON.stringify({ cRu, cEn }))
  // 3. switch to EN: the Russian writing disappears completely
  await page.evaluate(() => window.brushwork_lang.setView('en'))
  await page.waitForTimeout(150)
  const hid = await page.evaluate(({ rect }) => {
    const a = window.brushwork_app
    a.renderNow()
    const img = a.compositor.readFlattened(rect, 1, true)
    let red = 0
    for (let i = 0; i < img.px.length; i += 4) if (img.px[i] > 180 && img.px[i + 1] < 90 && img.px[i + 2] < 90) red++
    return red
  }, { rect })
  ok(hid === 0, kind + ': after switching to EN the RU writing is gone from the canvas (red px = ' + hid + ')')
  // 4. EN writing in the SAME language layer
  await setBrush(page, null, 20, 1, '#1010e0')
  await strokeDoc(page, ex([[0.1, 0.1], [0.5, 0.1]]), { zoom })
  await strokeDoc(page, ex([[0.1, 0.15], [0.3, 0.15]]), { zoom })
  await strokeDoc(page, ex([[0.1, 0.2], [0.45, 0.2]]), { zoom })
  const cells = await page.evaluate(() => {
    const d = window.brushwork_app.doc
    const g = d.langSets()[0]
    return { rows: d.langSets().length, cells: d.cellsOf(g.id).map((c) => c.lang) }
  })
  ok(cells.rows === 1 && cells.cells.sort().join() === 'en,ru', kind + ': one language layer with two cells ' + JSON.stringify(cells))
  // 5. a common stroke after both writings (one frame per variant)
  await setBrush(page, null, 18, 1, '#10a020')
  await page.evaluate((id) => window.brushwork_app.doc.setActive(id), common) // back to the common layer
  await strokeDoc(page, ex([[0.65, 0.9], [0.9, 0.9]]), { zoom })
  await page.waitForTimeout(600)
  cRu = await colours('ru', rect)
  cEn = await colours('en', rect)
  ok(cRu.red > 500 && cRu.blue === 0 && cEn.blue > 500 && cEn.red === 0 && cRu.green > 500 && cEn.green > 500, kind + ': variants differ by their writing only ' + JSON.stringify({ cRu, cEn }))

  // 6. recording: frames are tagged per variant
  const info = await page.evaluate(async () => {
    const rec = window.brushwork_animio.tl.current
    await rec.flush()
    const tags = await rec.tags()
    return { n: tags.length, tags: tags.map((t) => ({ v: t.v ?? '*', g: t.g, t: t.t })), variants: rec.variants }
  })
  const kinds = { all: 0, en: 0, ru: 0, both: 0 }
  for (const t of info.tags) kinds[t.v === '*' ? 'all' : t.v.length > 1 ? 'both' : t.v[0]]++
  console.log('frames', info.n, JSON.stringify(kinds), JSON.stringify(info.tags.map((t) => (t.v === '*' ? '*' : t.v.join('+')) + '#' + t.g + ':' + t.t)))
  ok(info.variants.join() === 'en,ru' && kinds.ru >= 2 && kinds.en >= 3, kind + ': frames recorded per variant ' + JSON.stringify(kinds))

  // 7. export both languages in one pass
  const base = slash(resolve(dir, kind + '-clip.mp4'))
  const res = await page.evaluate(async (base) => {
    const an = window.brushwork_animio
    const rec = an.tl.current
    const out = await an.tle.exportAll(rec, window.brushwork_app.doc, { format: 'h264', res: '1080p', fps: 24, quality: 'standard' }, base)
    return out.map((o) => ({ code: o.code, file: o.file, ok: o.result.ok, err: o.result.error, frames: o.result.plan.frames, w: o.result.width, h: o.result.height }))
  }, base)
  console.log(JSON.stringify(res))
  ok(res.length === 2 && res.every((r) => r.ok), kind + ': both videos exported')
  for (const r of res) {
    ok(existsSync(r.file) && r.file.endsWith('.' + r.code + '.mp4'), kind + ': ' + r.file.split(/[\\/]/).pop())
    if (existsSync(r.file)) {
      const j = JSON.parse(probe(r.file))
      const st = j.streams[0]
      ok(Number(st.nb_read_frames) === r.frames, kind + ': ' + r.code + ' ffprobe frames ' + st.nb_read_frames + ' == plan ' + r.frames + ', ' + st.width + 'x' + st.height + ', ' + j.format.duration + 's')
      // frames at the start / middle / end
      const dur = Number(j.format.duration)
      for (const [name, t] of [['mid', dur * 0.5], ['end', Math.max(0, dur - 0.5)]]) grab(r.file, t.toFixed(2), slash(resolve(dir, `${kind}-${r.code}-${name}.png`)))
    }
  }
  // 8. pixel checks on the LAST frame of each video (decoded by ffmpeg to raw rgb)
  for (const code of ['en', 'ru']) {
    const f = resolve(dir, `${kind}-clip.${code}.mp4`)
    if (!existsSync(f)) continue
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-sseof', '-0.3', '-i', f, '-vframes', '1', '-vf', 'scale=270:480', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 26 })
    let red = 0, blue = 0
    for (let i = 0; i < raw.length; i += 3) {
      const r = raw[i], g = raw[i + 1], b = raw[i + 2]
      if (r > 170 && g < 110 && b < 110) red++
      else if (b > 170 && r < 110 && g < 130) blue++
    }
    console.log(code, 'last frame red/blue', red, blue)
    ok(code === 'en' ? blue > 100 && red === 0 : red > 100 && blue === 0, kind + ': ' + code.toUpperCase() + ' video ends with ONLY its own writing (red ' + red + ', blue ' + blue + ')')
  }
  return rect
}

try {
  for (const k of run) await scenario(k)
} catch (e) {
  console.log('SCRIPT ERROR', e)
  fail++
}
console.log('errors', errors.length ? errors.slice(0, 8) : 'none')
await app.close()
process.exit(fail ? 1 : 0)
