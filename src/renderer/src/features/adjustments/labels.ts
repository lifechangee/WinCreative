import { has, t } from '../../i18n'
import type { AdjDef, ParamDef } from './types'

/** 'Cyan - Red' -> 'cyanRed' (dictionary key of a built-in English label). */
export const labelSlug = (s: string): string =>
  s
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map((w, i) => (i ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()))
    .join('')

/** Built-in English label (parameter, option, gradient preset, liquify tool) -> current language. */
export const lbl = (english: string): string => {
  const k = 'adjustments.lbl.' + labelSlug(english)
  return has(k) ? t(k) : english
}
export const adjName = (d: Pick<AdjDef, 'id' | 'name'>): string => (has('adjustments.name.' + d.id) ? t('adjustments.name.' + d.id) : d.name)
export const paramLabel = (d: Pick<AdjDef, 'id'>, p: Pick<ParamDef, 'key' | 'label'>): string => {
  const k = `adjustments.param.${d.id}.${p.key}`
  return has(k) ? t(k) : lbl(p.label)
}
