import { t } from '../../i18n'
import { unzipSync, strFromU8 } from 'fflate'
import type { App } from '../../app/app'
import { ephemeralDocs } from '../../doc/ephemeral'
import { Document } from '../../doc/document'
import { Compositor } from '../../gl/compositor'
import type { GPU } from '../../gl/gpu'
import { decodeImage, loadBwk, saveBwkEx } from '../../io/bwk'
import { SaveAborted } from '../../io/asyncSave'
import { Journal } from './journal'
import type { GalleryApi } from '../../../../preload/gallery'

declare global {
  interface Window {
    bwGallery?: GalleryApi
  }
}

export interface GalleryItem {
  id: string
  name: string
  width: number
  height: number
  /** infinite canvas: width / height are the size of the painted content, not a canvas size */
  infinite?: boolean
  layers: number
  created: number
  modified: number
  stackId: string | null
  /** manual ordering: higher = earlier (newest first by default) */
  order: number
  profile: string
  dpi: number
  /** timestamp when moved to the recycle bin */
  deleted?: number
}
export interface GalleryStack {
  id: string
  name: string
  created: number
  order: number
  deleted?: number
}
interface IndexFile {
  version: 1
  items: GalleryItem[]
  stacks: GalleryStack[]
  lastOpened: string | null
  seeded: boolean
}

export interface NewItemMeta {
  name?: string
  profile?: string
  dpi?: number
}

const api = (): NonNullable<Window['bwGallery']> => {
  if (!window.bwGallery) throw new Error('Gallery storage unavailable')
  return window.bwGallery
}

type SaveResult = 'saved' | 'aborted' | 'skipped' | 'failed'
const QUICK_MS = 300
const RETRY_MS = 900

/** Write a big file to the gallery in ~1 MB IPC pieces (one 40 MB message would block the UI for a frame or more). */
/** Gallery card size: the canvas of a fixed document, the content bounds (tile granularity) of an infinite one. */
export function itemSize(doc: Document): { width: number; height: number; infinite?: boolean } {
  if (!doc.isInfinite) return { width: doc.width, height: doc.height }
  const b = doc.contentBounds()
  return { width: b ? Math.round(b.w) : 0, height: b ? Math.round(b.h) : 0, infinite: true }
}

export async function writeChunked(name: string, data: Uint8Array): Promise<void> {
  const CH = 1 << 20
  if (data.length <= CH) {
    await api().write(name, data)
    return
  }
  const id = await api().wbegin(name)
  try {
    for (let o = 0; o < data.length; o += CH) await api().wchunk(id, data.slice(o, o + CH))
    await api().wend(id)
  } catch (e) {
    await api().wabort(id).catch(() => undefined)
    throw e
  }
}

let uid = 0
const newId = (): string => 'a' + Date.now().toString(36) + (uid++).toString(36) + Math.random().toString(36).slice(2, 5)

/** Importers for extra formats (PSD etc). The IO module registers here; return a ready Document. */
export interface GalleryImporter {
  exts: string[]
  run(bytes: Uint8Array, fileName: string, gpu: GPU): Promise<Document>
}
const importers: GalleryImporter[] = []
export const registerGalleryImporter = (i: GalleryImporter): void => void importers.push(i)

/**
 * The Gallery: artworks stored as <id>.bwk + <id>.png thumbnail + index.json in <userData>/Gallery.
 * Also owns autosave of the open document.
 */
export class GalleryStore {
  items: GalleryItem[] = []
  stacks: GalleryStack[] = []
  lastOpened: string | null = null
  seeded = false
  loaded = false
  private listeners = new Set<() => void>()
  private docIds = new WeakMap<Document, string>()
  private thumbs = new Map<string, string>()
  private thumbLoads = new Map<string, Promise<string | null>>()
  private indexTimer = 0
  private indexChain: Promise<void> = Promise.resolve()
  private saveTimer = 0
  private saving: Promise<unknown> = Promise.resolve()
  private dirty = new Set<Document>()
  private offDoc: (() => void) | null = null

