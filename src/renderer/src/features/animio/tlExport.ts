import type { Document } from '../../doc/document'
import { animioApi, onProgress } from './api'
import { VideoRes, videoSize } from './schedule'
import type { TimelapseRecorder } from './timelapse'
import type { KeepResult } from './tlHistory'
import { TagFull, keptForVariant } from './tlVariants'
import { variantFileName } from '../langvariants/model'
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
export function resolveEdit(tags: readonly TagFull[], parents: number[], edit: TlEdit, variant: string | null = null): Resolved {
  const { kept, keep } = keptForVariant(tags, parents, variant, edit.hideUndone)
  return { kept, keep, schedule: buildSchedule(kept, edit), n: tags.length }
}

/** The kept frames + schedule of one language variant (null = the whole recording) with that variant's own edit model. */
export async function resolveRecorder(rec: TimelapseRecorder, which: string | TlEdit | null = rec.variantKey): Promise<Resolved> {
  const tags = await rec.tags()
  if (which !== null && typeof which === 'object') return resolveEdit(tags, rec.tracker.parents, which, rec.variantKey) // an explicit edit for the edited variant
  return resolveEdit(tags, rec.tracker.parents, rec.editFor(which), which)
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

export interface VariantExportResult {
  code: string
  file: string
  result: ExportResult
}
/**
 * Every language variant in one pass: `out` = `name.mp4` -> `name.en.mp4`, `name.ru.mp4` ... Each variant uses its own frames and edit model.
 * `progress(variantIndex, fraction, overall)` is called while encoding; stops at the first failure or cancellation.
 */
export async function exportAllVariants(rec: TimelapseRecorder, doc: Document, p: TlExportParams, out: string, progress?: (i: number, f: number, overall: number) => void): Promise<VariantExportResult[]> {
  const variants = rec.variants
  const tags = await rec.tags()
  const done: VariantExportResult[] = []
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i]
    const file = variantFileName(out, v)
    const resolved = resolveEdit(tags, rec.tracker.parents, rec.editFor(v), v)
    const result = await exportTimelapse(rec, doc, resolved, p, file, (f) => progress?.(i, f, (i + f) / variants.length), rec.editFor(v))
    done.push({ code: v, file, result })
    if (!result.ok) break
  }
  return done
}

/** Render the edited time-lapse to a file through ffmpeg: constant frame rate, frames repeated per the schedule. */
export async function exportTimelapse(rec: TimelapseRecorder, doc: Document, resolved: Resolved, p: TlExportParams, out: string, progress?: (f: number) => void, edit: TlEdit = rec.edit): Promise<ExportResult> {
  const plan = outputPlan(resolved.schedule, p.fps)
  const sz = videoSize(rec.sourceSize().w, rec.sourceSize().h, p.res)
  const fin = edit.finale
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
