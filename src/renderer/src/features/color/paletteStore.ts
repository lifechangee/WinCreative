import { t } from '../../i18n'
import { Emitter } from '../../core/events'
import { normalizeHex } from './colorMath'
import { DEFAULT_PALETTE_SIZE, Palette, makeDefaultPalette, makePalette, paletteName, sanitizePalette } from './palettes'

const KEY = 'bw.palettes.v1'
const SETTINGS_KEY = 'bw.color.settings.v1'

export type PaletteView = 'compact' | 'card'

export interface ColorSettings {
  /** eyedropper reads the composite or only the active layer */
  eyeSource: 'composite' | 'layer'
  /** side of the sampled square in px (1 = exact pixel, N = average) */
  eyeSize: 1 | 3 | 5 | 9 | 17
  /** long-press delay in ms (0 disables long-press sampling) */
  longPressMs: number
  paletteView: PaletteView
  /** ColorDrop: default threshold 0..1 */
  fillThreshold: number
  fillAntialias: boolean
}

export const DEFAULT_SETTINGS: ColorSettings = {
  eyeSource: 'composite',
  eyeSize: 1,
  longPressMs: 500,
  paletteView: 'compact',
  fillThreshold: 0.15,
  fillAntialias: true
}

interface StoreEvents {
  change: void
}

const read = (k: string): any => {
  try {
    const s = localStorage.getItem(k)
    return s ? JSON.parse(s) : null
  } catch {
    return null
  }
}
const write = (k: string, v: unknown): void => {
  try {
    localStorage.setItem(k, JSON.stringify(v))
  } catch {
    /* storage unavailable */
  }
}

/** Persistent palette collection (localStorage). Slot arrays keep empty slots as null. */
export class PaletteStore {
  readonly events = new Emitter<StoreEvents>()
  palettes: Palette[] = []
  defaultId = 'default'
  currentId = 'default'
  settings: ColorSettings = { ...DEFAULT_SETTINGS }

  constructor() {
    const raw = read(KEY)
    if (raw && Array.isArray(raw.palettes)) {
      this.palettes = raw.palettes.map(sanitizePalette).filter((p: Palette | null): p is Palette => !!p)
      if (typeof raw.defaultId === 'string') this.defaultId = raw.defaultId
      if (typeof raw.currentId === 'string') this.currentId = raw.currentId
    }
    if (!this.palettes.length) this.palettes.push(makeDefaultPalette())
    if (!this.get(this.defaultId)) this.defaultId = this.palettes[0].id
    if (!this.get(this.currentId)) this.currentId = this.defaultId
    const s = read(SETTINGS_KEY)
    if (s && typeof s === 'object') this.settings = { ...DEFAULT_SETTINGS, ...s }
  }

  get(id: string): Palette | undefined {
    return this.palettes.find((p) => p.id === id)
  }
  get current(): Palette {
    return this.get(this.currentId) ?? this.palettes[0]
  }
  get default(): Palette {
    return this.get(this.defaultId) ?? this.palettes[0]
  }

  private save(): void {
    write(KEY, { palettes: this.palettes, defaultId: this.defaultId, currentId: this.currentId })
    this.events.emit('change', undefined)
  }
  saveSettings(): void {
    write(SETTINGS_KEY, this.settings)
    this.events.emit('change', undefined)
  }

  select(id: string): void {
    if (this.get(id)) {
      this.currentId = id
      this.save()
    }
  }
  add(p: Palette, select = true): Palette {
    if (!p.colors.length) p.colors = new Array(DEFAULT_PALETTE_SIZE).fill(null)
    this.palettes.push(p)
    if (select) this.currentId = p.id
    this.save()
    return p
  }
  createEmpty(name = t('color.palette.untitled')): Palette {
    return this.add(makePalette(name, new Array(DEFAULT_PALETTE_SIZE).fill(null)))
  }
  createFromDefault(): Palette {
    return this.add(makePalette(paletteName(this.default) + t('core.doc.copySuffix'), this.default.colors))
  }
  duplicate(id: string): Palette | null {
    const p = this.get(id)
    return p ? this.add(makePalette(paletteName(p) + t('core.doc.copySuffix'), p.colors)) : null
  }
  rename(id: string, name: string): void {
    const p = this.get(id)
    if (p && name.trim()) {
      p.name = name.trim().slice(0, 80)
      this.save()
    }
  }
  /** Delete a palette; the last remaining palette cannot be deleted. */
  remove(id: string): boolean {
    if (this.palettes.length <= 1) return false
    this.palettes = this.palettes.filter((p) => p.id !== id)
    if (this.defaultId === id) this.defaultId = this.palettes[0].id
    if (this.currentId === id) this.currentId = this.defaultId
    this.save()
    return true
  }
  setDefault(id: string): void {
    if (this.get(id)) {
      this.defaultId = id
      this.save()
    }
  }
  /** Store `hex` into the first empty slot (appending a slot when full); returns its index. */
  addColor(id: string, hex: string): number {
    const p = this.get(id)
    const h = normalizeHex(hex)
    if (!p || !h) return -1
    let i = p.colors.indexOf(null)
    if (i < 0) {
      p.colors.push(h)
      i = p.colors.length - 1
    } else p.colors[i] = h
    this.save()
    return i
  }
  setSwatch(id: string, index: number, hex: string): void {
    const p = this.get(id)
    const h = normalizeHex(hex)
    if (!p || !h || index < 0) return
    while (p.colors.length <= index) p.colors.push(null)
    p.colors[index] = h
    this.save()
  }
  deleteSwatch(id: string, index: number): void {
    const p = this.get(id)
    if (p && index >= 0 && index < p.colors.length) {
      p.colors[index] = null
      this.save()
    }
  }
}

let store: PaletteStore | null = null
export const paletteStore = (): PaletteStore => (store ??= new PaletteStore())
