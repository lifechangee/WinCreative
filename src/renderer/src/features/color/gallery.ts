import { strFromU8, unzipSync } from 'fflate'
import type { App } from '../../app/app'
import { Document } from '../../doc/document'
import { importPsdBytes } from '../../io/docPsd'
import { exportJpg, exportPng } from '../../io/exporters'
import { h, icon } from '../../ui/dom'
import { bitmapToDocument } from '../../io/docPsd'
import { decodeBitmap } from '../../io/imageFormats'
import { importProcreate } from '../../io/procreate'
import { tagFromFile } from '../profiles/convert'
import { findResourceImporter, resourceExtensions } from './resourceImport'
import { registerAction } from '../../input/actions'
import { registerMenuItem, menus } from '../../ui/registry'
import type { UIContext } from '../../ui/registry'
import { showNewDocumentDialog } from '../../ui/newDocDialog'
import { confirmDialog, askText, contextMenu } from './dialogs'
import { galleryRef } from './galleryRef'
import { GalleryItem, GalleryStack, GalleryStore, registerGalleryImporter } from './galleryStore'
import { injectCss } from './styles'
import { onLangChange, t, tk } from '../../i18n'

export { registerGalleryImporter } from './galleryStore'
export { GalleryStore } from './galleryStore'

const CSS = `
.bw-gallery { position: fixed; left: 0; right: 0; bottom: 0; top: var(--topbar-h); background: var(--bg); z-index: 50; display: none; flex-direction: column; }
.bw-gallery.open { display: flex; }
.bw-g-bar { display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
.bw-g-title { font-size: 20px; font-weight: 600; margin-right: 10px; }
.bw-g-title .crumb { cursor: pointer; color: var(--dim); }
.bw-g-bar .sp { flex: 1; }
.bw-g-bar input[type=search], .bw-g-bar select { background: var(--panel2); color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 6px 8px; }
.bw-g-btn { background: var(--panel2); border: 1px solid var(--line); border-radius: 8px; padding: 6px 12px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.bw-g-btn:hover:not([disabled]) { border-color: var(--accent); }
.bw-g-btn[disabled] { opacity: .4; cursor: default; }
.bw-g-btn.on { background: var(--accent); border-color: var(--accent); color: #fff; }
.bw-g-btn.danger { color: #ff6b62; }
.bw-g-btn.plus { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
.bw-g-grid { flex: 1; overflow: auto; padding: 18px 16px 40px; display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 18px; align-content: start; grid-auto-rows: max-content; }
.bw-g-empty { grid-column: 1 / -1; text-align: center; color: var(--dim); padding: 60px 0; }
.bw-card { position: relative; background: var(--panel); border: 2px solid transparent; border-radius: 12px; padding: 8px; cursor: pointer; overflow: hidden; }
.bw-card:hover { background: var(--panel2); }
.bw-card.sel { border-color: var(--accent); }
.bw-card.drop-stack { border-color: #f7c531; }
.bw-card.drop-before { box-shadow: -6px 0 0 var(--accent); }
.bw-card.drop-after { box-shadow: 6px 0 0 var(--accent); }
.bw-card.current { outline: 1px solid var(--accent); }
.bw-thumb { height: 150px; display: grid; place-items: center; border-radius: 8px; overflow: hidden; background: repeating-conic-gradient(#3a3a3e 0 25%, #333337 0 50%) 0 0 / 16px 16px; }
.bw-thumb img { max-width: 100%; max-height: 100%; display: block; }
.bw-stack-thumb { position: relative; }
.bw-stack-thumb .bw-thumb { position: absolute; width: 78%; height: 78%; }
.bw-card .name { margin-top: 8px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bw-card .meta { color: var(--dim); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bw-card .acts { position: absolute; top: 12px; right: 12px; display: none; gap: 4px; }
.bw-card:hover .acts, .bw-card.swiped .acts { display: flex; }
.bw-card .acts button { width: 28px; height: 28px; border-radius: 50%; border: 0; background: #000b; color: #fff; cursor: pointer; font-size: 13px; padding: 0; display: grid; place-items: center; }
.bw-card .acts button:hover { background: var(--accent); }
.bw-card .chk-mark { position: absolute; top: 12px; left: 12px; width: 22px; height: 22px; border-radius: 50%; border: 2px solid #fff; background: #0008; display: none; place-items: center; font-size: 13px; color: #fff; }
.bw-gallery.select .chk-mark { display: grid; }
.bw-card.sel .chk-mark { background: var(--accent); }
.bw-name-edit { width: 100%; margin-top: 6px; background: var(--panel2); color: var(--text); border: 1px solid var(--accent); border-radius: 6px; padding: 3px 6px; }
.bw-preview { width: min(760px, 92vw); max-height: 90vh; overflow: auto; }
.bw-preview .big { text-align: center; background: repeating-conic-gradient(#3a3a3e 0 25%, #333337 0 50%) 0 0 / 16px 16px; border-radius: 8px; }
.bw-preview .big img { max-width: 100%; max-height: 46vh; }
.bw-layers { display: flex; gap: 8px; overflow-x: auto; padding: 8px 0; }
.bw-layers figure { margin: 0; text-align: center; flex: none; width: 84px; font-size: 11px; color: var(--dim); }
.bw-layers img { width: 84px; height: 64px; object-fit: contain; background: repeating-conic-gradient(#3a3a3e 0 25%, #333337 0 50%) 0 0 / 10px 10px; border-radius: 6px; }
.bw-info { display: grid; grid-template-columns: auto 1fr; gap: 4px 14px; margin: 10px 0; color: var(--dim); }
.bw-info b { color: var(--text); font-weight: 500; }
.bw-newdoc { width: 520px; }
.bw-newdoc .presets { grid-template-columns: 1fr 1fr; max-height: 150px; overflow: auto; }
.bw-newdoc .row input[type=number], .bw-newdoc .row select { flex: 1; min-width: 0; background: var(--panel2); color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 5px; }
`

