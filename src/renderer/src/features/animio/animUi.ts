import type { App } from '../../app/app'
import { h } from '../../ui/dom'
import { I18nRef, tk } from '../../i18n'
import { registerMenuItem } from '../../ui/registry'
import type { UIContext } from '../../ui/registry'
import { AnimAssist } from './animation'
import { openAnimExport } from './animExport'
import type { PlayMode } from './schedule'
import { ThumbMaker } from './thumbs'
import { btn, ensureStyles, numberInput, select } from './ui'

export interface StripHooks {
  /** Called when Animation Assist turns on so Page Assist can turn off (mutually exclusive) */
  onEnable?: () => void
}

/** Bottom timeline for Animation Assist. */
export function installAnimationUi(app: App, ui: UIContext, hooks: StripHooks = {}): AnimAssist {
  ensureStyles()
  const anim = new AnimAssist(app)
  const thumbs = new ThumbMaker(app, () => anim.renderer())
  const strip = h('div', { class: 'an-strip', style: 'display:none' })
  document.body.append(strip)
  const dirty = new Set<string>()
  let allDirty = true
  let raf = 0
  const canvases = new Map<string, HTMLCanvasElement>()
  let dragId: string | null = null

  const rebuild = (): void => {
    const s = anim.state
    if (!s.enabled) {
      strip.style.display = 'none'
      return
    }
    strip.style.display = 'flex'
    strip.replaceChildren()
    const play = btn(anim.playing ? tk('animio.anim.pause') : tk('animio.anim.play'), () => anim.toggle(), 'small')
    const mode = select<PlayMode>([['loop', tk('animio.mode.loop')], ['pingpong', tk('animio.mode.pingpong')], ['oneshot', tk('animio.mode.oneshot')]], s.mode, (v) => {
      s.mode = v
      anim.events.emit('change', undefined)
    })
    const fps = numberInput(s.fps, 1, 60, (v) => (s.fps = v))
    const onion = h('input', { type: 'checkbox', checked: s.onion.on })
    onion.addEventListener('change', () => {
      s.onion.on = onion.checked
      anim.refresh()
    })
    const nb = numberInput(s.onion.before, 0, 8, (v) => ((s.onion.before = v), anim.refresh()))
    const na = numberInput(s.onion.after, 0, 8, (v) => ((s.onion.after = v), anim.refresh()))
    const op = h('input', { type: 'range', min: '5', max: '100', value: String(Math.round(s.onion.opacity * 100)), style: 'width:80px' })
    op.addEventListener('input', () => {
      s.onion.opacity = Number(op.value) / 100
      anim.refresh()
    })
    const cb = h('input', { type: 'color', value: s.onion.colorBefore, title: tk('animio.anim.tintBefore') })
    cb.addEventListener('input', () => ((s.onion.colorBefore = cb.value), anim.refresh()))
    const ca = h('input', { type: 'color', value: s.onion.colorAfter, title: tk('animio.anim.tintAfter') })
    ca.addEventListener('input', () => ((s.onion.colorAfter = ca.value), anim.refresh()))
    const bp = h('input', { type: 'checkbox', checked: s.blendPrimary })
    bp.addEventListener('change', () => ((s.blendPrimary = bp.checked), anim.refresh()))
    const lab = (t: string | I18nRef): HTMLElement => h('span', { class: 'lbl', text: t })
    strip.append(
      h('div', { class: 'an-row' }, h('b', { text: tk('animio.anim.title') }), play, lab(tk('animio.anim.mode')), mode, lab(tk('animio.anim.fps')), fps, lab(tk('animio.anim.onion')), onion, lab(tk('animio.anim.before')), nb, lab(tk('animio.anim.after')), na, lab(tk('core.common.opacity')), op, cb, ca, lab(tk('animio.anim.primaryOnTop')), bp, btn(tk('animio.common.exportEllipsis'), () => openAnimExport(app, ui, anim), 'small'), btn(tk('core.common.close'), () => anim.setEnabled(false), 'small'))
    )

    const frames = anim.frames()
    const cur = anim.current
    const list = h('div', { class: 'an-frames' })
    canvases.clear()
    const mk = (l: (typeof frames)[number], idx: number | null, tag: string): HTMLElement => {
      const cv = h('canvas', { style: 'width:100%;height:100%;object-fit:contain;pointer-events:none' })
      canvases.set(l.id, cv)
      const el = h('div', { class: 'an-frame' + (idx === cur ? ' sel' : '') + (tag ? ' ' + tag : ''), draggable: true, 'data-tag': tag === 'bg' ? 'BG' : tag === 'fg' ? 'FG' : '' }, cv, h('span', { class: 'n', text: idx !== null ? String(idx + 1) : l.name }), idx !== null && anim.holdOf(l) > 1 ? h('span', { class: 'hold', text: tk('animio.anim.holdBadge', { n: anim.holdOf(l) }) }) : null)
      el.addEventListener('click', () => (idx !== null ? anim.setCurrent(idx) : ui.app.doc.setActive(l.id)))
      el.addEventListener('dragstart', (e) => {
        dragId = l.id
        e.dataTransfer?.setData('text/plain', l.id)
      })
      el.addEventListener('dragover', (e) => {
        e.preventDefault()
        el.classList.add('drop')
      })
      el.addEventListener('dragleave', () => el.classList.remove('drop'))
      el.addEventListener('drop', (e) => {
        e.preventDefault()
        el.classList.remove('drop')
        if (dragId && dragId !== l.id) anim.moveFrame(dragId, l.id)
        dragId = null
      })
      return el
    }
    for (const b of anim.backgrounds()) list.append(mk(b, null, 'bg'))
    frames.forEach((f, i) => list.append(mk(f, i, '')))
    for (const f of anim.foregrounds()) list.append(mk(f, null, 'fg'))
    list.append(h('button', { class: 'an-frame', style: 'display:grid;place-items:center;font-size:26px;background:var(--panel2)', title: tk('animio.anim.addFrame'), onclick: () => anim.addFrame(), icon: 'plus', iconSize: 26 }))
    const sel = frames[cur]
    const hold = numberInput(sel ? anim.holdOf(sel) : 1, 1, 240, (v) => anim.setHold(cur, v))
    const roleBtns = sel ? [btn(tk('animio.anim.setBg'), () => anim.setRole(sel.id, 'bg'), 'small'), btn(tk('animio.anim.setFg'), () => anim.setRole(sel.id, 'fg'), 'small')] : []
    const unrole = [...anim.backgrounds(), ...anim.foregrounds()].map((l) => btn(tk('animio.anim.restore', { name: l.name }), () => anim.setRole(l.id, 'none'), 'small'))
    strip.append(
      list,
      h('div', { class: 'an-row' }, lab(tk('animio.anim.frameOf', { n: cur + 1, total: frames.length })), btn(tk('core.common.duplicate'), () => anim.duplicateFrame(), 'small'), btn(tk('core.common.delete'), () => anim.deleteFrame(), 'small'), btn(tk('core.common.copy'), () => anim.copyFrame(), 'small'), btn(tk('core.common.paste'), () => anim.pasteFrame(), 'small'), lab(tk('animio.anim.hold')), hold, ...roleBtns, ...unrole)
    )
    allDirty = true
    scheduleThumbs()
  }

  const scheduleThumbs = (): void => {
    if (raf) return
    raf = window.setTimeout(() => {
      raf = 0
      if (!anim.state.enabled) return
      const targets = allDirty ? [...canvases.keys()] : [...dirty].filter((i) => canvases.has(i))
      dirty.clear()
      allDirty = false
      for (const id of targets) {
        const l = app.doc.getLayer(id)
        const cv = canvases.get(id)
        if (l && cv) thumbs.draw(cv, [l])
      }
    }, 120)
  }

  anim.events.on('change', () => {
    if (anim.playing) {
      // cheap update while playing: just move the selection highlight
      strip.querySelectorAll('.an-frame').forEach((el, i) => el.classList.toggle('sel', i === anim.current + anim.backgrounds().length))
      return
    }
    rebuild()
  })
  anim.events.on('dirty', (ids) => {
    if (!anim.state.enabled) return
    if (!ids) allDirty = true
    else ids.forEach((i) => dirty.add(i))
    scheduleThumbs()
  })
  app.events.on('doc', () => setTimeout(rebuild, 0))

  const refreshMenu = (): void =>
    registerMenuItem('actions', {
      id: 'canvas-anim',
      group: 'canvas',
      label: anim.enabled ? tk('animio.menu.anim.on') : tk('animio.menu.anim.off'),
      run: () => {
        if (!anim.enabled) hooks.onEnable?.()
        anim.setEnabled(!anim.enabled)
      }
    })
  anim.events.on('change', refreshMenu)
  refreshMenu()
  return anim
}
