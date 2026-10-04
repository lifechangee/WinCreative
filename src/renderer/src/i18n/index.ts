/**
 * Localisation runtime (see docs/I18N.md).
 *
 *   t('layers.menu.mergeDown')                       -> string in the current language
 *   t('layers.count', { count: 3 })                  -> plural form (keys layers.count_one / _few / _many / _other)
 *   h('button', { text: tk('layers.add'), title: tk('layers.add.tip') })   -> DOM that re-translates on language change
 *   onLangChange(() => rebuild())                    -> for content built from plain t() calls
 *
 * Pure module: safe to import from node (vitest) - DOM is only touched when `document` exists.
 */
import { en } from './locales/en'
import { ru } from './locales/ru'

export type Lang = 'en' | 'ru'
export type LangPref = 'auto' | Lang
export type Params = Record<string, string | number>
export type Dict = Record<string, string>

export const LANGS: { id: Lang; name: string }[] = [
  { id: 'en', name: 'English' },
  { id: 'ru', name: 'Русский' }
]
export const FALLBACK_LANG: Lang = 'en'

/** Lazy reference to a translation: pass to `h()` attrs/children, `MenuItem.label`, `ActionDef.label`, `PanelDef.title`... */
export interface I18nRef {
  readonly __i18n: true
  readonly key: string
  readonly params?: Params
}
/** Anything that can be turned into a display string: a key, a literal, a `tk()` ref or a resolver function. */
export type I18nText = string | I18nRef | (() => string)

/** Create a lazy reference (translated when rendered and again on every language change). */
export const tk = (key: string, params?: Params): I18nRef => ({ __i18n: true, key, params })
export const isRef = (v: unknown): v is I18nRef => !!v && typeof v === 'object' && (v as I18nRef).__i18n === true

// ------------------------------------------------------------------ dictionaries
const dicts: Record<Lang, Dict> = { en: {}, ru: {} }
function merge(lang: Lang, d: Dict): void {
  Object.assign(dicts[lang], d)
}
for (const m of Object.values(en)) merge('en', m)
for (const m of Object.values(ru)) merge('ru', m)

/** Runtime extension point: add keys after start-up (e.g. plug-ins). Later registrations win. */
export function registerDictionary(lang: Lang, d: Dict): void {
  merge(lang, d)
}
/** Test/debug access. */
export const allKeys = (lang: Lang): string[] => Object.keys(dicts[lang])

// ------------------------------------------------------------------ language state
let current: Lang = FALLBACK_LANG
let override: Lang | null = null
const listeners = new Set<(lang: Lang) => void>()

export const getLang = (): Lang => override ?? current

/** Map a BCP-47 tag / OS locale (`ru-RU`, `en-US`) to a supported language. */
export function detectLang(tag?: string | null): Lang {
  const s = (tag ?? (typeof navigator !== 'undefined' ? navigator.languages?.[0] || navigator.language : '') ?? '').toLowerCase()
  return s.startsWith('ru') ? 'ru' : 'en'
}
/** Resolve a stored preference ('auto' = OS language). */
export const resolveLang = (p: LangPref | string | undefined | null): Lang => (p === 'en' || p === 'ru' ? p : detectLang())

/** Switch language live: updates <html lang>, re-translates the whole document and notifies listeners. */
export function setLang(lang: Lang): void {
  if (lang === current) return
  current = lang
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang
    translateDom(document)
  }
  for (const cb of [...listeners]) {
    try {
      cb(lang)
    } catch (e) {
      console.error('[i18n] listener failed', e)
    }
  }
}

/** Subscribe to language changes; returns the unsubscribe function. */
export function onLangChange(cb: (lang: Lang) => void): () => void {
  listeners.add(cb)
  return () => void listeners.delete(cb)
}
/** Run `cb` now and after every language change (handy for `label.textContent = t(...)`). */
export function bindLang(cb: (lang: Lang) => void): () => void {
  cb(getLang())
  return onLangChange(cb)
}

/** Evaluate `fn` with a fixed language (e.g. 'en' to match against English labels). */
export function inLang<T>(lang: Lang, fn: () => T): T {
  const prev = override
  override = lang
  try {
    return fn()
  } finally {
    override = prev
  }
}

// ------------------------------------------------------------------ lookup
const pluralRules: Partial<Record<Lang, Intl.PluralRules>> = {}
function pluralCat(lang: Lang, n: number): string {
  return (pluralRules[lang] ??= new Intl.PluralRules(lang)).select(n)
}

function find(lang: Lang, key: string, count: number | undefined): string | undefined {
  const d = dicts[lang]
  if (count !== undefined) {
    const s = d[`${key}_${pluralCat(lang, count)}`] ?? d[`${key}_other`]
    if (s !== undefined) return s
  }
  return d[key]
}

/** True when `key` exists in the base (English) dictionary (plural base keys count too). */
export function has(key: string): boolean {
  const d = dicts.en
  return key in d || `${key}_other` in d
}

