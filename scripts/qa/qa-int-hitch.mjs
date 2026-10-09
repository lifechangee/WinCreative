// 0.3.0 QA: frame gaps during the FIRST background (auto)save of a big infinite document in a session.
// usage: node scripts/qa/qa-int-hitch.mjs [--out out-integ] [--rows 4] [--prof]
import { launch, outDirOf, reporter, sleep, stats } from './qa-int-lib.mjs'
const args = process.argv.slice(2)
const outDir = outDirOf(args)
const rows = +(args.includes('--rows') ? args[args.indexOf('--rows') + 1] : 40)
const { check, done } = reporter()
const { app, page, errors } = await launch(outDir)
await page.evaluate(() => { const a = window.brushwork_app; a.newDocument(2048, 2048, { kind: 'infinite', background: { color: [1, 1, 1], visible: true } }); a.setView({ cx: 0, cy: 0, zoom: 0.1, rot: 0 }) })
await page.evaluate(() => { window.brushwork_io.gallery().delayMs = 9000 }) // keep the autosave away while the crash journal drains the painting phase
await page.evaluate((rows) => {
  window.__qa.cfg('brush', 'hard-round', 220, 1, '#2060d0')
  for (let j = 0; j < rows; j++) for (let i = 0; i < 15; i++) window.__qa.stroke('brush', [[i * 1300, j * 1300, 0.7], [i * 1300 + 700, j * 1300 + 500, 0.7], [i * 1300 + 300, j * 1300 + 900, 0.7]])
}, rows)
console.log('tiles', JSON.stringify(await page.evaluate(() => window.brushwork_app.doc.tileStats())))
const cdp = await page.context().newCDPSession(page)
if (args.includes('--prof')) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 300 }); await cdp.send('Profiler.start') }
await sleep(4000)
await page.evaluate(() => window.__qa.startFm())
await sleep(9000) // the debounced autosave (9 s after the last commit here) is the FIRST background save of the session
await page.evaluate(async () => { await window.brushwork_io.gallery().idle() })
const gaps = await page.evaluate(() => window.__qa.stopFm())
const big = await page.evaluate(() => window.__qa.fm.big ?? [])
if (args.includes('--prof')) {
  const { profile } = await cdp.send('Profiler.stop')
  const byId = new Map(profile.nodes.map((n) => [n.id, n]))
  const parent = new Map()
  profile.nodes.forEach((n) => (n.children ?? []).forEach((c) => parent.set(c, n.id)))
  let run = [], ms = 0, t = 0
  profile.samples.forEach((id, i) => {
    const n = byId.get(id), d = (profile.timeDeltas[i] ?? 0) / 1000
    t += d
    if (n.callFrame.functionName === '(idle)') {
      if (ms > 25) { const c = {}; run.forEach((r) => (c[r] = (c[r] ?? 0) + 1)); console.log('busy run', ms.toFixed(0), 'ms ending @', t.toFixed(0), JSON.stringify(Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 5))) }
      run = []; ms = 0
    } else {
      ms += d
      const chain = []; let q = id
      for (let k = 0; k < 4 && q; k++) { const nn = byId.get(q); chain.push(nn.callFrame.functionName + ':' + nn.callFrame.lineNumber); q = parent.get(q) }
      run.push(chain.join('<'))
    }
  })
}
const g = stats(gaps.slice(5))
console.log('big gaps [startMs, len]', JSON.stringify(big), 'frame gaps', JSON.stringify(g))
const over = gaps.slice(5).filter((x) => x > 34).length
check('first background save: p99 frame gap <= 34 ms and at most 5 gaps above 34 ms (single-frame misses allowed)', g.p99 <= 34 && over <= 5, 'max=' + g.max.toFixed(0) + ' over34=' + over)
check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
await app.close()
process.exit(done())
