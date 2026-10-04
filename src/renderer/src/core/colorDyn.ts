/** Small pure colour helpers used by brush colour dynamics (no dependency on app/). */
export type RGB = [number, number, number]

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
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
  return [h, mx === 0 ? 0 : d / mx, mx]
}

export function hsvToRgb(h: number, s: number, v: number): RGB {
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

export interface ColorShift {
  /** degrees */
  hue: number
  /** -1..1 relative saturation change */
  sat: number
  /** -1..1: toward white (+) / black (-) */
  light: number
  /** 0..1 darkening (value multiplier 1-dark) */
  dark: number
  /** 0..1 mix toward the secondary colour */
  sec: number
}

export const NO_SHIFT: ColorShift = { hue: 0, sat: 0, light: 0, dark: 0, sec: 0 }

export function isNoShift(s: ColorShift): boolean {
  return s.hue === 0 && s.sat === 0 && s.light === 0 && s.dark === 0 && s.sec === 0
}

/** Apply a colour shift to a base colour (all channels 0..1). */
export function shiftColor(base: RGB, secondary: RGB, s: ColorShift): RGB {
  let c: RGB = base
  if (s.sec > 0) {
    const k = clamp01(s.sec)
    c = [c[0] + (secondary[0] - c[0]) * k, c[1] + (secondary[1] - c[1]) * k, c[2] + (secondary[2] - c[2]) * k]
  }
  if (s.hue !== 0 || s.sat !== 0 || s.dark !== 0) {
    let [h, sa, v] = rgbToHsv(c[0], c[1], c[2])
    h += s.hue
    sa = s.sat >= 0 ? sa + (1 - sa) * s.sat : sa * (1 + s.sat)
    v *= 1 - clamp01(s.dark)
    c = hsvToRgb(h, clamp01(sa), clamp01(v))
  }
  if (s.light > 0) c = [c[0] + (1 - c[0]) * s.light, c[1] + (1 - c[1]) * s.light, c[2] + (1 - c[2]) * s.light]
  else if (s.light < 0) c = [c[0] * (1 + s.light), c[1] * (1 + s.light), c[2] * (1 + s.light)]
  return [clamp01(c[0]), clamp01(c[1]), clamp01(c[2])]
}
