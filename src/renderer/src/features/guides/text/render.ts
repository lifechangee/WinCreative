import { TextData, applyCase, colorAt, isRtl, layoutColumns, layoutLines } from './model'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

let scratch: CanvasRenderingContext2D | null = null
const scratchCtx = (): CanvasRenderingContext2D => (scratch ??= document.createElement('canvas').getContext('2d')!)

export function fontString(t: TextData): string {
  const s = t.style
  return `${s.italic ? 'italic ' : ''}${s.bold ? '700 ' : '400 '}${s.size}px "${s.family.replace(/"/g, '')}", sans-serif`
}

function setup(ctx: Ctx, t: TextData): void {
  const s = t.style
  const c = ctx as CanvasRenderingContext2D
  c.font = fontString(t)
  c.fontKerning = s.kerning ? 'normal' : 'none'
  c.fontVariantCaps = s.caps === 'small' ? 'small-caps' : 'normal'
  // a non-zero letter-spacing also switches ligatures off in Chromium
  c.letterSpacing = s.tracking !== 0 ? s.tracking + 'px' : s.ligatures ? '0px' : '0.01px'
  c.wordSpacing = '0px'
  c.textBaseline = 'alphabetic'
  c.textAlign = 'left'
  c.direction = isRtl(t.text) ? 'rtl' : 'ltr'
}

export interface Layout {
  w: number
  h: number
}

/** Size of the text box (horizontal text: fixed width, height from wrapping; vertical: from content). */
export function measureBox(t: TextData, ctx: Ctx = scratchCtx()): Layout {
  setup(ctx, t)
  const s = t.style
  const text = applyCase(t.text, s.caps)
  if (s.vertical) {
    const cols = layoutColumns(text)
    const step = s.size + s.tracking
    return { w: Math.max(1, cols.length) * s.size * s.leading, h: Math.max(1, ...cols.map((c) => c.chars.length)) * step }
  }
  const lines = layoutLines(text, (x) => ctx.measureText(x).width, t.w)
  return { w: t.w, h: Math.max(1, lines.length) * s.size * s.leading }
}

function drawSegment(ctx: Ctx, t: TextData, str: string, x: number, y: number, w: number, color: string): void {
  const s = t.style
  const c = ctx as CanvasRenderingContext2D
  if (s.outlineWidth > 0) {
    c.lineJoin = 'round'
    c.lineWidth = s.outlineWidth * 2
    c.strokeStyle = s.outlineColor
    c.strokeText(str, x, y)
  }
  c.fillStyle = color
  c.fillText(str, x, y)
  const th = Math.max(1, s.size / 18)
  if (s.underline) c.fillRect(x, y + s.size * 0.1, w, th)
  if (s.strike) c.fillRect(x, y - s.size * 0.28, w, th)
}

/** Draw the text with its box top-left at the origin of `ctx`. */
export function drawText(ctx: Ctx, t: TextData): Layout {
  setup(ctx, t)
  const c = ctx as CanvasRenderingContext2D
  const s = t.style
  const text = applyCase(t.text, s.caps)
  const box = measureBox(t, ctx)
  setup(ctx, t)
  const m = c.measureText('Hg')
  const asc = m.fontBoundingBoxAscent ?? s.size * 0.8
  const desc = m.fontBoundingBoxDescent ?? s.size * 0.2
  const lineH = s.size * s.leading
  if (s.vertical) {
    const cols = layoutColumns(text)
    const step = s.size + s.tracking
    c.textAlign = 'center'
    c.letterSpacing = '0px'
    const colW = lineH
    cols.forEach((col, ci) => {
      const cx = box.w - colW * ci - colW / 2
      col.chars.forEach((ch, k) => {
        const y = k * step + (step - (asc + desc)) / 2 + asc - s.baseline
        const w = c.measureText(ch).width
        if (s.outlineWidth > 0) {
          c.lineJoin = 'round'
          c.lineWidth = s.outlineWidth * 2
          c.strokeStyle = s.outlineColor
          c.strokeText(ch, cx, y)
        }
        c.fillStyle = colorAt(t, col.start + k)
        c.fillText(ch, cx, y)
        if (s.underline) c.fillRect(cx + w / 2 + 2, k * step, Math.max(1, s.size / 18), step)
        if (s.strike) c.fillRect(cx - w / 2 - 2, y - s.size * 0.28, w + 4, Math.max(1, s.size / 18))
      })
    })
    return box
  }
  const rtl = isRtl(t.text)
  const lines = layoutLines(text, (x) => c.measureText(x).width, t.w)
  lines.forEach((ln, i) => {
    if (!ln.text) return
    const y = i * lineH + (lineH - (asc + desc)) / 2 + asc - s.baseline
    let lw = ln.width
    let x0 = 0
    if (s.align === 'justify' && !ln.last) {
      const spaces = (ln.text.match(/ /g) ?? []).length
      if (spaces) {
        c.wordSpacing = (t.w - ln.width) / spaces + 'px'
        lw = t.w
      }
    } else if (s.align === 'center') x0 = (t.w - lw) / 2
    else if (s.align === 'right') x0 = t.w - lw
    if (rtl) {
      drawSegment(c, t, ln.text, x0, y, lw, colorAt(t, ln.start))
    } else {
      // split into runs of equal colour
      let runStart = 0
      let x = x0
      for (let k = 1; k <= ln.text.length; k++) {
        if (k === ln.text.length || colorAt(t, ln.start + k) !== colorAt(t, ln.start + runStart)) {
          const seg = ln.text.slice(runStart, k)
          const w = c.measureText(seg).width
          drawSegment(c, t, seg, x, y, w, colorAt(t, ln.start + runStart))
          x += w
          runStart = k
        }
      }
    }
    c.wordSpacing = '0px'
  })
  return box
}

export interface Rendered {
  canvas: HTMLCanvasElement
  /** document-space origin of the canvas */
  x: number
  y: number
  box: Layout
}

/** Rasterise into a canvas covering the rotated box (clamped to the document unless `unbounded`: infinite canvas). null if fully outside. */
export function renderText(t: TextData, docW: number, docH: number, unbounded = false): Rendered | null {
  const box = measureBox(t)
  const pad = t.style.outlineWidth * 2 + t.style.size * 0.4 + 4
  const cx = t.x + box.w / 2
  const cy = t.y + box.h / 2
  const co = Math.abs(Math.cos(t.rot))
  const si = Math.abs(Math.sin(t.rot))
  const hw = (box.w * co + box.h * si) / 2 + pad
  const hh = (box.w * si + box.h * co) / 2 + pad
  const x0 = unbounded ? Math.floor(cx - hw) : Math.max(0, Math.floor(cx - hw))
  const y0 = unbounded ? Math.floor(cy - hh) : Math.max(0, Math.floor(cy - hh))
  const x1 = unbounded ? Math.ceil(cx + hw) : Math.min(docW, Math.ceil(cx + hw))
  const y1 = unbounded ? Math.ceil(cy + hh) : Math.min(docH, Math.ceil(cy + hh))
  if (x1 <= x0 || y1 <= y0) return null
  const canvas = document.createElement('canvas')
  canvas.width = x1 - x0
  canvas.height = y1 - y0
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.translate(cx - x0, cy - y0)
  ctx.rotate(t.rot)
  ctx.translate(-box.w / 2, -box.h / 2)
  drawText(ctx, t)
  return { canvas, x: x0, y: y0, box }
}
