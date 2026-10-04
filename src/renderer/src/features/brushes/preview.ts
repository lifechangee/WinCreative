import type { App } from '../../app/app'
import { BrushPreset, isBlendingMode } from '../../core/brush'
import { StrokePipeline, PaintMode } from '../../core/pipeline'
import type { Rect, Sample } from '../../core/types'
import type { Document } from '../../doc/document'
import type { Layer } from '../../doc/layer'
import { BrushEngine } from '../../gl/brushEngine'
import type { GPU, Surface } from '../../gl/gpu'

/**
 * Real-engine brush previews: a private BrushEngine renders into small offscreen surfaces of the app's WebGL
 * context, so grain, dynamics, taper, dual brush, wet mix, blend modes ... look exactly like on the canvas.
 */

const stubEdit = { save(): void {}, finish: () => null, hasChanges: false }

/** Offscreen "document" + engine of a fixed size (library rows, Studio preview strip, drawing pad). */
export class PreviewContext {
  readonly gpu: GPU
  readonly layer: Surface
  readonly out: Surface
  readonly engine: BrushEngine
  private fakeLayer: Layer
  private scratch: Surface

  constructor(gpu: GPU, readonly w: number, readonly h: number) {
    this.gpu = gpu
    this.layer = gpu.surface(w, h, 'rgba16f')
    this.out = gpu.surface(w, h, 'rgba16f')
    this.scratch = gpu.surface(w, h, 'rgba16f')
    const fakeDoc = {
      width: w,
      height: h,
      scratch: this.scratch,
      beginPixelEdit: () => stubEdit,
      history: { undo(): void {} },
      events: { emit(): void {} }
    } as unknown as Document
    this.engine = new BrushEngine(gpu, fakeDoc)
    this.fakeLayer = { id: 'preview', surface: this.layer, alphaLock: false } as unknown as Layer
  }

  clear(): void {
    this.gpu.clear(this.layer, null)
    this.gpu.clear(this.out, null)
  }

  /** Coloured stripes the smudge / mixing / blend-mode brushes can act on. */
  backdrop(): void {
    const { w, h } = this
    const d = new Uint8ClampedArray(w * h * 4)
    const cols = [
      [70, 110, 190],
      [200, 90, 90],
      [230, 200, 90],
      [90, 170, 120]
    ]
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = cols[Math.floor((x / w) * cols.length * 1.5 + (y / h) * 0.9) % cols.length]
        const o = (y * w + x) * 4
        d[o] = c[0]
        d[o + 1] = c[1]
        d[o + 2] = c[2]
        d[o + 3] = 255
      }
    }
    this.gpu.uploadRGBA8(this.layer, 0, 0, w, h, d)
  }

  begin(preset: BrushPreset, mode: PaintMode, color: [number, number, number]): void {
    this.engine.begin(this.fakeLayer, { mode, preset, color, opacity: preset.opacity })
  }

  /** Copy layer + live stroke into `out` over rect and return it as straight RGBA. */
  present(rect: Rect | null): { rect: Rect; data: Uint8ClampedArray } | null {
    const r = rect ? clip(rect, this.w, this.h) : { x: 0, y: 0, w: this.w, h: this.h }
    if (!r) return null
    this.engine.composeLiveTo(this.out, r)
    return { rect: r, data: this.gpu.readRGBA8(this.out, r) }
  }

  /** Whole layer as straight RGBA. */
  readLayer(): Uint8ClampedArray {
    return this.gpu.readRGBA8(this.layer, { x: 0, y: 0, w: this.w, h: this.h })
  }

  dispose(): void {
    this.engine.dispose()
    this.layer.dispose()
    this.out.dispose()
    this.scratch.dispose()
  }
}

function clip(r: Rect, w: number, h: number): Rect | null {
  const x0 = Math.max(0, r.x)
  const y0 = Math.max(0, r.y)
  const x1 = Math.min(w, r.x + r.w)
  const y1 = Math.min(h, r.y + r.h)
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null
}

export interface PreviewOptions {
  mode?: PaintMode
  color?: [number, number, number]
  /** override of the stroke diameter in px */
  size?: number
  /** single stamp instead of a stroke */
  stamp?: boolean
  /** animate the pressure taper off the tip (Tip Animation): 0..1 fraction of the stroke drawn */
  progress?: number
}

