import type { App } from '../../app/app'
import type { BrushPreset } from '../../core/brush'
import { brushName, setName } from '../../brush/presets'
import { I18nRef, t, tk } from '../../i18n'
import { h } from '../../ui/dom'
import { exportBrushFile, exportSetFile, importBrushFile } from './brushFile'
import { library, RECENT_ID, FAVORITES_ID } from './library'
import { openBrushStudio } from './studio'
import { injectCss } from './widgets'

export const BRUSH_EXTS = ['brush', 'brushset', 'abr', 'bwbrush', 'bwbrushset']

/** Small modal text prompt (window.prompt is not available in Electron). */
export function askText(title: I18nRef, initial = '', okLabel: I18nRef = tk('core.common.ok')): Promise<string | null> {
  injectCss()
  return new Promise((res) => {
    const back = h('div', { class: 'bs-root', style: 'z-index:600' })
    const input = h('input', { type: 'text', value: initial, style: 'width:100%;background:var(--panel2);color:var(--text);border:1px solid var(--line);border-radius:7px;padding:8px' })
    const done = (v: string | null): void => {
      back.remove()
      res(v)
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done(input.value)
      if (e.key === 'Escape') done(null)
    })
    back.append(
      h(
        'div',
        { class: 'bs-win', style: 'width:360px;height:auto;padding:14px;gap:10px' },
        h('h3', { text: title, style: 'margin:0' }),
        input,
        h('div', { class: 'bs-padbar', style: 'justify-content:flex-end' }, h('button', { class: 'bs-btn', text: tk('core.common.cancel'), onclick: () => done(null) }), h('button', { class: 'bs-btn primary', text: okLabel, onclick: () => done(input.value) }))
      )
    )
    document.body.append(back)
    input.focus()
    input.select()
  })
}

const api = (): NonNullable<Window['brushwork']> => {
  if (!window.brushwork) throw new Error('Electron bridge unavailable')
  return window.brushwork
}

const safeName = (s: string): string => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'brush'

export async function shareBrush(app: App, b: BrushPreset): Promise<void> {
  try {
    const data = await exportBrushFile(b)
    const p = await api().saveFile({ defaultName: safeName(b.name) + '.bwbrush', filters: [{ name: t('brushes.actions.filter.brush'), extensions: ['bwbrush'] }], data })
    if (p) app.notify(t('brushes.actions.exported', { name: brushName(b) }))
  } catch (e) {
    app.notify(t('brushes.actions.exportFailed', { error: (e as Error).message }))
  }
}

export async function shareSet(app: App, setId: string): Promise<void> {
  const name = setId === FAVORITES_ID ? t('brushes.library.favorites') : setId === RECENT_ID ? t('brushes.library.recent') : library.set(setId) ? setName(library.set(setId)!) : t('brushes.actions.set')
  try {
    const data = await exportSetFile(name, library.brushesOf(setId))
    const p = await api().saveFile({ defaultName: safeName(name) + '.bwbrushset', filters: [{ name: t('brushes.actions.filter.brushSet'), extensions: ['bwbrushset'] }], data })
    if (p) app.notify(t('brushes.actions.exportedSet', { name }))
  } catch (e) {
    app.notify(t('brushes.actions.exportFailed', { error: (e as Error).message }))
  }
}

/** Import brush bytes into the library. Returns the id of the set the brushes ended up in. */
export async function importBytes(app: App, bytes: Uint8Array, fileName: string, intoSet?: string): Promise<string | null> {
  try {
    const r = await importBrushFile(bytes, fileName)
    let target = intoSet && library.set(intoSet) ? intoSet : ''
    if (r.setName || !target) {
      const s = library.addSet(r.setName ?? t('brushes.actions.importedSet'))
      target = s.id
    }
    for (const b of r.brushes) library.addBrush(b, target)
    app.notify(t('brushes.actions.imported', { count: r.brushes.length }) + (r.warnings.length ? ' ' + t('brushes.actions.skipped', { n: r.warnings.length }) : ''))
    return target
  } catch (e) {
    app.notify(t('brushes.actions.importFailed', { error: (e as Error).message }))
    return null
  }
}

export async function importViaDialog(app: App, intoSet?: string): Promise<string | null> {
  const r = await api().openFile({ filters: [{ name: t('brushes.actions.filter.files'), extensions: BRUSH_EXTS }] })
  if (!r) return null
  return importBytes(app, r.data, r.path, intoSet)
}

export function editBrush(app: App, b: BrushPreset, isNew = false): void {
  openBrushStudio(app, b, {
    isNew,
    onDone: (out) => {
      library.updateBrush(out)
      // keep the active tools within the (possibly changed) Properties limits
      const st = app.state
      for (const t of ['brush', 'smudge', 'eraser'] as const) {
        if (st.toolSettings[t].presetId === out.id) {
          const ts = st.toolSettings[t]
          ts.size = Math.min(out.props.maxSize, Math.max(out.props.minSize, ts.size))
        }
      }
      st.events.emit('toolSettings', undefined)
    }
  })
}
