import { t } from '../i18n'
import type { BlendMode } from '../core/blend'
import type { Surface } from '../gl/gpu'

/** Scalar layer properties: everything here is undoable via doc.setLayerProps and saved in .bwk. */
export interface LayerProps {
  name: string
  visible: boolean
  /** 0..1 */
  opacity: number
  blendMode: BlendMode
  locked: boolean
  alphaLock: boolean
  /** clip to the alpha of the nearest non-clipping layer below (siblings only) */
  clipping: boolean
  /** group folder (has no pixels of its own; children have parentId === this.id) */
  isGroup: boolean
  /** containing group id, null = root */
  parentId: string | null
  /** group collapsed in the panel */
  collapsed: boolean
  /** groups: children blend directly with what is below (Procreate "Pass Through", the default) */
  passThrough: boolean
  /** sampling source for ColorDrop / Automatic selection (one per document) */
  reference: boolean
  /** Drawing Assist flag: strokes on this layer are symmetry/assist-processed by the guides feature */
  drawingAssist: boolean
  /** mask is applied (only meaningful when the layer has a mask) */
  maskEnabled: boolean
  /** show the mask itself instead of the layer while true */
  maskView: boolean
}

export const DEFAULT_LAYER_PROPS: LayerProps = {
  name: 'Layer',
  visible: true,
  opacity: 1,
  blendMode: 'normal',
  locked: false,
  alphaLock: false,
  clipping: false,
  isGroup: false,
  parentId: null,
  collapsed: false,
  passThrough: true,
  reference: false,
  drawingAssist: false,
  maskEnabled: true,
  maskView: false
}

const PROP_KEYS = Object.keys(DEFAULT_LAYER_PROPS) as (keyof LayerProps)[]

export class Layer implements LayerProps {
  name!: string
  visible!: boolean
  opacity!: number
  blendMode!: BlendMode
  locked!: boolean
  alphaLock!: boolean
  clipping!: boolean
  isGroup!: boolean
  parentId!: string | null
  collapsed!: boolean
  passThrough!: boolean
  reference!: boolean
  drawingAssist!: boolean
  maskEnabled!: boolean
  maskView!: boolean
  /** Optional layer mask: RGBA surface, mask value = luminance of the (premultiplied) colour. White shows. */
  mask: Surface | null = null
  /** true while brush/filters should act on the mask instead of the pixels (Procreate: mask thumbnail selected) */
  editingMask = false

  constructor(
    public id: string,
    /** the layer's own pixels (groups: a tiny 1x1 placeholder) */
    public pixels: Surface,
    props: Partial<LayerProps> = {}
  ) {
    const p = { ...DEFAULT_LAYER_PROPS, name: t('core.doc.layer'), ...props }
    for (const k of PROP_KEYS) (this as any)[k] = p[k]
  }

  /**
   * The surface that painting / filters / transforms operate on: the mask while `editingMask`
   * (and a mask exists), otherwise the pixels. The compositor always uses `pixels` + `mask`.
   */
  get surface(): Surface {
    return this.editingMask && this.mask ? this.mask : this.pixels
  }
  set surface(s: Surface) {
    if (this.editingMask && this.mask) this.mask = s
    else this.pixels = s
  }

  get hasMask(): boolean {
    return this.mask !== null
  }

  get props(): LayerProps {
    const o: any = {}
    for (const k of PROP_KEYS) o[k] = (this as any)[k]
    return o as LayerProps
  }

  dispose(): void {
    this.pixels.dispose()
    this.mask?.dispose()
  }
}
