import type { Document } from '../../doc/document'
import { animioApi, onProgress } from './api'
import { VideoRes, videoSize } from './schedule'
import type { TimelapseRecorder } from './timelapse'
import { computeKeep, KeepResult } from './tlHistory'
import { OutputPlan, Schedule, TlEdit, buildSchedule, outputPlan } from './tlModel'

export type TlFormat = 'h264' | 'hevc' | 'vp9' | 'gif'
export type TlQualityPreset = 'high' | 'standard' | 'small'

export interface TlExportParams {
  format: TlFormat
  res: VideoRes
  fps: number
  quality: TlQualityPreset
}

export const FORMAT_EXT: Record<TlFormat, string> = { h264: 'mp4', hevc: 'mp4', vp9: 'webm', gif: 'gif' }

/** CRF per codec and quality preset (lower = better). */
export const CRF: Record<Exclude<TlFormat, 'gif'>, Record<TlQualityPreset, number>> = {
  h264: { high: 16, standard: 20, small: 26 },
  hevc: { high: 20, standard: 24, small: 30 },
  vp9: { high: 26, standard: 32, small: 40 }
}

/** The kept frames + schedule of a recording under an edit (what preview and export both play). */
export interface Resolved {
  kept: number[]
  keep: KeepResult
  schedule: Schedule
  n: number
}
export function resolveEdit(tags: { s?: number; t?: string }[], parents: number[], edit: TlEdit): Resolved {
  const keep = computeKeep(tags, parents)
  const n = tags.length
  const useKeep = edit.hideUndone && keep.supported
  let kept: number[] = []
  for (let i = 0; i < n; i++) if (!useKeep || keep.keep[i]) kept.push(i)
  if (!kept.length && n) kept = [n - 1]
  return { kept, keep, schedule: buildSchedule(kept, edit), n }
}

export async function resolveRecorder(rec: TimelapseRecorder, edit: TlEdit = rec.edit): Promise<Resolved> {
  const tags = await rec.tags()
  return resolveEdit(tags, rec.tracker.parents, edit)
}

export interface ExportResult {
  ok: boolean
  error?: string
  cancelled?: boolean
  size: number
  plan: OutputPlan
  width: number
  height: number
}

/** Render the edited time-lapse to a file through ffmpeg: constant frame rate, frames repeated per the schedule. */
export async function exportTimelapse(rec: TimelapseRecorder, doc: Document, resolved: Resolved, p: TlExportParams, out: string, progress?: (f: number) => void): Promise<ExportResult> {
  const plan = outputPlan(resolved.schedule, p.fps)
  const sz = videoSize(doc.width, doc.height, p.res)
  const fin = rec.edit.finale
  const off = progress ? onProgress((e) => e.job === 'tl' && progress(e.done / Math.max(1, e.total))) : null
  try {
    const res = await animioApi().tl.export({
      id: rec.id,
      indices: plan.indices,
      repeats: plan.repeats,
      fps: p.fps,
      width: sz.width,
      height: sz.height,
      out,
      codec: p.format,
      crf: p.format === 'gif' ? undefined : CRF[p.format][p.quality],
      fadeIn: fin.fadeIn,
      fadeOut: fin.fadeOut
    })
    return { ...res, plan, width: sz.width, height: sz.height }
  } finally {
    off?.()
  }
}
