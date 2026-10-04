import { BrushPreset, TaperSide } from './brush'
import { ColorShift, RGB, isNoShift, shiftColor } from './colorDyn'
import { makePressureCurve } from './pressure'
import type { PathPoint } from './stroke'
import type { Dab } from './types'

/** One stamp with everything the GPU needs. */
export interface DabEx extends Dab {
  /** colour after colour dynamics (straight 0..1) */
  r: number
  g: number
  b: number
  /** bit0 flip X, bit1 flip Y */
  flags: number
  /** grain depth for this stamp */
  depth: number
  /** grain offset (px) */
  gx: number
  gy: number
  /** extra edge softness 0..1 (bleed / gradation) */
  soft: number
  /** wet mix dilution 0..1 */
  dil: number
  /** wet mix blur 0..1 */
  blur: number
  /** grain scale multiplier (size compression) */
  gmul: number
  /** path distance from the stroke start (px) */
  dist: number
}

export interface StrokeState {
  randAngle: number
  grainX: number
  grainY: number
  strokeShift: ColorShift
  colorActive: boolean
  brushCurve: ((p: number) => number) | null
}

export interface DynamicsContext {
  /** Diameter in px from the size slider. */
  baseSize: number
  /** Pressure after the pressure curve was applied. */
  curve: (p: number) => number
  /** Random source 0..1 (seedable for tests). */
  rand: () => number
  color?: RGB
  secondary?: RGB
  /** radians to subtract from tip rotation so shapes ignore canvas rotation */
  orientOffset?: number
  pointerType?: 'pen' | 'mouse' | 'touch'
  /** grain/shape/etc. state for the current stroke (created lazily) */
  st?: StrokeState
}

/** mulberry32 */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
const DEG = Math.PI / 180
const smooth = (t: number): number => {
  const x = clamp01(t)
  return x * x * (3 - 2 * x)
}

function tiltMagnitude(tiltX: number, tiltY: number): number {
  // 0 = upright, 1 = flat on tablet
  return Math.min(1, Math.hypot(tiltX, tiltY) / 90)
}

/** Tilt in 0..1 after the trigger angle of the tilt graph. */
export function tiltAmount(b: BrushPreset, tiltX: number, tiltY: number): number {
  const deg = Math.min(90, Math.hypot(tiltX, tiltY))
  const trig = Math.min(89, Math.max(0, b.dynamics.tiltTrigger))
  return clamp01((deg - trig) / (90 - trig))
}

/** 0..1 barrel roll position (0 at 0 degrees, 1 at 180). */
export const rollAmount = (twist: number): number => 0.5 - 0.5 * Math.cos((twist || 0) * DEG)

/** Normalised speed 0..1 (px/ms; ~3 px/ms is a fast flick). */
export const speedNorm = (speed: number | undefined): number => clamp01((speed ?? 0) / 3)

/** Diameter at a point (no randomness) - used for spacing. */
export function sizeAt(b: BrushPreset, baseSize: number, pressure: number, tiltX = 0, tiltY = 0): number {
  const d = b.dynamics
  let s = baseSize * lerp(1 - d.pressureSize, 1, pressure)
  if (d.tiltSize) s *= 1 + d.tiltSize * tiltMagnitude(tiltX, tiltY)
  return Math.max(0.3, s)
}

export function makeStrokeState(b: BrushPreset, ctx: DynamicsContext): StrokeState {
  const rand = ctx.rand
  const cj = b.color.strokeJitter
  const strokeShift: ColorShift = {
    hue: cj.hue ? (rand() * 2 - 1) * cj.hue * 180 : 0,
    sat: cj.saturation ? (rand() * 2 - 1) * cj.saturation : 0,
    light: cj.lightness ? (rand() * 2 - 1) * cj.lightness : 0,
    dark: cj.darkness ? rand() * cj.darkness : 0,
    sec: cj.secondary ? rand() * cj.secondary : 0
  }
  const c = b.color
  const inputs = [c.pressure, c.tilt, c.roll]
  const stamp = c.stampJitter
  const colorActive =
    !isNoShift(strokeShift) ||
    Object.values(stamp).some((v) => v !== 0) ||
    inputs.some((i) => i.hue || i.saturation || i.lightness || i.secondary) ||
    Object.values(cj).some((v) => v !== 0)
  const curve = b.dynamics.pressureCurve
  return {
    randAngle: b.shape.randomize ? rand() * Math.PI * 2 : 0,
    grainX: rand() * 4096 * b.grain.offsetJitter,
    grainY: rand() * 4096 * b.grain.offsetJitter,
    strokeShift,
    colorActive,
    brushCurve: curve && curve.length >= 2 ? makePressureCurve({ points: curve }) : null
  }
}

