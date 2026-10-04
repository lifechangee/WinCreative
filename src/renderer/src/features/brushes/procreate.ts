import { t } from '../../i18n'
import { BrushInput } from '../../core/brush'
import { parseBplist, unarchive } from './bplist'

/**
 * Best-effort mapping of a Procreate Brush.archive (NSKeyedArchiver plist of a "SilicaBrush") to a Brushwork
 * BrushInput. Procreate's file format is undocumented; keys are looked up by several known/likely names and
 * everything not found keeps the defaults, so a brush always imports (shape + grain images carry most of the look).
 */
type Obj = Record<string, unknown>

function finder(o: Obj): (...names: string[]) => unknown {
  const lower = new Map<string, unknown>()
  for (const [k, v] of Object.entries(o)) lower.set(k.toLowerCase(), v)
  return (...names) => {
    for (const n of names) {
      const v = lower.get(n.toLowerCase())
      if (v !== undefined && v !== null) return v
    }
    return undefined
  }
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && isFinite(v) ? v : typeof v === 'boolean' ? (v ? 1 : 0) : undefined)
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v))

/** Procreate stores several blend modes as ints; map the common ones for grain. */
const GRAIN_BLEND_BY_INDEX = ['multiply', 'subtract', 'darken', 'linearBurn', 'colorBurn', 'lighten']

export interface ProcreateBrush {
  input: BrushInput
  /** relative names of the images referenced by the archive */
  shapeFile?: string
  grainFile?: string
}

export function parseProcreateArchive(bytes: Uint8Array, id: string): ProcreateBrush {
  const root = unarchive(parseBplist(bytes)) as Obj
  if (!root || typeof root !== 'object') throw new Error('Unreadable Brush.archive')
  return mapProcreate(root, id)
}