type SortMode = 'manual' | 'newest' | 'oldest' | 'name'
type Entry = { kind: 'item'; item: GalleryItem } | { kind: 'stack'; stack: GalleryStack }
const idOf = (e: Entry): string => (e.kind === 'item' ? e.item.id : e.stack.id)

export function installGallery(app: App, ui: UIContext): void {
  injectCss('bw-gallery-styles', CSS)
  const store = new GalleryStore(app)
  registerGalleryImporter({ exts: ['psd'], run: async (bytes, name, gpu) => importPsdBytes(gpu, bytes, name.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')) })
  // .procreate, TIFF and tagged PNG / JPEG (picks up an embedded ICC profile) also open from the Gallery
  const baseName = (n: string): string => n.replace(/^.*[\/]/, '').replace(/\.[^.]+$/, '')
  registerGalleryImporter({ exts: ['procreate'], run: async (bytes, name, gpu) => importProcreate(gpu, bytes, baseName(name)) })
  registerGalleryImporter({
    exts: ['tif', 'tiff', 'png', 'jpg', 'jpeg'],
    run: async (bytes, name, gpu) => {
      const bmp = await decodeBitmap(bytes)
      if (bmp.width > gpu.maxTexture || bmp.height > gpu.maxTexture) throw new Error(`Image exceeds the ${gpu.maxTexture}px canvas limit`)
      const d = bitmapToDocument(gpu, bmp, baseName(name))
      tagFromFile(d, bytes)
      return d
    }
  })
  galleryRef.store = store

  // ------------------------------------------------------------------ view state
  let mode: 'grid' | 'bin' = 'grid'
  let openStack: string | null = null
  let selecting = false
  const selected = new Set<string>()
  let query = ''
  let sort: SortMode = (localStorage.getItem('bw.gallery.sort') as SortMode) || 'manual'
  let dragId: string | null = null

  const root = h('div', { class: 'bw-gallery' })
  document.body.append(root)

  const isOpen = (): boolean => root.classList.contains('open')
  const show = (): void => {
    root.classList.add('open')
    void store.flush().then(() => render())
    render()
  }
  const hide = (): void => {
    root.classList.remove('open')
    ui.popovers.close()
  }
  onLangChange(() => {
    if (isOpen()) render()
  })
  galleryRef.show = show
  galleryRef.hide = hide

  const guard = async (kind: 'open' | 'share' | 'duplicate' | 'import' | 'reopen', fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn()
    } catch (e) {
      console.error(e)
      ui.toast(t(`gallery.error.${kind}Failed`) + (e as Error).message)
    }
  }

  // ------------------------------------------------------------------ data helpers
  const rootEntries = (): Entry[] => {
    const q = query.trim().toLowerCase()
    const match = (n: string): boolean => !q || n.toLowerCase().includes(q)
    const out: Entry[] = []
    for (const s of store.stacks) {
      const inner = store.stackItems(s.id)
      if (!inner.length) continue
      if (match(s.name) || inner.some((i) => match(i.name))) out.push({ kind: 'stack', stack: s })
    }
    for (const i of store.live()) if (!i.stackId && match(i.name)) out.push({ kind: 'item', item: i })
    const order = (e: Entry): number => (e.kind === 'item' ? e.item.order : e.stack.order)
    const mod = (e: Entry): number => (e.kind === 'item' ? e.item.modified : Math.max(0, ...store.stackItems(e.stack.id).map((i) => i.modified)))
    const nm = (e: Entry): string => (e.kind === 'item' ? e.item.name : e.stack.name).toLowerCase()
    out.sort((a, b) => (sort === 'manual' ? order(b) - order(a) : sort === 'newest' ? mod(b) - mod(a) : sort === 'oldest' ? mod(a) - mod(b) : nm(a).localeCompare(nm(b))))
    return out
  }

  // ------------------------------------------------------------------ actions
  const openItem = (id: string): void =>
    void guard('open', async () => {
      if (await store.open(id)) hide()
    })

  const rename = async (e: Entry): Promise<void> => {
    const cur = e.kind === 'item' ? e.item.name : e.stack.name
    const n = await askText(t('gallery.dialog.rename'), cur, t('gallery.dialog.rename'))
    if (!n) return
    if (e.kind === 'item') store.rename(e.item.id, n)
    else store.renameStack(e.stack.id, n)
  }

  const trashItems = async (ids: string[]): Promise<void> => {
    const items = ids.map((i) => store.get(i)).filter((i): i is GalleryItem => !!i)
    if (!items.length) return
    const msg = items.length === 1 ? t('gallery.trash.confirmOne', { name: items[0].name }) : t('gallery.trash.confirmMany', { count: items.length })
    if (!(await confirmDialog(t('gallery.dialog.delete'), msg, t('core.common.delete')))) return
    for (const i of items) store.trash(i.id)
    store.pruneStacks()
    selected.clear()
  }

  const duplicateItems = async (ids: string[]): Promise<void> => {
    for (const id of ids) await store.duplicate(id)
    ui.toast(t('gallery.toast.duplicated'))
  }

  const shareItem = async (id: string): Promise<void> => {
    const it = store.get(id)
    if (!it) return
    const fmt = await pickFormat(it.name)
    if (!fmt) return
    const api = window.bwGallery!
    const current = store.idOf(app.doc) === id
    if (current) await store.flush()
    if (fmt === 'bwk') {
      const bytes = await api.read(id + '.bwk')
      if (!bytes) throw new Error('File missing')
      const p = await window.brushwork!.saveFile({ defaultName: it.name + '.bwk', filters: [{ name: t('gallery.filter.doc'), extensions: ['bwk'] }], data: bytes })
      if (p) ui.toast(t('gallery.toast.saved'))
      return
    }
    if (current) {
      const r = fmt === 'png' ? await exportPng(app.doc, app.compositor, true) : await exportJpg(app.doc, app.compositor)
      if (r) ui.toast(t('gallery.toast.exported'))
      return
    }
    const bytes = await api.read(id + '.bwk')
    if (!bytes) throw new Error('File missing')
    const { loadBwk } = await import('../../io/bwk')
    const doc = await loadBwk(bytes, app.gpu)
    try {
      const r = await GalleryStore.withCompositor(app.gpu, doc, async (c) => (fmt === 'png' ? exportPng(doc, c, true) : exportJpg(doc, c)))
      if (r) ui.toast(t('gallery.toast.exported'))
    } finally {
      doc.dispose()
    }
  }

  const stackSelected = (): void => {
    const ids = [...selected].filter((i) => store.get(i))
    if (ids.length < 1) return
    store.createStack(ids, t('gallery.stack.default'))
    selected.clear()
    selecting = false
  }

  const pickFormat = (name: string): Promise<'bwk' | 'png' | 'jpg' | null> =>
    new Promise((resolve) => {
      const done = (v: 'bwk' | 'png' | 'jpg' | null): void => {
        back.remove()
        resolve(v)
      }
      const b = (label: string, v: 'bwk' | 'png' | 'jpg'): HTMLElement => h('button', { class: 'bw-g-btn', text: label, onclick: () => done(v) })
      const back = h(
        'div',
        { class: 'modal-back' },
        h('div', { class: 'modal bw-small-modal' }, h('h3', { text: t('gallery.share.format', { name }) }), h('div', { class: 'row' }, b(t('gallery.share.bwk'), 'bwk'), b(t('gallery.share.png'), 'png'), b(t('gallery.share.jpg'), 'jpg')), h('div', { class: 'row end' }, h('button', { text: t('gallery.dialog.cancel'), onclick: () => done(null) })))
      )
      back.addEventListener('pointerdown', (e) => e.target === back && done(null))
      document.body.append(back)
    })

  const preview = async (id: string): Promise<void> => {
    const it = store.get(id)
    if (!it) return
    const big = h('div', { class: 'big' })
    const layersBox = h('div', { class: 'bw-layers' })
    const thumb = await store.thumbUrl(id)
    if (thumb) big.append(h('img', { src: thumb }))
    const info = h(
      'div',
      { class: 'bw-info' },
      ...[
        [t('gallery.info.size'), (it.infinite ? t('gallery.card.infinitePrefix') : '') + `${it.width} × ${it.height} px`],
        [t('gallery.info.layers'), String(it.layers)],
        [t('gallery.info.profile'), it.profile],
        ['DPI', String(it.dpi)],
        [t('gallery.info.created'), new Date(it.created).toLocaleString()],
        [t('gallery.info.modified'), new Date(it.modified).toLocaleString()]
      ].flatMap(([k, v]) => [h('span', { text: k }), h('b', { text: v })])
    )
    let closed = false
    const close = (): void => {
      closed = true
      urls.forEach((u) => URL.revokeObjectURL(u))
      back.remove()
    }
    const urls: string[] = []
    const back = h(
      'div',
      { class: 'modal-back' },
      h('div', { class: 'modal bw-preview' }, h('h3', { text: it.name }), big, info, layersBox, h('div', { class: 'row end' }, h('button', { text: t('gallery.dialog.close'), onclick: close }), h('button', { class: 'primary', text: t('gallery.dialog.open'), onclick: () => (close(), openItem(id)) })))
    )
    back.addEventListener('pointerdown', (e) => e.target === back && close())
    document.body.append(back)
    void (async () => {
      try {
        if (store.idOf(app.doc) === id) await store.flush()
        const bytes = await window.bwGallery!.read(id + '.bwk')
        if (!bytes) return
        const z = unzipSync(bytes)
        const m = JSON.parse(strFromU8(z['manifest.json']))
        for (const l of [...m.layers].reverse()) {
          const png = z[l.file]
          if (!png || closed) continue
          const u = URL.createObjectURL(new Blob([png as unknown as BlobPart], { type: 'image/png' }))
          urls.push(u)
          layersBox.append(h('figure', {}, h('img', { src: u }), h('div', { text: l.name })))
        }
      } catch (e) {
        console.error(e)
      }
    })()
  }

  const doImport = (): void =>
    void guard('import', async () => {
      const r = await window.brushwork!.openFile({
        filters: [
          { name: t('gallery.filter.everything'), extensions: ['bwk', 'procreate', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'psd', ...resourceExtensions()] },
          { name: t('gallery.filter.images'), extensions: ['bwk', 'procreate', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'psd'] },
          { name: t('gallery.filter.resources'), extensions: resourceExtensions() },
          { name: t('gallery.filter.all'), extensions: ['*'] }
        ]
      })
      if (!r) return
      const res = findResourceImporter(r.path)
      if (res) {
        ui.toast(await res.run(r.data, r.path))
        return
      }
      await store.importFile(r.data, r.path)
      ui.toast(t('gallery.toast.imported'))
      hide()
    })

  // ------------------------------------------------------------------ rendering
  function card(e: Entry, all: string[]): HTMLElement {
    const id = idOf(e)
    const isStack = e.kind === 'stack'
    const name = e.kind === 'item' ? e.item.name : e.stack.name
    const thumbBox = h('div', { class: isStack ? 'bw-thumb bw-stack-thumb' : 'bw-thumb' })
    if (e.kind === 'item') {
      void store.thumbUrl(id).then((u) => u && thumbBox.replaceChildren(h('img', { src: u, draggable: false })))
    } else {
      thumbBox.style.background = 'none'
      const inner = store.stackItems(e.stack.id).slice(0, 3)
      inner.forEach((it, i) => {
        const t = h('div', { class: 'bw-thumb' })
        t.style.left = i * 10 + '%'
        t.style.top = (2 - i) * 8 + '%'
        t.style.zIndex = String(3 - i)
        void store.thumbUrl(it.id).then((u) => u && t.replaceChildren(h('img', { src: u, draggable: false })))
        thumbBox.append(t)
      })
    }
    const meta = e.kind === 'item' ? (e.item.infinite ? t('gallery.card.infinitePrefix') : '') + t('gallery.card.metaItem', { w: e.item.width, h: e.item.height, count: e.item.layers }) : t('gallery.card.metaStack', { count: store.stackItems(e.stack.id).length })
    const nameEl = h('div', { class: 'name', text: name, title: t('gallery.card.clickToRename') })
    nameEl.addEventListener('click', (ev) => {
      ev.stopPropagation()
      const input = h('input', { class: 'bw-name-edit', type: 'text', value: name })
      const commit = (ok: boolean): void => {
        if (ok && input.value.trim()) {
          if (e.kind === 'item') store.rename(e.item.id, input.value)
          else store.renameStack(e.stack.id, input.value)
        } else render()
      }
      input.addEventListener('keydown', (k) => {
        k.stopPropagation()
        if (k.key === 'Enter') commit(true)
        else if (k.key === 'Escape') commit(false)
      })
      input.addEventListener('blur', () => commit(true))
      input.addEventListener('click', (c) => c.stopPropagation())
      nameEl.replaceWith(input)
      input.focus()
      input.select()
    })
    const btn = (label: string, title: string, fn: () => void): HTMLElement =>
      h('button', {
        icon: label,
        title,
        onclick: (ev: Event) => {
          ev.stopPropagation()
          fn()
        }
      })
    const acts = h(
      'div',
      { class: 'acts' },
      e.kind === 'item' ? btn('info', t('gallery.card.preview'), () => void preview(id)) : null,
      e.kind === 'item' ? btn('share', t('gallery.card.share'), () => void guard('share', () => shareItem(id))) : null,
      e.kind === 'item' ? btn('copy', t('gallery.card.duplicate'), () => void guard('duplicate', () => duplicateItems([id]))) : btn('ungroup', t('gallery.card.ungroup'), () => store.ungroup(id)),
      e.kind === 'item' ? btn('clear', t('gallery.card.delete'), () => void trashItems([id])) : null,
      e.kind === 'item' && e.item.stackId ? btn('up', t('gallery.card.removeFromStack'), () => store.removeFromStack(id)) : null
    )
    const el = h('div', { class: 'bw-card' + (selected.has(id) ? ' sel' : '') + (e.kind === 'item' && store.idOf(app.doc) === id ? ' current' : ''), draggable: !selecting }, h('div', { class: 'chk-mark' }, selected.has(id) ? icon('check', 14) : null), thumbBox, nameEl, h('div', { class: 'meta', text: meta }), acts)
    el.addEventListener('click', () => {
      if (el.classList.contains('swiped')) return el.classList.remove('swiped')
      if (selecting) {
        if (selected.has(id)) selected.delete(id)
        else selected.add(id)
        return render()
      }
      if (e.kind === 'stack') {
        openStack = id
        return render()
      }
      openItem(id)
    })
    el.addEventListener('contextmenu', (ev) => {
      ev.preventDefault()
      contextMenu(ev.clientX, ev.clientY, [
        { label: t('gallery.menu.open'), run: () => (e.kind === 'stack' ? ((openStack = id), render()) : openItem(id)) },
        { label: t('gallery.menu.rename'), run: () => void rename(e) },
        ...(e.kind === 'item'
          ? [
              { label: t('gallery.menu.preview'), run: () => void preview(id) },
              { label: t('gallery.menu.share'), run: () => void guard('share', () => shareItem(id)) },
              { label: t('gallery.menu.duplicate'), run: () => void guard('duplicate', () => duplicateItems([id])) },
              ...(e.item.stackId ? [{ label: t('gallery.menu.removeFromStack'), run: () => store.removeFromStack(id) }] : []),
              { label: t('gallery.menu.delete'), danger: true, run: () => void trashItems([id]) }
            ]
          : [{ label: t('gallery.menu.ungroup'), run: () => store.ungroup(id) }])
      ])
    })
    // swipe left (touch / pen) reveals the quick actions
    let sx = 0
    let sy = 0
    let sid = -1
    el.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType === 'mouse') return
      sx = ev.clientX
      sy = ev.clientY
      sid = ev.pointerId
    })
    el.addEventListener('pointermove', (ev) => {
      if (ev.pointerId !== sid) return
      if (ev.clientX - sx < -40 && Math.abs(ev.clientY - sy) < 30) {
        root.querySelectorAll('.swiped').forEach((c) => c !== el && c.classList.remove('swiped'))
        el.classList.add('swiped')
        sid = -1
      }
    })
    // drag: reorder (edges) or stack (centre)
    el.addEventListener('dragstart', (ev) => {
      dragId = id
      ev.dataTransfer?.setData('text/plain', id)
    })
    el.addEventListener('dragend', () => {
      dragId = null
      root.querySelectorAll('.drop-stack,.drop-before,.drop-after').forEach((c) => c.classList.remove('drop-stack', 'drop-before', 'drop-after'))
    })
    const zone = (ev: DragEvent): 'before' | 'after' | 'stack' => {
      const r = el.getBoundingClientRect()
      const f = (ev.clientX - r.left) / r.width
      return openStack ? (f < 0.5 ? 'before' : 'after') : f < 0.25 ? 'before' : f > 0.75 ? 'after' : 'stack'
    }
    el.addEventListener('dragover', (ev) => {
      if (!dragId || dragId === id) return
      ev.preventDefault()
      const z = zone(ev)
      el.classList.toggle('drop-before', z === 'before')
      el.classList.toggle('drop-after', z === 'after')
      el.classList.toggle('drop-stack', z === 'stack')
    })
    el.addEventListener('dragleave', () => el.classList.remove('drop-stack', 'drop-before', 'drop-after'))
    el.addEventListener('drop', (ev) => {
      ev.preventDefault()
      const moving = dragId
      dragId = null
      if (!moving || moving === id) return
      const z = zone(ev)
      const mi = store.get(moving)
      if (z === 'stack') {
        if (!mi) return // stacks cannot be nested
        if (e.kind === 'stack') store.addToStack(id, moving)
        else if (!e.item.stackId) {
          const s = store.createStack([id, moving], t('gallery.stack.default'))
          void s
        }
      } else {
        if (mi?.stackId && !openStack) store.removeFromStack(moving)
        sort = 'manual'
        try {
          localStorage.setItem('bw.gallery.sort', sort)
        } catch {
          /* ignore */
        }
        store.reorder(moving, id, z === 'after', all)
      }
    })
    return el
  }

  function render(): void {
    if (!isOpen()) return
    const bar = h('div', { class: 'bw-g-bar' })
    const title = h('div', { class: 'bw-g-title' })
    const search = h('input', { type: 'search', placeholder: t('gallery.bar.search'), value: query })
    search.addEventListener('input', () => {
      query = search.value
      renderGrid()
    })
    search.addEventListener('keydown', (k) => k.stopPropagation())
    const sortSel = h('select', {}, ...([['manual', t('gallery.sort.manual')], ['newest', t('gallery.sort.newest')], ['oldest', t('gallery.sort.oldest')], ['name', t('gallery.sort.name')]] as [SortMode, string][]).map(([v, l]) => h('option', { value: v, text: t('gallery.bar.sort') + l, selected: v === sort })))
    sortSel.addEventListener('change', () => {
      sort = sortSel.value as SortMode
      try {
        localStorage.setItem('bw.gallery.sort', sort)
      } catch {
        /* ignore */
      }
      renderGrid()
    })
    // '@name' = icon from the shared set, then the text
    const b = (label: string, fn: () => void, cls = '', disabled = false): HTMLElement =>
      label.startsWith('@') ? h('button', { class: 'bw-g-btn ' + cls, icon: label.slice(1, label.indexOf(' ')), iconSize: 14, onclick: fn, disabled }, label.slice(label.indexOf(' ') + 1)) : h('button', { class: 'bw-g-btn ' + cls, text: label, onclick: fn, disabled })

    if (mode === 'bin') {
      title.append(t('gallery.trash.title'))
      bar.append(title, h('div', { class: 'sp' }), b(t('gallery.trash.emptyBtn', { n: store.trashed().length }), () => void emptyBin(), 'danger', !store.trashed().length), b(t('core.common.back'), () => ((mode = 'grid'), render())), b(t('gallery.dialog.close'), hide))
    } else if (openStack) {
      const st = store.stacks.find((s) => s.id === openStack)
      title.append(h('span', { class: 'crumb', text: t('gallery.panel.title'), onclick: () => ((openStack = null), render()) }), ' / ', st?.name ?? t('gallery.stack.default'))
      bar.append(
        title,
        h('div', { class: 'sp' }),
        b(t('gallery.dialog.rename'), () => st && void askText(t('gallery.dialog.renameStack'), st.name, t('gallery.dialog.rename')).then((n) => n && store.renameStack(st.id, n))),
        b(t('gallery.card.ungroup'), () => (store.ungroup(openStack!), (openStack = null), render())),
        b(selecting ? t('core.common.done') : t('core.common.select'), () => ((selecting = !selecting), selected.clear(), render()), selecting ? 'on' : ''),
        b(t('gallery.dialog.close'), hide)
      )
      if (selecting) bar.append(...selectionButtons())
    } else {
      title.append(t('gallery.panel.title'))
      bar.append(
        title,
        search,
        sortSel,
        h('div', { class: 'sp' }),
        ...(selecting ? selectionButtons() : []),
        b(selecting ? t('core.common.done') : t('core.common.select'), () => ((selecting = !selecting), selected.clear(), render()), selecting ? 'on' : ''),
        b(t('core.common.import'), doImport),
        b(store.trashed().length ? t('gallery.trash.binCount', { n: store.trashed().length }) : t('gallery.trash.bin'), () => ((mode = 'bin'), render())),
        b('@plus ' + t('gallery.bar.new'), () => showNewDocumentDialog(app, document.body), 'plus'),
        b(t('gallery.dialog.close'), hide)
      )
    }
    root.classList.toggle('select', selecting)
    root.replaceChildren(bar, h('div', { class: 'bw-g-grid' }))
    renderGrid()
  }

  function selectionButtons(): HTMLElement[] {
    const n = selected.size
    const bt = (label: string, fn: () => void, cls = '', dis = n === 0): HTMLElement => h('button', { class: 'bw-g-btn ' + cls, text: label, disabled: dis, onclick: fn })
    const itemIds = [...selected].filter((i) => store.get(i))
    return [
      h('span', { class: 'meta', text: t('gallery.bar.selected', { count: n }) }),
      bt(t('gallery.bar.stack'), () => (stackSelected(), render()), '', itemIds.length < 1 || !!openStack),
      bt(t('gallery.card.share').replace('…', ''), () => void guard('share', async () => { for (const id of itemIds) await shareItem(id) }), '', itemIds.length === 0),
      bt(t('gallery.card.duplicate'), () => void guard('duplicate', () => duplicateItems(itemIds)), '', itemIds.length === 0),
      bt(t('gallery.card.delete'), () => void trashItems(itemIds), 'danger', itemIds.length === 0)
    ]
  }

  function renderGrid(): void {
    const grid = root.querySelector('.bw-g-grid') as HTMLElement | null
    if (!grid) return
    grid.replaceChildren()
    if (mode === 'bin') {
      const list = store.trashed().sort((a, b) => (b.deleted ?? 0) - (a.deleted ?? 0))
      if (!list.length) grid.append(h('div', { class: 'bw-g-empty', text: t('gallery.trash.empty') }))
      for (const it of list) {
        const th = h('div', { class: 'bw-thumb' })
        void store.thumbUrl(it.id).then((u) => u && th.replaceChildren(h('img', { src: u })))
        grid.append(
          h(
            'div',
            { class: 'bw-card' },
            th,
            h('div', { class: 'name', text: it.name }),
            h('div', { class: 'meta', text: t('gallery.trash.deleted', { date: new Date(it.deleted!).toLocaleString() }) }),
            h('div', { class: 'row' }, h('button', { class: 'bw-g-btn', text: t('gallery.dialog.restore'), onclick: () => store.restore(it.id) }), h('button', { class: 'bw-g-btn danger', text: t('gallery.dialog.deleteForever'), onclick: () => void purgeOne(it) }))
          )
        )
      }
      return
    }
    let entries: Entry[]
    if (openStack) entries = store.stackItems(openStack).map((item) => ({ kind: 'item', item }) as Entry)
    else entries = rootEntries()
    if (!entries.length) {
      grid.append(h('div', { class: 'bw-g-empty', text: query ? t('gallery.empty.noMatch') : t('gallery.empty.none') }))
      return
    }
    const all = entries.map(idOf)
    for (const e of entries) grid.append(card(e, all))
  }

  const purgeOne = async (it: GalleryItem): Promise<void> => {
    if (await confirmDialog(t('gallery.dialog.deleteForever'), t('gallery.trash.purgeOne', { name: it.name }), t('gallery.dialog.deleteForever'))) await store.purge(it.id)
  }
  const emptyBin = async (): Promise<void> => {
    const l = store.trashed()
    if (!l.length) return
    if (!(await confirmDialog(t('gallery.trash.emptyTitle'), t('gallery.trash.purgeMany', { count: l.length }), t('gallery.trash.emptyOk')))) return
    for (const it of l) await store.purge(it.id)
  }

  store.onChange(() => {
    if (openStack && !store.stacks.some((s) => s.id === openStack)) openStack = null
    render()
  })

  // ------------------------------------------------------------------ menu + startup
  registerMenuItem('gallery', { id: 'gallery-open', label: tk('gallery.panel.title'), shortcut: 'Ctrl+Alt+G', action: 'gallery.toggle', run: () => show() })
  const list = menus.gallery
  const at = list.findIndex((m) => m.id === 'gallery-open')
  if (at > 0) list.unshift(...list.splice(at, 1))
  registerMenuItem('gallery', { id: 'gallery-import', label: tk('gallery.action.import'), run: () => (show(), doImport()) })
  // Ctrl+G is "Group layers" (Photoshop convention); the gallery uses Ctrl+Alt+G, bound via the action registry
  registerAction({ id: 'gallery.toggle', label: tk('gallery.panel.title'), category: 'File', defaultKeys: ['Ctrl+Alt+G'], run: () => (isOpen() ? hide() : show()) })
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
    if (e.key === 'Escape' && isOpen() && !document.querySelector('.modal-back')) hide()
  })

  galleryRef.ready = (async () => {
    if (!window.bwGallery) return
    await store.load()
    const recoveryNote = await window.brushwork?.takeRecoveryNotice?.() // set when this page load follows a renderer crash / GPU reset
    const selftest = await window.brushwork?.isSelfTest()
    const colorTest = (await window.bwGallery.env('BW_COLOR_SELFTEST')) === '1' || (await window.bwGallery.env('BW_PERF_TEST')) === '1' || (await window.bwGallery.env('BW_PERF_SELFTEST')) === '1'
    store.startAutosave()
    if (selftest || colorTest) return
    if (!store.seeded && !store.live().length) await seedSamples(app, store)
    if (await window.brushwork?.hasOpenFiles?.()) return // launched with a file (double-click .bwk): it opens instead of the last artwork
    const last = store.lastOpened && store.get(store.lastOpened)
    if (last && !last.deleted) await guard('reopen', () => store.open(last.id))
    if (recoveryNote) app.notify(recoveryNote)
  })()
}