function pressureOf(b: BrushPreset, ctx: DynamicsContext, raw: number): number {
  const st = ctx.st ?? (ctx.st = makeStrokeState(b, ctx))
  const p = ctx.curve(raw)
  return st.brushCurve ? st.brushCurve(p) : p
}

/** Base spacing distance (px) after which the next dab is placed. */
export function spacingPx(
  b: BrushPreset,
  ctx: DynamicsContext,
  s: { pressure: number; tiltX: number; tiltY: number; twist?: number; speed?: number }
): number {
  const pr = pressureOf(b, ctx, s.pressure)
  const d = b.dynamics
  let size = ctx.baseSize * lerp(1 - d.pressureSize, 1, pr)
  if (d.tiltSize) size *= 1 + d.tiltSize * tiltAmount(b, s.tiltX, s.tiltY)
  if (d.rollSize) size *= 1 + d.rollSize * (rollAmount(s.twist ?? 0) - 0.5)
  if (d.speedSize) size *= Math.max(0.1, 1 + d.speedSize * speedNorm(s.speed))
  size = Math.max(0.3, size)
  let sp = size * b.spacing
  if (d.speedSpacing) sp *= Math.max(0.15, 1 + d.speedSpacing * speedNorm(s.speed))
  if (b.path.spacingJitter) sp *= Math.max(0.1, 1 + b.path.spacingJitter * (ctx.rand() * 2 - 1))
  return Math.max(0.25, sp)
}

/** Taper length in px for a 0..1 slider value. */
export const taperLengthPx = (pct: number, size: number): number => pct * (100 + size * 6)

export function taperSide(b: BrushPreset, pointerType: string | undefined): TaperSide {
  return pointerType && pointerType !== 'pen' ? b.taper.touch : b.taper.pressure
}

export function taperActive(b: BrushPreset): { start: boolean; end: boolean } {
  const chk = (t: TaperSide): { start: boolean; end: boolean } => ({ start: t.start > 0, end: (b.taper.linked ? t.start : t.end) > 0 })
  const a = chk(b.taper.pressure)
  const c = chk(b.taper.touch)
  return { start: a.start || c.start, end: a.end || c.end }
}

/**
 * Size and alpha multipliers of a taper at `dist` px from a stroke end (start or end).
 * The profile goes 0 (tip) -> 1 (full) over the taper length.
 */
export function taperFactors(b: BrushPreset, side: TaperSide, which: 'start' | 'end', dist: number, baseSize: number, pressure: number): { size: number; alpha: number } {
  const pct = which === 'end' && !b.taper.linked ? side.end : side.start
  if (pct <= 0) return { size: 1, alpha: 1 }
  let len = taperLengthPx(pct, baseSize)
  if (side.pressure > 0) len *= lerp(1, 0.35 + 1.3 * pressure, side.pressure)
  const t = clamp01(dist / Math.max(1, len))
  if (t >= 1) return { size: 1, alpha: 1 }
  const tip = b.taper.classic ? 0 : side.tip
  const round = Math.sqrt(1 - (1 - t) * (1 - t))
  const prof = lerp(t, round, tip)
  const minS = 1 - side.size * 0.96
  return { size: lerp(minS, 1, prof), alpha: b.taper.classic ? 1 : lerp(1 - side.opacity, 1, prof) }
}

/** Apply end taper to an already computed dab (used on stroke end when the length is known). */
export function applyEndTaper(b: BrushPreset, d: DabEx, remaining: number, baseSize: number, pointerType: string | undefined, pressure: number): void {
  const f = taperFactors(b, taperSide(b, pointerType), 'end', remaining, baseSize, pressure)
  if (f.size >= 1 && f.alpha >= 1) return
  d.size = Math.max(0.3, d.size * f.size)
  d.alpha *= f.alpha
}

