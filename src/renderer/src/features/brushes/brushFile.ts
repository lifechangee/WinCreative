import { t } from '../../i18n'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { BrushPreset, cloneBrush, normalizeBrush } from '../../core/brush'
import { BrushTexture, getTextureDef, registerTexture } from '../../brush/textures'
import { getBrushPreset } from '../../brush/presets'
import { parseAbr } from './abr'
import { parseBplist } from './bplist'
import { parseProcreateArchive } from './procreate'

/**
 * Brush files.
 *   .bwbrush     zip: brush.json + textures/<n>.png            (one brush)
 *   .bwbrushset  zip: set.json (name + brushes) + textures/*.png
 *   .brush / .brushset   Procreate (best effort, see procreate.ts)
 *   .abr         Photoshop sampled tips (best effort, see abr.ts)
 */

export interface ImportResult {
  /** set name for set files, otherwise undefined */
  setName?: string
  brushes: BrushPreset[]
  warnings: string[]
}

// ------------------------------------------------------------------ pure texture conversion
export function fnv(data: Uint8Array): string {
  let h = 0x811c9dc5
  for (let i = 0; i < data.length; i += Math.max(1, data.length >> 12)) h = Math.imul(h ^ data[i], 0x01000193)
  return (h >>> 0).toString(36) + data.length.toString(36)
}

const pow2 = (n: number): number => {
  let s = 32
  while (s < n && s < 1024) s *= 2
  return s
}

/** Resample a w*h single channel image to a square power-of-two texture (bilinear). */
export function squareGray(src: Uint8Array, w: number, h: number): { size: number; data: Uint8Array } {
  const size = pow2(Math.max(w, h))
  if (w === size && h === size) return { size, data: src }
  const out = new Uint8Array(size * size)
  for (let y = 0; y < size; y++) {
    const fy = ((y + 0.5) / size) * h - 0.5
    const y0 = Math.max(0, Math.min(h - 1, Math.floor(fy)))
    const y1 = Math.min(h - 1, y0 + 1)
    const ty = Math.max(0, Math.min(1, fy - y0))
    for (let x = 0; x < size; x++) {
      const fx = ((x + 0.5) / size) * w - 0.5
      const x0 = Math.max(0, Math.min(w - 1, Math.floor(fx)))
      const x1 = Math.min(w - 1, x0 + 1)
      const tx = Math.max(0, Math.min(1, fx - x0))
      const a = src[y0 * w + x0] * (1 - tx) + src[y0 * w + x1] * tx
      const b = src[y1 * w + x0] * (1 - tx) + src[y1 * w + x1] * tx
      out[y * size + x] = Math.round(a * (1 - ty) + b * ty)
    }
  }
  return { size, data: out }
}

/** Mean of the outermost pixel ring (0..255). */
export function borderMean(g: Uint8Array, w: number, h: number): number {
  let s = 0
  let n = 0
  for (let x = 0; x < w; x++) {
    s += g[x] + g[(h - 1) * w + x]
    n += 2
  }
  for (let y = 1; y < h - 1; y++) {
    s += g[y * w] + g[y * w + w - 1]
    n += 2
  }
  return n ? s / n : 0
}

/**
 * RGBA image -> brush texture values (255 = paint). raw: take luminance as is (our own files).
 * Otherwise: images with alpha use alpha; opaque tips whose border is bright are treated as dark-on-light.
 */
export function rgbaToGray(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number, kind: 'tip' | 'grain', raw = false): Uint8Array {
  const g = new Uint8Array(w * h)
  let minA = 255
  for (let i = 0; i < w * h; i++) minA = Math.min(minA, rgba[i * 4 + 3])
  const useAlpha = !raw && kind === 'tip' && minA < 250
  for (let i = 0; i < w * h; i++) {
    const a = rgba[i * 4 + 3] / 255
    const l = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]
    g[i] = useAlpha ? rgba[i * 4 + 3] : Math.round(l * (raw ? 1 : a + (1 - a) * 1))
  }
  if (!raw && kind === 'tip' && !useAlpha && borderMean(g, w, h) > 128) for (let i = 0; i < g.length; i++) g[i] = 255 - g[i]
  return g
}

/** Photoshop-style tips: make sure the border is transparent (0). */
export function fixTipPolarity(g: Uint8Array, w: number, h: number): Uint8Array {
  if (borderMean(g, w, h) > 128) return g.map((v) => 255 - v)
  return g
}

