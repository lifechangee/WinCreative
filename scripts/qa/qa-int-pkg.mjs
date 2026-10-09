// 0.3.0 QA of the process-level behaviour (works on out-integ or, with BW_EXE=<WinCreative.exe>, on the PACKAGED app):
//   scratch folder lifecycle (spill, close, two docs in sequence), single-instance second launch with a .bwk argument (must not wipe the first
//   instance's scratch), foreign OS-clipboard image, kill -9 -> relaunch (stale scratch wiped, document recovered from file + journal).
// usage: [BW_EXE=...] node scripts/qa/qa-int-pkg.mjs [--out out-integ]
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PAGE_HELPERS, launch, outDirOf, reporter, sleep } from './qa-int-lib.mjs'

const args = process.argv.slice(2)
const outDir = outDirOf(args)
const { check, done } = reporter()
const base = mkdtempSync(join(tmpdir(), 'bw-pkg-'))
const ud = join(base, 'user data Папка')
mkdirSync(ud, { recursive: true })
const scratchDir = join(ud, 'scratch')
const gallery = join(base, 'gal')
const HELPERS = `(${PAGE_HELPERS.toString()})()`
const filesIn = (d) => (existsSync(d) ? readdirSync(d, { recursive: true }).length : 0)
const paintMany = (page, n) =>
  page.evaluate((n) => {
    window.__qa.cfg('brush', 'hard-round', 260, 1, '#2060d0')
    for (let i = 0; i < n; i++) window.__qa.stroke('brush', [[(i % 12) * 1500, Math.floor(i / 12) * 1500, 0.7], [(i % 12) * 1500 + 600, Math.floor(i / 12) * 1500 + 300, 0.7]])
  }, n)
/** present frames so the tile clock advances and the budget evicts */
const frames = (page, n = 40) => page.evaluate(async (n) => { for (let i = 0; i < n; i++) { window.brushwork_app.renderNow(); await new Promise((r) => setTimeout(r, 40)) } }, n)
const newInf = (page) => page.evaluate(() => { window.brushwork_app.newDocument(2048, 2048, { kind: 'infinite', background: { color: [1, 1, 1], visible: true } }) })
const tinyBudget = async (page) => {
  await page.evaluate(() => localStorage.setItem('bw.tileMem', JSON.stringify({ gpuMB: 24, cpuMB: 0.2 })))
  await page.reload()
  await page.waitForFunction(() => !!window.brushwork_app && !!window.brushwork_io?.gallery)
  await page.evaluate(HELPERS)
  await sleep(1500)
}

// ---------------------------------------------------------------- 1. lifecycle
const r = await launch(outDir, { ud, gallery, perf: false })
await tinyBudget(r.page)
await newInf(r.page)
await paintMany(r.page, 60)
await frames(r.page)
await sleep(3000) // spills are async
const st = await r.page.evaluate(() => window.brushwork_app.doc.tileStats())
console.log('tile stats (tiny budget):', JSON.stringify(st))
const docId1 = await r.page.evaluate(() => window.brushwork_app.doc.scratchId)
check('scratch: tiles beyond the RAM budget were spilled to userData/scratch/<docId>', st.disk > 0 && filesIn(join(scratchDir, docId1)) > 0, `disk=${st.disk} files=${filesIn(join(scratchDir, docId1))}`)
await newInf(r.page) // closes the first doc, opens a second one in sequence
await sleep(1500)
check('scratch: the folder of the closed document is removed', !existsSync(join(scratchDir, docId1)))
await paintMany(r.page, 50)
await frames(r.page)
await sleep(3000)
const docId2 = await r.page.evaluate(() => window.brushwork_app.doc.scratchId)
check('scratch: second document in sequence has its own folder with files', docId2 !== docId1 && filesIn(join(scratchDir, docId2)) > 0, `files=${filesIn(join(scratchDir, docId2))}`)

