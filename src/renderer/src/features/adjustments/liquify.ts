import { clampToCanvas, unionRect } from '../../core/geometry'
import type { Rect, Sample } from '../../core/types'
import type { Surface } from '../../gl/gpu'
import { TileSnap } from './maskBrush'
import type { AdjDef, ParamDef, PencilTool, ToolCtx } from './types'

export const LIQUIFY_TOOLS = ['Push', 'Twirl Right', 'Twirl Left', 'Pinch', 'Expand', 'Crystals', 'Edge', 'Reconstruct']

const pct = (key: string, label: string, def: number): ParamDef => ({ key, label, min: 0, max: 100, def, unit: '%' })

/** Brush radius in doc px for the Size slider. */
export const liquifyRadius = (size: number, maxDim: number): number => 8 + Math.pow(size / 100, 2) * 0.4 * maxDim

const selectParam = (key: string, label: string, options: string[]): ParamDef => ({ key, label, min: 0, max: options.length - 1, def: 0, kind: 'select', options })
const toolParam = selectParam('tool', 'Tool', LIQUIFY_TOOLS)

export const liquifyDef: AdjDef = {
  id: 'liquify',
  name: 'Liquify',
  params: [toolParam, pct('size', 'Size', 30), pct('pressure', 'Pressure', 50), pct('distortion', 'Distortion', 60), pct('momentum', 'Momentum', 30)],
  main: 'distortion',
  custom: 'liquify',
  modes: ['pencil'],
  render(fx, src, dst, _p, x) {
    if (!x.disp) return void fx.gpu.blit(src, { x: 0, y: 0, w: src.w, h: src.h }, dst, 0, 0)
    fx.pass(
      'liquifyWarp',
      `vec4 fx(){ vec2 d = texelFetch(uT1, ivec2(gl_FragCoord.xy), 0).xy; return texture(uT0, vUv + d / uCanvas); }`,
      dst,
      { tex: [src, x.disp] }
    )
  }
}

const STAMP = `uniform vec2 uC; uniform vec2 uV; uniform float uR, uMode, uK;
vec2 rot(vec2 v, float a){ float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
vec4 fx(){
  vec2 p = gl_FragCoord.xy;
  vec4 d0 = texelFetch(uT0, ivec2(p), 0);
  vec2 r = p - uC; float dist = length(r);
  if (dist >= uR) return d0;
  float t = dist / uR; float f = 1.0 - t * t * (3.0 - 2.0 * t);
  int m = int(uMode + 0.5);
  if (m == 7) return vec4(d0.xy * (1.0 - clamp(f * uK * 0.5, 0.0, 1.0)), 0.0, 1.0);
  vec2 delta = vec2(0.0);
  if (m == 0) delta = -uV * f * uK;
  else if (m == 1) delta = (uC + rot(r, -0.12 * uK * f)) - p;
  else if (m == 2) delta = (uC + rot(r, 0.12 * uK * f)) - p;
  else if (m == 3) delta = r * (0.06 * uK * f);
  else if (m == 4) delta = -r * (0.06 * uK * f);
  else if (m == 5) { vec2 cell = floor(p / max(uR * 0.28, 3.0)); delta = (hash22(cell) - 0.5) * 2.0 * uR * 0.10 * uK * f; }
  else { float ring = smoothstep(0.35, 0.85, t) * (1.0 - smoothstep(0.85, 1.0, t)); delta = -normalize(r + 1e-4) * ring * uK * uR * 0.05; }
  vec2 dd = texture(uT0, (p + delta) / uSize).xy;
  return vec4(dd + delta, 0.0, 1.0);
}`

/** Pencil-mode Liquify: brush strokes edit a displacement field (RG, doc px) that warps the layer. */
export class LiquifyTool implements PencilTool {
  private disp: Surface
  private prev: Surface
  private snaps: TileSnap[] = []
  private cur: TileSnap | null = null
  private down = false
  private last: Sample | null = null
  private vel: [number, number] = [0, 0]
  private timer = 0
  private glide = 0
  private dirtyRect: Rect | null = null
  private all: Rect | null = null
  private strokeRect: Rect | null = null

  constructor(private c: ToolCtx) {
    const gpu = c.app.gpu
    this.disp = c.extra.disp ?? gpu.surface(c.orig.w, c.orig.h, 'rgba16f')
    c.extra.disp = this.disp
    this.prev = gpu.surface(c.orig.w, c.orig.h, 'rgba16f')
  }

  brushSize(): number {
    return liquifyRadius(this.c.params().size, this.c.fx.maxDim) * 2
  }
  dirty(): boolean {
    return this.all !== null
  }
  bounds(): Rect | null {
    return this.all
  }

  private stamp(x: number, y: number, vx: number, vy: number, pressure: number): void {
    const p = this.c.params()
    const R = liquifyRadius(p.size, this.c.fx.maxDim)
    const rect = clampToCanvas({ x: x - R - 2, y: y - R - 2, w: 2 * R + 4, h: 2 * R + 4 }, this.disp.w, this.disp.h)
    if (!rect || !this.cur) return
    this.cur.save(rect)
    const gpu = this.c.app.gpu
    gpu.blit(this.disp, rect, this.prev, rect.x, rect.y)
    const K = (p.distortion / 100) * (1 - (p.pressure / 100) * (1 - Math.min(1, Math.max(0.05, pressure))))
    this.c.fx.pass('liquifyStamp', STAMP, this.disp, { tex: [this.prev], u: { uC: [x, y], uV: [vx, vy], uR: R, uMode: p.tool, uK: K }, rect })
    this.dirtyRect = unionRect(this.dirtyRect, rect)
    this.strokeRect = unionRect(this.strokeRect, rect)
  }

