import type { App } from '../../app/app'
import { t } from '../../i18n'
import type { UIContext } from '../../ui/registry'
import type { Document } from '../../doc/document'
import { setDocMeta } from './docMeta'
import { installAnimationUi } from './animUi'
import { installCanvasMenu } from './canvasMenu'
import { installPagesUi } from './pages'
import { installShareMenu } from './shareUi'
import { getRecorder, installTimelapse } from './timelapse'
import { installTimelapseUi } from './tlUi'
import { closeTimelapseEditor, installTimelapseEditor, openTimelapseEditor } from './tlEditor'
import { exportTimelapse, resolveRecorder } from './tlExport'
import { encodeDocument, openAnyFile } from './shareUi'
import { galleryRef } from '../color/galleryRef'
import { saveBwk, loadBwk } from '../../io/bwk'

/** Feature module 'animio' — installed once at startup after buildUI(). */
export function install(app: App, uiArg: unknown): void {
  const ui = uiArg as UIContext
  const tl = installTimelapse(app)
  installTimelapseUi(app, ui, tl)
  installTimelapseEditor(app, ui)
  // Animation Assist and Page Assist both override what the compositor shows: only one may be on.
  let pages: ReturnType<typeof installPagesUi> | null = null
  const anim = installAnimationUi(app, ui, { onEnable: () => pages?.setEnabled(false) })
  pages = installPagesUi(app, ui, { onEnable: () => anim.setEnabled(false) })
  installShareMenu(app, ui, anim)
  installCanvasMenu(app, ui)
  const applyCanvasOptions = (doc: Document, o: { timelapse?: string; dpi?: number; profile?: string }): void => {
    const q = String(o.timelapse ?? '').toLowerCase()
    const rec = getRecorder(doc)
    if (rec && (q === 'max' || q === 'hd' || q === 'small')) rec.setQuality(q)
    setDocMeta(doc, { ...(o.dpi ? { dpi: o.dpi } : {}), ...(o.profile ? { profile: o.profile } : {}) })
  }
  ;(window as any).brushwork_animio = { tl, anim, pages, applyCanvasOptions, tle: { open: (o?: { exportNow?: boolean }) => openTimelapseEditor(app, ui, o), close: closeTimelapseEditor, resolve: resolveRecorder, export: exportTimelapse } }
  // debug / QA handle (headless verification of the packaged app)
  ;(window as any).brushwork_io = { encodeDocument: (fmt: any, o: any) => encodeDocument(app, fmt, o), openAnyFile: (b: Uint8Array, n: string) => openAnyFile(app, b, n), saveBwk: () => saveBwk(app.doc, app.compositor), loadBwk: (b: Uint8Array) => loadBwk(b, app.gpu), gallery: () => galleryRef.store }
  // files handed over by the OS: double-click / "Open with" .bwk, second launch (see main/index.ts)
  const openExternal = async (f: { path: string; data: Uint8Array }): Promise<void> => {
    try {
      const d = await openAnyFile(app, f.data, f.path)
      const store = galleryRef.store
      await store?.flush()
      if (store) await store.addDocument(d, { name: d.name })
      app.setDocument(d)
      ui.toast(t('animio.share.opened', { name: d.name }))
    } catch (e) {
      ui.toast(t('animio.open.failed', { file: f.path.replace(/^.*[\/]/, ''), error: (e as Error).message }))
    }
  }
  window.brushwork?.onOpenFile?.((f) => void openExternal(f))
  setTimeout(() => {
    void galleryRef.ready.then(async () => {
      for (const f of (await window.brushwork?.takeOpenFiles?.()) ?? []) await openExternal(f)
    })
  }, 0)
  void window.animio?.testConfig().then((cfg) => {
    if (cfg) void import('./selftest').then((m) => m.runAnimioSelfTest(app, cfg.out))
  })
}
