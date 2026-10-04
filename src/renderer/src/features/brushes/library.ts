import { BrushPreset, cloneBrush, defaultBrush, normalizeBrush } from '../../core/brush'
import { Emitter } from '../../core/events'
import { DEFAULT_SETS } from '../../brush/defaults'
import { t } from '../../i18n'
import { brushName, setName, getBrushPreset, getPristineBrush, isDefaultBrush, listBrushPresets, registerBrushPreset, removeBrushPreset, brushUsed } from '../../brush/presets'
import { BrushTexture, getTextureDef, listTextures, registerTexture } from '../../brush/textures'

export interface BrushSet {
  id: string
  name: string
  brushIds: string[]
  /** shipped with the app (can be reset, not "unshippable") */
  builtin?: boolean
}

export const RECENT_ID = 'recent'
export const FAVORITES_ID = 'favorites'
export const isVirtualSet = (id: string): boolean => id === RECENT_ID || id === FAVORITES_ID
const MAX_RECENT = 30
const DB = 'brushwork-brushes'
const KEY = 'library-v1'

interface Persisted {
  v: 1
  sets: BrushSet[]
  favorites: string[]
  recent: string[]
  /** every brush that is user-made or was modified */
  brushes: Record<string, BrushPreset>
  /** shipped brushes the user deleted */
  removed: string[]
  textures: { id: string; kind: 'tip' | 'grain'; size: number; name?: string; data: Uint8Array }[]
}

export interface LibraryEvents {
  /** sets, membership or brush data changed */
  change: void
  recent: void
}

const uid = (p: string): string => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

/** Minimal IndexedDB key/value store (falls back to nothing when unavailable). */
const idb = {
  open(): Promise<IDBDatabase> {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1)
      r.onupgradeneeded = () => r.result.createObjectStore('kv')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
  },
  async get<T>(key: string): Promise<T | undefined> {
    const db = await this.open()
    return new Promise((res, rej) => {
      const q = db.transaction('kv').objectStore('kv').get(key)
      q.onsuccess = () => res(q.result as T | undefined)
      q.onerror = () => rej(q.error)
    })
  },
  async put(key: string, value: unknown): Promise<void> {
    const db = await this.open()
    return new Promise((res, rej) => {
      const t = db.transaction('kv', 'readwrite')
      t.objectStore('kv').put(value, key)
      t.oncomplete = () => res()
      t.onerror = () => rej(t.error)
    })
  }
}

/**
 * Brush library: ordered sets of brush ids + the shared brush registry (brush/presets.ts).
 * "Recent" and "Favorites" are virtual sets. Persisted in IndexedDB (brushes + custom textures).
 */
export class BrushLibrary {
  readonly events = new Emitter<LibraryEvents>()
  sets: BrushSet[] = []
  favorites: string[] = []
  recent: string[] = []
  private removed = new Set<string>()
  private timer = 0
  private loaded = false
  persist = true

  constructor() {
    this.resetSets()
    brushUsed.on('used', (id) => this.markUsed(id))
  }

  private resetSets(): void {
    this.sets = DEFAULT_SETS.map((s) => ({ id: s.id, name: s.name, builtin: true, brushIds: s.brushes.map((b) => b.id) }))
  }

  // ------------------------------------------------------------------ persistence
  async load(): Promise<void> {
    try {
      await this.loadTextures()
      const p = await idb.get<Persisted>(KEY)
      if (p && p.v === 1) this.apply(p)
    } catch (e) {
      console.warn('brush library: could not read stored library', e)
    }
    this.loaded = true
    this.events.emit('change', undefined)
  }

  private apply(p: Persisted): void {
    for (const t of p.textures ?? []) registerTexture({ id: t.id, kind: t.kind, size: t.size, name: t.name, data: t.data })
    for (const b of Object.values(p.brushes ?? {})) registerBrushPreset(b)
    for (const id of p.removed ?? []) {
      this.removed.add(id)
      removeBrushPreset(id)
    }
    // sets: keep persisted order; drop ids that no longer exist
    const known = new Set(listBrushPresets().map((b) => b.id))
    const sets = (p.sets ?? []).map((s) => ({ ...s, brushIds: s.brushIds.filter((id) => known.has(id)) }))
    // shipped sets added in newer versions are appended
    for (const d of this.sets) if (!sets.some((s) => s.id === d.id)) sets.push({ ...d, brushIds: d.brushIds.filter((id) => known.has(id)) })
    this.sets = sets
    this.favorites = (p.favorites ?? []).filter((id) => known.has(id))
    this.recent = (p.recent ?? []).filter((id) => known.has(id))
  }

