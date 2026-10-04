import { t } from '../i18n'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { BLEND_MODES, BlendMode } from '../core/blend'
import { Compositor } from '../gl/compositor'
import type { GPU, Surface } from '../gl/gpu'
import { BlobStore, SaveAborted, docKeyOf, encodeSurface, encodeThumbnail, isCached, markCached, pool, saveHooks, saveStats, surfaceKey, yieldTask } from './asyncSave'
import { Document } from '../doc/document'
import { normalizeOrder } from '../doc/layerTree'
import type { LayerProps } from '../doc/layer'

/**
 * .bwk = ZIP archive:
 *   manifest.json         BwkManifest
 *   layers/<id>.png       one straight-alpha PNG per layer
 *   thumbnail.png         flattened preview (optional on read)
 * Other agents may add extra entries (e.g. timelapse/, psd metadata); readers must ignore unknown files.
 */
export interface BwkLayerEntry extends LayerProps {
  id: string
  /** PNG of the layer pixels ('' for groups) */
  file: string
  /** PNG of the layer mask, when the layer has one */
  maskFile?: string
}
export interface BwkManifest {
  format: 'brushwork'
  version: 1
  name: string
  width: number
  height: number
  background: { color: [number, number, number]; visible: boolean }
  activeLayer: string
  /** bottom -> top */
  layers: BwkLayerEntry[]
  /** free-form extension data for other modules */
  extra?: Record<string, unknown>
}

export function buildManifest(doc: Document): BwkManifest {
  return {
    format: 'brushwork',
    version: 1,
    name: doc.name,
    width: doc.width,
    height: doc.height,
    background: { color: [...doc.background.color], visible: doc.background.visible },
    activeLayer: doc.activeId,
    layers: doc.layers.map((l) => ({ ...l.props, id: l.id, file: l.isGroup ? '' : `layers/${l.id}.png`, ...(l.mask ? { maskFile: `masks/${l.id}.png` } : {}) }))
  }
}

export function validateManifest(m: any): BwkManifest {
  if (!m || m.format !== 'brushwork') throw new Error('Not a WinCreative file')
  if (m.version !== 1) throw new Error('Unsupported .bwk version ' + m.version)
  if (!Number.isInteger(m.width) || !Number.isInteger(m.height) || m.width < 1 || m.height < 1) throw new Error('Bad canvas size')
  if (!Array.isArray(m.layers) || m.layers.length === 0) throw new Error('No layers')
  const layers: BwkLayerEntry[] = m.layers.map((l: any, i: number) => {
    if (typeof l.id !== 'string' || typeof l.file !== 'string') throw new Error('Bad layer entry ' + i)
    const blend: BlendMode = BLEND_MODES.includes(l.blendMode) ? l.blendMode : 'normal'
    return {
      id: l.id,
      file: l.file,
      name: String(l.name ?? t('core.doc.layer')),
      visible: l.visible !== false,
      opacity: Math.min(1, Math.max(0, Number(l.opacity ?? 1))),
      blendMode: blend,
      locked: !!l.locked,
      alphaLock: !!l.alphaLock,
      clipping: !!l.clipping,
      isGroup: !!l.isGroup,
      parentId: typeof l.parentId === 'string' ? l.parentId : null,
      collapsed: !!l.collapsed,
      passThrough: l.passThrough !== false,
      reference: !!l.reference,
      drawingAssist: !!l.drawingAssist,
      maskEnabled: l.maskEnabled !== false,
      maskView: false,
      ...(typeof l.maskFile === 'string' ? { maskFile: l.maskFile } : {})
    }
  })
  const known = new Set(layers.map((l) => l.id))
  let ref = false
  for (const l of layers) {
    if (l.parentId && !known.has(l.parentId)) l.parentId = null
    if (l.reference) {
      if (ref || l.isGroup) l.reference = false
      ref = true
    }
  }
  const bg = m.background ?? {}
  const color = Array.isArray(bg.color) && bg.color.length === 3 ? (bg.color.map(Number) as [number, number, number]) : ([1, 1, 1] as [number, number, number])
  return {
    format: 'brushwork',
    version: 1,
    name: String(m.name ?? t('core.common.untitled')),
    width: m.width,
    height: m.height,
    background: { color, visible: bg.visible !== false },
    activeLayer: typeof m.activeLayer === 'string' ? m.activeLayer : layers[layers.length - 1].id,
    layers,
    extra: m.extra
  }
}

// ------------------------------------------------------------------ extensions
/**
 * Feature modules persist their own data in the .bwk: `save` may return JSON for manifest.extra[id] and extra zip
 * files (stored uncompressed); `load` receives that JSON and all zip entries before the 'load' commit fires.
 */
