import { t } from '../../i18n'
import { decodeImage } from '../../io/bwk'
import { Palette, decodeAse, decodeSwatches, encodeAse, encodeSwatches, encodePaletteJson, extractPalette, isAse, makePalette, DEFAULT_PALETTE_SIZE, paletteName } from './palettes'

const bridge = (): NonNullable<Window['brushwork']> => {
  if (!window.brushwork) throw new Error('Electron bridge unavailable')
  return window.brushwork
}

const safeName = (n: string): string => n.replace(/[\\/:*?"<>|]+/g, '_') || 'Palette'
const baseName = (path: string): string => path.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')

export type ShareFormat = 'swatches' | 'ase' | 'json'

export async function exportPalette(p: Palette, format: ShareFormat): Promise<string | null> {
  const data = format === 'ase' ? encodeAse(p) : format === 'json' ? encodePaletteJson(p) : encodeSwatches(p)
  const ext = format
  return bridge().saveFile({ defaultName: `${safeName(paletteName(p))}.${ext}`, filters: [{ name: format === 'ase' ? 'Adobe Swatch Exchange' : format === 'json' ? 'Palette JSON' : t('color.palette.filter.swatches'), extensions: [ext] }], data })
}

/** Parse a file's bytes into palettes: .swatches / .json / .ase, or any image (colours extracted). */
export async function palettesFromBytes(bytes: Uint8Array, fileName: string): Promise<Palette[]> {
  const name = baseName(fileName)
  const lower = fileName.toLowerCase()
  if (isAse(bytes)) return decodeAse(bytes, name)
  if (lower.endsWith('.swatches') || lower.endsWith('.json') || (bytes[0] === 0x50 && bytes[1] === 0x4b)) return decodeSwatches(bytes, name)
  const mime = lower.endsWith('.jpg') || lower.endsWith('.jpeg') ? 'image/jpeg' : lower.endsWith('.webp') ? 'image/webp' : lower.endsWith('.gif') ? 'image/gif' : lower.endsWith('.bmp') ? 'image/bmp' : 'image/png'
  const img = await decodeImage(bytes, mime)
  const cols = extractPalette(img.data, DEFAULT_PALETTE_SIZE)
  if (!cols.length) throw new Error('No colours found in image')
  return [makePalette(name, cols)]
}

/** Open a file dialog and return palettes parsed from it (null = cancelled). */
export async function importPalettesFromDialog(kind: 'any' | 'palette' = 'any'): Promise<Palette[] | null> {
  const filters =
    kind === 'palette'
      ? [{ name: t('color.palette.filter.palettes'), extensions: ['swatches', 'ase', 'json'] }]
      : [
          { name: t('color.palette.filter.palettesImages'), extensions: ['swatches', 'ase', 'json', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
          { name: t('color.palette.filter.all'), extensions: ['*'] }
        ]
  const r = await bridge().openFile({ filters })
  if (!r) return null
  return palettesFromBytes(r.data, r.path)
}
