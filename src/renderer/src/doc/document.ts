import { Emitter } from '../core/events'
import { unionRect } from '../core/geometry'
import { TILE, intRect, regionPieces, tileKey as tileKeyOf, unionBounds } from '../core/tiles'
import type { Rect } from '../core/types'
import { UndoStack } from '../core/undo'
import type { Command } from '../core/undo'
import { GPU, PixFormat, Surface } from '../gl/gpu'
import { historyLabel, t } from '../i18n'
import { Layer, LayerProps } from './layer'
import { childrenOf, descendantsOf, isDescendant, maxLayersFor, moveRelative, normalizeOrder } from './layerTree'
import { cloneInfMask, newInfMask } from './maskStore'
import { PixelEdit } from './pixelEdit'
import { TileStore } from './tileStore'
import { tileMemory } from './tileMemory'
import { dropArchive } from '../io/asyncSave'
import { DEFAULT_LANGS, LangDef, validLang } from '../features/langvariants/model'

export type CommitType =
  | 'new'
  | 'load'
  | 'stroke'
  | 'erase'
  | 'smudge'
  | 'filter'
  | 'clear'
  | 'selection'
  | 'frame'
  | 'transform'
  | 'fill'
  | 'layer-add'
  | 'layer-delete'
  | 'layer-duplicate'
  | 'layer-reorder'
  | 'layer-props'
  | 'layer-group'
  | 'layer-mask'
  | 'layer-merge'
  | 'layer-flatten'
  | 'layer-fill'
  | 'layer-invert'
  | 'layer-paste'
  | 'undo'
  | 'redo'

/**
 * Emitted on `doc.events` ('commit') for EVERY committed operation - the hook the timelapse
 * recorder (and anything else that needs "the document changed for real") listens to.
 */
export interface CommitEvent {
  type: CommitType
  layerId: string | null
  /** all layers the operation touched (multi-layer transactions), when known */
  layerIds?: string[]
  /** Document-space pixel rect that changed; null for non-pixel changes (props, order, ...). */
  dirtyRect: Rect | null
  label: string
  /** monotonically increasing per document */
  seq: number
  /** performance.now() */
  time: number
}

export interface DocEvents {
  commit: CommitEvent
  /** Visual change; rect = affected document region (null = everything). Triggers redraw. */
  change: { rect: Rect | null }
  /** Layer list / active layer / layer props changed. */
  layers: void
  /** Undo stack changed. */
  history: void
  /** The view language, the language list or the ghost switch changed (NOT a commit, not an undo step). */
  lang: void
}

/** 'fixed' = classic bounded canvas (pixels in one surface per layer); 'infinite' = unbounded canvas, pixels in sparse tiles (docs/INFINITE_CANVAS.md). */
export type DocKind = 'fixed' | 'infinite'

/** Nominal "frame" of an infinite document (legacy width/height consumers see this; nothing is clipped to it). */
export const INF_FRAME = 4096

export interface DocOptions {
  kind?: DocKind
  format?: PixFormat
  background?: { color: [number, number, number]; visible: boolean }
}

/** 16-bit float layers give banding-free soft brushes; fall back to 8-bit for very large canvases. */
export function chooseFormat(w: number, h: number, gpu: GPU): PixFormat {
  return gpu.half && w * h <= 6_000_000 ? 'rgba16f' : 'rgba8'
}

/** Thrown by layer-creating operations when the canvas-size based layer limit is reached. */
export class LayerLimitError extends Error {
  constructor(readonly max: number) {
    super()
    this.name = 'LayerLimitError'
  }
}

interface LayerSnap {
  order: Layer[]
  props: Map<Layer, LayerProps>
  masks: Map<Layer, Surface | null>
  active: string
}

let idCounter = 0

export class Document {
  readonly events = new Emitter<DocEvents>()
  readonly history = new UndoStack()
  layers: Layer[] = [] // bottom -> top
  activeId = ''
  /** extra multi-selected layer ids besides the active one (Ctrl/Shift+click, swipe-select) */
  layerSel = new Set<string>()
  private txn: Command[] | null = null
  /** how many undo steps reference a Layer / mask Surface (see structural()) */
  private refs = new Map<object, number>()
  private unref(o: object): boolean {
    const n = (this.refs.get(o) ?? 1) - 1
    if (n <= 0) this.refs.delete(o)
    else this.refs.set(o, n)
    return n <= 0
  }
  background: { color: [number, number, number]; visible: boolean }
  readonly format: PixFormat
  /** canvas-sized scratch in layer format (commit + smudge source) */
  readonly scratch: Surface
  /** tile-sized scratch used by undo swaps */
  readonly tileScratch: Surface
  name = t('core.common.untitled')
  /** document kind (see DocKind) */
  readonly kind: DocKind
  get isInfinite(): boolean {
    return this.kind === 'infinite'
  }
  /** infinite canvas view state persisted in the .bwk (dot grid, last view) */
  infinite: { grid: boolean; view?: { cx: number; cy: number; zoom: number } } = { grid: false }
  private seq = 0
  /** number of commit events so far (crash journal sequence) */
  get commitSeq(): number {
    return this.seq
  }
  /** continue the sequence of a document that was loaded from disk */
  resumeSeq(n: number): void {
    if (n > this.seq) this.seq = n
  }

