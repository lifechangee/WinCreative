// Regression: "[gallery] save failed ... No time-lapse recording <id>" (tl:packInfo / tl:packRange).
// The gallery autosave embeds the time-lapse into the .bwk; the recording must stay valid for every moment a save of its document can run:
// while a reset() (canvas resized / cropped) restarts it, and while its document is retired by a new / opened document.
//   node scripts/qa/qa-tl-packinfo.mjs --out out-merge [--iters 40] [--seed 1]
import { launch, newDoc, outDirOf, setBrush, strokeDoc } from './qa-inf-lib.mjs'

const args = process.argv.slice(2)
const opt = (n, d) => (args.includes(n) ? Number(args[args.indexOf(n) + 1]) : d)
const iters = opt('--iters', 40)
let seed = opt('--seed', 1)
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
const { app, page, errors } = await launch(outDirOf(args))
let fail = 0
const ok = (c, m) => {
  console.log((c ? 'PASS ' : 'FAIL ') + m)
  if (!c) fail++
}
const logs = []
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && logs.push(m.text()))
await page.evaluate(() => { const g = window.brushwork_io.gallery(); g.delayMs = 120 }) // autosave almost immediately after each stroke
if (args.includes('--trace'))
  await page.evaluate(() => {
    window.brushwork_animio.tl.events.on('recorder', (r) => {
      const d = r.dispose.bind(r)
      r.dispose = () => {
        console.error('TRACE dispose ' + r.id + ' docDisposed=' + r.doc.disposed + ' isCurrent=' + (window.brushwork_app.doc === r.doc) + ' ' + new Error().stack.split(String.fromCharCode(10)).slice(2, 6).join(' | '))
        d()
      }
    })
  })
let strokes = 0, resets = 0, news = 0
try {
  for (let i = 0; i < iters; i++) {
    if (i % 5 === 0) {
      await newDoc(page, rnd() < 0.5 ? 'infinite' : 'fixed', 1024, 1024)
      news++
    }
    await setBrush(page, null, 14, 1, '#d02020')
    const n = 1 + Math.floor(rnd() * 3)
    for (let k = 0; k < n; k++) {
      const y = -300 + rnd() * 600
      await strokeDoc(page, [[-300, y], [0, y + 80], [300, y]], { steps: 2 })
      strokes++
    }
    const op = rnd()
    if (op < 0.3 && !args.includes('--noreset')) {
      // the canvas is resized / cropped while an autosave of this very document may be running
      await page.evaluate(() => { void window.brushwork_animio.tl.current.reset() })
      resets++
    } else if (op < 0.45) {
      // open another saved artwork while the autosave of this one is pending / running (the drawing continues on whatever is current)
      await page.evaluate(() => {
        const g = window.brushwork_io.gallery()
        const cur = g.idOf(window.brushwork_app.doc)
        const others = g.live().filter((x) => x.id !== cur)
        if (others.length) void g.open(others[Math.floor(Math.random() * others.length)].id)
      })
      news++
    } else if (op < 0.6) {
      await page.evaluate(() => { const a = window.brushwork_app; a.newDocument(1024, 1024, { background: { color: [1, 1, 1], visible: true } }) })
      news++
    }
    await page.waitForTimeout(Math.floor(rnd() * 250))
  }
  // deterministic overlap: a save of the document and a reset() of its recording started in the same task, with random head starts
  await newDoc(page, 'fixed', 1024, 1024)
  for (let k = 0; k < (args.includes('--noreset') ? 0 : 30); k++) {
    await strokeDoc(page, [[-300, -100 + k * 5], [0, 40], [300, -100]], { steps: 2 })
    strokes++
    await page.evaluate(async (d) => {
      const g = window.brushwork_io.gallery()
      const rec = window.brushwork_animio.tl.current
      g.touchDoc(window.brushwork_app.doc)
      const save = g.flush()
      await new Promise((r) => setTimeout(r, d))
      const rs = rec.reset()
      await Promise.allSettled([save, rs])
    }, Math.floor(rnd() * 12))
    resets++
  }
  await page.waitForTimeout(1500)
  await page.evaluate(() => window.brushwork_io.gallery().flush())
} catch (e) {
  console.log('SCRIPT ERROR', e)
  fail++
}
const bad = logs.filter((l) => /save failed|save job crashed|No time-lapse recording|packInfo|packRange/.test(l))
console.log(`   ${strokes} strokes, ${resets} resets, ${news} new documents`)
const ids = new Set(bad.map((b) => (b.match(/recording (\w+)/) ?? [])[1]))
for (const b of logs.filter((l) => /TRACE/.test(l) && [...ids].some((i) => l.includes(i))).slice(-12)) console.log('   ' + b.slice(0, 500))
for (const b of bad.slice(0, 5)) console.log('   LOG ' + b.slice(0, 300))
ok(bad.length === 0, `no gallery save failure / missing time-lapse recording (${bad.length})`)
ok(errors.length === 0, `no page errors (${errors.length}) ${errors[0] ?? ''}`)
await app.close()
process.exit(fail ? 1 : 0)
