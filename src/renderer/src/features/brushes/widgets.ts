import { CurvePts } from '../../core/brush'
import { makePressureCurve } from '../../core/pressure'
import { I18nText, resolveText, tk } from '../../i18n'
import { h } from '../../ui/dom'

/** Shared styles + small controls of the brush UI (library panel + Brush Studio). */
const CSS = `
.bs-root { --bs-bg:#232326; position: fixed; inset: 0; z-index: 250; background: #000a; display: grid; place-items: center; }
.bs-win { width: min(1180px, 97vw); height: min(760px, 95vh); background: var(--panel); border: 1px solid var(--line); border-radius: 14px; display: flex; flex-direction: column; box-shadow: 0 24px 80px #000c; overflow: hidden; }
.bs-head { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--line); }
.bs-head h3 { margin: 0; font-size: 15px; flex: 1; }
.bs-head .bs-name { flex: 0 1 260px; background: var(--panel2); color: var(--text); border: 1px solid var(--line); border-radius: 7px; padding: 6px 9px; }
.bs-btn { background: var(--panel2); border: 1px solid var(--line); border-radius: 8px; padding: 6px 14px; cursor: pointer; color: var(--text); }
.bs-btn:hover { border-color: var(--accent); }
.bs-btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.bs-btn.sm { padding: 3px 9px; font-size: 12px; }
.bs-body { flex: 1; display: flex; min-height: 0; }
.bs-nav { width: 200px; border-right: 1px solid var(--line); overflow: auto; padding: 6px; flex: none; }
.bs-nav button { display: flex; align-items: center; justify-content: space-between; width: 100%; text-align: left; border: 0; background: transparent; padding: 8px 10px; border-radius: 8px; cursor: pointer; color: var(--text); }
.bs-nav button:hover { background: var(--panel2); }
.bs-nav button.sel { background: #2c3a55; }
.bs-nav button.na { color: #6d6d75; }
.bs-badge { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); flex: none; }
.bs-detail { flex: 1; min-width: 0; overflow: auto; padding: 10px 16px 24px; }
.bs-detail h4 { margin: 14px 0 4px; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--dim); }
.bs-pad { width: 420px; flex: none; border-left: 1px solid var(--line); display: flex; flex-direction: column; padding: 10px; gap: 8px; overflow: auto; }
.bs-pad canvas.pad { background: #f4f2ee; border-radius: 8px; width: 100%; touch-action: none; cursor: crosshair; }
.bs-pad canvas.strip { background: #1a1a1c; border-radius: 8px; width: 100%; }
.bs-padbar { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.bs-padbar select { background: var(--panel2); color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 3px; }
.bs-ctl { display: flex; align-items: center; gap: 10px; margin: 5px 0; min-height: 26px; }
.bs-ctl > .lbl { width: 150px; flex: none; color: var(--text); }
.bs-ctl input[type=range] { flex: 1; min-width: 0; accent-color: var(--accent); }
.bs-ctl .val { width: 54px; text-align: right; color: var(--dim); font-variant-numeric: tabular-nums; }
.bs-ctl.off { opacity: .4; pointer-events: none; }
.bs-ctl select { flex: 1; background: var(--panel2); color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 4px; }
.bs-ctl input[type=text] { flex: 1; background: var(--panel2); color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 5px 7px; min-width: 0; }
.bs-note { color: var(--dim); font-size: 12px; margin: 4px 0 8px; }
.bs-tabs { display: flex; gap: 4px; margin: 6px 0; }
.bs-tabs button { flex: 1; background: var(--panel2); border: 1px solid var(--line); border-radius: 7px; padding: 5px; cursor: pointer; color: var(--text); }
.bs-tabs button.sel { background: var(--accent); border-color: var(--accent); color: #fff; }
.bs-banner { background: #3a3220; border: 1px solid #6b5a2a; border-radius: 8px; padding: 7px 10px; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.bs-tex { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0; }
.bs-tex canvas { width: 54px; height: 54px; border-radius: 6px; border: 2px solid transparent; cursor: pointer; background: #000; }
.bs-tex canvas.sel { border-color: var(--accent); }
.bs-curve { background: #1a1a1c; border-radius: 8px; touch-action: none; display: block; }
.bs-sig { background: #f4f2ee; border-radius: 6px; touch-action: none; cursor: crosshair; }
.bl-panel { display: flex; flex-direction: column; height: min(560px, calc(100vh - 110px)); overflow: hidden; }
.bl-top { display: flex; gap: 6px; padding: 0 0 6px; align-items: center; }
.bl-top input { flex: 1; min-width: 0; background: var(--panel2); color: var(--text); border: 1px solid var(--line); border-radius: 7px; padding: 6px 9px; }
.bl-cols { display: flex; flex: 1; min-height: 0; gap: 6px; }
.bl-sets { width: 150px; flex: none; overflow: auto; border-right: 1px solid var(--line); padding-right: 4px; }
.bl-set { display: flex; align-items: center; justify-content: space-between; gap: 4px; padding: 7px 8px; border-radius: 8px; cursor: pointer; margin-bottom: 1px; }
.bl-set:hover { background: var(--panel2); }
.bl-set.sel { background: #2c3a55; }
.bl-set.over { outline: 2px dashed var(--accent); }
.bl-set .n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bl-brushes { flex: 1; min-width: 0; padding-right: 2px; overflow-y: auto; overflow-x: hidden; }
.bl-row-wrap { position: relative; overflow: hidden; border-radius: 9px; margin-bottom: 3px; }
.bl-swipe { position: absolute; right: 0; top: 0; bottom: 0; display: flex; }
.bl-swipe button { border: 0; padding: 0 12px; color: #fff; cursor: pointer; }
.bl-row { position: relative; display: flex; align-items: center; gap: 6px; padding: 4px 6px; background: var(--panel2); border: 1px solid transparent; border-radius: 9px; cursor: pointer; transition: transform .15s; }
.bl-row.sel { border-color: var(--accent); background: #2c3a55; }
.bl-row.drop-before::before, .bl-row.drop-after::after { content: ''; position: absolute; left: 0; right: 0; height: 3px; background: var(--accent); }
.bl-row.drop-before::before { top: -3px; } .bl-row.drop-after::after { bottom: -3px; }
.bl-row .info { width: 112px; flex: none; overflow: hidden; }
.bl-row .info .nm { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.2; overflow-wrap: anywhere; }
.bl-row canvas { flex: 1 1 0; width: 0; min-width: 0; height: 40px; border-radius: 6px; background: #1c1c1e; }
.bl-star { border: 0; background: transparent; color: var(--dim); cursor: pointer; font-size: 15px; padding: 0 3px; }
.bl-star.on { color: #f5c542; }
.bl-ghost { position: fixed; z-index: 400; pointer-events: none; opacity: .85; background: #2c3a55; border: 1px solid var(--accent); border-radius: 8px; padding: 6px 10px; }
.bl-menu { position: fixed; z-index: 500; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 4px; box-shadow: 0 10px 30px #000a; min-width: 160px; }
.bl-menu button { display: block; width: 100%; text-align: left; background: transparent; border: 0; padding: 7px 10px; border-radius: 6px; cursor: pointer; color: var(--text); }
.bl-menu button:hover { background: var(--panel2); }
.bl-menu button.danger { color: #ff8585; }
.bl-foot { display: flex; gap: 8px; align-items: center; padding-top: 6px; border-top: 1px solid var(--line); margin-top: 6px; }
`