  constructor(
    readonly gpu: GPU,
    readonly width: number,
    readonly height: number,
    opts: DocOptions = {}
  ) {
    this.kind = opts.kind ?? 'fixed'
    if (this.kind === 'fixed' && (width > gpu.maxTexture || height > gpu.maxTexture)) throw new Error(`Canvas exceeds GPU limit ${gpu.maxTexture}px`)
    // infinite canvases are unbounded, so layer tiles are always 8-bit (the policy for canvases above 6 Mpx); strokes still use 16F buffers
    this.format = this.kind === 'infinite' ? 'rgba8' : (opts.format ?? chooseFormat(width, height, gpu))
    this.background = opts.background ?? { color: [1, 1, 1], visible: true }
    // infinite: the full-canvas scratch is replaced by a 1x1 placeholder (smudge assembles its own region scratch)
    this.scratch = this.kind === 'infinite' ? gpu.surface(1, 1, this.format, 0) : gpu.surface(width, height, this.format)
    this.tileScratch = this.kind === 'infinite' ? gpu.surface(TILE, TILE, this.format, 0) : gpu.surface(256, 256, this.format, 0)
    this.history.onChange = () => this.events.emit('history', undefined)
  }

  static create(gpu: GPU, w: number, h: number, opts: DocOptions = {}): Document {
    if (opts.kind === 'infinite') {
      w = INF_FRAME
      h = INF_FRAME
    }
    const d = new Document(gpu, w, h, opts)
    const l = d.createLayer({ name: t('core.doc.layerN', { n: 1 }) })
    d.layers.push(l)
    d.activeId = l.id
    d.emitCommit('new', null, null, 'New document')
    return d
  }

  // ------------------------------------------------------------ helpers
  newId(): string {
    return 'L' + ++idCounter + '_' + Math.random().toString(36).slice(2, 6)
  }
  createLayer(props: Partial<LayerProps> = {}, id?: string): Layer {
    // groups own no pixels: a 1x1 placeholder keeps layer.surface non-null for legacy consumers
    const flat = props.isGroup || this.kind === 'infinite'
    const surf = flat ? this.gpu.surface(1, 1, 'rgba8') : this.gpu.surface(this.width, this.height, this.format)
    const layer = new Layer(id ?? this.newId(), surf, props)
    if (this.kind === 'infinite' && !props.isGroup) {
      layer.tiles = new TileStore(this.gpu, this.format)
      tileMemory.register(layer.tiles, this.scratchId)
    }
    return layer
  }
  getLayer(id: string): Layer | undefined {
    return this.layers.find((l) => l.id === id)
  }
  /**
   * The layer tools act on. A language layer (group) resolves to its cell of the VIEW language (the group itself while that cell does not
   * exist yet - writers call writableActive()); a cell of another language resolves to the cell of the view language.
   */
  get activeLayer(): Layer {
    const l = this.getLayer(this.activeId) ?? this.layers[this.layers.length - 1]
    return l && (l.langSet || l.lang) ? this.resolveCell(l) : l
  }
  /** The active layer for WRITING: creates the missing cell of the view language of the active language layer (one undo step). */
  writableActive(): Layer {
    const l = this.activeLayer
    if (!l?.langSet) return l
    return this.ensureCell(l, this.viewLang)
  }
  layerIndex(id: string): number {
    return this.layers.findIndex((l) => l.id === id)
  }

  emitCommit(type: CommitType, layerId: string | null, dirtyRect: Rect | null, label: string, layerIds?: string[]): void {
    if (dirtyRect) for (const id of layerIds ?? (layerId ? [layerId] : [])) if (this.getLayer(id)?.lang) this.painted.add(id) // fixed canvases: this language cell now has pixels
    this.events.emit('commit', { type, layerId, ...(layerIds ? { layerIds } : {}), dirtyRect, label: historyLabel(label), seq: ++this.seq, time: performance.now() })
    this.events.emit('change', { rect: dirtyRect })
  }
  private layersChanged(): void {
    this.events.emit('layers', undefined)
  }

  /** Begin a tile-snapshot edit on a layer (used by brush engine & filters). */
  beginPixelEdit(layer: Layer, label: string): PixelEdit {
    return new PixelEdit(this, layer, label)
  }

  private record(cmd: Command, type: CommitType): void {
    this.pushCommand(cmd)
    if (this.txn) return
    this.emitCommit(type, cmd.layerId ?? null, cmd.dirtyRect ?? null, cmd.label)
    this.layersChanged()
  }

