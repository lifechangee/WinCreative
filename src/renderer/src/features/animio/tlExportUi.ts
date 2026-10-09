import type { App } from '../../app/app'
import { h } from '../../ui/dom'
import { t, tk } from '../../i18n'
import { animioApi, ffmpegCaps } from './api'
import { VideoRes, videoSize } from './schedule'
import type { TlEditorCore } from './tlEditorCore'
import { FORMAT_EXT, TlExportParams, TlFormat, exportAllVariants, exportTimelapse, resolveEdit } from './tlExport'
import { outputPlan } from './tlModel'
import { btn, fmtBytes, fx, modal, progressBar, select } from './ui'

/** Export dialog of the time-lapse editor: same schedule as the preview, constant frame rate output. */
export async function openExportDialog(app: App, core: TlEditorCore): Promise<void> {
  const rec = core.rec
  const variants = rec.variants // language variants: [] when the document has no language layer
  let scope: 'current' | 'all' = variants.length ? 'all' : 'current'
  const langName = (c: string): string => app.doc.langs.find((l) => l.code === c)?.name ?? c
  const caps = await ffmpegCaps()
  const m = modal(tk('animio.tle.exp.title'))
  if (!caps) {
    m.body.append(h('p', { text: tk('animio.tl.export.noFfmpeg') }))
    m.footer.append(btn(tk('core.common.close'), () => m.close(), 'primary'))
    return
  }
  const st: TlExportParams = { format: 'h264', res: '1080p', fps: 30, quality: 'standard' }
  const info = h('p', { class: 'an-note', style: 'white-space:pre-line' })
  const gifNote = h('p', { class: 'an-note', text: tk('animio.tle.exp.gifNote') })
  const upd = (): void => {
    const plan = outputPlan(core.schedule, st.fps)
    const sz = videoSize(rec.sourceSize().w, rec.sourceSize().h, st.res)
    info.textContent = t('animio.tle.exp.info', { count: plan.frames, secs: fx(plan.duration, 1), fps: st.fps, w: sz.width, h: sz.height })
    if (variants.length && scope === 'all') {
      // every language has its own length: list them
      const per = variants.map((v) => {
        const p = outputPlan(resolveEdit(core.tags, rec.tracker.parents, rec.editFor(v), v).schedule, st.fps)
        return t('langs.exp.perVariant', { name: v.toUpperCase(), secs: fx(p.duration, 1), count: p.frames })
      })
      info.textContent = per.join(String.fromCharCode(10)) + String.fromCharCode(10) + t('langs.exp.allNote', { n: variants.length })
    }
    gifNote.style.display = st.format === 'gif' ? '' : 'none'
  }
  const fmts: [TlFormat, string][] = [['h264', t('animio.tle.exp.fmt.h264')]]
  if (caps.encoders.includes('libx265')) fmts.push(['hevc', t('animio.tle.exp.fmt.hevc')])
  if (caps.encoders.includes('libvpx-vp9')) fmts.push(['vp9', t('animio.tle.exp.fmt.vp9')])
  fmts.push(['gif', t('animio.tle.exp.fmt.gif')])
  const fmtSel = select<TlFormat>(fmts, st.format, (v) => {
    st.format = v
    if (v === 'gif' && st.fps > 30) fpsSel.value = String((st.fps = 24))
    upd()
  })
  const resSel = select<VideoRes>([['1080p', '1080p (1920 × 1080)'], ['2k', '2K (2560 × 1440)'], ['4k', '4K (3840 × 2160)'], ['canvas', tk('animio.tl.export.canvasRes')]], st.res, (v) => ((st.res = v), upd()))
  const fpsSel = select<string>([['24', '24'], ['30', '30'], ['60', '60']], '30', (v) => ((st.fps = Number(v)), upd()))
  const qSel = select<TlExportParams['quality']>([['high', tk('animio.tle.exp.q.high')], ['standard', tk('animio.tle.exp.q.standard')], ['small', tk('animio.tle.exp.q.small')]], st.quality, (v) => (st.quality = v))
  const scopeSel = select<'current' | 'all'>([['all', tk('langs.exp.all')], ['current', tk('langs.exp.current')]], scope, (v) => ((scope = v), upd()))
  const prog = progressBar()
  const status = h('p', { class: 'an-note' })
  let statusFn: (() => string) | null = null
  const setStatus = (fn: () => string): void => {
    statusFn = fn
    status.textContent = fn()
  }
  m.onLang(() => {
    upd()
    if (statusFn) status.textContent = statusFn()
  })
  m.body.append(
    h('div', { class: 'an-grid' }, ...(variants.length ? [h('label', { text: tk('langs.exp.versions') }), scopeSel] : []), h('label', { text: tk('animio.common.format') }), fmtSel, h('label', { text: tk('animio.tl.export.resolution') }), resSel, h('label', { text: tk('animio.common.frameRate') }), fpsSel, h('label', { text: tk('animio.tle.exp.quality') }), qSel),
    info,
    gifNote,
    h('p', { class: 'an-note', text: tk('animio.tle.exp.note') }),
    prog.el,
    status
  )
  upd()
  let running = false
  const cancel = btn(tk('core.common.cancel'), () => {
    if (running) void animioApi().tl.exportCancel()
    else m.close()
  })
  const go = btn(tk('animio.common.exportEllipsis'), async () => {
    const ext = FORMAT_EXT[st.format]
    const out = await animioApi().ff.pickPath({ defaultName: `${app.doc.name}-timelapse.${ext}`, filters: [{ name: t('animio.tle.exp.filter.' + ext), extensions: [ext] }] })
    if (!out) return
    if (variants.length && scope === 'all') {
      // every language in one pass: name.en.mp4, name.ru.mp4 ... (each with its own edit model, frames and length)
      running = true
      go.disabled = true
      const done: string[] = []
      try {
        let shown = -1
        const results = await exportAllVariants(rec, app.doc, st, out, (i, _f, overall) => {
          if (i !== shown) {
            shown = i
            setStatus(() => t('langs.exp.running', { name: langName(variants[i]), i: i + 1, n: variants.length }))
          }
          prog.set(overall)
        })
        for (const r of results) {
          if (r.result.cancelled) return setStatus(() => t('animio.tle.exp.cancelled'))
          if (!r.result.ok) return setStatus(() => t('animio.common.exportFailed', { error: String(r.result.error) }))
          done.push(r.file)
        }
        prog.set(1)
        setStatus(() => t('langs.exp.saved', { n: done.length, path: done.join('\n') }))
      } catch (e) {
        setStatus(() => t('animio.common.exportFailed', { error: (e as Error).message }))
      } finally {
        running = false
        go.disabled = false
      }
      return
    }
    running = true
    go.disabled = true
    setStatus(() => t('animio.tl.export.encoding'))
    try {
      // re-resolve from the disk tags so a late frame can never be missed
      const resolved = resolveEdit(await rec.tags(), rec.tracker.parents, rec.edit, rec.variantKey)
      const res = await exportTimelapse(rec, app.doc, resolved, st, out, (f) => prog.set(f))
      if (res.ok) setStatus(() => t('animio.tl.export.saved', { path: out, size: fmtBytes(res.size) }))
      else if (res.cancelled) setStatus(() => t('animio.tle.exp.cancelled'))
      else setStatus(() => t('animio.common.exportFailed', { error: String(res.error) }))
    } catch (e) {
      setStatus(() => t('animio.common.exportFailed', { error: (e as Error).message }))
    } finally {
      running = false
      go.disabled = false
    }
  }, 'primary')
  m.footer.append(cancel, go)
}
