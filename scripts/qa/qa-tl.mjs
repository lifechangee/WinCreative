// Drives the real app: records a session with strokes / undo / redo / branch, saves + reopens, opens the time-lapse editor,
// edits (pauses, segments, fit, finale), exports with ffmpeg and verifies with ffprobe.  node scripts/qa/qa-tl.mjs [outDir] [lang]
import { _electron as electron } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const out = process.argv[2] ?? 'out-tl'
const lang = process.argv[3] ?? 'en'
const shots = 'qa-screens/tl'
fs.mkdirSync(shots, { recursive: true })
const ud = path.join(os.tmpdir(), 'bw-tl-' + Date.now())
const outDir = path.join(ud, 'videos')
fs.mkdirSync(outDir, { recursive: true })
const app = await electron.launch({ args: [`${out}/main/index.js`, '--user-data-dir=' + ud], cwd: process.cwd(), env: { ...process.env, APPDATA: ud, BW_LANG: lang }, timeout: 60000 })
const page = await app.firstWindow()
page.setDefaultTimeout(15000)
const errs = []
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errs.push(m.type() + ': ' + m.text()))
page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message))
await page.waitForTimeout(3000)
await page.setViewportSize({ width: 1280, height: 720 }).catch(() => {})
const shot = async (n) => { await page.waitForTimeout(400); await page.screenshot({ path: path.join(shots, `${lang}-${n}.png`) }) }
let fails = 0
const check = (name, cond, extra = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + ' ' + extra); if (!cond) fails++ }
const sleep = (ms) => page.waitForTimeout(ms)

await page.locator('button', { hasText: /^(Закрыть|Close)$/ }).first().click({ timeout: 2000 }).catch(() => {})
await sleep(400)

// fresh canvas via the app API (keeps the QA independent of dialogs)
await page.evaluate(() => { window.brushwork_app.newDocument(1600, 1000) })
await sleep(1200)
const stroke = async (y, hue) => {
  await page.evaluate((h) => { const a = window.brushwork_app; a.state.setTool('brush'); a.state.setSize(36); a.state.setColor({ h, s: 0.85, v: 0.9 }) }, hue)
  await page.mouse.move(330, y)
  await page.mouse.down()
  for (let i = 0; i <= 30; i++) await page.mouse.move(330 + i * 18, y + Math.sin(i / 4) * 30, { steps: 2 })
  await page.mouse.up()
  await sleep(450)
}
const key = async (k) => { await page.keyboard.press(k); await sleep(450) }
const tags = async () => page.evaluate(async () => { const r = window.brushwork_animio.tl.current; return await r.tags() })
const resolved = async () => page.evaluate(async () => { const r = window.brushwork_animio.tl.current; const x = await window.brushwork_animio.tle.resolve(r); return { kept: x.kept, n: x.n, final: x.keep.finalState, hidden: x.keep.hiddenActions, supported: x.keep.supported, total: x.schedule.total } })

// session: A B (undo B) (redo B) C (undo C) D(branch)  -> shown: A B D ; hidden: C
await stroke(150, 0); await stroke(230, 40)
await key('Control+z'); await key('Control+Shift+z')
await stroke(310, 120)
await key('Control+z')
await stroke(390, 220)
await key('Control+z'); await key('Control+z'); await key('Control+Shift+z') // undo D,B ; redo B -> D gone for good
await stroke(470, 300)
let tg = await tags()
console.log('tags', JSON.stringify(tg.map((x) => `${x.t}:${x.s}`)))
let rs = await resolved()
console.log('resolved', JSON.stringify(rs))
check('frames tagged with states', tg.every((x) => typeof x.s === 'number'))
check('hide-undone drops some frames', rs.kept.length < rs.n, `${rs.kept.length}/${rs.n}`)
check('undone actions counted', rs.hidden >= 2, 'hidden=' + rs.hidden)

