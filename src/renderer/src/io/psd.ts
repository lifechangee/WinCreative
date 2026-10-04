import { t } from '../i18n'
import { initializeCanvas, readPsd, writePsd } from 'ag-psd'
import type { BlendMode as PsdBlend, Layer as PsdLayer, Psd } from 'ag-psd'
import { BLEND_MODES, BlendMode } from '../core/blend'
import { AdjustmentMapping, ImportedText, mapAdjustment, psdTextToImported } from './psdMap'

/**
 * PSD import/export (pure data <-> bytes; no GPU/DOM needed so it is unit-tested in node).
 * Layer pixels are STRAIGHT (non-premultiplied) RGBA8, as PSD stores them.
 */
// Outside a browser (unit tests) ag-psd has no canvas; we only use raw ImageData so a plain-object factory is enough.
if (typeof document === 'undefined') {
  initializeCanvas(
    () => {
      throw new Error('canvas not available')
    },
    (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }) as ImageData
  )
}

export interface Pixels {
  /** offset of the bitmap inside the canvas (PSD layers are cropped to their bounds) */
  x: number
  y: number
  width: number
  height: number
  data: Uint8ClampedArray | Uint8Array
}

export interface ExLayer {
  name: string
  visible: boolean
  opacity: number
  blendMode: BlendMode
  clipping: boolean
  alphaLock?: boolean
  /** undefined for groups */
  pixels?: Pixels
  /** group members, bottom -> top */
  children?: ExLayer[]
  open?: boolean
  /** groups: children blend with the backdrop directly (PSD "Pass Through") */
  passThrough?: boolean
  /** PSD text layer, converted to a Brushwork text layer (the raster in `pixels` is kept until it is edited) */
  text?: ImportedText
  /** PSD adjustment layer (no pixels): mapped to the closest Brushwork adjustment or an unsupported marker */
  adjustment?: AdjustmentMapping & { type?: string }
  /** the layer is hidden in the source / PSD adjustment layers only: opacity of the effect */
}

const TO_PSD: Record<BlendMode, PsdBlend> = {
  normal: 'normal',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  softLight: 'soft light',
  hardLight: 'hard light',
  colorDodge: 'color dodge',
  colorBurn: 'color burn',
  darken: 'darken',
  lighten: 'lighten',
  difference: 'difference',
  exclusion: 'exclusion',
  add: 'linear dodge',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
  linearBurn: 'linear burn',
  darkerColor: 'darker color',
  lighterColor: 'lighter color',
  vividLight: 'vivid light',
  linearLight: 'linear light',
  pinLight: 'pin light',
  hardMix: 'hard mix',
  subtract: 'subtract',
  divide: 'divide'
}
const FROM_PSD = new Map<string, BlendMode>(BLEND_MODES.map((m) => [TO_PSD[m], m]))

export const toPsdBlend = (m: BlendMode): PsdBlend => TO_PSD[m] ?? 'normal'
export const fromPsdBlend = (m: string | undefined): BlendMode => FROM_PSD.get(m ?? 'normal') ?? 'normal'

function toPsdLayer(l: ExLayer): PsdLayer {
  const out: PsdLayer = {
    name: l.name,
    hidden: !l.visible,
    opacity: Math.max(0, Math.min(1, l.opacity)),
    blendMode: toPsdBlend(l.blendMode),
    clipping: l.clipping,
    transparencyProtected: !!l.alphaLock
  }
  if (l.children) {
    out.children = l.children.map(toPsdLayer)
    out.opened = l.open !== false
    if (l.passThrough) out.blendMode = 'pass through'
  } else if (l.pixels) {
    const p = l.pixels
    out.left = p.x
    out.top = p.y
    out.imageData = { width: p.width, height: p.height, data: p.data as Uint8ClampedArray } as ImageData
  }
  return out
}

