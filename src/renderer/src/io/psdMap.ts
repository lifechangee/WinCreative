/**
 * Pure mapping of Photoshop text layers and adjustment layers (as read by ag-psd) onto Brushwork concepts.
 * No DOM / GPU; unit-tested in tests/psdMap.test.ts.
 */

// ------------------------------------------------------------------ text
/** Same shape as features/guides/text/model.ts TextData (kept structural so io/ does not depend on features/). */
export interface ImportedText {
  text: string
  style: {
    family: string
    size: number
    bold: boolean
    italic: boolean
    color: string
    tracking: number
    kerning: boolean
    leading: number
    baseline: number
    align: 'left' | 'center' | 'right' | 'justify'
    underline: boolean
    strike: boolean
    outlineWidth: number
    outlineColor: string
    caps: 'none' | 'upper' | 'lower' | 'small'
    vertical: boolean
    ligatures: boolean
  }
  spans: { start: number; end: number; color: string }[]
  x: number
  y: number
  w: number
  rot: number
}

interface PsdColorLike {
  r?: number
  g?: number
  b?: number
  fr?: number
  fg?: number
  fb?: number
  k?: number
}

const hex2 = (v: number): string => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
/** ag-psd colours: RGB 0..255, FRGB 0..1, grayscale `k` 0..255. */
export function psdColorToHex(c: PsdColorLike | undefined, fallback = '#000000'): string {
  if (!c) return fallback
  if (c.fr !== undefined && c.fg !== undefined && c.fb !== undefined) return '#' + hex2(c.fr * 255) + hex2(c.fg * 255) + hex2(c.fb * 255)
  if (c.r !== undefined && c.g !== undefined && c.b !== undefined) return '#' + hex2(c.r) + hex2(c.g) + hex2(c.b)
  if (c.k !== undefined) return '#' + hex2(c.k) + hex2(c.k) + hex2(c.k)
  return fallback
}

/** 'Arial-BoldMT' -> { family: 'Arial', bold: true }, 'TimesNewRomanPS-ItalicMT' -> Times New Roman / italic. */
export function familyFromPostScript(ps: string | undefined): { family: string; bold: boolean; italic: boolean } {
  if (!ps) return { family: 'Segoe UI', bold: false, italic: false }
  const [base, ...rest] = ps.split('-')
  const styleName = rest.join('-')
  const bold = /bold|black|heavy|semibold|demi/i.test(styleName) || /bold$/i.test(base)
  const italic = /italic|oblique/i.test(styleName)
  let fam = base.replace(/(PSMT|PS|MT|Std|Pro)$/i, '').replace(/(Bold|Italic)$/i, '')
  fam = fam.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').trim()
  return { family: fam || 'Segoe UI', bold, italic }
}

interface PsdTextLike {
  text: string
  transform?: number[]
  orientation?: string
  shapeType?: string
  boxBounds?: number[]
  style?: any
  styleRuns?: { length: number; style: any }[]
  paragraphStyle?: { justification?: string }
  paragraphStyleRuns?: { length: number; style: { justification?: string } }[]
}
interface PsdLayerLike {
  left?: number
  top?: number
  right?: number
  bottom?: number
  text?: PsdTextLike
}

/**
 * Convert a PSD text layer to a Brushwork text layer (first style run gives the base style, later runs with another
 * colour become colour spans). Position comes from the layer's pixel bounds so it lands where Photoshop drew it.
 */
export function psdTextToImported(l: PsdLayerLike): ImportedText | null {
  const t = l.text
  if (!t || typeof t.text !== 'string') return null
  const text = t.text.replace(/\r\n?/g, '\n').replace(/\u0003/g, '\n')
  const runs = t.styleRuns?.length ? t.styleRuns : [{ length: text.length, style: t.style ?? {} }]
  const base = { ...(t.style ?? {}), ...(runs[0]?.style ?? {}) }
  const tr = t.transform ?? [1, 0, 0, 1, 0, 0]
  const scale = Math.hypot(tr[2] ?? 0, tr[3] ?? 1) || 1
  const size = Math.max(1, (base.fontSize ?? 24) * scale)
  const f = familyFromPostScript(base.font?.name)
  const just = t.paragraphStyleRuns?.[0]?.style?.justification ?? t.paragraphStyle?.justification ?? 'left'
  const align = just.startsWith('justify') ? 'justify' : just === 'center' ? 'center' : just === 'right' ? 'right' : 'left'
  const color = psdColorToHex(base.fillColor)
  const spans: ImportedText['spans'] = []
  let pos = 0
  for (const r of runs) {
    const c = psdColorToHex((r.style ?? {}).fillColor ?? base.fillColor)
    if (c !== color && r.length > 0) spans.push({ start: pos, end: Math.min(text.length, pos + r.length), color: c })
    pos += r.length
  }
  const left = l.left ?? 0
  const right = l.right ?? left
  const top = l.top ?? 0
  const layerW = Math.max(0, right - left)
  let w = layerW
  if (t.shapeType === 'box' && t.boxBounds && t.boxBounds.length >= 4) w = Math.max(w, Math.abs(t.boxBounds[2] - t.boxBounds[0]) * scale)
  w = Math.max(40, Math.ceil(w + size * 0.2))
  const x = align === 'center' ? left + layerW / 2 - w / 2 : align === 'right' ? right - w : left
  const capsFlag = base.fontCaps ?? 0
  return {
    text,
    style: {
      family: f.family,
      size,
      bold: !!base.fauxBold || f.bold,
      italic: !!base.fauxItalic || f.italic,
      color,
      tracking: ((base.tracking ?? 0) / 1000) * size,
      kerning: base.autoKerning !== false,
      leading: base.autoLeading === false && base.leading ? Math.max(0.6, (base.leading * scale) / size) : 1.2,
      baseline: (base.baselineShift ?? 0) * scale,
      align,
      underline: !!base.underline,
      strike: !!base.strikethrough,
      outlineWidth: 0,
      outlineColor: '#ffffff',
      caps: capsFlag === 2 ? 'upper' : capsFlag === 1 ? 'small' : 'none',
      vertical: t.orientation === 'vertical',
      ligatures: base.ligatures !== false
    },
    spans,
    x,
    y: top - size * 0.2,
    w,
    rot: Math.atan2(tr[1] ?? 0, tr[0] ?? 1) || 0
  }
}

