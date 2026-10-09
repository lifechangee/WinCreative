import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LANGS,
  MAX_LANGS,
  addLanguage,
  addToPending,
  classifyCommit,
  cleanCode,
  cleanVariantTag,
  emptyPending,
  frameInVariant,
  nextGroupId,
  nextLang,
  normalizeLangs,
  planFrames,
  removeLanguage,
  renameLanguage,
  validLang,
  variantFileName,
  variantIndices
} from '../src/renderer/src/features/langvariants/model'
import {
  TagFull,
  clockLength,
  copyEditBetweenVariants,
  decimateSurvivors,
  defaultEditSet,
  editOf,
  keepForVariant,
  keptForVariant,
  leadPane,
  makePane,
  panesAt,
  parseEditSet,
  remapEditBySurvivors,
  serializeEditSet,
  stepClock,
  withEdit
} from '../src/renderer/src/features/animio/tlVariants'
import { addPause, applySegment, buildSchedule, defaultEdit } from '../src/renderer/src/features/animio/tlModel'

describe('language list', () => {
  it('defaults and normalisation', () => {
    expect(normalizeLangs(undefined)).toEqual(DEFAULT_LANGS)
    expect(normalizeLangs([{ code: 'EN', name: 'English' }])).toEqual(DEFAULT_LANGS) // < 2 languages
    const l = normalizeLangs([{ code: 'De!', name: ' Deutsch ' }, { code: 'de', name: 'dup' }, { code: 'fr', name: '' }, { code: 'es', name: 'Español' }, { code: 'it', name: 'x' }, { code: 'pt', name: 'y' }])
    expect(l.map((x) => x.code)).toEqual(['de', 'fr', 'es', 'it'])
    expect(l[0].name).toBe('Deutsch')
    expect(l[1].name).toBe('FR')
    expect(l.length).toBe(MAX_LANGS)
  })
  it('add / remove / rename guard the invariants', () => {
    let r = addLanguage(DEFAULT_LANGS, 'DE', 'Deutsch')
    expect(r.error).toBeUndefined()
    expect(r.langs.map((l) => l.code)).toEqual(['en', 'ru', 'de'])
    expect(addLanguage(r.langs, 'de', 'x').error).toBe('duplicate')
    expect(addLanguage(r.langs, '', 'x').error).toBe('code')
    expect(addLanguage(r.langs, 'fr', ' ').error).toBe('name')
    r = addLanguage(r.langs, 'fr', 'Français')
    expect(addLanguage(r.langs, 'es', 'Español').error).toBe('max')
    expect(removeLanguage(DEFAULT_LANGS, 'ru').error).toBe('min')
    expect(removeLanguage(r.langs, 'zz').error).toBe('missing')
    expect(removeLanguage(r.langs, 'fr').langs.length).toBe(3)
    const rn = renameLanguage(DEFAULT_LANGS, 'ru', 'Russian')
    expect(rn.langs[1]).toEqual({ code: 'ru', name: 'Russian' })
    expect(renameLanguage(DEFAULT_LANGS, 'ru', '  ').error).toBe('name')
  })
  it('cycling and fallback', () => {
    expect(nextLang(DEFAULT_LANGS, 'en')).toBe('ru')
    expect(nextLang(DEFAULT_LANGS, 'ru')).toBe('en')
    expect(nextLang(DEFAULT_LANGS, 'en', -1)).toBe('ru')
    expect(nextLang(DEFAULT_LANGS, 'zz')).toBe('en')
    expect(validLang(DEFAULT_LANGS, 'ru')).toBe('ru')
    expect(validLang(DEFAULT_LANGS, 'xx')).toBe('en')
    expect(cleanCode('  Ру-1 ')).toBe('1')
  })
  it('variant file names', () => {
    expect(variantFileName('C:\\out\\clip.mp4', 'ru')).toBe('C:\\out\\clip.ru.mp4')
    expect(variantFileName('a.b/clip.webm', 'en')).toBe('a.b/clip.en.webm')
    expect(variantFileName('C:\\a.b\\clip', 'en')).toBe('C:\\a.b\\clip.en')
  })
})

