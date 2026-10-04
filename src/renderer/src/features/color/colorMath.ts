import { HSV, hexToRgb, hsvToRgb, rgbToHex, rgbToHsv } from '../../app/state'

export type { HSV }
export { hexToRgb, hsvToRgb, rgbToHex, rgbToHsv }

export const hsvToHex = (c: HSV): string => rgbToHex(hsvToRgb(c))

/** Accepts "#abc", "abc", "#aabbcc", "AABBCC" (also "#aabbccdd", alpha dropped). Returns "#rrggbb" or null. */
export function normalizeHex(input: string): string | null {
  let s = input.trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.split('').map((c) => c + c).join('')
  else if (/^[0-9a-f]{8}$/i.test(s)) s = s.slice(0, 6)
  if (!/^[0-9a-f]{6}$/i.test(s)) return null
  return '#' + s.toLowerCase()
}

export const hexToHsv = (hex: string, fallbackHue = 0): HSV | null => {
  const n = normalizeHex(hex)
  const rgb = n ? hexToRgb(n) : null
  if (!rgb) return null
  const c = rgbToHsv(...rgb)
  if (c.s === 0 || c.v === 0) c.h = fallbackHue
  return c
}

export const wrapHue = (h: number): number => ((h % 360) + 360) % 360
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

export type HarmonyScheme = 'complementary' | 'splitComplementary' | 'analogous' | 'triadic' | 'tetradic'

export const HARMONY_LABELS: Record<HarmonyScheme, string> = {
  complementary: 'Complementary',
  splitComplementary: 'Split Comp.',
  analogous: 'Analogous',
  triadic: 'Triadic',
  tetradic: 'Tetradic'
}

/** Hue offsets (degrees) relative to the base colour, base first. */
export const HARMONY_OFFSETS: Record<HarmonyScheme, number[]> = {
  complementary: [0, 180],
  splitComplementary: [0, 150, 210],
  analogous: [0, -30, 30],
  triadic: [0, 120, 240],
  tetradic: [0, 60, 180, 240]
}

/** Colours of a harmony: all share the base saturation/brightness, hues rotated by the scheme offsets. */
export function harmonyColors(base: HSV, scheme: HarmonyScheme): HSV[] {
  return HARMONY_OFFSETS[scheme].map((o) => ({ h: wrapHue(base.h + o), s: base.s, v: base.v }))
}

/**
 * Dragging harmony handle `index` to hue `hue`: rotates the whole set so that handle lands there,
 * returning the new base colour. `s` optionally updates saturation (radial drag).
 */
export function harmonyBaseFromHandle(base: HSV, scheme: HarmonyScheme, index: number, hue: number, s?: number): HSV {
  const off = HARMONY_OFFSETS[scheme][index] ?? 0
  return { h: wrapHue(hue - off), s: s === undefined ? base.s : clamp01(s), v: base.v }
}

/** Colour distance (max channel difference, 0..1). */
export const rgbDistance = (a: [number, number, number], b: [number, number, number]): number =>
  Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]))
