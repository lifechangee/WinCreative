import type { Document } from '../../doc/document'
import type { GalleryApi } from '../../../../preload/gallery'
import { TILE, tileCount, tileKey, tilesIn } from '../../core/tiles'
import { encodeRect } from '../../io/asyncSave'
import { decodeImage, registerBwkExtension } from '../../io/bwk'

/**
 * Crash journal: every committed brush stroke appends its dirty-rect patch (straight RGBA8 PNG, read back through a
 * fenced pixel-pack buffer and encoded in a Worker) to <artwork>.jrn in the gallery folder. The .bwk manifest records
 * the artwork's journal generation + the commit sequence it contains; on the next launch entries with a higher
 * sequence are replayed onto the loaded document, so the last stroke survives kill -9 even inside the autosave
 * debounce. A successful save whose sequence covers the whole journal truncates it.
 *
 * File format: repeated [u32 headerLen][u32 dataLen][header JSON][png bytes].
 */
export interface JournalHeader {
  gen: string
  seq: number
  layer: string
  x: number
  y: number
  w: number
  h: number
}
interface State {
  id: string
  /** serialises file operations (append / truncate) */
  chain: Promise<void>
  /** highest sequence appended (or being appended) to the file */
  lastSeq: number
  pending: number
}

const meta = new WeakMap<Document, { gen: string; seq: number }>()
const genOf = (doc: Document): string => {
  let m = meta.get(doc)
  if (!m) meta.set(doc, (m = { gen: 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), seq: 0 }))
  return m.gen
}

// the manifest carries the journal position
registerBwkExtension({
  id: 'journal',
  save: (doc) => ({ extra: { gen: genOf(doc), seq: doc.commitSeq } }),
  load: (doc, extra) => {
    const e = extra as { gen?: unknown; seq?: unknown } | undefined
    if (e && typeof e.gen === 'string') {
      const seq = Number(e.seq) || 0
      meta.set(doc, { gen: e.gen, seq })
      doc.resumeSeq(seq)
    }
  }
})

export function packEntry(h: JournalHeader, png: Uint8Array): Uint8Array {
  const head = new TextEncoder().encode(JSON.stringify(h))
  const out = new Uint8Array(8 + head.length + png.length)
  const v = new DataView(out.buffer)
  v.setUint32(0, head.length, true)
  v.setUint32(4, png.length, true)
  out.set(head, 8)
  out.set(png, 8 + head.length)
  return out
}

export function parseEntries(buf: Uint8Array): { h: JournalHeader; png: Uint8Array }[] {
  const out: { h: JournalHeader; png: Uint8Array }[] = []
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let o = 0
  while (o + 8 <= buf.length) {
    const hl = v.getUint32(o, true)
    const dl = v.getUint32(o + 4, true)
    if (o + 8 + hl + dl > buf.length) break // torn tail write (process killed mid-append): ignore
    try {
      const h = JSON.parse(new TextDecoder().decode(buf.subarray(o + 8, o + 8 + hl))) as JournalHeader
      out.push({ h, png: buf.subarray(o + 8 + hl, o + 8 + hl + dl) })
    } catch {
      break
    }
    o += 8 + hl + dl
  }
  return out
}

export class Journal {
  private states = new WeakMap<Document, State>()
  /** journal patches larger than this fraction of the canvas fall back to a quick full save */
  static MAX_AREA = 0.25
  /** infinite canvas: a stroke touching more tiles than this falls back to a quick incremental save */
  static MAX_TILES = 48
  stats = { appended: 0, quickSaves: 0, bytes: 0 }

  constructor(
    private api: () => GalleryApi,
    /** ask the store for a fast (short debounce) autosave: the commit could not be journaled */
    private quickSave: (doc: Document) => void
  ) {}

  /** Start journaling `doc` (its .bwk for `id` exists on disk). Idempotent. */
  attach(doc: Document, id: string): () => void {
    if (this.states.has(doc)) return () => undefined
    const st: State = { id, chain: Promise.resolve(), lastSeq: 0, pending: 0 }
    this.states.set(doc, st)
    genOf(doc)
    return doc.events.on('commit', (e) => {
      if (e.type === 'new' || e.type === 'load') return
      this.onCommit(doc, st, e)
    })
  }

  detach(doc: Document): void {
    this.states.delete(doc)
  }

  private onCommit(doc: Document, st: State, e: { type: string; layerId: string | null; dirtyRect: { x: number; y: number; w: number; h: number } | null; seq: number }): void {
    const layer = e.layerId ? doc.getLayer(e.layerId) : undefined
    const r = e.dirtyRect
    const paintType = e.type === 'stroke' || e.type === 'erase' || e.type === 'smudge'
    if (layer?.tiles && paintType && r && tileCount(r) <= Journal.MAX_TILES) return this.onCommitTiles(doc, st, e, layer.id, layer.tiles, r)
    if (!paintType || !layer || layer.isGroup || layer.editingMask || !r || r.w * r.h > doc.width * doc.height * Journal.MAX_AREA) {
      this.stats.quickSaves++
      this.quickSave(doc)
      return
    }
    const x = Math.max(0, Math.floor(r.x))
    const y = Math.max(0, Math.floor(r.y))
    const w = Math.min(doc.width, Math.ceil(r.x + r.w)) - x
    const h = Math.min(doc.height, Math.ceil(r.y + r.h)) - y
    if (w < 1 || h < 1) return
    st.pending++
    st.lastSeq = Math.max(st.lastSeq, e.seq)
    const gen = genOf(doc)
    // the GPU readback is issued synchronously (in-order with the commit); only the file append is queued
    const png = encodeRect(doc.gpu, layer.pixels, x, y, w, h, () => {
      if (doc.disposed) throw new Error('document disposed')
    })
    const done = png.then(
      (bytes) => {
        st.chain = st.chain.then(async () => {
          try {
            const entry = packEntry({ gen, seq: e.seq, layer: layer.id, x, y, w, h }, bytes)
            await this.api().append(st.id + '.jrn', entry)
            this.stats.appended++
            this.stats.bytes += entry.length
          } catch (err) {
            console.error('[journal] append failed', err)
            this.quickSave(doc)
          }
        })
        return st.chain
      },
      (err) => {
        if (!doc.disposed) {
          console.error('[journal] patch failed', err)
          this.quickSave(doc)
        }
      }
    )
    void done.finally(() => void st.pending--)
  }

