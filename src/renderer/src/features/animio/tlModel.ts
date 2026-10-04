/**
 * Pure model of the time-lapse editor (no DOM / GL, unit-tested): the non-destructive edit description, and the ONE
 * mapping from (edit model + kept frames) to an output schedule that the live preview and the video export both use.
 *
 * Time model: the kept source frames play at BASE_FPS * speed frames per second. `speed` = global speed (or the speed
 * solved by "fit to duration") times the per-segment multiplier of the frame. A pause holds the frame it is anchored to,
 * the finale holds the last frame; neither is scaled by the speed.
 */

export const BASE_FPS = 30
export const SPEED_MIN = 0.01
export const SPEED_MAX = 1000
export const SEG_SPEED_MIN = 0.05
export const SEG_SPEED_MAX = 100
export const PAUSE_MIN = 0.05
export const PAUSE_MAX = 3600

export interface TlSegment {
  id: number
  /** first source frame (raw recording index), inclusive */
  from: number
  /** end source frame, exclusive */
  to: number
  /** multiplier relative to the global speed */
  speed: number
}
export interface TlPause {
  id: number
  /** source frame the pause is anchored to: the last SHOWN frame at or before it is held */
  at: number
  seconds: number
}
export interface TlFinale {
  holdSeconds: number
  fadeIn: number
  fadeOut: number
}
export interface TlEdit {
  v: 1
  hideUndone: boolean
  globalSpeed: number
  /** target total length in seconds; null = use globalSpeed */
  fitDuration: number | null
  segments: TlSegment[]
  pauses: TlPause[]
  finale: TlFinale
  nextId: number
}

export const DEFAULT_FINALE: TlFinale = { holdSeconds: 2, fadeIn: 0, fadeOut: 0 }

export function defaultEdit(hideUndone = true): TlEdit {
  return { v: 1, hideUndone, globalSpeed: 1, fitDuration: null, segments: [], pauses: [], finale: { ...DEFAULT_FINALE }, nextId: 1 }
}

export const cloneEdit = (e: TlEdit): TlEdit => JSON.parse(JSON.stringify(e)) as TlEdit
export const editsEqual = (a: TlEdit, b: TlEdit): boolean => JSON.stringify(a) === JSON.stringify(b)

const num = (x: unknown, d: number): number => (typeof x === 'number' && Number.isFinite(x) ? x : d)
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x))

/** Validate / repair an edit loaded from a file (unknown shapes fall back to defaults field by field). */
export function normalizeEdit(raw: unknown, hideUndoneDefault = true): TlEdit {
  const d = defaultEdit(hideUndoneDefault)
  if (!raw || typeof raw !== 'object') return d
  const r = raw as Record<string, unknown>
  const e: TlEdit = d
  if (typeof r.hideUndone === 'boolean') e.hideUndone = r.hideUndone
  e.globalSpeed = clamp(num(r.globalSpeed, 1), SPEED_MIN, SPEED_MAX)
  e.fitDuration = r.fitDuration === null || r.fitDuration === undefined ? null : clamp(num(r.fitDuration, 30), 0.1, 86400)
  const f = (r.finale ?? {}) as Record<string, unknown>
  e.finale = { holdSeconds: clamp(num(f.holdSeconds, DEFAULT_FINALE.holdSeconds), 0, 600), fadeIn: clamp(num(f.fadeIn, 0), 0, 60), fadeOut: clamp(num(f.fadeOut, 0), 0, 60) }
  let id = Math.max(1, Math.floor(num(r.nextId, 1)))
  const segs: TlSegment[] = []
  for (const s of Array.isArray(r.segments) ? (r.segments as Record<string, unknown>[]) : []) {
    const from = Math.floor(num(s?.from, -1))
    const to = Math.floor(num(s?.to, -1))
    if (from < 0 || to <= from) continue
    segs.push({ id: typeof s.id === 'number' ? Math.floor(s.id) : id++, from, to, speed: clamp(num(s.speed, 1), SEG_SPEED_MIN, SEG_SPEED_MAX) })
  }
  segs.sort((a, b) => a.from - b.from)
  for (let i = 0; i < segs.length; i++) if (i && segs[i].from < segs[i - 1].to) segs[i].from = segs[i - 1].to
  e.segments = segs.filter((s) => s.to > s.from)
  const pauses: TlPause[] = []
  for (const p of Array.isArray(r.pauses) ? (r.pauses as Record<string, unknown>[]) : []) {
    const at = Math.floor(num(p?.at, -1))
    if (at < 0) continue
    pauses.push({ id: typeof p.id === 'number' ? Math.floor(p.id) : id++, at, seconds: clamp(num(p.seconds, 1), PAUSE_MIN, PAUSE_MAX) })
  }
  pauses.sort((a, b) => a.at - b.at)
  e.pauses = pauses
  let maxId = id
  for (const x of [...e.segments, ...e.pauses]) maxId = Math.max(maxId, x.id + 1)
  e.nextId = maxId
  return e
}

