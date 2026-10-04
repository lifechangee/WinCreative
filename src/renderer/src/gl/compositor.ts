import { blendIndex } from '../core/blend'
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

interface Ref {
  tex: WebGLTexture
  surf: Surface | null
}
interface Op {
  layer: Layer
  clip: Layer | null
}

interface PassOpts {
  opacity: number
  blend: number
  mask: Surface | null
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

  constructor(
    private gpu: GPU,
    private getDoc: () => Document
  ) {}

  private ping(depth: number, i: number): Surface {
    const doc = this.getDoc()
    const row = (this.P[depth] ??= [])
    return (row[i] ??= this.gpu.surface(doc.width, doc.height, doc.format))
  }
  private groupBuf(depth: number): Surface {
    const doc = this.getDoc()
    return (this.G[depth] ??= this.gpu.surface(doc.width, doc.height, doc.format))
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
    for (const l of sibs) {
      if (l.isGroup) {
        base = null
        if (l.visible) ops.push({ layer: l, clip: null })
        continue
      }
      if (l.clipping && base) {
        if (base.visible && l.visible) ops.push({ layer: l, clip: base })
      } else {
        base = l
        if (l.visible) ops.push({ layer: l, clip: null })
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
        gpu.bindTex(2, maskOn ? layer.mask!.tex : gpu.blank)
        p.i('uBack', 0).i('uGrp', 1).i('uMask', 2).f('uK', layer.opacity).f('uMaskOn', maskOn ? 1 : 0)
        gpu.bindTarget(target, rect)
        gpu.fullscreen()
      } else {
        const g = this.groupBuf(depth)
        this.composeList(kids, { tex: gpu.blank, surf: null }, depth + 1, g, rect, live)
        this.pass(cur.tex, g.tex, target, rect, { ...NO_PASS, opacity: layer.opacity, blend: blendIndex(layer.blendMode), mask: layer.mask, maskOn })
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
    this.pass(cur.tex, layer.pixels.tex, target, rect, {
      opacity: view ? 1 : layer.opacity,
      blend: view ? 0 : blendIndex(layer.blendMode),
      mask: layer.mask,
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
    const clipMask = o.clip?.mask && o.clip.maskEnabled ? o.clip.mask : null
    gpu.bindTex(0, backTex)
    gpu.bindTex(2, srcTex)
    gpu.bindTex(3, o.clip ? o.clip.pixels.tex : blank)
    gpu.bindTex(6, o.maskOn && o.mask ? o.mask.tex : blank)
    gpu.bindTex(7, clipMask ? clipMask.tex : blank)
    p.i('uBack', 0).i('uSrc', 2).i('uClip', 3).i('uMask', 6).i('uClipMask', 7)
    p.f('uOpacity', o.opacity).i('uBlend', o.blend)
    p.f('uClipOn', o.clip ? 1 : 0).f('uClipMul', o.clip ? o.clip.opacity : 1).f('uClipMaskOn', clipMask ? 1 : 0)
    p.f('uMaskOn', o.maskOn && o.mask ? 1 : 0).f('uMaskView', o.maskView ? 1 : 0).i('uStrokeTarget', o.live ? o.liveTarget : -1)
    setStrokeUniforms(gpu, p, o.live, o.liveAlphaLock)
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
  /** Extension hook (Animation/Page Assist): maps the root layers to the list actually composited. */
  rootProvider: ((roots: Layer[]) => Layer[]) | null = null

  /** the document this compositor currently renders */
  get document(): Document {
    return this.doc
  }

  constructor(private gpu: GPU, doc: Document) {
    this.doc = doc
    this.renderer = new StackRenderer(gpu, () => this.doc)
    this.alloc()
  }

  setDocument(doc: Document): void {
    this.doc = doc
    this.alloc()
  }

  private alloc(): void {
    this.composite?.dispose()
    this.renderer.dispose()
    const { width: w, height: h, format } = this.doc
    this.composite = this.gpu.surface(w, h, format)
  }

  compose(live: LiveStroke | null, rect: Rect | null): void {
    const roots = childrenOf(this.doc.layers, null)
    this.renderer.render(this.rootProvider ? this.rootProvider(roots) : roots, this.composite, live, rect)
  }

  /** Draw the composite to the default framebuffer. */
  present(view: View, cssW: number, cssH: number, dpr: number): void {
    const gpu = this.gpu
    const gl = gpu.gl
    const doc = this.doc
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

  /** Full recompose + readback as straight RGBA8 (export / thumbnails). */
  readFlattened(withBackground: boolean): Uint8ClampedArray {
    this.compose(null, null)
    const doc = this.doc
    const px = this.gpu.readRGBA8(this.composite, { x: 0, y: 0, w: doc.width, h: doc.height })
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
