import { BrushInput, BrushPreset, cloneBrush, normalizeBrush } from '../core/brush'
import { Emitter } from '../core/events'
import { has, t } from '../i18n'
import { DEFAULT_SETS } from './defaults'

const presets = new Map<string, BrushPreset>()
/** pristine copies of the shipped brushes (for "Reset default brushes") */
const pristine = new Map<string, BrushPreset>()

/** Extension point: add or replace a brush preset (e.g. from a library JSON file). */
export function registerBrushPreset(p: BrushInput | BrushPreset): BrushPreset {
  const n = normalizeBrush(p)
  presets.set(n.id, n)
  return n
}
export const getBrushPreset = (id: string): BrushPreset | undefined => presets.get(id)
export const removeBrushPreset = (id: string): void => void presets.delete(id)
export const listBrushPresets = (category?: BrushPreset['category']): BrushPreset[] =>
  [...presets.values()].filter((p) => !category || p.category === category)
export const getPristineBrush = (id: string): BrushPreset | undefined => {
  const p = pristine.get(id)
  return p ? cloneBrush(p) : undefined
}
export const isDefaultBrush = (id: string): boolean => pristine.has(id)

/** Fired when a brush is used for a stroke (feeds the Recent set). */
export const brushUsed = new Emitter<{ used: string }>()

export function registerDefaultPresets(): void {
  for (const s of DEFAULT_SETS) {
    for (const b of s.brushes) {
      const n = registerBrushPreset(b)
      pristine.set(n.id, cloneBrush(n))
    }
  }
}

/**
 * Display name of a brush: shipped brushes that still carry their original name are translated
 * (`brushes.preset.<id>`); user-renamed, duplicated or imported brushes keep their own name.
 */
export function brushName(b: { id: string; name: string }): string {
  const key = 'brushes.preset.' + b.id
  return pristine.get(b.id)?.name === b.name && has(key) ? t(key) : b.name
}

/** Display name of a brush set (same rule as `brushName`, keyed by `brushes.set.<id>`). */
export function setName(s: { id: string; name: string }): string {
  const key = 'brushes.set.' + s.id
  return DEFAULT_SETS.some((d) => d.id === s.id && d.name === s.name) && has(key) ? t(key) : s.name
}