/** Drop / clip everything that points past the end of a recording of `n` frames. */
export function clampEditToFrames(e: TlEdit, n: number): TlEdit {
  const out = cloneEdit(e)
  out.segments = out.segments.filter((s) => s.from < n).map((s) => ({ ...s, to: Math.min(s.to, n) }))
  out.pauses = out.pauses.map((p) => ({ ...p, at: Math.min(p.at, Math.max(0, n - 1)) }))
  return out
}

/**
 * The recorder thins marathon sessions (keeps every second frame): source indices of segments and pauses follow.
 * Old index i survives as floor(i / 2) (ranges: [ceil(from / 2), ceil(to / 2))).
 */
export function halveEditIndices(e: TlEdit): TlEdit {
  const out = cloneEdit(e)
  out.segments = out.segments.map((s) => ({ ...s, from: Math.ceil(s.from / 2), to: Math.ceil(s.to / 2) })).filter((s) => s.to > s.from)
  out.pauses = out.pauses.map((p) => ({ ...p, at: Math.floor(p.at / 2) }))
  return out
}

// ------------------------------------------------------------------ segments

export function segmentAt(segs: TlSegment[], idx: number): TlSegment | undefined {
  let lo = 0
  let hi = segs.length - 1
  while (lo <= hi) {
    const m = (lo + hi) >> 1
    const s = segs[m]
    if (idx < s.from) hi = m - 1
    else if (idx >= s.to) lo = m + 1
    else return s
  }
  return undefined
}
export const segmentSpeedAt = (segs: TlSegment[], idx: number): number => segmentAt(segs, idx)?.speed ?? 1

/** Set `speed` over [from, to): existing segments are cut / replaced where they overlap. Speed 1 just clears the range. */
export function applySegment(e: TlEdit, from: number, to: number, speed: number): TlEdit {
  const out = cloneEdit(e)
  if (to < from) [from, to] = [to, from]
  from = Math.max(0, Math.floor(from))
  to = Math.floor(to)
  if (to <= from) return out
  const next: TlSegment[] = []
  for (const s of out.segments) {
    if (s.to <= from || s.from >= to) next.push(s)
    else {
      if (s.from < from) next.push({ ...s, to: from })
      if (s.to > to) next.push({ ...s, id: s.from < from ? out.nextId++ : s.id, from: to })
    }
  }
  if (Math.abs(speed - 1) > 1e-9) next.push({ id: out.nextId++, from, to, speed: clamp(speed, SEG_SPEED_MIN, SEG_SPEED_MAX) })
  next.sort((a, b) => a.from - b.from)
  out.segments = next
  return out
}
export function removeSegment(e: TlEdit, id: number): TlEdit {
  const out = cloneEdit(e)
  out.segments = out.segments.filter((s) => s.id !== id)
  return out
}
export function setSegmentSpeed(e: TlEdit, id: number, speed: number): TlEdit {
  const out = cloneEdit(e)
  const s = out.segments.find((x) => x.id === id)
  if (s) s.speed = clamp(speed, SEG_SPEED_MIN, SEG_SPEED_MAX)
  return out
}
/** Cut a segment in two at source frame `at` (both halves keep the speed). */
export function splitSegment(e: TlEdit, at: number): TlEdit {
  const out = cloneEdit(e)
  const s = segmentAt(out.segments, at)
  if (!s || at <= s.from || at >= s.to) return out
  const right: TlSegment = { id: out.nextId++, from: at, to: s.to, speed: s.speed }
  s.to = at
  out.segments.push(right)
  out.segments.sort((a, b) => a.from - b.from)
  return out
}
/** Move the edges of a segment (clamped to the neighbours and to [0, n]). */
export function resizeSegment(e: TlEdit, id: number, from: number, to: number, n: number): TlEdit {
  const out = cloneEdit(e)
  const i = out.segments.findIndex((s) => s.id === id)
  if (i < 0) return out
  const lo = i > 0 ? out.segments[i - 1].to : 0
  const hi = i + 1 < out.segments.length ? out.segments[i + 1].from : n
  const f = clamp(Math.round(from), lo, hi - 1)
  const t = clamp(Math.round(to), f + 1, hi)
  out.segments[i] = { ...out.segments[i], from: f, to: t }
  return out
}