  private schedule(): void {
    if (!this.persist || !this.loaded) return
    clearTimeout(this.timer)
    this.timer = window.setTimeout(() => void this.save(), 500)
  }

  async save(): Promise<void> {
    if (!this.persist) return
    const brushes: Record<string, BrushPreset> = {}
    for (const b of listBrushPresets()) {
      const pr = getPristineBrush(b.id)
      if (!pr || JSON.stringify(pr) !== JSON.stringify(b)) brushes[b.id] = b
    }
    const textures = listTextures()
      .filter((t) => !t.builtin)
      .map((t) => ({ id: t.id, kind: t.kind, size: t.size, name: t.name, data: t.data }))
    const p: Persisted = { v: 1, sets: this.sets, favorites: this.favorites, recent: this.recent, brushes, removed: [...this.removed], textures }
    try {
      await idb.put(KEY, JSON.parse(JSON.stringify({ ...p, textures: [] })))
      await idb.put(KEY + '-tex', textures)
    } catch (e) {
      console.warn('brush library: save failed', e)
    }
  }

  /** Restore textures stored separately (kept apart so the JSON blob stays small). */
  async loadTextures(): Promise<void> {
    try {
      const t = await idb.get<Persisted['textures']>(KEY + '-tex')
      for (const x of t ?? []) registerTexture({ id: x.id, kind: x.kind, size: x.size, name: x.name, data: x.data })
    } catch {
      /* ignore */
    }
  }

  private changed(): void {
    this.events.emit('change', undefined)
    this.schedule()
  }

  // ------------------------------------------------------------------ queries
  set(id: string): BrushSet | undefined {
    return this.sets.find((s) => s.id === id)
  }
  brushesOf(setId: string): BrushPreset[] {
    const ids = setId === RECENT_ID ? this.recent : setId === FAVORITES_ID ? this.favorites : this.set(setId)?.brushIds ?? []
    return ids.map((id) => getBrushPreset(id)).filter((b): b is BrushPreset => !!b)
  }
  setsContaining(id: string): BrushSet[] {
    return this.sets.filter((s) => s.brushIds.includes(id))
  }
  isFavorite(id: string): boolean {
    return this.favorites.includes(id)
  }
  search(q: string): BrushPreset[] {
    const s = q.trim().toLowerCase()
    if (!s) return []
    return listBrushPresets().filter((b) => b.name.toLowerCase().includes(s) || brushName(b).toLowerCase().includes(s) || b.id.toLowerCase().includes(s) || b.about.author.toLowerCase().includes(s))
  }

  // ------------------------------------------------------------------ sets
  addSet(name: string): BrushSet {
    const s: BrushSet = { id: uid('set-u'), name, brushIds: [] }
    this.sets.unshift(s)
    this.changed()
    return s
  }
  renameSet(id: string, name: string): void {
    const s = this.set(id)
    if (s && name.trim()) {
      s.name = name.trim()
      this.changed()
    }
  }
  duplicateSet(id: string): BrushSet | null {
    const s = this.set(id)
    if (!s) return null
    const c: BrushSet = { id: uid('set-u'), name: setName(s) + ' ' + t('brushes.library.copySuffix'), brushIds: [] }
    for (const bid of s.brushIds) {
      const b = getBrushPreset(bid)
      if (b) c.brushIds.push(this.cloneInto(b).id)
    }
    this.sets.splice(this.sets.indexOf(s) + 1, 0, c)
    this.changed()
    return c
  }
  deleteSet(id: string): void {
    const i = this.sets.findIndex((s) => s.id === id)
    if (i < 0) return
    this.sets.splice(i, 1)
    this.changed()
  }
  moveSet(id: string, toIndex: number): void {
    const i = this.sets.findIndex((s) => s.id === id)
    if (i < 0) return
    const [s] = this.sets.splice(i, 1)
    this.sets.splice(Math.max(0, Math.min(this.sets.length, toIndex)), 0, s)
    this.changed()
  }

