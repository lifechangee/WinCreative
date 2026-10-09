/**
 * Pure per-variant logic of the time-lapse editor (no DOM / GL, unit-tested): which frames a variant plays, the per-variant edit
 * models (+ migration of the old single model), copying edits between variants, thinning of a multi-variant recording, and the
 * mapping that keeps the panes of the compare view in step. The schedule itself is still `buildSchedule(kept, edit)` (tlModel.ts).
 */
import { ALL_VARIANTS, VTag, frameInVariant, groupOf } from '../langvariants/model'
import { FrameTag, KeepResult, computeKeep } from './tlHistory'
import { Schedule, TlEdit, cloneEdit, defaultEdit, itemAt, normalizeEdit } from './tlModel'

export type TagFull = FrameTag & VTag

// ------------------------------------------------------------------ which frames a variant plays
/**
 * "Hide undone actions" for ONE variant: the history tree is shared, but undo / redo navigation frames and the final-state path are
 * evaluated on the frames of the variant only (`*` frames included). Frames of other variants come back as `keep = false`.
 * `variant === null` = the whole recording (no variants).
 */
export function keepForVariant(tags: readonly TagFull[], parents: number[], variant: string | null): KeepResult {
  if (variant === null) return computeKeep(tags as FrameTag[], parents)
  const idx: number[] = []
  for (let i = 0; i < tags.length; i++) if (frameInVariant(tags[i].v, variant)) idx.push(i)
  const sub = computeKeep(
    idx.map((i) => tags[i]),
    parents
  )
  const keep = new Array<boolean>(tags.length).fill(false)
  for (let k = 0; k < idx.length; k++) keep[idx[k]] = sub.keep[k]
  return { ...sub, keep }
}

/** Source indices of the frames shown for `variant` under an edit (hide-undone applied), ascending; never empty for a non-empty recording. */
export function keptForVariant(tags: readonly TagFull[], parents: number[], variant: string | null, hideUndone: boolean): { kept: number[]; keep: KeepResult } {
  const keep = keepForVariant(tags, parents, variant)
  const useKeep = hideUndone && keep.supported
  const kept: number[] = []
  for (let i = 0; i < tags.length; i++) {
    if (!frameInVariant(tags[i].v, variant)) continue
    if (!useKeep || keep.keep[i]) kept.push(i)
  }
  if (!kept.length && tags.length) {
    // never an empty video: the last frame of the variant (else of the recording)
    for (let i = tags.length - 1; i >= 0; i--)
      if (frameInVariant(tags[i].v, variant)) {
        kept.push(i)
        break
      }
    if (!kept.length) kept.push(tags.length - 1)
  }
  return { kept, keep }
}

// ------------------------------------------------------------------ edit sets (one edit model per variant)
export const EDIT_SET_VERSION = 2
/** `by['*']` is the model of a recording without variants; with variants there is one entry per language code. */
export interface TlEditSet {
  v: 2
  by: Record<string, TlEdit>
}

export function defaultEditSet(codes: readonly string[], hideUndone = true): TlEditSet {
  const by: Record<string, TlEdit> = { [ALL_VARIANTS]: defaultEdit(hideUndone) }
  for (const c of codes) by[c] = defaultEdit(hideUndone)
  return { v: 2, by }
}

/**
 * Load the persisted edit model. A version-1 model (one TlEdit, every file made before 0.4.0) is migrated by giving ALL variants a copy of it;
 * version 2 holds one model per variant. Missing variants start from the shared model.
 */
export function parseEditSet(raw: unknown, codes: readonly string[], hideUndone = true): TlEditSet {
  const r = raw as { v?: unknown; by?: Record<string, unknown> } | null | undefined
  const by: Record<string, TlEdit> = {}
  if (r && typeof r === 'object' && r.v === EDIT_SET_VERSION && r.by && typeof r.by === 'object') {
    for (const [k, e] of Object.entries(r.by)) by[k] = normalizeEdit(e, hideUndone)
    const base = by[ALL_VARIANTS] ?? normalizeEdit(null, hideUndone)
    by[ALL_VARIANTS] = base
    for (const c of codes) by[c] ??= cloneEdit(base)
    return { v: 2, by }
  }
  const base = normalizeEdit(raw, hideUndone)
  by[ALL_VARIANTS] = base
  for (const c of codes) by[c] = cloneEdit(base)
  return { v: 2, by }
}