describe('commit classification', () => {
  const langOf = (id: string): string | null => (id.startsWith('en') ? 'en' : id.startsWith('ru') ? 'ru' : null)
  it('cell strokes affect only their language', () => {
    expect(classifyCommit({ type: 'stroke', layerId: 'en1', hasDirty: true }, langOf)).toEqual({ all: false, langs: ['en'] })
    expect(classifyCommit({ type: 'erase', layerId: 'ru2', hasDirty: true }, langOf)).toEqual({ all: false, langs: ['ru'] })
  })
  it('common layers and structural commits affect all variants', () => {
    expect(classifyCommit({ type: 'stroke', layerId: 'c1', hasDirty: true }, langOf).all).toBe(true)
    expect(classifyCommit({ type: 'layer-props', layerId: 'en1', hasDirty: false }, langOf).all).toBe(true)
    expect(classifyCommit({ type: 'layer-delete', layerId: 'en1', hasDirty: false }, langOf).all).toBe(true)
    expect(classifyCommit({ type: 'stroke', layerId: null, hasDirty: true }, langOf).all).toBe(true)
    expect(classifyCommit({ type: 'load', layerId: null, hasDirty: false }, langOf).all).toBe(true)
  })
  it('undo / redo of pixel work on a cell is local, of structural work global', () => {
    expect(classifyCommit({ type: 'undo', layerId: 'ru1', hasDirty: true }, langOf)).toEqual({ all: false, langs: ['ru'] })
    expect(classifyCommit({ type: 'redo', layerId: 'ru1', hasDirty: false }, langOf).all).toBe(true)
  })
  it('a transaction touching a cell AND a common layer is global; two cells of one language stay local', () => {
    expect(classifyCommit({ type: 'transform', layerId: 'en1', layerIds: ['en1', 'c9'], hasDirty: true }, langOf).all).toBe(true)
    expect(classifyCommit({ type: 'transform', layerId: 'en1', layerIds: ['en1', 'en2'], hasDirty: true }, langOf)).toEqual({ all: false, langs: ['en'] })
    expect(classifyCommit({ type: 'layer-paste', layerId: 'en1', layerIds: ['en1', 'ru1'], hasDirty: true }, langOf).langs.sort()).toEqual(['en', 'ru'])
  })
})

describe('frame planning', () => {
  const ctx = (content: Record<string, boolean>, any = true) => ({ langs: ['en', 'ru'], anyContent: any, contentInArea: (c: string) => !!content[c] })
  const pend = (all: boolean, ...langs: string[]) => {
    const p = emptyPending()
    addToPending(p, { all, langs })
    return p
  }
  it('no language content yet: one shared * frame, whatever the commit', () => {
    expect(planFrames(pend(true), ctx({}, false))).toEqual([{ variants: null, render: null }])
    expect(planFrames(pend(false, 'en'), ctx({}, false))).toEqual([{ variants: null, render: null }])
  })
  it('a cell commit gives one frame for that variant only', () => {
    expect(planFrames(pend(false, 'ru'), ctx({ ru: true }))).toEqual([{ variants: ['ru'], render: 'ru' }])
    // even when its picture would equal the other one (no dedup across a one-variant commit)
    expect(planFrames(pend(false, 'ru'), ctx({}))).toEqual([{ variants: ['ru'], render: 'ru' }])
  })
  it('a common commit gives one frame per variant with different pictures', () => {
    const p = planFrames(pend(true), ctx({ en: true, ru: true }))
    expect(p).toEqual([
      { variants: ['en'], render: 'en' },
      { variants: ['ru'], render: 'ru' }
    ])
  })
  it('variants with no cell content in the capture area share one frame', () => {
    expect(planFrames(pend(true), ctx({}))).toEqual([{ variants: ['en', 'ru'], render: 'en' }])
    const p = planFrames(pend(true), { langs: ['en', 'ru', 'de'], anyContent: true, contentInArea: (c) => c === 'ru' })
    expect(p).toEqual([
      { variants: ['en', 'de'], render: 'en' },
      { variants: ['ru'], render: 'ru' }
    ])
  })
  it('commits coalesced into one capture: union of the affected variants', () => {
    const p = pend(false, 'en')
    addToPending(p, { all: false, langs: ['ru'] })
    expect(planFrames(p, ctx({ en: true, ru: true })).map((f) => f.variants)).toEqual([['en'], ['ru']])
    addToPending(p, { all: true, langs: [] })
    expect(planFrames(p, ctx({ en: true, ru: true })).length).toBe(2)
  })
  it('no commit info (first frame / recording switched on): every variant', () => {
    expect(planFrames(emptyPending(), ctx({ en: true, ru: true })).length).toBe(2)
  })
})

