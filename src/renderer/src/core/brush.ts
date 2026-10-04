/**
 * Brush definitions are plain JSON. A brush library can add presets by pushing BrushPreset
 * objects into the registry in brush/presets.ts (registerBrushPreset). Partial JSON is filled by
 * normalizeBrush, so presets only need to list the values that differ from the defaults.
 *
 * The parameter groups mirror Procreate's Brush Studio: path (Stroke Path), stab (Stabilization),
 * taper, shape, grain, render (Rendering), wet (Wet Mix), color (Color Dynamics), dynamics
 * (Dynamics + Pen), props (Properties), preview, dual (Dual Brush), cursor, about.
 */
export type BrushCategory = 'paint' | 'smudge' | 'erase'

export const RENDER_MODES = ['lightGlaze', 'uniformedGlaze', 'intenseGlaze', 'heavyGlaze', 'uniformBlending', 'intenseBlending'] as const
export type RenderMode = (typeof RENDER_MODES)[number]
export const RENDER_MODE_LABELS: Record<RenderMode, string> = {
  lightGlaze: 'Light Glaze',
  uniformedGlaze: 'Uniformed Glaze',
  intenseGlaze: 'Intense Glaze',
  heavyGlaze: 'Heavy Glaze',
  uniformBlending: 'Uniform Blending',
  intenseBlending: 'Intense Blending'
}
export const isBlendingMode = (m: RenderMode): boolean => m === 'uniformBlending' || m === 'intenseBlending'

export const GRAIN_BLENDS = ['multiply', 'subtract', 'darken', 'linearBurn', 'colorBurn', 'lighten'] as const
export type GrainBlend = (typeof GRAIN_BLENDS)[number]
export const GRAIN_BLEND_LABELS: Record<GrainBlend, string> = {
  multiply: 'Multiply',
  subtract: 'Subtract',
  darken: 'Darken',
  linearBurn: 'Linear Burn',
  colorBurn: 'Color Burn',
  lighten: 'Lighten'
}

export const DUAL_BLENDS = ['multiply', 'normal', 'darken', 'linearBurn', 'colorBurn', 'lighten', 'screen', 'add', 'subtract'] as const
export type DualBlend = (typeof DUAL_BLENDS)[number]
export const DUAL_BLEND_LABELS: Record<DualBlend, string> = {
  multiply: 'Multiply',
  normal: 'Normal',
  darken: 'Darken',
  linearBurn: 'Linear Burn',
  colorBurn: 'Color Burn',
  lighten: 'Lighten',
  screen: 'Screen',
  add: 'Add',
  subtract: 'Subtract'
}

export const BURNT_MODES = ['multiply', 'colorBurn', 'linearBurn', 'darken'] as const
export type BurntMode = (typeof BURNT_MODES)[number]

export type Filtering = 'none' | 'classic' | 'improved'
export type InputStyle = 'touch' | 'azimuth' | 'azimuthRoll'
export type CursorOutline = 'none' | 'contrast' | 'active'
export type HoverFill = 'none' | 'shape' | 'all'

export type CurvePts = [number, number][]

/** Start/end taper of a stroke (all values 0..1). */
export interface TaperSide {
  /** start taper length */
  start: number
  /** end taper length (ignored when `linked`) */
  end: number
  /** how thin the ends get */
  size: number
  /** how transparent the ends get */
  opacity: number
  /** how much the taper length reacts to pressure */
  pressure: number
  /** 0 sharp .. 1 chunky end shape */
  tip: number
}

export interface ColorJitter {
  hue: number
  saturation: number
  lightness: number
  darkness: number
  secondary: number
}
/** Signed (-1..1) for hue/saturation/lightness, 0..1 for secondary. */
export interface ColorInput {
  hue: number
  saturation: number
  lightness: number
  secondary: number
}

