import { unionRect } from '../../core/geometry'
import type { Rect, Sample } from '../../core/types'
import { t } from '../../i18n'
import { PaintTool } from '../../tools/paintTool'
import type { ToolHost } from '../../tools/tool'
import { MaskEngine, TileSnap } from './maskBrush'
import type { AdjDef, ParamDef, PencilTool, ToolCtx } from './types'

const tog = (key: string, label: string): ParamDef => ({ key, label, min: 0, max: 1, def: 1, kind: 'toggle' })

export const cloneDef: AdjDef = {
  id: 'clone',
  name: 'Clone',
  params: [tog('aligned', 'Aligned (source follows)')],
  custom: 'clone',
  modes: ['pencil'],
  noDrag: true,
  render(fx, src, dst, _p, x) {
    const s = x.cloneAcc ?? src
    fx.gpu.blit(s, { x: 0, y: 0, w: s.w, h: s.h }, dst, 0, 0)
  }
}

/**
 * Clone: paints an offset copy of the layer with any brush. The source point is set with Alt+click (or the
 * "Set source" button); with "Aligned" the offset persists between strokes, otherwise each stroke restarts at
 * the source point. The eraser tool restores the original pixels.
 */
export class CloneTool implements PencilTool {
  readonly engine: MaskEngine
  private acc
  private paint = new PaintTool('adj-clone', 'paint')
  private erase = new PaintTool('adj-clone-e', 'erase')
  private cur: PaintTool | null = null
  private host: ToolHost
  private snaps: TileSnap[] = []
  private all: Rect | null = null
  source: { x: number; y: number } | null = null
  private offset: [number, number] | null = null
  private erasing = false

  constructor(private c: ToolCtx) {
    const gpu = c.app.gpu
    const W = c.orig.w
    const H = c.orig.h
    this.acc = c.extra.cloneAcc ?? gpu.surface(W, H, c.orig.fmt)
    c.extra.cloneAcc = this.acc
    gpu.blit(c.orig, { x: 0, y: 0, w: W, h: H }, this.acc, 0, 0)
    this.engine = new MaskEngine(gpu, c.fx, W, H)
    this.engine.onDirty = (r) => this.live(r)
    this.engine.onEnd = (r) => this.bake(r)
    this.host = {
      doc: { activeLayer: c.layer, writableActive: () => c.layer, emitCommit: () => {} },
      engine: this.engine,
      state: c.app.state,
      requestRender: () => c.app.requestRender(),
      notify: (m: string) => c.app.notify(m)
    } as unknown as ToolHost
  }

  setSource(x: number, y: number): void {
    this.source = { x, y }
    this.offset = null
    this.c.sourceMarker(x, y, true)
  }
  resetSource(): void {
    this.source = null
    this.offset = null
    this.c.sourceMarker(0, 0, false)
  }

  brushSize(): number {
    return this.c.app.state.settings.size
  }
  dirty(): boolean {
    return this.all !== null
  }
  bounds(): Rect | null {
    return this.all
  }

  private live(r: Rect): void {
    const off = this.offset ?? [0, 0]
    this.c.fx.pass(
      'cloneLive',
      `uniform vec2 uOff; uniform float uErase;
       vec4 fx(){ vec4 base = texture(uT0, vUv); float m = texture(uT1, vUv).a;
         if (uErase > 0.5) return mix(base, texture(uT2, vUv), m);
         vec4 s = texture(uT0, vUv + uOff / uCanvas); return s * m + base * (1.0 - s.a * m); }`,
      this.c.target,
      { tex: [this.acc, this.engine.view, this.c.orig], u: { uOff: off, uErase: this.erasing ? 1 : 0 }, rect: r }
    )
    this.c.changed(r)
  }

  private bake(r: Rect): void {
    const gpu = this.c.app.gpu
    const snap = new TileSnap(gpu, this.acc)
    snap.save(r)
    this.snaps.push(snap)
    if (this.snaps.length > 20) this.snaps.shift()?.dispose()
    gpu.blit(this.c.target, r, this.acc, r.x, r.y)
    this.all = unionRect(this.all, r)
    this.engine.wipe(r)
  }

  begin(s: Sample): boolean {
    if (!this.source) {
      this.c.app.notify(t('adjustments.clone.sourceNotSet'))
      return false
    }
    const aligned = this.c.params().aligned > 0.5
    if (!(aligned && this.offset)) this.offset = [this.source.x - s.x, this.source.y - s.y]
    this.erasing = this.c.app.state.effectiveTool === 'eraser'
    this.cur = this.erasing ? this.erase : this.paint
    if (!this.cur.begin(s, this.host)) {
      this.cur = null
      return false
    }
    this.c.sourceMarker(s.x + this.offset[0], s.y + this.offset[1], true)
    return true
  }
  move(ss: Sample[]): void {
    if (!this.cur || !ss.length || !this.offset) return
    this.cur.move(ss, this.host)
    const l = ss[ss.length - 1]
    this.c.sourceMarker(l.x + this.offset[0], l.y + this.offset[1], true)
  }
  end(): boolean {
    const before = this.engine.strokes
    this.cur?.end(this.host)
    this.cur = null
    return this.engine.strokes > before
  }
  cancel(): void {
    this.cur?.cancel(this.host)
    this.cur = null
  }

  private syncLayer(r: Rect): void {
    this.c.app.gpu.blit(this.acc, r, this.c.target, r.x, r.y)
    this.c.changed(r)
  }

  undo(): boolean {
    const s = this.snaps.pop()
    if (!s) return false
    const r = s.restore()
    s.dispose()
    if (r) this.syncLayer(r)
    this.all = this.snaps.length ? { x: 0, y: 0, w: this.acc.w, h: this.acc.h } : null
    return true
  }

  reset(): void {
    if (!this.all) return
    const full = { x: 0, y: 0, w: this.acc.w, h: this.acc.h }
    const snap = new TileSnap(this.c.app.gpu, this.acc)
    snap.save(this.all)
    this.snaps.push(snap)
    this.c.app.gpu.blit(this.c.orig, full, this.acc, 0, 0)
    this.all = null
    this.syncLayer(full)
  }

  dispose(): void {
    this.cancel()
    this.snaps.forEach((s) => s.dispose())
    this.snaps = []
    this.engine.dispose()
    this.acc.dispose()
    this.c.extra.cloneAcc = null
    this.c.sourceMarker(0, 0, false)
  }
}
