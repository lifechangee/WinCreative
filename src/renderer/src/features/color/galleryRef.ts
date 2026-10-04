import type { GalleryStore } from './galleryStore'

/** Set by installGallery(); lets ui/newDocDialog register new canvases without import cycles. */
export const galleryRef: { store: GalleryStore | null; show: (() => void) | null; hide: (() => void) | null; ready: Promise<void> } = { store: null, show: null, hide: null, ready: Promise.resolve() }