/** setPointerCapture that tolerates synthetic pointer ids (self-test) */
export function cap(el: Element, id: number): void {
  try {
    el.setPointerCapture(id)
  } catch {
    /* not an active pointer */
  }
}

export function injectCss(): void {
  if (document.getElementById('bw-brush-css')) return
  const s = document.createElement('style')
  s.id = 'bw-brush-css'
  s.textContent = CSS
  document.head.append(s)
}

export type Fmt = 'pct' | 'px' | 'deg' | 'x' | 'raw' | 'signed'
export function fmtValue(v: number, f: Fmt = 'raw'): string {
  switch (f) {
    case 'pct':
      return Math.round(v * 100) + '%'
    case 'signed':
      return (v > 0 ? '+' : '') + Math.round(v * 100) + '%'
    case 'px':
      return (v < 10 ? v.toFixed(1) : Math.round(v)) + 'px'
    case 'deg':
      return Math.round(v) + '°'
    case 'x':
      return v.toFixed(2) + 'x'
    default:
      return Math.abs(v) < 10 && !Number.isInteger(v) ? v.toFixed(2) : String(Math.round(v * 100) / 100)
  }
}

export interface SliderOpts {
  min: number
  max: number
  step?: number
  fmt?: Fmt
  /** logarithmic slider (useful for px ranges) */
  log?: boolean
}