export interface BwkExtSave {
  extra?: unknown
  files?: Record<string, Uint8Array>
  /** zip path -> keys of blobs cached with ctx.blobs (concatenated in order); lets big append-only data skip the main thread */
  blobFiles?: Record<string, string[]>
}
export interface BwkExtension {
  id: string
  save?(doc: Document, ctx: { blobs: BlobStore }): Promise<BwkExtSave | void> | BwkExtSave | void
  load?(doc: Document, extra: unknown, entries: Record<string, Uint8Array>): Promise<void> | void
}
export const bwkExtensions: BwkExtension[] = []
export function registerBwkExtension(e: BwkExtension): void {
  const i = bwkExtensions.findIndex((x) => x.id === e.id)
  if (i >= 0) bwkExtensions[i] = e
  else bwkExtensions.push(e)
}

// ------------------------------------------------------------------ PNG helpers
export async function encodePng(rgba: Uint8ClampedArray, w: number, h: number): Promise<Uint8Array> {
  const c = new OffscreenCanvas(w, h)
  const ctx = c.getContext('2d')!
  ctx.putImageData(new ImageData(rgba as unknown as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0)
  const blob = await c.convertToBlob({ type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}

export async function encodeJpeg(rgba: Uint8ClampedArray, w: number, h: number, quality = 0.92): Promise<Uint8Array> {
  const c = new OffscreenCanvas(w, h)
  c.getContext('2d')!.putImageData(new ImageData(rgba as unknown as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0)
  const blob = await c.convertToBlob({ type: 'image/jpeg', quality })
  return new Uint8Array(await blob.arrayBuffer())
}

export async function decodeImage(bytes: Uint8Array, mime = 'image/png'): Promise<ImageData> {
  const bmp = await createImageBitmap(new Blob([bytes as unknown as BlobPart], { type: mime }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  const c = new OffscreenCanvas(bmp.width, bmp.height)
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bmp, 0, 0)
  bmp.close()
  return ctx.getImageData(0, 0, c.width, c.height)
}

async function makeThumbnail(rgba: Uint8ClampedArray, w: number, h: number, max = 256): Promise<Uint8Array> {
  const src = new OffscreenCanvas(w, h)
  src.getContext('2d')!.putImageData(new ImageData(rgba as unknown as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0)
  const k = Math.min(1, max / Math.max(w, h))
  const dst = new OffscreenCanvas(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)))
  const ctx = dst.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, dst.width, dst.height)
  const blob = await dst.convertToBlob({ type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}

// ------------------------------------------------------------------ save / load
export interface SaveOptions {
  /** autosave: aborts (SaveAborted) when the artist starts drawing or the document is edited mid-save */
  background?: boolean
  /** recompute the composite for the thumbnail (manual save); autosave reuses the live composite */
  recompose?: boolean
}
export interface SaveResult {
  bytes: Uint8Array
  /** gallery thumbnail (PNG) */
  thumbnail: Uint8Array
  /** how many layer/mask surfaces were (re-)encoded vs reused from the cache */
  encoded: number
  reused: number
}

// One save at a time (manual save, gallery autosave, exports): concurrent saves fought over GPU readbacks and the
// time-lapse flush. A failed save never blocks the queue.
let saveChain: Promise<unknown> = Promise.resolve()
export function saveBwk(doc: Document, compositor: Compositor, extraFiles: Record<string, Uint8Array> = {}, opts: SaveOptions = {}): Promise<Uint8Array> {
  return saveBwkEx(doc, compositor, extraFiles, opts).then((r) => r.bytes)
}
export function saveBwkEx(doc: Document, compositor: Compositor, extraFiles: Record<string, Uint8Array> = {}, opts: SaveOptions = {}): Promise<SaveResult> {
  const p = saveChain.then(() => withTimeout(saveBwkNow(doc, compositor, extraFiles, opts), 180000, 'save', () => pool.reset(new Error('save timed out'))))
  saveChain = p.catch(() => undefined)
  return p
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string, onTimeout?: () => void): Promise<T> {
  return new Promise<T>((ok, err) => {
    const t = setTimeout(() => {
      onTimeout?.()
      err(new Error(what + ' timed out'))
    }, ms)
    p.then(
      (v) => (clearTimeout(t), ok(v)),
      (e) => (clearTimeout(t), err(e))
    )
  })
}

async function saveBwkNow(doc: Document, compositor: Compositor, extraFiles: Record<string, Uint8Array>, opts: SaveOptions): Promise<SaveResult> {
  const t0 = performance.now()
  let restarts = 0
  for (;;) {
    const st = { stale: false }
    const off = doc.events.on('commit', () => void (st.stale = true))
    try {
      const r = await saveAttempt(doc, compositor, extraFiles, opts, st, restarts < 3)
      saveStats.saves++
      saveStats.lastMs = performance.now() - t0
      return r
    } catch (e) {
      // foreground save: the document changed while it was being read -> start over (cached layers make it cheap)
      if (e instanceof SaveAborted && e.reason === 'edited' && !opts.background && restarts++ < 3) continue
      if (!(e instanceof SaveAborted)) pool.reset(e instanceof Error ? e : new Error(String(e))) // real failure: drop workers (also half-fed jobs)
      throw e
    } finally {
      off()
    }
  }
}

async function saveAttempt(doc: Document, compositor: Compositor, extraFiles: Record<string, Uint8Array>, opts: SaveOptions, st: { stale: boolean }, canRestart: boolean): Promise<SaveResult> {
  const check = (): void => {
    if (doc.disposed) throw new SaveAborted('disposed')
    if (st.stale && (opts.background || canRestart)) throw new SaveAborted('edited')
    if (opts.background && saveHooks.busy()) throw new SaveAborted('busy')
  }
  check()
  const dk = docKeyOf(doc)
  const gpu = doc.gpu
  const files: Record<string, Uint8Array> = {}
  const entries: { name: string; keys: string[] }[] = []
  const manifest = buildManifest(doc)
  const blobs = new BlobStore(dk)
  for (const ext of bwkExtensions) {
    const r = await withTimeout(Promise.resolve(ext.save?.(doc, { blobs })), 60000, 'extension ' + ext.id)
    check()
    if (!r) continue
    if (r.extra !== undefined) (manifest.extra ??= {})[ext.id] = r.extra
    for (const [k, v] of Object.entries(r.files ?? {})) files[k] = v
    for (const [k, keys] of Object.entries(r.blobFiles ?? {})) {
      entries.push({ name: k, keys })
    }
  }
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 1))

  // ---- layers: read back + encode only surfaces changed since the last save (per-surface revision counter)
  const todo: { name: string; surf: Surface }[] = []
  for (const l of doc.layers) {
    if (l.isGroup) continue
    todo.push({ name: `layers/${l.id}.png`, surf: l.pixels })
    if (l.mask) todo.push({ name: `masks/${l.id}.png`, surf: l.mask })
  }
  let encoded = 0
  let reused = 0
  const inflight = new Set<Promise<void>>()
  const width = pool.width + 1
  let failure: unknown = null
  for (const t of todo) {
    entries.push({ name: t.name, keys: [surfaceKey(t.surf)] })
    if (isCached(t.surf)) {
      reused++
      saveStats.cached++
      continue
    }
    check()
    if (failure) break
    const r = await encodeSurface(gpu, t.surf, check)
    encoded++
    const done: Promise<void> = r.png.then(
      (png) => {
        pool.store(dk, surfaceKey(t.surf), png)
        markCached(t.surf, r.rev, r.gen)
        inflight.delete(done)
      },
      (e) => {
        failure = e
        inflight.delete(done)
      }
    )
    inflight.add(done)
    if (inflight.size >= width) await Promise.race(inflight)
    await yieldTask()
  }
  await Promise.all(inflight)
  if (failure) throw failure
  check()

  // ---- thumbnail: GPU box-downscale of the live composite (autosave) or a fresh compose (manual)
  let comp = compositor
  let temp: Compositor | null = null
  if (compositor.document !== doc) comp = temp = new Compositor(gpu, doc)
  let thumb: Uint8Array
  try {
    if (temp || (opts.recompose && !saveHooks.busy())) comp.compose(null, null)
    thumb = await encodeThumbnail(gpu, comp.composite, doc.background.visible ? doc.background.color : null, check)
  } finally {
    if (temp) {
      temp.renderer.dispose()
      temp.composite.dispose()
    }
  }
  files['thumbnail.png'] = thumb
  for (const [k, v] of Object.entries(extraFiles)) files[k] = v
  check()
  const keep = entries.flatMap((e) => e.keys)
  const zip = new Uint8Array(await pool.zip(dk, entries, files, keep))
  return { bytes: zip, thumbnail: thumb, encoded, reused }
}

export async function loadBwk(bytes: Uint8Array, gpu: GPU): Promise<Document> {
  const entries = unzipSync(bytes)
  const mf = entries['manifest.json']
  if (!mf) throw new Error('manifest.json missing')
  const m = validateManifest(JSON.parse(strFromU8(mf)))
  const doc = new Document(gpu, m.width, m.height, { background: m.background })
  doc.name = m.name
  for (const e of m.layers) {
    const layer = doc.createLayer(e, e.id)
    const png = e.isGroup ? undefined : entries[e.file]
    if (png) {
      const img = await decodeImage(png)
      if (img.width === m.width && img.height === m.height) gpu.uploadRGBA8(layer.pixels, 0, 0, m.width, m.height, img.data)
    }
    const mpng = e.maskFile && !e.isGroup ? entries[e.maskFile] : undefined
    if (mpng) {
      const img = await decodeImage(mpng)
      layer.mask = doc.createMaskSurface(true)
      if (img.width === m.width && img.height === m.height) gpu.uploadRGBA8(layer.mask, 0, 0, m.width, m.height, img.data)
    }
    doc.layers.push(layer)
  }
  doc.layers.splice(0, doc.layers.length, ...normalizeOrder(doc.layers))
  doc.activeId = doc.getLayer(m.activeLayer) ? m.activeLayer : doc.layers[doc.layers.length - 1].id
  for (const ext of bwkExtensions) await ext.load?.(doc, m.extra?.[ext.id], entries)
  doc.emitCommit('load', null, null, 'Open document')
  return doc
}
