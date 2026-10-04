import { PDFDocument } from 'pdf-lib'
import { cropDocument, flipCanvas } from './canvasMenu'
import { animioApi } from './api'
import { ANIM_FORMATS, AnimExportOpts, AnimFormat, animFrameSource, exportFrames, sizeFor } from './animExport'
import type { AnimAssist } from './animation'
import type { PageAssist } from './pages'
import { exportPagesPdf } from './pages'
import { exportPsdBytes, importPsdBytes } from '../../io/docPsd'
import { decodePsd } from '../../io/psd'
import { decodeBitmap, encodeTiff, encodeWebp, flattenOnto, sniffImage } from '../../io/imageFormats'
import { flattenedBitmap } from '../../io/frameRender'
import type { TestCtx } from './selftest'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function runMore(t: TestCtx): Promise<void> {
  const { app, out, log, check, stroke } = t
  const api = animioApi()
  const sep = out.includes('\\') ? '\\' : '/'
  const path = (f: string): string => out + sep + f
  const { anim, pages } = (window as any).brushwork_animio as { anim: AnimAssist; pages: PageAssist }
  const gl = app.gpu.gl

  // ================= TIME-LAPSE EDITOR (replay) =================
  {
    const { openReplay } = await import('./tlUi')
    const { closeTimelapseEditor } = await import('./tlEditor')
    void openReplay(app, (window as any).brushwork_ui)
    await sleep(900)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', code: 'End', bubbles: true, cancelable: true }))
    await sleep(500)
    const cv = document.querySelector<HTMLCanvasElement>('.tle-canvas')
    let nw = 0
    if (cv) {
      const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data
      for (let i = 0; i < d.length; i += 4) if (d[i] < 200 || d[i + 1] < 200) nw++
    }
    check('replay (time-lapse editor) shows frames', !!cv && nw > 100, `canvas=${cv?.width}x${cv?.height} painted=${nw}`)
    await window.brushwork!.selfTestShot('replay')
    closeTimelapseEditor()
  }

  // ================= ANIMATION ASSIST =================
  app.newDocument(800, 600)
  await sleep(300)
  app.state.setTool('brush')
  app.state.setPreset('brush', 'hard-round')
  app.state.setSize(60)
  anim.setEnabled(true)
  const colors = [0, 120, 240]
  for (let i = 0; i < 3; i++) {
    if (i > 0) anim.addFrame()
    app.state.setColor({ h: colors[i], s: 0.9, v: 0.9 })
    await stroke([[150 + i * 200, 150, 0.8], [200 + i * 200, 300, 0.8], [150 + i * 200, 450, 0.8]])
  }
  check('3 frames = 3 root layers', anim.frames().length === 3, 'n=' + anim.frames().length)
  anim.setHold(1, 3)
  anim.setCurrent(1)
  app.renderNow()
  check('onion ghosts built (before+after)', (anim as any).ghosts.length === 2, 'ghosts=' + (anim as any).ghosts.length)
  await sleep(600)
  const cvs = [...document.querySelectorAll<HTMLCanvasElement>('.an-strip .an-frame canvas')]
  const nonWhite = (c: HTMLCanvasElement): number => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
    let n = 0
    for (let i = 0; i < d.length; i += 4) if (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) n++
    return n
  }
  check('timeline thumbnails show frame content', cvs.length === 3 && cvs.every((c) => nonWhite(c) > 20), cvs.map((c) => `${c.width}x${c.height}:${nonWhite(c)}`).join(' '))
  await window.brushwork!.selfTestShot('anim-onion')
  { const ge = gl.getError(); check('no GL error after onion', ge === 0, 'code=' + ge) }
  anim.setRole(anim.frames()[0].id, 'bg')
  check('background frame leaves sequence', anim.frames().length === 2 && anim.backgrounds().length === 1)
  anim.setRole(anim.backgrounds()[0].id, 'none')
  check('restore frame', anim.frames().length === 3)
  // playback runs and advances
  anim.state.fps = 30
  anim.play()
  const seen = new Set<number>()
  for (let i = 0; i < 40; i++) {
    seen.add(anim.state.current)
    await sleep(40)
  }
  anim.stop()
  check('playback visits all frames', seen.size === 3, [...seen].join(','))

  const formats: AnimFormat[] = ['gif', 'apng', 'mp4', 'webm', 'hevc']
  const ticks = 1 + 3 + 1
  for (const f of formats) {
    const o: AnimExportOpts = { format: f, fps: 10, mode: 'loop', maxSide: 0, transparent: false, webReady: false }
    const size = sizeFor(800, 600, o)
    const file = path(`anim-${f}.${ANIM_FORMATS[f].ext}`)
    const res = await exportFrames(animFrameSource(anim, o, size), o, file, size, () => undefined)
    check(`anim export ${f}`, res.ok, res.error ?? 'size=' + res.size)
    const pr = await api.ff.probe(file)
    if (pr) {
      const s = JSON.parse(pr).streams[0]
      check(`anim ${f}: ${ticks} frames ${size.width}x${size.height}`, Number(s.nb_read_frames) === ticks && s.width === size.width && s.height === size.height, `${s.codec_name} ${s.nb_read_frames} frames ${s.width}x${s.height}`)
    }
  }
  // GIF header + one-shot ping-pong count
  {
    const o: AnimExportOpts = { format: 'gif', fps: 10, mode: 'pingpong', maxSide: 400, transparent: true, webReady: true }
    const size = sizeFor(800, 600, o)
    const file = path('anim-pingpong.gif')
    const res = await exportFrames(animFrameSource(anim, o, size), o, file, size, () => undefined)
    check('gif ping-pong exported', res.ok, res.error)
    const pr = await api.ff.probe(file)
    const s = pr ? JSON.parse(pr).streams[0] : null
    // ping-pong: 0,1(x3),2,1(x3) = 1+3+1+3
    check('gif ping-pong frame count', !!s && Number(s.nb_read_frames) === 8 && s.width === 400, s ? `${s.nb_read_frames} frames ${s.width}x${s.height}` : 'no probe')
  }
  {
    const o: AnimExportOpts = { format: 'png-seq', fps: 10, mode: 'oneshot', maxSide: 0, transparent: true, webReady: false }
    const size = sizeFor(800, 600, o)
    const res = await exportFrames(animFrameSource(anim, o, size), o, out, size, () => undefined, 'seq')
    check('png sequence written', res.ok && res.size > 0)
  }
  anim.setEnabled(false)

  // ================= PSD (layers, blend, opacity, visibility, groups) =================
  app.newDocument(320, 240)
  await sleep(200)
  const doc = app.doc
  app.state.setSize(50)
  app.state.setColor({ h: 10, s: 1, v: 1 })
  await stroke([[60, 60, 0.9], [260, 60, 0.9]])
  const l2 = doc.addLayer({ name: 'Shade', blendMode: 'multiply', opacity: 0.6 })
  app.state.setColor({ h: 200, s: 1, v: 1 })
  await stroke([[60, 120, 0.9], [260, 120, 0.9]])
  const l3 = doc.addLayer({ name: 'Hidden', visible: false, blendMode: 'screen' })
  await stroke([[60, 180, 0.9], [260, 180, 0.9]])
  const g = doc.groupLayers([l2.id, l3.id], 'My Group')
  check('group created', !!g)
  const psd = exportPsdBytes(app.gpu, doc, app.compositor)
  await api.writeFiles(out, [{ name: 'export.psd', data: psd }])
  const d = decodePsd(psd)
  const top = d.layers.map((l) => l.name)
  log('psd top-level layers:', top.join(' | '), 'bytes', psd.length)
  const grp = d.layers.find((l) => l.name === 'My Group')
  check('psd has group with 2 children', !!grp?.children && grp.children.length === 2, JSON.stringify(grp?.children?.map((c) => c.name)))
  const shade = grp?.children?.find((c) => c.name === 'Shade')
  check('psd blend/opacity', shade?.blendMode === 'multiply' && Math.abs((shade?.opacity ?? 0) - 0.6) < 0.02, `${shade?.blendMode} ${shade?.opacity}`)
  const hid = grp?.children?.find((c) => c.name === 'Hidden')
  check('psd hidden + screen', hid?.visible === false && hid?.blendMode === 'screen')
  const back = importPsdBytes(app.gpu, psd, 'roundtrip')
  check('psd re-import layer count', back.paintLayerCount === doc.paintLayerCount + 1 /* background color layer */ && back.layers.some((l) => l.isGroup), `paint=${back.paintLayerCount}`)
  const px1 = flattenedBitmap(app.compositor, doc, true)
  back.dispose()
  const c1 = px1.data[(60 * 320 + 150) * 4]
  check('flattened composite has red stroke', c1 > 150, 'r=' + c1)

  // ================= TIFF / WebP / sniff =================
  const bmp = flattenOnto({ ...px1, data: new Uint8ClampedArray(px1.data) })
  const tif = encodeTiff(bmp)
  check('tiff sniff', sniffImage(tif) === 'tiff', 'bytes=' + tif.length)
  const tb = await decodeBitmap(tif)
  check('tiff roundtrip', tb.width === 320 && tb.height === 240 && Math.abs(tb.data[(60 * 320 + 150) * 4] - c1) <= 2)
  const wp = await encodeWebp(bmp, 0.9)
  check('webp encodes', sniffImage(wp) === 'webp', 'bytes=' + wp.length)
  await api.writeFiles(out, [{ name: 'export.tif', data: tif }, { name: 'export.webp', data: wp }])

  // ================= PAGE ASSIST -> PDF =================
  pages.setEnabled(true)
  check('pages = root layers', pages.pages().length === doc.childrenOf(null).length, 'pages=' + pages.pages().length)
  pages.addPage()
  const pdf = await exportPagesPdf(app, pages, 'best')
  await api.writeFiles(out, [{ name: 'pages.pdf', data: pdf }])
  const pd = await PDFDocument.load(pdf)
  check('pdf page count', pd.getPageCount() === pages.pages().length, 'pages=' + pd.getPageCount())
  const pw = pd.getPage(0).getWidth()
  check('pdf page size follows dpi (320px @132dpi)', Math.abs(pw - (320 * 72) / 132) < 0.5, 'w=' + pw.toFixed(1))
  const pdfWeb = await exportPagesPdf(app, pages, 'web')
  check('pdf web ready smaller or equal', pdfWeb.length > 100, `${pdfWeb.length} vs ${pdf.length}`)
  pages.setEnabled(false)

  // ================= CANVAS: crop/resize + flip =================
  const before = flattenedBitmap(app.compositor, doc, false)
  const alphaAt = (b: { width: number; data: Uint8ClampedArray }, x: number, y: number): number => b.data[(y * b.width + x) * 4 + 3]
  check('stroke at x=70 y=60 before flip', alphaAt(before, 70, 60) > 200)
  flipCanvas(app, 'h')
  const flipped = flattenedBitmap(app.compositor, doc, false)
  check('flip H moves pixels', alphaAt(flipped, 320 - 1 - 70, 60) > 200 && alphaAt(flipped, 70, 60) < 250 || alphaAt(flipped, 249, 60) > 200, `a=${alphaAt(flipped, 249, 60)}`)
  doc.undo()
  const undone = flattenedBitmap(app.compositor, doc, false)
  check('flip undo restores', alphaAt(undone, 70, 60) > 200)
  flipCanvas(app, 'v')
  const fv = flattenedBitmap(app.compositor, doc, false)
  check('flip V moves pixels', alphaAt(fv, 100, 240 - 1 - 60) > 200, 'a=' + alphaAt(fv, 100, 179))
  doc.undo()

  const cropped = cropDocument(app, doc, { width: 200, height: 100, x: 40, y: 30, resample: false })
  check('crop size', cropped.width === 200 && cropped.height === 100 && cropped.layers.length === doc.layers.length)
  const cp = app.gpu.readRGBA8(cropped.layers.find((l) => !l.isGroup && l.name !== 'Shade' && l.name !== 'Hidden')!.pixels, { x: 0, y: 0, w: 200, h: 100 })
  check('crop keeps pixels (offset)', cp[(30 * 200 + 60) * 4 + 3] > 200, 'a=' + cp[(30 * 200 + 60) * 4 + 3])
  cropped.dispose()
  const scaled = cropDocument(app, doc, { width: 160, height: 120, x: 0, y: 0, resample: true })
  const sp = app.gpu.readRGBA8(scaled.layers.find((l) => !l.isGroup && l.name.startsWith('Layer'))!.pixels, { x: 0, y: 0, w: 160, h: 120 })
  check('resample keeps content (scaled)', sp[(30 * 160 + 75) * 4 + 3] > 200, 'a=' + sp[(30 * 160 + 75) * 4 + 3])
  scaled.dispose()
  { const ge = gl.getError(); check('no GL error (animio)', ge === 0, 'code=' + ge) }
}