// ------------------------------------------------------------------ tags / keep
/** A session: shared frames, then common, EN-only, RU-only and shared frames; with an undone EN stroke. */
function session(): { tags: TagFull[]; parents: number[] } {
  const tags: TagFull[] = [
    { s: 0, t: 'init', g: 0 },
    { s: 1, t: 'stroke', g: 1 }, // common, shared
    { s: 2, t: 'stroke', g: 2 }, // common, shared
    { s: 3, t: 'stroke', g: 3, v: ['ru'] }, // RU caption
    { s: 4, t: 'stroke', g: 4, v: ['ru'] },
    { s: 5, t: 'stroke', g: 5, v: ['en'] }, // EN caption, later undone
    { s: 4, t: 'undo', g: 6, v: ['en'] },
    { s: 6, t: 'stroke', g: 7, v: ['en'] }, // EN caption again (new branch)
    { s: 7, t: 'stroke', g: 8, v: ['en'] }, // common stroke after the captions: one frame per variant
    { s: 7, t: 'stroke', g: 8, v: ['ru'] }
  ]
  const parents = [-1, 0, 1, 2, 3, 4, 4, 6]
  return { tags, parents }
}

describe('variant frames', () => {
  it('membership', () => {
    expect(frameInVariant(undefined, 'en')).toBe(true)
    expect(frameInVariant(['ru'], 'en')).toBe(false)
    expect(frameInVariant(['ru', 'en'], 'en')).toBe(true)
    expect(frameInVariant(['ru'], null)).toBe(true)
    expect(variantIndices(session().tags, 'ru')).toEqual([0, 1, 2, 3, 4, 9])
    expect(cleanVariantTag(['EN', 'en', '', 5])).toEqual(['en', '5'])
    expect(cleanVariantTag('x')).toBeUndefined()
    expect(nextGroupId(session().tags)).toBe(10)
    expect(nextGroupId([{}, {}, {}])).toBe(3) // legacy frames: above their own indices
  })
  it('the schedule of a variant never contains frames of another variant', () => {
    const { tags, parents } = session()
    for (const hide of [false, true]) {
      const en = keptForVariant(tags, parents, 'en', hide).kept
      const ru = keptForVariant(tags, parents, 'ru', hide).kept
      expect(en.some((i) => tags[i].v?.[0] === 'ru')).toBe(false)
      expect(ru.some((i) => tags[i].v?.[0] === 'en')).toBe(false)
      // shared frames are in both
      for (const i of [0, 1, 2]) {
        expect(en).toContain(i)
        expect(ru).toContain(i)
      }
      const s = buildSchedule(en, defaultEdit(hide))
      expect(s.items.map((x) => x.frameIndex)).toEqual(en)
    }
  })
  it('hide undone works per variant on the shared tree', () => {
    const { tags, parents } = session()
    const en = keptForVariant(tags, parents, 'en', true).kept
    // the undone EN stroke (state 5, frame 5) vanishes; the undo frame (6) stays: it shows state 4, deeper than anything EN has shown (a duplicate picture, harmless); RU is untouched
    expect(en).toEqual([0, 1, 2, 6, 7, 8])
    expect(keptForVariant(tags, parents, 'en', false).kept).toEqual([0, 1, 2, 5, 6, 7, 8])
    expect(keptForVariant(tags, parents, 'ru', true).kept).toEqual([0, 1, 2, 3, 4, 9])
    const k = keepForVariant(tags, parents, 'ru')
    expect(k.keep[5]).toBe(false)
    expect(k.finalState).toBe(7)
  })
  it('legacy recordings (no variants) behave exactly as before', () => {
    const tags: TagFull[] = [{ s: 0 }, { s: 1, t: 'stroke' }, { s: 2, t: 'stroke' }]
    expect(keptForVariant(tags, [-1, 0, 1], null, true).kept).toEqual([0, 1, 2])
    expect(keptForVariant(tags, [-1, 0, 1], 'en', true).kept).toEqual([0, 1, 2])
    expect(keptForVariant([], [-1], 'en', true).kept).toEqual([])
  })
  it('a variant without frames of its own still plays something', () => {
    const tags: TagFull[] = [{ s: 0, v: ['ru'] }, { s: 1, v: ['ru'] }]
    expect(keptForVariant(tags, [-1, 0], 'en', true).kept).toEqual([1])
  })
})

