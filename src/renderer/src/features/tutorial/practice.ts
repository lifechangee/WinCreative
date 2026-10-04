import type { App } from '../../app/app'
import type { HSV } from '../../app/state'
import type { Sample } from '../../core/types'
import type { View } from '../../core/viewTransform'
import { Document } from '../../doc/document'
import { ephemeralDocs } from '../../doc/ephemeral'
import { t } from '../../i18n'
import { strokeHooks } from '../../tools/strokeHooks'

interface Saved {
  doc: Document
  tool: App['state']['tool']
  settings: App['state']['toolSettings']
  color: HSV
  secondary: HSV
  smoothingOverride: number | null
  view: View
}

/**
 * The temporary practice canvas. `enter()` parks the user's document (its GPU memory is kept alive through a dispose guard)
 * and shows a fresh throw-away one that is never autosaved; `leave()` puts everything back: document, tool, brush settings,
 * colour and view.
 */
export class Practice {
  doc: Document | null = null
  private saved: Saved | null = null
  private release: (() => void) | null = null
  private off: (() => void) | null = null
  onAbandon: (() => void) | null = null

  constructor(private app: App) {}

  get active(): boolean {
    return !!this.doc
  }

  enter(size = { w: 1600, h: 1000 }): Document {
    const app = this.app
    if (this.doc) return this.newCanvas(size)
    const st = app.state
    this.saved = {
      doc: app.doc,
      tool: st.tool,
      settings: JSON.parse(JSON.stringify(st.toolSettings)),
      color: { ...st.color },
      secondary: { ...st.secondaryColor },
      smoothingOverride: st.smoothingOverride,
      view: { ...app.view }
    }
    // keep the parked document alive: app.setDocument() would otherwise dispose it as soon as it is replaced
    const parked = app.doc
    const hold = new Promise<void>((res) => (this.release = res))
    const guard = (d: Document): Promise<unknown> | null => (d === parked && this.saved ? hold : null)
    app.disposeGuards.push(guard)
    this.off = () => {
      const i = app.disposeGuards.indexOf(guard)
      if (i >= 0) app.disposeGuards.splice(i, 1)
    }
    const doc = this.newCanvas(size)
    // the document may be replaced by the user (Gallery > open): then the tutorial ends without restoring anything
    const offDoc = app.events.on('doc', (d) => {
      if (this.doc && d !== this.doc) {
        offDoc()
        this.finishAbandon()
      }
    })
    this.offDocListener = offDoc
    return doc
  }

  /** A fresh blank practice canvas with clean tool defaults (also used when switching lessons). */
  newCanvas(size = { w: 1600, h: 1000 }): Document {
    const app = this.app
    const st = app.state
    const doc = Document.create(app.gpu, size.w, size.h)
    doc.name = t('tutorial.practice.name')
    ephemeralDocs.add(doc)
    this.doc = doc
    app.setDocument(doc)
    st.setTool('brush')
    st.setPreset('brush', 'hard-round')
    st.setSize(24)
    st.setOpacity(1)
    st.setColor({ h: 222, s: 0.8, v: 0.45 })
    st.smoothingOverride = null
    st.tempEraser = false
    return doc
  }
  private offDocListener: (() => void) | null = null

  private finishAbandon(): void {
    this.doc = null
    this.saved = null
    this.off?.()
    this.off = null
    this.release?.() // the parked document is really replaced now: let it be freed
    this.release = null
    this.onAbandon?.()
  }

  /** Restore the user's document and state. Safe to call twice. */
  leave(): void {
    const app = this.app
    const s = this.saved
    if (!this.doc || !s) return
    this.offDocListener?.()
    this.offDocListener = null
    app.input.releaseAll()
    this.doc = null
    this.saved = null
    app.setDocument(s.doc)
    const st = app.state
    st.toolSettings = s.settings
    st.color = { ...s.color }
    st.secondaryColor = { ...s.secondary }
    st.smoothingOverride = s.smoothingOverride
    st.setTool(s.tool)
    st.events.emit('color', undefined)
    st.events.emit('toolSettings', undefined)
    app.setView(s.view)
    this.off?.()
    this.off = null
    this.release = null // never resolved on purpose: resolving would free the document that is current again
  }

  // ---- content helpers for lesson set-ups (bypass smoothing / QuickShape so the geometry is exact)
  paint(pts: [number, number][], opts: { size?: number; color?: HSV; pressure?: number } = {}): void {
    const app = this.app
    const st = app.state
    const prev = { size: st.settings.size, color: { ...st.color }, tool: st.tool }
    st.setTool('brush')
    if (opts.size) st.setSize(opts.size)
    if (opts.color) st.setColor(opts.color)
    const tool = app.tools.get('brush')
    if (!tool || pts.length < 2) return
    const dense: [number, number][] = []
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1]
      const [x1, y1] = pts[i]
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 4))
      for (let k = i === 1 ? 0 : 1; k <= n; k++) dense.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n])
    }
    const smp = (p: [number, number], i: number): Sample => ({ x: p[0], y: p[1], pressure: opts.pressure ?? 1, tiltX: 0, tiltY: 0, twist: 0, t: performance.now() + i, pointerType: 'mouse' })
    strokeHooks.oneShot = { bypassSmoothing: true, input: (s) => [s] }
    try {
      if (tool.begin(smp(dense[0], 0), app)) {
        tool.move(dense.slice(1).map((p, i) => smp(p, i + 1)), app)
        tool.end(app)
      }
    } finally {
      strokeHooks.oneShot = null
    }
    st.setColor(prev.color)
    st.setSize(prev.size)
    st.setTool(prev.tool)
  }

  circle(cx: number, cy: number, r: number, opts: { size?: number; color?: HSV } = {}): void {
    const pts: [number, number][] = []
    for (let i = 0; i <= 48; i++) pts.push([cx + Math.cos((i / 48) * Math.PI * 2) * r, cy + Math.sin((i / 48) * Math.PI * 2) * r])
    this.paint(pts, opts)
  }

  /** Forget the undo steps of the set-up strokes so Undo in a lesson only touches the user's own work. */
  sealHistory(): void {
    this.doc?.history.clear()
    this.doc?.events.emit('history', undefined)
  }
}
