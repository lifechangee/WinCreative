import { t } from '../i18n'
import { blobHooks } from '../doc/tileStore'
import { tileMemory } from '../doc/tileMemory'
import { Emitter } from '../core/events'
import { unionRect } from '../core/geometry'
import type { Rect, Sample } from '../core/types'
import { View, fitView, toggleMirrorView } from '../core/viewTransform'
import { Document, DocOptions } from '../doc/document'
import { guardHooks } from '../doc/infiniteGuard'
import { clipMask } from '../gl/clipMask'
import { BrushEngine } from '../gl/brushEngine'
import { Compositor } from '../gl/compositor'
import { GPU } from '../gl/gpu'
import { saveHooks } from '../io/asyncSave'
import { predictionOverlay } from '../input/prediction'
import { scheduleWarmup } from '../perf/warmup'
import { registerBuiltinFilters } from '../gl/filters'
import { PointerInput } from '../input/pointerInput'
import { generateDefaultTextures } from '../brush/textures'
import { registerDefaultPresets } from '../brush/presets'
import { PaintTool } from '../tools/paintTool'
import type { Tool, ToolHost } from '../tools/tool'
import { AppState } from './state'
import { installViewport } from './viewport'

/** Returns true when it consumed the undo/redo (e.g. an open adjustment or transform session). */
export type HistoryInterceptor = (kind: 'undo' | 'redo') => boolean

export interface ToolOverrideOptions {
  /** hide the brush outline cursor while the override is active (selection / transform tools) */
  hideBrushCursor?: boolean
}

export interface AppEvents {
  /** The active document was replaced (new / open). Rebind per-document listeners here. */
  doc: Document
  view: View
  toast: string
  /** The canvas stage changed size / DPR. The ONE resize notification: every overlay canvas subscribes. */
  resize: ViewportSize
}

export interface ViewportSize {
  w: number
  h: number
  dpr: number
  /** backing-store size in device pixels */
  pw: number
  ph: number
}

/**
 * Application root: owns GPU, document, compositor, brush engine, tools, input and render loop.
 * UI modules (ui/*) receive the App and talk to it; nothing in core/ or gl/ knows about the UI.
 */
export class App implements ToolHost {
  readonly events = new Emitter<AppEvents>()
  readonly state = new AppState()
  readonly gpu: GPU
  doc!: Document
  compositor!: Compositor
  engine!: BrushEngine
  view: View = { cx: 0, cy: 0, zoom: 1, rot: 0 }
  readonly input: PointerInput
  readonly tools = new Map<string, Tool>()

  private currentTool: Tool | null = null
  private interceptors: { id: string; priority: number; fn: HistoryInterceptor }[] = []
  private override: { tool: Tool; opts: ToolOverrideOptions } | null = null
  private raf = 0
  private fullDirty = true
  private pending: Rect | null = null
  private cssW = 1
  private cssH = 1
  private dpr = 1
  private unsubDoc: (() => void) | null = null
  /**
   * Extension point: async work (autosave) that must finish before a replaced document's GPU memory is freed.
   * A guard returns a promise to hold the disposal, or null.
   */
  readonly disposeGuards: ((doc: Document) => Promise<unknown> | null)[] = []
  cursorEl: HTMLElement

  constructor(readonly canvas: HTMLCanvasElement, cursorEl: HTMLElement) {
    this.cursorEl = cursorEl
    this.gpu = new GPU(canvas)
    // WebGL context lost (driver reset / GPU process crash): every texture is gone. Pixels are not recoverable from here, so reload the window:
    // the last artwork reopens from the gallery autosave + stroke journal (main shows the translated notice).
    let lostTimer = 0
    this.gpu.contextListeners.push((st) => {
      window.clearTimeout(lostTimer)
      if (st === 'lost') lostTimer = window.setTimeout(() => window.brushwork?.gpuLost(), 4000) // never restored: reload anyway
      else window.brushwork?.gpuLost()
    })
    generateDefaultTextures()
    registerDefaultPresets()
    registerBuiltinFilters()
    this.registerTool('brush', new PaintTool('brush', 'paint'))
    this.registerTool('smudge', new PaintTool('smudge', 'smudge'))
    this.registerTool('eraser', new PaintTool('eraser', 'erase'))

    guardHooks.notify = (m) => this.notify(m)
    let corruptShown = 0
    blobHooks.onCorrupt = () => {
      if (Date.now() - corruptShown > 30000) this.notify(t('core.toast.tileCorrupt'))
      corruptShown = Date.now()
    }
    // autosave yields whenever a stroke is in progress
    saveHooks.busy = () => this.engine.active || this.input.drawing
    this.newDocument(2048, 2048)

    this.input = new PointerInput({
      canvas,
      getView: () => this.view,
      setView: (v) => this.setView(v),
      cssSize: () => ({ w: this.cssW, h: this.cssH }),
      state: this.state,
      strokeBegin: (s) => this.strokeBegin(s),
      strokeMove: (ss) => this.currentTool?.move(ss, this),
      strokeEnd: () => {
        this.currentTool?.end(this)
        this.currentTool = null
      },
      strokeCancel: () => {
        this.currentTool?.cancel(this)
        this.currentTool = null
      },
      undo: () => this.undo(),
      redo: () => this.redo(),
      cursor: (p) => this.updateCursor(p)
    })

    predictionOverlay.install(this)
    this.input.predictor = (from, pts) => predictionOverlay.update(from, pts)
    installViewport(this)
    this.resize()
    this.fit()
    scheduleWarmup(this)
  }