  // ------------------------------------------------------------------ brushes
  private cloneInto(b: BrushPreset): BrushPreset {
    const c = cloneBrush(b)
    c.id = uid('b-')
    c.name = brushName(b) + ' ' + t('brushes.library.copySuffix')
    delete c.resetPoint
    return registerBrushPreset(c)
  }
  /** Add a (new or imported) brush to a set. */
  addBrush(b: BrushPreset, setId: string, index?: number): BrushPreset {
    const reg = registerBrushPreset(b)
    const s = this.set(setId) ?? this.sets[0]
    if (!s.brushIds.includes(reg.id)) s.brushIds.splice(index ?? s.brushIds.length, 0, reg.id)
    this.changed()
    return reg
  }
  newBrush(setId: string): BrushPreset {
    const b = defaultBrush(uid('b-'), t('brushes.library.untitledBrush'))
    b.about.created = new Date().toISOString().slice(0, 10)
    return this.addBrush(b, setId, 0)
  }
  duplicateBrush(id: string): BrushPreset | null {
    const b = getBrushPreset(id)
    if (!b) return null
    const c = this.cloneInto(b)
    for (const s of this.setsContaining(id)) s.brushIds.splice(s.brushIds.indexOf(id) + 1, 0, c.id)
    if (!this.setsContaining(id).length) this.sets[0].brushIds.unshift(c.id)
    this.changed()
    return c
  }
  deleteBrush(id: string, fromSet?: string): void {
    // deleting from a set removes only that membership; a brush in no set is removed altogether
    if (fromSet && !isVirtualSet(fromSet)) {
      const s = this.set(fromSet)
      if (s) s.brushIds = s.brushIds.filter((x) => x !== id)
      if (this.setsContaining(id).length) return this.changed()
    } else for (const s of this.sets) s.brushIds = s.brushIds.filter((x) => x !== id)
    this.favorites = this.favorites.filter((x) => x !== id)
    this.recent = this.recent.filter((x) => x !== id)
    if (isDefaultBrush(id)) this.removed.add(id)
    removeBrushPreset(id)
    this.changed()
  }
  moveBrush(id: string, fromSet: string, toSet: string, toIndex: number): void {
    if (fromSet === FAVORITES_ID || fromSet === RECENT_ID) return
    const from = this.set(fromSet)
    const to = this.set(toSet)
    if (!from || !to) return
    const i = from.brushIds.indexOf(id)
    if (i < 0) return
    if (from === to) {
      from.brushIds.splice(i, 1)
      from.brushIds.splice(toIndex > i ? toIndex - 1 : toIndex, 0, id)
    } else {
      from.brushIds.splice(i, 1)
      if (!to.brushIds.includes(id)) to.brushIds.splice(toIndex, 0, id)
    }
    this.changed()
  }
  /** Commit Brush Studio edits. */
  updateBrush(b: BrushPreset): void {
    registerBrushPreset(normalizeBrush(b))
    this.changed()
  }
  toggleFavorite(id: string): void {
    this.favorites = this.isFavorite(id) ? this.favorites.filter((x) => x !== id) : [id, ...this.favorites]
    this.changed()
  }
  markUsed(id: string): void {
    if (!getBrushPreset(id) || this.recent[0] === id) return
    this.recent = [id, ...this.recent.filter((x) => x !== id)].slice(0, MAX_RECENT)
    this.events.emit('recent', undefined)
    this.schedule()
  }

  /** Put shipped brushes and shipped sets back to their original state; user sets and brushes stay. */
  resetDefaults(): void {
    this.removed.clear()
    for (const set of DEFAULT_SETS) {
      for (const b of set.brushes) {
        const p = getPristineBrush(b.id)
        if (p) registerBrushPreset(p)
      }
      const cur = this.set(set.id)
      const ids = set.brushes.map((b) => b.id)
      if (cur) cur.brushIds = [...ids, ...cur.brushIds.filter((id) => !ids.includes(id) && !isDefaultBrush(id))]
      else this.sets.push({ id: set.id, name: set.name, builtin: true, brushIds: ids })
    }
    this.changed()
  }
  /** Reset one shipped brush to its original definition. */
  resetBrush(id: string): void {
    const p = getPristineBrush(id)
    if (p) {
      registerBrushPreset(p)
      this.changed()
    }
  }

  usedTextureIds(b: BrushPreset): { id: string; tex: BrushTexture }[] {
    const ids = new Set<string>()
    const walk = (x: BrushPreset): void => {
      if (x.tipTexture) ids.add(x.tipTexture)
      if (x.grain.texture) ids.add(x.grain.texture)
      if (x.dual.brush) walk(x.dual.brush)
    }
    walk(b)
    return [...ids].map((id) => ({ id, tex: getTextureDef(id)! })).filter((t) => t.tex)
  }
}

export const library = new BrushLibrary()
