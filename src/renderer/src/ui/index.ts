import type { App } from '../app/app'
import { hsvToRgb, rgbToHex, ToolId } from '../app/state'
import { applyFilter, filterName, listFilters } from '../gl/filters'
import { prefs } from '../input/prefs'
import { installShortcuts, shortcutMap } from '../input/shortcuts'
import { exportJpg, exportPng, openDocument, saveDocument } from '../io/exporters'
import { renderBrushPanel } from './brushPanel'
import { renderColorPanel } from './colorPanel'
import { h, icon } from './dom'
import { showNewDocumentDialog } from './newDocDialog'
import { renderLayerPanel } from './layerPanel'
import { PopoverHost } from './popover'
import { MenuId, MenuItem, UIContext, isTopTabActive, menuEvents, menuItemParts, menus, panels, registerMenuItem, registerPanel, topTabEvents, topTabs } from './registry'
import { buildSidebar } from './sidebar'
import { t, tk } from '../i18n'

const MENU_IDS: MenuId[] = ['gallery', 'actions', 'adjustments', 'selection', 'transform']

/** Build the whole UI chrome around the canvas. Returns the UI context for extensions. */
export function buildUI(app: App, root: HTMLElement): UIContext {
  const popovers = new PopoverHost(document.body)
  const toastEl = h('div', { class: 'toast' })
  document.body.append(toastEl)
  let toastTimer = 0
  const toast = (msg: string): void => {
    toastEl.textContent = msg
    toastEl.classList.add('show')
    clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 2200)
  }
  app.events.on('toast', toast)

  const guard = (done: string, failed: string, fn: () => Promise<unknown>): Promise<void> =>
    fn().then(
      (r) => {
        if (r) toast(t(done))
      },
      (e) => {
        console.error(e)
        toast(t(failed, { error: (e as Error).message }))
      }
    )

  const ctx: UIContext = {
    app,
    popovers,
    toast,
    showNewDocumentDialog: () => showNewDocumentDialog(app, document.body),
    saveDocument: () => guard('ui.toast.saved', 'ui.toast.saveFailed', () => saveDocument(app.doc, app.compositor)),
    openDocument: () =>
      guard('ui.toast.opened', 'ui.toast.openFailed', async () => {
        const d = await openDocument(app.gpu)
        if (d) app.setDocument(d)
        return d
      })
  }

  registerDefaultMenus(ctx)
  registerPanel({ id: 'color', title: tk('ui.panel.color'), width: 268, render: renderColorPanel })
  registerPanel({ id: 'layers', title: tk('ui.panel.layers'), width: 300, render: renderLayerPanel })
  for (const tool of ['brush', 'smudge', 'eraser'] as ToolId[]) {
    registerPanel({ id: 'lib-' + tool, title: tk('ui.panel.lib.' + tool), width: 300, render: renderBrushPanel(tool) })
  }

  const openPanel = (id: string, anchor: HTMLElement, align: 'left' | 'right' = 'right'): void => {
    const p = panels.get(id)
    if (!p) return
    popovers.toggle(id, anchor, (body) => p.render(body, ctx), { align, width: p.width, title: p.title })
  }

  // ---- top bar
  const left = h('div', { class: 'tb-left' })
  for (const id of MENU_IDS) {
    const b = h('button', { class: 'tb-btn', text: tk('ui.menu.' + id) })
    b.addEventListener('click', () =>
      popovers.toggle(
        'menu-' + id,
        b,
        (body, close) => {
          const items: MenuItem[] = [...menus[id]]
          if (id === 'adjustments') {
            for (const f of listFilters()) if (!items.some((i) => i.id === 'filter:' + f.id)) items.push({ id: 'filter:' + f.id, label: () => filterName(f), run: () => void applyFilter(app.doc, f.id) })
          }
          // Actions is long: gather 'Group: item' entries under one small heading each
          const groupOf = (it: MenuItem): string => (id === 'actions' ? menuItemParts(it).group : '')
          if (id === 'actions') {
            const out: MenuItem[] = []
            items.forEach((it, i) => {
              const g = groupOf(it)
              if (!g) out.push(it)
              else if (items.findIndex((x) => groupOf(x) === g) === i) out.push(...items.filter((x) => groupOf(x) === g))
            })
            items.splice(0, items.length, ...out)
          }
          let lastGroup = ''
          for (const it of items) {
            const g = groupOf(it)
            if (g !== lastGroup) {
              body.append(g ? h('div', { class: 'menu-group', text: tk('ui.menu.group.' + g) }) : h('div', { class: 'sep' }))
              lastGroup = g
            } else if (it.separator && !g) body.append(h('div', { class: 'sep' }))
            body.append(
              h(
                'button',
                {
                  class: 'menu-item',
                  disabled: !!it.disabled || !it.run,
                  onclick: () => {
                    close()
                    menuEvents.emit('run', { menu: id, id: it.id })
                    void it.run?.(ctx)
                  }
                },
                h('span', { text: menuItemParts(it).text }),
                (sc(it) ? h('span', { class: 'kbd', text: sc(it) }) : null)
              )
            )
          }
          if (!items.length) body.append(h('div', { class: 'empty', text: tk('ui.menu.empty') }))
        },
        { align: 'left', width: 230 }
      )
    )
    left.append(b)
  }

  // tabs registered by feature modules (Time-lapse): they follow the menus in the left group
  const tabEls = new Map<string, HTMLElement>()
  const syncTabs = (): void => {
    for (const def of topTabs) {
      let b = tabEls.get(def.id)
      if (!b) {
        b = h('button', { class: 'tb-btn tb-tab', text: def.label })
        b.addEventListener('click', () => {
          popovers.close()
          def.run(ctx)
        })
        tabEls.set(def.id, b)
        left.append(b)
      }
      b.classList.toggle('active', isTopTabActive(def.id))
    }
  }
  topTabEvents.on('change', syncTabs)
  syncTabs()

  const toolBtns = new Map<ToolId, HTMLElement>()
  const right = h('div', { class: 'tb-right' })
  for (const [t, ic, label] of [['brush', 'brush', tk('ui.tool.brush')], ['smudge', 'smudge', tk('ui.tool.smudge')], ['eraser', 'eraser', tk('ui.tool.eraser')]] as [ToolId, string, ReturnType<typeof tk>][]) {
    const b = h('button', { class: 'tb-icon', title: label }, icon(ic, 22))
    // press-and-hold Smudge / Eraser = use it temporarily, release = back to the previous tool
    let quick: { back: ToolId } | null = null
    let quickTimer = 0
    let swallowClick = false
    if (t !== 'brush') {
      b.addEventListener('pointerdown', () => {
        const ms = prefs.v.quickToolSwitchMs
        if (!ms || app.state.tool === t) return
        quickTimer = window.setTimeout(() => {
          quick = { back: app.state.tool }
          app.state.setTool(t)
        }, ms)
      })
      const release = (up: boolean): void => {
        clearTimeout(quickTimer)
        if (!quick) return
        const back = quick.back
        quick = null
        swallowClick = up // the click that follows a release must not open the brush library
        app.state.setTool(back)
      }
      b.addEventListener('pointerup', () => release(true))
      b.addEventListener('pointerleave', () => release(false))
      b.addEventListener('pointercancel', () => release(false))
    }
    b.addEventListener('click', () => {
      if (swallowClick) return void (swallowClick = false)
      if (app.state.tool === t) openPanel('lib-' + t, b)
      else {
        popovers.close()
        app.state.setTool(t)
      }
    })
    toolBtns.set(t, b)
    right.append(b)
  }
  const layersBtn = h('button', { class: 'tb-icon tb-layers', title: tk('ui.panel.layers') }, icon('layers', 22))
  layersBtn.addEventListener('click', () => openPanel('layers', layersBtn))
  const colorBtn = h('button', { class: 'tb-color', title: tk('ui.panel.colour') })
  colorBtn.addEventListener('click', () => openPanel('color', colorBtn))
  right.append(layersBtn, colorBtn)

  const topbar = h('div', { class: 'topbar' }, left, h('div', { class: 'tb-title', text: 'WinCreative' }), right) // i18n-ignore
  const sidebar = buildSidebar(app)
  root.append(topbar, sidebar)

  const syncTools = (): void => {
    for (const [t, b] of toolBtns) b.classList.toggle('sel', app.state.effectiveTool === t)
  }
  const syncColor = (): void => void (colorBtn.style.background = rgbToHex(hsvToRgb(app.state.color)))
  app.state.events.on('tool', syncTools)
  app.state.events.on('color', syncColor)
  syncTools()
  syncColor()

  const title = topbar.querySelector('.tb-title')!
  const syncTitle = (): void => void (title.textContent = `${app.doc.name} - ${app.doc.width} x ${app.doc.height}`)
  app.events.on('doc', syncTitle)
  syncTitle()

  installShortcuts(app, {
    save: () => void ctx.saveDocument(),
    open: () => void ctx.openDocument(),
    newDoc: () => ctx.showNewDocumentDialog()
  })
  return ctx
}