/** Labelled slider row; the returned element has .set(v) to refresh from outside. */
export function sliderRow(label: I18nText, get: () => number, set: (v: number) => void, o: SliderOpts): HTMLElement & { refresh(): void } {
  const step = o.step ?? (o.max - o.min > 20 ? 1 : 0.01)
  const toPos = (v: number): number => (o.log ? Math.log(Math.max(o.min, v) / o.min) / Math.log(o.max / o.min) : (v - o.min) / (o.max - o.min))
  const fromPos = (t: number): number => (o.log ? o.min * Math.pow(o.max / o.min, t) : o.min + t * (o.max - o.min))
  const val = h('span', { class: 'val' })
  const input = h('input', { type: 'range', min: 0, max: 1000, step: 1 })
  const show = (): void => {
    const v = get()
    input.value = String(Math.round(toPos(v) * 1000))
    val.textContent = fmtValue(v, o.fmt)
  }
  input.addEventListener('input', () => {
    let v = fromPos(Number(input.value) / 1000)
    v = Math.round(v / step) * step
    v = Math.min(o.max, Math.max(o.min, v))
    set(Number(v.toFixed(4)))
    val.textContent = fmtValue(v, o.fmt)
  })
  const el = h('div', { class: 'bs-ctl' }, h('span', { class: 'lbl', text: label }), input, val) as unknown as HTMLElement & { refresh(): void }
  el.refresh = show
  show()
  return el
}

export function toggleRow(label: I18nText, get: () => boolean, set: (v: boolean) => void): HTMLElement & { refresh(): void } {
  const cb = h('input', { type: 'checkbox' })
  cb.checked = get()
  cb.addEventListener('change', () => set(cb.checked))
  const el = h('label', { class: 'bs-ctl' }, h('span', { class: 'lbl', text: label }), cb) as unknown as HTMLElement & { refresh(): void }
  el.refresh = () => (cb.checked = get())
  return el
}

export function selectRow(label: I18nText, options: [string, I18nText][], get: () => string, set: (v: string) => void): HTMLElement & { refresh(): void } {
  const sel = h('select')
  for (const [v, t] of options) sel.append(h('option', { value: v, text: t }))
  sel.value = get()
  sel.addEventListener('change', () => set(sel.value))
  const el = h('div', { class: 'bs-ctl' }, h('span', { class: 'lbl', text: label }), sel) as unknown as HTMLElement & { refresh(): void }
  el.refresh = () => (sel.value = get())
  return el
}

export function textRow(label: I18nText, get: () => string, set: (v: string) => void): HTMLElement {
  const i = h('input', { type: 'text', value: get() })
  i.addEventListener('input', () => set(i.value))
  return h('div', { class: 'bs-ctl' }, h('span', { class: 'lbl', text: label }), i)
}

/** Editable curve (pressure / tilt graph): drag points, double-click to add, double-click a point to remove. */
export function curveEditor(get: () => CurvePts | null, set: (p: CurvePts | null) => void, w = 300, hgt = 170, xLabel: I18nText = tk('brushes.studio.pressure')): HTMLElement {
  const c = h('canvas', { class: 'bs-curve', width: w, height: hgt })
  c.style.width = w + 'px'
  c.style.height = hgt + 'px'
  const g = c.getContext('2d')!
  const pad = 14
  const px = (x: number): number => pad + x * (w - 2 * pad)
  const py = (y: number): number => hgt - pad - y * (hgt - 2 * pad)
  const pts = (): CurvePts => get() ?? [[0, 0], [1, 1]]
  const draw = (): void => {
    g.clearRect(0, 0, w, hgt)
    g.strokeStyle = '#3d3d42'
    g.lineWidth = 1
    for (let i = 0; i <= 4; i++) {
      g.beginPath()
      g.moveTo(px(i / 4), py(0))
      g.lineTo(px(i / 4), py(1))
      g.moveTo(px(0), py(i / 4))
      g.lineTo(px(1), py(i / 4))
      g.stroke()
    }
    const f = makePressureCurve({ points: pts() })
    g.strokeStyle = '#5b9bff'
    g.lineWidth = 2
    g.beginPath()
    for (let i = 0; i <= 80; i++) {
      const x = i / 80
      i ? g.lineTo(px(x), py(f(x))) : g.moveTo(px(x), py(f(x)))
    }
    g.stroke()
    g.fillStyle = '#fff'
    for (const p of pts()) {
      g.beginPath()
      g.arc(px(p[0]), py(p[1]), 5, 0, 7)
      g.fill()
    }
    g.fillStyle = '#9a9aa2'
    g.font = '11px sans-serif'
    g.fillText(resolveText(xLabel) + ' →', pad, hgt - 2)
  }
  let drag = -1
  const pos = (e: PointerEvent): [number, number] => {
    const r = c.getBoundingClientRect()
    return [Math.min(1, Math.max(0, ((e.clientX - r.left) * (w / r.width) - pad) / (w - 2 * pad))), Math.min(1, Math.max(0, 1 - ((e.clientY - r.top) * (hgt / r.height) - pad) / (hgt - 2 * pad)))]
  }
  const near = (x: number, y: number): number => {
    const p = pts()
    let best = -1
    let bd = 0.06
    p.forEach((q, i) => {
      const d = Math.hypot(q[0] - x, q[1] - y)
      if (d < bd) {
        bd = d
        best = i
      }
    })
    return best
  }
  c.addEventListener('pointerdown', (e) => {
    const [x, y] = pos(e)
    let i = near(x, y)
    if (i < 0) {
      const p = pts().map((q) => [q[0], q[1]] as [number, number])
      p.push([x, y])
      p.sort((a, b) => a[0] - b[0])
      set(p)
      i = p.findIndex((q) => q[0] === x && q[1] === y)
    }
    drag = i
    cap(c, e.pointerId)
    draw()
  })
  c.addEventListener('pointermove', (e) => {
    if (drag < 0) return
    const [x, y] = pos(e)
    const p = pts().map((q) => [q[0], q[1]] as [number, number])
    const lo = drag > 0 ? p[drag - 1][0] + 0.01 : 0
    const hi = drag < p.length - 1 ? p[drag + 1][0] - 0.01 : 1
    p[drag] = [drag === 0 ? 0 : drag === p.length - 1 ? 1 : Math.min(hi, Math.max(lo, x)), y]
    set(p)
    draw()
  })
  c.addEventListener('pointerup', () => (drag = -1))
  c.addEventListener('dblclick', (e) => {
    const [x, y] = pos(e as unknown as PointerEvent)
    const i = near(x, y)
    const p = pts()
    if (i > 0 && i < p.length - 1) {
      set(p.filter((_, k) => k !== i))
      draw()
    }
  })
  const reset = h('button', { class: 'bs-btn sm', text: tk('brushes.widgets.resetCurve'), onclick: () => (set(null), draw()) })
  draw()
  return h('div', null, c, h('div', { class: 'bs-ctl' }, reset))
}

