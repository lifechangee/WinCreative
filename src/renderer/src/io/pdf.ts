import { PDFDocument } from 'pdf-lib'

export interface PdfPage {
  /** image bytes: PNG (best quality, lossless) or JPEG (web ready) */
  image: Uint8Array
  format: 'png' | 'jpeg'
  /** pixel size of the image */
  width: number
  height: number
}

/**
 * Multi-page PDF, one full-bleed image per page. Page size = pixel size * 72 / dpi (PDF points), so the printed
 * size matches the canvas' DPI setting.
 */
export async function buildPdf(pages: PdfPage[], dpi: number, meta: { title?: string; author?: string } = {}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  if (meta.title) pdf.setTitle(meta.title)
  if (meta.author) pdf.setAuthor(meta.author)
  pdf.setProducer('WinCreative')
  pdf.setCreator('WinCreative')
  const k = 72 / Math.max(1, dpi)
  for (const p of pages) {
    const img = p.format === 'png' ? await pdf.embedPng(p.image) : await pdf.embedJpg(p.image)
    const page = pdf.addPage([p.width * k, p.height * k])
    page.drawImage(img, { x: 0, y: 0, width: p.width * k, height: p.height * k })
  }
  return pdf.save({ useObjectStreams: true })
}
