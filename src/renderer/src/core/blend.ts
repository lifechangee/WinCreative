/**
 * CPU reference implementation of the blend modes (W3C Compositing & Blending Level 1).
 * The GLSL in gl/shaders.ts mirrors these formulas; tests check this file.
 * Colours are NON-premultiplied RGB triples in 0..1.
 */
export type RGB = [number, number, number]

export const BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'softLight',
  'hardLight',
  'colorDodge',
  'colorBurn',
  'darken',
  'lighten',
  'difference',
  'exclusion',
  'add',
  'hue',
  'saturation',
  'color',
  'luminosity',
  // appended (indices 17+ are mirrored in gl/shaders.ts extF)
  'linearBurn',
  'darkerColor',
  'lighterColor',
  'vividLight',
  'linearLight',
  'pinLight',
  'hardMix',
  'subtract',
  'divide'
] as const
export type BlendMode = (typeof BLEND_MODES)[number]

export const BLEND_LABELS: Record<BlendMode, string> = {
  normal: 'Normal',
  multiply: 'Multiply',
  screen: 'Screen',
  overlay: 'Overlay',
  softLight: 'Soft Light',
  hardLight: 'Hard Light',
  colorDodge: 'Color Dodge',
  colorBurn: 'Color Burn',
  darken: 'Darken',
  lighten: 'Lighten',
  difference: 'Difference',
  exclusion: 'Exclusion',
  add: 'Add',
  hue: 'Hue',
  saturation: 'Saturation',
  color: 'Color',
  luminosity: 'Luminosity',
  linearBurn: 'Linear Burn',
  darkerColor: 'Darker Color',
  lighterColor: 'Lighter Color',
  vividLight: 'Vivid Light',
  linearLight: 'Linear Light',
  pinLight: 'Pin Light',
  hardMix: 'Hard Mix',
  subtract: 'Subtract',
  divide: 'Divide'
}

/** Blend mode picker groups (Procreate order). */
export const BLEND_GROUPS: { name: string; modes: BlendMode[] }[] = [
  { name: 'Normal', modes: ['normal'] },
  { name: 'Darken', modes: ['darken', 'multiply', 'colorBurn', 'linearBurn', 'darkerColor'] },
  { name: 'Lighten', modes: ['lighten', 'screen', 'colorDodge', 'add', 'lighterColor'] },
  { name: 'Contrast', modes: ['overlay', 'softLight', 'hardLight', 'vividLight', 'linearLight', 'pinLight', 'hardMix'] },
  { name: 'Comparative', modes: ['difference', 'exclusion', 'subtract', 'divide'] },
  { name: 'Component', modes: ['hue', 'saturation', 'color', 'luminosity'] }
]

export const blendIndex = (m: BlendMode): number => BLEND_MODES.indexOf(m)

const lum = (c: RGB): number => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]
const sat = (c: RGB): number => Math.max(...c) - Math.min(...c)

function clipColor(c: RGB): RGB {
  const l = lum(c)
  const n = Math.min(...c)
  const x = Math.max(...c)
  let r: RGB = [...c]
  if (n < 0) r = r.map((v) => l + ((v - l) * l) / (l - n)) as RGB
  if (x > 1) r = r.map((v) => l + ((v - l) * (1 - l)) / (x - l)) as RGB
  return r
}
const setLum = (c: RGB, l: number): RGB => {
  const d = l - lum(c)
  return clipColor([c[0] + d, c[1] + d, c[2] + d])
}
function setSat(c: RGB, s: number): RGB {
  const mx = Math.max(...c)
  const mn = Math.min(...c)
  if (mx <= mn) return [0, 0, 0]
  return c.map((v) => ((v - mn) * s) / (mx - mn)) as RGB
}