export function mapProcreate(o: Obj, id: string): ProcreateBrush {
  const f = finder(o)
  const n = (...names: string[]): number | undefined => num(f(...names))
  const name = typeof f('name') === 'string' ? (f('name') as string) : t('brushes.import.brush')
  const b: BrushInput = { id, name, category: 'paint', path: {}, stab: {}, taper: { pressure: {}, touch: {} }, shape: {}, grain: {}, render: {}, wet: {}, dynamics: {}, props: {}, dual: {} }
  const set = <T extends object>(target: T, key: keyof T, v: number | undefined, lo = 0, hi = 1): void => {
    if (v !== undefined) (target as Record<string, unknown>)[key as string] = clamp(v, lo, hi)
  }

  set(b, 'spacing', n('plotSpacing', 'spacing'), 0.005, 4)
  set(b.path!, 'spacingJitter', n('plotJitter', 'spacingJitter'))
  set(b.path!, 'lateralJitter', n('jitterLateral', 'plotJitterLateral', 'shapeJitterLateral'))
  set(b.path!, 'linearJitter', n('jitterLinear', 'plotJitterLinear', 'shapeJitterLinear'))
  set(b.path!, 'fallOff', n('dynamicsFalloff', 'falloff', 'plotFalloff'))
  set(b, 'streamline', n('plotSmoothing', 'streamline', 'smoothing', 'streamLine'))
  set(b.stab!, 'streamlinePressure', n('smoothingPressure', 'streamlinePressure'))
  set(b.stab!, 'stabilization', n('stabilization', 'stabilizationAmount'))
  set(b.stab!, 'motionFiltering', n('motionFiltering', 'motionFilteringAmount'))
  set(b.stab!, 'motionExpression', n('motionFilteringExpression', 'motionExpression'))

  const tp = b.taper!.pressure!
  set(tp, 'start', n('taperStartLength', 'pressureTaperStart', 'taperSize'))
  set(tp, 'end', n('taperEndLength', 'pressureTaperEnd'))
  set(tp, 'size', n('taperSizeAmount', 'taperTipSize', 'pressureTaperSize'))
  set(tp, 'opacity', n('taperOpacityTip', 'taperOpacity', 'pressureTaperOpacity'))
  set(tp, 'tip', n('taperTip', 'taperTipSharpness', 'pressureTaperTip'))
  set(tp, 'pressure', n('taperPressure', 'pressureTaperPressure'))
  const tt = b.taper!.touch!
  set(tt, 'start', n('touchTaperStartLength', 'touchTaperStart'))
  set(tt, 'end', n('touchTaperEndLength', 'touchTaperEnd'))
  set(tt, 'size', n('touchTaperSize'))
  set(tt, 'opacity', n('touchTaperOpacity'))

  const sh = b.shape!
  set(sh, 'follow', n('shapeRotation', 'rotation'))
  const orient = n('shapeOrientation', 'shapeAzimuth')
  if (orient) sh.inputStyle = orient >= 2 ? 'azimuthRoll' : 'azimuth'
  const scatter = n('shapeScatter', 'scatter')
  if (scatter !== undefined) b.dynamics!.angleJitter = clamp(scatter, 0, 1) * 180
  set(sh, 'count', n('shapeCount', 'count'), 1, 16)
  set(sh, 'countJitter', n('shapeCountJitter', 'countJitter'))
  const rnd = n('shapeRandomise', 'shapeRandomize', 'randomise')
  if (rnd !== undefined) sh.randomize = rnd > 0
  const inv = n('shapeInverted', 'shapeInvert')
  if (inv !== undefined) sh.invert = inv > 0
  const flipX = n('shapeFlipX')
  if (flipX !== undefined) sh.flipX = flipX > 0
  const flipY = n('shapeFlipY')
  if (flipY !== undefined) sh.flipY = flipY > 0
  const round = n('shapeRoundness', 'roundness')
  if (round !== undefined) b.roundness = clamp(round > 1 ? round / 100 : round, 0.05, 1)
  set(sh, 'pressureRoundness', n('dynamicsPressureRoundness', 'pressureRoundness'))
  set(sh, 'roundnessJitterV', n('shapeRoundnessJitter', 'roundnessJitter'))

  const gr = b.grain!
  set(gr, 'depth', n('textureDepth', 'grainDepth'))
  const gs = n('textureScale', 'grainScale')
  if (gs !== undefined) gr.scale = clamp(gs, 0.05, 8)
  const mv = n('textureMovement', 'grainMovement')
  if (mv !== undefined) {
    gr.moving = mv > 0
    gr.movement = clamp(mv, 0, 1)
  }
  const gz = n('textureZoom', 'grainZoom')
  if (gz !== undefined) gr.zoomCropped = gz > 0
  const gRot = n('textureRotation', 'grainRotation')
  if (gRot !== undefined) gr.rotation = (gRot <= 1 ? gRot * 360 : gRot) % 360
  set(gr, 'depthJitter', n('textureDepthJitter', 'grainDepthJitter'))
  set(gr, 'offsetJitter', n('textureOffsetJitter', 'grainOffsetJitter'))
  set(gr, 'depthMin', n('textureDepthMinimum', 'grainDepthMinimum'))
  const gb = n('textureBlendMode', 'grainBlendMode')
  if (gb !== undefined && GRAIN_BLEND_BY_INDEX[gb]) gr.blend = GRAIN_BLEND_BY_INDEX[gb] as 'multiply'
  const bright = n('textureBrightness', 'grainBrightness')
  if (bright !== undefined) gr.brightness = clamp(bright, -1, 1)
  const contrast = n('textureContrast', 'grainContrast')
  if (contrast !== undefined) gr.contrast = clamp(contrast, 0, 3)

  set(b, 'flow', n('flow', 'dynamicsFlow'))
  set(b, 'wetEdge', n('wetEdges', 'wetEdge'))
  set(b.render!, 'burnt', n('burntEdges', 'burntEdge'))
  set(b.render!, 'alphaThreshold', n('alphaThreshold'))
  const lum = n('luminanceBlending', 'luminance')
  if (lum !== undefined) b.render!.luminance = lum > 0

  set(b.wet!, 'dilution', n('dilution'))
  set(b.wet!, 'charge', n('charge'))
  set(b.wet!, 'attack', n('attack'))
  set(b.wet!, 'pull', n('pull'))
  set(b.wet!, 'grade', n('grade'))
  set(b.wet!, 'blur', n('blur'))
  set(b.wet!, 'blurJitter', n('blurJitter'))
  set(b.wet!, 'wetnessJitter', n('wetnessJitter'))
  const blendy = n('dynamicsMixing', 'blendMode')
  void blendy

  const dy = b.dynamics!
  set(dy, 'pressureSize', n('dynamicsPressureSize', 'pressureSize'))
  set(dy, 'pressureOpacity', n('dynamicsPressureOpacity', 'pressureOpacity'))
  set(dy, 'pressureFlow', n('dynamicsPressureFlow'))
  set(dy, 'pressureBleed', n('dynamicsPressureBleed'))
  set(dy, 'tiltSize', n('dynamicsTiltSize', 'tiltSize'))
  set(dy, 'tiltOpacity', n('dynamicsTiltOpacity', 'tiltOpacity'))
  set(dy, 'tiltGradation', n('dynamicsTiltGradation', 'tiltGradation'))
  set(dy, 'speedSize', n('dynamicsSpeedSize', 'speedSize'), -1, 1)
  set(dy, 'speedOpacity', n('dynamicsSpeedOpacity', 'speedOpacity'), -1, 1)
  set(dy, 'speedSpacing', n('dynamicsSpeedSpacing'), -1, 1)
  set(dy, 'sizeJitter', n('dynamicsJitterSize', 'jitterSize'))
  set(dy, 'opacityJitter', n('dynamicsJitterOpacity', 'jitterOpacity'))
  set(dy, 'sizeCompression', n('sizeCompression'))

  const pr = b.props!
  const ors = n('orientToScreen')
  if (ors !== undefined) pr.orientToScreen = ors > 0
  set(pr, 'maxSize', n('maxSize'), 1, 3000)
  set(pr, 'minSize', n('minSize'), 0, 3000)
  set(pr, 'maxOpacity', n('maxOpacity'))
  set(pr, 'minOpacity', n('minOpacity'))
  const sp = n('paintSize', 'defaultSize')
  if (sp !== undefined) b.defaultSize = clamp(sp <= 1 ? sp * 600 : sp, 1, 600)
  set(b, 'smudgeStrength', n('smudgeStrength', 'smudge'))
  const op = n('paintOpacity')
  void op

  const asName = (v: unknown): string | undefined => (typeof v === 'string' ? v.replace(/^.*[\\/]/, '') : undefined)
  return { input: b, shapeFile: asName(f('bundledShapePath', 'shapePath')), grainFile: asName(f('bundledGrainPath', 'grainPath', 'texturePath')) }
}
