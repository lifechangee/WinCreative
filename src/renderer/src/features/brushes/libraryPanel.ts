import type { ToolId } from '../../app/state'
import { BrushPreset } from '../../core/brush'
import { brushName, isDefaultBrush, setName } from '../../brush/presets'
import { I18nRef, t, tk } from '../../i18n'
import { h } from '../../ui/dom'
import type { UIContext } from '../../ui/registry'
import { askText, editBrush, importViaDialog, shareBrush, shareSet } from './actions'
import { FAVORITES_ID, RECENT_ID, isVirtualSet, library } from './library'
import { brushThumbnail } from './preview'
import { injectCss, cap } from './widgets'

const TW = 240
const TH = 44

interface MenuItem {
  label: I18nRef
  run(): void
  danger?: boolean
  sep?: boolean
}

/** Brush library popover: sets on the left, brushes with live stroke previews on the right. */
export function renderLibrary(toolId: ToolId) {
  return (body: HTMLElement, ctx: UIContext): (() => void) => {
    injectCss()
    const app = ctx.app
    const state = app.state
    const popEl = body.closest('.popover') as HTMLElement | null
    let selSet = localStorage.getItem('bw.lib.set') ?? RECENT_ID
    const selBrushId = (): string => state.toolSettings[toolId].presetId
    const containing = library.setsContaining(selBrushId())[0]
    if (!localStorage.getItem('bw.lib.set') && containing) selSet = containing.id
    let query = ''
    let menu: HTMLElement | null = null
    const off: (() => void)[] = []

    const search = h('input', { type: 'text', placeholder: tk('brushes.library.searchBrushes'), title: tk('brushes.library.search') })
    search.addEventListener('input', () => {
      query = search.value
      fillBrushes()
    })
    const closeMenu = (): void => {
      menu?.remove()
      menu = null
    }
    const showMenu = (x: number, y: number, items: MenuItem[]): void => {
      closeMenu()
      const m = h('div', { class: 'bl-menu' })
      for (const it of items) {
        if (it.sep) m.append(h('div', { class: 'sep' }))
        m.append(
          h('button', {
            class: it.danger ? 'danger' : '',
            text: it.label,
            onclick: () => {
              closeMenu()
              it.run()
            }
          })
        )
      }
      ;(popEl ?? document.body).append(m)
      m.style.left = Math.min(x, window.innerWidth - 190) + 'px'
      m.style.top = Math.min(y, window.innerHeight - 40 - items.length * 32) + 'px'
      menu = m
      const away = (e: PointerEvent): void => {
        if (!m.contains(e.target as Node)) {
          closeMenu()
          document.removeEventListener('pointerdown', away, true)
        }
      }
      document.addEventListener('pointerdown', away, true)
    }

    // ------------------------------------------------------------ toolbar
    const btn = (label: string | I18nRef, title: I18nRef, f: (e: MouseEvent) => void): HTMLElement =>
      h('button', typeof label === 'string' ? { class: 'bs-btn sm', icon: label.slice(1), title, onclick: f } : { class: 'bs-btn sm', text: label, title, onclick: f })
    const newBtn = btn('@plus', tk('brushes.library.newBrushOpensBrush'), () => {
      const target = isVirtualSet(selSet) ? library.sets[0].id : selSet
      const b = library.newBrush(target)
      ctx.popovers.close()
      editBrush(app, b, true)
    })
    const importBtn = btn(tk('core.common.import'), tk('brushes.library.importBrushBrushsetAbr'), () => void importViaDialog(app, isVirtualSet(selSet) ? undefined : selSet).then((id) => id && ((selSet = id), fillAll())))
    const top = h('div', { class: 'bl-top' }, search, newBtn, importBtn)

    // ------------------------------------------------------------ sets column
    const setsEl = h('div', { class: 'bl-sets' })
    const brushesEl = h('div', { class: 'bl-brushes' })
    const setOf = (id: string): string => (id === RECENT_ID ? t('brushes.library.recent') : id === FAVORITES_ID ? t('brushes.library.favorites') : library.set(id) ? setName(library.set(id)!) : '')

    const fillSets = (): void => {
      setsEl.replaceChildren()
      const add = (id: string, name: string, virtual: boolean): void => {
        const row = h('div', { class: 'bl-set' + (selSet === id ? ' sel' : ''), 'data-set': id }, h('span', { class: 'n', text: name }), h('span', { class: 'kbd', text: String(library.brushesOf(id).length) }))
        row.addEventListener('click', () => {
          if (dragSuppress) return
          if (selSet === id && !virtual) return void setMenu(row, id)
          selSet = id
          localStorage.setItem('bw.lib.set', id)
          query = ''
          search.value = ''
          fillAll()
        })
        row.addEventListener('contextmenu', (e) => (e.preventDefault(), setMenu(row, id)))
        if (!virtual) attachSetDrag(row, id)
        setsEl.append(row)
      }
      add(RECENT_ID, t('brushes.library.recent'), true)
      add(FAVORITES_ID, t('brushes.library.favorites'), true)
      for (const s of library.sets) add(s.id, setName(s), false)
      setsEl.append(
        h(
          'div',
          {
            class: 'bl-set',
            style: 'color:var(--accent);display:flex;align-items:center;gap:6px',
            icon: 'plus',
            iconSize: 14,
            onclick: async () => {
              const n = await askText(tk('brushes.library.newBrushSet'), t('brushes.library.myBrushes'), tk('core.common.create'))
              if (!n) return
              selSet = library.addSet(n).id
              fillAll()
            }
          },
          tk('brushes.library.newSet')
        )
      )
    }

    const setMenu = (anchor: HTMLElement, id: string): void => {
      const r = anchor.getBoundingClientRect()
      const s = library.set(id)!
      showMenu(r.right - 20, r.top + 10, [
        {
          label: tk('core.common.rename'),
          run: async () => {
            const n = await askText(tk('brushes.library.renameSet'), setName(s))
            if (n) library.renameSet(id, n)
          }
        },
        { label: tk('core.common.duplicate'), run: () => (selSet = library.duplicateSet(id)?.id ?? selSet) },
        { label: tk('brushes.library.shareExportBwbrushset'), run: () => void shareSet(app, id) },
        { label: tk('brushes.library.moveUp'), run: () => library.moveSet(id, library.sets.indexOf(s) - 1) },
        { label: tk('brushes.library.moveDown'), run: () => library.moveSet(id, library.sets.indexOf(s) + 1) },
        {
          label: tk('brushes.library.deleteSet'),
          danger: true,
          sep: true,
          run: () => {
            if (!confirm(t('brushes.library.deleteSet.confirm', { name: setName(s) }))) return
            library.deleteSet(id)
            selSet = library.sets[0]?.id ?? RECENT_ID
          }
        }
      ])
    }

    // ------------------------------------------------------------ brush rows
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          const cv = e.target as HTMLCanvasElement
          io.unobserve(cv)
          const b = (cv as unknown as { _brush?: BrushPreset })._brush
          if (!b) continue
          requestAnimationFrame(() => {
            const t = brushThumbnail(app, b, TW, TH)
            if (t) cv.getContext('2d')!.drawImage(t, 0, 0)
          })
        }
      },
      { root: brushesEl, rootMargin: '120px' }
    )
    off.push(() => io.disconnect())

    const select = (b: BrushPreset): void => {
      if (selBrushId() === b.id && state.tool === toolId) return editBrushFromPanel(b)
      state.setPreset(toolId, b.id)
      state.setTool(toolId)
      fillBrushes()
    }
    const editBrushFromPanel = (b: BrushPreset): void => {
      ctx.popovers.close()
      editBrush(app, b)
    }

    const brushMenu = (x: number, y: number, b: BrushPreset, setId: string): void => {
      const items: MenuItem[] = [
        { label: tk('brushes.library.editInBrushStudio'), run: () => editBrushFromPanel(b) },
        { label: library.isFavorite(b.id) ? tk('brushes.library.removeFromFavorites') : tk('brushes.library.addToFavorites'), run: () => library.toggleFavorite(b.id) },
        { label: tk('brushes.library.shareExportBwbrush'), run: () => void shareBrush(app, b) },
        { label: tk('core.common.duplicate'), run: () => library.duplicateBrush(b.id) }
      ]
      if (isDefaultBrush(b.id)) items.push({ label: tk('brushes.library.resetToOriginal'), run: () => library.resetBrush(b.id) })
      items.push({ label: tk('core.common.delete'), danger: true, sep: true, run: () => library.deleteBrush(b.id, setId) })
      showMenu(x, y, items)
    }

    let dragSuppress = false
    const rows: { el: HTMLElement; b: BrushPreset }[] = []

    const fillBrushes = (): void => {
      brushesEl.replaceChildren()
      rows.length = 0
      const list = query.trim() ? library.search(query) : library.brushesOf(selSet)
      if (!list.length) brushesEl.append(h('div', { class: 'empty', text: query ? tk('brushes.library.noBrushesMatch') : selSet === RECENT_ID ? tk('brushes.library.brushesYouPaintWith') : selSet === FAVORITES_ID ? tk('brushes.library.starABrushTo') : tk('brushes.library.thisSetIsEmpty') }))
      for (const b of list) {
        const cv = h('canvas', { width: TW, height: TH }) as HTMLCanvasElement
        ;(cv as unknown as { _brush: BrushPreset })._brush = b
        const star = h('button', { class: 'bl-star' + (library.isFavorite(b.id) ? ' on' : ''), icon: library.isFavorite(b.id) ? 'starfill' : 'star', iconSize: 16, title: tk('brushes.library.favorite') })
        star.addEventListener('click', (e) => (e.stopPropagation(), library.toggleFavorite(b.id)))
        star.addEventListener('pointerdown', (e) => e.stopPropagation())
        const row = h('div', { class: 'bl-row' + (selBrushId() === b.id ? ' sel' : ''), 'data-id': b.id }, h('div', { class: 'info' }, h('div', { class: 'nm', text: brushName(b), title: brushName(b) })), cv, star)
        const wrap = h('div', { class: 'bl-row-wrap' })
        const swipe = h(
          'div',
          { class: 'bl-swipe' },
          h('button', { style: 'background:#3b82f6', text: tk('brushes.library.share'), onclick: () => void shareBrush(app, b) }),
          h('button', { style: 'background:#6b7280', text: tk('core.common.duplicate'), onclick: () => library.duplicateBrush(b.id) }),
          h('button', { style: 'background:#dc2626', text: tk('core.common.delete'), onclick: () => library.deleteBrush(b.id, selSet) })
        )
        swipe.style.display = 'none'
        wrap.append(swipe, row)
        row.addEventListener('contextmenu', (e) => (e.preventDefault(), brushMenu(e.clientX, e.clientY, b, selSet)))
        attachRowGestures(row, swipe, b)
        brushesEl.append(wrap)
        rows.push({ el: row, b })
        io.observe(cv)
      }
    }

    // ------------------------------------------------------------ gestures: swipe-left actions + drag reorder
    let ghost: HTMLElement | null = null
    function attachRowGestures(row: HTMLElement, swipe: HTMLElement, b: BrushPreset): void {
      let sx = 0
      let sy = 0
      let mode: 'none' | 'swipe' | 'drag' = 'none'
      let down = false
      let openSwipe = false
      row.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return
        down = true
        mode = 'none'
        sx = e.clientX
        sy = e.clientY
        cap(row, e.pointerId)
      })
      row.addEventListener('pointermove', (e) => {
        if (!down) return
        const dx = e.clientX - sx
        const dy = e.clientY - sy
        if (mode === 'none') {
          if (Math.hypot(dx, dy) < 8) return
          if (Math.abs(dx) > Math.abs(dy) && (dx < 0 || openSwipe)) {
            mode = 'swipe'
            swipe.style.display = 'flex'
          } else if (!query) {
            mode = 'drag'
            ghost = h('div', { class: 'bl-ghost', text: brushName(b) })
            document.body.append(ghost)
          } else return
        }
        if (mode === 'swipe') {
          const w = swipe.offsetWidth || 190
          const t = Math.max(-w, Math.min(0, (openSwipe ? -w : 0) + dx))
          row.style.transition = 'none'
          row.style.transform = `translateX(${t}px)`
        } else if (mode === 'drag' && ghost) {
          ghost.style.left = e.clientX + 12 + 'px'
          ghost.style.top = e.clientY - 12 + 'px'
          markDrop(e.clientX, e.clientY)
        }
      })
      const finish = (e: PointerEvent): void => {
        if (!down) return
        down = false
        row.style.transition = ''
        if (mode === 'swipe') {
          const w = swipe.offsetWidth || 190
          const cur = Number(/-?\d+(\.\d+)?/.exec(row.style.transform)?.[0] ?? 0)
          openSwipe = cur < -w / 2
          row.style.transform = openSwipe ? `translateX(${-w}px)` : ''
          if (!openSwipe) setTimeout(() => (swipe.style.display = 'none'), 160)
          suppress()
        } else if (mode === 'drag') {
          ghost?.remove()
          ghost = null
          const drop = dropTarget(e.clientX, e.clientY)
          clearMarks()
          suppress()
          if (drop) applyDrop(b, drop)
        } else if (e.type === 'pointerup') {
          if (openSwipe) {
            openSwipe = false
            row.style.transform = ''
            setTimeout(() => (swipe.style.display = 'none'), 160)
          } else select(b)
        }
        mode = 'none'
      }
      row.addEventListener('pointerup', finish)
      row.addEventListener('pointercancel', finish)
    }

    const suppress = (): void => {
      dragSuppress = true
      setTimeout(() => (dragSuppress = false), 60)
    }

    interface Drop {
      kind: 'brush' | 'set'
      id: string
      after?: boolean
    }
    const dropTarget = (x: number, y: number): Drop | null => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null
      const row = el?.closest('.bl-row[data-id]') as HTMLElement | null
      if (row && brushesEl.contains(row)) {
        const r = row.getBoundingClientRect()
        return { kind: 'brush', id: row.dataset.id!, after: y > r.top + r.height / 2 }
      }
      const s = el?.closest('.bl-set[data-set]') as HTMLElement | null
      if (s && !isVirtualSet(s.dataset.set!)) return { kind: 'set', id: s.dataset.set! }
      return null
    }
    const clearMarks = (): void => {
      brushesEl.querySelectorAll('.drop-before,.drop-after').forEach((e) => e.classList.remove('drop-before', 'drop-after'))
      setsEl.querySelectorAll('.over').forEach((e) => e.classList.remove('over'))
    }
    const markDrop = (x: number, y: number): void => {
      clearMarks()
      const d = dropTarget(x, y)
      if (!d) return
      if (d.kind === 'brush') brushesEl.querySelector(`.bl-row[data-id="${CSS.escape(d.id)}"]`)?.classList.add(d.after ? 'drop-after' : 'drop-before')
      else setsEl.querySelector(`.bl-set[data-set="${CSS.escape(d.id)}"]`)?.classList.add('over')
    }
    const applyDrop = (b: BrushPreset, d: Drop): void => {
      if (isVirtualSet(selSet)) {
        // Recent / Favorites are not reorderable, but a brush can still be filed into a set
        if (d.kind === 'set') {
          const s = library.set(d.id)
          if (s && !s.brushIds.includes(b.id)) library.addBrush(b, d.id)
        }
        return
      }
      if (d.kind === 'set') return library.moveBrush(b.id, selSet, d.id, library.set(d.id)?.brushIds.length ?? 0)
      const to = library.set(selSet)!
      let idx = to.brushIds.indexOf(d.id)
      if (idx < 0) return
      if (d.after) idx++
      library.moveBrush(b.id, selSet, selSet, idx)
    }

    function attachSetDrag(row: HTMLElement, id: string): void {
      let down = false
      let moved = false
      let sy = 0
      row.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return
        down = true
        moved = false
        sy = e.clientY
        cap(row, e.pointerId)
      })
      row.addEventListener('pointermove', (e) => {
        if (!down) return
        if (!moved && Math.abs(e.clientY - sy) < 8) return
        moved = true
        if (!ghost) {
          ghost = h('div', { class: 'bl-ghost', text: setOf(id) })
          document.body.append(ghost)
        }
        ghost.style.left = e.clientX + 12 + 'px'
        ghost.style.top = e.clientY - 12 + 'px'
        clearMarks()
        const t = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest('.bl-set[data-set]') as HTMLElement | null
        if (t && !isVirtualSet(t.dataset.set!)) t.classList.add('over')
      })
      const up = (e: PointerEvent): void => {
        if (!down) return
        down = false
        if (!moved) return
        ghost?.remove()
        ghost = null
        clearMarks()
        suppress()
        const t = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest('.bl-set[data-set]') as HTMLElement | null
        if (t && !isVirtualSet(t.dataset.set!) && t.dataset.set !== id) library.moveSet(id, library.sets.findIndex((s) => s.id === t.dataset.set))
      }
      row.addEventListener('pointerup', up)
      row.addEventListener('pointercancel', up)
    }

    // ------------------------------------------------------------ footer
    const link = h('input', { type: 'checkbox' })
    link.checked = state.linkBrushTools
    link.addEventListener('change', () => {
      state.linkBrushTools = link.checked
      localStorage.setItem('bw.linkBrushTools', link.checked ? '1' : '0')
      state.events.emit('toolSettings', undefined)
    })
    const foot = h(
      'div',
      { class: 'bl-foot' },
      h('label', { class: 'chk', style: 'margin:0;flex:1', title: tk('brushes.library.smudgeAndEraseUse') }, link, tk('brushes.library.linkSmudgeEraseTo')),
      h('button', {
        class: 'bs-btn sm',
        text: tk('brushes.library.resetDefaultBrushes'),
        onclick: () => {
          if (confirm(t('brushes.library.resetDefaults.confirm'))) library.resetDefaults()
        }
      })
    )

    const fillAll = (): void => {
      if (!isVirtualSet(selSet) && !library.set(selSet)) selSet = RECENT_ID
      fillSets()
      fillBrushes()
    }
    body.append(h('div', { class: 'bl-panel' }, top, h('div', { class: 'bl-cols' }, setsEl, brushesEl), foot))
    fillAll()
    const scrollSel = (): void => rows.find((r) => r.b.id === selBrushId())?.el.scrollIntoView({ block: 'nearest' })
    setTimeout(scrollSel, 0)

    off.push(library.events.on('change', fillAll))
    off.push(
      library.events.on('recent', () => {
        if (selSet === RECENT_ID) fillAll()
      })
    )
    off.push(state.events.on('toolSettings', () => rows.forEach((r) => r.el.classList.toggle('sel', selBrushId() === r.b.id))))
    return () => {
      closeMenu()
      ghost?.remove()
      off.forEach((f) => f())
    }
  }
}