/** Synthetic pen stroke: a gentle S curve with pressure rising and falling. */
export function previewSamples(brush: BrushPreset, w: number, h: number, opts: PreviewOptions = {}): Sample[] {
  const pv = brush.preview
  if (opts.stamp) {
    return [
      { x: w / 2, y: h / 2, pressure: Math.min(1, 0.85 * pv.pressureScale), tiltX: pv.tiltAngle, tiltY: 0, twist: 0, t: 0, pointerType: 'pen' },
      { x: w / 2 + 0.05, y: h / 2, pressure: Math.min(1, 0.85 * pv.pressureScale), tiltX: pv.tiltAngle, tiltY: 0, twist: 0, t: 8, pointerType: 'pen' }
    ]
  }
  const m = Math.min(h * 0.55, w * 0.12)
  const amp = h * 0.16
  const n = Math.max(12, Math.round((w - 2 * m) / 2))
  const out: Sample[] = []
  const last = opts.progress === undefined ? 1 : Math.max(0.02, Math.min(1, opts.progress))
  for (let i = 0; i <= n * last; i++) {
    const t = i / n
    const p = pv.pressureMin + (1 - pv.pressureMin) * Math.pow(Math.sin(Math.PI * Math.min(1, t)), 0.7)
    out.push({
      x: m + (w - 2 * m) * t,
      y: h / 2 + Math.sin(t * Math.PI * 2 - Math.PI / 2) * amp * -1,
      pressure: Math.max(0.02, Math.min(1, p * pv.pressureScale)),
      tiltX: pv.tiltAngle,
      tiltY: 0,
      twist: 0,
      t: i * 1.4,
      pointerType: 'pen'
    })
  }
  return out
}

const identity = (p: number): number => p

export function previewSize(brush: BrushPreset, h: number, opts: PreviewOptions): number {
  if (opts.size) return opts.size
  const base = brush.defaultSize * (brush.props.previewSize || 1)
  return Math.max(1.5, Math.min(base, h * (opts.stamp ? 0.85 : 0.55)))
}

/** Render a brush stroke (or stamp) into `ctx` and leave the result in ctx.layer. */
export function renderPreview(ctx: PreviewContext, brush: BrushPreset, opts: PreviewOptions = {}): void {
  const mode: PaintMode = opts.mode ?? (brush.category === 'smudge' ? 'smudge' : 'paint')
  ctx.clear()
  const needsBackdrop = mode === 'smudge' || isBlendingMode(brush.render.mode) || brush.render.blendMode !== 'normal' || brush.render.luminance
  if (needsBackdrop) ctx.backdrop()
  const color = opts.color ?? (needsBackdrop ? [1, 0.93, 0.55] : [0.93, 0.93, 0.95])
  const b = brush.preview.wetMix ? brush : { ...brush, render: { ...brush.render, mode: isBlendingMode(brush.render.mode) ? 'lightGlaze' : brush.render.mode } }
  ctx.begin(b as BrushPreset, mode, color)
  const eng = ctx.engine
  const pipe = new StrokePipeline(
    {
      preset: b as BrushPreset,
      size: previewSize(brush, ctx.h, opts),
      mode,
      color,
      secondary: [0.2, 0.3, 0.9],
      curve: identity,
      smoothing: { amount: 0.12, mode: 'exp', lazyRadius: 0 },
      seed: 1234
    },
    { stamp: (d, t) => eng.stamp(d, t), restart: () => eng.restart() }
  )
  for (const s of previewSamples(brush, ctx.w, ctx.h, opts)) pipe.push(s)
  pipe.end()
  eng.end()
}

// ------------------------------------------------------------------ cached thumbnails
const contexts = new Map<string, PreviewContext>()
const thumbs = new Map<string, HTMLCanvasElement>()
const MAX_THUMBS = 400

function ctxFor(app: App, w: number, h: number): PreviewContext {
  const k = w + 'x' + h
  let c = contexts.get(k)
  if (!c) contexts.set(k, (c = new PreviewContext(app.gpu, w, h)))
  return c
}

/** Stable cache key of everything that affects how a brush looks. */
export function brushLookKey(b: BrushPreset): string {
  const { id, name, about, resetPoint, ...rest } = b
  void id
  void name
  void about
  void resetPoint
  return JSON.stringify(rest)
}

export function toCanvas(data: Uint8ClampedArray, w: number, h: number, into?: HTMLCanvasElement): HTMLCanvasElement {
  const c = into ?? document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  g.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0)
  return c
}

/** Cached preview canvas of a brush at w x h device pixels (do not mutate). */
export function brushThumbnail(app: App, brush: BrushPreset, w: number, h: number, opts: PreviewOptions = {}): HTMLCanvasElement | null {
  const key = `${w}x${h}|${opts.stamp ? 's' : 'l'}${opts.mode ?? ''}|${brushLookKey(brush)}`
  const hit = thumbs.get(key)
  if (hit) return hit
  try {
    const ctx = ctxFor(app, w, h)
    renderPreview(ctx, brush, opts)
    const c = toCanvas(ctx.readLayer(), w, h)
    if (thumbs.size >= MAX_THUMBS) thumbs.delete(thumbs.keys().next().value as string)
    thumbs.set(key, c)
    return c
  } catch (e) {
    console.error('brush preview failed', e)
    return null
  }
}

export function clearThumbnails(): void {
  thumbs.clear()
}
