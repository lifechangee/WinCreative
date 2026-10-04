/** Off-main-thread JPEG encoder for time-lapse frames (runs as a module worker). */
interface Job {
  id: number
  w: number
  h: number
  quality: number
  pixels: ArrayBuffer
}
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<Job>) => void) | null
  postMessage(m: unknown, transfer?: Transferable[]): void
}
let canvas: OffscreenCanvas | null = null
let ctx: OffscreenCanvasRenderingContext2D | null = null

scope.onmessage = async (e: MessageEvent<Job>): Promise<void> => {
  const { id, w, h, quality, pixels } = e.data
  try {
    if (!canvas || canvas.width !== w || canvas.height !== h) {
      canvas = new OffscreenCanvas(w, h)
      ctx = canvas.getContext('2d', { alpha: false }) as OffscreenCanvasRenderingContext2D
    }
    ctx!.putImageData(new ImageData(new Uint8ClampedArray(pixels), w, h), 0, 0)
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality })
    const bytes = await blob.arrayBuffer()
    scope.postMessage({ id, bytes }, [bytes])
  } catch (err) {
    scope.postMessage({ id, error: String(err) })
  }
}
