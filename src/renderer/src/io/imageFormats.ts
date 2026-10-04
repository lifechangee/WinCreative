import UTIF from 'utif'

/** Straight-alpha RGBA8 bitmap. */
export interface Bitmap {
  width: number
  height: number
  data: Uint8ClampedArray
}

const toImageData = (b: Bitmap): ImageData => new ImageData(b.data as unknown as Uint8ClampedArray<ArrayBuffer>, b.width, b.height)

async function canvasBlob(b: Bitmap, type: string, quality?: number): Promise<Uint8Array> {
  const c = new OffscreenCanvas(b.width, b.height)
  c.getContext('2d')!.putImageData(toImageData(b), 0, 0)
  const blob = await c.convertToBlob({ type, quality })
  return new Uint8Array(await blob.arrayBuffer())
}

export const encodePngBitmap = (b: Bitmap): Promise<Uint8Array> => canvasBlob(b, 'image/png')
export const encodeJpegBitmap = (b: Bitmap, quality = 0.92): Promise<Uint8Array> => canvasBlob(b, 'image/jpeg', quality)
export async function encodeWebp(b: Bitmap, quality = 0.9): Promise<Uint8Array> {
  const out = await canvasBlob(b, 'image/webp', quality)
  // Chromium silently falls back to PNG if it cannot encode WebP; make that visible.
  if (out[0] === 0x89) throw new Error('WebP encoding is not supported by this build')
  return out
}

/** Uncompressed 8-bit RGBA TIFF (alpha stored as unassociated extra sample). */
export function encodeTiff(b: Bitmap): Uint8Array {
  return new Uint8Array(UTIF.encodeImage(b.data, b.width, b.height))
}

export function decodeTiff(bytes: Uint8Array): Bitmap {
  const ifds = UTIF.decode(bytes)
  if (!ifds.length) throw new Error('Empty TIFF')
  UTIF.decodeImage(bytes, ifds[0])
  const rgba = UTIF.toRGBA8(ifds[0])
  return { width: ifds[0].width, height: ifds[0].height, data: new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength) }
}

export type ImageKind = 'png' | 'jpeg' | 'webp' | 'tiff' | 'psd' | 'gif' | 'bmp' | 'procreate' | 'bwk' | 'unknown'

/** Sniff by magic bytes (file extensions lie). */
export function sniffImage(b: Uint8Array): ImageKind {
  const s = (o: number, str: string): boolean => str.split('').every((c, i) => b[o + i] === c.charCodeAt(0))
  if (b[0] === 0x89 && s(1, 'PNG')) return 'png'
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpeg'
  if (s(0, 'RIFF') && s(8, 'WEBP')) return 'webp'
  if ((s(0, 'II') && b[2] === 42 && b[3] === 0) || (s(0, 'MM') && b[2] === 0 && b[3] === 42)) return 'tiff'
  if (s(0, '8BPS')) return 'psd'
  if (s(0, 'GIF8')) return 'gif'
  if (s(0, 'BM')) return 'bmp'
  if (b[0] === 0x50 && b[1] === 0x4b) return 'procreate' // zip: caller distinguishes .bwk / .procreate
  return 'unknown'
}

/** Decode PNG/JPEG/WebP/GIF/BMP (browser codecs) or TIFF (utif) into straight RGBA. */
export async function decodeBitmap(bytes: Uint8Array): Promise<Bitmap> {
  const kind = sniffImage(bytes)
  if (kind === 'tiff') return decodeTiff(bytes)
  const bmp = await createImageBitmap(new Blob([bytes as unknown as BlobPart]), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  const c = new OffscreenCanvas(bmp.width, bmp.height)
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bmp, 0, 0)
  bmp.close()
  const id = ctx.getImageData(0, 0, c.width, c.height)
  return { width: id.width, height: id.height, data: id.data }
}

/** Flatten a straight-alpha bitmap onto an opaque colour in place (JPEG/PDF/MP4 have no alpha). */
export function flattenOnto(b: Bitmap, rgb: [number, number, number] = [255, 255, 255]): Bitmap {
  const d = b.data
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255
    d[i] = d[i] * a + rgb[0] * (1 - a)
    d[i + 1] = d[i + 1] * a + rgb[1] * (1 - a)
    d[i + 2] = d[i + 2] * a + rgb[2] * (1 - a)
    d[i + 3] = 255
  }
  return b
}