function softLight(cb: number, cs: number): number {
  if (cs <= 0.5) return cb - (1 - 2 * cs) * cb * (1 - cb)
  const d = cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb)
  return cb + (2 * cs - 1) * (d - cb)
}
const hardLight = (cb: number, cs: number): number => (cs <= 0.5 ? cb * 2 * cs : 1 - (1 - cb) * (1 - (2 * cs - 1)))
const dodge = (cb: number, cs: number): number => (cb === 0 ? 0 : cs >= 1 ? 1 : Math.min(1, cb / (1 - cs)))
const burn = (cb: number, cs: number): number => (cb >= 1 ? 1 : cs <= 0 ? 0 : 1 - Math.min(1, (1 - cb) / cs))

/** B(cb, cs): blended colour for backdrop cb and source cs (both non-premultiplied). */
export function blendColor(mode: BlendMode, cb: RGB, cs: RGB): RGB {
  const sep = (f: (b: number, s: number) => number): RGB => [f(cb[0], cs[0]), f(cb[1], cs[1]), f(cb[2], cs[2])]
  switch (mode) {
    case 'normal':
      return [...cs]
    case 'multiply':
      return sep((b, s) => b * s)
    case 'screen':
      return sep((b, s) => b + s - b * s)
    case 'overlay':
      return sep((b, s) => hardLight(s, b))
    case 'softLight':
      return sep(softLight)
    case 'hardLight':
      return sep(hardLight)
    case 'colorDodge':
      return sep(dodge)
    case 'colorBurn':
      return sep(burn)
    case 'darken':
      return sep(Math.min)
    case 'lighten':
      return sep(Math.max)
    case 'difference':
      return sep((b, s) => Math.abs(b - s))
    case 'exclusion':
      return sep((b, s) => b + s - 2 * b * s)
    case 'add':
      return sep((b, s) => Math.min(1, b + s))
    case 'hue':
      return setLum(setSat(cs, sat(cb)), lum(cb))
    case 'saturation':
      return setLum(setSat(cb, sat(cs)), lum(cb))
    case 'color':
      return setLum(cs, lum(cb))
    case 'luminosity':
      return setLum(cb, lum(cs))
    case 'linearBurn':
      return sep((b, s) => Math.max(0, b + s - 1))
    case 'darkerColor':
      return lum(cb) < lum(cs) ? [...cb] : [...cs]
    case 'lighterColor':
      return lum(cb) > lum(cs) ? [...cb] : [...cs]
    case 'vividLight':
      return sep((b, s) => (s <= 0.5 ? burn(b, 2 * s) : dodge(b, 2 * (s - 0.5))))
    case 'linearLight':
      return sep((b, s) => Math.min(1, Math.max(0, b + 2 * s - 1)))
    case 'pinLight':
      return sep((b, s) => (s < 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * (s - 0.5))))
    case 'hardMix':
      return sep((b, s) => (b + s >= 1 ? 1 : 0))
    case 'subtract':
      return sep((b, s) => Math.max(0, b - s))
    case 'divide':
      return sep((b, s) => (s <= 0 ? 1 : Math.min(1, b / s)))
  }
}

/**
 * Composite a source layer pixel over a backdrop pixel, PREMULTIPLIED in, PREMULTIPLIED out
 * (RGBA quadruples). `opacity` scales source alpha.
 */
export function compositePremult(mode: BlendMode, back: [number, number, number, number], src: [number, number, number, number], opacity = 1): [number, number, number, number] {
  const as = src[3] * opacity
  const ab = back[3]
  const cs: RGB = src[3] > 0 ? [src[0] / src[3], src[1] / src[3], src[2] / src[3]] : [0, 0, 0]
  const cb: RGB = ab > 0 ? [back[0] / ab, back[1] / ab, back[2] / ab] : [0, 0, 0]
  const B = blendColor(mode, cb, cs)
  const out: number[] = []
  for (let i = 0; i < 3; i++) out.push(as * (1 - ab) * cs[i] + as * ab * B[i] + (1 - as) * ab * cb[i])
  return [out[0], out[1], out[2], as + ab * (1 - as)]
}