describe('per-variant edit models', () => {
  it('migrates a version-1 model to every variant (and keeps the shared one)', () => {
    const old = { ...defaultEdit(), globalSpeed: 7, pauses: [{ id: 1, at: 3, seconds: 2 }], nextId: 2 }
    const set = parseEditSet(old, ['en', 'ru'])
    expect(editOf(set, 'en').globalSpeed).toBe(7)
    expect(editOf(set, 'ru').pauses).toEqual([{ id: 1, at: 3, seconds: 2 }])
    expect(editOf(set, null).globalSpeed).toBe(7)
    expect(editOf(set, 'en')).not.toBe(editOf(set, 'ru'))
  })
  it('round-trips version 2 and writes version 1 without variants', () => {
    let set = defaultEditSet(['en', 'ru'])
    set = withEdit(set, 'ru', { ...editOf(set, 'ru'), fitDuration: 42 })
    const raw = JSON.parse(JSON.stringify(serializeEditSet(set, ['en', 'ru'], true)))
    expect(raw.v).toBe(2)
    const back = parseEditSet(raw, ['en', 'ru'])
    expect(editOf(back, 'ru').fitDuration).toBe(42)
    expect(editOf(back, 'en').fitDuration).toBeNull()
    const plain = serializeEditSet(set, ['en', 'ru'], false) as { v: number }
    expect(plain.v).toBe(1)
    // a language added later starts from the shared model
    const more = parseEditSet(raw, ['en', 'ru', 'de'])
    expect(editOf(more, 'de').globalSpeed).toBe(1)
    // garbage
    expect(editOf(parseEditSet('junk', ['en']), 'en').v).toBe(1)
    expect(editOf(parseEditSet({ v: 2, by: 5 }, ['en']), 'en').globalSpeed).toBe(1)
  })
})

describe('copy edits between variants', () => {
  it('maps pauses and segments onto the frames of the same drawing moment', () => {
    const { tags } = session()
    let en = defaultEdit()
    en = addPause(en, 2, 3) // the shared frame 2
    en = addPause(en, 7, 1.5) // EN caption frame (group 7) -> RU has no such frame: nearest group
    en = applySegment(en, 1, 3, 4)
    en.globalSpeed = 5
    const ru0 = { ...defaultEdit(), fitDuration: 60 }
    const ru = copyEditBetweenVariants(en, ru0, tags, 'en', 'ru')
    expect(ru.globalSpeed).toBe(5)
    expect(ru.fitDuration).toBe(60) // the target keeps its own fit
    expect(ru.pauses[0]).toMatchObject({ at: 2, seconds: 3 })
    // group 7 sits between RU groups 4 and 8; nearest by group -> 8 (distance 1) -> RU frame 9
    expect(ru.pauses[1].at).toBe(9)
    expect(ru.segments).toEqual([{ id: expect.any(Number), from: 1, to: 3, speed: 4 }])
    // every mapped index is a frame RU actually has
    for (const p of ru.pauses) expect(tags[p.at].v === undefined || tags[p.at].v!.includes('ru')).toBe(true)
  })
  it('segment ends past the last frame stay at the end', () => {
    const { tags } = session()
    const en = applySegment(defaultEdit(), 5, 10, 2)
    const ru = copyEditBetweenVariants(en, defaultEdit(), tags, 'en', 'ru')
    expect(ru.segments.length).toBe(1)
    expect(ru.segments[0].to).toBe(10)
  })
})

