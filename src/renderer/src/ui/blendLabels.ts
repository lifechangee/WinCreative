import type { BlendMode } from '../core/blend'
import { BLEND_LABELS } from '../core/blend'
import { has, t } from '../i18n'

/** Localised blend-mode name (falls back to the English label). */
export const blendLabel = (m: BlendMode): string => (has('core.blend.' + m) ? t('core.blend.' + m) : BLEND_LABELS[m])
/** Localised blend picker group heading. */
export const blendGroupLabel = (name: string): string => (has('core.blendGroup.' + name) ? t('core.blendGroup.' + name) : name)
