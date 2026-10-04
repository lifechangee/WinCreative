import { t } from '../../i18n'
import { CurvePoint, insertCurvePoint, makePressureCurve, moveCurvePoint, PressureCurveSettings, removeCurvePoint, sanitizeCurve } from '../../core/pressure'
import { h } from '../../ui/dom'

export interface CurveEditor {
  el: HTMLCanvasElement
  /** show the live input pressure (0..1) as a marker, null hides it */
  setLive(p: number | null): void
  redraw(): void
}

/**
 * Spline curve editor: drag points, click empty space to add a point, double-click / right-click a point
 * to delete it. The curve is a monotone cubic spline through the points (same function the brush uses).
 */
export function createCurveEditor(size: number, get: () => PressureCurveSettings, onChange: (c: PressureCurveSettings) => void): CurveEditor {
  const dpr = window.devicePixelRatio || 1
  const cv = h('canvas') as HTMLCanvasElement
  cv.width = Math.round(size * dpr)
  cv.height = Math.round(size * dpr)
  cv.style.width = size + 'px'
  cv.style.height = size + 'px'
  const ctx = cv.getContext('2d')!
  const pad = 14
  const inner = size - pad * 2
  let live: number | null = null
  let drag = -1
  let hover = -1
  const px = (x: number): number => pad + x * inner
  const py = (y: number): number => pad + (1 - y) * inner
  const css = (v: string): string => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#888'

  const draw = (): void => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size, size)
    const line = css('--line')
    const dim = css('--dim')
    const accent = css('--accent')
    ctx.strokeStyle = line
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let i = 0; i <= 4; i++) {
      const v = pad + (inner * i) / 4
      ctx.moveTo(v, pad)
      ctx.lineTo(v, pad + inner)
      ctx.moveTo(pad, v)
      ctx.lineTo(pad + inner, v)
    }
    ctx.stroke()
    ctx.setLineDash([4, 4])
    ctx.strokeStyle = dim
    ctx.beginPath()
    ctx.moveTo(px(0), py(0))
    ctx.lineTo(px(1), py(1))
    ctx.stroke()
    ctx.setLineDash([])
    const c = get()
    const f = makePressureCurve(c)
    ctx.strokeStyle = accent
    ctx.lineWidth = 2.5
    ctx.lineJoin = 'round'
    ctx.beginPath()
    for (let i = 0; i <= 120; i++) {
      const x = i / 120
      i ? ctx.lineTo(px(x), py(f(x))) : ctx.moveTo(px(x), py(f(x)))
    }
    ctx.stroke()
    if (live !== null) {
      ctx.strokeStyle = dim
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(px(live), py(0))
      ctx.lineTo(px(live), py(f(live)))
      ctx.lineTo(px(0), py(f(live)))
      ctx.stroke()
      ctx.fillStyle = '#ff9f0a'
      ctx.beginPath()
      ctx.arc(px(live), py(f(live)), 5, 0, Math.PI * 2)
      ctx.fill()
    }
    c.points.forEach((p, i) => {
      ctx.fillStyle = i === drag || i === hover ? accent : '#fff'
      ctx.strokeStyle = '#000a'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(px(p[0]), py(p[1]), i === drag ? 7 : 6, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    })
    ctx.fillStyle = dim
    ctx.font = '10px "Segoe UI", sans-serif'
    ctx.fillText(t('interface.curve.penPressure'), pad + 2, size - 2)
    ctx.save()
    ctx.translate(10, size - pad - 2)
    ctx.rotate(-Math.PI / 2)
    ctx.fillText('output', 0, 0)
    ctx.restore()
  }

  const toCurve = (e: PointerEvent): CurvePoint => {
    const r = cv.getBoundingClientRect()
    return [Math.min(1, Math.max(0, ((e.clientX - r.left) * (size / r.width) - pad) / inner)), Math.min(1, Math.max(0, 1 - ((e.clientY - r.top) * (size / r.height) - pad) / inner))]
  }
  const hit = (e: PointerEvent): number => {
    const r = cv.getBoundingClientRect()
    const mx = (e.clientX - r.left) * (size / r.width)
    const my = (e.clientY - r.top) * (size / r.height)
    const pts = get().points
    let best = -1
    let bd = 13
    pts.forEach((p, i) => {
      const d = Math.hypot(px(p[0]) - mx, py(p[1]) - my)
      if (d < bd) {
        bd = d
        best = i
      }
    })
    return best
  }

  cv.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    if (e.button === 2) {
      const i = hit(e)
      if (i >= 0 && removeCurvePoint(get(), i)) onChange(get())
      draw()
      return
    }
    cv.setPointerCapture(e.pointerId)
    let i = hit(e)
    if (i < 0) {
      const [x, y] = toCurve(e)
      i = insertCurvePoint(get(), x, y)
    }
    drag = i
    draw()
    if (i >= 0) onChange(get())
  })
  cv.addEventListener('pointermove', (e) => {
    if (drag >= 0) {
      const [x, y] = toCurve(e)
      moveCurvePoint(get(), drag, x, y)
      onChange(get())
    } else {
      const i = hit(e)
      if (i !== hover) hover = i
    }
    draw()
  })
  const end = (): void => {
    if (drag >= 0) {
      const c = sanitizeCurve(get().points)
      get().points.splice(0, get().points.length, ...c.points)
      onChange(get())
    }
    drag = -1
    draw()
  }
  cv.addEventListener('pointerup', end)
  cv.addEventListener('pointercancel', end)
  cv.addEventListener('pointerleave', () => {
    hover = -1
    draw()
  })
  cv.addEventListener('dblclick', (e) => {
    const i = hit(e as unknown as PointerEvent)
    if (i >= 0 && removeCurvePoint(get(), i)) {
      onChange(get())
      draw()
    }
  })
  cv.addEventListener('contextmenu', (e) => e.preventDefault())
  draw()
  return {
    el: cv,
    setLive: (p) => {
      live = p
      draw()
    },
    redraw: draw
  }
}
