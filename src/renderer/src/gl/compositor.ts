import { blendIndex } from '../core/blend'
import { TILE, TileKey, tileKeyX, tileKeyY } from '../core/tiles'
import type { Rect } from '../core/types'
import type { View } from '../core/viewTransform'
import type { Document } from '../doc/document'
import type { Layer } from '../doc/layer'
import { childrenOf } from '../doc/layerTree'
import type { LiveStroke } from './brushEngine'
import { setStrokeUniforms } from './brushEngine'
import { GPU, Surface } from './gpu'
import { DISPLAY_FS, FS_VERT } from './shaders'
import { GROUP_MIX_FS, LAYER_COMPOSITE_FS } from './layerShaders'
import { FlatImage, InfCompositor } from './infCompositor'

interface Ref {
  tex: WebGLTexture
  surf: Surface | null
}
interface Op {
  layer: Layer
  clip: Layer | null
  /** language ghost: a cell of another language drawn faintly (display only) */
  ghost?: boolean
}

interface PassOpts {
  opacity: number
  blend: number
  /** the layer that owns the mask (its texture is resolved per tile on infinite documents) */
  mask: Layer | null
  maskOn: boolean
  maskView: boolean
  clip: Layer | null
  live: LiveStroke | null
  liveTarget: 0 | 1 | 2
  liveAlphaLock: boolean
}

const NO_PASS: PassOpts = { opacity: 0, blend: 0, mask: null, maskOn: false, maskView: false, clip: null, live: null, liveTarget: 0, liveAlphaLock: false }

/**
 * Renders a list of sibling layers (recursing into groups, masks, clipping masks, live stroke)
 * into a destination surface. Owns its ping-pong / group scratch surfaces (allocated lazily per
 * nesting depth). Used by the Compositor for the screen composite and by merge/flatten ops.
 */
export class StackRenderer {
  private P: Surface[][] = []
  private G: Surface[] = []
  /** infinite canvas: while set, layers are read from this tile of their TileStore and buffers are TILE-sized */
  private tileKey: TileKey | null = null
  /** language variants: render as this language instead of the document's view language (recordings, exports) */
  lang: string | null = null
  /** display only (the screen renderer): cells of the other languages are drawn at 25 % */
  ghost = false

  constructor(
    private gpu: GPU,
    private getDoc: () => Document
  ) {}

  private ping(depth: number, i: number): Surface {
    const doc = this.getDoc()
    const row = (this.P[depth] ??= [])
    return (row[i] ??= doc.isInfinite ? this.gpu.surface(TILE, TILE, doc.format) : this.gpu.surface(doc.width, doc.height, doc.format))
  }
  private groupBuf(depth: number): Surface {
    const doc = this.getDoc()
    return (this.G[depth] ??= doc.isInfinite ? this.gpu.surface(TILE, TILE, doc.format) : this.gpu.surface(doc.width, doc.height, doc.format))
  }
  /** texture holding `layer`'s pixels for the current pass (the whole layer, or its tile in tile mode) */
  /** texture of `layer`'s mask for the current pass (infinite masks: the tile, or the fill value where it has none) */
  private maskTexOf(layer: Layer): WebGLTexture {
    const m = layer.mask!
    if (!m.inf) return m.tex
    const dflt = layer.maskFill ? this.gpu.white : this.gpu.blank
    return this.tileKey === null ? dflt : (m.inf.getKey(this.tileKey)?.tex ?? dflt)
  }
  private texOf(layer: Layer): WebGLTexture {
    if (this.tileKey === null) return layer.pixels.tex
    return layer.tiles?.getKey(this.tileKey)?.tex ?? this.gpu.blank
  }

  /**
   * Infinite canvas: render `sibs` for ONE tile (level 0) into `dest` (a TILE x TILE surface). `rect` is tile-local (scissor).
   * Clipping, groups (pass-through / isolated), blend modes, alpha lock and the live stroke work exactly as on fixed documents.
   */
  renderTile(sibs: Layer[], key: TileKey, dest: Surface, live: LiveStroke | null, rect: Rect | null): void {
    this.tileKey = key
    try {
      this.render(sibs, dest, live, rect)
    } finally {
      this.tileKey = null
    }
  }