/** Roundness graph: an ellipse with a squash handle (roundness) and a rotate handle (angle). */
export function roundnessGraph(get: () => { roundness: number; angle: number }, set: (roundness: number, angle: number) => void): HTMLElement {
  const S = 170
  const c = h('canvas', { class: 'bs-curve', width: S, height: S })
  c.style.width = S + 'px'
  c.style.height = S + 'px'
  const g = c.getContext('2d')!
  const R = 62
  const cx = S / 2
  const cy = S / 2
  const draw = (): void => {
    const { roundness, angle } = get()
    g.clearRect(0, 0, S, S)
    g.strokeStyle = '#3d3d42'
    g.beginPath()
    g.arc(cx, cy, R, 0, 7)
    g.stroke()
    g.save()
    g.translate(cx, cy)
    g.rotate((angle * Math.PI) / 180)
    g.fillStyle = '#5b9bff88'
    g.strokeStyle = '#5b9bff'
    g.lineWidth = 2
    g.beginPath()
    g.ellipse(0, 0, R, Math.max(1, R * roundness), 0, 0, 7)
    g.fill()
    g.stroke()
    g.fillStyle = '#fff'
    g.beginPath()
    g.arc(R, 0, 6, 0, 7)
    g.fill()
    g.beginPath()
    g.arc(0, -R * roundness, 6, 0, 7)
    g.fill()
    g.restore()
  }
  let mode: 'rot' | 'sq' | null = null
  const rel = (e: PointerEvent): [number, number] => {
    const r = c.getBoundingClientRect()
    return [(e.clientX - r.left) * (S / r.width) - cx, (e.clientY - r.top) * (S / r.height) - cy]
  }
  c.addEventListener('pointerdown', (e) => {
    const [x, y] = rel(e)
    const { roundness, angle } = get()
    const a = (angle * Math.PI) / 180
    const rx = Math.cos(a) * R
    const ry = Math.sin(a) * R
    const sx = Math.sin(a) * R * roundness
    const sy = -Math.cos(a) * R * roundness
    mode = Math.hypot(x - rx, y - ry) < Math.hypot(x - sx, y - sy) ? 'rot' : 'sq'
    cap(c, e.pointerId)
    move(e)
  })
  const move = (e: PointerEvent): void => {
    if (!mode) return
    const [x, y] = rel(e)
    const { roundness, angle } = get()
    if (mode === 'rot') set(roundness, ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360)
    else {
      const a = (angle * Math.PI) / 180
      // distance along the minor axis (perpendicular to the major axis)
      const d = x * -Math.sin(a) + y * Math.cos(a)
      set(Math.min(1, Math.max(0.05, Math.abs(d) / R)), angle)
    }
    draw()
  }
  c.addEventListener('pointermove', move)
  c.addEventListener('pointerup', () => (mode = null))
  draw()
  return h('div', null, c)
}
