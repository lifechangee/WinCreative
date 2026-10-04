import type { App } from '../../app/app'
import type { Eyedropper } from './eyedropper'

/** Singletons created by the colour feature's install() and consumed by the colour panel / gallery. */
export const shared: { app: App | null; eyedropper: Eyedropper | null } = { app: null, eyedropper: null }