  private flush(): void {
    if (this.dirtyRect) {
      this.c.invalidate(this.dirtyRect)
      this.dirtyRect = null
    }
  }

  private continuous(): boolean {
    const t = this.c.params().tool
    return t !== 0
  }

  begin(s: Sample): boolean {
    this.cur = new TileSnap(this.c.app.gpu, this.disp)
    this.strokeRect = null
    this.down = true
    this.last = s
    this.vel = [0, 0]
    this.stopGlide()
    this.stamp(s.x, s.y, 0, 0, s.pressure)
    this.flush()
    if (this.continuous()) {
      this.timer = window.setInterval(() => {
        if (this.down && this.last) {
          this.stamp(this.last.x, this.last.y, 0, 0, this.last.pressure)
          this.flush()
        }
      }, 33)
    }
    return true
  }

  move(ss: Sample[]): void {
    if (!this.down || !this.last) return
    const p = this.c.params()
    const R = liquifyRadius(p.size, this.c.fx.maxDim)
    const spacing = Math.max(1.5, R * 0.1)
    for (const s of ss) {
      const l = this.last
      const dx = s.x - l.x
      const dy = s.y - l.y
      const len = Math.hypot(dx, dy)
      if (len < 0.5) continue
      const n = Math.max(1, Math.ceil(len / spacing))
      const sx = dx / n
      const sy = dy / n
      const mom = (p.momentum / 100) * 0.85
      for (let i = 1; i <= n; i++) {
        this.vel[0] += (sx - this.vel[0]) * (1 - mom)
        this.vel[1] += (sy - this.vel[1]) * (1 - mom)
        const pr = l.pressure + ((s.pressure - l.pressure) * i) / n
        if (p.tool === 0) this.stamp(l.x + sx * i, l.y + sy * i, this.vel[0], this.vel[1], pr)
        else if (p.tool === 7 && i % 2 === 0) this.stamp(l.x + sx * i, l.y + sy * i, 0, 0, pr)
      }
      this.last = s
    }
    this.flush()
  }

  private stopGlide(): void {
    if (this.glide) window.clearInterval(this.glide)
    this.glide = 0
  }

  end(): boolean {
    if (!this.down) return false
    this.down = false
    window.clearInterval(this.timer)
    this.timer = 0
    const p = this.c.params()
    const finishStroke = (): void => {
      if (this.cur && !this.cur.empty) {
        this.snaps.push(this.cur)
        if (this.snaps.length > 30) this.snaps.shift()?.dispose()
        this.all = unionRect(this.all, this.strokeRect)
      } else this.cur?.dispose()
      this.cur = null
    }
    // momentum: keep gliding along the last velocity for a moment
    const mom = p.momentum / 100
    if (p.tool === 0 && mom > 0.05 && this.last && Math.hypot(this.vel[0], this.vel[1]) > 0.4) {
      let ticks = 0
      let x = this.last.x
      let y = this.last.y
      const pr = this.last.pressure
      this.glide = window.setInterval(() => {
        this.vel[0] *= 0.6 + 0.3 * mom
        this.vel[1] *= 0.6 + 0.3 * mom
        x += this.vel[0]
        y += this.vel[1]
        this.stamp(x, y, this.vel[0], this.vel[1], pr)
        this.flush()
        if (++ticks > 30 || Math.hypot(this.vel[0], this.vel[1]) < 0.3) {
          this.stopGlide()
          finishStroke()
        }
      }, 33)
    } else finishStroke()
    this.last = null
    return this.strokeRect !== null
  }

  cancel(): void {
    this.down = false
    window.clearInterval(this.timer)
    this.stopGlide()
    if (this.cur) {
      const r = this.cur.restore()
      this.cur.dispose()
      this.cur = null
      if (r) this.c.invalidate(r)
    }
  }

  undo(): boolean {
    this.stopGlide()
    if (this.cur) {
      // finish an in-flight glide first
      this.snaps.push(this.cur)
      this.cur = null
    }
    const s = this.snaps.pop()
    if (!s) return false
    const r = s.restore()
    s.dispose()
    if (r) this.c.invalidate(r)
    this.all = this.snaps.length ? { x: 0, y: 0, w: this.disp.w, h: this.disp.h } : null
    return true
  }

  reset(): void {
    this.stopGlide()
    const full = { x: 0, y: 0, w: this.disp.w, h: this.disp.h }
    const snap = new TileSnap(this.c.app.gpu, this.disp)
    snap.save(this.all ?? full)
    this.snaps.push(snap)
    this.c.app.gpu.clear(this.disp)
    this.all = null
    this.c.invalidate(full)
  }

  dispose(): void {
    this.cancel()
    this.snaps.forEach((s) => s.dispose())
    this.snaps = []
    this.disp.dispose()
    this.prev.dispose()
    this.c.extra.disp = null
  }
}
