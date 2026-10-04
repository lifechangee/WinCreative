import { BLEND_GROUPS, BlendMode } from '../core/blend'
import { blendGroupLabel, blendLabel } from './blendLabels'
import { rgbToHex, hexToRgb } from '../app/state'
import type { Layer, LayerProps } from '../doc/layer'
import { displayRows } from '../doc/layerTree'
import { actionsFor } from '../features/layers/actions'
import { Thumbs } from '../features/layers/thumbs'
import { classifyTwoFinger, isPinchTogether } from '../features/layers/rowGestures'
import { h, icon } from './dom'
import type { UIContext } from './registry'
import { t, tk } from '../i18n'

const CSS = `
.lp-top{display:flex;gap:4px;align-items:center;padding:2px 2px 6px;flex-wrap:wrap}
.lp-top .grow{flex:1;color:var(--dim);font-size:11px;text-align:right}
.lp-btn{background:var(--panel2);border:1px solid var(--line);border-radius:7px;padding:4px 8px;cursor:pointer;font-size:12px}
.lp-btn:hover{border-color:var(--accent)}
.lp-multi{display:flex;gap:4px;padding:4px;margin-bottom:4px;background:#2c3a55;border-radius:8px;align-items:center;font-size:12px}
.layer-list{max-height:min(46vh,420px)}
.layer-row{position:relative;touch-action:pan-y;min-height:46px}
.layer-row.multi{background:#26405f}
.layer-row.group{background:#38383d}
.layer-row.hidden .name{opacity:.5}
.layer-row.dropabove::before,.layer-row.dropbelow::after{content:'';position:absolute;left:4px;right:4px;height:3px;background:var(--accent);border-radius:2px}
.layer-row.dropabove::before{top:-2px}.layer-row.dropbelow::after{bottom:-2px}
.layer-row.dropinto{outline:2px solid var(--accent)}
.layer-row.dragging{opacity:.4}
.layer-row .chev{width:18px;height:22px;border:0;background:transparent;color:var(--dim);cursor:pointer;padding:0}
.lthumb,.lthumb-box{width:38px;height:38px;border-radius:5px;flex:none;object-fit:contain;background:repeating-conic-gradient(#c9c9c9 0% 25%,#f2f2f2 0% 50%) 0 0/8px 8px;border:1px solid #0006}
.lthumb-box{display:grid;place-items:center;background:var(--panel);color:var(--dim)}
.lthumb.maskt{background:#000}
.mthumb{position:relative;flex:none;border:2px solid transparent;border-radius:6px;cursor:pointer;height:42px}
.mthumb.editing{border-color:#e33}
.mthumb.off::after{content:'';position:absolute;left:0;right:0;top:50%;height:2px;background:#e33;transform:rotate(-30deg)}
.layer-row .meta{flex:1;min-width:0;display:flex;flex-direction:column}
.layer-row .sub{font-size:10px;color:var(--dim);display:flex;gap:6px}
.layer-row .flag{font-size:10px;color:var(--accent);font-weight:600}
.layer-row .quick{display:none;position:absolute;right:0;top:0;bottom:0;align-items:center;gap:4px;padding:0 6px;background:var(--panel2);border-radius:8px}
.layer-row.swiped .quick{display:flex}
.layer-row .quick button{border:0;border-radius:6px;padding:6px 9px;cursor:pointer;background:var(--panel);}
.layer-row .quick button.danger{background:#a33}
.op-popup{position:fixed;z-index:410;display:flex;gap:8px;align-items:center;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:8px 12px;box-shadow:0 8px 24px #0008;font-size:12px}
.op-popup input{width:150px}
.opbubble{position:fixed;z-index:400;background:#000d;padding:4px 10px;border-radius:12px;pointer-events:none}
.lp-opt-head{display:flex;align-items:center;gap:6px;margin-bottom:6px}
.lp-opt-head b{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lp-opt .menu-item.on::before{content:'\\2713 ';color:var(--accent)}
.lp-opt .sect{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--dim);margin:8px 4px 2px}
.lp-blend .menu-item{padding:6px 10px}
.lp-blend .menu-item.on{background:#2c3a55}
.lp-bg{display:flex;align-items:center;gap:8px;margin:6px 2px}
.lp-bg input[type=color]{width:34px;height:24px;border:1px solid var(--line);background:none;padding:0}
`
let styled = false
function ensureStyles(): void {
  if (styled) return
  styled = true
  document.head.append(h('style', { text: CSS }))
}

