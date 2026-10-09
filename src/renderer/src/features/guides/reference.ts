import type { App } from '../../app/app'
import { rgbToHsv } from '../../app/state'
import { I18nRef, t, tk } from '../../i18n'
import { h } from '../../ui/dom'
import { registerMenuItem } from '../../ui/registry'
import { frameRect } from '../frame/workRect'
import { injectCss } from './widgets'

type Src = { w: number; h: number; draw(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void }

/** Reference window: floating, movable, resizable; Canvas mode mirrors the artwork, Image mode shows an imported picture. */
export function installReference(app: App): { open(): void; close(): void } {
  injectCss(`
.bwf-ref{position:fixed;z-index:55;right:16px;bottom:16px;width:400px;height:300px;min-width:180px;min-height:140px;resize:both;overflow:hidden;display:none;flex-direction:column;background:var(--panel,#2a2a2d);border:1px solid var(--line,#3d3d42);border-radius:10px;box-shadow:0 12px 40px #000a;color:var(--text,#e8e8ea)}
.bwf-ref.open{display:flex}
.bwf-ref .hd{display:flex;gap:4px;align-items:center;padding:4px 6px;cursor:move;border-bottom:1px solid var(--line,#3d3d42);flex:none}
.bwf-ref .hd .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--dim,#9a9aa2);text-transform:uppercase;letter-spacing:.05em}
.bwf-ref canvas{flex:1;min-height:0;width:100%;background:#111;touch-action:none;cursor:grab}
`)
  const cv = h('canvas') as HTMLCanvasElement
  const btn = (text: string | I18nRef, fn: () => void): HTMLButtonElement => h('button', typeof text === 'string' ? { class: 'bwf-btn', icon: text.slice(1), iconSize: 14, style: 'padding:2px 8px', onclick: fn } : { class: 'bwf-btn', text, style: 'padding:2px 8px', onclick: fn }) as HTMLButtonElement
  const bCanvas = btn(tk('guides.reference.canvas'), () => setMode('canvas'))
  const bImage = btn(tk('guides.reference.image'), () => setMode('image'))
  const file = h('input', { type: 'file', accept: 'image/*', style: 'display:none' }) as HTMLInputElement
  const hd = h('div', { class: 'hd' }, h('span', { class: 't', text: tk('guides.reference.reference') }), bCanvas, bImage, btn(tk('core.common.import'), () => file.click()), btn(tk('guides.reference.fit'), () => fit()), btn('@clear', () => close()))
  const el = h('div', { class: 'bwf-ref' }, hd, cv, file)
  document.body.append(el)
  const ctx = cv.getContext('2d', { willReadFrequently: true })!

  let mode: 'canvas' | 'image' = 'canvas'
  let img: Src | null = null
  let mirror: (Src & { c: HTMLCanvasElement }) | null = null
  let v = { s: 1, x: 0, y: 0 } // image px -> css px: p*s + (x,y)
  let dirty = false
  let timer = 0

  const src = (): Src | null => (mode === 'canvas' ? mirror : img)
  const size = (): { w: number; h: number } => ({ w: cv.clientWidth, h: cv.clientHeight })
  const fit = (): void => {
    const s = src()
    const { w, h: hh } = size()
    if (!s || !w) return
    const k = Math.min(w / s.w, hh / s.h)
    v = { s: k, x: (w - s.w * k) / 2, y: (hh - s.h * k) / 2 }
    draw()
  }
  const draw = (): void => {
    const { w, h: hh } = size()
    const dpr = window.devicePixelRatio || 1
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hh * dpr)) {
      cv.width = Math.round(w * dpr)
      cv.height = Math.round(hh * dpr)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#111'
    ctx.fillRect(0, 0, w, hh)
    const s = src()
    if (!s) {
      ctx.fillStyle = '#888'
      ctx.textAlign = 'center'
      ctx.font = '12px sans-serif'
      ctx.fillText(mode === 'image' ? t('guides.reference.importAnImage') : t('guides.reference.noCanvas'), w / 2, hh / 2)
      return
    }
    ctx.imageSmoothingQuality = 'high'
    s.draw(ctx, v.x, v.y, s.w * v.s, s.h * v.s)
  }
  const refreshMirror = (): void => {
    dirty = false
    if (app.engine.active) return void (dirty = true)
    const doc = app.doc
    let px: Uint8ClampedArray
    let W = doc.width
    let H = doc.height
    if (doc.isInfinite) {
      // infinite canvas: the frame if there is one, else the content bounds (downscaled to <= 2048 px)
      const rect = frameRect(doc) ?? doc.contentBounds() ?? { x: 0, y: 0, w: 1, h: 1 }
      const k = Math.min(1, 2048 / Math.max(rect.w, rect.h))
      const img = app.compositor.readFlattened(rect, k, true)
      px = img.px
      W = img.w
      H = img.h
    } else px = app.compositor.readFlattened(true)
    const c = mirror?.c ?? document.createElement('canvas')
    const first = !mirror || c.width !== W || c.height !== H
    c.width = W
    c.height = H
    c.getContext('2d')!.putImageData(new ImageData(px as unknown as Uint8ClampedArray<ArrayBuffer>, W, H), 0, 0)
    mirror = { c, w: W, h: H, draw: (g, x, y, w, hh) => g.drawImage(c, x, y, w, hh) }
    if (first) fit()
    else draw()
    app.requestRender()
  }
  const schedule = (): void => {
    if (!el.classList.contains('open') || mode !== 'canvas' || timer) return
    timer = window.setTimeout(() => {
      timer = 0
      refreshMirror()
    }, 450)
  }
  const hook = (): void => {
    app.doc.events.on('change', schedule)
    app.doc.events.on('commit', schedule)
  }
  hook()
  app.events.on('doc', () => {
    hook()
    mirror = null
    schedule()
  })
  window.setInterval(() => dirty && !app.engine.active && schedule(), 500)

  const setMode = (m: 'canvas' | 'image'): void => {
    mode = m
    bCanvas.classList.toggle('on', m === 'canvas')
    bImage.classList.toggle('on', m === 'image')
    if (m === 'canvas') refreshMirror()
    fit()
  }
  file.addEventListener('change', async () => {
    const f = file.files?.[0]
    file.value = ''
    if (!f) return
    const bmp = await createImageBitmap(f)
    img = { w: bmp.width, h: bmp.height, draw: (g, x, y, w, hh) => g.drawImage(bmp, x, y, w, hh) }
    setMode('image')
  })

  const open = (): void => {
    el.classList.add('open')
    setMode(mode)
  }
  const close = (): void => el.classList.remove('open')
  new ResizeObserver(() => el.classList.contains('open') && draw()).observe(el)

  // ---- move window
  hd.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return
    const r = el.getBoundingClientRect()
    const dx = e.clientX - r.left
    const dy = e.clientY - r.top
    hd.setPointerCapture(e.pointerId)
    const mv = (ev: PointerEvent): void => {
      el.style.left = Math.max(0, Math.min(window.innerWidth - 60, ev.clientX - dx)) + 'px'
      el.style.top = Math.max(0, Math.min(window.innerHeight - 30, ev.clientY - dy)) + 'px'
      el.style.right = 'auto'
      el.style.bottom = 'auto'
    }
    const up = (): void => {
      hd.removeEventListener('pointermove', mv)
      hd.removeEventListener('pointerup', up)
    }
    hd.addEventListener('pointermove', mv)
    hd.addEventListener('pointerup', up)
  })

  // ---- pan / pinch / wheel / long-press eyedropper
  const ptrs = new Map<number, { x: number; y: number }>()
  let press: number | null = null
  let moved = 0
  const local = (e: PointerEvent): { x: number; y: number } => {
    const r = cv.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const zoomAt = (px: number, py: number, k: number): void => {
    const ns = Math.max(0.02, Math.min(64, v.s * k))
    k = ns / v.s
    v = { s: ns, x: px - (px - v.x) * k, y: py - (py - v.y) * k }
    draw()
  }
  const pick = (p: { x: number; y: number }): void => {
    const dpr = window.devicePixelRatio || 1
    const d = ctx.getImageData(Math.round(p.x * dpr), Math.round(p.y * dpr), 1, 1).data
    app.state.setColor(rgbToHsv(d[0] / 255, d[1] / 255, d[2] / 255), true)
    app.notify(t('guides.reference.pickedColourFromReference'))
  }
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId)
    ptrs.set(e.pointerId, local(e))
    moved = 0
    if (ptrs.size === 1) {
      const p = local(e)
      press = window.setTimeout(() => {
        press = null
        if (moved < 5 && ptrs.size === 1 && src()) pick(p)
      }, 450)
    } else if (press) (clearTimeout(press), (press = null))
  })
  cv.addEventListener('pointermove', (e) => {
    const old = ptrs.get(e.pointerId)
    if (!old) return
    const p = local(e)
    if (ptrs.size === 1) {
      moved += Math.abs(p.x - old.x) + Math.abs(p.y - old.y)
      v = { ...v, x: v.x + p.x - old.x, y: v.y + p.y - old.y }
      ptrs.set(e.pointerId, p)
      draw()
    } else if (ptrs.size === 2) {
      const other = [...ptrs.entries()].find(([id]) => id !== e.pointerId)![1]
      const d0 = Math.hypot(old.x - other.x, old.y - other.y) || 1
      const d1 = Math.hypot(p.x - other.x, p.y - other.y) || 1
      ptrs.set(e.pointerId, p)
      const mx = (p.x + other.x) / 2
      const my = (p.y + other.y) / 2
      v = { ...v, x: v.x + (p.x - old.x) / 2, y: v.y + (p.y - old.y) / 2 }
      zoomAt(mx, my, d1 / d0)
    }
  })
  const up = (e: PointerEvent): void => {
    ptrs.delete(e.pointerId)
    if (press && !ptrs.size) (clearTimeout(press), (press = null))
  }
  cv.addEventListener('pointerup', up)
  cv.addEventListener('pointercancel', up)
  cv.addEventListener('wheel', (e) => {
    e.preventDefault()
    const p = local(e as unknown as PointerEvent)
    zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015))
  }, { passive: false })
  cv.addEventListener('dblclick', () => fit())

  const api = { open, close }
  const toggle = (): void => (el.classList.contains('open') ? close() : open())
  registerMenuItem('actions', { id: 'reference-window', label: tk('guides.reference.referenceWindow'), run: toggle })
  ;(window as any).brushwork_reference = api
  return api
}