describe('thinning', () => {
  it('keeps every second frame per lane and the last of each lane', () => {
    const tags: TagFull[] = []
    for (let i = 0; i < 10; i++) tags.push(i % 2 ? { v: ['en'] } : { v: ['ru'] })
    tags.push({}, {}, {}) // shared lane: 10, 11, 12
    const s = decimateSurvivors(tags)
    // en lane = 1,3,5,7,9 -> 1,5,9 ; ru lane = 0,2,4,6,8 -> 0,4,8 plus last (8) ; shared 10,12
    expect(s).toEqual([0, 1, 4, 5, 8, 9, 10, 12])
    const lastShared = decimateSurvivors([{}, {}, {}, {}])
    expect(lastShared).toEqual([0, 2, 3])
  })
  it('edits follow the thinning', () => {
    let e = applySegment(defaultEdit(), 4, 9, 3)
    e = addPause(e, 7, 1)
    const surv = [0, 2, 4, 6, 8, 9]
    const r = remapEditBySurvivors(e, surv)
    expect(r.segments).toEqual([{ id: expect.any(Number), from: 2, to: 5, speed: 3 }])
    // the pause held old frame 7 -> the last survivor <= 7 is 6 (new index 3)
    expect(r.pauses[0].at).toBe(3)
  })
})

describe('compare view', () => {
  const build = (): { en: ReturnType<typeof makePane>; ru: ReturnType<typeof makePane> } => {
    const { tags, parents } = session()
    const mk = (v: string, speed: number) => {
      const kept = keptForVariant(tags, parents, v, true).kept
      const e = defaultEdit()
      e.globalSpeed = speed
      e.finale.holdSeconds = 0
      return makePane(kept, buildSchedule(kept, e), tags)
    }
    return { en: mk('en', 1), ru: mk('ru', 0.5) }
  }
  it('lead = longest video, clock length', () => {
    const { en, ru } = build()
    expect(leadPane([en, ru])).toBe(1) // RU is slower -> longer
    expect(clockLength([en, ru])).toBeCloseTo(ru.schedule.total, 9)
  })
  it('by drawing moment: shared frames line up, captions appear in their own pane only', () => {
    const { en, ru } = build()
    const at = (t: number) => panesAt([en, ru], 'moment', t)
    const first = at(0)
    expect(first[0].frame).toBe(0)
    expect(first[1].frame).toBe(0)
    // at the lead's (RU) frame 3 (group 3) EN shows its latest frame captured at or before group 3 = shared frame 2
    const t3 = ru.schedule.items[ru.kept.indexOf(3)].startTime
    const m = at(t3)
    expect(m[1].frame).toBe(3)
    expect(m[0].frame).toBe(2)
    // at the end both show their final picture
    const end = at(clockLength([en, ru]))
    expect(end[0].frame).toBe(8)
    expect(end[1].frame).toBe(9)
  })
  it('by video time: each pane plays its own schedule from the same second; a finished pane holds its last frame', () => {
    const { en, ru } = build()
    const t = en.schedule.total + 0.5
    const v = panesAt([en, ru], 'time', t)
    expect(v[0].frame).toBe(8)
    expect(v[1].frame).toBe(ru.kept[ru.schedule.items.findIndex((x, i, a) => x.startTime <= t && (i + 1 === a.length || a[i + 1].startTime > t))])
    // different durations per pane
    expect(en.schedule.total).not.toBeCloseTo(ru.schedule.total, 3)
  })
  it('frame stepping walks the lead pane in both modes; stays smooth with thousands of frames', () => {
    const { en, ru } = build()
    const t1 = stepClock([en, ru], 0, 1)
    expect(t1).toBeCloseTo(ru.schedule.items[1].startTime, 9)
    expect(stepClock([en, ru], t1, -1)).toBe(0)
    expect(stepClock([en, ru], clockLength([en, ru]), 1)).toBeCloseTo(clockLength([en, ru]), 9)
    // 20000 frames, 2 variants: 20000 lookups well under a second
    const n = 20000
    const tags: TagFull[] = Array.from({ length: n }, (_, i) => ({ s: i, t: 'stroke', g: i >> 1, v: [i % 2 ? 'ru' : 'en'] }))
    const parents = [-1, ...Array.from({ length: n }, (_, i) => i)]
    const mk = (v: string) => {
      const kept = keptForVariant(tags, parents, v, true).kept
      return makePane(kept, buildSchedule(kept, defaultEdit()), tags)
    }
    const a = mk('en')
    const b = mk('ru')
    const t0 = performance.now()
    for (let i = 0; i < 20000; i++) panesAt([a, b], i % 2 ? 'moment' : 'time', (i / 20000) * clockLength([a, b]))
    expect(performance.now() - t0).toBeLessThan(1500)
    // same drawing moment: the two frames come from the same capture group
    const v = panesAt([a, b], 'moment', clockLength([a, b]) / 2)
    expect(tags[v[0].frame].g).toBe(tags[v[1].frame].g)
  })
})