  dispose(): void {
    for (const r of this.P) r?.forEach((s) => s?.dispose())
    this.G.forEach((s) => s?.dispose())
    this.P = []
    this.G = []
  }

  /** Render `sibs` (bottom -> top) into `dest`. `rect` limits the recomputed region (scissor). */
  render(sibs: Layer[], dest: Surface, live: LiveStroke | null, rect: Rect | null): void {
    const gl = this.gpu.gl
    gl.disable(gl.BLEND)
    this.composeList(sibs, { tex: this.gpu.blank, surf: null }, 0, dest, rect, live)
    gl.disable(gl.SCISSOR_TEST)
  }

  private buildOps(sibs: Layer[]): Op[] {
    const ops: Op[] = []
    let base: Layer | null = null
    const lang = this.lang ?? this.getDoc().viewLang
    const shown = (l: Layer): boolean => l.visible && (!l.lang || l.lang === lang) // other languages' cells are hidden completely
    const ghosted = (l: Layer): boolean => this.ghost && l.visible && !!l.lang && l.lang !== lang && !l.isGroup
    for (const l of sibs) {
      if (l.isGroup) {
        base = null
        if (shown(l)) ops.push({ layer: l, clip: null })
        continue
      }
      if (ghosted(l)) {
        ops.push({ layer: l, clip: null, ghost: true })
        continue
      }
      if (l.clipping && base) {
        if (shown(base) && shown(l)) ops.push({ layer: l, clip: base })
      } else {
        base = l
        if (shown(l)) ops.push({ layer: l, clip: null })
      }
    }
    return ops
  }

  private pick(depth: number, cur: Ref): Surface {
    const a = this.ping(depth, 0)
    return cur.surf === a ? this.ping(depth, 1) : a
  }

  private composeList(sibs: Layer[], back: Ref, depth: number, dest: Surface, rect: Rect | null, live: LiveStroke | null): Ref {
    const ops = this.buildOps(sibs)
    let cur = back
    if (!ops.length) {
      // copy the backdrop through (opacity 0 pass)
      this.pass(cur.tex, this.gpu.blank, dest, rect, NO_PASS)
      return { tex: dest.tex, surf: dest }
    }
    for (let i = 0; i < ops.length; i++) {
      const target = i === ops.length - 1 ? dest : this.pick(depth, cur)
      this.doOp(ops[i], cur, target, depth, rect, live)
      cur = { tex: target.tex, surf: target }
    }
    return cur
  }

  private doOp(op: Op, cur: Ref, target: Surface, depth: number, rect: Rect | null, live: LiveStroke | null): void {
    const { layer, clip } = op
    const gk = op.ghost ? 0.25 : 1
    const doc = this.getDoc()
    const gpu = this.gpu
    if (layer.isGroup) {
      const kids = childrenOf(doc.layers, layer.id)
      const maskOn = !!layer.mask && layer.maskEnabled
      if (layer.passThrough) {
        if (layer.opacity >= 0.999 && !maskOn) {
          this.composeList(kids, cur, depth + 1, target, rect, live)
          return
        }
        const g = this.groupBuf(depth)
        this.composeList(kids, cur, depth + 1, g, rect, live)
        const p = gpu.program('group-mix', FS_VERT, GROUP_MIX_FS).use()
        gpu.bindTex(0, cur.tex)
        gpu.bindTex(1, g.tex)
        gpu.bindTex(2, maskOn ? this.maskTexOf(layer) : gpu.blank)
        p.i('uBack', 0).i('uGrp', 1).i('uMask', 2).f('uK', layer.opacity).f('uMaskOn', maskOn ? 1 : 0)
        gpu.bindTarget(target, rect)
        gpu.fullscreen()
      } else {
        const g = this.groupBuf(depth)
        this.composeList(kids, { tex: gpu.blank, surf: null }, depth + 1, g, rect, live)
        this.pass(cur.tex, g.tex, target, rect, { ...NO_PASS, opacity: layer.opacity, blend: blendIndex(layer.blendMode), mask: layer.mask ? layer : null, maskOn })
      }
      return
    }
    let liveArg: LiveStroke | null = null
    let liveTarget: 0 | 1 | 2 = 0
    let liveAlphaLock = false
    if (live && live.layerId === layer.id) {
      liveArg = live
      liveTarget = layer.editingMask && layer.mask ? 1 : 0
      liveAlphaLock = liveTarget === 0 && layer.alphaLock
    } else if (live && clip && live.layerId === clip.id && !(clip.editingMask && clip.mask)) {
      // a clipped layer above the layer being painted: its clip alpha must include the live stroke
      liveArg = live
      liveTarget = 2
      liveAlphaLock = clip.alphaLock
    }
    const view = layer.maskView && !!layer.mask
    this.pass(cur.tex, this.texOf(layer), target, rect, {
      opacity: view ? 1 : layer.opacity * gk,
      blend: view ? 0 : blendIndex(layer.blendMode),
      mask: layer.mask ? layer : null,
      maskOn: !!layer.mask && (layer.maskEnabled || layer.maskView),
      maskView: view,
      clip: view ? null : clip,
      live: liveArg,
      liveTarget,
      liveAlphaLock
    })
  }

