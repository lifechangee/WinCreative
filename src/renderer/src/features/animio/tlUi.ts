import type { App } from '../../app/app'
import { h } from '../../ui/dom'
import { I18nRef, t, tEl, tk } from '../../i18n'
import { registerMenuItem } from '../../ui/registry'
import type { UIContext } from '../../ui/registry'
import { prefs } from '../../input/prefs'
import { TL_QUALITY, TlQuality, formatDuration } from './schedule'
import type { TimelapseManager, TimelapseRecorder } from './timelapse'
import { MAX_FRAMES, getRecorder } from './timelapse'
import { openTimelapseEditor } from './tlEditor'
import { btn, confirmDialog, fmtBytes, modal, select } from './ui'

/** Actions > Video menu: recording toggle, replay, export, settings. */
export function installTimelapseUi(app: App, ui: UIContext, mgr: TimelapseManager): void {
  const rec = (): TimelapseRecorder | null => getRecorder(app.doc) ?? mgr.current
  const refreshMenu = (): void => {
    const r = rec()
    registerMenuItem('actions', { id: 'video-toggle', group: 'video', label: r?.enabled ? tk('animio.menu.tl.recOn') : tk('animio.menu.tl.recOff'), separator: true, run: () => r?.setEnabled(!r.enabled) })
    registerMenuItem('actions', { id: 'video-replay', group: 'video', label: tk('animio.menu.tl.replay'), run: () => void openReplay(app, ui) })
    registerMenuItem('actions', { id: 'video-export', group: 'video', label: tk('animio.menu.tl.export'), run: () => void openTimelapseExport(app, ui) })
    registerMenuItem('actions', { id: 'video-settings', group: 'video', label: tk('animio.menu.tl.settings'), run: () => openTimelapseSettings(app, ui) })
  }
  refreshMenu()
  let off: (() => void) | null = null
  const bind = (): void => {
    off?.()
    off = rec()?.events.on('change', refreshMenu) ?? null
    refreshMenu()
  }
  mgr.events.on('recorder', bind)
  app.events.on('doc', () => setTimeout(bind, 0))
  bind()
}

// ------------------------------------------------------------------ settings
export function openTimelapseSettings(app: App, ui: UIContext): void {
  const r = getRecorder(app.doc)
  if (!r) return
  const m = modal(tk('animio.tl.settings.title'))
  const stats = h('div')
  const paint = (): void => {
    stats.replaceChildren(
      ...(
        [
          [t('animio.tl.settings.framesRecorded'), String(r.count) + (r.count >= MAX_FRAMES ? t('animio.tl.settings.thinned') : '')],
          [t('animio.tl.settings.fullLength'), t('animio.tl.settings.fullLengthValue', { dur: formatDuration(r.seconds * 1000) })],
          [t('animio.tl.settings.sizeOnDisk'), fmtBytes(r.bytes)]
        ] as [string, string][]
      ).map(([a, b]) => h('div', { class: 'an-stat' }, h('span', { text: a }), h('span', { text: b })))
    )
  }
  paint()
  m.onLang(paint)
  const off = r.events.on('change', paint)
  const enabled = h('input', { type: 'checkbox', checked: r.enabled })
  enabled.addEventListener('change', () => r.setEnabled(enabled.checked))
  const hideDefault = h('input', { type: 'checkbox', checked: prefs.v.timelapseHideUndone })
  hideDefault.addEventListener('change', () => prefs.set('timelapseHideUndone', hideDefault.checked))
  const q = select(Object.entries(TL_QUALITY).map(([k, v]) => [k as TlQuality, v.label] as [TlQuality, I18nRef]), r.quality, (v) => r.setQuality(v))
  m.body.append(
    h('div', { class: 'an-grid' }, h('label', { text: tk('animio.tl.settings.record') }), h('label', { class: 'chk' }, enabled, h('span', { text: tk('animio.tl.settings.recordThis') })), h('label', { text: tk('animio.tl.settings.quality') }), q),
    h('p', { class: 'an-note', text: tk('animio.tl.settings.qualityNote') }),
    h('label', { class: 'chk', style: 'display:flex;gap:8px;align-items:flex-start;margin-top:10px' }, hideDefault, h('span', { text: tk('animio.tle.settings.hideDefault') })),
    h('div', { class: 'an-h', text: tk('animio.tl.settings.recording') }),
    stats
  )
  m.footer.append(
    btn(tk('animio.tl.settings.reset'), async () => {
      if (await confirmDialog(tk('animio.tl.settings.reset.title'), tk('animio.tl.settings.reset.text'), tk('core.common.reset'))) {
        await r.reset()
        ui.toast(t('animio.tl.settings.reset.done'))
      }
    }),
    btn(tk('animio.tle.open'), () => {
      m.close()
      void openReplay(app, ui)
    }),
    btn(tk('core.common.done'), () => m.close(), 'primary')
  )
  const orig = m.close
  m.close = (): void => {
    off()
    orig()
  }
}

// ------------------------------------------------------------------ replay / export = the time-lapse editor
/** Replay lives in the editor now (Actions > Video and the Time-lapse tab open the same mode). */
export async function openReplay(app: App, ui: UIContext): Promise<void> {
  await openTimelapseEditor(app, ui)
}

/** Quick export: the editor's export dialog (same schedule, same pipeline). */
export async function openTimelapseExport(app: App, ui: UIContext): Promise<void> {
  await openTimelapseEditor(app, ui, { exportNow: true })
}