// save -> reopen -> continue
const bytes = await page.evaluate(async () => { const b = await window.brushwork_io.saveBwk(); window.__bytes = b; return b.length })
check('bwk saved', bytes > 1000, 'bytes=' + bytes)
await page.evaluate(async () => { const d = await window.brushwork_io.loadBwk(window.__bytes); window.brushwork_app.setDocument(d) })
await sleep(1500)
const t2 = await tags()
check('tags survive reopen', t2.length === tg.length && t2.every((x, i) => x.s === tg[i].s), `${t2.length} vs ${tg.length}`)
await stroke(550, 330); await key('Control+z'); await stroke(620, 160)
tg = await tags()
rs = await resolved()
console.log('after reopen resolved', JSON.stringify(rs), JSON.stringify(tg.slice(-5).map((x) => `${x.t}:${x.s}`)))
check('continues after reopen with new states', tg.length > t2.length && tg[tg.length - 1].s > t2[t2.length - 1].s)

// editor
await page.locator('.tb-left .tb-tab').click()
await sleep(1200)
check('editor opened', (await page.locator('.tle').count()) === 1)
await shot('01-editor')
// painting disabled: a stroke attempt must not change history
const hBefore = await page.evaluate(() => window.brushwork_app.doc.history.pushes)
await page.mouse.move(300, 200); await page.mouse.down(); await page.mouse.move(500, 220, { steps: 5 }); await page.mouse.up()
await page.keyboard.press('b')
const hAfter = await page.evaluate(() => window.brushwork_app.doc.history.pushes)
check('painting disabled in editor', hBefore === hAfter)
// add pause via toolbar, set 2.5 s
await page.locator('.tle-tlbar input.tle-num').fill('2,5')
await page.locator('.tle-tlbar input.tle-num').press('Enter')
await page.locator('.tle-tlbar .tle-btn', { hasText: /Add pause|Добавить паузу/ }).click()
await sleep(300)
// second pause by double-click on the thumbs lane
const box = await page.locator('.tle-scroll').boundingBox()
await page.mouse.dblclick(box.x + box.width * 0.6, box.y + 40)
await sleep(300)
// segment: drag a range in the speed lane then apply x4
await page.mouse.move(box.x + box.width * 0.15, box.y + 24 + 54 + 14)
await page.mouse.down(); await page.mouse.move(box.x + box.width * 0.4, box.y + 24 + 54 + 14, { steps: 8 }); await page.mouse.up()
await sleep(200)
await page.locator('.tle-selform .tle-num').first().fill('4')
await page.locator('.tle-selform .tle-btn.primary').first().click()
await sleep(300)
await shot('02-edited')
const edit1 = await page.evaluate(() => JSON.parse(JSON.stringify(window.brushwork_animio.tl.current.edit)))
console.log('edit', JSON.stringify(edit1))
check('2 pauses', edit1.pauses.length === 2)
check('1 segment x4', edit1.segments.length === 1 && edit1.segments[0].speed === 4)
// drag interactions: move pause 2, grow it with its grip, resize the speed band edge
{
  const getE = () => page.evaluate(() => JSON.parse(JSON.stringify(window.brushwork_animio.tl.current.edit)))
  const e0 = await getE()
  const pill = page.locator('.tle-pause .pill').nth(1)
  let pb = await pill.boundingBox()
  await page.mouse.move(pb.x + 22, pb.y + 13); await page.mouse.down(); await page.mouse.move(pb.x - 60, pb.y + 13, { steps: 8 }); await page.mouse.up()
  const e1 = await getE()
  check('dragging a pause marker moves it', e1.pauses[1].at < e0.pauses[1].at, `${e0.pauses[1].at} -> ${e1.pauses[1].at}`)
  const grip = page.locator('.tle-pause .grip').nth(1)
  const gb = await grip.boundingBox()
  await page.mouse.move(gb.x + 9, gb.y + 13); await page.mouse.down(); await page.mouse.move(gb.x + 9 + 80, gb.y + 13, { steps: 8 }); await page.mouse.up()
  const e2 = await getE()
  check('dragging the grip changes the pause length', e2.pauses.find((p) => p.id === e1.pauses[1].id).seconds > e1.pauses[1].seconds * 1.8, `${e1.pauses[1].seconds} -> ${e2.pauses.find((p) => p.id === e1.pauses[1].id).seconds}`)
  const edge = page.locator('.tle-band .edge.r').first()
  const eb = await edge.boundingBox()
  await page.mouse.move(eb.x + 7, eb.y + 14); await page.mouse.down(); await page.mouse.move(eb.x + 7 - 90, eb.y + 14, { steps: 8 }); await page.mouse.up()
  const e3 = await getE()
  check('dragging a band edge resizes the segment', e3.segments[0].to < e2.segments[0].to, `${e2.segments[0].to} -> ${e3.segments[0].to}`)
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z')
  await sleep(200)
  const e4 = await getE()
  check('each drag was ONE undo step', JSON.stringify(e4.pauses) === JSON.stringify(e0.pauses) && e4.segments[0].to === e0.segments[0].to)
  await page.keyboard.press('Control+Shift+z'); await page.keyboard.press('Control+Shift+z'); await page.keyboard.press('Control+Shift+z')
  await shot('02b-dragged')
}
// fit to 20 s with fade + hold 3
await page.locator('.tle-chip', { hasText: /^(30 s|30 с)$/ }).click()
await sleep(200)
const fin = page.locator('.tle-card', { has: page.locator('h4', { hasText: /Finale|Финал/ }) }).locator('.tle-num')
await fin.nth(0).fill('3'); await fin.nth(0).press('Enter')
await fin.nth(1).fill('1'); await fin.nth(1).press('Enter')
await fin.nth(2).fill('1,5'); await fin.nth(2).press('Enter')
await sleep(300)
await shot('03-fit-finale')
// playback
await page.keyboard.press('Space'); await sleep(1500); await page.keyboard.press('Space')
await shot('04-playing')
// undo/redo inside the editor
await page.keyboard.press('Control+z'); await sleep(200)
const e2 = await page.evaluate(() => window.brushwork_animio.tl.current.edit.finale.fadeOut)
check('editor undo reverts last edit', e2 === 0, 'fadeOut=' + e2)
await page.keyboard.press('Control+Shift+z'); await sleep(200)
const e3 = await page.evaluate(() => window.brushwork_animio.tl.current.edit.finale.fadeOut)
check('editor redo', e3 === 1.5)
// toggle hide undone
await sleep(200)
await shot('05-after')