const warned = new Set<string>()
const isDev = (): boolean => {
  try {
    return !!(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV
  } catch {
    return false
  }
}

const interpolate = (s: string, params?: Params): string =>
  params ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : s

/**
 * Translate `key`. `{name}` placeholders are replaced from `params`; a numeric `params.count` selects the
 * plural variant (`key_one`, `key_few`, `key_many`, `key_other`) by the language's Intl.PluralRules.
 * Falls back to English, then to the key itself (warns once in dev).
 */
export function t(key: string, params?: Params): string {
  const lang = getLang()
  const count = typeof params?.count === 'number' ? params.count : undefined
  let s = find(lang, key, count)
  if (s === undefined && lang !== FALLBACK_LANG) s = find(FALLBACK_LANG, key, count)
  if (s === undefined) {
    if (isDev() && !warned.has(key)) {
      warned.add(key)
      console.warn(`[i18n] missing key "${key}"`)
    }
    return key
  }
  return interpolate(s, params)
}

/** Translate in a specific language regardless of the current one. */
export const tIn = (lang: Lang, key: string, params?: Params): string => inLang(lang, () => t(key, params))

/** Turn a key / literal / `tk()` ref / resolver into a string. A plain string that is a known key is translated; any other string passes through. */
export function resolveText(x: I18nText | null | undefined): string {
  if (x == null) return ''
  if (typeof x === 'function') return x()
  if (isRef(x)) return t(x.key, x.params)
  return has(x) ? t(x) : x
}

// ------------------------------------------------------------------ DOM helpers
/** attribute name -> data-attribute stem. `text` is textContent; `html` is innerHTML (trusted dictionary strings only). */
const ATTRS: [attr: string, data: string][] = [
  ['text', 'data-i18n'],
  ['html', 'data-i18n-html'],
  ['title', 'data-i18n-title'],
  ['placeholder', 'data-i18n-placeholder'],
  ['aria-label', 'data-i18n-aria-label'],
  ['data-tip', 'data-i18n-tip'],
  ['label', 'data-i18n-label'],
  ['alt', 'data-i18n-alt'],
  ['value', 'data-i18n-value']
]
const SELECTOR = ATTRS.map(([, d]) => `[${d}]`).join(',')

function paramsOf(el: Element, stem: string): Params | undefined {
  const p = el.getAttribute(stem + '-params')
  if (!p) return undefined
  try {
    return JSON.parse(p) as Params
  } catch {
    return undefined
  }
}

function setAttr(el: Element, attr: string, value: string): void {
  if (attr === 'text') {
    if (!el.children.length) el.textContent = value
    else {
      // keep child elements (icons, badges): only replace the element's own text node
      const tn = [...el.childNodes].find((n) => n.nodeType === 3)
      if (tn) (tn as Text).data = value
      else el.prepend(document.createTextNode(value))
    }
  }
  else if (attr === 'html') el.innerHTML = value
  else if (attr === 'title') {
    // the tooltip layer (features/interface/appearance) moves title -> data-tip after the first hover
    if (el.hasAttribute('data-tip')) el.setAttribute('data-tip', value)
    if (el.hasAttribute('title') || !el.hasAttribute('data-tip')) el.setAttribute('title', value)
  } else if (attr === 'value') (el as HTMLInputElement).value = value
  else el.setAttribute(attr, value)
}

/** Point `attr` of `el` (`text`, `html`, `title`, `placeholder`, `aria-label`, `data-tip`, `label`, `alt`, `value`) at a key. Re-translated on language change. */
export function tAttr<E extends Element>(el: E, attr: string, key: string, params?: Params): E {
  const stem = ATTRS.find(([a]) => a === attr)?.[1] ?? 'data-i18n-' + attr
  el.setAttribute(stem, key)
  if (params) el.setAttribute(stem + '-params', JSON.stringify(params))
  else el.removeAttribute(stem + '-params')
  setAttr(el, attr, t(key, params))
  return el
}
/** `tEl(el, 'layers.title')` - set textContent from a key and keep it translated. Returns `el`. */
export const tEl = <E extends Element>(el: E, key: string, params?: Params): E => tAttr(el, 'text', key, params)

/** Re-translate every `data-i18n*` element under `root` (called automatically by setLang). */
export function translateDom(root: ParentNode = document): void {
  const list = [...root.querySelectorAll(SELECTOR)]
  if (root instanceof Element && root.matches(SELECTOR)) list.unshift(root)
  for (const el of list) {
    for (const [attr, stem] of ATTRS) {
      const key = el.getAttribute(stem)
      if (key) setAttr(el, attr, t(key, paramsOf(el, stem)))
    }
  }
}

/** Used by ui/dom.ts `h()`: apply a ref to an attribute. */
export function applyRef(el: Element, attr: string, ref: I18nRef): void {
  tAttr(el, attr, ref.key, ref.params)
}

/** Text node child that follows the language: a `<span data-i18n>`. */
export function tSpan(key: string, params?: Params, cls?: string): HTMLSpanElement {
  const s = document.createElement('span')
  if (cls) s.className = cls
  return tEl(s, key, params)
}

/** Undo-history / commit label (English source string) in the current language; unknown labels pass through. */
export function historyLabel(label: string): string {
  const k = 'core.history.' + label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  return has(k) ? t(k) : label
}
