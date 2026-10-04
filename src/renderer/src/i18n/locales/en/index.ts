import core from './core'
import ui from './ui'
import brushes from './brushes'
import layers from './layers'
import color from './color'
import gallery from './gallery'
import adjustments from './adjustments'
import selectxform from './selectxform'
import guides from './guides'
import animio from './animio'
import iface from './interface'
import tutorial from './tutorial'

/** One flat dictionary per module (parallel-safe: each module owns its own file). Keys must start with '<module>.'. */
export const en: Record<string, Record<string, string>> = { core, ui, brushes, layers, color, gallery, adjustments, selectxform, guides, animio, interface: iface, tutorial }