// ------------------------------------------------------------------ pauses
export function addPause(e: TlEdit, at: number, seconds: number): TlEdit {
  const out = cloneEdit(e)
  out.pauses.push({ id: out.nextId++, at: Math.max(0, Math.floor(at)), seconds: clamp(seconds, PAUSE_MIN, PAUSE_MAX) })
  out.pauses.sort((a, b) => a.at - b.at || a.id - b.id)
  return out
}
export function updatePause(e: TlEdit, id: number, patch: Partial<Pick<TlPause, 'at' | 'seconds'>>): TlEdit {
  const out = cloneEdit(e)
  const p = out.pauses.find((x) => x.id === id)
  if (!p) return out
  if (patch.at !== undefined) p.at = Math.max(0, Math.floor(patch.at))
  if (patch.seconds !== undefined) p.seconds = clamp(patch.seconds, PAUSE_MIN, PAUSE_MAX)
  out.pauses.sort((a, b) => a.at - b.at || a.id - b.id)
  return out
}
export function removePause(e: TlEdit, id: number): TlEdit {
  const out = cloneEdit(e)
  out.pauses = out.pauses.filter((p) => p.id !== id)
  return out
}

// ------------------------------------------------------------------ schedule
export interface ScheduleItem {
  /** source (raw recording) frame index shown */
  frameIndex: number
  /** seconds from the start of the video */
  startTime: number
  /** seconds the frame stays (includes pause / finale hold) */
  duration: number
  /** part of `duration` that is a user pause */
  pause: number
}
export interface Schedule {
  items: ScheduleItem[]
  total: number
  /** effective global speed (the solved one when fitting to a duration) */
  speed: number
  /** seconds of moving time, user pauses, final hold */
  body: number
  pauses: number
  hold: number
  /** fit to duration is reachable (pauses + hold leave room for the video) */
  fitOk: boolean
}

/** index into `kept` of the frame a pause anchored at `at` holds (last kept frame with raw index <= at, else the first). */
function pauseSlot(kept: number[], at: number): number {
  let lo = 0
  let hi = kept.length - 1
  let r = 0
  while (lo <= hi) {
    const m = (lo + hi) >> 1
    if (kept[m] <= at) {
      r = m
      lo = m + 1
    } else hi = m - 1
  }
  return r
}

/** Moving time of the kept frames at speed 1 (seconds). */
function bodyAtUnitSpeed(kept: number[], segs: TlSegment[]): number {
  let b = 0
  for (const f of kept) b += 1 / (BASE_FPS * segmentSpeedAt(segs, f))
  return b
}

function pauseTotal(kept: number[], e: TlEdit): number {
  return kept.length ? e.pauses.reduce((a, p) => a + p.seconds, 0) : 0
}

/** Global speed that makes the whole video `target` seconds long (pauses and finale hold count toward the total). */
export function solveFitSpeed(kept: number[], e: TlEdit, target: number): { speed: number; ok: boolean } {
  const unit = bodyAtUnitSpeed(kept, e.segments)
  const fixed = pauseTotal(kept, e) + (kept.length ? e.finale.holdSeconds : 0)
  const room = target - fixed
  if (unit <= 0) return { speed: 1, ok: true }
  if (room <= unit / SPEED_MAX) return { speed: SPEED_MAX, ok: false }
  // no lower bound beyond sanity: a fit may stretch a tiny recording over a long video
  return { speed: Math.max(1e-6, unit / room), ok: true }
}

/**
 * The ONE mapping used by preview and export. `kept` = source indices of the shown frames, ascending.
 */
export function buildSchedule(kept: number[], e: TlEdit): Schedule {
  const n = kept.length
  if (!n) return { items: [], total: 0, speed: e.globalSpeed, body: 0, pauses: 0, hold: 0, fitOk: true }
  let speed = clamp(e.globalSpeed, SPEED_MIN, SPEED_MAX)
  let fitOk = true
  if (e.fitDuration !== null) {
    const s = solveFitSpeed(kept, e, e.fitDuration)
    speed = s.speed
    fitOk = s.ok
  }
  const pauseAt = new Array<number>(n).fill(0)
  let pauses = 0
  for (const p of e.pauses) {
    pauseAt[pauseSlot(kept, p.at)] += p.seconds
    pauses += p.seconds
  }
  const items: ScheduleItem[] = new Array(n)
  let time = 0
  let body = 0
  for (let i = 0; i < n; i++) {
    const move = 1 / (BASE_FPS * speed * segmentSpeedAt(e.segments, kept[i]))
    body += move
    const hold = i === n - 1 ? e.finale.holdSeconds : 0
    const dur = move + pauseAt[i] + hold
    items[i] = { frameIndex: kept[i], startTime: time, duration: dur, pause: pauseAt[i] }
    time += dur
  }
  return { items, total: time, speed, body, pauses, hold: e.finale.holdSeconds, fitOk }
}

