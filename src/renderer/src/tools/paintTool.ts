import { t } from '../i18n'
import { BrushPreset, clampBrushOpacity, clampBrushSize } from '../core/brush'
import { StrokePipeline, DabSink } from '../core/pipeline'
import { makePressureCurve } from '../core/pressure'
import type { Sample } from '../core/types'
import type { PaintMode } from '../gl/brushEngine'
import type { Layer } from '../doc/layer'
import { brushUsed } from '../brush/presets'
import type { Tool, ToolHost } from './tool'
import { StrokeAdapter, StrokeApi, StrokeChannel, strokeHooks } from './strokeHooks'

/** One parallel copy of the stroke (symmetry makes several); each has its own stabiliser/path/smudge pickup/dual brush. */
interface Chan {
  def: StrokeChannel | null
  pipe: StrokePipeline
}

/**
 * Brush, Eraser and Smudge all share this pipeline (core/pipeline.ts): stabilisation -> path -> spacing ->
 * dynamics -> GPU stamps. `strokeHooks` adapters (Drawing Assist, symmetry, QuickShape) may filter input samples
 * and fan the stroke out into several channels; with no adapter there is exactly one identity channel.
 */
export class PaintTool implements Tool {
  private preset: BrushPreset | null = null
  private chans: Chan[] = []
  private adapter: StrokeAdapter | null = null
  private layer: Layer | null = null
  private beginParams: Parameters<ToolHost['engine']['begin']>[1] | null = null
  private size = 24
  private active = false
  private host!: ToolHost
  tip: { x: number; y: number } | null = null

  private api: StrokeApi = {
    layerId: '',
    mode: 'paint',
    replace: (samples) => this.replaceStroke(samples)
  }

  constructor(
    readonly id: string,
    private mode: PaintMode
  ) {}

  begin(s: Sample, host: ToolHost): boolean {
    const { doc, engine, state } = host
    this.host = host
    let layer = doc.activeLayer
    strokeHooks.beforeBegin(layer.id)
    layer = doc.activeLayer
    if (!layer.visible) {
      host.notify(t('core.tool.layerHidden'))
      return false
    }
    if (layer.isGroup) {
      host.notify(t('core.tool.selectInGroup'))
      return false
    }
    if (layer.locked) {
      host.notify(t('core.toast.layerLocked'))
      return false
    }
    const preset = state.preset
    this.preset = preset
    this.layer = layer
    this.size = clampBrushSize(preset, state.settings.size)
    this.adapter = strokeHooks.create({ first: s, layerId: layer.id, mode: this.mode, toolId: this.id })
    ;(this.api as { layerId: string; mode: PaintMode }).layerId = layer.id
    ;(this.api as { layerId: string; mode: PaintMode }).mode = this.mode
    this.tip = null
    this.makeChans(false)
    this.beginParams = { mode: this.mode, preset, color: state.rgb, opacity: clampBrushOpacity(preset, state.settings.opacity) * preset.opacity }
    engine.begin(layer, this.beginParams)
    brushUsed.emit('used', preset.id)
    this.active = true
    this.feed(s, host)
    return true
  }

  move(samples: Sample[], host: ToolHost): void {
    if (!this.active) return
    for (const s of samples) this.feed(s, host)
  }

  end(host: ToolHost): void {
    if (!this.active) return
    const extra = this.adapter?.end?.(this.api) ?? []
    for (const s of extra) this.feedThrough(s)
    this.active = false
    this.tip = null
    for (const c of this.chans) c.pipe.finish()
    if (this.chans.some((c) => c.pipe.needsRestamp)) {
      host.engine.restart?.()
      for (const c of this.chans) c.pipe.restamp()
    }
    const res = host.engine.end()
    if (res) {
      const type = res.mode === 'erase' ? 'erase' : res.mode === 'smudge' ? 'smudge' : 'stroke'
      host.doc.emitCommit(type, res.layerId, res.rect, type === 'erase' ? 'Erase' : type === 'smudge' ? 'Smudge' : 'Brush stroke')
    }
    this.adapter = null
    host.requestRender()
  }

  cancel(host: ToolHost): void {
    if (!this.active) return
    this.active = false
    this.tip = null
    this.adapter?.cancel?.()
    this.adapter = null
    host.engine.cancel()
    host.requestRender()
  }

  private makeChans(raw: boolean): void {
    const preset = this.preset!
    const st = this.host.state
    const engine = this.host.engine
    const view = (this.host as unknown as { view?: { rot: number } }).view
    const defs = this.adapter?.channels?.length ? this.adapter.channels : [null]
    const bypass = raw || !!this.adapter?.bypassSmoothing
    const seed = (performance.now() * 1000) | 0
    this.chans = defs.map((def, i) => {
      const sink: DabSink = {
        stamp: (dabs, target) => {
          if (target === 0 && dabs.length) {
            const d = dabs[dabs.length - 1]
            this.tip = { x: d.x, y: d.y }
          }
          engine.stamp(dabs, target)
        },
        restart: () => {}
      }
      const pipe = new StrokePipeline(
        {
          preset,
          size: this.size,
          mode: this.mode,
          color: st.rgb,
          secondary: st.secondaryRgb ?? [1, 1, 1],
          curve: makePressureCurve(st.pressureCurve),
          smoothing: { amount: st.smoothingOverride ?? preset.streamline, mode: st.smoothing.mode, lazyRadius: st.smoothing.lazyRadius },
          seed: seed + i * 101,
          orientOffset: view?.rot ?? 0,
          raw: bypass
        },
        sink
      )
      return { def, pipe }
    })
  }

  private feed(s: Sample, host: ToolHost): void {
    this.host = host
    if (!this.adapter) this.chans[0].pipe.push(s)
    else for (const o of this.adapter.input(s, this.api)) this.feedThrough(o)
    host.requestRender()
  }

  /** Feed one (already adapter-filtered) sample to every channel. */
  private feedThrough(o: Sample): void {
    for (const c of this.chans) c.pipe.push(c.def ? c.def.sample(o) : o)
  }

  /** QuickShape: throw away the live stroke and re-stamp it from exact samples. */
  private replaceStroke(samples: Sample[]): void {
    if (!this.active || this.mode === 'smudge' || !this.layer || !this.beginParams) return
    const engine = this.host.engine
    engine.cancel()
    engine.begin(this.layer, this.beginParams)
    this.makeChans(true)
    for (const s of samples) for (const c of this.chans) c.pipe.push(c.def ? c.def.sample(s) : s)
    this.host.requestRender()
  }
}
