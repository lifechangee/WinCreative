import type { App } from '../../app/app'
import { screenToDoc } from '../../core/viewTransform'
import { t, tk, type I18nText } from '../../i18n'
import type { Tool } from '../../tools/tool'
import { layerHooks } from '../layers/ops'
import { registerBwkExtension } from '../../io/bwk'
import { registerMenuItem } from '../../ui/registry'
import { setSelectionMaskProvider } from '../adjustments/session'
import { registerSelectionMaskProvider } from '../color/colorDrop'
import { clearSelection, copyPaste, selectLayerContents } from './actions'
import { Bar } from './bar'
import { workRect } from '../frame/workRect'
import { Overlay, installAnts } from './overlay'
import { SelectionService } from './selection'
import { rleDecode, rleEncode } from './rle'
import { SelectionTool, selSettings, SelShape } from './selTool'
import { saveXformSettings, xs, XMode } from './xformSession'
import { TransformTool } from './xformTool'

export { SelectionService } from './selection'

/** Feature module 'selectxform' (Selection + Transform). Exposes `app.selection`. */
export function install(app: App, ui: unknown): void {
  void ui
  const svc = new SelectionService(app)
  app.selection = svc
  ;(window as any).brushwork_selection = svc

  // hooks other feature modules expose for the selection
  registerSelectionMaskProvider((doc, rect) => (svc.data && doc === app.doc ? (rect && doc.isInfinite ? svc.readRect(rect) : svc.data) : null))
  setSelectionMaskProvider(() => (svc.mask ? { tex: svc.mask, channel: 'r' } : null))

  // saved selections ("Save & Load") travel with the document: extra.selections = [{name, rect, file}], file = RLE mask
  registerBwkExtension({
    id: 'selections',
    save: (doc) => {
      const list = svc.savedFor(doc)
      if (!list.length) return
      const files: Record<string, Uint8Array> = {}
      const meta = list.map((s, i) => {
        const file = `selections/${i}.rle`
        files[file] = rleEncode(s.snap.data)
        return { name: s.name, rect: s.snap.rect, file }
      })
      return { extra: meta, files }
    },
    load: (doc, extra, entries) => {
      const out: { name: string; snap: { rect: { x: number; y: number; w: number; h: number }; data: Uint8Array } }[] = []
      for (const m of Array.isArray(extra) ? extra : []) {
        const bytes = entries[m?.file]
        const r = m?.rect
        if (!bytes || !r || !(r.w > 0) || !(r.h > 0)) continue
        out.push({ name: String(m.name), snap: { rect: { x: r.x, y: r.y, w: r.w, h: r.h }, data: rleDecode(bytes, r.w * r.h) } })
      }
      svc.setSavedFor(doc, out)
    }
  })

  const overlay = new Overlay(app)
  const sel = new SelectionTool(app)
  const xf = new TransformTool(app)
  app.registerTool('selection', sel)
  app.registerTool('transform', xf)

  let mode: 'selection' | 'transform' | null = null
  const bar: Bar = new Bar({
    app,
    sel,
    xf,
    setShape: (s) => activateSelection(s),
    startTransform: (m) => activateTransform(m),
    closeAll: (commit) => closeAll(commit)
  })

  installAnts(app, () => mode === 'transform')

  // ---------------------------------------------------------------- tool routing + history (hooks in app/app.ts)
  // While a transform session is open, undo abandons it (instead of touching the document history); redo is swallowed.
  app.addHistoryInterceptor(
    'selectxform',
    (kind) => {
      if (!xf.session) return false
      if (kind === 'undo') {
        xf.discard()
        closeAll(false)
      }
      return true
    },
    50
  )

  function setActive(t: Tool | null, m: typeof mode): void {
    mode = m
    app.setToolOverride(t, { hideBrushCursor: true })
    app.canvas.style.cursor = t ? (m === 'transform' ? 'default' : 'crosshair') : ''
    bar.show(m)
    overlay.invalidate()
    app.requestRender()
  }

  function activateSelection(shape: SelShape): void {
    if (xf.session) xf.commit()
    if (selSettings.shape === 'free' && shape !== 'free') sel.closePolygon()
    selSettings.shape = shape
    setActive(sel, 'selection')
  }

  function activateTransform(m: XMode): void {
    if (mode === 'selection') sel.closePolygon()
    if (!xf.start(m)) {
      if (!xf.session) setActive(null, null)
      return
    }
    setActive(xf, 'transform')
  }

  function closeAll(commit = true): void {
    if (xf.session) {
      if (commit) xf.commit()
      else xf.discard()
    }
    if (mode === 'selection') sel.closePolygon()
    setActive(null, null)
  }

  // pasted / duplicated layers open the transform tool right away (layers module calls this hook after inserting)
  layerHooks.workRect = () => workRect(app)
  layerHooks.selectionBounds = () => svc.bounds()
  layerHooks.beginTransform = (layer) => {
    if (app.doc.getLayer(layer.id)) app.doc.setActive(layer.id)
    activateTransform('freeform')
  }

  xf.onChange = () => {
    overlay.invalidate()
    if (mode === 'transform' && !xf.session) setActive(null, null)
  }
  ;(window as any).brushwork_xform = { start: activateTransform, closeAll, get session() { return xf.session } } // QA handle
  sel.onChange = () => overlay.invalidate()
  svc.onChange(() => overlay.invalidate())

  // leaving to a normal tool (B / E / S keys, toolbar) ends the mode
  app.state.events.on('tool', () => {
    if (mode) closeAll(true)
  })
  app.events.on('doc', () => {
    xf.abandon()
    sel.cancelPolygon()
    svc.reset()
    setActive(null, null)
  })

  // ---------------------------------------------------------------- overlay painters
  overlay.add((ctx, s) => {
    if (mode === 'transform' && xf.session) {
      xf.session.draw(ctx, s, app.view.zoom, app.cssSize())
      return
    }
    if (mode !== 'selection') return
    const pts = sel.polygon
    if (selSettings.shape === 'free' && pts.length) {
      ctx.beginPath()
      pts.forEach((p, i) => {
        const q = s(p)
        if (i) ctx.lineTo(q.x, q.y)
        else ctx.moveTo(q.x, q.y)
      })
      ctx.lineWidth = 3
      ctx.strokeStyle = 'rgba(0,0,0,.6)'
      ctx.stroke()
      ctx.lineWidth = 1.5
      ctx.strokeStyle = '#fff'
      ctx.stroke()
      pts.forEach((p, i) => {
        const q = s(p)
        ctx.beginPath()
        ctx.arc(q.x, q.y, i === 0 ? 8 : 3.5, 0, Math.PI * 2)
        ctx.fillStyle = i === 0 ? 'rgba(76,155,255,.9)' : '#fff'
        ctx.fill()
        ctx.lineWidth = 1
        ctx.strokeStyle = '#000'
        ctx.stroke()
      })
    }
    if (selSettings.shape === 'auto' && sel.wandActive && sel.wandSeed) {
      const q = s(sel.wandSeed)
      const label = t('selectxform.threshold', { n: Math.round(sel.threshold * 100) })
      ctx.font = '600 13px system-ui, sans-serif'
      const w = ctx.measureText(label).width
      ctx.fillStyle = 'rgba(0,0,0,.75)'
      ctx.fillRect(q.x + 14, q.y - 30, w + 14, 24)
      ctx.fillStyle = '#fff'
      ctx.fillText(label, q.x + 21, q.y - 13)
    }
  })

  // hover cursor feedback for transform handles
  app.canvas.addEventListener('pointermove', (e) => {
    if (mode !== 'transform' || !xf.session || e.buttons) return
    const r = app.canvas.getBoundingClientRect()
    const { w, h } = app.cssSize()
    const p = screenToDoc(app.view, e.clientX - r.left, e.clientY - r.top, w, h)
    app.canvas.style.cursor = xf.hover(p)
  })

  // ---------------------------------------------------------------- keyboard
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
    const k = e.key.toLowerCase()
    // Ctrl+A / Ctrl+D are bound through the action registry (select.all / select.deselect -> menu items below)
    if (e.ctrlKey || e.metaKey || e.altKey) return
    else if (mode === 'transform' && xf.session) {
      if (e.key === 'Enter') {
        e.preventDefault()
        closeAll(true)
      } else if (e.key === 'Escape') {
        closeAll(false)
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault()
        const d = e.shiftKey ? 10 : 1
        xf.session.nudge(e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0)
      }
    } else if (mode === 'selection') {
      if (e.key === 'Enter' && sel.polygonOpen) sel.closePolygon()
      else if (e.key === 'Escape') {
        if (sel.polygonOpen) sel.cancelPolygon()
        else closeAll()
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && svc.hasSelection()) {
        e.preventDefault()
        clearSelection(app)
      }
    }
  })

  // ---------------------------------------------------------------- menus
  const sm = (id: string, label: I18nText, run: () => void, extra: { shortcut?: string; separator?: boolean } = {}): void =>
    registerMenuItem('selection', { id, label, run, ...extra })
  const tm = (id: string, label: I18nText, run: () => void, separator = false): void => registerMenuItem('transform', { id, label, run, separator })
  const useShape = (s: SelShape) => (): void => activateSelection(s)

  sm('sel-wand', tk('selectxform.menu.selWand'), useShape('auto'))
  sm('sel-free', tk('selectxform.menu.selFree'), useShape('free'))
  sm('sel-rect', tk('selectxform.menu.selRect'), useShape('rect'))
  sm('sel-ellipse', tk('selectxform.menu.selEllipse'), useShape('ellipse'))
  sm('sel-add', tk('selectxform.menu.selAdd'), () => ((selSettings.mode = selSettings.mode === 'add' ? 'replace' : 'add'), activateSelection(selSettings.shape)), { separator: true })
  sm('sel-remove', tk('selectxform.menu.selRemove'), () => ((selSettings.mode = selSettings.mode === 'subtract' ? 'replace' : 'subtract'), activateSelection(selSettings.shape)))
  sm('sel-invert', tk('selectxform.menu.selInvert'), () => svc.invert(), { separator: true })
  sm('sel-feather', tk('selectxform.menu.selFeather'), () => {
    activateSelection(selSettings.shape)
    ;(bar as any).toggleSub?.('feather')
  })
  sm('sel-copy', tk('selectxform.menu.selCopy'), () => void copyPaste(app, false))
  sm('sel-cut', tk('selectxform.menu.selCut'), () => void copyPaste(app, true))
  sm('sel-saveload', tk('selectxform.menu.selSaveload'), () => {
    activateSelection(selSettings.shape)
    ;(bar as any).toggleSub?.('saveload')
  })
  // "Color Fill" (selection menu) is provided by the color module: it honours the selection mask and also fills whole layers
  sm('sel-clear', tk('selectxform.menu.selClear'), () => void clearSelection(app), { shortcut: 'Del', separator: true })
  sm('sel-all', tk('selectxform.menu.selAll'), () => (xf.session && closeAll(true), svc.selectAll()), { shortcut: 'Ctrl+A', separator: true })
  sm('sel-layer', tk('selectxform.menu.selLayer'), () => void selectLayerContents(app))
  sm('sel-none', tk('selectxform.menu.selNone'), () => (xf.session && closeAll(true), svc.clear()), { shortcut: 'Ctrl+D' })

  const tf = (m: XMode) => (): void => activateTransform(m)
  tm('tf-free', tk('selectxform.menu.tfFree'), tf('freeform'))
  tm('tf-uniform', tk('selectxform.menu.tfUniform'), tf('uniform'))
  tm('tf-distort', tk('selectxform.menu.tfDistort'), tf('distort'))
  tm('tf-warp', tk('selectxform.menu.tfWarp'), tf('warp'))
  tm('tf-bend', tk('selectxform.menu.tfBend'), tf('bend'))
  tm('tf-mesh', tk('selectxform.menu.tfMesh'), () => {
    xs.advancedMesh = true
    saveXformSettings()
    activateTransform('warp')
    xf.session?.setGrid(xs.cols, xs.rows)
    bar.render()
  })
  const withSession = (fn: (s: NonNullable<typeof xf.session>) => void) => (): void => {
    if (!xf.session) activateTransform('freeform')
    if (xf.session) fn(xf.session)
  }
  tm('tf-flip-h', tk('selectxform.menu.tfFlipH'), withSession((s) => s.flip('h')), true)
  tm('tf-flip-v', tk('selectxform.menu.tfFlipV'), withSession((s) => s.flip('v')))
  tm('tf-rot45', tk('selectxform.menu.tfRot45'), withSession((s) => s.rotate45()))
  tm('tf-fit', tk('selectxform.menu.tfFit'), withSession((s) => s.fitToScreen()))
  tm('tf-reset', tk('selectxform.menu.tfReset'), withSession((s) => s.reset()))
  const interpItem = (id: 'nearest' | 'bilinear' | 'bicubic', label: string): void => {
    const lab = (i: string, l: string): string => (xs.interp === i ? '✓ ' : ' ') + l
    const reg = (): void =>
      registerMenuItem('transform', {
        id: 'tf-interp-' + id,
        label: () => lab(id, t('selectxform.interp.' + id)),
        separator: id === 'nearest',
        run: () => {
          xs.interp = id
          saveXformSettings()
          xf.session?.render()
          bar.render()
          reg2()
        }
      })
    const reg2 = (): void => {
      for (const [i, l] of [['nearest', 'Nearest Neighbor'], ['bilinear', 'Bilinear'], ['bicubic', 'Bicubic']] as const) {
        registerMenuItem('transform', {
          id: 'tf-interp-' + i,
          label: () => lab(i, t('selectxform.interp.' + i)),
          separator: i === 'nearest',
          run: () => {
            xs.interp = i
            saveXformSettings()
            xf.session?.render()
            bar.render()
            reg2()
          }
        })
      }
    }
    reg()
  }
  interpItem('nearest', 'Nearest Neighbor')
  interpItem('bilinear', 'Bilinear')
  interpItem('bicubic', 'Bicubic')
  tm('tf-magnetics', tk('selectxform.menu.tfMagnetics'), () => {
    xs.magnetics = !xs.magnetics
    saveXformSettings()
    app.notify(t('selectxform.xform.magnetics') + ' ' + (xs.magnetics ? t('core.common.on') : t('core.common.off')))
    bar.render()
  })
  tm('tf-done', tk('selectxform.menu.tfDone'), () => closeAll(true), true)
  tm('tf-cancel', tk('selectxform.menu.tfCancel'), () => closeAll(false))
}