  /**
   * Infinite canvas: one patch per touched 512 px tile (header x,y = tile origin in document space, w = h = TILE). A tile that no longer
   * exists (erased, undone) is journaled as an empty PNG, which replay turns into "free this tile".
   */
  private onCommitTiles(doc: Document, st: State, e: { seq: number }, layerId: string, store: NonNullable<import('../../doc/layer').Layer['tiles']>, r: { x: number; y: number; w: number; h: number }): void {
    st.pending++
    st.lastSeq = Math.max(st.lastSeq, e.seq)
    const gen = genOf(doc)
    const check = (): void => {
      if (doc.disposed) throw new Error('document disposed')
    }
    // the GPU readbacks are issued synchronously (in-order with the commit); only the file appends are queued
    const jobs = tilesIn(r).map(({ tx, ty }) => {
      const s = store.get(tx, ty)
      const png = s ? encodeRect(doc.gpu, s, 0, 0, TILE, TILE, check) : Promise.resolve(new Uint8Array(0))
      return png.then((bytes) => packEntry({ gen, seq: e.seq, layer: layerId, x: tx * TILE, y: ty * TILE, w: TILE, h: TILE }, bytes))
    })
    const done = Promise.all(jobs).then(
      (entries) => {
        st.chain = st.chain.then(async () => {
          try {
            for (const entry of entries) {
              await this.api().append(st.id + '.jrn', entry)
              this.stats.appended++
              this.stats.bytes += entry.length
            }
          } catch (err) {
            console.error('[journal] append failed', err)
            this.quickSave(doc)
          }
        })
        return st.chain
      },
      (err) => {
        if (!doc.disposed) {
          console.error('[journal] patch failed', err)
          this.quickSave(doc)
        }
      }
    )
    void done.finally(() => void st.pending--)
  }

  /** Resolves when every queued patch is on disk (tests / before quit). */
  async drain(doc: Document): Promise<void> {
    const st = this.states.get(doc)
    if (!st) return
    for (let i = 0; i < 200 && st.pending > 0; i++) await new Promise((r) => setTimeout(r, 10))
    await st.chain
  }

  /** A save containing everything up to `seq` finished: the journal is obsolete unless newer entries exist. */
  saved(doc: Document, seq: number): void {
    const st = this.states.get(doc)
    if (!st) return
    if (st.lastSeq > seq || st.pending > 0) return
    st.chain = st.chain.then(() => this.api().truncate(st.id + '.jrn').then(() => undefined, () => undefined))
  }

  /**
   * Replay the journal of `id` onto a freshly loaded document. Returns the number of patches applied (0 = nothing
   * to recover). The caller must save the document right afterwards (which truncates the journal).
   */
  async replay(doc: Document, id: string): Promise<number> {
    let raw: Uint8Array | null = null
    try {
      raw = await this.api().read(id + '.jrn')
    } catch {
      raw = null
    }
    if (!raw || !raw.length) return 0
    const m = meta.get(doc)
    let applied = 0
    let maxSeq = 0
    if (m) {
      for (const en of parseEntries(raw)) {
        const h = en.h
        if (h.gen !== m.gen || h.seq <= m.seq) continue
        const layer = doc.getLayer(h.layer)
        if (!layer || layer.isGroup) continue
        try {
          if (layer.tiles) {
            const tx = Math.round(h.x / TILE)
            const ty = Math.round(h.y / TILE)
            if (!en.png.length) layer.tiles.free(tileKey(tx, ty))
            else {
              const img = await decodeImage(en.png)
              if (img.width !== TILE || img.height !== TILE) continue
              layer.tiles.upload(tx, ty, img.data)
            }
            applied++
            maxSeq = Math.max(maxSeq, h.seq)
            continue
          }
          const img = await decodeImage(en.png)
          if (img.width !== h.w || img.height !== h.h) continue
          doc.gpu.uploadRGBA8(layer.pixels, h.x, h.y, h.w, h.h, img.data)
          applied++
          maxSeq = Math.max(maxSeq, h.seq)
        } catch (err) {
          console.error('[journal] replay entry failed', err)
        }
      }
    }
    if (applied) {
      doc.resumeSeq(maxSeq)
      doc.events.emit('change', { rect: null })
    } else await this.api().truncate(id + '.jrn').catch(() => undefined)
    return applied
  }
}
