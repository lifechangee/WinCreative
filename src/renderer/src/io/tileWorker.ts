/** Codec worker of the tile memory system: straight RGBA8 <-> PNG (tile eviction blobs, .bwk tile files). */
import { assemblePng, filterSub } from './pngStream'
import { decodePng, premultiplyInPlace, unpremultiplyEx } from './pngDecode'

type In = { t: 'enc'; id: number; w: number; h: number; rgba: ArrayBuffer; level?: number } | { t: 'dec'; id: number; png: Uint8Array }
const scope = self as unknown as { onmessage: ((e: MessageEvent<In>) => void) | null; postMessage(m: unknown, t?: Transferable[]): void }

/** native zlib (CompressionStream) is ~10x faster than the JS deflater for 1 MB tiles */
async function deflate(raw: Uint8Array): Promise<Uint8Array> {
  const cs = new Blob([raw as unknown as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(cs).arrayBuffer())
}
scope.onmessage = (e): void => void handle(e.data)

async function handle(m: In): Promise<void> {
  try {
    if (m.t === 'enc') {
      // input: premultiplied tile bytes -> straight alpha (exact) -> Sub filter -> native zlib -> PNG
      const un = unpremultiplyEx(new Uint8Array(m.rgba))
      const png = assemblePng(m.w, m.h, await deflate(filterSub(un.data, m.w)))
      scope.postMessage({ t: 'png', id: m.id, png, empty: un.empty }, [png.buffer as ArrayBuffer])
    } else {
      const d = decodePng(m.png)
      if (!d) scope.postMessage({ t: 'rgba', id: m.id, rgba: null })
      else {
        premultiplyInPlace(d.rgba) // output: premultiplied tile bytes, ready for a raw texture upload
        scope.postMessage({ t: 'rgba', id: m.id, w: d.w, h: d.h, rgba: d.rgba }, [d.rgba.buffer as ArrayBuffer])
      }
    }
  } catch (err) {
    scope.postMessage({ t: 'err', id: m.id, error: String(err) })
  }
}