type View = { kind: 'list' } | { kind: 'options'; id: string } | { kind: 'blend'; id: string }

export function renderLayerPanel(body: HTMLElement, ctx: UIContext): () => void {
  ensureStyles()
  const app = ctx.app
  const act = actionsFor(app, ctx.toast)
  let doc = app.doc
  let view: View = { kind: 'list' }
  const thumbs = new Thumbs(app)
  const root = h('div')
  body.append(root)

  let gestureActive = false
  // touch pinch of two fingers on two different rows = merge those layers
  let pinch: { ids: [string, string]; pids: [number, number]; pos: Record<number, { y: number }>; d0: number; done: boolean } | null = null
  const touchDown = new Map<number, { id: string; y: number; abort: () => void }>()
  let dirtyDuringGesture = false
  let swipedId: string | null = null
  let raf = 0
  const schedule = (): void => {
    if (gestureActive) {
      dirtyDuringGesture = true
      return
    }
    if (!raf)
      raf = requestAnimationFrame(() => {
        raf = 0
        build()
      })
  }

  // ------------------------------------------------------------ helpers
  const menuItem = (label: string, fn: () => void, o: { on?: boolean; disabled?: boolean; danger?: boolean } = {}): HTMLElement =>
    h('button', { class: 'menu-item' + (o.on ? ' on' : ''), disabled: !!o.disabled, onclick: fn, style: o.danger ? 'color:#ff8080' : '' }, h('span', { text: label }))
  const btn = (text: string | SVGElement, title: string, fn: () => void, cls = 'lp-btn'): HTMLElement => h('button', { class: cls, title, onclick: fn }, typeof text === 'string' ? text : text)

  const opacityRow = (l: Layer, label = t('layers.options.opacity')): HTMLElement => {
    const input = h('input', { type: 'range', min: 0, max: 100, step: 1 })
    const val = h('span', { class: 'val' })
    const set = (): void => {
      input.value = String(Math.round(l.opacity * 100))
      val.textContent = Math.round(l.opacity * 100) + '%'
    }
    set()
    let before: LayerProps | null = null
    input.addEventListener('pointerdown', () => {
      gestureActive = true
    })
    input.addEventListener('input', () => {
      before ??= l.props
      doc.setLayerPropsLive(l.id, { opacity: Number(input.value) / 100 })
      val.textContent = input.value + '%'
    })
    input.addEventListener('change', () => {
      if (before) doc.recordPropChange(l.id, before)
      before = null
      endGesture()
    })
    return h('div', { class: 'row' }, h('span', { class: 'lbl', text: label }), input, val)
  }

  const endGesture = (): void => {
    gestureActive = false
    if (dirtyDuringGesture) {
      dirtyDuringGesture = false
      schedule()
    }
  }

  // ------------------------------------------------------------ LIST VIEW
  const buildList = (): void => {
    const layers = doc.layers
    const sel = new Set(doc.selectedLayerIds())
    const multi = sel.size > 1
    const top = h(
      'div',
      { class: 'lp-top' },
      btn(icon('plus', 16), t('layers.panel.newLayer'), act.newLayer),
      btn(t('layers.panel.groupBtn'), t('layers.panel.group'), act.newGroup),
      btn(t('layers.panel.mergeBtn'), t('layers.panel.merge'), act.mergeSmart),
      btn(t('layers.panel.flattenBtn'), t('layers.panel.flatten'), act.flatten),
      h('span', { class: 'grow', text: t('layers.panel.layerCount', { n: doc.paintLayerCount, max: doc.maxLayers }) })
    )
    root.append(top)
    if (multi)
      root.append(
        h('div', { class: 'lp-multi' }, h('span', { text: t('layers.panel.selected', { count: sel.size }), style: 'flex:1' }), btn(t('layers.panel.groupBtn'), t('layers.panel.groupSelected'), act.newGroup), btn(t('layers.panel.mergeBtn'), t('layers.panel.mergeSelected'), act.mergeSelected), btn(t('core.common.delete'), t('layers.panel.deleteSelected'), () => act.remove()))
      )
    const list = h('div', { class: 'layer-list' })
    for (const { layer: l, depth } of displayRows(layers)) list.append(buildRow(l, depth, sel))
    root.append(list)

    const act1 = doc.activeLayer
    if (act1) {
      root.append(h('div', { class: 'layer-props' }, opacityRow(act1), blendRow(act1)))
    }
    const bgColor = h('input', { type: 'color', value: rgbToHex(doc.background.color) })
    bgColor.addEventListener('change', () => {
      const c = hexToRgb(bgColor.value)
      if (c) doc.setBackground(c, doc.background.visible)
    })
    const bgVis = h('input', { type: 'checkbox', checked: doc.background.visible })
    bgVis.addEventListener('change', () => doc.setBackground(doc.background.color, bgVis.checked))
    root.append(h('div', { class: 'lp-bg' }, h('label', { class: 'chk', style: 'margin:0;flex:1' }, bgVis, t('layers.panel.bgColor')), bgColor))
    thumbs.prune()
  }

  const blendRow = (l: Layer): HTMLElement => {
    const label = l.isGroup && l.passThrough ? t('layers.panel.passThrough') : blendLabel(l.blendMode)
    return h('div', { class: 'row' }, h('span', { class: 'lbl', text: t('layers.panel.blendLabel') }), h('button', { class: 'lp-btn', style: 'flex:1;text-align:left', text: label, icon: 'chevd', iconSize: 12, onclick: () => go({ kind: 'blend', id: l.id }) }))
  }

  const buildRow = (l: Layer, depth: number, sel: Set<string>): HTMLElement => {
    const isActive = l.id === doc.activeId
    const kids = l.isGroup ? doc.childrenOf(l.id) : []
    const row = h('div', { class: ['layer-row', isActive ? 'sel' : '', !isActive && sel.has(l.id) ? 'multi' : '', l.clipping ? 'clip' : '', l.isGroup ? 'group' : '', l.visible ? '' : 'hidden', swipedId === l.id ? 'swiped' : ''].filter(Boolean).join(' '), style: `margin-left:${depth * 14}px` })
    row.dataset.id = l.id
    if (l.isGroup)
      row.append(
        h('button', {
          class: 'chev',
          title: l.collapsed ? t('layers.panel.expandTitle') : t('layers.panel.collapseTitle'),
          icon: l.collapsed ? 'chevr' : 'chevd',
          iconSize: 14,
          onclick: (e: Event) => {
            e.stopPropagation()
            doc.setLayerProps(l.id, { collapsed: !l.collapsed })
          }
        })
      )
    // thumbnail (click -> layer pixels when the mask was being edited)
    const th = l.isGroup ? h('div', { class: 'lthumb-box', title: t('layers.panel.groupTitle', { count: kids.length }) }, icon('layers', 20)) : thumbs.canvas(l, false)
    if (!l.isGroup) {
      th.title = l.clipping ? t('layers.panel.clippedBelow') : ''
      th.onclick = (e) => {
        if (l.mask && l.editingMask) {
          e.stopPropagation()
          act.editMask(false, l.id)
        }
      }
    }
    row.append(th)
    const name = h('span', { class: 'name', text: l.name, title: t('layers.panel.renameTitle') })
    name.addEventListener('dblclick', (e) => {
      e.stopPropagation()
      startRename(name, l)
    })
    const sub = h('div', { class: 'sub' })
    if (l.blendMode !== 'normal' && !(l.isGroup && l.passThrough)) sub.append(h('span', { text: blendLabel(l.blendMode) }))
    if (l.opacity < 0.995) sub.append(h('span', { text: Math.round(l.opacity * 100) + '%' }))
    if (l.isGroup && l.passThrough) sub.append(h('span', { text: t('layers.panel.passThrough') }))
    if (l.alphaLock) sub.append(h('span', { class: 'flag', text: t('layers.panel.alphaLock'), title: t('layers.panel.alphaLockTitle') }))
    if (l.reference) sub.append(h('span', { class: 'flag', text: t('layers.panel.reference'), title: t('layers.panel.referenceTitle') }))
    if (l.drawingAssist) sub.append(h('span', { class: 'flag', text: t('layers.panel.assist'), title: t('layers.panel.assistTitle') }))
    row.append(h('div', { class: 'meta' }, name, sub))
    if (l.mask) {
      const mc = thumbs.canvas(l, true)
      mc.classList.add('maskt')
      const mt = h('div', { class: 'mthumb' + (l.editingMask ? ' editing' : '') + (l.maskEnabled ? '' : ' off'), title: t('layers.panel.maskTitle') }, mc)
      mt.addEventListener('click', (e) => {
        e.stopPropagation()
        act.editMask(!l.editingMask, l.id)
      })
      mt.addEventListener('pointerdown', (e) => e.stopPropagation())
      row.append(mt)
    }
    if (l.locked) row.append(icon('lock', 14))
    const vis = h('button', { class: 'ibtn' + (l.visible ? '' : ' off'), title: t('layers.panel.visibilityTitle'), onclick: (e: Event) => (e.stopPropagation(), doc.setLayerProps(l.id, { visible: !l.visible })) }, icon(l.visible ? 'eye' : 'eyeoff', 16))
    vis.addEventListener('pointerdown', (e) => e.stopPropagation())
    row.append(vis)
    row.append(
      h(
        'div',
        { class: 'quick' },
        h('button', { text: l.locked ? t('layers.panel.unlock') : t('layers.panel.lock'), onclick: (e: Event) => (e.stopPropagation(), (swipedId = null), doc.setLayerProps(l.id, { locked: !l.locked })) }),
        h('button', { text: t('layers.panel.duplicateAction'), onclick: (e: Event) => (e.stopPropagation(), (swipedId = null), act.duplicate(l.id)) }),
        h('button', { class: 'danger', text: t('layers.panel.deleteAction'), onclick: (e: Event) => (e.stopPropagation(), (swipedId = null), act.remove(l.id)) })
      )
    )
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      doc.setActive(l.id)
      go({ kind: 'options', id: l.id })
    })
    attachGestures(row, l)
    return row
  }

  const startRename = (name: HTMLElement, l: Layer): void => {
    const input = h('input', { class: 'rename', value: l.name })
    name.replaceWith(input)
    input.focus()
    input.select()
    let done = false
    const finish = (commit: boolean): void => {
      if (done) return
      done = true
      if (commit && input.value.trim() && input.value.trim() !== l.name) doc.setLayerProps(l.id, { name: input.value.trim() })
      else schedule()
    }
    input.addEventListener('blur', () => finish(true))
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true)
      if (e.key === 'Escape') finish(false)
    })
  }

  // ------------------------------------------------------------ row gestures (mouse / pen / touch)
  // click = select, click on selected = options, Ctrl/Shift+click = multi-select, drag right = multi-select,
  // drag left = quick actions (lock/duplicate/delete), vertical drag = reorder (touch: press and hold),
  // Alt+drag or two fingers = opacity, right-click = options.
  const attachGestures = (row: HTMLElement, l: Layer): void => {
    const ptrs = new Map<number, { x: number; y: number }>()
    let mode: 'none' | 'pending' | 'opacity' | 'two' | 'drag' | 'swipe' | 'select' | 'ignore' = 'none'
    let sx = 0
    let sy = 0
    let holdOk = false
    let holdTimer = 0
    let before: LayerProps | null = null
    let startOpacity = 0
    let bubble: HTMLElement | null = null
    let dropRow: HTMLElement | null = null
    let dropWhere: 'above' | 'below' | 'into' = 'above'
    let wasActive = false
    let two: { t: number; cx: number; cy: number; timer: number } | null = null

    const clearDrop = (): void => {
      document.querySelectorAll('.layer-row.dropabove,.layer-row.dropbelow,.layer-row.dropinto').forEach((el) => el.classList.remove('dropabove', 'dropbelow', 'dropinto'))
    }
    const centre = (): { x: number; y: number } => {
      const v = [...ptrs.values()]
      return { x: v.reduce((a, p) => a + p.x, 0) / v.length, y: v.reduce((a, p) => a + p.y, 0) / v.length }
    }
    const showOpacityPopup = (): void => {
      document.querySelector('.op-popup')?.remove()
      const r = row.getBoundingClientRect()
      const before0 = l.props
      const inp = h('input', { type: 'range', min: '0', max: '100', value: String(Math.round(l.opacity * 100)) }) as HTMLInputElement
      const lab = h('span', { text: Math.round(l.opacity * 100) + '%', style: 'min-width:34px;text-align:right' })
      const pop = h('div', { class: 'op-popup', style: `left:${Math.max(8, r.left)}px;top:${r.bottom + 4}px` }, h('span', { text: t('layers.options.opacity') }), inp, lab)
      inp.addEventListener('input', () => {
        doc.setLayerPropsLive(l.id, { opacity: +inp.value / 100 })
        lab.textContent = inp.value + '%'
      })
      inp.addEventListener('change', () => doc.recordPropChange(l.id, before0))
      const away = (ev: Event): void => {
        if (pop.contains(ev.target as Node)) return
        pop.remove()
        document.removeEventListener('pointerdown', away, true)
      }
      document.body.append(pop)
      setTimeout(() => document.addEventListener('pointerdown', away, true), 0)
    }
    const finish = (): void => {
      clearTimeout(holdTimer)
      if (two) clearTimeout(two.timer)
      two = null
      bubble?.remove()
      bubble = null
      clearDrop()
      row.classList.remove('dragging')
      mode = 'none'
      ptrs.clear()
      endGesture()
    }
    row.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      if ((e.target as HTMLElement).closest('input,.quick')) return
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (e.pointerType === 'touch') {
        // second finger on ANOTHER row: start a pinch-merge and cancel the first row's own gesture
        const other = [...touchDown.entries()].find(([pid, t]) => t.id !== l.id && pid !== e.pointerId)
        touchDown.set(e.pointerId, { id: l.id, y: e.clientY, abort: () => (mode = 'ignore') })
        if (other && !pinch) {
          other[1].abort()
          pinch = { ids: [other[1].id, l.id], pids: [other[0], e.pointerId], pos: { [other[0]]: { y: other[1].y }, [e.pointerId]: { y: e.clientY } }, d0: Math.abs(other[1].y - e.clientY), done: false }
          mode = 'ignore'
          return
        }
      }
      if (ptrs.size === 1) {
        sx = e.clientX
        sy = e.clientY
        wasActive = l.id === doc.activeId
        mode = e.altKey ? 'opacity' : 'pending'
        holdOk = e.pointerType === 'mouse' || e.pointerType === 'pen'
        gestureActive = true
        if (e.pointerType === 'touch') holdTimer = window.setTimeout(() => (holdOk = true), 350)
        startOpacity = l.opacity
        before = null
        try {
          row.setPointerCapture(e.pointerId)
        } catch {
          /* synthetic pointer */
        }
      } else if (ptrs.size === 2 && e.pointerType === 'touch') {
        clearTimeout(holdTimer)
        const c = centre()
        const st = { t: performance.now(), cx: c.x, cy: c.y, timer: 0 }
        st.timer = window.setTimeout(() => {
          if (mode === 'two' && two === st) {
            mode = 'ignore'
            act.selectAlpha(l.id)
          }
        }, 560)
        two = st
        mode = 'two'
      } else if (ptrs.size === 2) mode = 'opacity'
      if (mode === 'opacity') {
        startOpacity = l.opacity
        sx = e.clientX
      }
    })
    row.addEventListener('pointermove', (e) => {
      const p = ptrs.get(e.pointerId)
      if (!p) return
      p.x = e.clientX
      p.y = e.clientY
      const pn = pinch
      if (pn && pn.pids.includes(e.pointerId)) {
        pn.pos[e.pointerId].y = e.clientY
        if (!pn.done && isPinchTogether(pn.d0, Math.abs(pn.pos[pn.pids[0]].y - pn.pos[pn.pids[1]].y))) {
          pn.done = true
          doc.setLayerSelection(new Set(pn.ids))
          act.mergeSelected()
        }
        return
      }
      if (mode === 'two' && two) {
        const c = centre()
        if (classifyTwoFinger(c.x - two.cx, c.y - two.cy, performance.now() - two.t, false) === 'swipe-right') {
          mode = 'ignore'
          act.toggle('alphaLock', l.id)
        }
        return
      }
      const dx = e.clientX - sx
      const dy = e.clientY - sy
      if (mode === 'pending') {
        if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          if (dx > 0) {
            mode = 'select'
            const set = new Set(doc.selectedLayerIds())
            set.add(l.id)
            doc.layerSel = set
            row.classList.add('multi')
          } else {
            mode = 'swipe'
            swipedId = l.id
            row.classList.add('swiped')
          }
        } else if (Math.abs(dy) > 6 && holdOk) {
          mode = 'drag'
          row.classList.add('dragging')
        } else if (Math.abs(dy) > 10 && !holdOk) {
          mode = 'ignore' // touch scroll
          clearTimeout(holdTimer)
        }
      }
      if (mode === 'opacity') {
        before ??= l.props
        const v = Math.min(1, Math.max(0, startOpacity + (e.clientX - sx) / 220))
        doc.setLayerPropsLive(l.id, { opacity: v })
        if (!bubble) document.body.append((bubble = h('div', { class: 'opbubble' })))
        bubble.textContent = t('layers.options.opacityLabel') + Math.round(v * 100) + '%'
        bubble.style.left = e.clientX + 12 + 'px'
        bubble.style.top = e.clientY - 34 + 'px'
      } else if (mode === 'select') {
        const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('.layer-row') as HTMLElement | null
        if (el?.dataset.id) {
          const set = new Set(doc.selectedLayerIds())
          if (!set.has(el.dataset.id)) {
            set.add(el.dataset.id)
            doc.layerSel = set
            el.classList.add('multi')
          }
        }
      } else if (mode === 'drag') {
        clearDrop()
        const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('.layer-row') as HTMLElement | null
        dropRow = null
        if (el && el.dataset.id && el.dataset.id !== l.id) {
          const r = el.getBoundingClientRect()
          const f = (e.clientY - r.top) / r.height
          const target = doc.getLayer(el.dataset.id)
          if (target?.isGroup && f > 0.25 && f < 0.75) dropWhere = 'into'
          else dropWhere = f < 0.5 ? 'above' : 'below'
          dropRow = el
          el.classList.add(dropWhere === 'into' ? 'dropinto' : dropWhere === 'above' ? 'dropabove' : 'dropbelow')
        }
      }
    })
    const up = (e: PointerEvent): void => {
      touchDown.delete(e.pointerId)
      if (pinch && pinch.pids.includes(e.pointerId)) {
        ptrs.delete(e.pointerId)
        if (![...touchDown.keys()].some((k) => pinch!.pids.includes(k))) pinch = null
        if (!ptrs.size) finish()
        return
      }
      if (!ptrs.has(e.pointerId)) return
      if (mode === 'two' && two && e.type === 'pointerup') {
        const c = centre()
        if (classifyTwoFinger(c.x - two.cx, c.y - two.cy, performance.now() - two.t, true) === 'tap') showOpacityPopup()
      }
      const m = mode
      const moved = Math.hypot(e.clientX - sx, e.clientY - sy)
      if (m === 'opacity' && before) doc.recordPropChange(l.id, before)
      else if (m === 'drag' && dropRow?.dataset.id) {
        const ref = dropRow.dataset.id
        const w = dropWhere
        finish()
        if (!doc.moveLayerRelative(l.id, ref, w)) ctx.toast(t('layers.toast.cannotMove'))
        return
      } else if (m === 'pending' && moved < 6 && e.type === 'pointerup') {
        finish()
        onRowClick(l, e, wasActive)
        return
      } else if (m === 'select') doc.setLayerSelection(new Set(doc.selectedLayerIds()))
      finish()
    }
    row.addEventListener('pointerup', up)
    row.addEventListener('pointercancel', up)
  }

  const onRowClick = (l: Layer, e: PointerEvent, wasActive: boolean): void => {
    swipedId = null
    if (e.ctrlKey || e.metaKey) {
      const set = new Set(doc.selectedLayerIds())
      if (set.has(l.id) && set.size > 1) set.delete(l.id)
      else set.add(l.id)
      doc.setLayerSelection(set)
      if (!set.has(doc.activeId)) doc.setActive([...set][0])
    } else if (e.shiftKey) {
      const a = doc.layerIndex(doc.activeId)
      const b = doc.layerIndex(l.id)
      const [lo, hi] = a < b ? [a, b] : [b, a]
      doc.setLayerSelection(doc.layers.slice(lo, hi + 1).map((x) => x.id))
    } else if (wasActive && doc.selectedLayerIds().length === 1) {
      go({ kind: 'options', id: l.id })
    } else doc.setActive(l.id)
  }

  // ------------------------------------------------------------ OPTIONS VIEW
  const buildOptions = (id: string): void => {
    const l = doc.getLayer(id)
    if (!l) return go({ kind: 'list' })
    const wrap = h('div', { class: 'lp-opt' })
    const head = h('div', { class: 'lp-opt-head' }, btn(t('layers.options.backToLayers'), t('core.common.back'), () => go({ kind: 'list' })), h('b', { text: l.name }))
    wrap.append(head)
    const name = h('input', { class: 'rename', value: l.name, style: 'width:100%;margin-bottom:4px' })
    name.addEventListener('change', () => {
      if (name.value.trim()) doc.setLayerProps(l.id, { name: name.value.trim() })
    })
    name.addEventListener('keydown', (e) => e.key === 'Enter' && name.blur())
    wrap.append(h('div', { class: 'row' }, h('span', { class: 'lbl', text: t('layers.options.rename') }), name))
    wrap.append(opacityRow(l))
    wrap.append(blendRow(l))
    const M = (label: string, fn: () => void, o: { on?: boolean; disabled?: boolean; danger?: boolean } = {}): void => {
      wrap.append(
        menuItem(
          label,
          () => {
            fn()
          },
          o
        )
      )
    }
    const S = (label: string): void => void wrap.append(h('div', { class: 'sect', text: label }))
    if (l.isGroup) {
      S(t('layers.options.group'))
      M(t('layers.options.ungroup'), () => (act.ungroup(l.id), go({ kind: 'list' })))
      M(t('layers.options.mergeGroup'), () => (act.mergeGroup(l.id), go({ kind: 'list' })))
      M(t('layers.options.flattenGroup'), () => (act.mergeGroup(l.id), go({ kind: 'list' })))
      M(t('core.common.duplicate'), () => (act.duplicate(l.id), go({ kind: 'list' })))
      M(t('layers.panel.alphaLockTitle'), () => act.toggle('alphaLock', l.id), { on: l.alphaLock })
      M(t('layers.options.locked'), () => act.toggle('locked', l.id), { on: l.locked })
      M(t('core.common.delete'), () => (act.remove(l.id), go({ kind: 'list' })), { danger: true })
    } else {
      S(t('layers.options.layer'))
      M(t('layers.options.selectAlpha'), () => act.selectAlpha(l.id))
      M(t('layers.options.copyLayer'), () => (doc.setActive(l.id), act.copy()))
      M(t('layers.options.fillLayer'), () => act.fill(l.id), { disabled: l.locked })
      M(t('layers.options.clear'), () => act.clear(l.id), { disabled: l.locked })
      M(t('layers.panel.alphaLockTitle'), () => act.toggle('alphaLock', l.id), { on: l.alphaLock })
      M(t('layers.options.clippingMask'), () => act.toggle('clipping', l.id), { on: l.clipping })
      M(t('layers.options.reference'), () => act.setReference(l.id), { on: l.reference })
      M(t('layers.options.invert'), () => act.invert(l.id), { disabled: l.locked })
      M(t('layers.options.drawingAssist'), () => act.toggle('drawingAssist', l.id), { on: l.drawingAssist })
      M(t('layers.options.locked'), () => act.toggle('locked', l.id), { on: l.locked })
      S(t('layers.options.merge'))
      M(t('layers.options.mergeDown'), () => (act.mergeDown(l.id), go({ kind: 'list' })))
      M(t('layers.options.combineDown'), () => (act.combineDown(l.id), go({ kind: 'list' })))
      M(t('layers.options.flattenAll'), () => (act.flatten(), go({ kind: 'list' })))
      M(t('core.common.duplicate'), () => (act.duplicate(l.id), go({ kind: 'list' })))
      M(t('layers.options.exportPng'), () => void act.exportLayer('png', l.id))
      M(t('layers.options.exportPsd'), () => void act.exportLayer('psd', l.id))
      M(t('core.common.delete'), () => (act.remove(l.id), go({ kind: 'list' })), { danger: true })
    }
    S(t('layers.options.mask'))
    if (!l.mask) {
      M(t('layers.options.addMask'), () => act.addMask('white', l.id))
      M(t('layers.options.addMaskHideAll'), () => act.addMask('black', l.id))
      M(t('layers.options.addMaskSelection'), () => act.addMask('selection', l.id))
    } else {
      M(l.maskEnabled ? t('layers.options.disableMask') : t('layers.options.enableMask'), () => act.maskEnable(l.id))
      M(t('layers.options.showMask'), () => act.maskShow(l.id), { on: l.maskView })
      M(t('layers.options.paintMask'), () => act.editMask(!l.editingMask, l.id), { on: l.editingMask })
      M(t('layers.options.invertMask'), () => act.maskInvert(l.id))
      M(t('layers.options.clearMask'), () => act.maskClear(l.id))
      M(t('layers.options.applyMask'), () => act.maskApply(l.id), { disabled: l.isGroup })
      M(t('layers.options.deleteMask'), () => act.maskDelete(l.id), { danger: true })
    }
    root.append(wrap)
  }

  // ------------------------------------------------------------ BLEND VIEW (live preview)
  const buildBlend = (id: string): void => {
    const l = doc.getLayer(id)
    if (!l) return go({ kind: 'list' })
    const original = l.props
    let committed = false
    const wrap = h('div', { class: 'lp-blend' })
    wrap.append(h('div', { class: 'lp-opt-head' }, btn(t('layers.options.backBlend'), t('core.common.back'), () => go({ kind: 'options', id })), h('b', { text: t('layers.options.blendModeTitle') })))
    const restore = (): void => {
      if (!committed) doc.setLayerPropsLive(id, { blendMode: original.blendMode, passThrough: original.passThrough })
    }
    const pick = (patch: Partial<LayerProps>): void => {
      committed = true
      Object.assign(l, original)
      doc.setLayerProps(id, patch)
      go({ kind: 'options', id })
    }
    const opt = (label: string, patch: Partial<LayerProps>, on: boolean): HTMLElement => {
      const b = menuItem(label, () => pick(patch), { on })
      b.addEventListener('pointerenter', () => doc.setLayerPropsLive(id, patch))
      return b
    }
    if (l.isGroup) wrap.append(opt(t('layers.panel.passThrough'), { passThrough: true }, original.passThrough))
    for (const g of BLEND_GROUPS) {
      wrap.append(h('div', { class: 'sect', text: blendGroupLabel(g.name), style: 'font-size:10px;color:var(--dim);margin:6px 4px 0' }))
      for (const m of g.modes) wrap.append(opt(blendLabel(m as BlendMode), { blendMode: m, passThrough: false }, original.blendMode === m && !(l.isGroup && original.passThrough)))
    }
    wrap.addEventListener('pointerleave', restore)
    blendCleanup = restore
    root.append(wrap)
  }
  let blendCleanup: (() => void) | null = null

  // ------------------------------------------------------------ navigation / build
  const go = (v: View): void => {
    blendCleanup?.()
    blendCleanup = null
    view = v
    build()
  }
  const build = (): void => {
    if (gestureActive) return void (dirtyDuringGesture = true)
    const scroll = root.querySelector('.layer-list')?.scrollTop ?? 0
    root.replaceChildren()
    if (view.kind === 'options') buildOptions(view.id)
    else if (view.kind === 'blend') buildBlend(view.id)
    else {
      buildList()
      const l = root.querySelector('.layer-list')
      if (l) l.scrollTop = scroll
    }
  }

  // ------------------------------------------------------------ wiring
  const onLayers = (): void => {
    if (view.kind === 'blend') return // live preview edits must not rebuild the hovered list
    schedule()
  }
  let offLayers = doc.events.on('layers', onLayers)
  let offCommit = doc.events.on('commit', (e) => thumbs.markDirty(e.layerId))
  const offDoc = app.events.on('doc', (d) => {
    offLayers()
    offCommit()
    doc = d
    thumbs.markDirty(null)
    offLayers = doc.events.on('layers', onLayers)
    offCommit = doc.events.on('commit', (e) => thumbs.markDirty(e.layerId))
    view = { kind: 'list' }
    schedule()
  })
  thumbs.onUpdate = () => void 0
  build()
  return () => {
    blendCleanup?.()
    offLayers()
    offCommit()
    offDoc()
    cancelAnimationFrame(raf)
    thumbs.dispose()
  }
}
