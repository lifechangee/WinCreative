import type { App } from '../../app/app'
import { registerAction } from '../../input/actions'
import { registerBwkExtension } from '../../io/bwk'
import { bindLang, t, tk } from '../../i18n'
import { h, icon } from '../../ui/dom'
import { registerMenuItem, type UIContext } from '../../ui/registry'
import { Overlay } from '../guides/overlay'
import { fitView } from '../../core/viewTransform'
import { dragFrame, MIN_FRAME, type FrameData, type Handle } from './model'
import { FRAME_CSS, renderPanel, type PanelCtx } from './panel'
import { commitFrame, editFrame, frameEvents, getFrame, setActiveDoc, setFrameRaw } from './state'
import { frameRect } from './workRect'
import { getRecorder } from '../animio/timelapse'

export { workRect, frameRect, frameEnabled } from './workRect'
export { getFrame, editFrame } from './state'

const DIM_KEY = 'wc.frame.dim'
export const frameUi = { editing: false, dim: 0.55 }
try {
  const v = Number(localStorage.getItem(DIM_KEY))
  if (v > 0 && v <= 0.95) frameUi.dim = v
} catch {
  /* storage unavailable */
}

/** Create (or replace the size of) the frame: centred on the canvas (fixed) or on the view centre (infinite). */
export function createFrame(app: App, w: number, h: number, preset?: string): void {
  const doc = app.doc
  const cur = getFrame(doc)
  const cx = doc.isInfinite ? app.view.cx : doc.width / 2
  const cy = doc.isInfinite ? app.view.cy : doc.height / 2
  // a fixed canvas smaller than the preset: scale the preset down to fit, keeping its aspect
  const k = doc.isInfinite ? 1 : Math.min(1, doc.width / w, doc.height / h)
  const fw = Math.max(MIN_FRAME, Math.round(w * k))
  const fh = Math.max(MIN_FRAME, Math.round(h * k))
  const x = Math.round(cx - fw / 2)
  const y = Math.round(cy - fh / 2)
  editFrame(doc, { x, y, w: fw, h: fh, enabled: cur?.enabled ?? true, visible: cur?.visible ?? true, preset }, t('frame.title'))
  app.notify(t('frame.created', { w: fw, h: fh }))
}

export function toggleFrame(app: App): void {
  const doc = app.doc
  const f = getFrame(doc)
  if (!f) {
    frameUi.editing = false
    createFrame(app, 1080, 1920, 'reels')
    return
  }
  editFrame(doc, { enabled: !f.enabled }, t('frame.title'))
  app.notify(t(f.enabled ? 'frame.off' : 'frame.on'))
}

export function fitFrame(app: App): void {
  const r = frameRect(app.doc)
  if (!r) return app.fitContent()
  const s = app.cssSize()
  const v = fitView(r.w, r.h, s.w, s.h, 48, app.view.mirror)
  app.setView({ ...v, cx: r.x + r.w / 2, cy: r.y + r.h / 2 })
}

