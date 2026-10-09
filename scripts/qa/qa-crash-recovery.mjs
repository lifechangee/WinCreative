// Renderer crash / GPU reset recovery (Playwright + real Electron). Paints on a fixed canvas, lets the autosave write it, paints a second stroke that only the
// crash journal covers, then (1) kills the renderer process and (2) forces a WebGL context loss. After each: the window must reload by itself, reopen the SAME
// artwork with both strokes, show the translated notice, and the local diagnostics log must record the event. Also checks the crashDumps folder exists.
// usage: node scripts/qa/qa-crash-recovery.mjs [--out out-crash]
import { launch, outDirOf, reporter, sleep } from './qa-int-lib.mjs'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.on('uncaughtException', (e) => { if (!/Target crashed/.test(String(e))) { console.log('FATAL', e); process.exit(3) } }) // Playwright asserts on the first CDP message after the target died
const outDir = outDirOf(process.argv.slice(2))
const { check, done } = reporter()
const diagLog = join(mkdtempSync(join(tmpdir(), 'bw-rec-')), 'diag.log')
// perf:false -> no BW_PERF_TEST (it would skip reopening the last artwork); BW_RECOVERY_TEST keeps the single-instance lock off and the language English
const { app, page: page0 } = await launch(outDir, { perf: false, env: { BW_RECOVERY_TEST: '1', BW_CRASH_RECOVERY: '1', BW_DIAG_LOG: diagLog } })
let page = page0

// after a renderer death Playwright's page handle is unusable: everything goes through the main process (webContents.executeJavaScript)
const rx = (code) => app.evaluate(({ BrowserWindow }, c) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(c), code)
const ready = async () => {
  for (let i = 0; i < 120; i++) {
    try {
      if (await rx('!!window.brushwork_app && !!window.brushwork_io?.gallery && !window.__qa')) break
    } catch {
      /* page still reloading */
    }
    await sleep(500)
  }
  await sleep(3500) // the gallery reopens the last artwork asynchronously
}
const strokeA = [[300, 300, 0.7], [700, 500, 0.7], [1100, 300, 0.7]]
const strokeB = [[300, 900, 0.7], [800, 1100, 0.7], [1300, 900, 0.7]]
const paint = (pts, hex) => page.evaluate(([p, c]) => { window.__qa.cfg('brush', 'hard-round', 120, 1, c); window.__qa.stroke('brush', p) }, [pts, hex])
const SIG = `(() => {
  const px = window.brushwork_app.compositor.readFlattened(true)
  let n = 0
  for (let i = 0; i < px.length; i += 4) if (px[i] !== 255 || px[i + 1] !== 255 || px[i + 2] !== 255) n++
  return { h: n, name: window.brushwork_app.doc.name, w: window.brushwork_app.doc.width }
})()`
const sig = () => rx(SIG)
const notice = () => rx('document.body.innerText')

await page.evaluate(() => window.brushwork_app.newDocument(2000, 1500))
await paint(strokeA, '#d03030')
await page.evaluate(async () => { await window.brushwork_io.gallery().flush() })
await paint(strokeB, '#2050d0')
await sleep(1200) // journal append of stroke B (the autosave debounce has not fired yet)
const before = await sig()
console.log('before crash', JSON.stringify(before))

for (const kind of ['renderer crash', 'GL context loss']) {
  if (kind === 'renderer crash') await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer())
  else await rx(`window.brushwork_app.gpu.gl.getExtension('WEBGL_lose_context').loseContext()`)
  await sleep(1500)
  await ready()
  const after = await sig()
  console.log(kind, '-> after', JSON.stringify(after))
  check(`${kind}: the window reloaded and reopened the same artwork`, after.name === before.name && after.w === before.w, JSON.stringify(after))
  check(`${kind}: painted pixel count (autosaved stroke + journal-replayed stroke) matches (edge rounding of journal patches < 0.5 %)`, Math.abs(after.h - before.h) < before.h * 0.005 && after.h > 1000, `${after.h} vs ${before.h}`)
  const want = kind === 'renderer crash' ? 'recovered from an unexpected problem' : 'graphics driver reset'
  let text = await notice()
  for (let i = 0; i < 20 && !text.includes(want); i++) (await sleep(500), (text = await notice()))
  check(`${kind}: translated recovery notice shown`, text.includes(want), want)
  await rx('window.brushwork_io.gallery().flush()')
  before.h = (await sig()).h
}

const log = existsSync(diagLog) ? readFileSync(diagLog, 'utf8') : ''
check('diagnostics log records render-process-gone with reason and exit code', /render-process-gone reason=crashed exitCode=-?\d+/.test(log), log.split('\n').filter((l) => /gone|webgl/.test(l)).join(' | ').slice(0, 300))
check('diagnostics log records the WebGL context loss', /webglcontextlost/.test(log))
const dumps = await app.evaluate(({ app: a }) => a.getPath('crashDumps'))
check('crashDumps folder is local (upload disabled) and exists', !!dumps && existsSync(dumps), String(dumps))
await app.close()
process.exit(done())