  private pass(backTex: WebGLTexture, srcTex: WebGLTexture, target: Surface, rect: Rect | null, o: PassOpts): void {
    const gpu = this.gpu
    const blank = gpu.blank
    const p = gpu.program('layer-composite', FS_VERT, LAYER_COMPOSITE_FS).use()
    const clipMask = o.clip?.mask && o.clip.maskEnabled ? o.clip : null
    gpu.bindTex(0, backTex)
    gpu.bindTex(2, srcTex)
    gpu.bindTex(3, o.clip ? this.texOf(o.clip) : blank)
    gpu.bindTex(6, o.maskOn && o.mask ? this.maskTexOf(o.mask) : blank)
    gpu.bindTex(7, clipMask ? this.maskTexOf(clipMask) : blank)
    p.i('uBack', 0).i('uSrc', 2).i('uClip', 3).i('uMask', 6).i('uClipMask', 7)
    p.f('uOpacity', o.opacity).i('uBlend', o.blend)
    p.f('uClipOn', o.clip ? 1 : 0).f('uClipMul', o.clip ? o.clip.opacity : 1).f('uClipMaskOn', clipMask ? 1 : 0)
    p.f('uMaskOn', o.maskOn && o.mask ? 1 : 0).f('uMaskView', o.maskView ? 1 : 0).i('uStrokeTarget', o.live ? o.liveTarget : -1)
    const strokeTex = this.tileKey !== null && o.live ? (o.live.tiles?.get(this.tileKey)?.tex ?? blank) : undefined
    const tk = this.tileKey
    setStrokeUniforms(gpu, p, o.live, o.liveAlphaLock, strokeTex, tk !== null ? { x: tileKeyX(tk) * TILE, y: tileKeyY(tk) * TILE, w: TILE, h: TILE } : undefined)
    gpu.bindTarget(target, rect)
    gpu.fullscreen()
  }
}

/**
 * Flattens the layer stack into `composite` (all blend modes, groups, masks, clipping masks, live
 * stroke overlay) and draws it to the screen with the view transform. Passing a dirty `rect` to
 * compose() only recomputes that region (scissored) - this keeps drawing at 60fps on 4K canvases.
 */