/**
 * What goes into the .bwk. Without language variants the plain version-1 model is written (a 0.3.0 build reads such a file unchanged);
 * with variants the version-2 set (only the languages that exist).
 */
export function serializeEditSet(set: TlEditSet, codes: readonly string[], withVariants: boolean): unknown {
  if (!withVariants) return set.by[ALL_VARIANTS]
  const by: Record<string, TlEdit> = { [ALL_VARIANTS]: set.by[ALL_VARIANTS] }
  for (const c of codes) if (set.by[c]) by[c] = set.by[c]
  return { v: 2, by }
}

export const editOf = (set: TlEditSet, variant: string | null): TlEdit => set.by[variant ?? ALL_VARIANTS] ?? set.by[ALL_VARIANTS]
export function withEdit(set: TlEditSet, variant: string | null, e: TlEdit): TlEditSet {
  return { v: 2, by: { ...set.by, [variant ?? ALL_VARIANTS]: e } }
}

// ------------------------------------------------------------------ copy edits between variants
/** Index (into `idx`) of the entry whose capture group is nearest to `g` (ties -> the earlier one). */
function nearestByGroup(gs: readonly number[], g: number): number {
  let lo = 0
  let hi = gs.length - 1
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (gs[m] >= g) hi = m
    else lo = m + 1
  }
  if (lo > 0 && Math.abs(gs[lo - 1] - g) <= Math.abs(gs[lo] - g)) return lo - 1
  return lo
}

/**
 * Pauses, speed segments, global speed, finale and hide-undone of `src` (the edit of variant `from`) laid onto `to`: every source index is
 * mapped to the frame of `to` that was captured at the same drawing moment (same capture group), else the nearest one. The target keeps
 * its own "fit to duration" (it is usually fitted to a different voice-over).
 */
export function copyEditBetweenVariants(src: TlEdit, dst: TlEdit, tags: readonly TagFull[], from: string, to: string): TlEdit {
  const dstIdx: number[] = []
  const dstG: number[] = []
  for (let i = 0; i < tags.length; i++)
    if (frameInVariant(tags[i].v, to)) {
      dstIdx.push(i)
      dstG.push(groupOf(tags, i))
    }
  void from
  const n = tags.length
  const map = (i: number): number => {
    if (!dstIdx.length) return Math.min(Math.max(0, i), Math.max(0, n - 1))
    const j = nearestByGroup(dstG, groupOf(tags, Math.min(Math.max(0, i), n - 1)))
    return dstIdx[j]
  }
  const out = cloneEdit(dst)
  out.globalSpeed = src.globalSpeed
  out.hideUndone = src.hideUndone
  out.finale = { ...src.finale }
  out.segments = []
  out.pauses = []
  let id = 1
  for (const s of src.segments) {
    const f = map(s.from)
    const t = s.to >= n ? n : map(s.to)
    if (t > f) out.segments.push({ id: id++, from: f, to: t, speed: s.speed })
  }
  for (const p of src.pauses) out.pauses.push({ id: id++, at: map(p.at), seconds: p.seconds })
  out.nextId = id
  return normalizeEdit(out, out.hideUndone)
}

// ------------------------------------------------------------------ thinning
/**
 * Marathon sessions are thinned by keeping every second frame; with variants this is done per "lane" (the frames sharing one variant tag), so
 * every variant keeps an even sampling. Returns the surviving source indices (ascending); the last frame of every lane always survives.
 */
export function decimateSurvivors(tags: readonly TagFull[]): number[] {
  const lane = (t: TagFull): string => (t.v ? t.v.join(',') : ALL_VARIANTS)
  const counters = new Map<string, number>()
  const lastOf = new Map<string, number>()
  tags.forEach((t, i) => lastOf.set(lane(t), i))
  const out: number[] = []
  for (let i = 0; i < tags.length; i++) {
    const l = lane(tags[i])
    const c = counters.get(l) ?? 0
    counters.set(l, c + 1)
    if (c % 2 === 0 || lastOf.get(l) === i) out.push(i)
  }
  return out
}

