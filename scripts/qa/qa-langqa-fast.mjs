// Recording correctness under speed + storage growth for 2 / 3 / 4 languages (independent QA).
//   node scripts/qa/qa-langqa-fast.mjs --out out-langqa [inf|fixed] [view] [plain] [frame] [tilt] [occluded]
//   frame    : a fixed canvas WITH a frame (inf always has one unless `view`)
//   tilt     : the screen is rotated + mirrored (frameless infinite canvas records what the screen shows)
//   occluded : requestAnimationFrame never fires (hidden / minimised window): the recorder's 250 ms fallback must still produce frames that show
//              exactly the state they are tagged with (App.syncComposite); the reference is taken AFTER the recorder flushed
// Strokes alternate between a common layer and the language cells FASTER than the capture interval (150 ms). Every recorded frame is tagged with
// the history state it claims to show; its pixels must equal the reference (synchronous composite of that state, per language).
import { launch, newDoc, outDirOf, setBrush, stats } from './qa-inf-lib.mjs'

const args = process.argv.slice(2)
const kind = args.includes('fixed') ? 'fixed' : 'infinite'
const noFrame = args.includes('view') // frameless infinite canvas (the screen is recorded)
const tilt = args.includes('tilt')
const occluded = args.includes('occluded')
const nosync = args.includes('nosync') // sensitivity check: the recorder's own syncComposite is disabled (the old 0.4.0 behaviour); the test MUST then fail
const fframe = args.includes('frame') && kind === 'fixed'
const plain = args.includes('plain') // no language layer at all: the 0.3.0 behaviour (frame capture exactness of the shared GPU path)
const { app, page, errors } = await launch(outDirOf(args))
let fail = 0
const ok = (c, m) => {
  console.log((c ? 'PASS ' : 'FAIL ') + m)
  if (!c) fail++
}
const ev = (fn, arg) => page.evaluate(fn, arg)