/** Starter artworks so the gallery is not empty on first launch. */
async function seedSamples(app: App, store: GalleryStore): Promise<void> {
  store.seeded = true
  const W = 1200
  const H = 900
  const makers: [string, (c: OffscreenCanvasRenderingContext2D) => void][] = [
    [
      t('gallery.sample.sunset'),
      (c) => {
        const g = c.createLinearGradient(0, 0, 0, H)
        g.addColorStop(0, '#2b1055')
        g.addColorStop(0.55, '#ff6a5c')
        g.addColorStop(1, '#ffd08a')
        c.fillStyle = g
        c.fillRect(0, 0, W, H)
        c.fillStyle = '#fff3c4'
        c.beginPath()
        c.arc(W / 2, H * 0.62, 130, 0, Math.PI * 2)
        c.fill()
        c.fillStyle = '#1b1030'
        c.beginPath()
        c.moveTo(0, H)
        for (let x = 0; x <= W; x += 40) c.lineTo(x, H * 0.78 + Math.sin(x / 90) * 40)
        c.lineTo(W, H)
        c.fill()
      }
    ],
    [
      t('gallery.sample.color'),
      (c) => {
        c.fillStyle = '#f4efe6'
        c.fillRect(0, 0, W, H)
        const cols = ['#e8412e', '#f7c531', '#3b82f6', '#4aa85a', '#9b59d0', '#2ab5b0']
        for (let i = 0; i < 36; i++) {
          c.fillStyle = cols[i % cols.length]
          c.globalAlpha = 0.75
          c.beginPath()
          c.arc(150 + (i % 6) * 180, 150 + Math.floor(i / 6) * 120, 55 + (i % 4) * 8, 0, Math.PI * 2)
          c.fill()
        }
      }
    ],
    [
      t('gallery.sample.grid'),
      (c) => {
        c.fillStyle = '#fbfbfb'
        c.fillRect(0, 0, W, H)
        c.strokeStyle = '#c9d4e6'
        c.lineWidth = 2
        for (let x = 0; x <= W; x += 60) (c.beginPath(), c.moveTo(x, 0), c.lineTo(x, H), c.stroke())
        for (let y = 0; y <= H; y += 60) (c.beginPath(), c.moveTo(0, y), c.lineTo(W, y), c.stroke())
        c.strokeStyle = '#222'
        c.lineWidth = 5
        c.beginPath()
        c.moveTo(120, 700)
        c.bezierCurveTo(300, 100, 700, 900, 1080, 200)
        c.stroke()
      }
    ]
  ]
  try {
    for (const [name, draw] of makers) {
      const cv = new OffscreenCanvas(W, H)
      draw(cv.getContext('2d')!)
      const img = cv.getContext('2d')!.getImageData(0, 0, W, H)
      const doc = Document.create(app.gpu, W, H, { background: { color: [1, 1, 1], visible: false } })
      app.gpu.uploadRGBA8(doc.layers[0].surface, 0, 0, W, H, img.data)
      doc.name = name
      await GalleryStore.withCompositor(app.gpu, doc, (c) => store.addDocument(doc, { name }, c))
      doc.dispose()
    }
    store.lastOpened = null
    store.saveIndex(true)
  } catch (e) {
    console.error('[gallery] seeding samples failed', e)
  }
}
