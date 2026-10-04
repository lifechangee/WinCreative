/** Pure scheduling / math helpers for animation playback, onion skins, and time-lapse export (unit-tested). */
import { I18nRef, t, tk } from '../../i18n'

export type PlayMode = 'loop' | 'pingpong' | 'oneshot'

export interface FrameStep {
  /** index into the frame list */
  frame: number
  /** how many timeline ticks (1/fps s) this step lasts */
  ticks: number
}

/**
 * The sequence of frames for ONE cycle of playback.
 * loop/oneshot: 0..n-1. pingpong: 0..n-1 then n-2..1 (end frames are not shown twice).
 * `holds[i]` = ticks frame i is held (>=1).
 */
export function playbackSequence(holds: number[], mode: PlayMode): FrameStep[] {
  const n = holds.length
  const h = (i: number): number => Math.max(1, Math.round(holds[i] || 1))
  const out: FrameStep[] = []
  for (let i = 0; i < n; i++) out.push({ frame: i, ticks: h(i) })
  if (mode === 'pingpong') for (let i = n - 2; i >= 1; i--) out.push({ frame: i, ticks: h(i) })
  return out
}

export function sequenceTicks(seq: FrameStep[]): number {
  return seq.reduce((a, s) => a + s.ticks, 0)
}

/** Which step is showing at time `tick` (in ticks since start). Loops unless `once`. Returns null when a one-shot finished. */
export function stepAtTick(seq: FrameStep[], tick: number, once: boolean): { step: number; done: boolean } {
  const total = sequenceTicks(seq)
  if (!total) return { step: 0, done: true }
  if (once && tick >= total) return { step: seq.length - 1, done: true }
  let t = ((tick % total) + total) % total
  for (let i = 0; i < seq.length; i++) {
    if (t < seq[i].ticks) return { step: i, done: false }
    t -= seq[i].ticks
  }
  return { step: seq.length - 1, done: false }
}

export interface OnionSpec {
  /** frame index */
  frame: number
  /** -k = k frames before, +k = after */
  offset: number
  /** 0..1 */
  opacity: number
}

/**
 * Onion-skin ghosts for `current`: up to `before` frames behind and `after` ahead, opacity fading linearly
 * with distance (nearest = `opacity`, farthest = opacity / count). Frames outside the range are skipped.
 */
export function onionFrames(current: number, nFrames: number, before: number, after: number, opacity: number): OnionSpec[] {
  const out: OnionSpec[] = []
  const add = (k: number, count: number, sign: number): void => {
    for (let d = 1; d <= k; d++) {
      const f = current + sign * d
      if (f < 0 || f >= nFrames) break
      out.push({ frame: f, offset: sign * d, opacity: opacity * (1 - (d - 1) / Math.max(1, count)) })
    }
  }
  add(before, before, -1)
  add(after, after, 1)
  return out
}

// ------------------------------------------------------------------ time-lapse

/** Evenly pick `target` indices from 0..total-1, always including first and last. */
export function selectFrames(total: number, target: number): number[] {
  if (total <= 0) return []
  target = Math.max(1, Math.min(total, Math.floor(target)))
  if (target === total) return Array.from({ length: total }, (_, i) => i)
  if (target === 1) return [total - 1]
  const out: number[] = []
  for (let i = 0; i < target; i++) out.push(Math.round((i * (total - 1)) / (target - 1)))
  return out
}

export interface TimelapsePlan {
  indices: number[]
  repeats: number[]
  /** output frame count (sum of repeats) */
  frames: number
  /** seconds */
  duration: number
}

/**
 * Full length: every recorded frame at `fps`. 30 seconds: at most 30 s of video (frames evenly sampled).
 * The last frame is held for `endHoldSec` so the finished piece is visible.
 */
export function timelapsePlan(total: number, mode: 'full' | 'short', fps: number, endHoldSec = 1): TimelapsePlan {
  fps = Math.max(1, Math.round(fps))
  const hold = total > 0 ? Math.round(endHoldSec * fps) : 0
  const budget = mode === 'short' ? Math.max(1, 30 * fps - hold) : total
  const indices = selectFrames(total, Math.min(total, budget))
  const repeats = indices.map((_, i) => (i === indices.length - 1 ? 1 + hold : 1))
  const frames = repeats.reduce((a, b) => a + b, 0)
  return { indices, repeats, frames, duration: frames / fps }
}

export type VideoRes = '1080p' | '2k' | '4k' | 'canvas'
export const RES_BOX: Record<Exclude<VideoRes, 'canvas'>, [number, number]> = { '1080p': [1920, 1080], '2k': [2560, 1440], '4k': [3840, 2160] }

const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2)

/** Output size for a canvas of w x h: fits inside the resolution box preserving aspect, even dimensions (H.264 needs them). */
export function videoSize(w: number, h: number, res: VideoRes): { width: number; height: number } {
  if (res === 'canvas') return { width: even(w), height: even(h) }
  const [bw, bh] = RES_BOX[res]
  const k = Math.min(bw / w, bh / h)
  return { width: even(w * k), height: even(h * k) }
}

/** Size of stored time-lapse frames for a quality setting. */
export type TlQuality = 'max' | 'hd' | 'small'
export const TL_QUALITY: Record<TlQuality, { maxSide: number; jpeg: number; label: I18nRef }> = {
  max: { maxSide: 4096, jpeg: 0.9, label: tk('animio.tl.quality.max') },
  hd: { maxSide: 1920, jpeg: 0.82, label: tk('animio.tl.quality.hd') },
  small: { maxSide: 960, jpeg: 0.72, label: tk('animio.tl.quality.small') }
}
export function tlFrameSize(w: number, h: number, q: TlQuality): { width: number; height: number } {
  const k = Math.min(1, TL_QUALITY[q].maxSide / Math.max(w, h))
  return { width: Math.max(2, Math.round(w * k)), height: Math.max(2, Math.round(h * k)) }
}

/**
 * Tracked drawing time: gaps longer than `idleMs` between operations count as idle (only `idleMs` is credited).
 */
export function trackedTime(deltasMs: number[], idleMs = 5000): number {
  return deltasMs.reduce((a, d) => a + Math.min(Math.max(0, d), idleMs), 0)
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h ? t('animio.dur.hms', { h, m, s: sec }) : m ? t('animio.dur.ms', { m, s: sec }) : t('animio.dur.s', { s: sec })
}