/** Shortcut label of a menu item: the live binding of its action when it has one, else the static hint. */
const sc = (it: MenuItem): string => (it.action ? (shortcutMap.keysFor(it.action)[0] ?? '') : (it.shortcut ?? ''))

function registerDefaultMenus(ctx: UIContext): void {
  const app = ctx.app
  const stub = (menu: MenuId, id: string, key: string): void => registerMenuItem(menu, { id, label: tk('ui.stub.' + key), disabled: true })
  const exported = (r: unknown): void => void (r && ctx.toast(t('ui.toast.exported')))
  registerMenuItem('gallery', { id: 'new', label: tk('ui.menu.new'), shortcut: 'Ctrl+N', action: 'file.new', run: (c) => c.showNewDocumentDialog() })
  registerMenuItem('gallery', { id: 'open', label: tk('ui.menu.open'), shortcut: 'Ctrl+O', action: 'file.open', run: (c) => c.openDocument() })
  registerMenuItem('gallery', { id: 'save', label: tk('ui.menu.save'), shortcut: 'Ctrl+S', action: 'file.save', run: (c) => c.saveDocument() })
  registerMenuItem('actions', { id: 'export-png', label: tk('ui.menu.exportPng'), run: () => void exportPng(app.doc, app.compositor, true).then(exported, (e) => ctx.toast(String(e))) })
  registerMenuItem('actions', { id: 'export-png-bg', label: tk('ui.menu.exportPngBg'), run: () => void exportPng(app.doc, app.compositor, false).then(exported, (e) => ctx.toast(String(e))) })
  registerMenuItem('actions', { id: 'export-jpg', label: tk('ui.menu.exportJpg'), run: () => void exportJpg(app.doc, app.compositor).then(exported, (e) => ctx.toast(String(e))) })
  registerMenuItem('actions', { id: 'fit', label: tk('ui.menu.fit'), shortcut: '0', separator: true, run: () => app.fit() })
  registerMenuItem('actions', { id: 'reset-rot', label: tk('ui.menu.resetRotation'), run: () => app.setView({ ...app.view, rot: 0 }) })
  stub('selection', 'sel-rect', 'rectangle')
  stub('selection', 'sel-free', 'freehand')
  stub('selection', 'sel-wand', 'automatic')
  stub('transform', 'tf-free', 'freeform')
  stub('transform', 'tf-flip-h', 'flipH')
  stub('transform', 'tf-flip-v', 'flipV')
}