  readonly journal: Journal
  constructor(private app: App) {
    this.journal = new Journal(api, (doc) => {
      this.dirty.add(doc)
      this.schedule(QUICK_MS, true)
    })
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private emit(): void {
    for (const f of this.listeners) f()
  }

  // ------------------------------------------------------------------ index
  async load(): Promise<void> {
    try {
      const raw = await api().read('index.json')
      if (raw) {
        const j = JSON.parse(strFromU8(raw)) as Partial<IndexFile>
        this.items = Array.isArray(j.items) ? j.items : []
        this.stacks = Array.isArray(j.stacks) ? j.stacks : []
        this.lastOpened = j.lastOpened ?? null
        this.seeded = !!j.seeded
      }
    } catch (e) {
      console.error('[gallery] index load failed', e)
    }
    this.loaded = true
    this.emit()
  }

  saveIndex(now = false): void {
    clearTimeout(this.indexTimer)
    // index writes are serialised and never reject (an unhandled rejection here used to surface as an uncaught error)
    const run = (): Promise<void> => {
      this.indexChain = this.indexChain.then(async () => {
        try {
          const j: IndexFile = { version: 1, items: this.items, stacks: this.stacks, lastOpened: this.lastOpened, seeded: this.seeded }
          await api().write('index.json', new TextEncoder().encode(JSON.stringify(j)))
        } catch (e) {
          console.error('[gallery] index write failed', e)
        }
      })
      return this.indexChain
    }
    if (now) void run()
    else this.indexTimer = window.setTimeout(() => void run(), 300)
    this.emit()
  }

  get(id: string): GalleryItem | undefined {
    return this.items.find((i) => i.id === id)
  }
  live(): GalleryItem[] {
    return this.items.filter((i) => !i.deleted)
  }
  trashed(): GalleryItem[] {
    return this.items.filter((i) => i.deleted)
  }
  private nextOrder(): number {
    return Math.max(0, ...this.items.map((i) => i.order), ...this.stacks.map((s) => s.order)) + 1
  }

  // ------------------------------------------------------------------ thumbnails
  thumbUrl(id: string): Promise<string | null> {
    const c = this.thumbs.get(id)
    if (c) return Promise.resolve(c)
    // one in-flight load per id, so concurrent callers never create (and leak) a second blob URL
    let p = this.thumbLoads.get(id)
    if (!p) {
      p = (async () => {
        try {
          const bytes = await api().read(id + '.png')
          if (!bytes) return null
          const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: 'image/png' }))
          this.thumbs.set(id, url)
          return url
        } finally {
          this.thumbLoads.delete(id)
        }
      })()
      this.thumbLoads.set(id, p)
    }
    return p
  }
  private dropThumb(id: string): void {
    const u = this.thumbs.get(id)
    if (u) URL.revokeObjectURL(u)
    this.thumbs.delete(id)
  }

  // ------------------------------------------------------------------ documents
  idOf(doc: Document): string | undefined {
    return this.docIds.get(doc)
  }
  bind(doc: Document, id: string): void {
    this.docIds.set(doc, id)
  }

  /** Add `doc` to the gallery index (no file yet). Returns the id. */
  private registerItem(doc: Document, meta: NewItemMeta = {}): string {
    const id = newId()
    const now = Date.now()
    this.items.push({
      id,
      name: meta.name || doc.name || t('core.common.untitled'),
      ...itemSize(doc),
      layers: doc.layers.filter((l) => !(l as any).isGroup).length,
      created: now,
      modified: now,
      stackId: null,
      order: this.nextOrder(),
      profile: meta.profile ?? 'sRGB',
      dpi: meta.dpi ?? 132
    })
    doc.name = this.get(id)!.name
    this.docIds.set(doc, id)
    this.lastOpened = id
    return id
  }

  /** Register `doc` as a new gallery artwork and save it. Returns the id. */
  async addDocument(doc: Document, meta: NewItemMeta = {}, _compositor?: Compositor): Promise<string> {
    const id = this.registerItem(doc, meta)
    await this.saveDocument(doc)
    return id
  }

  /**
   * Serialise a document into its gallery slot (bwk + thumbnail). Every save goes through ONE queue; the promise
   * always resolves (failures are logged, the document simply stays dirty).
   */
  saveDocument(doc: Document, _compositor: Compositor = this.app.compositor): Promise<void> {
    return this.enqueue(doc, false, true).then(() => undefined)
  }

  private queued = new Map<Document, Promise<SaveResult>>()
  private pendingJobs = new WeakMap<Document, number>()
  private enqueue(doc: Document, background: boolean, force: boolean): Promise<SaveResult> {
    if (background) {
      const q = this.queued.get(doc)
      if (q) return q // one queued autosave per document is enough
    }
    const p: Promise<SaveResult> = this.saving
      .then(() => {
        if (background) this.queued.delete(doc)
        return this.runJob(doc, background, force)
      })
      .catch((e): SaveResult => {
        console.error('[gallery] save job crashed', e)
        return 'failed'
      })
    this.saving = p
    if (background) this.queued.set(doc, p)
    this.pendingJobs.set(doc, (this.pendingJobs.get(doc) ?? 0) + 1)
    void p.finally(() => this.pendingJobs.set(doc, (this.pendingJobs.get(doc) ?? 1) - 1))
    return p
  }

  private async runJob(doc: Document, background: boolean, force: boolean): Promise<SaveResult> {
    if (doc.disposed) return 'skipped'
    if (!force && !this.dirty.has(doc)) return 'skipped'
    let id = this.docIds.get(doc)
    if (!id) id = this.registerItem(doc)
    const item = this.get(id)
    if (!item || item.deleted) {
      this.dirty.delete(doc)
      return 'skipped'
    }
    this.dirty.delete(doc)
    const seq = doc.commitSeq
    try {
      let r: Awaited<ReturnType<typeof saveBwkEx>>
      if (doc.isInfinite) {
        // streamed straight into the file through the main process: a huge document is never one buffer in the renderer
        const wid = await api().wbegin(id + '.bwk')
        try {
          r = await saveBwkEx(doc, this.app.compositor, {}, { background, recompose: !background, sink: { write: async (c) => void (await api().wchunk(wid, c)) } })
          await api().wend(wid)
        } catch (e) {
          await api().wabort(wid)
          throw e
        }
      } else {
        r = await saveBwkEx(doc, this.app.compositor, {}, { background, recompose: !background })
        await writeChunked(id + '.bwk', r.bytes)
      }
      await api().write(id + '.png', r.thumbnail)
      this.dropThumb(id)
      item.modified = Date.now()
      Object.assign(item, itemSize(doc))
      item.layers = doc.layers.filter((l) => !(l as any).isGroup).length
      // a brand-new artwork must be in index.json before anything else can happen (a kill within the 300 ms index debounce
      // would orphan the file and the journal that protects it)
      this.saveIndex(item.created === item.modified || !this.indexed.has(id))
      this.indexed.add(id)
      this.lastSave = { encoded: r.encoded, reused: r.reused }
      if (!doc.disposed) {
        this.journal.attach(doc, id)
        this.journal.saved(doc, seq)
      }
      return 'saved'
    } catch (e) {
      if (!doc.disposed) this.dirty.add(doc) // retry later
      if (e instanceof SaveAborted) return 'aborted'
      console.error('[gallery] save failed', e)
      return 'failed'
    }
  }
  private indexed = new Set<string>()
  /** layers re-encoded / reused by the last completed save (tests) */
  lastSave = { encoded: 0, reused: 0 }

  // ------------------------------------------------------------------ autosave
  /** Start watching app documents: every committed edit schedules a debounced save. */
  startAutosave(delayMs = 1800): void {
    this.delayMs = delayMs
    const hook = (doc: Document): void => {
      this.offDoc?.()
      this.offDoc = doc.events.on('commit', (e) => {
        if (e.type === 'new' || e.type === 'load' || ephemeralDocs.has(doc)) return
        this.dirty.add(doc)
        // the very first edit of an unsaved document saves quickly (no file to journal against yet)
        this.schedule(this.docIds.get(doc) ? this.delayMs : QUICK_MS, !this.docIds.get(doc))
      })
    }
    hook(this.app.doc)
    this.app.events.on('doc', (d) => hook(d))
    // an old document's GPU memory is only freed once its unsaved edits are safely written
    this.app.disposeGuards.push((doc) => (this.dirty.has(doc) || (this.pendingJobs.get(doc) ?? 0) > 0 ? this.enqueue(doc, false, false) : null))
    window.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && void this.flush())
    window.addEventListener('beforeunload', () => void this.flush())
  }
  private delayMs = 1800
  private saveDue = 0

  /** Mark a document as changed without a commit event (time-lapse edit settings) so the next autosave includes it. */
  touchDoc(doc: Document): void {
    if (ephemeralDocs.has(doc) || doc.disposed) return
    this.dirty.add(doc)
    this.schedule(this.docIds.get(doc) ? this.delayMs : QUICK_MS, !this.docIds.get(doc))
  }

  /** (Re)arm the autosave timer. Normal edits debounce; a quick request (uncovered by the journal) is never postponed. */
  private schedule(ms: number, quick = false): void {
    const due = performance.now() + ms
    if (this.saveTimer) {
      if (this.timerQuick && !quick) return // an armed quick save stays
      if (quick && this.saveDue <= due) return // an earlier timer already exists
    }
    clearTimeout(this.saveTimer)
    this.timerQuick = quick
    this.saveDue = due
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = 0
      void this.autoFlush()
    }, ms)
  }
  private timerQuick = false

  /** Timer callback: background save of the open document; yields to drawing and retries when aborted. */
  private async autoFlush(): Promise<void> {
    const doc = this.app.doc
    if (!this.dirty.has(doc)) return
    const r = await this.enqueue(doc, true, false)
    if (r === 'aborted' && !doc.disposed) this.schedule(RETRY_MS)
    else if (r === 'failed' && !doc.disposed) this.schedule(5000)
  }

  /** Save every dirty document now (the open one; auto-adds it to the gallery on first edit) and wait for the queue. */
  async flush(): Promise<void> {
    clearTimeout(this.saveTimer)
    this.saveTimer = 0
    const doc = this.app.doc
    if (this.dirty.has(doc)) await this.enqueue(doc, false, false)
    await this.saving
    this.saveIndex()
  }

  /** Resolves when the save queue is idle (tests). */
  idle(): Promise<void> {
    return this.saving.then(() => undefined)
  }

  // ------------------------------------------------------------------ open / import
  async open(id: string): Promise<boolean> {
    const item = this.get(id)
    if (!item) return false
    await this.flush()
    const bytes = await api().read(id + '.bwk')
    if (!bytes) {
      this.app.notify(t('gallery.error.filesMissing'))
      return false
    }
    let doc: Document
    try {
      doc = await loadBwk(bytes, this.app.gpu)
    } catch (e) {
      // the current file is unreadable: fall back to the previous version kept by the verified-save step (<id>.bwk~)
      const prev = await api().read(id + '.bwk~')
      if (!prev) throw e
      console.warn('[gallery] ' + id + '.bwk is unreadable, opening the previous version', e)
      doc = await loadBwk(prev, this.app.gpu)
      this.app.notify(t('gallery.recoveredPrevious'))
    }
    doc.name = item.name
    this.docIds.set(doc, id)
    this.lastOpened = id
    // crash recovery: strokes journaled after the last full save are replayed, then saved right away
    const recovered = await this.journal.replay(doc, id)
    this.app.setDocument(doc)
    this.journal.attach(doc, id)
    if (recovered) {
      this.app.notify(t('gallery.recovered', { count: recovered }))
      this.dirty.add(doc)
      await this.enqueue(doc, false, true)
    }
    this.saveIndex()
    return true
  }

  /** Import a file (image, .bwk or a registered format) as a new artwork and open it. */
  async importFile(bytes: Uint8Array, fileName: string): Promise<string> {
    const lower = fileName.toLowerCase()
    const base = fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '') || t('gallery.imported')
    const gpu = this.app.gpu
    let doc: Document
    const ext = lower.slice(lower.lastIndexOf('.') + 1)
    const custom = importers.find((i) => i.exts.includes(ext))
    if (custom) doc = await custom.run(bytes, fileName, gpu)
    else if (ext === 'bwk') doc = await loadBwk(bytes, gpu)
    else {
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : ext === 'bmp' ? 'image/bmp' : 'image/png'
      const img = await decodeImage(bytes, mime)
      if (img.width > gpu.maxTexture || img.height > gpu.maxTexture) throw new Error(`Image exceeds the ${gpu.maxTexture}px canvas limit`)
      doc = Document.create(gpu, img.width, img.height, { background: { color: [1, 1, 1], visible: false } })
      gpu.uploadRGBA8(doc.layers[0].surface, 0, 0, img.width, img.height, img.data)
      doc.layers[0].name = base
    }
    doc.name = base
    await this.flush()
    const id = await this.addDocument(doc, { name: base })
    this.app.setDocument(doc)
    this.saveIndex(true)
    return id
  }

  // ------------------------------------------------------------------ item operations
  rename(id: string, name: string): void {
    const it = this.get(id)
    if (!it || !name.trim()) return
    it.name = name.trim().slice(0, 100)
    const cur = this.app.doc
    if (this.docIds.get(cur) === id) cur.name = it.name
    this.saveIndex()
  }

  async duplicate(id: string): Promise<string | null> {
    const it = this.get(id)
    if (!it) return null
    if (this.docIds.get(this.app.doc) === id) await this.flush()
    const bytes = await api().read(id + '.bwk')
    if (!bytes) return null
    const nid = newId()
    await api().write(nid + '.bwk', bytes)
    const th = await api().read(id + '.png')
    if (th) await api().write(nid + '.png', th)
    this.items.push({ ...it, id: nid, name: it.name + t('core.doc.copySuffix'), created: Date.now(), modified: Date.now(), order: this.nextOrder(), deleted: undefined })
    this.saveIndex()
    return nid
  }

  /** Move to the recycle bin (restorable). */
  trash(id: string): void {
    const it = this.get(id)
    if (!it) return
    it.deleted = Date.now()
    it.stackId = null
    if (this.lastOpened === id) this.lastOpened = null
    this.saveIndex()
  }
  restore(id: string): void {
    const it = this.get(id)
    if (it) {
      it.deleted = undefined
      it.order = this.nextOrder()
      this.saveIndex()
    }
  }
  async purge(id: string): Promise<void> {
    this.items = this.items.filter((i) => i.id !== id)
    this.dropThumb(id)
    await api().remove(id + '.bwk')
    await api().remove(id + '.bwk~')
    await api().remove(id + '.png')
    this.saveIndex()
  }

  // ------------------------------------------------------------------ stacks
  createStack(itemIds: string[], name = t('gallery.stack.default')): GalleryStack {
    const s: GalleryStack = { id: newId(), name, created: Date.now(), order: this.nextOrder() }
    this.stacks.push(s)
    for (const id of itemIds) {
      const it = this.get(id)
      if (it) it.stackId = s.id
    }
    this.saveIndex()
    return s
  }
  addToStack(stackId: string, itemId: string): void {
    const it = this.get(itemId)
    if (it && this.stacks.some((s) => s.id === stackId)) {
      it.stackId = stackId
      this.saveIndex()
    }
  }
  removeFromStack(itemId: string): void {
    const it = this.get(itemId)
    if (it?.stackId) {
      it.stackId = null
      it.order = this.nextOrder()
      this.pruneStacks()
      this.saveIndex()
    }
  }
  renameStack(id: string, name: string): void {
    const s = this.stacks.find((x) => x.id === id)
    if (s && name.trim()) {
      s.name = name.trim().slice(0, 100)
      this.saveIndex()
    }
  }
  ungroup(stackId: string): void {
    for (const it of this.items) if (it.stackId === stackId) it.stackId = null
    this.stacks = this.stacks.filter((s) => s.id !== stackId)
    this.saveIndex()
  }
  /** stacks with fewer than one live item disappear */
  pruneStacks(): void {
    this.stacks = this.stacks.filter((s) => this.items.some((i) => i.stackId === s.id && !i.deleted))
  }
  stackItems(stackId: string): GalleryItem[] {
    return this.live().filter((i) => i.stackId === stackId).sort((a, b) => b.order - a.order)
  }

  /** Reorder root entries: put `moving` before/after `anchor` (ids of items or stacks). */
  reorder(moving: string, anchor: string, after: boolean, all: string[]): void {
    const ids = all.filter((x) => x !== moving)
    const at = ids.indexOf(anchor)
    if (at < 0) return
    ids.splice(after ? at + 1 : at, 0, moving)
    // descending order values: first entry has the highest
    ids.forEach((id, i) => {
      const v = ids.length - i
      const it = this.get(id)
      if (it) it.order = v
      const st = this.stacks.find((s) => s.id === id)
      if (st) st.order = v
    })
    this.saveIndex()
  }

  // ------------------------------------------------------------------ misc
  /** A temporary compositor for a document that is not the open one (share / sample generation). */
  static withCompositor<T>(gpu: GPU, doc: Document, fn: (c: Compositor) => Promise<T>): Promise<T> {
    const c = new Compositor(gpu, doc)
    return fn(c).finally(() => {
      c.composite.dispose()
      ;(c as any).ping?.forEach((s: { dispose(): void }) => s.dispose())
    })
  }
}