/** Build a PSD (bottom -> top layer order). `background` becomes a solid bottom layer; `composite` is the flattened preview. */
export function encodePsd(width: number, height: number, layers: ExLayer[], opts: { background?: [number, number, number] | null; composite?: Uint8ClampedArray | Uint8Array } = {}): Uint8Array {
  const children: PsdLayer[] = []
  if (opts.background) {
    const px = new Uint8ClampedArray(width * height * 4)
    const [r, g, b] = opts.background.map((v) => Math.round(v * 255))
    for (let i = 0; i < px.length; i += 4) {
      px[i] = r
      px[i + 1] = g
      px[i + 2] = b
      px[i + 3] = 255
    }
    children.push(toPsdLayer({ name: 'Background color', visible: true, opacity: 1, blendMode: 'normal', clipping: false, pixels: { x: 0, y: 0, width, height, data: px } }))
  }
  for (const l of layers) children.push(toPsdLayer(l))
  const psd: Psd = { width, height, children }
  if (opts.composite) psd.imageData = { width, height, data: opts.composite as Uint8ClampedArray } as ImageData
  const buf = writePsd(psd, { trimImageData: true, noBackground: true })
  return new Uint8Array(buf)
}

export interface DecodedPsd {
  width: number
  height: number
  /** bottom -> top */
  layers: ExLayer[]
  composite: { width: number; height: number; data: Uint8ClampedArray | Uint8Array } | null
}

/** ag-psd may hand back 16/32-bit float data for deep PSDs; normalise to 8-bit. */
function to8(d: ArrayLike<number> & { constructor: { name: string } }): Uint8ClampedArray | Uint8Array {
  if (d instanceof Uint8ClampedArray || d instanceof Uint8Array) return d
  const max = d instanceof Float32Array ? 1 : 65535
  const o = new Uint8ClampedArray(d.length)
  for (let i = 0; i < d.length; i++) o[i] = (d[i] / max) * 255 + 0.5
  return o
}

function fromPsdLayer(l: PsdLayer): ExLayer {
  const base: ExLayer = {
    name: l.name ?? t('core.doc.layer'),
    visible: !l.hidden,
    opacity: l.opacity ?? 1,
    blendMode: fromPsdBlend(l.blendMode),
    clipping: !!l.clipping,
    alphaLock: !!l.transparencyProtected
  }
  if (l.children) return { ...base, children: l.children.map(fromPsdLayer), open: l.opened !== false, passThrough: l.blendMode === 'pass through' || l.blendMode === undefined }
  if (l.text) {
    const t = psdTextToImported(l)
    if (t) base.text = t
  }
  if (l.adjustment) {
    const m = mapAdjustment(l.adjustment as unknown as { type: string })
    base.adjustment = { ...m, type: l.adjustment.type }
  }
  const img = l.imageData
  if (img && img.width > 0 && img.height > 0) base.pixels = { x: l.left ?? 0, y: l.top ?? 0, width: img.width, height: img.height, data: to8(img.data) }
  return base
}

export function decodePsd(bytes: Uint8Array): DecodedPsd {
  const psd = readPsd(bytes, { useImageData: true, skipThumbnail: true, skipLinkedFilesData: true })
  return {
    width: psd.width,
    height: psd.height,
    layers: (psd.children ?? []).map(fromPsdLayer),
    composite: psd.imageData ? { width: psd.imageData.width, height: psd.imageData.height, data: to8(psd.imageData.data) } : null
  }
}

/**
 * Flatten groups into a plain bottom->top list for a document model without groups.
 * Group opacity multiplies into members; a hidden group hides members; a group's blend mode is kept only when it is
 * normal (otherwise members keep their own mode - the closest flat approximation).
 */
export function flattenGroups(layers: ExLayer[], prefix = '', opacity = 1, visible = true): ExLayer[] {
  const out: ExLayer[] = []
  for (const l of layers) {
    if (l.children) out.push(...flattenGroups(l.children, prefix + l.name + ' / ', opacity * l.opacity, visible && l.visible))
    else out.push({ ...l, name: prefix ? prefix + l.name : l.name, opacity: l.opacity * opacity, visible: l.visible && visible })
  }
  return out
}