// ------------------------------------------------------------------ layer tree rules
import { displayRows, moveRelative } from '../src/renderer/src/doc/layerTree'
import { validateManifest } from '../src/renderer/src/io/bwk'

type L = { id: string; parentId: string | null; isGroup: boolean; collapsed: boolean; langSet?: boolean; lang?: string }
const L = (id: string, o: Partial<L> = {}): L => ({ id, parentId: null, isGroup: false, collapsed: false, ...o })

describe('language layers in the layer tree', () => {
  const tree = (): L[] => [L('base'), L('en', { parentId: 'row', lang: 'en' }), L('ru', { parentId: 'row', lang: 'ru' }), L('row', { isGroup: true, langSet: true }), L('top')]
  it('a language layer is ONE panel row (cells are never listed)', () => {
    expect(displayRows(tree()).map((r) => r.layer.id)).toEqual(['top', 'row', 'base'])
    const t = tree()
    t.find((l) => l.id === 'row')!.collapsed = false
    expect(displayRows(t).map((r) => r.layer.id)).toEqual(['top', 'row', 'base'])
  })
  it('no language layer inside another, no ordinary layer or group inside one, cells stay in their row', () => {
    const t = [...tree(), L('row2', { isGroup: true, langSet: true }), L('grp', { isGroup: true })]
    expect(moveRelative(t, 'row2', 'row', 'into')).toBeNull()
    expect(moveRelative(t, 'base', 'row', 'into')).toBeNull()
    expect(moveRelative(t, 'grp', 'row', 'into')).toBeNull()
    expect(moveRelative(t, 'en', 'base', 'above')).toBeNull()
    expect(moveRelative(t, 'en', 'grp', 'into')).toBeNull()
    expect(moveRelative(t, 'en', 'ru', 'above')).not.toBeNull() // reorder inside the row
    // a language layer may live in an ordinary group, and move around
    expect(moveRelative(t, 'row', 'grp', 'into')).not.toBeNull()
    expect(moveRelative(t, 'row', 'top', 'above')).not.toBeNull()
  })
  it('a new cell may be placed into its (language) group while still unparented', () => {
    const t = [...tree(), L('new', { lang: 'de' })]
    expect(moveRelative(t, 'new', 'row', 'into')).not.toBeNull()
    expect(moveRelative([...tree(), L('plain')], 'plain', 'row', 'into')).toBeNull()
  })
})

describe('manifest', () => {
  const base = (layers: object[]): unknown => ({ format: 'brushwork', version: 1, name: 'x', width: 8, height: 8, background: { color: [1, 1, 1], visible: true }, layers })
  it('old files have no language fields: they load as common layers', () => {
    const m = validateManifest(base([{ id: 'a', file: 'layers/a.png' }]))
    expect(m.layers[0].langSet).toBe(false)
    expect(m.layers[0].lang).toBe('')
  })
  it('language fields are sanitised', () => {
    const m = validateManifest(base([{ id: 'g', file: '', isGroup: true, langSet: true, lang: 'en' }, { id: 'c', file: 'layers/c.png', lang: 'RU!', langSet: true }]))
    expect(m.layers[0].langSet).toBe(true)
    expect(m.layers[0].lang).toBe('') // a group is not a cell
    expect(m.layers[1].langSet).toBe(false) // a paint layer is not a language layer
    expect(m.layers[1].lang).toBe('ru')
  })
})

// ---- independent QA (docs/LANGUAGE_VARIANTS.md): regressions of the fixes
import { UndoStack } from '../src/renderer/src/core/undo'
describe('QA: UndoStack.top (an implicit cell creation is undone together with its stroke)', () => {
  it('peeks at the command the next undo reverts without removing it', () => {
    const s = new UndoStack()
    expect(s.top).toBeNull()
    const a = { label: 'a', bytes: 1, undo: () => undefined, redo: () => undefined }
    const b = { label: 'b', bytes: 1, undo: () => undefined, redo: () => undefined }
    s.push(a)
    s.push(b)
    expect(s.top).toBe(b)
    s.undo()
    expect(s.top).toBe(a)
    expect(s.undoCount).toBe(1)
    s.redo()
    expect(s.top).toBe(b)
  })
})
