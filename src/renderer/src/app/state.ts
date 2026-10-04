import { Emitter } from '../core/events'
import { LINEAR_CURVE, PressureCurveSettings } from '../core/pressure'
import { DEFAULT_SMOOTHING, SmoothingSettings } from '../core/smoothing'
import { getBrushPreset } from '../brush/presets'
import type { BrushPreset } from '../core/brush'

export type ToolId = 'brush' | 'smudge' | 'eraser'

export interface HSV {
  h: number // 0..360
  s: number // 0..1
  v: number // 0..1
}

export function hsvToRgb({ h, s, v }: HSV): [number, number, number] {
  const c = v * s
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r = 0
  let g = 0
  let b = 0
  if (hp < 1) [r, g, b] = [c, x, 0]
  else if (hp < 2) [r, g, b] = [x, c, 0]
  else if (hp < 3) [r, g, b] = [0, c, x]
  else if (hp < 4) [r, g, b] = [0, x, c]
  else if (hp < 5) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const m = v - c
  return [r + m, g + m, b + m]
}

export function rgbToHsv(r: number, g: number, b: number): HSV {
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const d = mx - mn
  let h = 0
  if (d > 0) {
    if (mx === r) h = ((g - b) / d) % 6
    else if (mx === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: mx === 0 ? 0 : d / mx, v: mx }
}

export const rgbToHex = (c: [number, number, number]): string =>
  '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

export const MAX_BRUSH_SIZE = 600
/** slider 0..1 <-> px diameter (perceptually spaced) */
export const sizeFromSlider = (t: number): number => 1 + (MAX_BRUSH_SIZE - 1) * Math.pow(Math.min(1, Math.max(0, t)), 2.2)
export const sliderFromSize = (px: number): number => Math.pow(Math.min(1, Math.max(0, (px - 1) / (MAX_BRUSH_SIZE - 1))), 1 / 2.2)

export interface ToolSettings {
  presetId: string
  size: number
  opacity: number
}

export interface StateEvents {
  tool: void
  color: void
  toolSettings: void
  settings: void
}

/** Global UI/tool state (not per-document). */
export class AppState {
  readonly events = new Emitter<StateEvents>()
  tool: ToolId = 'brush'
  /** set while a pen eraser end is in use */
  tempEraser = false
  color: HSV = { h: 215, s: 0.85, v: 0.35 }
  recentColors: string[] = []
  /** secondary colour (colour panel secondary swatch; feeds brush colour dynamics) */
  secondaryColor: HSV = { h: 0, s: 0, v: 1 }
  get secondaryRgb(): [number, number, number] {
    return hsvToRgb(this.secondaryColor)
  }
  setSecondaryColor(c: HSV): void {
    this.secondaryColor = { ...c }
    this.events.emit('color', undefined)
  }
  /** swap primary and secondary colours */
  swapColors(): void {
    const p = this.color
    this.color = { ...this.secondaryColor }
    this.secondaryColor = { ...p }
    this.events.emit('color', undefined)
  }
  toolSettings: Record<ToolId, ToolSettings> = {
    brush: { presetId: 'hard-round', size: 24, opacity: 1 },
    smudge: { presetId: 'smudge-soft', size: 60, opacity: 1 },
    eraser: { presetId: 'eraser-hard', size: 30, opacity: 1 }
  }
  smoothing: SmoothingSettings = { ...DEFAULT_SMOOTHING }
  /** null = use the brush preset's own streamline value */
  smoothingOverride: number | null = null
  pressureCurve: PressureCurveSettings = { points: [...LINEAR_CURVE.points] }
  mousePressure: 'constant' | 'velocity' = 'constant'
  touchDraws = true
  paintWithTouchWhenPenNear = false

  get effectiveTool(): ToolId {
    return this.tempEraser ? 'eraser' : this.tool
  }
  get settings(): ToolSettings {
    return this.toolSettings[this.effectiveTool]
  }
  /** Prefs "link": Smudge and Erase use the Paint brush shape (each tool keeps its own size/opacity) */
  linkBrushTools = false
  get preset(): BrushPreset {
    const id = this.linkBrushTools && this.effectiveTool !== 'brush' ? this.toolSettings.brush.presetId : this.settings.presetId
    return getBrushPreset(id) ?? getBrushPreset('hard-round')!
  }
  get rgb(): [number, number, number] {
    return hsvToRgb(this.color)
  }

  setTool(t: ToolId): void {
    this.tool = t
    this.events.emit('tool', undefined)
    this.events.emit('toolSettings', undefined)
  }
  setTempEraser(on: boolean): void {
    if (this.tempEraser === on) return
    this.tempEraser = on
    this.events.emit('tool', undefined)
    this.events.emit('toolSettings', undefined)
  }
  setColor(c: HSV, remember = false): void {
    this.color = { ...c }
    if (remember) {
      const hex = rgbToHex(hsvToRgb(c))
      this.recentColors = [hex, ...this.recentColors.filter((x) => x !== hex)].slice(0, 12)
    }
    this.events.emit('color', undefined)
  }
  setSize(px: number): void {
    const p = this.preset
    this.settings.size = Math.min(p.props.maxSize, Math.max(p.props.minSize, Math.min(MAX_BRUSH_SIZE, Math.max(1, px))))
    this.events.emit('toolSettings', undefined)
  }
  setOpacity(v: number): void {
    const p = this.preset
    this.settings.opacity = Math.min(p.props.maxOpacity, Math.max(p.props.minOpacity, 0.01, Math.min(1, v)))
    this.events.emit('toolSettings', undefined)
  }
  setPreset(tool: ToolId, presetId: string): void {
    const p = getBrushPreset(presetId)
    if (!p) return
    this.toolSettings[tool].presetId = presetId
    this.toolSettings[tool].size = Math.min(p.props.maxSize, Math.max(p.props.minSize, p.defaultSize))
    this.events.emit('toolSettings', undefined)
  }
}