export class Compositor {
  private doc: Document
  composite!: Surface
  readonly renderer: StackRenderer
  /** infinite documents: the tile compositor (null on fixed documents) */
  readonly inf: InfCompositor
  /** Extension hook (Animation/Page Assist): maps the root layers to the list actually composited. */
  rootProvider: ((roots: Layer[]) => Layer[]) | null = null
  /** Language variants: one renderer (+ tile compositor / full-canvas surface) per language, created on first use. */
  private variants = new Map<string, { renderer: StackRenderer; inf: InfCompositor; comp: Surface | null }>()
  private offChange: (() => void) | null = null
  private variant(lang: string): { renderer: StackRenderer; inf: InfCompositor; comp: Surface | null } {
    let v = this.variants.get(lang)
    // the variant tile caches follow EVERY document change (not only the screen frames), so a read right after an edit is never stale
    this.offChange ??= this.doc.events.on('change', (e) => {
      if (this.doc.isInfinite) for (const x of this.variants.values()) x.inf.touch(e.rect)
    })
    if (!v) {
      const renderer = new StackRenderer(this.gpu, () => this.doc)
      renderer.lang = lang
      v = { renderer, inf: new InfCompositor(this.gpu, () => this.doc, renderer, () => this.roots()), comp: null }
      this.variants.set(lang, v)
    }
    return v
  }
  private disposeVariants(): void {
    for (const v of this.variants.values()) {
      v.renderer.dispose()
      v.inf.dispose()
      v.comp?.dispose()
    }
    this.variants.clear()
    this.offChange?.()
    this.offChange = null
  }
  /** Fixed canvases: the whole canvas rendered as `lang` (own surface, valid until the next call for the same language). */
  renderLang(lang: string, live: LiveStroke | null = null): Surface {
    const v = this.variant(lang)
    const d = this.doc
    if (!v.comp || v.comp.w !== d.width || v.comp.h !== d.height) {
      v.comp?.dispose()
      v.comp = this.gpu.surface(d.width, d.height, d.format)
    }
    v.renderer.render(this.roots(), v.comp, live, null)
    return v.comp
  }
  /** Draw the screen as `lang` (a recording of another language; the caller presents the real view again afterwards). Infinite canvases only. */
  presentLang(lang: string, view: View, cssW: number, cssH: number, target?: Surface): void {
    this.langInf(lang).present(view, cssW, cssH, target)
  }
  /** Infinite canvases: the tile compositor that renders as `lang` (readRect / assembleRect). */
  langInf(lang: string): InfCompositor {
    return this.variant(lang).inf
  }

  /** the document this compositor currently renders */
  get document(): Document {
    return this.doc
  }

  constructor(private gpu: GPU, doc: Document) {
    this.doc = doc
    this.renderer = new StackRenderer(gpu, () => this.doc)
    this.inf = new InfCompositor(gpu, () => this.doc, this.renderer, () => this.roots())
    this.alloc()
  }

  /** GPU texture size limit (export scaling) */
  get gpuMaxTexture(): number {
    return this.gpu.maxTexture
  }

  private roots(): Layer[] {
    const roots = childrenOf(this.doc.layers, null)
    return this.rootProvider ? this.rootProvider(roots) : roots
  }

  setDocument(doc: Document): void {
    this.doc = doc
    this.alloc()
  }

  private alloc(): void {
    this.composite?.dispose()
    this.renderer.dispose()
    this.inf.dispose()
    this.disposeVariants()
    const { width: w, height: h, format } = this.doc
    // infinite documents have no full-canvas composite: a 1x1 placeholder keeps legacy readers from crashing
    this.composite = this.doc.isInfinite ? this.gpu.surface(1, 1, format) : this.gpu.surface(w, h, format)
  }

  compose(live: LiveStroke | null, rect: Rect | null): void {
    this.renderer.ghost = this.doc.langGhost && this.doc.hasLangLayers
    if (this.doc.isInfinite) {
      for (const v of this.variants.values()) v.inf.invalidate(live, rect)
      return this.inf.invalidate(live, rect) // tiles are (re)built lazily by present() / readFlattened()
    }
    const roots = childrenOf(this.doc.layers, null)
    this.renderer.render(this.rootProvider ? this.rootProvider(roots) : roots, this.composite, live, rect)
  }

