import type { App } from '../../app/app'
import { hsvToRgb } from '../../app/state'
import { LayerLimitError } from '../../doc/document'
import type { Layer, LayerProps } from '../../doc/layer'
import { encodePng } from '../../io/bwk'
import { encodePsd } from '../../io/psd'
import { t } from '../../i18n'
import * as clip from './clipboard'
import * as ops from './ops'

/** All user-facing layer commands in one place (panel, menus, shortcuts and gestures call these). */
export class LayerActions {
  constructor(
    private app: App,
    private toast: (m: string) => void
  ) {}

  private get doc(): import('../../doc/document').Document {
    return this.app.doc
  }

  private run(fn: () => void): void {
    try {
      fn()
    } catch (e) {
      this.toast(e instanceof LayerLimitError ? e.message : t('layers.toast.failed') + (e as Error).message)
      console.error(e)
    }
  }
  private msg(m: string | null): void {
    if (m) this.toast(m)
  }
  private target(id?: string): Layer | null {
    return this.doc.getLayer(id ?? this.doc.activeId) ?? null
  }

  newLayer = (): void => this.run(() => void this.doc.addLayer())
  newGroup = (): void => this.run(() => void this.doc.groupLayers(this.doc.selectedLayerIds().length ? this.doc.selectedLayerIds() : [this.doc.activeId]))
  duplicate = (id?: string): void => this.run(() => void this.doc.duplicateLayer(id ?? this.doc.activeId))
  remove = (id?: string): void => {
    const l = this.target(id)
    if (!l) return
    const sel = this.doc.selectedLayerIds()
    if (!id && sel.length > 1) this.doc.transaction('Delete layers', 'layer-delete', null, () => sel.forEach((s) => this.doc.deleteLayer(s)))
    else this.doc.deleteLayer(l.id)
  }
  ungroup = (id?: string): void => this.doc.ungroup(id ?? this.doc.activeId)
  clear = (id?: string): void => {
    const l = this.target(id)
    if (l?.locked) return this.toast(t('layers.toast.layerLocked'))
    if (l?.isGroup) return
    if (l) this.doc.clearLayer(l.id)
  }
  fill = (id?: string): void => {
    const l = this.target(id)
    if (!l || l.isGroup) return void this.toast(t('layers.toast.selectLayer'))
    if (l.locked) return void this.toast(t('layers.toast.layerLocked'))
    ops.fillLayer(this.doc, l, hsvToRgb(this.app.state.color))
  }
  invert = (id?: string): void => {
    const l = this.target(id)
    if (!l || l.isGroup) return void this.toast(t('layers.toast.selectLayer'))
    if (l.locked) return void this.toast(t('layers.toast.layerLocked'))
    ops.invertLayer(this.doc, l)
  }
  mergeDown = (id?: string): void => this.run(() => this.msg(ops.mergeDown(this.doc, id ?? this.doc.activeId, false)))
  combineDown = (id?: string): void => this.run(() => this.msg(ops.mergeDown(this.doc, id ?? this.doc.activeId, true)))
  mergeSelected = (): void => this.run(() => this.msg(ops.mergeLayers(this.doc, this.doc.selectedLayerIds())))
  mergeGroup = (id?: string): void => this.run(() => this.msg(ops.mergeGroup(this.doc, id ?? this.doc.activeId)))
  flatten = (): void => this.run(() => this.msg(ops.flattenAll(this.doc)))
  /** merge = smart: multi-selection merges the selection, group merges the group, otherwise merge down */
  mergeSmart = (): void => {
    const l = this.doc.activeLayer
    if (this.doc.selectedLayerIds().length > 1) this.mergeSelected()
    else if (l?.isGroup) this.mergeGroup(l.id)
    else this.mergeDown()
  }

  toggle = (key: keyof LayerProps, id?: string): void => {
    const l = this.target(id)
    if (!l) return
    if (key === 'clipping' && l.isGroup) return
    this.doc.setLayerProps(l.id, { [key]: !l[key] } as Partial<LayerProps>)
  }
  setReference = (id?: string): void => {
    const l = this.target(id)
    if (!l || l.isGroup) return
    this.doc.setReference(l.id, !l.reference)
  }

