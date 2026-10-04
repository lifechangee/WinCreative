import type { App } from '../../app/app'
import { h } from '../../ui/dom'
import { I18nRef, resolveText, t, tk } from '../../i18n'
import type { UIContext } from '../../ui/registry'
import type { Layer } from '../../doc/layer'
import { encodePngBitmap } from '../../io/imageFormats'
import type { Bitmap } from '../../io/imageFormats'
import { animioApi, ffmpegCaps } from './api'
import type { AnimAssist } from './animation'
import { playbackSequence } from './schedule'
import { btn, fmtBytes, fx, modal, numberInput, progressBar, select } from './ui'
import type { PlayMode } from './schedule'

export type AnimFormat = 'gif' | 'apng' | 'mp4' | 'hevc' | 'webm' | 'png-seq'

export interface AnimFormatInfo {
  label: I18nRef
  ext: string
  alpha: boolean
  needsEven: boolean
}
export const ANIM_FORMATS: Record<AnimFormat, AnimFormatInfo> = {
  gif: { label: tk('animio.fmt.gif'), ext: 'gif', alpha: true, needsEven: false },
  apng: { label: tk('animio.fmt.apng'), ext: 'png', alpha: true, needsEven: false },
  mp4: { label: tk('animio.fmt.mp4'), ext: 'mp4', alpha: false, needsEven: true },
  hevc: { label: tk('animio.fmt.hevc'), ext: 'mp4', alpha: false, needsEven: true },
  webm: { label: tk('animio.fmt.webm'), ext: 'webm', alpha: true, needsEven: true },
  'png-seq': { label: tk('animio.fmt.pngSeq'), ext: 'png', alpha: true, needsEven: false }
}

export interface AnimExportOpts {
  format: AnimFormat
  fps: number
  mode: PlayMode
  /** long side in px; 0 = canvas size */
  maxSide: number
  transparent: boolean
  /** GIF: smaller palette/size preset */
  webReady: boolean
}

const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2)

/** ffmpeg output args for a format (input is raw RGBA frames on stdin). */
export function outputArgs(o: AnimExportOpts): string[] {
  switch (o.format) {
    case 'gif':
      return [
        '-vf',
        `split[a][b];[a]palettegen=reserve_transparent=${o.transparent ? 1 : 0}${o.webReady ? ':max_colors=128' : ''}[p];[b][p]paletteuse=dither=${o.webReady ? 'bayer:bayer_scale=4' : 'sierra2_4a'}${o.transparent ? ':alpha_threshold=128' : ''}`,
        '-loop',
        o.mode === 'oneshot' ? '-1' : '0'
      ]
    case 'apng':
      return ['-f', 'apng', '-plays', o.mode === 'oneshot' ? '1' : '0', '-pix_fmt', 'rgba']
    case 'mp4':
      return ['-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']
    case 'hevc':
      return ['-c:v', 'libx265', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1', '-movflags', '+faststart']
    case 'webm':
      return ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '28', '-pix_fmt', o.transparent ? 'yuva420p' : 'yuv420p', '-auto-alt-ref', '0']
    default:
      return []
  }
}

export interface FrameSource {
  /** unique frames -> bitmap */
  render(i: number): Bitmap
  /** one cycle of steps: which unique frame, for how many ticks */
  steps: { frame: number; ticks: number }[]
  count: number
}

export function sizeFor(w: number, h: number, o: AnimExportOpts): { width: number; height: number } {
  let k = 1
  const side = o.webReady && o.format === 'gif' ? Math.min(o.maxSide || 640, 640) : o.maxSide
  if (side > 0) k = Math.min(1, side / Math.max(w, h))
  const info = ANIM_FORMATS[o.format]
  const W = Math.max(1, Math.round(w * k))
  const H = Math.max(1, Math.round(h * k))
  return info.needsEven ? { width: even(W), height: even(H) } : { width: W, height: H }
}

