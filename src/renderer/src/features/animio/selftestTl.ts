import { loadBwk, saveBwk } from '../../io/bwk'
import { animioApi } from './api'
import { getRecorder } from './timelapse'
import { closeTimelapseEditor, isTimelapseEditorOpen, openTimelapseEditor } from './tlEditor'
import { exportTimelapse, resolveRecorder } from './tlExport'
import { addPause, applySegment, buildSchedule, outputPlan } from './tlModel'
import type { TestCtx } from './selftest'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** `timelapse-editor` checks: history tagging, hide-undone, edit persistence, editor mode, export == schedule (ffprobe). */
export async function runTimelapseEditorTests(t: TestCtx): Promise<void> {
  const { app, out, log, check, stroke } = t
  const sep = out.includes('\\') ? '\\' : '/'
  const path = (f: string): string => out + sep + f
  const ui = (window as any).brushwork_ui
  log('--- timelapse-editor')
  app.newDocument(1200, 900)
  await sleep(600)
  const rec = getRecorder(app.doc)!
  app.state.setTool('brush')
  app.state.setPreset('brush', 'hard-round')
  app.state.setSize(40)
  const line = (y: number): [number, number, number][] => Array.from({ length: 24 }, (_, i) => [200 + i * 40, y + Math.sin(i / 3) * 30, 0.8])
  const key = async (fn: () => void): Promise<void> => {
    fn()
    await sleep(420)
  }
  // A B (undo B, redo B) C (undo C) D (branch) -> undo D, undo B, redo B ; E
  for (const [i, y] of [200, 320].entries()) {
    app.state.setColor({ h: i * 60, s: 0.85, v: 0.9 })
    await stroke(line(y))
  }
  await key(() => app.doc.undo())
  await key(() => app.doc.redo())
  app.state.setColor({ h: 120, s: 0.85, v: 0.9 })
  await stroke(line(440))
  await key(() => app.doc.undo())
  app.state.setColor({ h: 200, s: 0.85, v: 0.9 })
  await stroke(line(560))
  await key(() => app.doc.undo())
  await key(() => app.doc.undo())
  await key(() => app.doc.redo())
  app.state.setColor({ h: 300, s: 0.85, v: 0.9 })
  await stroke(line(680))
  await rec.flush()
  const tags = await rec.tags()
  log('tags', tags.map((x) => `${x.t}:${x.s}`).join(' '))
  check('tle: every frame is tagged with a history state', tags.length >= 10 && tags.every((x) => typeof x.s === 'number' && !!x.t), 'n=' + tags.length)
  check('tle: undo / redo frames are tagged as such', tags.filter((x) => x.t === 'undo').length === 4 && tags.filter((x) => x.t === 'redo').length === 2)
  const redoState = tags.find((x) => x.t === 'redo')!.s
  const bState = tags.filter((x) => x.t === 'stroke')[1].s
  check('tle: redo returns to the existing state (id reused)', redoState === bState, `${redoState} vs ${bState}`)
  const res = await resolveRecorder(rec)
  const kept = res.kept.map((i) => `${tags[i].t}:${tags[i].s}`)
  log('kept', kept.join(' '))
  check('tle: hide undone keeps init, A, B and the last stroke only', res.kept.length === 4 && res.keep.hiddenActions === 2, `kept=${res.kept.length} hidden=${res.keep.hiddenActions}`)
  check('tle: undone branch frames and all undo/redo frames are hidden', res.kept.every((i) => tags[i].t !== 'undo' && tags[i].t !== 'redo'))

  // ---- edit persistence in the .bwk
  let edit = addPause(rec.edit, 1, 2.5)
  edit = applySegment(edit, 1, 3, 4)
  edit.finale.fadeOut = 1
  edit.fitDuration = 12
  rec.setEdit(edit)
  const bytes = await saveBwk(app.doc, app.compositor)
  const doc2 = await loadBwk(bytes, app.gpu)
  app.setDocument(doc2)
  await sleep(800)
  const rec2 = getRecorder(app.doc)!
  check('tle: edit model restored from the .bwk', rec2.edit.pauses.length === 1 && rec2.edit.pauses[0].seconds === 2.5 && rec2.edit.segments.length === 1 && rec2.edit.fitDuration === 12 && rec2.edit.finale.fadeOut === 1)
  const tags2 = await rec2.tags()
  check('tle: history tags and tree restored', tags2.length === tags.length && tags2.every((x, i) => x.s === tags[i].s && x.t === tags[i].t) && rec2.tracker.parents.length > 5)
  app.state.setColor({ h: 40, s: 0.85, v: 0.9 })
  await stroke(line(780))
  await rec2.flush()
  const tags3 = await rec2.tags()
  check('tle: recording continues from the last state after reopen', tags3.length === tags2.length + 1 && rec2.tracker.parents[tags3[tags3.length - 1].s!] === tags2[tags2.length - 1].s, `n=${tags3.length}`)

  // ---- editor mode
  const before = app.doc.history.pushes
  await openTimelapseEditor(app, ui)
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', code: 'End', bubbles: true, cancelable: true }))
  await sleep(900)
  const root = document.querySelector<HTMLElement>('.tle')
  check('tle: editor opens', !!root && isTimelapseEditorOpen())
  check('tle: Time-lapse tab is the 6th top-bar tab and highlighted', document.querySelectorAll('.tb-left .tb-btn').length === 6 && document.querySelectorAll('.tb-left .tb-btn')[5].classList.contains('active'))
  const cv = document.querySelector<HTMLCanvasElement>('.tle-canvas')
  let painted = 0
  if (cv) {
    const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data
    for (let i = 0; i < d.length; i += 4) if (d[i] < 200 || d[i + 1] < 200) painted++
  }
  check('tle: preview shows a decoded frame', painted > 100, 'painted=' + painted)
  check('tle: timeline thumbnails strip drawn', !!document.querySelector('.tle-cv'))
  // painting input is dead while the editor is open
  const c = app.canvas.getBoundingClientRect()
  const fire = (type: string, x: number, y: number): void => void app.canvas.dispatchEvent(new PointerEvent(type, { pointerId: 777, pointerType: 'pen', isPrimary: true, clientX: x, clientY: y, pressure: type === 'pointerup' ? 0 : 0.7, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 }))
  const topEl = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2)
  check('tle: the editor covers the canvas (pointer input cannot reach it)', !!topEl && !!topEl.closest('.tle'))
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', bubbles: true, cancelable: true }))
  void fire
  check('tle: document untouched while editing', app.doc.history.pushes === before)
  // hide-undone toggle through the real UI
  const chk = document.querySelector<HTMLInputElement>('.tle-switch input')!
  const nBefore = rec2.edit.hideUndone
  chk.click()
  await sleep(200)
  check('tle: hide-undone toggle changes the edit', rec2.edit.hideUndone === !nBefore)
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }))
  await sleep(200)
  check('tle: Ctrl+Z undoes the editor edit, not the drawing', rec2.edit.hideUndone === nBefore && app.doc.history.pushes === before)
  await window.brushwork!.selfTestShot('timelapse-editor')
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))
  await sleep(300)
  check('tle: Esc returns to drawing', !isTimelapseEditorOpen() && !document.querySelector('.tle'))
  await openTimelapseEditor(app, ui)
  await sleep(500)
  closeTimelapseEditor()
  check('tle: close removes the editor and the tab highlight', !document.querySelector('.tle') && !document.querySelector('.tb-left .tb-tab.active'))

  // ---- export == schedule (ffprobe)
  const r3 = await resolveRecorder(rec2)
  const mp4 = path('tle-edited.mp4')
  const ex = await exportTimelapse(rec2, app.doc, r3, { format: 'h264', res: '1080p', fps: 30, quality: 'standard' }, mp4)
  check('tle: edited export succeeds', ex.ok, ex.error)
  const probe = await animioApi().ff.probe(mp4)
  if (probe) {
    const j = JSON.parse(probe)
    const s = j.streams[0]
    const dur = Number(j.format.duration)
    log('tle probe', probe.replace(/\s+/g, ' '))
    check('tle: video frame count == plan', Number(s.nb_read_frames) === ex.plan.frames, `${s.nb_read_frames} vs ${ex.plan.frames}`)
    check('tle: video duration within one frame of the schedule (fit 12 s)', Math.abs(dur - r3.schedule.total) <= 1 / 30 + 0.02 && Math.abs(r3.schedule.total - 12) < 0.01, `${dur} vs ${r3.schedule.total}`)
    check('tle: constant frame rate', s.r_frame_rate === '30/1')
    check('tle: pause hold is rendered as repeated frames', Math.max(...ex.plan.repeats) >= 75, 'maxRepeat=' + Math.max(...ex.plan.repeats))
  } else check('tle: ffprobe available', false)
  // hidden frames are absent: no-edit export of the same recording with and without hiding
  const plain = { ...rec2.edit, fitDuration: null, pauses: [], segments: [], globalSpeed: 1, finale: { holdSeconds: 0, fadeIn: 0, fadeOut: 0 } }
  const total = (await rec2.tags()).length
  const hid = await resolveRecorder(rec2, { ...plain, hideUndone: true })
  const all = await resolveRecorder(rec2, { ...plain, hideUndone: false })
  check('tle: toggle off shows every recorded frame, on hides the undone ones', all.kept.length === total && hid.kept.length < total, `${all.kept.length}/${hid.kept.length}/${total}`)
  const m2 = path('tle-hidden.mp4')
  const e2 = await exportTimelapse(rec2, app.doc, hid, { format: 'h264', res: '1080p', fps: 30, quality: 'small' }, m2)
  const p2 = JSON.parse((await animioApi().ff.probe(m2)) ?? '{"streams":[{}]}')
  check('tle: hidden undone frames are absent from the video', e2.ok && Number(p2.streams[0].nb_read_frames) === hid.kept.length, `${p2.streams[0].nb_read_frames} vs ${hid.kept.length}`)
  // pure schedule agrees with the plan sampled from the preview lookup
  const sch = buildSchedule(hid.kept, plain)
  check('tle: output plan duration == schedule total (within 1 frame)', Math.abs(outputPlan(sch, 30).duration - sch.total) <= 1 / 30)
  // GIF + WebM
  const gif = await exportTimelapse(rec2, app.doc, hid, { format: 'gif', res: '1080p', fps: 15, quality: 'standard' }, path('tle.gif'))
  check('tle: GIF export', gif.ok, gif.error)
  const webm = await exportTimelapse(rec2, app.doc, hid, { format: 'vp9', res: '1080p', fps: 24, quality: 'small' }, path('tle.webm'))
  check('tle: WebM export', webm.ok, webm.error)
  // cancel
  const longEdit = { ...plain, hideUndone: true, pauses: [{ id: 99, at: 0, seconds: 600 }] }
  const lr = await resolveRecorder(rec2, longEdit)
  const pending = exportTimelapse(rec2, app.doc, lr, { format: 'h264', res: '4k', fps: 60, quality: 'high' }, path('tle-cancel.mp4'))
  await sleep(700)
  await animioApi().tl.exportCancel()
  const cr = await pending
  check('tle: export can be cancelled', !cr.ok && !!cr.cancelled)
}