export interface BrushPreset {
  id: string
  name: string
  /** the tool this brush was designed for; any brush can be used with any tool */
  category: BrushCategory
  /** Default diameter in px (the size slider overrides at runtime). */
  defaultSize: number
  /** Shape texture id from the texture registry, or null for the procedural round tip. */
  tipTexture: string | null
  /** 0 (soft, wide falloff) .. 1 (hard, 1px AA edge). Procedural tip only. */
  hardness: number
  /** minor/major axis ratio 0.05..1 */
  roundness: number
  /** base tip rotation in degrees */
  angle: number
  /** distance between dabs as a fraction of diameter */
  spacing: number
  /** per-dab alpha (Photoshop "flow") */
  flow: number
  /** whole-stroke opacity cap default (UI opacity slider multiplies this) */
  opacity: number
  /** 0..1 how strongly edges are boosted (watercolor wet edge) */
  wetEdge: number
  /** Smudge Pull: how strongly each dab pulls the picked-up colour (default smudge strength) */
  smudgeStrength: number
  /** default StreamLine amount 0..1 */
  streamline: number

  path: {
    /** random variation of spacing 0..1 */
    spacingJitter: number
    /** random offset perpendicular to stroke (fraction of diameter) */
    lateralJitter: number
    /** random offset along the stroke (fraction of diameter) */
    linearJitter: number
    /** 0..1 how far the stroke fades out along fallOffLength */
    fallOff: number
    /** px of stroke over which the fall off happens */
    fallOffLength: number
  }

  stab: {
    /** smooths pressure variation 0..1 */
    streamlinePressure: number
    /** moving-average stabilisation 0..1 */
    stabilization: number
    /** adaptive low-pass that keeps corners 0..1 */
    motionFiltering: number
    /** restores expressiveness lost to filtering 0..1 */
    motionExpression: number
  }

  taper: {
    pressure: TaperSide
    touch: TaperSide
    /** same taper at both ends */
    linked: boolean
    /** legacy behaviour: linear size-only taper */
    classic: boolean
  }

  shape: {
    invert: boolean
    inputStyle: InputStyle
    /** 0 static .. 1 follows the stroke direction */
    follow: number
    /** start each stroke with a random rotation */
    randomize: boolean
    flipX: boolean
    flipY: boolean
    /** stamps per path point 1..16 */
    count: number
    countJitter: number
    pressureRoundness: number
    roundnessJitterV: number
    roundnessJitterH: number
    filtering: Filtering
  }

  grain: {
    texture: string | null
    /** fixed: texture pixels per document pixel (1 = 1:1); cropped: texture spans this many brush diameters */
    scale: number
    /** 0..1 */
    depth: number
    /** true: grain moves with the stamp; false: fixed to canvas (paper, "texturized") */
    moving: boolean
    /** moving: 0 = behaves like texturized .. 1 = fully dragged with the brush */
    movement: number
    /** true: grain scales with the brush (cropped); false: fixed scale */
    zoomCropped: boolean
    /** degrees */
    rotation: number
    /** depth at zero pressure as a fraction of depth (1 = constant) */
    depthMin: number
    depthJitter: number
    /** random grain position 0..1 */
    offsetJitter: number
    blend: GrainBlend
    /** -1..1 */
    brightness: number
    /** 0..3 (1 = neutral) */
    contrast: number
    invert: boolean
    filtering: Filtering
  }

  render: {
    mode: RenderMode
    /** 0..1 darker overlapping edges */
    burnt: number
    burntMode: BurntMode
    /** blend mode of the whole stroke onto the layer (a name from core/blend BLEND_MODES) */
    blendMode: string
    /** blend lightness only */
    luminance: boolean
    /** 0..1 hard cut of alpha (0 = off) */
    alphaThreshold: number
    classicCombine: boolean
  }

  wet: {
    dilution: number
    charge: number
    attack: number
    pull: number
    grade: number
    blur: number
    blurJitter: number
    wetnessJitter: number
  }

  color: {
    stampJitter: ColorJitter
    strokeJitter: ColorJitter
    pressure: ColorInput
    tilt: ColorInput
    roll: ColorInput
  }

