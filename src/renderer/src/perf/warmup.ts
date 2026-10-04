import type { App } from '../app/app'
import { getBrushPreset } from '../brush/presets'
import { StrokePipeline } from '../core/pipeline'
import { makePressureCurve } from '../core/pressure'
import type { Sample } from '../core/types'
import { Document } from '../doc/document'
import { BrushEngine, PaintMode } from '../gl/brushEngine'
import type { PixFormat } from '../gl/gpu'
import { predictionOverlay } from '../input/prediction'

/**
 * First-use hitch removal. The first stroke of each brush family compiled/linked its D3D pixel shaders lazily (ANGLE
 * finalises programs at the first draw with a given blend state / render-target format), uploaded tip textures and ran
 * cold JS: a 33-50 ms frame the moment the artist first touched the canvas (or switched to a wet-mix / dual / blend
 * brush). This runs tiny throw-away strokes through the REAL pipeline (StrokePipeline -> BrushEngine) on a 96 px
 * scratch document, one per idle slot, so those costs are paid at start-up instead.
 */
const PRESETS: [string, PaintMode][] = [
  ['hard-round', 'paint'],
  ['soft-airbrush', 'paint'],
  ['pencil-6b', 'paint'],
  ['ink-pen', 'paint'],
  ['paint-oil', 'paint'],
  ['abs-dual', 'paint'],
  ['draw-marker', 'paint'],
  ['lum-glow', 'paint'],
  ['smudge-soft', 'smudge'],
  ['eraser-hard', 'erase']
]
const FORMATS: PixFormat[] = ['rgba8', 'rgba16f']

export const warmupStats = { done: 0, total: 0, ms: 0 }

function warmOne(app: App, doc: Document, engine: BrushEngine, id: string, mode: PaintMode): void {
  const preset = getBrushPreset(id)
  if (!preset) return
  const layer = doc.activeLayer
  engine.begin(layer, { mode, preset, color: [0.8, 0.3, 0.2], opacity: 1 })
  const pipe = new StrokePipeline(
    {
      preset,
      size: 22,
      mode,
      color: [0.8, 0.3, 0.2],
      secondary: [1, 1, 1],
      curve: makePressureCurve(app.state.pressureCurve),
      smoothing: { amount: 0.3, mode: 'exp', lazyRadius: 24 },
      seed: 7
    },
    { stamp: (dabs, target) => engine.stamp(dabs, target), restart: () => {} }
  )
  for (let i = 0; i < 24; i++) {
    const t = i / 23
    const s: Sample = { x: 16 + t * 64, y: 48 + Math.sin(t * 6) * 16, pressure: 0.2 + 0.7 * Math.sin(t * Math.PI), tiltX: 10, tiltY: 5, twist: 0, t: i * 8, pointerType: 'pen' }
    pipe.push(s)
  }
  pipe.finish()
  if (pipe.needsRestamp) {
    engine.restart()
    pipe.restamp()
  }
  engine.end()
}

/** Schedule the warm-up in small slices (one brush x format per slice). Safe to call once after App construction. */
export function scheduleWarmup(app: App, startDelay = 700, gap = 90): void {
  const jobs: { id: string; mode: PaintMode; fmt: PixFormat }[] = []
  for (const fmt of FORMATS) for (const [id, mode] of PRESETS) jobs.push({ id, mode, fmt })
  warmupStats.total = jobs.length
  const docs = new Map<PixFormat, { doc: Document; engine: BrushEngine }>()
  let i = 0
  setTimeout(() => predictionOverlay.warm(), startDelay - 200)
  const step = (): void => {
    const j = jobs[i++]
    if (!j) {
      for (const { doc, engine } of docs.values()) {
        engine.dispose()
        doc.dispose()
      }
      docs.clear()
      // the compositor's live-stroke variants etc. were compiled by real frames already
      return
    }
    // never compete with the artist: skip the slice while a stroke is being drawn
    if (app.engine.active || app.input.drawing) {
      i--
      setTimeout(step, 400)
      return
    }
    const t0 = performance.now()
    try {
      let d = docs.get(j.fmt)
      if (!d) {
        const doc = Document.create(app.gpu, 96, 96, { format: j.fmt })
        d = { doc, engine: new BrushEngine(app.gpu, doc) }
        docs.set(j.fmt, d)
      }
      warmOne(app, d.doc, d.engine, j.id, j.mode)
    } catch (e) {
      console.warn('[warmup] skipped', j.id, j.fmt, e)
    }
    warmupStats.done++
    warmupStats.ms += performance.now() - t0
    setTimeout(step, gap)
  }
  setTimeout(step, startDelay)
}