  /** Flip canvas: mirror the VIEW (pointer mapping, overlays and display shader follow); pixels are not touched. */
  toggleMirror(): void {
    this.setView(toggleMirrorView(this.view))
    this.notify(this.view.mirror ? t('core.toast.viewFlipped') : t('core.toast.viewRestored'))
  }

  /** Painted tip of the stroke in progress (document coords) or null. */
  get strokeTip(): { x: number; y: number } | null {
    return this.currentTool?.tip ?? null
  }

  /** Extension point: add a tool. Tools are looked up by AppState.effectiveTool. */
  registerTool(id: string, tool: Tool): void {
    this.tools.set(id, tool)
  }

  /**
   * Extension point: modal editors (adjustment sessions, transform...) take over Ctrl+Z / Ctrl+Shift+Z while they are open.
   * Interceptors run highest priority first (ties: registration order); the first one returning true consumes the
   * request, otherwise the document history is used. Returns an unregister function. Re-registering an id replaces it.
   */
  addHistoryInterceptor(id: string, fn: HistoryInterceptor, priority = 0): () => void {
    this.interceptors = this.interceptors.filter((i) => i.id !== id)
    this.interceptors.push({ id, priority, fn })
    this.interceptors.sort((a, b) => b.priority - a.priority)
    return () => void (this.interceptors = this.interceptors.filter((i) => i.fn !== fn))
  }

  /**
   * Extension point: route pointer strokes to `tool` instead of the toolbar's tool (selection / transform modes).
   * Pass null to go back to the normal tool. Unlike registerTool this does not depend on AppState.effectiveTool.
   */
  setToolOverride(tool: Tool | null, opts: ToolOverrideOptions = {}): void {
    this.override = tool ? { tool, opts } : null
    if (this.brushCursorHidden) this.cursorEl.style.display = 'none'
  }
  /** True while a tool override wants the brush outline cursor hidden (read by the cursor renderer). */
  get brushCursorHidden(): boolean {
    return !!this.override?.opts.hideBrushCursor
  }

  // ---------------------------------------------------------------- documents
  newDocument(w: number, h: number, opts: DocOptions = {}): Document {
    return this.setDocument(Document.create(this.gpu, w, h, opts))
  }

  setDocument(doc: Document): Document {
    this.input?.releaseAll()
    const old = this.doc
    this.unsubDoc?.()
    this.doc = doc
    if (this.compositor) this.compositor.setDocument(doc)
    else this.compositor = new Compositor(this.gpu, doc)
    this.compositor.inf.onPending = () => this.requestRender()
    tileMemory.configure(this.gpu)
    tileMemory.onRestored = () => this.requestRender()
    clipMask.off = doc.isInfinite // legacy flag (smart selection checks it); the selection mask itself works on infinite docs through ClipCtx
    if (this.engine) this.engine.setDocument(doc)
    else this.engine = new BrushEngine(this.gpu, doc)
    const off1 = doc.events.on('change', ({ rect }) => this.markDirty(rect))
    this.unsubDoc = () => off1()
    if (old && old !== doc) this.retire(old)
    this.fullDirty = true
    this.fit()
    this.events.emit('doc', doc)
    this.requestRender()
    return doc
  }

  /** Free a replaced document once every dispose guard (unsaved-edit autosave) has finished; never leaves it half-alive. */
  private retire(old: Document): void {
    const holds: Promise<unknown>[] = []
    for (const g of this.disposeGuards) {
      try {
        const h = g(old)
        if (h) holds.push(h)
      } catch (e) {
        console.error('[app] dispose guard failed', e)
      }
    }
    if (!holds.length) old.dispose()
    else this.retiring.set(
        old,
        Promise.allSettled(holds).then(() => {
          old.dispose()
          this.retiring.delete(old)
        })
      )
  }
  private retiring = new Map<Document, Promise<void>>()
  /** Promise that resolves once a replaced document is really disposed (null when it already is / never was held). */
  whenRetired(doc: Document): Promise<void> | null {
    return this.retiring.get(doc) ?? null
  }