/** Index of the schedule item showing at `time` (clamped to the first / last item). */
export function itemAt(s: Schedule, time: number): number {
  const it = s.items
  if (!it.length) return -1
  if (time <= 0) return 0
  let lo = 0
  let hi = it.length - 1
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1
    if (it[m].startTime <= time) lo = m
    else hi = m - 1
  }
  return lo
}

/** Output time at which source frame `raw` starts (frames hidden by the edit map to the next shown one). */
export function timeOfSource(s: Schedule, raw: number): number {
  const it = s.items
  if (!it.length) return 0
  let lo = 0
  let hi = it.length - 1
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (it[m].frameIndex >= raw) hi = m
    else lo = m + 1
  }
  return it[lo].startTime
}

export interface OutputPlan {
  /** source frame per run (distinct consecutive frames) */
  indices: number[]
  /** how many output frames each run lasts */
  repeats: number[]
  frames: number
  fps: number
  duration: number
}

/**
 * Constant-frame-rate rendering of a schedule: output frame k shows the item active at time k / fps; the very last
 * output frame always shows the last item (the finished artwork never gets skipped at extreme speeds). Run-length
 * encoded so long holds cost nothing to describe.
 */
export function outputPlan(s: Schedule, fps: number): OutputPlan {
  fps = Math.max(1, Math.round(fps))
  const frames = s.items.length ? Math.max(1, Math.round(s.total * fps)) : 0
  const indices: number[] = []
  const repeats: number[] = []
  let cur = 0
  const last = s.items.length - 1
  for (let k = 0; k < frames; k++) {
    let idx: number
    if (k === frames - 1) idx = last
    else {
      const t = k / fps
      while (cur < last && s.items[cur + 1].startTime <= t) cur++
      idx = cur
    }
    const src = s.items[idx].frameIndex
    if (indices.length && indices[indices.length - 1] === src) repeats[repeats.length - 1]++
    else {
      indices.push(src)
      repeats.push(1)
    }
  }
  return { indices, repeats, frames, fps, duration: frames / fps }
}

/** Black-fade opacity (0 = picture, 1 = black) at `time`. */
export function fadeAlpha(time: number, total: number, fadeIn: number, fadeOut: number): number {
  let a = 0
  if (fadeIn > 0 && time < fadeIn) a = Math.max(a, 1 - time / fadeIn)
  if (fadeOut > 0 && time > total - fadeOut) a = Math.max(a, (time - (total - fadeOut)) / fadeOut)
  return clamp(a, 0, 1)
}

// ------------------------------------------------------------------ small helpers shared with the UI
/** Logarithmic slider position (0..1) <-> speed in [0.1, 100]. */
export const speedToSlider = (v: number): number => clamp((Math.log10(clamp(v, 0.1, 100)) + 1) / 3, 0, 1)
export const sliderToSpeed = (p: number): number => {
  const v = Math.pow(10, clamp(p, 0, 1) * 3 - 1)
  return Math.round(v * (v < 1 ? 100 : v < 10 ? 20 : 2)) / (v < 1 ? 100 : v < 10 ? 20 : 2)
}

/** "45", "45.5", "1:30", "1:02:03" (also with a comma) -> seconds; null when unparseable. */
export function parseDuration(text: string): number | null {
  const s = text.trim().replace(',', '.')
  if (!s) return null
  const parts = s.split(':')
  if (parts.length > 3) return null
  let total = 0
  for (const p of parts) {
    if (!/^\d+(\.\d+)?$/.test(p.trim())) return null
    total = total * 60 + Number(p)
  }
  return total
}

/** Seconds as m:ss.s / h:mm:ss (UI clock, language independent). */
export function formatClock(sec: number, decimals = 1): string {
  const k = Math.pow(10, decimals)
  sec = Math.round(Math.max(0, sec) * k) / k
  const h =Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec - h * 3600 - m * 60
  const ss = s.toFixed(decimals).padStart(decimals ? 3 + decimals : 2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}
