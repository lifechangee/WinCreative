// kill -9 recovery of a document with language layers (independent QA): cells, view language, language list, per-variant edit models and the
// recording survive an abrupt termination (autosave + crash journal) and a relaunch that reopens the last artwork.
//   node scripts/qa/qa-langqa-kill.mjs --out out-langqa [inf]
import { launch, outDirOf, sleep } from './qa-int-lib.mjs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

const args = process.argv.slice(2)
const infinite = args.includes('inf')
const outDir = outDirOf(args)
let fail = 0
const ok = (c, m) => {
  console.log((c ? 'PASS ' : 'FAIL ') + m)
  if (!c) fail++
}
const tmp = mkdtempSync(join(tmpdir(), 'bw-kill-'))
const ud = join(tmp, 'ud')
const gallery = join(tmp, 'gallery')
const env = { BW_RECOVERY_TEST: '1' }
const SIG = `(() => {
  const a = window.brushwork_app, d = a.doc
  const rect = d.isInfinite ? window.brushwork_frame.getFrame() : { x: 0, y: 0, w: d.width, h: d.height }
  const cnt = (lang) => { const img = a.compositor.readFlattened({ x: rect.x, y: rect.y, w: rect.w, h: rect.h }, 1, true, lang); let red = 0, blue = 0; for (let i = 0; i < img.px.length; i += 4) { const r = img.px[i], g = img.px[i + 1], b = img.px[i + 2]; if (r > 180 && g < 90 && b < 90) red++; else if (b > 180 && r < 90 && g < 120) blue++ } return { red, blue } }
  const rec = window.brushwork_animio.tl.current
  return { name: d.name, langs: d.langs.map((l) => l.code).join(), view: d.viewLang, sets: d.langSets().length, cells: d.langSets().length ? d.cellsOf(d.langSets()[0].id).map((c) => c.lang).sort().join() : '', ru: cnt('ru'), en: cnt('en'), frames: rec?.count ?? -1, fitRu: rec?.editFor('ru')?.fitDuration ?? null, fitEn: rec?.editFor('en')?.fitDuration ?? null, variants: rec?.variants.join() }
})()`

// ------------------------------------------------------------ session 1
const l1 = await launch(outDir, { perf: false, ud, gallery, env })
const { app, page } = l1
const stroke = (pts, hex, size = 40) => page.evaluate(([p, c, s]) => { window.__qa.cfg('brush', 'hard-round', s, 1, c); window.__qa.stroke('brush', p) }, [pts, hex, size])
await page.evaluate((inf) => {
  window.brushwork_app.newDocument(1080, 1920, inf ? { kind: 'infinite', background: { color: [1, 1, 1], visible: true } } : { background: { color: [1, 1, 1], visible: true } })
  if (inf) window.brushwork_frame.createFrame(1080, 1920)
}, infinite)
await sleep(600)
const o = infinite ? await page.evaluate(() => { const f = window.brushwork_frame.getFrame(); return { x: f.x, y: f.y } }) : { x: 0, y: 0 }
const L = (x, y) => [o.x + x, o.y + y, 0.7]
await stroke([L(100, 1700), L(500, 1500), L(900, 1700)], '#10a020')
await page.evaluate(() => window.brushwork_lang.newLayer('Months'))
await page.evaluate(() => window.brushwork_lang.setView('ru'))
await stroke([L(100, 200), L(600, 200)], '#e01010')
await stroke([L(100, 300), L(700, 300)], '#e01010')
await page.evaluate(() => window.brushwork_lang.setView('en'))
await stroke([L(100, 200), L(400, 200)], '#1010e0')
await page.evaluate(() => {
  const rec = window.brushwork_animio.tl.current
  rec.setEditFor('ru', { ...rec.editFor('ru'), fitDuration: 40 })
  rec.setEditFor('en', { ...rec.editFor('en'), fitDuration: 30 })
  window.brushwork_lang.setView('ru')
})
await sleep(800)
await page.evaluate(async () => { await window.brushwork_animio.tl.current.flush(); await window.brushwork_io.gallery().flush() })
// one more RU stroke that only the crash journal covers
await stroke([L(100, 400), L(800, 400)], '#e01010')
await sleep(1500)
const before = await page.evaluate(SIG)
console.log('before kill', JSON.stringify(before))
const pid = app.process().pid
try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch { /* already gone */ }
await sleep(2500)

// ------------------------------------------------------------ session 2
const l2 = await launch(outDir, { perf: false, ud, gallery, env })
await sleep(4000) // the gallery reopens the last artwork asynchronously
const after = await l2.page.evaluate(SIG)
console.log('after relaunch', JSON.stringify(after))
ok(after.name === before.name && after.sets === 1, 'the same artwork reopened with its language layer')
ok(after.langs === before.langs && after.view === 'ru', `language list and view language restored (${after.langs}, view ${after.view})`)
ok(after.cells === 'en,ru', `both cells restored (${after.cells})`)
ok(Math.abs(after.ru.red - before.ru.red) < before.ru.red * 0.01 + 50 && after.en.blue > 500 && after.en.red === 0 && after.ru.blue === 0, `pixels of each language restored incl. the journal-only stroke (RU red ${before.ru.red} -> ${after.ru.red}, EN blue ${after.en.blue})`)
ok(after.variants === 'en,ru' && after.frames >= before.frames - 1, `recording restored with variants (${after.frames} vs ${before.frames} frames)`)
ok(after.fitRu === 40 && after.fitEn === 30, `per-variant edit models restored (RU ${after.fitRu} s, EN ${after.fitEn} s)`)
console.log('errors', l2.errors.length ? l2.errors.slice(0, 5) : 'none')
await l2.app.close()
process.exit(fail ? 1 : 0)