/** All dabs for one path point (count > 1 yields several stamps). */
export function computeDabs(b: BrushPreset, p: PathPoint, ctx: DynamicsContext): DabEx[] {
  const d = b.dynamics
  const sh = b.shape
  const pa = b.path
  const gr = b.grain
  const rand = ctx.rand
  const st = ctx.st ?? (ctx.st = makeStrokeState(b, ctx))
  const pr = pressureOf(b, ctx, p.pressure)
  const tilt = tiltAmount(b, p.tiltX, p.tiltY)
  const roll = rollAmount(p.twist)
  const sn = speedNorm(p.speed)
  const ptype = p.pointerType ?? ctx.pointerType

  let size = ctx.baseSize * lerp(1 - d.pressureSize, 1, pr)
  if (d.tiltSize) size *= 1 + d.tiltSize * tilt
  if (d.rollSize) size *= 1 + d.rollSize * (roll - 0.5)
  if (d.speedSize) size *= Math.max(0.1, 1 + d.speedSize * sn)
  if (d.tiltGradation) size *= 1 + 0.5 * d.tiltGradation * tilt
  size = Math.max(0.3, size)

  let alpha = b.flow * lerp(1 - d.pressureOpacity, 1, pr)
  if (d.pressureFlow) alpha *= lerp(1 - d.pressureFlow, 1, pr * pr)
  if (d.tiltOpacity) alpha *= 1 - d.tiltOpacity * tilt
  if (d.tiltGradation) alpha *= 1 - 0.4 * d.tiltGradation * tilt
  if (d.rollOpacity) alpha *= lerp(1 - d.rollOpacity, 1, roll)
  if (d.speedOpacity) alpha *= Math.min(1.5, Math.max(0, 1 + d.speedOpacity * sn))
  if (pa.fallOff > 0) alpha *= 1 - pa.fallOff * smooth(p.distance / Math.max(1, pa.fallOffLength))

  // taper (start only; the end is applied when the stroke length is known)
  const side = taperSide(b, ptype)
  if (side.start > 0) {
    const f = taperFactors(b, side, 'start', p.distance, ctx.baseSize, pr)
    size = Math.max(0.3, size * f.size)
    alpha *= f.alpha
  }
  if (d.taperStart > 0) size *= Math.min(1, 0.15 + 0.85 * (p.distance / (d.taperStart * ctx.baseSize + 1e-6)))

  let soft = 0
  if (d.pressureBleed) soft += d.pressureBleed * pr
  if (d.tiltBleed) soft += d.tiltBleed * tilt
  if (d.rollBleed) soft += d.rollBleed * roll
  if (d.tiltGradation) soft += d.tiltGradation * tilt
  soft = clamp01(soft * 0.7)

  // ---- rotation / roundness (per path point parts)
  let baseAngle = b.angle * DEG + sh.follow * p.angle
  if (sh.inputStyle !== 'touch' && (p.tiltX || p.tiltY)) baseAngle += Math.atan2(p.tiltY, p.tiltX)
  if (sh.inputStyle === 'azimuthRoll') baseAngle += (p.twist || 0) * DEG
  baseAngle += st.randAngle
  baseAngle -= ctx.orientOffset ?? 0

  let rn = b.roundness * lerp(1 - sh.pressureRoundness, 1, pr)
  if (d.tiltRoundness) rn *= 1 - d.tiltRoundness * tilt
  rn = Math.max(0.05, Math.min(1, rn))

  const gmulBase = d.sizeCompression > 0 ? Math.pow(Math.max(1, b.defaultSize) / size, d.sizeCompression) : 1
  const depth0 = gr.depth * lerp(gr.depthMin, 1, pr)

  // ---- colour parts that depend on the input only
  const base = ctx.color ?? [0, 0, 0]
  const sec = ctx.secondary ?? [1, 1, 1]
  const cc = b.color
  const inShift: ColorShift = { hue: 0, sat: 0, light: 0, dark: 0, sec: 0 }
  if (st.colorActive) {
    const acc = (c: { hue: number; saturation: number; lightness: number; secondary: number }, k: number): void => {
      inShift.hue += c.hue * 180 * k
      inShift.sat += c.saturation * k
      inShift.light += c.lightness * k
      inShift.sec += c.secondary * k
    }
    acc(cc.pressure, pr)
    acc(cc.tilt, tilt)
    acc(cc.roll, roll)
    inShift.hue += st.strokeShift.hue
    inShift.sat += st.strokeShift.sat
    inShift.light += st.strokeShift.light
    inShift.dark += st.strokeShift.dark
    inShift.sec += st.strokeShift.sec
  }

  let n = Math.max(1, Math.min(16, Math.round(sh.count)))
  if (sh.countJitter > 0 && n > 1) n = Math.max(1, Math.round(n * (1 - sh.countJitter * rand())))
  const ca = Math.cos(p.angle)
  const sa = Math.sin(p.angle)
  const out: DabEx[] = []
  for (let i = 0; i < n; i++) {
    let sz = size
    if (d.sizeJitter) sz *= 1 - d.sizeJitter * rand()
    // roundness jitter: independent scale of the two axes
    let sx = 1
    let sy = rn
    if (sh.roundnessJitterH) sx *= 1 - 0.9 * sh.roundnessJitterH * rand()
    if (sh.roundnessJitterV) sy *= 1 - 0.9 * sh.roundnessJitterV * rand()
    let major = sz * sx
    let minor = sz * sy
    let angle = baseAngle
    if (minor > major) {
      const t = major
      major = minor
      minor = t
      angle += Math.PI / 2
    }
    major = Math.max(0.3, major)
    const roundness = Math.max(0.05, Math.min(1, minor / major))
    if (d.angleJitter) angle += (rand() * 2 - 1) * d.angleJitter * DEG

    let a = alpha
    if (d.opacityJitter) a *= 1 - d.opacityJitter * rand()

    let x = p.x
    let y = p.y
    if (pa.lateralJitter || pa.linearJitter) {
      const lat = (rand() * 2 - 1) * pa.lateralJitter * size
      const lin = (rand() * 2 - 1) * pa.linearJitter * size
      x += ca * lin - sa * lat
      y += sa * lin + ca * lat
    }
    if (d.scatter) {
      const r = d.scatter * size
      x += (rand() * 2 - 1) * r
      y += (rand() * 2 - 1) * r
    }

    let r = base[0]
    let g = base[1]
    let bl = base[2]
    if (st.colorActive) {
      const sj = b.color.stampJitter
      const sft: ColorShift = {
        hue: inShift.hue + (sj.hue ? (rand() * 2 - 1) * sj.hue * 180 : 0),
        sat: inShift.sat + (sj.saturation ? (rand() * 2 - 1) * sj.saturation : 0),
        light: inShift.light + (sj.lightness ? (rand() * 2 - 1) * sj.lightness : 0),
        dark: inShift.dark + (sj.darkness ? rand() * sj.darkness : 0),
        sec: inShift.sec + (sj.secondary ? rand() * sj.secondary : 0)
      }
      const c = shiftColor(base, sec, sft)
      r = c[0]
      g = c[1]
      bl = c[2]
    }

    const wj = b.wet
    const dil = clamp01(wj.dilution + (wj.wetnessJitter ? (rand() * 2 - 1) * wj.wetnessJitter : 0) + 0.5 * soft)
    const blur = clamp01(wj.blur + (wj.blurJitter ? rand() * wj.blurJitter : 0))
    const offJ = gr.offsetJitter
    out.push({
      x,
      y,
      size: major,
      angle,
      alpha: Math.max(0, Math.min(1, a)),
      roundness,
      px: x,
      py: y,
      r,
      g,
      b: bl,
      flags: (sh.flipX ? 1 : 0) | (sh.flipY ? 2 : 0),
      depth: clamp01(depth0 * (gr.depthJitter ? 1 - gr.depthJitter * rand() : 1)),
      gx: gr.moving && offJ ? (rand() * 2 - 1) * 512 * offJ : st.grainX,
      gy: gr.moving && offJ ? (rand() * 2 - 1) * 512 * offJ : st.grainY,
      soft,
      dil,
      blur,
      gmul: gmulBase,
      dist: p.distance
    })
  }
  return out
}

/** Single-dab convenience (first stamp of the point). */
export function computeDab(b: BrushPreset, p: PathPoint, ctx: DynamicsContext): DabEx {
  return computeDabs(b, p, ctx)[0]
}