  // ---------------------------------------------------------------- tools
  private strokeBegin(s: Sample): boolean {
    const tool = this.override?.tool ?? this.tools.get(this.state.effectiveTool)
    if (!tool) return false
    if (!tool.begin(s, this)) return false
    this.currentTool = tool
    return true
  }

  undo(): void {
    if (this.engine.active) return
    if (this.intercept('undo')) return
    this.doc.undo()
  }
  redo(): void {
    if (this.engine.active) return
    if (this.intercept('redo')) return
    this.doc.redo()
  }
  private intercept(kind: 'undo' | 'redo'): boolean {
    for (const i of this.interceptors) if (i.fn(kind)) return true
    return false
  }

  notify(message: string): void {
    this.events.emit('toast', message)
  }

  // ---------------------------------------------------------------- view + rendering
  setView(v: View): void {
    this.view = v
    this.events.emit('view', v)
    this.requestRender()
  }

  fit(): void {
    if (!this.doc) return
    if (this.doc.isInfinite) return this.fitContent(true)
    this.setView(fitView(this.doc.width, this.doc.height, this.cssW, this.cssH, 48, this.view.mirror))
  }

  /**
   * Infinite canvas: fit the painted content (tight bounds of the visible layers). With `restore`, a document that was saved with a view
   * (and is being (re)opened) goes back to it; an empty canvas shows the origin at 100%.
   */
  fitContent(restore = false): void {
    const doc = this.doc
    if (!doc.isInfinite) return this.fit()
    const saved = restore ? doc.infinite.view : undefined
    if (saved) return this.setView({ cx: saved.cx, cy: saved.cy, zoom: saved.zoom, rot: 0, ...(this.view.mirror ? { mirror: true } : {}) })
    const b = doc.contentBounds({ tight: true, visibleOnly: true })
    if (!b) return this.setView({ cx: 0, cy: 0, zoom: 1, rot: 0, ...(this.view.mirror ? { mirror: true } : {}) })
    const v = fitView(Math.max(b.w, 1), Math.max(b.h, 1), this.cssW, this.cssH, 48, this.view.mirror)
    this.setView({ ...v, cx: b.x + b.w / 2, cy: b.y + b.h / 2, zoom: Math.min(v.zoom, 1) })
  }

  /** Infinite canvas: put the document origin (0,0) back at the centre of the screen. */
  goToOrigin(): void {
    if (!this.doc.isInfinite) return this.fit()
    this.setView({ ...this.view, cx: 0, cy: 0 })
  }

  cssSize(): { w: number; h: number } {
    return { w: this.cssW, h: this.cssH }
  }

  /** Re-measure the stage; resizes the GL backing store and notifies every overlay once (only when something changed). */
  resize(dpBox?: { w: number; h: number }): void {
    const p = this.canvas.parentElement!
    const w = Math.max(1, p.clientWidth)
    const h = Math.max(1, p.clientHeight)
    const dpr = window.devicePixelRatio || 1
    const pw = Math.max(1, dpBox ? dpBox.w : Math.round(w * dpr))
    const ph = Math.max(1, dpBox ? dpBox.h : Math.round(h * dpr))
    if (w === this.cssW && h === this.cssH && dpr === this.dpr && (!dpBox || (pw === this.canvas.width && ph === this.canvas.height))) return
    this.cssW = w
    this.cssH = h
    this.dpr = dpr
    this.canvas.width = pw
    this.canvas.height = ph
    this.events.emit('resize', { w, h, dpr, pw, ph })
    this.requestRender()
  }

  private markDirty(rect: Rect | null): void {
    if (!rect) this.fullDirty = true
    else this.pending = unionRect(this.pending, rect)
    this.requestRender()
  }

  requestRender(): void {
    if (!this.raf) this.raf = requestAnimationFrame(this.frame)
  }

  /** Compose what changed since the last frame into the compositor now (the time-lapse capture must show the state it is tagged with). */
  syncComposite(): void {
    const live = this.engine.live
    const dirty = unionRect(this.engine.takeDirty(), this.pending)
    this.pending = null
    if (this.fullDirty) {
      this.compositor.compose(live, null)
      this.fullDirty = false
    } else if (dirty) this.compositor.compose(live, dirty)
  }

  private frame = (): void => {
    this.raf = 0
    this.syncComposite()
    this.compositor.present(this.view, this.cssW, this.cssH, this.dpr)
  }

  /** Render synchronously (self-test / screenshots). */
  renderNow(): void {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    this.fullDirty = true
    this.frame()
  }

  private updateCursor(p: { x: number; y: number; pointerType: string } | null): void {
    const el = this.cursorEl
    if (!p || this.brushCursorHidden) {
      el.style.display = 'none'
      return
    }
    const d = Math.max(4, this.state.settings.size * this.view.zoom)
    el.style.display = 'block'
    el.style.width = el.style.height = d + 'px'
    el.style.transform = `translate(${p.x - d / 2}px, ${p.y - d / 2}px)`
  }
}