/** Follow a thinning (`survivors` = kept old indices) in the indices an edit refers to. */
export function remapEditBySurvivors(e: TlEdit, survivors: readonly number[]): TlEdit {
  const out = cloneEdit(e)
  // first survivor with old index >= i
  const firstGE = (i: number): number => {
    let lo = 0
    let hi = survivors.length
    while (lo < hi) {
      const m = (lo + hi) >> 1
      if (survivors[m] >= i) hi = m
      else lo = m + 1
    }
    return lo
  }
  out.segments = out.segments.map((s) => ({ ...s, from: firstGE(s.from), to: firstGE(s.to) })).filter((s) => s.to > s.from)
  // a pause holds the last shown frame at or before its anchor: that is the last survivor <= at
  out.pauses = out.pauses.map((p) => ({ ...p, at: Math.max(0, firstGE(p.at + 1) - 1) }))
  return out
}

// ------------------------------------------------------------------ compare view
export type SyncMode = 'moment' | 'time'

export interface PaneSched {
  /** source indices of the frames the pane plays */
  kept: number[]
  schedule: Schedule
  /** capture group per kept frame (ascending) */
  groups: number[]
}

export function makePane(kept: number[], schedule: Schedule, tags: readonly TagFull[]): PaneSched {
  return { kept, schedule, groups: kept.map((i) => groupOf(tags, i)) }
}

/** Index (into `groups`) of the last entry with group <= g (0 when every group is later). */
export function lastAtOrBefore(groups: readonly number[], g: number): number {
  let lo = 0
  let hi = groups.length - 1
  let r = 0
  while (lo <= hi) {
    const m = (lo + hi) >> 1
    if (groups[m] <= g) {
      r = m
      lo = m + 1
    } else hi = m - 1
  }
  return r
}

/** The pane with the longest video: it drives the shared clock. */
export function leadPane(panes: readonly PaneSched[]): number {
  let best = 0
  for (let i = 1; i < panes.length; i++) if (panes[i].schedule.total > panes[best].schedule.total) best = i
  return best
}

export interface PaneView {
  /** schedule item index shown by the pane */
  item: number
  /** source frame shown */
  frame: number
  /** the pane's own video time at this position */
  time: number
}

/**
 * What every pane shows at shared clock `t` (seconds of the lead pane's video, or of every pane's own video in 'time' mode).
 *  - 'time': each pane plays its own schedule from the same second (a pane that is over shows its last frame);
 *  - 'moment': the lead pane decides the drawing moment (capture group of its frame at `t`); every other pane shows its latest frame
 *    captured at or before that moment, so the same stroke appears in all panes together whatever each video's speed.
 */
export function panesAt(panes: readonly PaneSched[], mode: SyncMode, t: number): PaneView[] {
  if (!panes.length) return []
  const lead = leadPane(panes)
  const pick = (p: PaneSched, item: number): PaneView => ({ item, frame: p.schedule.items[item]?.frameIndex ?? 0, time: p.schedule.items[item]?.startTime ?? 0 })
  if (mode === 'time') return panes.map((p) => (p.schedule.items.length ? pick(p, itemAt(p.schedule, t)) : { item: -1, frame: 0, time: 0 }))
  const ls = panes[lead].schedule
  const li = itemAt(ls, t)
  const g = ls.items.length ? panes[lead].groups[li] : 0
  return panes.map((p, i) => {
    if (!p.schedule.items.length) return { item: -1, frame: 0, time: 0 }
    if (i === lead) return pick(p, li)
    return pick(p, lastAtOrBefore(p.groups, g))
  })
}

/** The clock position of the next / previous frame of the lead pane (frame stepping works in both sync modes). */
export function stepClock(panes: readonly PaneSched[], t: number, dir: 1 | -1): number {
  if (!panes.length) return 0
  const s = panes[leadPane(panes)].schedule
  if (!s.items.length) return 0
  const i = itemAt(s, t)
  const j = Math.min(s.items.length - 1, Math.max(0, i + dir))
  return j === s.items.length - 1 && dir > 0 && i === j ? s.total : s.items[j].startTime
}

/** The total length of the shared clock. */
export const clockLength = (panes: readonly PaneSched[]): number => panes.reduce((m, p) => Math.max(m, p.schedule.total), 0)
