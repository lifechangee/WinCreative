import { t } from '../i18n'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { BLEND_MODES, BlendMode } from '../core/blend'
import { Compositor } from '../gl/compositor'
import type { GPU, Surface } from '../gl/gpu'
import { BlobStore, SaveAborted, docKeyOf, encodeSurface, encodeThumbnail, isCached, markCached, pool, saveHooks, saveStats, surfaceKey, yieldTask } from './asyncSave'
import { Document, INF_FRAME } from '../doc/document'
import { TILE, tileKey as tileKeyOf, tileKeyX, tileKeyY } from '../core/tiles'
import { BWK_VERSION_FIXED, BWK_VERSION_INFINITE, InfiniteMeta, parseInfiniteMeta, parseLayerTiles, parseTileFileName, tileFileName } from './bwkInfinite'
import { nextTask } from './tileIo'
import { frameRect } from '../features/frame/workRect'
import { indexZip, readEntry } from './zipIndex'
import { newSaved } from '../doc/tileStore'
import { ByteSink, infSaveStats, writeInfiniteZip } from './bwkSaveInf'
import { normalizeOrder } from '../doc/layerTree'
import type { LayerProps } from '../doc/layer'
import { cleanCode } from '../features/langvariants/model'

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
  /** v2 infinite documents: coordinates of the non-empty tiles (files: layers/<id>/<tx>_<ty>.png) */
  tiles?: [number, number][]
}
export interface BwkManifest {
  format: 'brushwork'
  /** 1 = fixed document (unchanged since 0.1), 2 = adds `kind` / `infinite` / per-layer `tiles` (only written for infinite documents) */
  version: 1 | 2
  kind?: 'fixed' | 'infinite'
  infinite?: InfiniteMeta
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
  if (doc.isInfinite) {
    return {
      format: 'brushwork',
      version: BWK_VERSION_INFINITE,
      kind: 'infinite',
      infinite: { tileSize: TILE, ...(doc.infinite.view ? { view: doc.infinite.view } : {}), ...(doc.infinite.grid ? { grid: true } : {}) },
      name: doc.name,
      width: doc.width,
      height: doc.height,
      background: { color: [...doc.background.color], visible: doc.background.visible },
      activeLayer: doc.activeId,
      layers: doc.layers.map((l) => ({
        ...l.props,
        id: l.id,
        file: '',
        ...(l.tiles ? { tiles: [...l.tiles.keys()].map((k) => [tileKeyX(k), tileKeyY(k)] as [number, number]) } : {})
      }))
    }
  }
  return {
    format: 'brushwork',
    version: BWK_VERSION_FIXED,
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
  if (m.version !== 1 && m.version !== 2) throw new Error('Unsupported .bwk version ' + m.version)
  const infinite = m.version === 2 ? parseInfiniteMeta(m) : null
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
      langSet: !!l.isGroup && !!l.langSet,
      lang: !l.isGroup && typeof l.lang === 'string' ? cleanCode(l.lang) : '',
      ...(typeof l.maskFile === 'string' ? { maskFile: l.maskFile } : {}),
      ...(infinite && !l.isGroup ? { tiles: parseLayerTiles(l) } : {})
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
    version: infinite ? BWK_VERSION_INFINITE : BWK_VERSION_FIXED,
    ...(infinite ? { kind: 'infinite' as const, infinite } : {}),
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

/** Gallery thumbnail of an infinite document: the painted area (or a blank page in the background colour), max 256 px. */
async function infiniteThumbnail(doc: Document, comp: Compositor): Promise<Uint8Array> {
  const b = frameRect(doc) ?? doc.contentBounds({ tight: true, visibleOnly: true }) // the frame (what the artist presents) wins over the content bounds
  if (!b) {
    const px = new Uint8ClampedArray(64 * 64 * 4)
    const c = doc.background.visible ? doc.background.color : [1, 1, 1]
    for (let i = 0; i < px.length; i += 4) {
      px[i] = c[0] * 255
      px[i + 1] = c[1] * 255
      px[i + 2] = c[2] * 255
      px[i + 3] = 255
    }
    return encodePng(px, 64, 64)
  }
  const pad = Math.max(8, Math.max(b.w, b.h) * 0.03)
  const r = { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad }
  const sc = Math.min(1, 256 / Math.max(r.w, r.h))
  const big = doc.tileStats().tiles > 300
  // time-sliced pre-build (2 ms of composes per slice) even for background saves: the assembly below is then a handful of GPU blits
  const cl = comp.cleanLang() // a ghost on screen never reaches the gallery thumbnail
  const inf = cl ? comp.langInf(cl) : comp.inf
  await inf.prewarm(r, sc, nextTask, big ? 1500 : 8000)
  inf.readPartial = big
  let a: ReturnType<Compositor['inf']['assembleRect']> | null = null
  try {
    a = inf.assembleRect(r, sc)
  } finally {
    inf.readPartial = false
  }
  // GPU box-downscale + paper + fenced banded readback (never a pipeline-stalling readPixels on the frame-critical thread)
  try {
    return await encodeThumbnail(doc.gpu, a.asm, doc.background.visible ? doc.background.color : null, () => undefined)
  } finally {
    a.asm.dispose()
  }
}

/** The gallery thumbnail of a big, mostly evicted document is reused from the last save / load (recomposing would restore every tile). */
const thumbCache = new WeakMap<Document, { png: Uint8Array; at: number }>()
export function setCachedThumbnail(doc: Document, png: Uint8Array): void {
  thumbCache.set(doc, { png, at: Date.now() })
}
async function cachedInfiniteThumbnail(doc: Document, comp: Compositor, background = false): Promise<Uint8Array> {
  let cold = 0
  let total = 0
  for (const l of doc.layers) if (l.tiles) (cold += l.tiles.coldCount, (total += l.tiles.count))
  const old = thumbCache.get(doc)
  // recomposing a big document touches every tile: it keeps its last thumbnail (refreshed every 5 minutes, or while it is small)
  if (old && total > 300 && (cold * 4 > total || total > 1500 || Date.now() - old.at < 300000)) return old.png
  const nonBlocking = total > 300 && cold > 0
  if (nonBlocking) comp.inf.readBlocking = false // render what is resident; never restores hundreds of tiles on the main thread
  try {
    // background autosave of a big document: one short partial render (no pyramid pre-build) so an idle save never hitches the UI
    const t = await infiniteThumbnail(doc, comp)
    thumbCache.set(doc, { png: t, at: Date.now() })
    return t
  } finally {
    comp.inf.readBlocking = true
  }
}

// ------------------------------------------------------------------ save / load
export interface SaveOptions {
  /** autosave: aborts (SaveAborted) when the artist starts drawing or the document is edited mid-save */
  background?: boolean
  /** recompute the composite for the thumbnail (manual save); autosave reuses the live composite */
  recompose?: boolean
  /** infinite documents: stream the zip here (main process) instead of returning it; `bytes` is then empty */
  sink?: ByteSink
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
  // infinite: drop tiles that became fully transparent since the last save, so the manifest only lists tiles that get a PNG
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
  if (!doc.isInfinite) files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 1))