// ------------------------------------------------------------------ adjustment layers
export type CurvePoint = [number, number]
export interface MappedAdjustment {
  /** Brushwork adjustment id ('hsb', 'colorBalance', 'curves') or built-in filter id ('invert') */
  id: 'hsb' | 'colorBalance' | 'curves' | 'invert'
  params: Record<string, number>
  /** curves adjustment only */
  curves?: { master: CurvePoint[]; r: CurvePoint[]; g: CurvePoint[]; b: CurvePoint[] }
  approx?: boolean
}
export type AdjustmentMapping = { ok: true; adj: MappedAdjustment } | { ok: false; reason: string }

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))
const IDENT: CurvePoint[] = [
  [0, 0],
  [1, 1]
]
const sample = (f: (x: number) => number, n = 12): CurvePoint[] => Array.from({ length: n + 1 }, (_, i) => [i / n, clamp01(f(i / n))] as CurvePoint)

/** Levels channel -> transfer function (input black/white, gamma, output range). */
export function levelsCurve(c: { shadowInput: number; highlightInput: number; shadowOutput: number; highlightOutput: number; midtoneInput: number }): CurvePoint[] {
  const lo = c.shadowInput / 255
  const hi = Math.max(lo + 1e-3, c.highlightInput / 255)
  const gamma = Math.max(0.1, (c.midtoneInput || 100) / 100)
  const o0 = c.shadowOutput / 255
  const o1 = c.highlightOutput / 255
  return sample((x) => o0 + (o1 - o0) * Math.pow(clamp01((x - lo) / (hi - lo)), 1 / gamma))
}

/** Brightness / contrast as a curve (Photoshop's non-legacy behaviour, approximated). */
export function brightnessContrastCurve(brightness: number, contrast: number): CurvePoint[] {
  const k = Math.tan(((Math.max(-100, Math.min(100, contrast)) / 100 + 1) * Math.PI) / 4)
  const off = brightness / 255
  return sample((x) => (x - 0.5) * k + 0.5 + off * (1 - Math.abs(x - 0.5) * 0.5))
}

const toPts = (a: { input: number; output: number }[] | undefined): CurvePoint[] => (a && a.length >= 2 ? a.map((p) => [clamp01(p.input / 255), clamp01(p.output / 255)] as CurvePoint).sort((p, q) => p[0] - q[0]) : IDENT.map((p) => [...p] as CurvePoint))

/** Map an ag-psd adjustment to the closest Brushwork adjustment; unsupported kinds return a reason. */
export function mapAdjustment(a: { type: string; [k: string]: any }): AdjustmentMapping {
  switch (a.type) {
    case 'invert':
      return { ok: true, adj: { id: 'invert', params: {} } }
    case 'hue/saturation': {
      const m = a.master
      if (!m) return { ok: false, reason: 'hue/saturation without master channel' }
      const partial = ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas'].some((k) => a[k] && (a[k].hue || a[k].saturation || a[k].lightness))
      return { ok: true, adj: { id: 'hsb', params: { hue: 50 + (m.hue / 360) * 100, sat: 50 + m.saturation / 2, bri: 50 + m.lightness / 2 }, approx: partial } }
    }
    case 'color balance': {
      const s = a.shadows ?? {}
      const mi = a.midtones ?? {}
      const hi = a.highlights ?? {}
      return {
        ok: true,
        adj: {
          id: 'colorBalance',
          params: { shCR: s.cyanRed ?? 0, shMG: s.magentaGreen ?? 0, shYB: s.yellowBlue ?? 0, miCR: mi.cyanRed ?? 0, miMG: mi.magentaGreen ?? 0, miYB: mi.yellowBlue ?? 0, hiCR: hi.cyanRed ?? 0, hiMG: hi.magentaGreen ?? 0, hiYB: hi.yellowBlue ?? 0, preserve: a.preserveLuminosity === false ? 0 : 1 }
        }
      }
    }
    case 'curves':
      return { ok: true, adj: { id: 'curves', params: {}, curves: { master: toPts(a.rgb), r: toPts(a.red), g: toPts(a.green), b: toPts(a.blue) } } }
    case 'levels': {
      const ch = (c: any): CurvePoint[] => (c ? levelsCurve(c) : IDENT.map((p) => [...p] as CurvePoint))
      return { ok: true, adj: { id: 'curves', params: {}, curves: { master: ch(a.rgb), r: ch(a.red), g: ch(a.green), b: ch(a.blue) } } }
    }
    case 'brightness/contrast':
      return { ok: true, adj: { id: 'curves', params: {}, curves: { master: brightnessContrastCurve(a.brightness ?? 0, a.contrast ?? 0), r: IDENT.map((p) => [...p] as CurvePoint), g: IDENT.map((p) => [...p] as CurvePoint), b: IDENT.map((p) => [...p] as CurvePoint) }, approx: true } }
    default:
      return { ok: false, reason: a.type }
  }
}