  // ------------------------------------------------------------ layer tree queries
  /** Max number of pixel layers for this canvas size (groups are free). Shown in Canvas Information. */
  get maxLayers(): number {
    return maxLayersFor(this.width, this.height, this.format === 'rgba16f' ? 8 : 4)
  }
  /** number of layers that own pixels (groups excluded) */
  get paintLayerCount(): number {
    let n = 0
    for (const l of this.layers) if (!l.isGroup) n++
    return n
  }
  /** The layer flagged as sampling reference (ColorDrop / Automatic selection), if any. */
  get referenceLayer(): Layer | null {
    return this.layers.find((l) => l.reference && !l.isGroup) ?? null
  }
  childrenOf(parentId: string | null): Layer[] {
    return childrenOf(this.layers, parentId)
  }
  descendantsOf(id: string): Layer[] {
    return descendantsOf(this.layers, id)
  }
  /** All layers that own pixels (no groups), bottom -> top. Prefer this over `layers` for pixel work. */
  get paintLayers(): Layer[] {
    return this.layers.filter((l) => !l.isGroup)
  }
  /** true when the layer or one of its ancestor groups is hidden */
  isEffectivelyVisible(l: Layer): boolean {
    let cur: Layer | undefined = l
    let guard = 0
    while (cur && guard++ < 64) {
      if (!cur.visible) return false
      if (cur.lang && cur.lang !== this.viewLang) return false
      cur = cur.parentId ? this.getLayer(cur.parentId) : undefined
    }
    return true
  }
  /** Multi-selected layer ids (always includes the active one), bottom -> top. */
  selectedLayerIds(): string[] {
    return this.layers.filter((l) => l.id === this.activeId || this.layerSel.has(l.id)).map((l) => l.id)
  }
  setLayerSelection(ids: Iterable<string>): void {
    this.layerSel = new Set([...ids].filter((i) => this.getLayer(i)))
    this.layersChanged()
  }
  private assertRoom(n: number): void {
    if (this.paintLayerCount + n > this.maxLayers) throw new LayerLimitError(this.maxLayers)
  }
  /** New empty mask surface filled white (everything visible) or black (everything hidden). */
  createMaskSurface(white = true): Surface {
    if (this.kind === 'infinite') return newInfMask(this.gpu, this.format, white ? 1 : 0)
    const s = this.gpu.surface(this.width, this.height, this.format)
    const gl = this.gpu.gl
    this.gpu.bindTarget(s, null)
    const v = white ? 1 : 0
    gl.clearColor(v, v, v, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.clearColor(0, 0, 0, 0)
    return s
  }

  // ------------------------------------------------------------ language variants (features/langvariants, docs/LANGUAGE_VARIANTS.md)
  /** language list of the document (2-4 entries) */
  langs: LangDef[] = DEFAULT_LANGS.map((l) => ({ ...l }))
  /** language shown on the canvas: per document, saved, NOT a commit and not an undo step */
  viewLang = 'en'
  /** display-only: cells of the other languages at 25 % (never in recordings, exports, eyedropper, fills, smart selection) */
  langGhost = false
  /** the feature is active exactly when the document has a language layer */
  get hasLangLayers(): boolean {
    return this.layers.some((l) => l.langSet)
  }
  langSets(): Layer[] {
    return this.layers.filter((l) => l.langSet)
  }
  cellOf(groupId: string, lang: string): Layer | undefined {
    return this.layers.find((l) => l.parentId === groupId && l.lang === lang && !l.isGroup)
  }
  cellsOf(groupId: string): Layer[] {
    return this.layers.filter((l) => l.parentId === groupId && !!l.lang && !l.isGroup)
  }
  /** the language of a paint layer that is a language cell, else null */
  cellLang(id: string): string | null {
    const l = this.getLayer(id)
    return l && l.lang && !l.isGroup ? l.lang : null
  }
  /** the language layer group a layer belongs to (itself when it is one), else undefined */
  langSetOf(l: Layer | undefined): Layer | undefined {
    if (!l) return undefined
    if (l.langSet) return l
    return l.lang && l.parentId ? this.getLayer(l.parentId) : undefined
  }
  private resolveCell(l: Layer): Layer {
    const g = this.langSetOf(l)
    if (!g) return l
    return this.cellOf(g.id, this.viewLang) ?? g
  }
  /** Does this language cell have pixels? (fixed canvases: any cell that was ever painted on counts) */
  cellHasContent(c: Layer, rect?: Rect | null): boolean {
    if (c.tiles) {
      const b = c.tiles.bounds()
      if (!b) return false
      if (!rect) return true
      return b.x < rect.x + rect.w && b.x + b.w > rect.x && b.y < rect.y + rect.h && b.y + b.h > rect.y
    }
    return this.painted.has(c.id)
  }
  /** fixed canvases: cells that received pixels (conservative, never reset by erasing; loaded cells count as painted) */
  readonly painted = new Set<string>()
  /** Does ANY visible cell of language `lang` have pixels (in `rect`)? */
  langHasContent(lang: string, rect?: Rect | null): boolean {
    for (const g of this.langSets()) {
      if (!this.isEffectivelyVisibleIn(g, lang)) continue
      const c = this.cellOf(g.id, lang)
      if (c && c.visible && this.cellHasContent(c, rect)) return true
    }
    return false
  }
  /** visibility of a layer / its ancestors ignoring the language of cells (language layers are tested per language by the caller) */
  private isEffectivelyVisibleIn(l: Layer, _lang: string): boolean {
    void _lang
    let cur: Layer | undefined = l
    let guard = 0
    while (cur && guard++ < 64) {
      if (!cur.visible) return false
      cur = cur.parentId ? this.getLayer(cur.parentId) : undefined
    }
    return true
  }
  /** Document rectangle a language switch can change (tile bounds of all cells; null = whole canvas / fixed). */
  langDirtyRect(): Rect | null {
    if (!this.isInfinite) return null
    let out: Rect | null = null
    for (const l of this.layers) if (l.lang && l.tiles) out = unionBounds(out, l.tiles.bounds())
    return out ?? { x: 0, y: 0, w: 1, h: 1 }
  }
  setViewLang(code: string): void {
    const c = validLang(this.langs, code)
    if (c === this.viewLang) return
    this.viewLang = c
    this.events.emit('lang', undefined)
    this.layersChanged()
    this.events.emit('change', { rect: this.langDirtyRect() })
  }
  /** Run `fn` as if `lang` were the view language, WITHOUT events (exports of another language: bounds, visibility). */
  withLang<T>(lang: string, fn: () => T): T {
    const prev = this.viewLang
    this.viewLang = validLang(this.langs, lang)
    try {
      return fn()
    } finally {
      this.viewLang = prev
    }
  }
  setLangGhost(on: boolean): void {
    if (on === this.langGhost) return
    this.langGhost = on
    this.events.emit('lang', undefined)
    this.events.emit('change', { rect: this.langDirtyRect() })
  }
  /** Create the (empty) cell of `lang` inside a language layer, as one undo step. */
  ensureCell(group: Layer, lang: string): Layer {
    const have = this.cellOf(group.id, lang)
    if (have) return have
    this.assertRoom(1)
    const cell = this.createLayer({ name: `${group.name} [${lang.toUpperCase()}]`, lang, parentId: group.id, locked: group.locked, alphaLock: group.alphaLock })
    try {
      const keep = this.activeId
      const before = this.history.pushes
      this.structural('Add language cell', 'layer-add', cell.id, () => {
        this.layers.push(cell)
        this.applyMove(cell.id, group.id, 'into')
        this.layers.splice(0, this.layers.length, ...normalizeOrder(this.layers))
        this.activeId = keep // the row stays selected
      })
      // the implicit creation of a cell is not a step the user can see: undo / redo take it together with the stroke that needed it
      if (this.history.pushes > before && this.history.top) this.cellSteps.add(this.history.top)
    } catch (e) {
      cell.dispose()
      throw e
    }
    return cell
  }
  /**
   * Replace the language list as ONE undo step (2-4 languages). Cells of removed languages are deleted with it; the view language falls back
   * to the first language when its own was removed.
   */
  editLangs(next: LangDef[], label = 'Edit languages'): void {
    const before = this.langs.map((l) => ({ ...l }))
    const after = next.map((l) => ({ ...l }))
    const viewBefore = this.viewLang
    const viewAfter = validLang(after, viewBefore)
    const removed = new Set(before.filter((l) => !after.some((n) => n.code === l.code)).map((l) => l.code))
    this.transaction(label, 'layer-props', null, () => {
      const cells = this.layers.filter((l) => l.lang && removed.has(l.lang))
      if (cells.length) {
        const gone = new Set(cells)
        const remaining = this.layers.filter((l) => !gone.has(l))
        const fresh = remaining.some((l) => !l.isGroup) ? null : this.createLayer({ name: t('core.doc.layerN', { n: 1 }) })
        this.structural('Delete language cells', 'layer-delete', null, () => {
          this.layers.splice(0, this.layers.length, ...remaining)
          if (fresh) this.layers.push(fresh)
          if (!this.getLayer(this.activeId)) this.activeId = this.layers[this.layers.length - 1]?.id ?? ''
          this.layerSel.clear()
        })
      }
      const apply = (langs: LangDef[], view: string): void => {
        this.langs = langs.map((l) => ({ ...l }))
        this.viewLang = view
        this.events.emit('lang', undefined)
        this.events.emit('change', { rect: this.langDirtyRect() })
      }
      apply(after, viewAfter)
      this.pushCommand({ label, layerId: null, bytes: 0, undo: () => apply(before, viewBefore), redo: () => apply(after, viewAfter) })
    })
  }

  // ------------------------------------------------------------ structural undo machinery
  private snapshot(): LayerSnap {
    const props = new Map<Layer, LayerProps>()
    const masks = new Map<Layer, Surface | null>()
    for (const l of this.layers) {
      props.set(l, l.props)
      masks.set(l, l.mask)
    }
    return { order: this.layers.slice(), props, masks, active: this.activeId }
  }
  private restore(s: LayerSnap): void {
    this.layers.splice(0, this.layers.length, ...s.order)
    for (const l of this.layers) {
      Object.assign(l, s.props.get(l))
      l.mask = s.masks.get(l) ?? null
      if (!l.mask) l.editingMask = false
    }
    this.activeId = this.getLayer(s.active) ? s.active : this.layers[this.layers.length - 1]?.id ?? ''
    this.layerSel = new Set([...this.layerSel].filter((i) => this.getLayer(i)))
  }

  /** Route a command to history, or into the running transaction. */
  pushCommand(cmd: Command): void {
    if (this.txn) this.txn.push(cmd)
    else this.history.push(cmd)
  }

  /**
   * Run `fn` and record everything it pushes (pixel edits, structural changes) as ONE undo step
   * with ONE commit event. Nested calls join the outer transaction.
   */
  transaction<T>(label: string, type: CommitType, layerId: string | null, fn: () => T): T {
    if (this.txn) return fn()
    this.txn = []
    let result: T
    try {
      result = fn()
    } catch (e) {
      const parts = this.txn
      this.txn = null
      for (const c of parts.reverse()) c.undo() // roll back what already happened
      for (const c of parts) c.dispose?.()
      throw e
    }
    const parts = this.txn
    this.txn = null
    if (!parts.length) return result
    let dirty: Rect | null = null
    for (const c of parts) if (c.dirtyRect) dirty = dirty ? unionRect(dirty, c.dirtyRect) : c.dirtyRect
    const ids = [...new Set(parts.flatMap((c) => c.layerIds ?? (c.layerId ? [c.layerId] : [])))]
    if (parts.some((c) => !c.layerIds && !c.layerId)) ids.length = 0 // a part without a layer (props, background...) can touch anything
    else if (layerId && ids.length && !ids.includes(layerId)) ids.push(layerId)
    this.history.push({
      label,
      layerId,
      ...(ids.length ? { layerIds: ids } : {}),
      dirtyRect: dirty,
      bytes: parts.reduce((a, c) => a + c.bytes, 0),
      undo: () => {
        for (let i = parts.length - 1; i >= 0; i--) parts[i].undo()
        this.layersChanged()
      },
      redo: () => {
        for (const c of parts) c.redo()
        this.layersChanged()
      },
      dispose: () => parts.forEach((c) => c.dispose?.())
    })
    this.emitCommit(type, layerId, dirty, label, ids.length ? ids : undefined)
    this.layersChanged()
    return result
  }

  /**
   * Run a mutation of the layer list / layer props / masks and record it as an undoable step.
   * Layers and masks that end up unreachable are freed when the step leaves the undo stack.
   */
  structural(label: string, type: CommitType, layerId: string | null, mutate: () => void): void {
    const before = this.snapshot()
    mutate()
    const after = this.snapshot()
    const all = new Set<Layer>([...before.order, ...after.order])
    const masks = new Set<Surface>()
    for (const m of [...before.masks.values(), ...after.masks.values()]) if (m) masks.add(m)
    let bytes = 0
    for (const l of all) if (!before.order.includes(l) || !after.order.includes(l)) bytes += l.pixelBytes
    for (const m of masks) {
      const inB = [...before.masks.values()].includes(m)
      const inA = [...after.masks.values()].includes(m)
      if (inB !== inA) bytes += m.bytes
    }
    const cmd: Command = {
      label,
      layerId,
      bytes,
      undo: () => {
        this.restore(before)
        this.layersChanged()
      },
      redo: () => {
        this.restore(after)
        this.layersChanged()
      },
      dispose: () => {
        // free only what no other undo step still references and the document does not show
        const live = new Set(this.layers.map((l) => l.mask))
        for (const l of all) if (this.unref(l) && !this.layers.includes(l)) l.pixels.dispose()
        for (const m of masks) if (this.unref(m) && !live.has(m)) m.dispose()
      }
    }
    for (const o of [...all, ...masks]) this.refs.set(o, (this.refs.get(o) ?? 0) + 1)
    this.pushCommand(cmd)
    if (!this.txn) {
      this.emitCommit(type, layerId, null, label)
      this.layersChanged()
    }
  }

  // ------------------------------------------------------------ layer operations
  /**
   * Insert an existing (already painted) layer. `ref` positions it relative to another layer;
   * omitted = top of the root. Becomes the active layer. Undoable; throws LayerLimitError.
   */
  insertLayer(layer: Layer, ref: { id: string; where: 'above' | 'below' | 'into' } | null, label = 'Add layer', type: CommitType = 'layer-add'): Layer {
    if (!layer.isGroup) this.assertRoom(1)
    this.structural(label, type, layer.id, () => {
      layer.parentId = null
      this.layers.push(layer)
      if (ref && this.getLayer(ref.id)) this.applyMove(layer.id, ref.id, ref.where)
      this.layers.splice(0, this.layers.length, ...normalizeOrder(this.layers))
      this.activeId = layer.id
      this.layerSel.clear()
    })
    return layer
  }

  private applyMove(id: string, refId: string, where: 'above' | 'below' | 'into'): boolean {
    const r = moveRelative(this.layers, id, refId, where)
    if (!r) return false
    this.layers.splice(0, this.layers.length, ...r.order)
    return true
  }

  addLayer(props: Partial<LayerProps> = {}, aboveActive = true): Layer {
    const layer = this.createLayer({ name: t('core.doc.layerN', { n: this.paintLayerCount + 1 }), ...props, parentId: null })
    let ref: { id: string; where: 'above' | 'into' } | null = null
    if (props.parentId && this.getLayer(props.parentId)?.isGroup) ref = { id: props.parentId, where: 'into' }
    else if (aboveActive && this.getLayer(this.activeId)) ref = { id: this.activeId, where: 'above' }
    try {
      return this.insertLayer(layer, ref)
    } catch (e) {
      layer.dispose()
      throw e
    }
  }

  deleteLayer(id: string): void {
    const layer = this.getLayer(id)
    if (!layer) return
    const block = new Set([...this.descendantsOf(id), layer])
    const remaining = this.layers.filter((l) => !block.has(l))
    if (!layer.isGroup && this.layers.length === 1) {
      this.clearLayer(id)
      return
    }
    const startIdx = Math.min(...[...block].map((l) => this.layers.indexOf(l)))
    const needFresh = !remaining.some((l) => !l.isGroup)
    const fresh = needFresh ? this.createLayer({ name: t('core.doc.layerN', { n: 1 }) }) : null
    this.structural(layer.isGroup ? 'Delete group' : 'Delete layer', 'layer-delete', id, () => {
      this.layers.splice(0, this.layers.length, ...remaining)
      if (fresh) this.layers.push(fresh)
      if (!this.getLayer(this.activeId)) {
        const next = fresh ?? remaining[Math.max(0, Math.min(startIdx - 1, remaining.length - 1))] ?? this.layers[this.layers.length - 1]
        this.activeId = next.id
      }
      this.layerSel.clear()
    })
  }

  duplicateLayer(id: string): Layer | null {
    const src = this.getLayer(id)
    if (!src) return null
    const block = [...this.descendantsOf(id), src]
    this.assertRoom(block.filter((l) => !l.isGroup).length)
    const map = new Map<string, Layer>()
    const made: Layer[] = []
    try {
      for (const o of block) {
        const nl = this.createLayer({ ...o.props, name: o === src ? o.name + t('core.doc.copySuffix') : o.name, reference: false })
        if (!o.isGroup && o.tiles) {
          nl.tiles?.dispose()
          nl.tiles = o.tiles.clone()
          tileMemory.register(nl.tiles, this.scratchId)
          if (o.mask?.inf) nl.mask = cloneInfMask(this.gpu, o.mask)
        } else if (!o.isGroup) {
          const full = { x: 0, y: 0, w: this.width, h: this.height }
          this.gpu.blit(o.pixels, full, nl.pixels, 0, 0)
          if (o.mask) {
            nl.mask = this.gpu.surface(this.width, this.height, this.format)
            this.gpu.blit(o.mask, full, nl.mask, 0, 0)
          }
        }
        map.set(o.id, nl)
        made.push(nl)
      }
    } catch (e) {
      made.forEach((l) => l.dispose())
      throw e
    }
    const root = map.get(src.id)!
    this.structural(src.isGroup ? 'Duplicate group' : 'Duplicate layer', 'layer-duplicate', root.id, () => {
      for (const o of block) {
        const nl = map.get(o.id)!
        nl.parentId = o === src ? src.parentId : (map.get(o.parentId ?? '')?.id ?? null)
        this.layers.push(nl)
      }
      this.applyMove(root.id, src.id, 'above')
      this.layers.splice(0, this.layers.length, ...normalizeOrder(this.layers))
      this.activeId = root.id
      this.layerSel.clear()
    })
    return root
  }

  clearLayer(id: string): void {
    const layer = this.getLayer(id)
    if (!layer || layer.locked || layer.isGroup) return
    if (layer.tiles) {
      const keys = [...layer.tiles.keys()]
      if (!keys.length) return
      const e = this.beginPixelEdit(layer, 'Clear layer')
      for (const k of keys) e.removeKey(k)
      this.emitCommit('clear', id, e.finish(), 'Clear layer')
      return
    }
    const full = { x: 0, y: 0, w: this.width, h: this.height }
    const edit = this.beginPixelEdit(layer, 'Clear layer')
    edit.save(full)
    this.gpu.clear(layer.surface)
    const dirty = edit.finish()
    this.emitCommit('clear', id, dirty, 'Clear layer')
  }

  /** Legacy flat-index move (kept for old callers): places the layer where `newIndex` currently is. */
  moveLayer(id: string, newIndex: number): void {
    const from = this.layerIndex(id)
    if (from < 0) return
    newIndex = Math.max(0, Math.min(this.layers.length - 1, newIndex))
    if (newIndex === from) return
    const target = this.layers[newIndex]
    this.moveLayerRelative(id, target.id, newIndex > from ? 'above' : 'below')
  }

  /** Move a layer/group (with its subtree) next to or into another. Returns false if illegal. */
  moveLayerRelative(id: string, refId: string, where: 'above' | 'below' | 'into'): boolean {
    if (!moveRelative(this.layers.map((l) => ({ id: l.id, parentId: l.parentId, isGroup: l.isGroup, langSet: l.langSet, lang: l.lang })), id, refId, where)) return false
    this.structural('Reorder layer', 'layer-reorder', id, () => {
      this.applyMove(id, refId, where)
    })
    return true
  }

  /** Put the given layers into a new group (placed above the top-most one). */
  groupLayers(ids: string[], name = t('core.doc.group')): Layer | null {
    const sel = new Set(ids)
    const roots = this.layers.filter((l) => sel.has(l.id) && !this.layers.some((g) => sel.has(g.id) && g !== l && isDescendant(this.layers, l.id, g.id)))
    if (!roots.length) return null
    const top = roots[roots.length - 1]
    const group = this.createLayer({ name, isGroup: true, passThrough: true })
    this.structural('Group layers', 'layer-group', group.id, () => {
      group.parentId = null
      this.layers.push(group)
      this.applyMove(group.id, top.id, 'above')
      for (const r of roots) this.applyMove(r.id, group.id, 'into')
      this.layers.splice(0, this.layers.length, ...normalizeOrder(this.layers))
      this.activeId = group.id
      this.layerSel.clear()
    })
    return group
  }

  /** Dissolve a group; its children take its place. */
  ungroup(id: string): void {
    const g = this.getLayer(id)
    if (!g || !g.isGroup) return
    const kids = this.childrenOf(id)
    this.structural('Ungroup', 'layer-group', id, () => {
      for (const k of kids) k.parentId = g.parentId
      const i = this.layers.indexOf(g)
      this.layers.splice(i, 1)
      this.layers.splice(0, this.layers.length, ...normalizeOrder(this.layers))
      this.activeId = kids[kids.length - 1]?.id ?? this.layers[Math.max(0, i - 1)]?.id ?? ''
      this.layerSel.clear()
    })
  }

  /**
   * Remove `remove` from the document and (optionally) put `add` just above `nearId`, as one undo step.
   * Used by merge / flatten / merge-group. Removed layers stay alive until the step leaves the undo stack.
   */
  replaceLayers(remove: Layer[], add: Layer | null, nearId: string | null, active: string | null, label: string, type: CommitType): void {
    this.structural(label, type, add?.id ?? active, () => {
      if (add) {
        add.parentId = nearId ? (this.getLayer(nearId)?.parentId ?? null) : null
        this.layers.push(add)
        if (nearId && this.getLayer(nearId)) this.applyMove(add.id, nearId, 'above')
      }
      const rm = new Set(remove)
      this.layers.splice(0, this.layers.length, ...this.layers.filter((l) => !rm.has(l)))
      this.layers.splice(0, this.layers.length, ...normalizeOrder(this.layers))
      this.activeId = add?.id ?? (active && this.getLayer(active) ? active : (this.layers[this.layers.length - 1]?.id ?? ''))
      this.layerSel.clear()
    })
  }

  /** Attach / replace / remove (null) a layer mask as one undo step. */
  setMask(id: string, mask: Surface | null, label = mask ? 'Add mask' : 'Delete mask'): void {
    const l = this.getLayer(id)
    if (!l) return
    this.structural(label, 'layer-mask', id, () => {
      l.mask = mask
      l.editingMask = !!mask
      l.maskEnabled = true
      l.maskView = false
    })
  }
  addMask(id: string, white = true): void {
    const l = this.getLayer(id)
    if (!l || l.mask) return
    this.setMask(id, this.createMaskSurface(white))
  }
  removeMask(id: string): void {
    if (this.getLayer(id)?.mask) this.setMask(id, null)
  }

  /** Make `id` the (single) reference layer, or clear the flag. */
  setReference(id: string, on: boolean): void {
    this.structural(on ? 'Set reference' : 'Clear reference', 'layer-props', id, () => {
      for (const l of this.layers) l.reference = on && l.id === id
    })
  }

  /** Undoable change of the background colour / visibility. */
  setBackground(color: [number, number, number], visible: boolean): void {
    const before = { color: [...this.background.color] as [number, number, number], visible: this.background.visible }
    const after = { color: [...color] as [number, number, number], visible }
    if (before.visible === after.visible && before.color.every((v, i) => v === after.color[i])) return
    this.background = after
    const apply = (b: typeof before): void => {
      this.background = { color: [...b.color] as [number, number, number], visible: b.visible }
      this.events.emit('change', { rect: null })
    }
    this.record(
      {
        label: t('core.doc.background'),
        layerId: null,
        bytes: 0,
        undo: () => apply(before),
        redo: () => apply(after)
      },
      'layer-props'
    )
  }

  setActive(id: string): void {
    if (this.getLayer(id) && (this.activeId !== id || this.layerSel.size)) {
      this.activeId = id
      this.layerSel.clear()
      this.layersChanged()
    }
  }

  /** Change props without recording history (live slider drag). Call recordPropChange after. */
  setLayerPropsLive(id: string, patch: Partial<LayerProps>): void {
    const l = this.getLayer(id)
    if (!l) return
    if (l.isGroup && 'clipping' in patch) delete patch.clipping
    Object.assign(l, patch)
    this.events.emit('change', { rect: null })
    this.layersChanged()
  }

  /** Record an undo step for a prop change from `before` to the layer's current props. */
  recordPropChange(id: string, before: LayerProps): void {
    const l = this.getLayer(id)
    if (!l) return
    const after = l.props
    if (JSON.stringify(before) === JSON.stringify(after)) return
    this.record(
      {
        label: t('core.doc.layerProperties'),
        layerId: id,
        bytes: 0,
        undo: () => {
          Object.assign(l, before)
          this.layersChanged()
        },
        redo: () => {
          Object.assign(l, after)
          this.layersChanged()
        }
      },
      'layer-props'
    )
  }

  setLayerProps(id: string, patch: Partial<LayerProps>): void {
    const l = this.getLayer(id)
    if (!l) return
    if (patch.reference === true && !l.reference) {
      const { reference: _r, ...rest } = patch
      void _r
      this.setReference(id, true)
      if (Object.keys(rest).length) this.setLayerProps(id, rest)
      return
    }
    const before = l.props
    this.setLayerPropsLive(id, patch)
    this.recordPropChange(id, before)
  }

  // ------------------------------------------------------------ region API (works on fixed AND infinite documents)
  private assertRegion(r: Rect): void {
    const max = this.gpu.maxTexture
    if (r.w < 1 || r.h < 1 || r.w > max || r.h > max) throw new RangeError(`Region ${r.w}x${r.h} is empty or exceeds the GPU limit ${max}px`)
  }

  /**
   * Copy the pixels of `rect` (document space, integers after rounding outwards) of a layer into a NEW surface of rect.w x rect.h
   * (layer format; row 0 = rect.y). Tiles that do not exist (or canvas area outside a fixed document) read as transparent.
   * The caller owns and must dispose the surface. This is the way legacy full-texture tools see an infinite layer.
   */
  readRegion(layer: Layer, rect: Rect): Surface {
    const r = intRect(rect)
    this.assertRegion(r)
    const gpu = this.gpu
    const out = gpu.surface(r.w, r.h, layer.tiles ? layer.tiles.fmt : layer.pixels.fmt, 0)
    if (layer.tiles) {
      for (const p of regionPieces(r)) {
        const t = layer.tiles.get(p.tx, p.ty)
        if (t) gpu.blit(t, { x: p.sx, y: p.sy, w: p.w, h: p.h }, out, p.dx, p.dy)
      }
    } else {
      const x0 = Math.max(0, r.x)
      const y0 = Math.max(0, r.y)
      const x1 = Math.min(layer.pixels.w, r.x + r.w)
      const y1 = Math.min(layer.pixels.h, r.y + r.h)
      if (x1 > x0 && y1 > y0) gpu.blit(layer.pixels, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, out, x0 - r.x, y0 - r.y)
    }
    return out
  }

  /**
   * Replace the pixels of `rect` of a layer with `src` (rect.w x rect.h, row 0 = rect.y) as ONE undo step with ONE commit event.
   * Infinite layers allocate tiles on demand and free tiles that end up fully transparent (both undoable). Fixed layers clip to the canvas.
   * Returns the dirty rect (null when nothing changed).
   */
  writeRegion(layer: Layer, rect: Rect, src: Surface, opts: { undoLabel?: string; type?: CommitType } = {}): Rect | null {
    const r = intRect(rect)
    if (src.w !== r.w || src.h !== r.h) throw new RangeError('writeRegion: source size does not match rect')
    const label = opts.undoLabel ?? 'Edit region'
    const gpu = this.gpu
    const edit = this.beginPixelEdit(layer, label)
    if (layer.tiles) {
      edit.save(r)
      const touched: number[] = []
      for (const p of regionPieces(r)) {
        const dst = layer.tiles.ensure(p.tx, p.ty)
        gpu.blit(src, { x: p.dx, y: p.dy, w: p.w, h: p.h }, dst, p.sx, p.sy)
        touched.push(tileKeyOf(p.tx, p.ty))
      }
      for (const k of layer.tiles.emptyAmong(touched)) edit.removeKey(k)
    } else {
      const x0 = Math.max(0, r.x)
      const y0 = Math.max(0, r.y)
      const x1 = Math.min(layer.surface.w, r.x + r.w)
      const y1 = Math.min(layer.surface.h, r.y + r.h)
      if (x1 <= x0 || y1 <= y0) return null
      edit.save({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
      gpu.blit(src, { x: x0 - r.x, y: y0 - r.y, w: x1 - x0, h: y1 - y0 }, layer.surface, x0, y0)
    }
    const dirty = edit.finish()
    if (dirty) this.emitCommit(opts.type ?? 'filter', layer.id, dirty, label)
    return dirty
  }

  /**
   * Let a full-texture tool work on a region exactly as on a fixed layer: the tiles under `rect` are assembled into one temporary
   * surface, `fn(surface, rect)` modifies it (e.g. via GPU passes), and the result is written back into the tiles as one undo step.
   */
  withRegion<T>(layer: Layer, rect: Rect, fn: (surface: Surface, rect: Rect) => T, opts: { undoLabel?: string; type?: CommitType } = {}): T {
    const r = intRect(rect)
    const s = this.readRegion(layer, r)
    try {
      const res = fn(s, r)
      this.writeRegion(layer, r, s, opts)
      return res
    } finally {
      s.dispose()
    }
  }

  /** Straight-alpha RGBA8 pixels of a layer region (row 0 = rect.y); eyedropper, export, tests. */
  readRegionPixels(layer: Layer, rect: Rect): Uint8ClampedArray {
    const s = this.readRegion(layer, rect)
    try {
      return this.gpu.readRGBA8(s, { x: 0, y: 0, w: s.w, h: s.h })
    } finally {
      s.dispose()
    }
  }

  /**
   * Bounding rect of the painted content of all (visible) paint layers: union of the non-empty tiles on infinite documents
   * (`tight`: exact pixel bounds, read back and cached per tile), the whole canvas on fixed ones. null = nothing painted.
   */
  contentBounds(opts: { tight?: boolean; visibleOnly?: boolean } = {}): Rect | null {
    if (this.kind === 'fixed') return { x: 0, y: 0, w: this.width, h: this.height }
    let out: Rect | null = null
    for (const l of this.layers) {
      if (l.isGroup || !l.tiles) continue
      if (opts.visibleOnly && !this.isEffectivelyVisible(l)) continue
      out = unionBounds(out, opts.tight ? l.tiles.tightBounds() : l.tiles.bounds())
    }
    return out
  }

  /** Pixel-tile statistics of an infinite document (Canvas Information, memory warnings). Fixed documents: zeros. */
  tileStats(): { tiles: number; bytes: number; gpu: number; cpu: number; disk: number; cpuBytes: number; diskBytes: number } {
    const stores: TileStore[] = []
    let tiles = 0
    let bytes = 0
    for (const l of this.layers) {
      if (!l.tiles) continue
      stores.push(l.tiles)
      tiles += l.tiles.count
      bytes += l.tiles.bytes
      if (l.maskTiles) {
        stores.push(l.maskTiles)
        bytes += l.maskTiles.bytes
      }
    }
    const m = tileMemory.stats(stores)
    return { tiles, bytes, gpu: m.gpuTiles, cpu: m.cpuTiles, disk: m.diskTiles, cpuBytes: m.cpuBytes, diskBytes: m.diskBytes }
  }

  // ------------------------------------------------------------ history
  /** history steps that only create an empty language cell (see ensureCell): never a step of their own for the user */
  private readonly cellSteps = new WeakSet<object>()
  undo(): boolean {
    if (!this.undoOne()) return false
    const top = this.history.top
    if (top && this.cellSteps.has(top)) this.undoOne() // the cell the undone stroke created: now empty, go on
    return true
  }
  redo(): boolean {
    const c = this.redoOne()
    if (c && this.cellSteps.has(c)) this.redoOne() // an invisible cell creation: redo the stroke that follows it too
    return !!c
  }
  private undoOne(): boolean {
    const c = this.history.undo()
    if (!c) return false
    this.emitCommit('undo', c.layerId ?? null, c.dirtyRect ?? null, c.label, c.layerIds)
    this.layersChanged()
    return true
  }
  private redoOne(): Command | null {
    const c = this.history.redo()
    if (!c) return null
    this.emitCommit('redo', c.layerId ?? null, c.dirtyRect ?? null, c.label, c.layerIds)
    this.layersChanged()
    return c
  }

  /** scratch-file directory id of this document (userData/scratch/<id>/) */
  readonly scratchId = 's' + Math.random().toString(36).slice(2, 10)
  /** true once dispose() ran: async work (autosave) must not touch the GPU surfaces any more */
  disposed = false
  dispose(): void {
    this.disposed = true
    this.history.clear()
    for (const l of this.layers) l.dispose()
    if (this.kind === 'infinite') tileMemory.dropDoc(this.scratchId)
    dropArchive(this)
    this.layers = []
    this.scratch.dispose()
    this.tileScratch.dispose()
  }
}
