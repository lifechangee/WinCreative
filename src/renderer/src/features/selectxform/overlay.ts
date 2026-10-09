import type { App } from '../../app/app'
import { docToScreen } from '../../core/viewTransform'
import { FS_VERT } from '../../gl/gpu'
import type { Pt } from './geom'

export type Painter = (ctx: CanvasRenderingContext2D, toScreen: (p: Pt) => Pt) => void

/** 2D canvas stacked over the GL canvas (handles, lasso, guides). Pointer-transparent. */
export class Overlay {
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private painters = new Set<Painter>()
  private raf = 0

  constructor(private app: App) {
    this.canvas = document.createElement('canvas')
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2'
    const stage = app.canvas.parentElement!
    stage.append(this.canvas)
    this.ctx = this.canvas.getContext('2d')!
    app.events.on('resize', () => this.invalidate())
    app.events.on('view', () => this.invalidate())
  }

  add(p: Painter): () => void {
    this.painters.add(p)
    this.invalidate()
    return () => {
      this.painters.delete(p)
      this.invalidate()
    }
  }

  toScreen = (p: Pt): Pt => {
    const { w, h } = this.app.cssSize()
    return docToScreen(this.app.view, p.x, p.y, w, h)
  }

  invalidate(): void {
    if (!this.raf) this.raf = requestAnimationFrame(() => ((this.raf = 0), this.paint()))
  }

  private paint(): void {
    const { w, h } = this.app.cssSize()
    const dpr = window.devicePixelRatio || 1
    const cw = Math.round(w * dpr)
    const ch = Math.round(h * dpr)
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw
      this.canvas.height = ch
    }
    const c = this.ctx
    c.setTransform(dpr, 0, 0, dpr, 0, 0)
    c.clearRect(0, 0, w, h)
    for (const p of this.painters) {
      c.save()
      try {
        p(c, this.toScreen)
      } catch (e) {
        console.error('[overlay]', e)
      }
      c.restore()
    }
  }
}

// ---------------------------------------------------------------- marching ants + mask tint (GL, after present)
const ANTS_FS = `#version 300 es
precision highp float;
uniform sampler2D uMask;
uniform vec2 uDoc;
uniform vec2 uCenter;
uniform vec2 uHalf;
uniform float uZoom;
uniform vec2 uRot;
uniform float uMirror;
uniform float uH;
uniform float uTime;
uniform float uTint;
uniform float uInf;   // 1: infinite canvas, the tint continues outside the mask window
out vec4 o;
void main(){
  vec2 d = vec2((gl_FragCoord.x - uHalf.x) * uMirror, (uH - gl_FragCoord.y) - uHalf.y);
  vec2 p = uCenter + vec2(uRot.x * d.x + uRot.y * d.y, -uRot.y * d.x + uRot.x * d.y) / uZoom;
  bool inside = !(p.x < 0.0 || p.y < 0.0 || p.x >= uDoc.x || p.y >= uDoc.y);
  if (!inside && uInf < 0.5) { o = vec4(0.0); return; }
  float m = inside ? texture(uMask, p / uDoc).r : 0.0;
  float g = length(vec2(dFdx(m), dFdy(m)));
  float dist = abs(m - 0.5) / max(g, 1e-5);
  float edge = 1.0 - smoothstep(0.5, 1.5, dist);
  float stripe = step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) / 12.0));
  float ta = (1.0 - m) * uTint * (0.55 + 0.45 * stripe);
  vec3 tint = vec3(0.16, 0.33, 0.85);
  vec4 base = vec4(tint * ta, ta);
  float ant = step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) * 0.09 - uTime));
  vec3 ac = vec3(ant);
  o = vec4(ac * edge, edge) + base * (1.0 - edge);
}`

/** Wrap Compositor.present so marching ants + the outside tint are drawn on top of the canvas. */
export function installAnts(app: App, hidden: () => boolean): void {
  const comp = app.compositor
  const orig = comp.present.bind(comp)
  const gpu = app.gpu
  const gl = gpu.gl
  comp.present = (view, cssW, cssH, dpr) => {
    orig(view, cssW, cssH, dpr)
    const svc = app.selection
    const tex = svc.mask
    if (!tex || hidden()) return
    const W = gpu.canvas.width
    const H = gpu.canvas.height
    const p = gpu.program('sx:ants', FS_VERT, ANTS_FS).use()
    gpu.bindTarget(null, null)
    gl.viewport(0, 0, W, H)
    gpu.bindTex(0, tex)
    const inf = app.doc.isInfinite
    const wn = inf ? svc.window : null
    p.i('uMask', 0)
      .f('uInf', inf ? 1 : 0)
      .v2('uDoc', wn ? wn.w : app.doc.width, wn ? wn.h : app.doc.height)
      .v2('uCenter', view.cx - (wn ? wn.x : 0), view.cy - (wn ? wn.y : 0))
      .v2('uHalf', W / 2, H / 2)
      .f('uZoom', view.zoom * (W / cssW))
      .v2('uRot', Math.cos(view.rot), Math.sin(view.rot))
      .f('uMirror', view.mirror ? -1 : 1)
      .f('uH', H)
      .f('uTime', (performance.now() / 1000) * 1.2)
      .f('uTint', svc.maskVisibility)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gpu.fullscreen()
    gl.disable(gl.BLEND)
  }
  // keep the ants marching
  window.setInterval(() => {
    if (app.selection.hasSelection() && !hidden()) app.requestRender()
  }, 70)
}