  /** Draw the composite to the default framebuffer. */
  present(view: View, cssW: number, cssH: number, dpr: number): void {
    const gpu = this.gpu
    const gl = gpu.gl
    const doc = this.doc
    if (doc.isInfinite) return this.inf.present(view, cssW, cssH)
    const W = gpu.canvas.width
    const H = gpu.canvas.height
    const p = gpu.program('display', FS_VERT, DISPLAY_FS).use()
    gpu.bindTarget(null, null)
    gl.viewport(0, 0, W, H)
    gl.disable(gl.BLEND)
    gpu.bindTex(0, this.composite.tex)
    const sx = W / cssW
    p.i('uTex', 0)
      .v2('uDoc', doc.width, doc.height)
      .v2('uCenter', view.cx, view.cy)
      .v2('uHalf', W / 2, H / 2)
      .f('uZoom', view.zoom * sx)
      .v2('uRot', Math.cos(view.rot), Math.sin(view.rot))
      .f('uMirror', view.mirror ? -1 : 1)
      .f('uH', H)
      .v3('uPaper', doc.background.color[0], doc.background.color[1], doc.background.color[2])
      .f('uPaperOn', doc.background.visible ? 1 : 0)
    void dpr
    gpu.fullscreen()
  }

  /**
   * Flattened pixels as straight RGBA8.
   *  - `readFlattened(withBackground)`: the whole fixed canvas (legacy form; on an infinite document: its content bounds, capped).
   *  - `readFlattened(rect, scale?, withBackground?)`: any document-space rect at 0 < scale <= 1, fixed or infinite (eyedropper, export,
   *    time-lapse capture, thumbnails). Returns { px, w, h, rect }.
   */
  readFlattened(withBackground: boolean): Uint8ClampedArray
  readFlattened(rect: Rect, scale?: number, withBackground?: boolean, lang?: string): FlatImage
  readFlattened(arg: boolean | Rect, scale = 1, withBackground = true, lang?: string): Uint8ClampedArray | FlatImage {
    if (typeof arg !== 'boolean') return this.readRect(arg, scale, withBackground, lang)
    if (this.doc.isInfinite) {
      const b = this.doc.contentBounds() ?? { x: 0, y: 0, w: 1, h: 1 }
      const k = Math.min(1, 4096 / Math.max(b.w, b.h))
      const cl = this.cleanLang() // a ghost on the screen never leaks into a read
      return (cl ? this.langInf(cl) : this.inf).readRect(b, k, arg).px
    }
    return this.readFlat(arg)
  }

  private readRect(rect: Rect, scale: number, withBackground: boolean, lang?: string): FlatImage {
    lang ??= this.cleanLang()
    if (this.doc.isInfinite) return (lang ? this.langInf(lang) : this.inf).readRect(rect, scale, withBackground)
    // fixed document: crop of the full composite (scale < 1 via the GPU box filter is not needed by any caller yet)
    const doc = this.doc
    const full = this.readFlat(withBackground, lang)
    const x0 = Math.max(0, Math.floor(rect.x))
    const y0 = Math.max(0, Math.floor(rect.y))
    const x1 = Math.min(doc.width, Math.ceil(rect.x + rect.w))
    const y1 = Math.min(doc.height, Math.ceil(rect.y + rect.h))
    const w = Math.max(1, x1 - x0)
    const h = Math.max(1, y1 - y0)
    const px = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) px.set(full.subarray(((y0 + y) * doc.width + x0) * 4, ((y0 + y) * doc.width + x0 + w) * 4), y * w * 4)
    return { px, w, h, rect: { x: x0, y: y0, w, h } }
  }

  /** the language to read as when the screen shows a ghost (every read is ghost-free); undefined = the screen composite is clean already */
  cleanLang(): string | undefined {
    return this.renderer.ghost && this.doc.langGhost && this.doc.hasLangLayers ? this.doc.viewLang : undefined
  }

  private readFlat(withBackground: boolean, lang?: string): Uint8ClampedArray {
    lang ??= this.cleanLang()
    if (!lang) this.compose(null, null)
    const doc = this.doc
    const px = this.gpu.readRGBA8(lang ? this.renderLang(lang) : this.composite, { x: 0, y: 0, w: doc.width, h: doc.height })
    if (withBackground && doc.background.visible) {
      const [br, bg, bb] = doc.background.color.map((v) => v * 255)
      for (let i = 0; i < px.length; i += 4) {
        const a = px[i + 3] / 255
        px[i] = px[i] * a + br * (1 - a)
        px[i + 1] = px[i + 1] * a + bg * (1 - a)
        px[i + 2] = px[i + 2] * a + bb * (1 - a)
        px[i + 3] = 255
      }
    }
    return px
  }
}
