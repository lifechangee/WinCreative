// Cost of recording N language variants per common commit (docs/LANGUAGE_VARIANTS.md > Performance).
//   node scripts/qa/qa-lang-perf.mjs [--out out-lang] [fixed4k] [inf]
// Draws 40 quick strokes on a COMMON layer with (a) no language layer (baseline = 0.3.0 behaviour) and (b) a language layer with writing in
// both languages, and reports: main-thread ms spent issuing each capture, rAF frame times while drawing (count > 33 ms), frames and bytes stored.
import { launch, newDoc, outDirOf, setBrush, strokeDoc, stats } from './qa-inf-lib.mjs'

const args = process.argv.slice(2)
const kinds = args.filter((a) => a === 'fixed4k' || a === 'inf' || a === 'infview')
const run = kinds.length ? kinds : ['fixed4k', 'inf']
const { app, page, errors } = await launch(outDirOf(args))
let fail = 0
const ok = (c, m) => {
  console.log((c ? 'PASS ' : 'FAIL ') + m)
  if (!c) fail++
}

async function measure(kind, withLang) {
  const isInf = kind === 'inf' || kind === 'infview'
  const W = isInf ? 4096 : 3840
  const H = isInf ? 4096 : 2160
  await newDoc(page, isInf ? 'infinite' : 'fixed', W, H)
  await page.waitForTimeout(600)
  const rect = await page.evaluate((kind) => {
    if (kind === 'infview') return { x: -540, y: -960, w: 1080, h: 1920 } // frameless infinite canvas: the screen is recorded
    if (kind === 'inf') {
      window.brushwork_frame.createFrame(1080, 1920)
      const f = window.brushwork_frame.getFrame()
      return { x: f.x, y: f.y, w: f.w, h: f.h }
    }
    return { x: 0, y: 0, w: 3840, h: 2160 }
  }, kind)
  await page.waitForTimeout(500)
  const zoom = isInf ? 0.45 : 0.3
  const P = (fx, fy) => [rect.x + fx * rect.w, rect.y + fy * rect.h]
  await setBrush(page, null, 30, 1, '#10a020')
  // a few layers of busy common artwork so a compose is not trivial
  await page.evaluate(() => {
    const d = window.brushwork_app.doc
    for (let i = 0; i < 8; i++) d.addLayer()
  })
  const common = await page.evaluate(() => window.brushwork_app.doc.activeId)
  if (withLang) {
    await page.evaluate(() => window.brushwork_lang.newLayer('Months'))
    for (const [lang, col] of [['ru', '#e01010'], ['en', '#1010e0']]) {
      await page.evaluate((l) => window.brushwork_lang.setView(l), lang)
      await setBrush(page, null, 24, 1, col)
      for (let i = 0; i < 4; i++) await strokeDoc(page, [P(0.1, 0.1 + i * 0.05), P(0.5, 0.1 + i * 0.05)], { zoom })
    }
    await page.evaluate((id) => window.brushwork_app.doc.setActive(id), common)
  }
  await page.waitForTimeout(800)
  await setBrush(page, null, 30, 1, '#10a020')
  const before = await page.evaluate(async () => {
    const rec = window.brushwork_animio.tl.current
    await rec.flush()
    rec.issueLog.length = 0
    window.__dt = []
    let last = performance.now()
    const tick = (t) => {
      window.__dt.push(t - last)
      last = t
      window.__raf = requestAnimationFrame(tick)
    }
    window.__raf = requestAnimationFrame(tick)
    return { count: rec.count, bytes: rec.bytes }
  })
  for (let i = 0; i < 40; i++) {
    await strokeDoc(page, [P(0.1 + (i % 8) * 0.1, 0.4), P(0.15 + (i % 8) * 0.1, 0.8)], { zoom, steps: 4 })
    await page.waitForTimeout(120)
  }
  await page.waitForTimeout(1500)
  const r = await page.evaluate(async () => {
    cancelAnimationFrame(window.__raf)
    const rec = window.brushwork_animio.tl.current
    await rec.flush()
    return { count: rec.count, bytes: rec.bytes, issue: rec.issueLog.slice(), dt: window.__dt.slice(2) }
  })
  const issue = stats(r.issue)
  const dt = stats(r.dt)
  const over = r.dt.filter((x) => x > 33.5).length
  console.log(`${kind} ${withLang ? 'LANG(2 variants)' : 'baseline       '}: frames +${r.count - before.count}, +${((r.bytes - before.bytes) / 1024).toFixed(0)} KB | issue ms p50 ${issue.p50.toFixed(2)} p95 ${issue.p95.toFixed(2)} max ${issue.max.toFixed(2)} (n=${issue.n}) | rAF dt p50 ${dt.p50.toFixed(1)} p99 ${dt.p99.toFixed(1)} max ${dt.max.toFixed(1)} over33: ${over}/${dt.n}`)
  return { frames: r.count - before.count, bytes: r.bytes - before.bytes, issue, dt, over }
}

try {
  for (const k of run) {
    const a = await measure(k, false)
    const b = await measure(k, true)
    ok(b.frames >= a.frames * 1.6, `${k}: a common commit writes one frame per variant (${b.frames} vs ${a.frames})`)
    ok(b.issue.max < 20, `${k}: capture issue cost max ${b.issue.max.toFixed(1)} ms < 20`)
    ok(b.over <= a.over + 2, `${k}: no extra frames over 33 ms (${b.over} vs baseline ${a.over})`)
    console.log(`${k}: storage growth x${(b.bytes / Math.max(1, a.bytes)).toFixed(2)}`)
  }
} catch (e) {
  console.log('SCRIPT ERROR', e)
  fail++
}
console.log('errors', errors.length ? errors.slice(0, 5) : 'none')
await app.close()
process.exit(fail ? 1 : 0)