  if (doc.isInfinite) {
    // streaming writer: saved PNGs of clean / evicted tiles are reused, dirty tiles are batched + encoded in parallel
    let comp0 = compositor
    let temp0: Compositor | null = null
    if (compositor.document !== doc) comp0 = temp0 = new Compositor(gpu, doc)
    let thumb0: Uint8Array
    try {
      const tt = performance.now()
      thumb0 = await cachedInfiniteThumbnail(doc, comp0, !!opts.background)
      infSaveStats.thumbMs = performance.now() - tt
    } finally {
      if (temp0) {
        temp0.renderer.dispose()
        temp0.inf.dispose()
        temp0.composite.dispose()
      }
    }
    check()
    const late: Record<string, () => Promise<Uint8Array>> = {}
    for (const en of entries) late[en.name] = async () => new Uint8Array(await pool.cat(dk, en.keys))
    const bytes = await writeInfiniteZip(doc, { ...files, 'thumbnail.png': thumb0, ...extraFiles }, () => strToU8(JSON.stringify({ ...manifest, layers: buildManifest(doc).layers }, null, 1)), late, opts.sink ?? null, check)
    return { bytes, thumbnail: thumb0, encoded: infSaveStats.encoded, reused: infSaveStats.reusedBlobs }
  }

  // ---- layers: read back + encode only surfaces changed since the last save (per-surface revision counter)
  const todo: { name: string; surf: Surface }[] = []
  for (const l of doc.layers) {
    if (l.isGroup) continue
    if (l.tiles) {
      for (const [k, s] of l.tiles.map) todo.push({ name: tileFileName(l.id, tileKeyX(k), tileKeyY(k)), surf: s })
      continue
    }
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
    if (doc.isInfinite) {
      thumb = await infiniteThumbnail(doc, comp)
    } else {
      if (temp || (opts.recompose && !saveHooks.busy())) comp.compose(null, null)
      const cl = comp.cleanLang() // a ghost on screen never reaches the gallery thumbnail
      thumb = await encodeThumbnail(gpu, cl ? comp.renderLang(cl) : comp.composite, doc.background.visible ? doc.background.color : null, check)
    }
  } finally {
    if (temp) {
      temp.renderer.dispose()
      temp.inf.dispose()
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
  // The central directory is indexed once; infinite documents keep every tile as a zero-copy PNG view (evicted-form tile, decoded on demand,
  // viewport first), so opening costs only the manifest + thumbnail regardless of the tile count.
  const index = indexZip(bytes)
  const entries: Record<string, Uint8Array> = {}
  for (const [name, en] of index) if (!parseTileFileName(name)) entries[name] = readEntry(bytes, en)
  const mf = entries['manifest.json']
  if (!mf) throw new Error('manifest.json missing')
  const m = validateManifest(JSON.parse(strFromU8(mf)))
  const inf = m.kind === 'infinite'
  const doc = new Document(gpu, inf ? INF_FRAME : m.width, inf ? INF_FRAME : m.height, { background: m.background, ...(inf ? { kind: 'infinite' as const } : {}) })
  doc.name = m.name
  if (m.infinite) doc.infinite = { grid: !!m.infinite.grid, ...(m.infinite.view ? { view: m.infinite.view } : {}) }
  for (const e of m.layers) {
    const layer = doc.createLayer(e, e.id)
    if (inf && layer.tiles) {
      for (const [tx, ty] of e.tiles ?? []) {
        const en = index.get(tileFileName(e.id, tx, ty))
        if (!en) continue
        const tp = readEntry(bytes, en)
        // IHDR width / height must be one tile
        if (tp.length < 33 || ((tp[16] << 24) | (tp[17] << 16) | (tp[18] << 8) | tp[19]) !== TILE || ((tp[20] << 24) | (tp[21] << 16) | (tp[22] << 8) | tp[23]) !== TILE) continue
        layer.tiles.putCold(tileKeyOf(tx, ty), newSaved(tp, -1, -1, false))
      }
      doc.layers.push(layer)
      continue
    }
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
  if (inf && entries['thumbnail.png']) setCachedThumbnail(doc, entries['thumbnail.png'])
  doc.emitCommit('load', null, null, 'Open document')
  return doc
}