/** Stream frames to ffmpeg (or write PNG sequence). Returns output size in bytes. */
export async function exportFrames(src: FrameSource, o: AnimExportOpts, out: string, size: { width: number; height: number }, progress: (f: number) => void, base = 'frame'): Promise<{ ok: boolean; error?: string; size: number }> {
  const api = animioApi()
  if (o.format === 'png-seq') {
    const files: { name: string; data: Uint8Array }[] = []
    let n = 1
    for (const st of src.steps) {
      const png = await encodePngBitmap(src.render(st.frame))
      for (let k = 0; k < st.ticks; k++) files.push({ name: `${base}-${String(n++).padStart(4, '0')}.png`, data: png })
      progress(n / (src.steps.reduce((a, s) => a + s.ticks, 0) + 1))
    }
    await api.writeFiles(out, files)
    return { ok: true, size: files.reduce((a, f) => a + f.data.length, 0) }
  }
  const job = await api.ff.begin({ inputArgs: ['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${size.width}x${size.height}`, '-framerate', String(o.fps)], outputArgs: outputArgs(o), out })
  try {
    for (let i = 0; i < src.steps.length; i++) {
      const b = src.render(src.steps[i].frame)
      await api.ff.write(job, new Uint8Array(b.data.buffer, b.data.byteOffset, b.data.byteLength), src.steps[i].ticks)
      progress((i + 1) / src.steps.length)
    }
  } catch (e) {
    await api.ff.abort(job).catch(() => undefined)
    return { ok: false, error: (e as Error).message, size: 0 }
  }
  return api.ff.end(job)
}

/** Frame source for Animation Assist: background + frame + foreground per step. */
export function animFrameSource(anim: AnimAssist, o: AnimExportOpts, size: { width: number; height: number }): FrameSource {
  const frames = anim.frames()
  const seq = playbackSequence(frames.map((f) => anim.holdOf(f)), o.mode)
  const bg = anim.backgrounds()
  const fg = anim.foregrounds()
  const doc = anim.doc
  const paper: [number, number, number] | null = o.transparent && ANIM_FORMATS[o.format].alpha ? null : doc.background.visible ? doc.background.color : [1, 1, 1]
  const cache = new Map<number, Bitmap>()
  return {
    count: frames.length,
    steps: seq,
    render: (i) => {
      let b = cache.get(i)
      if (!b) {
        const list: Layer[] = [...bg, frames[i], ...fg]
        // a background/foreground frame that is itself the same object is impossible (they are excluded from `frames`)
        b = anim.renderer().bitmap(list, { paper, size })
        b = { ...b, data: new Uint8ClampedArray(b.data) }
        cache.set(i, b)
      }
      return b
    }
  }
}

export async function openAnimExport(app: App, ui: UIContext, anim: AnimAssist): Promise<void> {
  const caps = await ffmpegCaps()
  const st: AnimExportOpts = { format: 'gif', fps: anim.state.fps, mode: anim.state.mode, maxSide: 0, transparent: !app.doc.background.visible, webReady: false }
  const m = modal(tk('animio.anim.export.title'))
  const formats = (Object.keys(ANIM_FORMATS) as AnimFormat[]).filter((f) => {
    if (f === 'png-seq') return true
    if (!caps) return false
    if (f === 'hevc') return caps.encoders.includes('libx265')
    if (f === 'webm') return caps.encoders.includes('libvpx-vp9')
    return true
  })
  const info = h('p', { class: 'an-note' })
  const upd = (): void => {
    const sz = sizeFor(app.doc.width, app.doc.height, st)
    const ticks = playbackSequence(anim.frames().map((f) => anim.holdOf(f)), st.mode).reduce((a, s) => a + s.ticks, 0)
    info.textContent = t('animio.anim.export.info', { frames: anim.frames().length, ticks, fps: st.fps, secs: fx(ticks / st.fps, 2), w: sz.width, h: sz.height })
  }
  const prog = progressBar()
  const status = h('p', { class: 'an-note' })
  let statusFn: (() => string) | null = null
  const setStatus = (fn: (() => string) | null): void => {
    statusFn = fn
    status.textContent = fn ? fn() : ''
  }
  const transp = h('input', { type: 'checkbox', checked: st.transparent })
  transp.addEventListener('change', () => (st.transparent = transp.checked))
  const web = h('input', { type: 'checkbox', checked: st.webReady })
  web.addEventListener('change', () => ((st.webReady = web.checked), upd()))
  m.body.append(
    h('div', { class: 'an-grid' },
      h('label', { text: tk('animio.common.format') }), select<AnimFormat>(formats.map((f) => [f, ANIM_FORMATS[f].label] as [AnimFormat, I18nRef]), st.format, (v) => ((st.format = v), upd())),
      h('label', { text: tk('animio.common.frameRate') }), numberInput(st.fps, 1, 60, (v) => ((st.fps = v), upd())),
      h('label', { text: tk('animio.anim.playback') }), select<PlayMode>([['loop', tk('animio.mode.loop')], ['pingpong', tk('animio.mode.pingpong')], ['oneshot', tk('animio.mode.oneshot')]], st.mode, (v) => ((st.mode = v), upd())),
      h('label', { text: tk('core.common.size') }), select<string>([['0', tk('animio.anim.export.canvasSize')], ['1920', tk('animio.anim.export.fit', { n: 1920 })], ['1080', tk('animio.anim.export.fit', { n: 1080 })], ['720', tk('animio.anim.export.fit', { n: 720 })], ['480', tk('animio.anim.export.fit', { n: 480 })]], '0', (v) => ((st.maxSide = Number(v)), upd())),
      h('label', { text: tk('animio.common.transparency') }), h('label', { class: 'chk' }, transp, h('span', { text: tk('animio.anim.export.keepTransparent') })),
      h('label', { text: tk('animio.anim.export.webReady') }), h('label', { class: 'chk' }, web, h('span', { text: tk('animio.anim.export.webReady.hint') }))
    ),
    info,
    h('p', { class: 'an-note', text: caps ? tk('animio.anim.export.encodedWith', { source: caps.source }) : tk('animio.anim.export.noFfmpeg') }),
    prog.el,
    status
  )
  upd()
  m.onLang(() => {
    upd()
    if (statusFn) status.textContent = statusFn()
  })
  const go = btn(tk('animio.common.exportEllipsis'), async () => {
    const fmt = ANIM_FORMATS[st.format]
    let out: string | null
    if (st.format === 'png-seq') out = await animioApi().ff.pickDir(t('animio.anim.export.pickFolder'))
    else out = await animioApi().ff.pickPath({ defaultName: `${app.doc.name}.${fmt.ext}`, filters: [{ name: resolveText(fmt.label), extensions: [fmt.ext] }] })
    if (!out) return
    go.disabled = true
    setStatus(() => t('animio.anim.export.encoding'))
    try {
      const size = sizeFor(app.doc.width, app.doc.height, st)
      anim.stop()
      const res = await exportFrames(animFrameSource(anim, st, size), st, out, size, (f) => prog.set(f), app.doc.name)
      setStatus(() => (res.ok ? t('animio.anim.export.saved', { size: fmtBytes(res.size) }) : t('animio.common.exportFailed', { error: String(res.error) })))
      if (res.ok) ui.toast(t('animio.anim.export.done'))
    } catch (e) {
      setStatus(() => t('animio.common.exportFailed', { error: (e as Error).message }))
    } finally {
      go.disabled = false
    }
  }, 'primary')
  m.footer.append(btn(tk('core.common.close'), () => m.close()), go)
}
