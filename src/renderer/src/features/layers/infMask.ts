import type { App } from '../../app/app'
import { TILE, tileKeyX, tileKeyY } from '../../core/tiles'
import { newInfMask } from '../../doc/maskStore'
import { decodeImage, encodePng, registerBwkExtension } from '../../io/bwk'

/**
 * Persistence of infinite-canvas layer masks (.bwk extension 'infmasks'): per masked layer `{id, fill, tiles}` and one straight-RGBA PNG
 * per existing mask tile (`infmask/<layerId>/<tx>_<ty>.png`). A tile that is absent reads as `fill`.
 */
export function installInfMaskStorage(app: App): void {
  registerBwkExtension({
    id: 'infmasks',
    save: async (doc) => {
      if (!doc.isInfinite) return
      const meta: { id: string; fill: number; tiles: [number, number][] }[] = []
      const files: Record<string, Uint8Array> = {}
      for (const l of doc.layers) {
        const ms = l.maskTiles
        if (!ms) continue
        const tiles: [number, number][] = []
        for (const k of [...ms.keys()]) {
          const s = ms.getKey(k)
          if (!s) continue
          const tx = tileKeyX(k)
          const ty = tileKeyY(k)
          const px = app.gpu.readRGBA8(s, { x: 0, y: 0, w: TILE, h: TILE })
          files[`infmask/${l.id}/${tx}_${ty}.png`] = await encodePng(px, TILE, TILE)
          tiles.push([tx, ty])
        }
        meta.push({ id: l.id, fill: l.maskFill, tiles })
      }
      if (meta.length) return { extra: meta, files }
    },
    load: async (doc, extra, entries) => {
      if (!doc.isInfinite || !Array.isArray(extra)) return
      for (const m of extra as { id: string; fill: number; tiles: [number, number][] }[]) {
        const l = doc.getLayer(m?.id)
        if (!l || l.isGroup || !l.tiles) continue
        const surf = newInfMask(doc.gpu, l.tiles.fmt, m.fill ? 1 : 0)
        const store = surf.inf!
        for (const [tx, ty] of m.tiles ?? []) {
          const png = entries[`infmask/${l.id}/${tx}_${ty}.png`]
          if (!png) continue
          const img = await decodeImage(png)
          if (img.width === TILE && img.height === TILE) doc.gpu.uploadRGBA8(store.ensure(tx, ty), 0, 0, TILE, TILE, img.data)
        }
        l.mask = surf
      }
    }
  })
}