export function install(app: App, ui?: unknown): void {
  const uiCtx = ui as UIContext | undefined
  setActiveDoc(app.doc)
  ;(window as unknown as { brushwork_frame: unknown }).brushwork_frame = { createFrame: (w: number, h: number, preset?: string) => createFrame(app, w, h, preset), editFrame: (p: Partial<FrameData> | null) => editFrame(app.doc, p, 'Frame'), getFrame: () => getFrame(app.doc), toggle: () => toggleFrame(app), fit: () => fitFrame(app) }
  app.events.on('doc', (d) => {
    frameUi.editing = false
    setActiveDoc(d)
    syncButton()
  })

  // ---- persistence
  registerBwkExtension({
    id: 'frame',
    save: (doc) => {
      const f = getFrame(doc)
      return f ? { extra: f } : undefined
    },
    load: (doc, extra) => {
      const e = extra as Partial<FrameData> | undefined
      if (e && [e.x, e.y, e.w, e.h].every((n) => Number.isFinite(n))) setFrameRaw(doc, { x: e.x!, y: e.y!, w: e.w!, h: e.h!, enabled: e.enabled !== false, visible: e.visible !== false, preset: e.preset })
      else setFrameRaw(doc, null)
    }
  })

  // ---- actions (bindable: shortcuts, QuickMenu slots, pen buttons)
  registerAction({ id: 'frame.toggle', label: tk('frame.action.toggle'), category: 'View', defaultKeys: ['Ctrl+Shift+F'], run: () => toggleFrame(app) })
  registerAction({ id: 'frame.edit', label: tk('frame.action.edit'), category: 'View', run: () => setEditing(!frameUi.editing) })
  registerAction({ id: 'frame.fit', label: tk('frame.action.fit'), category: 'View', run: () => fitFrame(app) })
  registerAction({
    id: 'frame.show',
    label: tk('frame.action.show'),
    category: 'View',
    run: () => {
      const f = getFrame(app.doc)
      if (f) editFrame(app.doc, { visible: !f.visible }, t('frame.title'))
    }
  })
  registerMenuItem('actions', { id: 'frame-panel', group: 'canvas', label: tk('frame.menu.panel'), run: () => openPanel() })

  // ---- fitContent prefers the frame
  const origFit = app.fitContent.bind(app)
  app.fitContent = (restore = false): void => {
    if (getFrame(app.doc) && !(restore && app.doc.infinite.view)) return fitFrame(app)
    origFit(restore)
  }

  // ---- overlay: dim + outline + handles
  const overlay = new Overlay(app)
  overlay.canvas.style.zIndex = '1'
  type R = { x: number; y: number; w: number; h: number }
  const corners = (r: R): { x: number; y: number }[] =>
    [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]].map(([x, y]) => overlay.toScreen({ x, y }))
  const handlePts = (r: R): [Handle, { x: number; y: number }][] => {
    const mx = r.x + r.w / 2
    const my = r.y + r.h / 2
    const Rt = r.x + r.w
    const B = r.y + r.h
    const pts: [Handle, number, number][] = [['nw', r.x, r.y], ['n', mx, r.y], ['ne', Rt, r.y], ['e', Rt, my], ['se', Rt, B], ['s', mx, B], ['sw', r.x, B], ['w', r.x, my]]
    return pts.map(([k, x, y]) => [k, overlay.toScreen({ x, y })])
  }
  overlay.addPainter((c, w, hh) => {
    const f = getFrame(app.doc)
    if (!f) return
    const q = corners(f)
    const path = (): void => {
      c.moveTo(q[0].x, q[0].y)
      for (let i = 1; i < 4; i++) c.lineTo(q[i].x, q[i].y)
      c.closePath()
    }
    if (f.enabled) {
      c.beginPath()
      c.rect(0, 0, w, hh)
      path()
      c.fillStyle = `rgba(0,0,0,${frameUi.dim})`
      c.fill('evenodd')
    } else if (!f.visible && !frameUi.editing) return
    c.beginPath()
    path()
    if (f.enabled) {
      c.lineWidth = 2
      c.strokeStyle = '#ffffff'
      c.stroke()
      c.lineWidth = 1
      c.strokeStyle = 'rgba(0,0,0,0.6)'
      c.stroke()
    } else {
      c.lineWidth = 1
      c.setLineDash([6, 4])
      c.strokeStyle = 'rgba(255,255,255,0.9)'
      c.stroke()
      c.strokeStyle = 'rgba(0,0,0,0.5)'
      c.lineDashOffset = 5
      c.stroke()
      c.setLineDash([])
    }
    // size label above the top-most corner (kept on screen: inside the frame when there is no room above)
    const label = `${f.w} × ${f.h}`
    c.font = '12px "Segoe UI", system-ui, sans-serif'
    const tw = c.measureText(label).width
    const top = q.reduce((a, b) => (b.y < a.y ? b : a))
    const lw = tw + 12
    const lx = Math.min(Math.max(4, top.x - 2), Math.max(4, w - lw - 4))
    let ly = top.y - 24
    if (ly < 4) ly = Math.min(hh - 24, top.y + 6)
    c.fillStyle = 'rgba(0,0,0,0.7)'
    c.beginPath()
    c.roundRect(lx, ly, lw, 20, 6)
    c.fill()
    c.fillStyle = '#fff'
    c.textBaseline = 'middle'
    c.fillText(label, lx + 6, ly + 10.5)
    if (frameUi.editing) {
      const hs = handleSize()
      for (const [k, p] of handlePts(f)) {
        c.beginPath()
        if (k.length === 2) c.arc(p.x, p.y, hs / 2 + 1, 0, Math.PI * 2)
        else c.roundRect(p.x - hs / 2, p.y - hs / 2, hs, hs, 4)
        c.fillStyle = '#fff'
        c.fill()
        c.lineWidth = 2
        c.strokeStyle = '#3b82f6'
        c.stroke()
      }
      const pill = donePill(w, hh, q)
      c.fillStyle = '#3b82f6'
      c.beginPath()
      c.roundRect(pill.x, pill.y, pill.w, pill.h, 16)
      c.fill()
      c.fillStyle = '#fff'
      c.font = '600 13px "Segoe UI", system-ui, sans-serif'
      c.textAlign = 'center'
      c.fillText('✓ ' + t('frame.editDone'), pill.x + pill.w / 2, pill.y + pill.h / 2 + 0.5)
    }
  }, -10)
  let lockAspect = false
  /** pen / touch friendly: big visible handles and an even bigger pick radius */
  const handleSize = (): number => 16
  const PICK = 26
  const donePill = (w: number, _hh: number, _q: { x: number; y: number }[]): { x: number; y: number; w: number; h: number } => {
    c2.font = '600 13px "Segoe UI", system-ui, sans-serif'
    const pw = Math.ceil(c2.measureText('✓ ' + t('frame.editDone')).width) + 28
    // top centre of the stage: clear of the toasts (bottom), the sidebar (left) and every frame position
    return { x: Math.max(8, (w - pw) / 2), y: 12, w: pw, h: 32 }
  }
  const c2 = document.createElement('canvas').getContext('2d')!
  const inside = (r: R, p: { x: number; y: number }): boolean => p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h
  overlay.addInteractor({
    pick: (sx, sy, e) => {
      const doc = app.doc
      const f = getFrame(doc)
      if (!f || !frameUi.editing) return null
      const pill = donePill(overlay.w, overlay.h, corners(f))
      if (sx >= pill.x && sx <= pill.x + pill.w && sy >= pill.y && sy <= pill.y + pill.h) return { move: () => undefined, up: () => setEditing(false) }
      let handle: Handle | null = null
      let best = PICK
      for (const [k, p] of handlePts(f)) {
        // corners get a bonus so a small frame stays resizable
        const d = Math.hypot(p.x - sx, p.y - sy) - (k.length === 2 ? 8 : 0)
        if (d < best) {
          best = d
          handle = k
        }
      }
      const start = overlay.toDoc(sx, sy)
      if (!handle) {
        if (!inside(f, start)) return null
        handle = 'move'
      }
      const before = { ...f }
      const hd = handle
      return {
        move: (mx, my, ev) => {
          const p = overlay.toDoc(mx, my)
          const r = dragFrame(before, hd, p.x - start.x, p.y - start.y, ev.shiftKey || e.shiftKey || lockAspect)
          setFrameRaw(doc, { ...before, ...r })
        },
        up: () => commitFrame(doc, before, getFrame(doc), t('frame.title'))
      }
    }
  })
  window.addEventListener('keydown', (e) => {
    if (frameUi.editing && (e.key === 'Escape' || e.key === 'Enter')) setEditing(false)
  })
  function setEditing(on: boolean): void {
    if (on && !getFrame(app.doc)) return
    frameUi.editing = on
    overlay.redraw()
  }
  // a recording that holds only its blank first frame adopts the aspect of the new frame
  frameEvents.on('commit', (d) => getRecorder(d)?.relockIfBlank())
  frameEvents.on('change', () => {
    overlay.redraw()
    syncButton()
  })

  // ---- top-bar button (frame icon; accent = clipping ON, dot = frame exists)
  const st = h('style', { text: FRAME_CSS })
  document.head.append(st)
  const btn = h('button', { class: 'tb-icon bw-frame-btn', 'data-tip': tk('frame.btn.tip'), 'aria-label': tk('frame.title') }, icon('frame', 22), h('span', { class: 'fr-dot' }))
  const tbRight = document.querySelector('.topbar .tb-right')
  const layersBtn = tbRight?.querySelector('.tb-layers')
  if (tbRight) tbRight.insertBefore(btn, layersBtn ?? tbRight.firstChild)
  else app.canvas.parentElement!.append(btn)
  let swallow = false
  let lp = 0
  btn.addEventListener('pointerdown', (e) => {
    swallow = false
    clearTimeout(lp)
    if (e.button !== 0) return
    lp = window.setTimeout(() => {
      swallow = true
      openPanel()
    }, 480)
  })
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, () => clearTimeout(lp))
  btn.addEventListener('click', () => {
    if (swallow) return void (swallow = false)
    // no frame yet: the panel (presets) is the way to make one; with a frame the button toggles clipping
    if (!getFrame(app.doc)) return openPanel()
    toggleFrame(app)
  })
  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    openPanel()
  })
  function syncButton(): void {
    const f = getFrame(app.doc)
    btn.classList.toggle('has', !!f)
    btn.classList.toggle('on', !!f?.enabled)
    btn.setAttribute('aria-pressed', String(!!f?.enabled))
  }
  syncButton()

  // ---- settings panel
  const panelCtx: PanelCtx = {
    app,
    editing: () => frameUi.editing,
    setEditing,
    getLock: () => lockAspect,
    setLock: (v) => (lockAspect = v),
    dim: () => frameUi.dim,
    setDim: (v) => {
      frameUi.dim = v
      try {
        localStorage.setItem(DIM_KEY, String(v))
      } catch {
        /* ignore */
      }
      overlay.redraw()
    },
    create: (w, hh, preset) => {
      const first = !getFrame(app.doc)
      createFrame(app, w, hh, preset)
      // the first frame closes the panel (the canvas is what you want to see next); later presets keep it open
      if (first) uiCtx?.popovers.close()
      else if (panelBody) renderPanel(panelCtx, panelBody, redoPanel)
    },
    fit: () => fitFrame(app)
  }
  let panelBody: HTMLElement | null = null
  const redoPanel = (): void => {
    if (panelBody) renderPanel(panelCtx, panelBody, redoPanel)
  }
  function openPanel(): void {
    if (!uiCtx) return
    uiCtx.popovers.open(
      'frame',
      btn,
      (body) => {
        panelBody = body
        renderPanel(panelCtx, body, redoPanel)
        return () => (panelBody = null)
      },
      { align: 'right', width: 330, title: tk('frame.title') }
    )
  }
  bindLang(syncButton)

  // BW_FRAME_SELFTEST=1: frame self-test (features/frame/selftest.ts)
  void window.bwGallery?.env('BW_FRAME_SELFTEST').then((v) => {
    if (v !== '1') return
    void import('./selftest').then(async (m) => {
      const ok = await m.runFrameSelfTest(app)
      await window.brushwork?.selfTestDone({ ok })
    })
  })
}