// export 3 variants + ffprobe
const exportCase = async (name, edit, fps = 30, format = 'h264', res = '1080p') => {
  const file = path.join(outDir, name + (format === 'gif' ? '.gif' : format === 'vp9' ? '.webm' : '.mp4')).split(path.sep).join('/')
  const r = await page.evaluate(async ({ file, edit, fps, format, res }) => {
    const rec = window.brushwork_animio.tl.current
    const saved = JSON.parse(JSON.stringify(rec.edit))
    if (edit) rec.edit = { ...rec.edit, ...edit }
    const x = await window.brushwork_animio.tle.resolve(rec)
    const res2 = await window.brushwork_animio.tle.export(rec, window.brushwork_app.doc, x, { format, res, fps, quality: 'standard' }, file)
    rec.edit = saved
    return { ok: res2.ok, error: res2.error, plan: { frames: res2.plan.frames, duration: res2.plan.duration, indices: res2.plan.indices, repeats: res2.plan.repeats }, total: x.schedule.total, kept: x.kept }
  }, { file, edit, fps, format, res })
  const pr = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,nb_read_frames,r_frame_rate,pix_fmt:format=duration', '-of', 'json', file], { encoding: 'utf8' })
  const j = JSON.parse(pr.stdout || '{}')
  return { file, r, j }
}
const base = await page.evaluate(() => JSON.parse(JSON.stringify(window.brushwork_animio.tl.current.edit)))
const A = await exportCase('edited', null, 30)
const sA = A.j.streams?.[0]
console.log('A', A.r.ok, A.r.error, 'plan', A.r.plan.frames, 'dur', A.r.plan.duration, 'total', A.r.total, 'ffprobe', JSON.stringify(sA), A.j.format?.duration)
check('export ok', A.r.ok, A.r.error)
check('ffprobe frames == plan', Number(sA?.nb_read_frames) === A.r.plan.frames, `${sA?.nb_read_frames} vs ${A.r.plan.frames}`)
check('ffprobe duration within 1 frame of schedule', Math.abs(Number(A.j.format?.duration) - A.r.total) <= 1 / 30 + 0.02, `${A.j.format?.duration} vs ${A.r.total}`)
check('fit 30 s total', Math.abs(A.r.total - 30) < 0.01, 'total=' + A.r.total)
check('cfr 30', sA?.r_frame_rate === '30/1')
// pause repeated frames
const maxRep = Math.max(...A.r.plan.repeats)
check('pause holds are repeated frames', maxRep >= 70, 'maxRepeat=' + maxRep)
// raw (all frames shown) vs hidden
const B = await exportCase('no-hide', { hideUndone: false, fitDuration: null, pauses: [], segments: [], finale: { holdSeconds: 0, fadeIn: 0, fadeOut: 0 } }, 30)
const C = await exportCase('hide', { hideUndone: true, fitDuration: null, pauses: [], segments: [], finale: { holdSeconds: 0, fadeIn: 0, fadeOut: 0 } }, 30)
console.log('B(no hide)', B.r.plan.frames, 'C(hide)', C.r.plan.frames, 'ffprobe', B.j.streams?.[0]?.nb_read_frames, C.j.streams?.[0]?.nb_read_frames)
const raw = (await tags()).length
check('no-hide video has every recorded frame', Number(B.j.streams?.[0]?.nb_read_frames) === raw, `${B.j.streams?.[0]?.nb_read_frames} vs ${raw}`)
check('hidden undone frames are absent', Number(C.j.streams?.[0]?.nb_read_frames) === C.r.kept.length && C.r.kept.length < raw, `${C.j.streams?.[0]?.nb_read_frames} kept=${C.r.kept.length} raw=${raw}`)
const D = await exportCase('gif', { fitDuration: 4, pauses: [], segments: [], finale: { holdSeconds: 0.5, fadeIn: 0, fadeOut: 0 } }, 15, 'gif', '1080p')
check('gif export', D.r.ok, D.r.error)
const E = await exportCase('webm', { fitDuration: 5, pauses: [], segments: [], finale: { holdSeconds: 0.5, fadeIn: 0, fadeOut: 0 } }, 24, 'vp9', '1080p')
check('webm export', E.r.ok, E.r.error)
// extract frames to look at: first (fade-in black), a mid frame, last
for (const [t, n] of [[0, 'f0'], [10, 'f10'], [29.9, 'flast']]) {
  const ff = path.join(process.cwd(), 'node_modules/ffmpeg-static/ffmpeg.exe')
  spawnSync(ff, ['-y', '-v', 'error', '-ss', String(t), '-i', A.file, '-frames:v', '1', path.join(shots, `${lang}-vid-${n}.png`)])
}
// back to drawing
for (let i = 0; i < 3; i++) { await page.keyboard.press('Escape'); await sleep(250) }
check('Esc leaves the editor', (await page.locator('.tle').count()) === 0)
await shot('06-back')
console.log('errors:', errs.filter((e) => !/Autofill|DevTools/.test(e)).slice(0, 8))
console.log(fails ? `FAILED ${fails}` : 'ALL OK')
await app.close()
process.exit(fails ? 1 : 0)