async function session(nLangs) {
  await newDoc(page, kind, kind === 'infinite' ? 4096 : 1080, kind === 'infinite' ? 4096 : 1920)
  await page.waitForTimeout(500)
  const rect = await ev(({ kind, noFrame, fframe }) => {
    if (kind === 'infinite' && !noFrame) window.brushwork_frame.createFrame(1080, 1920)
    if (fframe) window.brushwork_frame.createFrame(800, 1400)
    const f = kind === 'infinite' ? (noFrame ? { x: -540, y: -960, w: 1080, h: 1920 } : window.brushwork_frame.getFrame()) : fframe ? window.brushwork_frame.getFrame() : { x: 0, y: 0, w: 1080, h: 1920 }
    return { x: f.x, y: f.y, w: f.w, h: f.h }
  }, { kind, noFrame, fframe })
  const codes = ['en', 'ru', 'de', 'fr'].slice(0, nLangs)
  const COL = { en: '#1010e0', ru: '#e01010', de: '#e0a010', fr: '#a010e0' }
  if (!plain)
    await ev(({ codes }) => {
      const d = window.brushwork_app.doc
      d.editLangs([{ code: 'en', name: 'English' }, { code: 'ru', name: 'Russian' }, { code: 'de', name: 'Deutsch' }, { code: 'fr', name: 'Francais' }].slice(0, codes.length))
    }, { codes })
  const common = await ev(() => window.brushwork_app.doc.activeId)
  if (!plain) await ev(() => window.brushwork_lang.newLayer('Months'))
  const row = plain ? null : await ev(() => window.brushwork_app.doc.langSets()[0].id)
  await ev(({ rect, tilt }) => window.brushwork_app.setView({ cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2, zoom: 0.45, rot: tilt ? 0.25 : 0, ...(tilt ? { mirror: true } : {}) }), { rect, tilt })
  await page.waitForTimeout(300)
  const r = await ev(() => { const b = window.brushwork_app.canvas.getBoundingClientRect(); return { l: b.left, t: b.top, w: b.width, h: b.height } })
  // client position of a point given as a fraction of `rect` (through the real view transform: rotation / mirror included)
  const view = await ev(() => window.brushwork_app.view)
  const S = (fx, fy) => {
    const dx = rect.x + fx * rect.w - view.cx, dy = rect.y + fy * rect.h - view.cy
    const c = Math.cos(view.rot), sn = Math.sin(view.rot)
    return [r.l + r.w / 2 + (view.mirror ? -1 : 1) * view.zoom * (c * dx - sn * dy), r.t + r.h / 2 + view.zoom * (sn * dx + c * dy)]
  }
  // reference region: the whole stroke area (frameless: the strokes lie inside the visible part of the screen); sizes are compared as document areas
  const refRect = noFrame ? { x: rect.x - 60, y: rect.y - 60, w: rect.w + 120, h: rect.h + 120 } : rect
  const frameArea = noFrame ? (r.w * r.h) / (view.zoom * view.zoom) : rect.w * rect.h
  const count = (lang) =>
    ev(({ lang, rect }) => {
      const img = window.brushwork_app.compositor.readFlattened(rect, 0.5, true, lang)
      const c = { red: 0, blue: 0, green: 0, amber: 0, purple: 0, n: img.w * img.h, area: rect.w * rect.h }
      for (let i = 0; i < img.px.length; i += 4) {
        const R = img.px[i], G = img.px[i + 1], B = img.px[i + 2]
        if (R > 170 && G < 100 && B < 100) c.red++
        else if (B > 170 && R < 100 && G < 130) c.blue++
        else if (G > 130 && R < 100 && B < 100) c.green++
        else if (R > 170 && G > 120 && G < 200 && B < 90) c.amber++
        else if (R > 110 && R < 210 && B > 140 && G < 70) c.purple++
      }
      return c
    }, { lang, rect: refRect })
  if (occluded) await ev((nosync) => { window.__raf = window.requestAnimationFrame; window.requestAnimationFrame = () => 1; if (nosync) { const app = window.brushwork_app; window.__sync = app.syncComposite.bind(app); app.syncComposite = () => {} } }, nosync)
  const refs = new Map() // state id -> {lang: counts}
  const before = await ev(async () => { const rec = window.brushwork_animio.tl.current; await rec.flush(); return { count: rec.count, bytes: rec.bytes } })
  // 36 quick strokes, round robin: common, then each language, no waiting between them
  const total = 12 * (nLangs + 1)
  const t0 = Date.now()
  for (let i = 0; i < total; i++) {
    const which = plain ? 0 : i % (nLangs + 1) // 0 = common, 1.. = language
    const lang = which ? codes[which - 1] : null
    if (lang) {
      await ev(({ lang, row }) => { const d = window.brushwork_app.doc; d.setViewLang(lang); d.setActive(row) }, { lang, row })
      await setBrush(page, null, 18, 1, COL[lang])
    } else {
      await ev((c) => window.brushwork_app.doc.setActive(c), common)
      await setBrush(page, null, 18, 1, plain ? ['#10a020', '#e01010', '#1010e0'][i % 3] : '#10a020')
    }
    const fy = 0.04 + (i / total) * 0.9
    const [x0, y0] = S(0.1 + (which / 10), fy)
    const [x1, y1] = S(0.4 + (which / 10), fy + 0.01)
    await page.mouse.move(x0, y0)
    await page.mouse.down()
    await page.mouse.move(x1, y1, { steps: 3 })
    await page.mouse.up()
    // the state this stroke produced + the reference composites of every language NOW (synchronous)
    // (the screen compositor of an infinite canvas rebuilds its dirty tiles in the next animation frame: let it, like the recorder does)
    let s
    if (occluded) {
      // the recorder captures with the rAF-less fallback; only then the reference is taken (syncComposite = the compositor of NOW)
      s = await ev(async () => { await window.brushwork_animio.tl.current.flush(); (window.__sync ?? (() => window.brushwork_app.syncComposite()))(); return window.brushwork_animio.tl.current.tracker.curr })
    } else s = await ev(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res(window.brushwork_animio.tl.current.tracker.curr)))))
    const m = {}
    for (const c of plain ? ['*'] : codes) m[c] = await count(c === '*' ? undefined : c)
    refs.set(s, m)
  }
  const drawMs = Date.now() - t0
  if (occluded) await ev(() => { window.requestAnimationFrame = window.__raf; window.brushwork_app.raf = 0; window.brushwork_app.requestRender() })
  await page.waitForTimeout(2500)
  const res = await ev(async () => {
    const rec = window.brushwork_animio.tl.current
    await rec.flush()
    const tags = await rec.tags()
    const frames = []
    for (let i = 0; i < tags.length; i++) {
      if (tags[i].t === 'live' || tags[i].t === 'init') continue
      const bmp = await createImageBitmap(new Blob([await rec.frame(i)], { type: 'image/jpeg' }))
      const cv = new OffscreenCanvas(bmp.width, bmp.height)
      const cx = cv.getContext('2d', { willReadFrequently: true })
      cx.drawImage(bmp, 0, 0)
      const d = cx.getImageData(0, 0, bmp.width, bmp.height).data
      const c = { red: 0, blue: 0, green: 0, amber: 0, purple: 0, n: bmp.width * bmp.height }
      for (let k = 0; k < d.length; k += 4) {
        const R = d[k], G = d[k + 1], B = d[k + 2]
        if (R > 170 && G < 110 && B < 110) c.red++
        else if (B > 170 && R < 110 && G < 140) c.blue++
        else if (G > 130 && R < 110 && B < 110) c.green++
        else if (R > 170 && G > 120 && G < 210 && B < 100) c.amber++
        else if (R > 110 && R < 210 && B > 140 && G < 80) c.purple++
      }
      frames.push({ i, tag: tags[i], c })
    }
    return { n: tags.length, count: rec.count, bytes: rec.bytes, frames }
  })
  // compare
  const key = { en: 'blue', ru: 'red', de: 'amber', fr: 'purple' }
  let checked = 0, bad = 0
  const worst = []
  for (const f of res.frames) {
    const m = refs.get(f.tag.s)
    if (!m) continue // a frame of an intermediate state (coalesced): no reference
    const langs = plain ? ['*'] : (f.tag.v ?? codes)
    for (const lang of langs) {
      const ref = m[lang]
      if (!ref) continue
      checked++
      for (const col of ['red', 'blue', 'green', 'amber', 'purple']) {
        const a = (f.c[col] / f.c.n) * frameArea // document area (px^2) the colour covers in the frame
        const b = (ref[col] / ref.n) * ref.area
        if (Math.abs(a - b) > 0.0006 * frameArea + 0.18 * b) {
          bad++
          if (worst.length < 4) worst.push(`frame ${f.i} s=${f.tag.s} v=${lang} ${col}: frame ${a.toFixed(0)} vs ref ${b.toFixed(0)} (px^2)`)
          break
        }
      }
    }
  }
  console.log(`   ${nLangs} languages: ${total} strokes in ${drawMs} ms (${(drawMs / total).toFixed(0)} ms each), frames +${res.count - before.count}, bytes +${((res.bytes - before.bytes) / 1024).toFixed(0)} KB, checked ${checked} (frame x variant) against references`)
  for (const w of worst) console.log('   MISMATCH ' + w)
  ok(checked > total * 0.4 && bad === 0, `${kind} ${nLangs} languages: every recorded frame shows exactly the state it claims [${[kind, noFrame ? 'view' : '', fframe ? 'frame' : '', tilt ? 'tilt' : '', occluded ? 'occluded' : ''].filter(Boolean).join('+')}] (${bad} mismatches of ${checked})`)
  if (plain && noFrame) {
    // plain frameless infinite document: the capture is issued on the GPU (asynchronous read-back), not through the 2D canvas (~30 ms per capture)
    const med = await ev(() => { const l = [...window.brushwork_animio.tl.current.issueLog].sort((a, b) => a - b); return l[l.length >> 1] ?? 0 })
    ok(med < 8, `plain frameless infinite capture is issued on the GPU (median ${med.toFixed(1)} ms on the main thread)`)
  }
  return { frames: res.count - before.count, bytes: res.bytes - before.bytes, total }
}

const out = {}
try {
  for (const n of plain ? [0] : [2, 3, 4]) out[n] = await session(n)
  for (const n of plain ? [] : [2, 3, 4]) console.log(`   ${n} languages: ${(out[n].frames / out[n].total).toFixed(2)} frames / stroke, ${(out[n].bytes / out[n].total / 1024).toFixed(1)} KB / stroke`)
} catch (e) {
  console.log('SCRIPT ERROR', e)
  fail++
}
console.log('errors', errors.length ? errors.slice(0, 5) : 'none')
await app.close()
process.exit(fail ? 1 : 0)
