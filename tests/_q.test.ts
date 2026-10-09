import { it } from 'vitest'
import { iou } from '../src/renderer/src/features/smartselect/imgops'
import { brushSegment, rasterizeSeeds } from '../src/renderer/src/features/smartselect/brushSeg'
import { makeScene } from '../src/renderer/src/features/smartselect/synth'
it('q', () => {
  for (const k of ['clean','textured','lowContrast','hair'] as const) {
    const s = makeScene(k, 640, 480)
    const st = [{ pts: [{x:s.cx-60,y:s.cy},{x:s.cx+60,y:s.cy+10},{x:s.cx,y:s.cy-40}], radii:[8,8,8], label:1 as const }]
    const t0=performance.now()
    const seeds = rasterizeSeeds(st, s.w, s.h)
    const f = brushSegment(s.rgba, seeds, s.w, s.h, {})
    console.log(k, 'iou', iou(f.map(v=>v>0?1:0), s.gt).toFixed(4), 'ms', (performance.now()-t0).toFixed(0))
  }
}, 60000)