// ------------------------------------------------------------------ browser-only PNG helpers
export async function textureToPng(t: BrushTexture): Promise<Uint8Array> {
  const c = document.createElement('canvas')
  c.width = c.height = t.size
  const g = c.getContext('2d')!
  const img = g.createImageData(t.size, t.size)
  for (let i = 0; i < t.size * t.size; i++) {
    const v = t.data[i]
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v
    img.data[i * 4 + 3] = 255
  }
  g.putImageData(img, 0, 0)
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'))
  if (!blob) throw new Error('PNG encode failed')
  return new Uint8Array(await blob.arrayBuffer())
}

export async function decodeImage(bytes: Uint8Array | Blob): Promise<{ data: Uint8ClampedArray; w: number; h: number }> {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as Uint8Array<ArrayBuffer>])
  const bmp = await createImageBitmap(blob)
  const c = document.createElement('canvas')
  c.width = bmp.width
  c.height = bmp.height
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.drawImage(bmp, 0, 0)
  const d = g.getImageData(0, 0, bmp.width, bmp.height)
  bmp.close()
  return { data: d.data, w: c.width, h: c.height }
}

/** Register a texture from gray values (deduplicated by content). */
export function registerGray(gray: Uint8Array, w: number, h: number, kind: 'tip' | 'grain', name: string): BrushTexture {
  const sq = squareGray(gray, w, h)
  const id = `tex-${kind}-${fnv(sq.data)}`
  const existing = getTextureDef(id)
  if (existing) return existing
  const t: BrushTexture = { id, kind, size: sq.size, data: sq.data, name }
  registerTexture(t)
  return t
}

export async function importImageTexture(bytes: Uint8Array | Blob, kind: 'tip' | 'grain', name: string, raw = false): Promise<BrushTexture> {
  const img = await decodeImage(bytes)
  return registerGray(rgbaToGray(img.data, img.w, img.h, kind, raw), img.w, img.h, kind, name)
}

// ------------------------------------------------------------------ export
interface TexRef {
  file: string
  kind: 'tip' | 'grain'
  name?: string
}

async function collectTextures(brushes: BrushPreset[], files: Record<string, Uint8Array>): Promise<Record<string, TexRef>> {
  const refs: Record<string, TexRef> = {}
  const add = async (id: string | null): Promise<void> => {
    if (!id || refs[id]) return
    const t = getTextureDef(id)
    if (!t) return
    const file = `textures/${Object.keys(refs).length}.png`
    files[file] = await textureToPng(t)
    refs[id] = { file, kind: t.kind, name: t.name }
  }
  const walk = async (b: BrushPreset): Promise<void> => {
    await add(b.tipTexture)
    await add(b.grain.texture)
    if (b.dual.brush) await walk(b.dual.brush)
  }
  for (const b of brushes) await walk(b)
  return refs
}

const zip = (files: Record<string, Uint8Array>): Uint8Array => zipSync(files, { level: 6 })

export async function exportBrushFile(b: BrushPreset): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {}
  const textures = await collectTextures([b], files)
  const c = cloneBrush(b)
  files['brush.json'] = strToU8(JSON.stringify({ format: 'bwbrush', version: 1, brush: c, textures }, null, 1))
  return zip(files)
}

export async function exportSetFile(name: string, brushes: BrushPreset[]): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {}
  const textures = await collectTextures(brushes, files)
  files['set.json'] = strToU8(JSON.stringify({ format: 'bwbrushset', version: 1, name, brushes, textures }, null, 1))
  return zip(files)
}

// ------------------------------------------------------------------ import
const uid = (): string => 'b-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

/** Import textures of a bw file, returning old id -> new id. */
async function importTextures(refs: Record<string, TexRef>, zipped: Record<string, Uint8Array>): Promise<Record<string, string>> {
  const map: Record<string, string> = {}
  for (const [id, r] of Object.entries(refs ?? {})) {
    const bytes = zipped[r.file]
    if (!bytes) continue
    const t = await importImageTexture(bytes, r.kind, r.name ?? id, true)
    map[id] = t.id
  }
  return map
}

function remap(b: BrushPreset, map: Record<string, string>): void {
  if (b.tipTexture && map[b.tipTexture]) b.tipTexture = map[b.tipTexture]
  if (b.grain.texture && map[b.grain.texture]) b.grain.texture = map[b.grain.texture]
  if (b.dual.brush) remap(b.dual.brush, map)
}

function freshId(b: BrushPreset): void {
  if (!b.id || getBrushPreset(b.id)) b.id = uid()
}

