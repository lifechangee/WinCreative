import { describe, expect, it } from 'vitest'
import { en } from '../src/renderer/src/i18n/locales/en'
import { ru } from '../src/renderer/src/i18n/locales/ru'
import { allKeys, has, inLang, resolveText, setLang, t, tIn, tk } from '../src/renderer/src/i18n'

const PLURAL = /_(zero|one|two|few|many|other)$/
const base = (k: string): string => k.replace(PLURAL, '')
const params = (s: string): string[] => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort()
const flat = (m: Record<string, Record<string, string>>): Record<string, string> => Object.assign({}, ...Object.values(m))

const EN = flat(en)
const RU = flat(ru)

describe('i18n dictionaries', () => {
  it('every key is prefixed with its module name', () => {
    const bad: string[] = []
    for (const [lang, dicts] of [['en', en], ['ru', ru]] as const) {
      for (const [mod, d] of Object.entries(dicts)) for (const k of Object.keys(d)) if (!k.startsWith(mod + '.')) bad.push(`${lang}/${mod}: ${k}`)
    }
    expect(bad, 'keys must start with "<module>."').toEqual([])
  })

  it('no key is defined in two modules', () => {
    for (const dicts of [en, ru]) {
      const seen = new Map<string, string>()
      const dup: string[] = []
      for (const [mod, d] of Object.entries(dicts)) for (const k of Object.keys(d)) (seen.has(k) ? dup.push(`${k} (${seen.get(k)} & ${mod})`) : seen.set(k, mod))
      expect(dup).toEqual([])
    }
  })

  it('every en key exists in ru (lists the missing ones)', () => {
    const missing = Object.keys(EN).filter((k) => !(k in RU))
    // plural variants only need their group: ru has its own plural categories (checked below)
    const real = missing.filter((k) => !PLURAL.test(k) || !Object.keys(RU).some((r) => base(r) === base(k)))
    expect(real, `${real.length} key(s) missing in ru:\n  ` + real.join('\n  ')).toEqual([])
  })

  it('ru has no orphan keys (not in en)', () => {
    const enBases = new Set(Object.keys(EN).map(base))
    const orphans = Object.keys(RU).filter((k) => !(k in EN) && !enBases.has(base(k)))
    expect(orphans, 'ru keys without an en counterpart:\n  ' + orphans.join('\n  ')).toEqual([])
  })

  it('{params} match between en and ru', () => {
    const bad: string[] = []
    const groups = (d: Record<string, string>): Map<string, string[]> => {
      const g = new Map<string, string[]>()
      for (const [k, v] of Object.entries(d)) (g.get(base(k)) ?? g.set(base(k), []).get(base(k))!).push(v)
      return g
    }
    const ge = groups(EN)
    const gr = groups(RU)
    for (const [b, ruVals] of gr) {
      const enVals = ge.get(b)
      if (!enVals) continue
      const allowed = new Set(enVals.flatMap(params))
      allowed.add('count')
      for (const v of ruVals) for (const p of params(v)) if (!allowed.has(p)) bad.push(`${b}: ru uses {${p}} which en does not`)
      const need = new Set(enVals.flatMap(params))
      need.delete('count')
      for (const p of need) if (!ruVals.some((v) => params(v).includes(p))) bad.push(`${b}: ru lacks {${p}}`)
    }
    expect(bad).toEqual([])
  })

  it('plural groups are complete (en: one+other, ru: one+few+many+other)', () => {
    const bad: string[] = []
    const check = (d: Record<string, string>, need: string[], lang: string): void => {
      const g = new Map<string, Set<string>>()
      for (const k of Object.keys(d)) {
        const m = PLURAL.exec(k)
        if (m) (g.get(base(k)) ?? g.set(base(k), new Set()).get(base(k))!).add(m[1])
      }
      for (const [b, cats] of g) for (const c of need) if (!cats.has(c)) bad.push(`${lang}: ${b}_${c}`)
    }
    check(EN, ['one', 'other'], 'en')
    check(RU, ['one', 'few', 'many', 'other'], 'ru')
    expect(bad).toEqual([])
  })

  it('no empty strings', () => {
    expect([...Object.entries(EN), ...Object.entries(RU)].filter(([, v]) => !v.trim()).map(([k]) => k)).toEqual([])
  })
})

describe('i18n runtime', () => {
  it('translates, interpolates and falls back', () => {
    setLang('en')
    expect(t('core.common.cancel')).toBe('Cancel')
    setLang('ru')
    expect(t('core.common.cancel')).toBe('Отмена')
    expect(t('interface.prefs.slot_n', { n: 3 })).toBe('Ячейка 3')
    expect(t('no.such.key')).toBe('no.such.key') // missing everywhere -> the key
    expect(tIn('en', 'core.common.cancel')).toBe('Cancel')
    expect(inLang('en', () => t('core.common.done'))).toBe('Done')
    expect(t('core.common.done')).toBe('Готово')
  })

  it('Russian plural rules', () => {
    setLang('ru')
    const s = (n: number): string => t('interface.prefs.pad.tap', { count: n })
    expect(s(1)).toBe('Касание 1 пальцем')
    expect(s(2)).toBe('Касание 2 пальцами')
    expect(s(5)).toBe('Касание 5 пальцами')
    setLang('en')
    expect(t('interface.prefs.pad.tap', { count: 1 })).toBe('1-finger tap')
    expect(t('interface.prefs.pad.tap', { count: 3 })).toBe('3-finger tap')
  })

  it('resolveText accepts keys, refs, resolvers and literals', () => {
    setLang('ru')
    expect(resolveText('core.common.cancel')).toBe('Отмена')
    expect(resolveText(tk('core.common.cancel'))).toBe('Отмена')
    expect(resolveText(() => 'x')).toBe('x')
    expect(resolveText('Some literal')).toBe('Some literal')
    expect(has('core.common.cancel')).toBe(true)
    expect(has('Some literal')).toBe(false)
    setLang('en')
  })

  it('a key missing in ru falls back to en', () => {
    setLang('ru')
    const enOnly = allKeys('en').find((k) => !(k in RU) && !PLURAL.test(k))
    if (enOnly) expect(t(enOnly)).toBe(EN[enOnly])
    setLang('en')
  })
})