  dynamics: {
    /** size = base * lerp(1-amount, 1, pressure) */
    pressureSize: number
    /** dab alpha = flow * lerp(1-amount, 1, pressure) */
    pressureOpacity: number
    pressureFlow: number
    pressureBleed: number
    /** editable pressure graph applied on top of the global curve (null = identity) */
    pressureCurve: CurvePts | null
    /** size grows with tilt: size *= 1 + amount * tilt(0..1) */
    tiltSize: number
    tiltOpacity: number
    /** soft shading when tilted */
    tiltGradation: number
    tiltBleed: number
    /** angle (degrees from upright, 0..90) at which the tilt effects start */
    tiltTrigger: number
    /** roundness squashes with tilt by this amount */
    tiltRoundness: number
    rollSize: number
    rollOpacity: number
    rollBleed: number
    /** 0..1: keeps texture from growing with size */
    sizeCompression: number
    /** -1..1 (negative = smaller when faster) */
    speedSize: number
    speedOpacity: number
    speedSpacing: number
    sizeJitter: number
    opacityJitter: number
    /** random rotation per stamp, degrees (0..180) */
    angleJitter: number
    /** random isotropic offset as fraction of diameter */
    scatter: number
    /** legacy: fade in the first N diameters of the stroke (0 = off) */
    taperStart: number
    /** @deprecated migrated to shape.follow */
    followStroke?: boolean
    /** @deprecated migrated to shape.inputStyle */
    tiltAngle?: boolean
  }

  props: {
    /** shape ignores canvas rotation */
    orientToScreen: boolean
    usePreviewStamp: boolean
    /** preview stroke scale 0.2..2 */
    previewSize: number
    maxSize: number
    minSize: number
    /** 0..1 */
    maxOpacity: number
    minOpacity: number
  }

  preview: {
    pressureMin: number
    pressureScale: number
    wetMix: boolean
    tiltAngle: number
  }

  dual: {
    enabled: boolean
    /** full secondary brush (edited with the same Brush Studio sections) */
    brush: BrushPreset | null
    mode: DualBlend
    /** secondary size relative to the primary (0.1..2) */
    size: number
    opacity: number
    flow: number
    /** secondary rotation follows the primary orientation */
    followOrient: boolean
    /** secondary size scales with the primary size */
    scaleFollow: boolean
  }

  cursor: {
    outline: CursorOutline
    hoverOpacity: number
    hoverFill: HoverFill
  }

  about: {
    author: string
    /** data URL */
    authorPicture: string
    /** data URL of a hand-drawn signature */
    signature: string
    created: string
    notes: string
  }

  /** JSON snapshot of the brush taken by "Create new reset point" (without this field) */
  resetPoint?: string
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends (infer U)[] | null ? T[K] : T[K] extends object | null ? DeepPartial<NonNullable<T[K]>> | null | undefined : T[K] }

/** Partial preset as found in library JSON; missing fields get defaults via normalizeBrush. */
export type BrushInput = DeepPartial<Omit<BrushPreset, 'id' | 'name' | 'dual'>> & {
  id: string
  name: string
  dual?: Partial<Omit<BrushPreset['dual'], 'brush'>> & { brush?: BrushInput | BrushPreset | null }
}

export const cloneBrush = (b: BrushPreset): BrushPreset => JSON.parse(JSON.stringify(b))

const taperDefault = (): TaperSide => ({ start: 0, end: 0, size: 0.7, opacity: 0, pressure: 0.5, tip: 0.5 })
const jitterDefault = (): ColorJitter => ({ hue: 0, saturation: 0, lightness: 0, darkness: 0, secondary: 0 })
const inputDefault = (): ColorInput => ({ hue: 0, saturation: 0, lightness: 0, secondary: 0 })