// ---------------------------------------------------------------- 2. single-instance second launch with a .bwk argument
const exe = process.env.BW_EXE
const bwkPath = join(base, 'to open.bwk')
{
  // the current document written by the app's own saver is the file argument
  const bytes = await r.page.evaluate(async () => Array.from((await window.brushwork_io.saveBwkEx()).bytes))
  writeFileSync(bwkPath, Buffer.from(bytes))
  const before = filesIn(join(scratchDir, docId2))
  const t0 = Date.now()
  const cmd = exe ?? undefined
  if (cmd) {
    const second = spawnSync(cmd, [`--user-data-dir=${ud}`, bwkPath], { timeout: 30000, env: { ...process.env, BW_NO_WINSTATE: '1' }, encoding: 'utf8' }); 
    const secs = (Date.now() - t0) / 1000
    check('single instance: the second launch exits by itself', second.status === 0 && secs < 25, `status=${second.status} ${secs.toFixed(1)}s`)
    await sleep(2000)
    check("single instance: the second launch did not wipe the first instance's scratch folder", filesIn(join(scratchDir, docId2)) >= Math.min(before, 1), `before=${before} after=${filesIn(join(scratchDir, docId2))}`)
  } else console.log('(second-instance check needs BW_EXE; skipped on out-integ)')
}

// ---------------------------------------------------------------- 3. foreign clipboard image (another application copied a bitmap)
{
  const ps = spawnSync('powershell', ['-NoProfile', '-Command', 'Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=New-Object System.Drawing.Bitmap 24,12; for($x=0;$x -lt 24;$x++){for($y=0;$y -lt 12;$y++){$b.SetPixel($x,$y,[System.Drawing.Color]::FromArgb(200,10,200,30))}}; [System.Windows.Forms.Clipboard]::SetImage($b)'], { encoding: 'utf8' })
  const res = await r.page.evaluate(async () => {
    const png = await window.brushworkClip.readImage()
    if (!png) return { png: 0 }
    const bmp = await createImageBitmap(new Blob([png], { type: 'image/png' }))
    return { png: png.length, w: bmp.width, h: bmp.height }
  })
  check('clipboard: an image copied by another app is readable (24x12)', res.w === 24 && res.h === 12, JSON.stringify(res) + ' ps=' + ps.status)
}

// ---------------------------------------------------------------- 4. kill -9 with a dirty infinite document
await newInf(r.page)
await paintMany(r.page, 40)
await frames(r.page)
await sleep(2500)
await r.page.evaluate(async () => { await window.brushwork_io.gallery().saveDocument(window.brushwork_app.doc) })
await r.page.evaluate(() => { window.__qa.cfg('brush', 'hard-round', 200, 1, '#cc2020'); window.__qa.stroke('brush', [[-5000, -3000, 0.7], [-4200, -2600, 0.7]]) }) // after the save: only the journal has it
await sleep(900) // journal append is async but quick; the 1.8 s autosave has NOT fired yet
const hashBefore = await r.page.evaluate(() => window.__qa.hash())
const itemId = await r.page.evaluate(() => window.brushwork_io.gallery().idOf(window.brushwork_app.doc))
const killedDoc = await r.page.evaluate(() => window.brushwork_app.doc.scratchId)
const pid = r.app.process().pid
const scratchBefore = filesIn(scratchDir)
check('crash setup: the dirty document had scratch files on disk when it was killed', scratchBefore > 0, 'files=' + scratchBefore)
spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)])
await sleep(1500)
console.log(`after kill -9: scratch files left on disk = ${filesIn(scratchDir)} (before kill ${scratchBefore})`)
const r2 = await launch(outDir, { ud, gallery, perf: false })
await sleep(1500)
check('crash: the killed instance scratch folder is wiped at the next start', !existsSync(join(scratchDir, killedDoc)), 'folders now: ' + (existsSync(scratchDir) ? readdirSync(scratchDir).join(',') : '-'))
await r2.page.evaluate(HELPERS)
const opened = await r2.page.evaluate(async (id) => await window.brushwork_io.gallery().open(id), itemId)
await sleep(3000)
const hashAfter = await r2.page.evaluate(() => window.__qa.hash())
const same = JSON.stringify(Object.entries(hashBefore).sort()) === JSON.stringify(Object.entries(hashAfter).sort())
check('crash: the document reopens from the gallery', opened === true)
check('crash: every tile equals the pre-kill state (saved file + journal replay)', same, `tiles before=${Object.keys(hashBefore).length} after=${Object.keys(hashAfter).length}`)
const errs = [...r.errors, ...r2.errors].filter((e) => !/Failed to load resource|net::ERR/.test(e))
check('no console errors in either session', errs.length === 0, errs.slice(0, 3).join(' | '))
await r2.app.close()
process.exit(done())