export async function importBrushFile(bytes: Uint8Array, fileName: string): Promise<ImportResult> {
  const ext = fileName.toLowerCase().replace(/^.*\./, '')
  const warnings: string[] = []
  if (ext === 'abr') return importAbr(bytes, fileName, warnings)
  let z: Record<string, Uint8Array>
  try {
    z = unzipSync(bytes)
  } catch {
    throw new Error('Not a brush file (unreadable archive)')
  }
  if (z['brush.json']) {
    const j = JSON.parse(strFromU8(z['brush.json']))
    const map = await importTextures(j.textures, z)
    const b = normalizeBrush(j.brush)
    remap(b, map)
    freshId(b)
    return { brushes: [b], warnings }
  }
  if (z['set.json']) {
    const j = JSON.parse(strFromU8(z['set.json']))
    const map = await importTextures(j.textures, z)
    const brushes: BrushPreset[] = (j.brushes as BrushPreset[]).map((x) => {
      const b = normalizeBrush(x)
      remap(b, map)
      freshId(b)
      return b
    })
    return { setName: String(j.name ?? t('brushes.actions.importedSet')), brushes, warnings }
  }
  const archives = Object.keys(z).filter((k) => /(^|\/)Brush\.archive$/i.test(k))
  if (archives.length) return importProcreate(z, archives, fileName, warnings)
  throw new Error('Unrecognised brush file')
}

async function importProcreate(z: Record<string, Uint8Array>, archives: string[], fileName: string, warnings: string[]): Promise<ImportResult> {
  let setName: string | undefined
  let order: string[] = []
  const plist = z['brushset.plist']
  if (plist) {
    try {
      const p = parseBplist(plist) as { name?: string; brushes?: string[] }
      if (typeof p.name === 'string') setName = p.name
      if (Array.isArray(p.brushes)) order = p.brushes.map(String)
    } catch {
      /* optional */
    }
  }
  archives.sort((a, b) => {
    const ia = order.findIndex((o) => a.startsWith(o))
    const ib = order.findIndex((o) => b.startsWith(o))
    return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib) || a.localeCompare(b)
  })
  const brushes: BrushPreset[] = []
  for (const a of archives) {
    const dir = a.slice(0, a.length - 'Brush.archive'.length)
    try {
      const pb = parseProcreateArchive(z[a], uid())
      const find = (n: string): Uint8Array | undefined => {
        const k = Object.keys(z).find((x) => x.toLowerCase() === (dir + n).toLowerCase())
        return k ? z[k] : undefined
      }
      const shape = find('Shape.png') ?? (pb.shapeFile ? find(pb.shapeFile) : undefined)
      const grain = find('Grain.png') ?? (pb.grainFile ? find(pb.grainFile) : undefined)
      const inp = pb.input
      if (shape) inp.tipTexture = (await importImageTexture(shape, 'tip', inp.name + ' shape')).id
      if (grain) {
        const t = await importImageTexture(grain, 'grain', inp.name + ' grain')
        inp.grain = { ...inp.grain, texture: t.id }
        if (!inp.grain.depth) inp.grain.depth = 0.7
      }
      const b = normalizeBrush(inp)
      b.about.author = 'Procreate import'
      brushes.push(b)
    } catch (e) {
      warnings.push(`${dir || fileName}: ${(e as Error).message}`)
    }
  }
  if (!brushes.length) throw new Error('No readable brushes in this Procreate file' + (warnings.length ? ' (' + warnings[0] + ')' : ''))
  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')
  return { setName: archives.length > 1 || plist ? setName ?? base : undefined, brushes, warnings }
}

function importAbr(bytes: Uint8Array, fileName: string, warnings: string[]): ImportResult {
  const tips = parseAbr(bytes)
  if (!tips.length) throw new Error('No sampled brush tips found in this .abr')
  const brushes: BrushPreset[] = tips.map((t, i) => {
    const t2 = registerGray(fixTipPolarity(t.data, t.width, t.height), t.width, t.height, 'tip', t.name)
    return normalizeBrush({
      id: uid() + i,
      name: t.name,
      tipTexture: t2.id,
      defaultSize: Math.max(10, Math.min(200, Math.max(t.width, t.height))),
      spacing: t.spacing ? Math.max(0.03, t.spacing / 100) : 0.25,
      flow: 1,
      dynamics: { pressureSize: 0.4 },
      about: { author: 'Photoshop import' }
    })
  })
  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')
  return { setName: brushes.length > 1 ? base : undefined, brushes, warnings }
}
