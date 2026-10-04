import type { AppState, HSV } from '../../app/state'
import { hsvToHex } from './colorMath'

/**
 * Which swatch (primary / secondary) the colour panel, eyedropper, palettes and harmony tools edit.
 * Everything that "sets the colour" goes through here so the secondary swatch works everywhere.
 */
export const target = { secondary: false }

export function getActiveColor(state: AppState): HSV {
  return target.secondary ? state.secondaryColor : state.color
}

export function setActiveColor(state: AppState, c: HSV, remember = false): void {
  if (target.secondary) {
    state.setSecondaryColor(c)
    if (remember) remember2(state, c)
  } else state.setColor(c, remember)
}

/** history for the secondary colour shares the recent list (setColor(remember) only handles primary). */
function remember2(state: AppState, c: HSV): void {
  const hex = hsvToHex(c)
  state.recentColors = [hex, ...state.recentColors.filter((x) => x !== hex)].slice(0, 12)
  state.events.emit('color', undefined)
}