export function defaultBrush(id: string, name: string): BrushPreset {
  return {
    id,
    name,
    category: 'paint',
    defaultSize: 30,
    tipTexture: null,
    hardness: 0.8,
    roundness: 1,
    angle: 0,
    spacing: 0.1,
    flow: 1,
    opacity: 1,
    wetEdge: 0,
    smudgeStrength: 0.8,
    streamline: 0.2,
    path: { spacingJitter: 0, lateralJitter: 0, linearJitter: 0, fallOff: 0, fallOffLength: 400 },
    stab: { streamlinePressure: 0, stabilization: 0, motionFiltering: 0, motionExpression: 0.3 },
    taper: { pressure: taperDefault(), touch: taperDefault(), linked: true, classic: false },
    shape: {
      invert: false,
      inputStyle: 'touch',
      follow: 0,
      randomize: false,
      flipX: false,
      flipY: false,
      count: 1,
      countJitter: 0,
      pressureRoundness: 0,
      roundnessJitterV: 0,
      roundnessJitterH: 0,
      filtering: 'improved'
    },
    grain: {
      texture: null,
      scale: 1,
      depth: 0,
      moving: false,
      movement: 1,
      zoomCropped: false,
      rotation: 0,
      depthMin: 1,
      depthJitter: 0,
      offsetJitter: 0,
      blend: 'multiply',
      brightness: 0,
      contrast: 1,
      invert: false,
      filtering: 'improved'
    },
    render: { mode: 'lightGlaze', burnt: 0, burntMode: 'multiply', blendMode: 'normal', luminance: false, alphaThreshold: 0, classicCombine: false },
    wet: { dilution: 0.3, charge: 0.5, attack: 0.6, pull: 0.5, grade: 0, blur: 0, blurJitter: 0, wetnessJitter: 0 },
    color: { stampJitter: jitterDefault(), strokeJitter: jitterDefault(), pressure: inputDefault(), tilt: inputDefault(), roll: inputDefault() },
    dynamics: {
      pressureSize: 0.5,
      pressureOpacity: 0,
      pressureFlow: 0,
      pressureBleed: 0,
      pressureCurve: null,
      tiltSize: 0,
      tiltOpacity: 0,
      tiltGradation: 0,
      tiltBleed: 0,
      tiltTrigger: 0,
      tiltRoundness: 0,
      rollSize: 0,
      rollOpacity: 0,
      rollBleed: 0,
      sizeCompression: 0,
      speedSize: 0,
      speedOpacity: 0,
      speedSpacing: 0,
      sizeJitter: 0,
      opacityJitter: 0,
      angleJitter: 0,
      scatter: 0,
      taperStart: 0
    },
    props: { orientToScreen: false, usePreviewStamp: false, previewSize: 1, maxSize: 600, minSize: 1, maxOpacity: 1, minOpacity: 0 },
    preview: { pressureMin: 0.1, pressureScale: 1, wetMix: true, tiltAngle: 0 },
    dual: { enabled: false, brush: null, mode: 'multiply', size: 1, opacity: 1, flow: 1, followOrient: true, scaleFollow: true },
    cursor: { outline: 'contrast', hoverOpacity: 0, hoverFill: 'none' },
    about: { author: '', authorPicture: '', signature: '', created: '', notes: '' }
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function merge(base: any, over: any): any {
  if (!isObj(over)) return base
  const out: any = { ...base }
  for (const k of Object.keys(over)) {
    const v = over[k]
    if (v === undefined) continue
    if (isObj(v) && isObj(base[k])) out[k] = merge(base[k], v)
    else out[k] = v
  }
  return out
}

/** Fill in missing fields so partial JSON presets from a library are valid. */
export function normalizeBrush(p: BrushInput | BrushPreset, isSecondary = false): BrushPreset {
  const raw: any = p
  const base = defaultBrush(p.id, p.name)
  const { dual, ...rest } = raw
  const out: BrushPreset = merge(base, rest)
  // ---- migrate legacy dynamics flags
  const dyn: any = raw.dynamics ?? {}
  const sh: any = raw.shape ?? {}
  if (dyn.followStroke && sh.follow === undefined) out.shape.follow = 1
  if (dyn.tiltAngle && sh.inputStyle === undefined) out.shape.inputStyle = 'azimuth'
  delete out.dynamics.followStroke
  delete out.dynamics.tiltAngle
  // ---- dual brush
  const d: any = dual ?? {}
  out.dual = { ...base.dual, ...d, brush: null }
  if (d.brush && !isSecondary) out.dual.brush = normalizeBrush({ ...d.brush }, true)
  if (isSecondary) out.dual.enabled = false
  if (raw.resetPoint !== undefined) out.resetPoint = raw.resetPoint
  if (raw.dynamics && Array.isArray(raw.dynamics.pressureCurve)) out.dynamics.pressureCurve = raw.dynamics.pressureCurve.map((q: number[]) => [q[0], q[1]])
  return out
}

/** Copy of a brush suitable for the Dual Brush secondary slot. */
export function toSecondary(b: BrushPreset): BrushPreset {
  const c = cloneBrush(b)
  c.dual = { ...c.dual, enabled: false, brush: null }
  delete c.resetPoint
  return c
}

/** Effective size / opacity clamp from brush Properties. */
export const clampBrushSize = (b: BrushPreset, px: number): number => Math.min(b.props.maxSize, Math.max(b.props.minSize, px))
export const clampBrushOpacity = (b: BrushPreset, v: number): number => Math.min(b.props.maxOpacity, Math.max(b.props.minOpacity, v))
