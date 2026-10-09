/**
 * Language variants - pure model (no DOM / GL, unit-tested). See docs/LANGUAGE_VARIANTS.md.
 *
 * A document may contain LANGUAGE LAYERS (a group flagged `langSet` whose children are ordinary paint layers tagged `lang: <code>`).
 * Everything else is "common". One drawing session then yields one video per language: this file holds the rules that decide
 * which variants get a recorded frame for a commit, how frames are tagged / deduplicated, and the per-variant language list.
 */

export interface LangDef {
  code: string
  name: string
}

export const MIN_LANGS = 2
export const MAX_LANGS = 4
export const DEFAULT_LANGS: readonly LangDef[] = [
  { code: 'en', name: 'English' },
  { code: 'ru', name: 'Русский' }
]
/** Tag value of a frame that belongs to every variant (recorded while no language cell had content, and all pre-0.4 frames). */
export const ALL_VARIANTS = '*'

/** lower-case [a-z0-9-], at most 8 chars; '' when nothing usable is left */
export function cleanCode(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/^-+|-+$/g, '')
    .slice(0, 8)
}

export const cleanName = (s: string): string => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 24)

/** Validate a list loaded from a file: unknown shapes fall back to the defaults, duplicates and extras are dropped. */
export function normalizeLangs(raw: unknown): LangDef[] {
  if (!Array.isArray(raw)) return DEFAULT_LANGS.map((l) => ({ ...l }))
  const out: LangDef[] = []
  for (const r of raw as Record<string, unknown>[]) {
    const code = cleanCode(typeof r?.code === 'string' ? r.code : '')
    if (!code || out.some((l) => l.code === code) || out.length >= MAX_LANGS) continue
    out.push({ code, name: cleanName(typeof r?.name === 'string' ? r.name : '') || code.toUpperCase() })
  }
  return out.length >= MIN_LANGS ? out : DEFAULT_LANGS.map((l) => ({ ...l }))
}

export type LangError = 'code' | 'name' | 'duplicate' | 'max' | 'min' | 'missing'
export interface LangResult {
  langs: LangDef[]
  error?: LangError
}

export function addLanguage(langs: readonly LangDef[], code: string, name: string): LangResult {
  const c = cleanCode(code)
  const n = cleanName(name)
  if (!c) return { langs: langs.slice(), error: 'code' }
  if (!n) return { langs: langs.slice(), error: 'name' }
  if (langs.some((l) => l.code === c)) return { langs: langs.slice(), error: 'duplicate' }
  if (langs.length >= MAX_LANGS) return { langs: langs.slice(), error: 'max' }
  return { langs: [...langs, { code: c, name: n }] }
}
export function removeLanguage(langs: readonly LangDef[], code: string): LangResult {
  if (!langs.some((l) => l.code === code)) return { langs: langs.slice(), error: 'missing' }
  if (langs.length <= MIN_LANGS) return { langs: langs.slice(), error: 'min' }
  return { langs: langs.filter((l) => l.code !== code) }
}
/** Only the display name can change: the code is what cells and recorded frames refer to. */
export function renameLanguage(langs: readonly LangDef[], code: string, name: string): LangResult {
  const n = cleanName(name)
  if (!n) return { langs: langs.slice(), error: 'name' }
  if (!langs.some((l) => l.code === code)) return { langs: langs.slice(), error: 'missing' }
  return { langs: langs.map((l) => (l.code === code ? { ...l, name: n } : l)) }
}

/** The language shown after `cur` (wraps around); `cur` unknown -> the first one. */
export function nextLang(langs: readonly LangDef[], cur: string, dir: 1 | -1 = 1): string {
  if (!langs.length) return cur
  const i = langs.findIndex((l) => l.code === cur)
  if (i < 0) return langs[0].code
  return langs[(i + dir + langs.length) % langs.length].code
}

/** A view language that exists (falls back to the first language). */
export const validLang = (langs: readonly LangDef[], code: string | undefined | null): string => (code && langs.some((l) => l.code === code) ? code : (langs[0]?.code ?? 'en'))

/** `name.mp4` + `ru` -> `name.ru.mp4` (the suffix goes before the extension; a path without an extension just gets the suffix). */
export function variantFileName(path: string, code: string): string {
  const m = /^(.*?)(\.[A-Za-z0-9]{1,5})?$/.exec(path)
  const base = m?.[1] ?? path
  const ext = m?.[2] ?? ''
  // keep a directory part dot ("C:\a.b\file") out of the extension match
  if (ext && /[\\/]/.test(ext)) return `${path}.${code}`
  return `${base}.${code}${ext}`
}

// ------------------------------------------------------------------ capture planning

/**
 * Commit types whose effect is confined to the pixels of the layer(s) named in the event. Anything else (layer properties, masks, order,
 * grouping, merges, deletes, new / load, canvas ops...) can change what several variants show, so it is recorded for all of them.
 */