  // ---- masks
  addMask = (fill: 'white' | 'black' | 'selection' = 'white', id?: string): void => {
    const l = this.target(id)
    if (!l) return
    if (l.mask) return void this.toast(t('layers.toast.maskExists'))
    if (l.isGroup) {
      this.doc.setMask(l.id, fill === 'selection' ? this.selectionMask() : this.doc.createMaskSurface(fill !== 'black'))
      return
    }
    ops.addMask(this.doc, l, fill)
  }
  private selectionMask(): import('../../gl/gpu').Surface {
    const s = this.doc.createMaskSurface(false)
    ops.opToSurface(this.doc, this.doc.scratch, s, { op: ops.Op.SelectionToMask })
    return s
  }
  maskEnable = (id?: string): void => {
    const l = this.target(id)
    if (l?.mask) this.doc.setLayerProps(l.id, { maskEnabled: !l.maskEnabled })
  }
  maskShow = (id?: string): void => {
    const l = this.target(id)
    if (l?.mask) this.doc.setLayerProps(l.id, { maskView: !l.maskView })
  }
  maskInvert = (id?: string): void => {
    const l = this.target(id)
    if (l) ops.invertMask(this.doc, l)
  }
  maskClear = (id?: string): void => {
    const l = this.target(id)
    if (l) ops.clearMask(this.doc, l)
  }
  maskApply = (id?: string): void => {
    const l = this.target(id)
    if (!l) return
    if (l.isGroup) return void this.toast(t('layers.toast.mergeGroupFirst'))
    if (l.locked) return void this.toast(t('layers.toast.layerLocked'))
    ops.applyMask(this.doc, l)
  }
  maskDelete = (id?: string): void => this.doc.removeMask(id ?? this.doc.activeId)
  /** select the mask (paint on it) or go back to the layer pixels */
  editMask = (on: boolean, id?: string): void => {
    const l = this.target(id)
    if (!l?.mask) return
    l.editingMask = on
    if (on && !l.maskEnabled) this.doc.setLayerProps(l.id, { maskEnabled: true })
    this.doc.setActive(l.id)
    this.doc.events.emit('layers', undefined)
  }

  // ---- selection / clipboard / export
  selectAlpha = (id?: string): void => {
    const l = this.target(id)
    if (!l || l.isGroup) return void this.toast(t('layers.toast.selectLayer'))
    const sel = (this.app as any).selection as { setFromFull?(a: Uint8Array, label: string): void } | undefined
    if (!sel?.setFromFull) return void this.toast(t('layers.toast.selectionNotAvailable'))
    const px = this.doc.gpu.readRGBA8(l.pixels, { x: 0, y: 0, w: this.doc.width, h: this.doc.height })
    const a = new Uint8Array(this.doc.width * this.doc.height)
    for (let i = 0; i < a.length; i++) a[i] = px[i * 4 + 3]
    sel.setFromFull(a, 'Select layer')
  }
  copy = (): void => void clip.copy(this.app)
  cut = (): void => void clip.cut(this.app)
  copyAll = (): void => void clip.copyAll(this.app)
  paste = (): void => void clip.paste(this.app)
  duplicateSel = (): void => clip.duplicate(this.app)
  cutAndPaste = (): void => clip.cutAndPaste(this.app)
  insertFile = (): void => void clip.insertFile(this.app, false)
  insertPhoto = (): void => void clip.insertFile(this.app, true)

  exportLayer = async (kind: 'png' | 'psd', id?: string): Promise<void> => {
    const l = this.target(id)
    const api = window.brushwork
    if (!l || l.isGroup || !api) return void this.toast(t('layers.toast.selectLayerExport'))
    const d = this.doc
    const px = d.gpu.readRGBA8(l.pixels, { x: 0, y: 0, w: d.width, h: d.height })
    const name = l.name.replace(/[^\w\- ]+/g, '_')
    const data =
      kind === 'png'
        ? await encodePng(px, d.width, d.height)
        : encodePsd(d.width, d.height, [{ name: l.name, visible: l.visible, opacity: l.opacity, blendMode: l.blendMode, clipping: false, pixels: { x: 0, y: 0, width: d.width, height: d.height, data: px } }])
    const r = await api.saveFile({ defaultName: `${name}.${kind}`, filters: [{ name: kind.toUpperCase(), extensions: [kind] }], data })
    if (r) this.toast(t('layers.toast.layerExported'))
  }

  /** Move active selection one step through the layer list (PageUp / PageDown). */
  step(dir: 1 | -1): void {
    const rows = this.doc.layers
    const i = rows.findIndex((l) => l.id === this.doc.activeId)
    const n = rows[i + dir]
    if (n) this.doc.setActive(n.id)
  }
}

const instances = new WeakMap<App, LayerActions>()
/** One LayerActions per App (toast is taken from the first caller). */
export function actionsFor(app: App, toast: (m: string) => void): LayerActions {
  let a = instances.get(app)
  if (!a) instances.set(app, (a = new LayerActions(app, toast)))
  return a
}