const CELL_LOCAL_TYPES = new Set(['stroke', 'erase', 'smudge', 'filter', 'clear', 'fill', 'transform', 'layer-fill', 'layer-invert', 'layer-paste', 'layer-add'])

export interface CommitInfo {
  type: string
  layerId: string | null
  /** every layer the commit touched (transactions), when known */
  layerIds?: string[]
  /** the commit changed pixels (a dirty rectangle was reported) */
  hasDirty: boolean
}

/** Variants affected by commits since the last capture. */
export interface Pending {
  all: boolean
  langs: Set<string>
}
export const emptyPending = (): Pending => ({ all: false, langs: new Set() })

/**
 * Which variants does a commit affect? `cellLang(id)` = the language of the paint layer `id` when it is a language CELL, else null/undefined.
 * Cell-local pixel commits (strokes, fills, pastes, cut-outs, undo / redo of those) affect only their language; everything else affects all.
 */
export function classifyCommit(c: CommitInfo, cellLang: (id: string) => string | null | undefined): { all: boolean; langs: string[] } {
  const navigation = c.type === 'undo' || c.type === 'redo'
  const local = navigation ? c.hasDirty : CELL_LOCAL_TYPES.has(c.type)
  if (!local) return { all: true, langs: [] }
  const ids = c.layerIds && c.layerIds.length ? c.layerIds : c.layerId ? [c.layerId] : []
  if (!ids.length) return { all: true, langs: [] }
  const langs = new Set<string>()
  for (const id of ids) {
    const l = cellLang(id)
    if (!l) return { all: true, langs: [] }
    langs.add(l)
  }
  return { all: false, langs: [...langs] }
}

export function addToPending(p: Pending, c: { all: boolean; langs: string[] }): void {
  if (c.all) p.all = true
  for (const l of c.langs) p.langs.add(l)
}

export interface PlanContext {
  /** variant codes in document order */
  langs: string[]
  /** some language cell of the document has pixels (before that every frame is a shared `*` frame) */
  anyContent: boolean
  /** does the variant's own content intersect the capture area (visible cells with pixels there)? false = its picture is just the common artwork */
  contentInArea: (code: string) => boolean
}
/** One frame to record: `variants` = the variants it belongs to, null = the shared `*` frame. Its pixels are those of `render`. */
export interface FramePlan {
  variants: string[] | null
  /** the variant whose composite is rendered for this frame */
  render: string | null
}

/**
 * The frames to write for the commits collected in `pending`:
 *  - no language content yet: ONE shared `*` frame (exactly as before language layers existed);
 *  - cell commits: one frame per affected variant;
 *  - common / structural commits (`pending.all`), or no commit info (first frame, recording switched on): one frame per variant -
 *    except that variants whose picture is provably identical (no cell content in the capture area) share ONE frame tagged for all of them.
 */
export function planFrames(p: Pending, ctx: PlanContext): FramePlan[] {
  if (!ctx.anyContent || ctx.langs.length === 0) return [{ variants: null, render: null }]
  const noInfo = !p.all && p.langs.size === 0
  const targets = ctx.langs.filter((l) => p.all || noInfo || p.langs.has(l))
  if (!targets.length) return []
  const same: string[] = []
  const out: FramePlan[] = []
  for (const l of targets) {
    if (ctx.contentInArea(l)) out.push({ variants: [l], render: l })
    else same.push(l)
  }
  if (same.length) out.unshift({ variants: same, render: same[0] })
  return out
}

// ------------------------------------------------------------------ frame tags
/** Variant / group tags stored in the recording index next to the history tags. */
export interface VTag {
  /** variants the frame belongs to; undefined = all (`*`) */
  v?: string[]
  /** capture group: frames written by the same capture pass share it (monotonic) */
  g?: number
}

export const frameInVariant = (v: string[] | undefined, variant: string | null): boolean => variant === null || v === undefined || v.includes(variant)

/** Sanitise a tag list coming from disk / IPC. */
export function cleanVariantTag(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out = v.map((x) => cleanCode(String(x))).filter((x, i, a) => x && a.indexOf(x) === i)
  return out.length ? out : undefined
}

/** Raw indices of the frames that belong to `variant` (null = all frames). */
export function variantIndices(tags: readonly VTag[], variant: string | null): number[] {
  const out: number[] = []
  for (let i = 0; i < tags.length; i++) if (frameInVariant(tags[i].v, variant)) out.push(i)
  return out
}

/** Capture group of a frame (legacy frames without one use their own index, which is monotonic as well). */
export const groupOf = (tags: readonly VTag[], i: number): number => tags[i].g ?? i

/** Next capture group id after a restored recording (above every explicit group and above the index of every legacy frame). */
export function nextGroupId(tags: readonly VTag[]): number {
  let m = tags.length - 1
  for (const t of tags) if (t.g !== undefined && t.g > m) m = t.g
  return m + 1
}
