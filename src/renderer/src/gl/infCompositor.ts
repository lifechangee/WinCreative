import { GUTTER, TILE, TileKey, ancestorOf, intRect, levelForZoom, levelSpan, tileKey, tileKeyX, tileKeyY, unionBounds } from '../core/tiles'
import type { Rect } from '../core/types'
import type { View } from '../core/viewTransform'
import type { Document } from '../doc/document'
import type { Layer } from '../doc/layer'
import type { LiveStroke } from './brushEngine'
import { FS_VERT, GPU, Surface } from './gpu'
import { THUMB_FS } from './layerShaders'
import type { StackRenderer } from './compositor'
import { tileMemory } from '../doc/tileMemory'

/**
 * Tile compositor of the infinite canvas.
 *
 * Level 0 = one composite per 512 px tile (all layers, blend modes, groups, clipping, live stroke - rendered by the SAME
 * StackRenderer passes as fixed documents, one tile at a time). Level k >= 1 is a pyramid: a texel is 2^k doc px, built by an exact 2x2
 * box downsample of four level k-1 tiles. The screen pass picks the level so that the residual minification is <= 2x, which makes the
 * zoomed-out view cost depend on the SCREEN size only (at most ~100 tile draws at any zoom) and shimmer-free (2x2 taps on top of
 * bilinear). Every composite texture has a GUTTER px border holding the neighbours' edge pixels, so filtering never shows seams.
 * Tiles are rebuilt lazily when a layer change dirties them (scissored to the dirty rect at level 0) and evicted LRU.
 */
const TW = TILE + 2 * GUTTER

interface Comp {
  surf: Surface
  level: number
  key: TileKey
  built: boolean
  dirty: boolean
  /** level 0: tile-local dirty rect (null = whole tile) */
  dirtyRect: Rect | null
  last: number
}

const DOWN_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uDstOrg;
out vec4 o;
void main(){
  vec2 d = floor(gl_FragCoord.xy - uDstOrg);
  o = texture(uSrc, (${GUTTER}.0 + 2.0 * d + 1.0) / ${TW}.0);
}`

const VIEW_CHUNK = `
uniform vec2 uCenter;
uniform vec2 uHalf;
uniform float uZoom;   // device px per doc px
uniform vec2 uRot;
uniform float uMirror;
uniform float uH;
vec2 docPos(){
  vec2 d = vec2((gl_FragCoord.x - uHalf.x) * uMirror, (uH - gl_FragCoord.y) - uHalf.y);
  return uCenter + vec2(uRot.x * d.x + uRot.y * d.y, -uRot.y * d.x + uRot.x * d.y) / uZoom;
}
float ditherN(){ return fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5; }
`

const BG_FS = `#version 300 es
precision highp float;
${VIEW_CHUNK}
uniform vec3 uPaper;
uniform float uPaperOn;
uniform float uGrid;
in vec2 vUv;
out vec4 o;
void main(){
  vec3 bg;
  if (uPaperOn > 0.5) bg = uPaper;
  else { vec2 cell = floor(gl_FragCoord.xy / 10.0); bg = vec3(mod(cell.x + cell.y, 2.0) < 1.0 ? 0.86 : 0.72); }
  if (uGrid > 0.5) {
    float S = 64.0;
    if (S * uZoom > 7.0) {
      vec2 f = abs(fract(docPos() / S + 0.5) - 0.5) * S * uZoom;
      float dotv = 1.0 - smoothstep(0.7, 1.7, length(f));
      float lum = dot(bg, vec3(0.3, 0.59, 0.11));
      bg = mix(bg, lum > 0.5 ? bg * 0.62 : bg + (1.0 - bg) * 0.32, dotv * clamp((S * uZoom - 7.0) / 14.0, 0.0, 1.0));
    }
  }
  o = vec4(bg + ditherN() / 255.0, 1.0);
}`

const TILE_FS = `#version 300 es
precision highp float;
${VIEW_CHUNK}
uniform sampler2D uTex;
uniform vec2 uTileOrg;
uniform float uScale;   // doc px per texel (2^level)
in vec2 vUv;
out vec4 o;
void main(){
  vec2 u = (docPos() - uTileOrg) / uScale;
  if (u.x < 0.0 || u.y < 0.0 || u.x >= ${TILE}.0 || u.y >= ${TILE}.0) discard;
  float zt = uZoom * uScale;   // device px per texel
  vec4 t;
  if (zt > 1.0) {
    vec2 c = u - 0.5;
    vec2 n = floor(c);
    vec2 f = c - n;
    vec2 g = clamp((f - 0.5) * zt + 0.5, 0.0, 1.0);
    t = texture(uTex, (${GUTTER}.0 + n + 0.5 + g) / ${TW}.0);
  } else {
    int n = int(clamp(ceil(1.0 / zt), 1.0, 3.0));
    vec4 acc = vec4(0.0);
    for (int j = 0; j < 3; j++) {
      if (j >= n) break;
      for (int i = 0; i < 3; i++) {
        if (i >= n) break;
        vec2 off = ((vec2(float(i), float(j)) + 0.5) / float(n) - 0.5) / zt;
        acc += texture(uTex, (${GUTTER}.0 + u + off) / ${TW}.0);
      }
    }
    t = acc / float(n * n);
  }
  o = vec4(t.rgb + (ditherN() / 255.0) * t.a, t.a);
}`

export interface FlatImage {
  /** straight-alpha RGBA8, row 0 = top */
  px: Uint8ClampedArray
  w: number
  h: number
  /** the document rect that was rendered (after rounding to the pyramid grid) */
  rect: Rect
}

const MAX_COMPS = 320
const L0_BUDGET = 16
const L0_MS = 5

export class InfCompositor {
  private levels: Map<TileKey, Comp>[] = []
  private l0 = new Set<TileKey>()
  private l0Sig = ''
  private sets: Set<TileKey>[] = []
  private live: LiveStroke | null = null
  private work: Surface | null = null
  private frame = 0
  private gutterQ: Comp[] = []
  /** view centre in level-0 tile units (restore priority) */
  private cx = 0
  private cy = 0
  /** count of composes refused because a source tile is evicted (restore requested) */
  private coldMiss = 0
  /** readRect / exports need exact pixels now: evicted tiles are restored synchronously */
  private blocking = false
  /** per-frame time box for level-0 composes (ms of CPU): keeps frames at 60 fps while a big unseen area fills in */
  private deadline = Infinity
  private composed = 0
  /** false: readRect skips tiles that are evicted instead of restoring them synchronously (partial but never stalls the UI) */
  readBlocking = true
  /** true: readRect gives up after ~20 ms of composes (missing parts stay empty) - for previews of huge documents */
  readPartial = false
  /** called when work is left over (budget exhausted): the app schedules another frame */
  onPending: (() => void) | null = null
  stats = { level: 0, drawn: 0, built: 0, comps: 0, pending: false }

  constructor(
    private gpu: GPU,
    private getDoc: () => Document,
    private renderer: StackRenderer,
    private getRoots: () => Layer[]
  ) {}

  private fmt(): 'rgba8' | 'rgba16f' {
    return this.getDoc().format
  }

  dispose(): void {
    for (const lv of this.levels) for (const c of lv.values()) c.surf.dispose()
    this.levels = []
    this.work?.dispose()
    this.work = null
    this.sets = []
    this.l0.clear()
    this.l0Sig = ''
  }

  // ------------------------------------------------------------------ dirty tracking
  /** A document change: `rect` (doc space) or null = everything. Cheap: only flags cached composites. */
  invalidate(live: LiveStroke | null, rect: Rect | null): void {
    this.live = live
    if (rect && (rect.w <= 0 || rect.h <= 0)) return
    for (let lvl = 0; lvl < this.levels.length; lvl++) {
      const span = levelSpan(lvl)
      for (const c of this.levels[lvl].values()) {
        const ox = tileKeyX(c.key) * span
        const oy = tileKeyY(c.key) * span
        if (rect && (rect.x >= ox + span || rect.y >= oy + span || rect.x + rect.w <= ox || rect.y + rect.h <= oy)) continue
        if (lvl === 0) {
          if (!rect || c.dirtyRect === null && c.dirty) {
            c.dirtyRect = null
          } else {
            const lx0 = Math.max(0, Math.floor(rect.x - ox))
            const ly0 = Math.max(0, Math.floor(rect.y - oy))
            const lx1 = Math.min(TILE, Math.ceil(rect.x + rect.w - ox))
            const ly1 = Math.min(TILE, Math.ceil(rect.y + rect.h - oy))
            const nr = { x: lx0, y: ly0, w: lx1 - lx0, h: ly1 - ly0 }
            c.dirtyRect = c.dirty && c.dirtyRect ? (unionBounds(c.dirtyRect, nr) as Rect) : c.dirty ? c.dirtyRect : nr
          }
        }
        c.dirty = true
      }
    }
  }

  /** Flag cached composites of `rect` (null = all) dirty WITHOUT changing the live stroke (language variants follow document changes through this). */
  touch(rect: Rect | null): void {
    this.invalidate(this.live, rect)
  }

  /** Union of all layers' tile keys (+ live stroke tiles) at level 0, refreshed when any tile set changed. */
  private syncKeys(): void {
    const doc = this.getDoc()
    let sig = ''
    for (const l of doc.layers) if (l.tiles) sig += l.tiles.version + ':' + (l.maskTiles?.version ?? 0) + (l.mask ? (l.maskFill ? 'w' : 'b') : '') + ','
    const lm = this.live?.tiles?.map.size ?? 0
    sig += '|' + lm + '|' + doc.layers.length
    if (sig === this.l0Sig && !lm) return
    // the live tiles change within a stroke, so always rebuild while one is active
    this.l0Sig = sig
    this.l0.clear()
    for (const l of doc.layers) if (l.tiles) for (const k of l.tiles.keys()) this.l0.add(k)
    if (this.live?.tiles) for (const k of this.live.tiles.map.keys()) this.l0.add(k)
    this.sets = [this.l0]
  }

  private levelSet(level: number): Set<TileKey> {
    this.syncKeys()
    let s = this.sets[level]
    if (s) return s
    s = new Set<TileKey>()
    for (const k of this.l0) {
      const a = ancestorOf(tileKeyX(k), tileKeyY(k), level)
      s.add(tileKey(a.tx, a.ty))
    }
    return (this.sets[level] = s)
  }

  /** true when any tile exists (anything to show) */
  get hasContent(): boolean {
    this.syncKeys()
    return this.l0.size > 0
  }

  // ------------------------------------------------------------------ building
  private comp(level: number, key: TileKey, create: boolean): Comp | undefined {
    const lv = (this.levels[level] ??= new Map())
    let c = lv.get(key)
    if (!c && create) {
      c = { surf: this.gpu.surface(TW, TW, this.fmt()), level, key, built: false, dirty: true, dirtyRect: null, last: this.frame }
      lv.set(key, c)
    }
    return c
  }

  /** All layer tiles of level-0 tile `key` resident? Otherwise ask TileMemory to restore them (async) and report false. */
  private sourcesReady(key: TileKey): boolean {
    if (this.blocking) return true
    let ok = true
    for (const l of this.getDoc().layers) {
      for (const st of [l.tiles, l.maskTiles]) {
        if (!st) continue
        if (st.isCold(key)) {
          tileMemory.prefetchAround(st, key, this.cx, this.cy)
          ok = false
        } else st.touch(key)
      }
    }
    return ok
  }

  private ensure(level: number, key: TileKey, budget: { l0: number }): Comp | null {
    let c = this.comp(level, key, false)
    if (c && c.built && !c.dirty) {
      c.last = this.frame
      return c
    }
    if (level === 0) {
      if (budget.l0 <= 0 || (this.composed > 0 && performance.now() > this.deadline)) {
        this.stats.pending = true
        return c?.built ? c : null
      }
      if (!this.sourcesReady(key)) {
        this.coldMiss++
        this.stats.pending = true
        return c?.built ? c : null
      }
      budget.l0--
      this.composed++
      c ??= this.comp(0, key, true)!
      this.composeL0(c)
    } else {
      c ??= this.comp(level, key, true)!
      const kx = tileKeyX(key)
      const ky = tileKeyY(key)
      const set = this.levelSet(level - 1)
      let complete = true
      this.gpu.clear(c.surf)
      for (let qy = 0; qy < 2; qy++) {
        for (let qx = 0; qx < 2; qx++) {
          const ck = tileKey(kx * 2 + qx, ky * 2 + qy)
          if (!set.has(ck)) continue
          const child = this.ensure(level - 1, ck, budget)
          if (!child) {
            complete = false
            continue
          }
          if (child.dirty) complete = false
          this.downsample(child, c, qx, qy)
        }
      }
      c.built = true
      c.dirty = !complete
      this.stats.built++
      this.gutterQ.push(c)
    }
    c.last = this.frame
    return c
  }

  private composeL0(c: Comp): void {
    const gpu = this.gpu
    const work = (this.work ??= gpu.surface(TILE, TILE, this.fmt()))
    const r = c.built && c.dirtyRect ? c.dirtyRect : null
    this.renderer.renderTile(this.getRoots(), c.key, work, this.live, r)
    const q = r ?? { x: 0, y: 0, w: TILE, h: TILE }
    gpu.blit(work, q, c.surf, GUTTER + q.x, GUTTER + q.y)
    c.built = true
    c.dirty = false
    c.dirtyRect = null
    this.stats.built++
    this.gutterQ.push(c)
  }

  private downsample(child: Comp, parent: Comp, qx: number, qy: number): void {
    const gpu = this.gpu
    const gl = gpu.gl
    const p = gpu.program('inf-down', FS_VERT, DOWN_FS).use()
    gpu.bindTex(0, child.surf.tex)
    const ox = GUTTER + qx * (TILE / 2)
    const oy = GUTTER + qy * (TILE / 2)
    p.i('uSrc', 0).v2('uDstOrg', ox, oy)
    gpu.bindTarget(parent.surf, null)
    gl.viewport(ox, oy, TILE / 2, TILE / 2)
    gl.disable(gl.BLEND)
    gpu.fullscreen()
  }

  /** Copy edge pixels between a composite and its (built) neighbours so filtering across tile borders is exact. */
  private syncGutters(c: Comp): void {
    const lv = this.levels[c.level]
    const gpu = this.gpu
    const G = GUTTER
    const kx = tileKeyX(c.key)
    const ky = tileKeyY(c.key)
    // per axis: dst start in my texture, src start in the neighbour, length
    const rng = (d: number): { dst: number; src: number; len: number } => (d < 0 ? { dst: 0, src: TILE, len: G } : d === 0 ? { dst: G, src: G, len: TILE } : { dst: G + TILE, src: G, len: G })
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const n = lv.get(tileKey(kx + dx, ky + dy))
        if (!n || !n.built) continue
        const rx = rng(dx)
        const ry = rng(dy)
        // neighbour's edge -> my gutter
        gpu.blit(n.surf, { x: rx.src, y: ry.src, w: rx.len, h: ry.len }, c.surf, rx.dst, ry.dst)
        // my edge -> neighbour's gutter (mirror direction)
        const mx = rng(-dx)
        const my = rng(-dy)
        gpu.blit(c.surf, { x: mx.src, y: my.src, w: mx.len, h: my.len }, n.surf, mx.dst, my.dst)
      }
    }
  }

  private evict(): void {
    let total = 0
    for (const lv of this.levels) total += lv.size
    this.stats.comps = total
    if (total <= MAX_COMPS) return
    const all: Comp[] = []
    // coarse composites (level >= 3) are the placeholders shown while evicted tiles stream back: kept unless they alone exceed the cap
    let sticky = 0
    for (const lv of this.levels.slice(3)) sticky += lv?.size ?? 0
    for (const lv of this.levels) for (const c of lv.values()) if (c.last < this.frame && (c.level < 3 || sticky > MAX_COMPS * 0.6)) all.push(c)
    all.sort((a, b) => a.last - b.last)
    for (let i = 0; i < all.length && total > MAX_COMPS * 0.85; i++, total--) {
      all[i].surf.dispose()
      this.levels[all[i].level].delete(all[i].key)
    }
  }

  // ------------------------------------------------------------------ screen
  /** Device-pixel AABB of a doc-space rect under `view` (for scissoring), clamped to the canvas. */
  private screenBox(view: View, W: number, H: number, sx: number, x: number, y: number, w: number, h: number): Rect | null {
    const c = Math.cos(view.rot)
    const s = Math.sin(view.rot)
    const m = view.mirror ? -1 : 1
    const Z = view.zoom * sx
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const [px, py] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
      const vx = (px - view.cx) * Z
      const vy = (py - view.cy) * Z
      const dx = c * vx - s * vy
      const dy = s * vx + c * vy
      const fx = W / 2 + dx * m
      const fy = H - (H / 2 + dy) // GL y is up
      x0 = Math.min(x0, fx)
      x1 = Math.max(x1, fx)
      y0 = Math.min(y0, fy)
      y1 = Math.max(y1, fy)
    }
    const bx0 = Math.max(0, Math.floor(x0) - 1)
    const by0 = Math.max(0, Math.floor(y0) - 1)
    const bx1 = Math.min(W, Math.ceil(x1) + 1)
    const by1 = Math.min(H, Math.ceil(y1) + 1)
    return bx1 > bx0 && by1 > by0 ? { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 } : null
  }

  /** Draw the view onto the screen canvas, or (`target`) into a surface of the same aspect (time-lapse variants: GPU downscale, no 2D canvas). */
  present(view: View, cssW: number, cssH: number, target?: Surface): void {
    const gpu = this.gpu
    const gl = gpu.gl
    const doc = this.getDoc()
    const W = target ? target.w : gpu.canvas.width
    const H = target ? target.h : gpu.canvas.height
    const sx = W / cssW
    const Z = view.zoom * sx
    this.frame++
    tileMemory.tick()
    this.cx = view.cx / TILE
    this.cy = view.cy / TILE
    this.stats.pending = false
    this.stats.built = 0
    this.gutterQ = []
    const level = levelForZoom(Z)
    this.stats.level = level
    const span = levelSpan(level)
    // visible doc rect = bounding box of the four screen corners
    const c = Math.cos(view.rot)
    const s = Math.sin(view.rot)
    const m = view.mirror ? -1 : 1
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const [fx, fy] of [[0, 0], [cssW, 0], [0, cssH], [cssW, cssH]]) {
      const dx = (fx - cssW / 2) * m
      const dy = fy - cssH / 2
      const px = view.cx + (c * dx + s * dy) / view.zoom
      const py = view.cy + (-s * dx + c * dy) / view.zoom
      x0 = Math.min(x0, px)
      x1 = Math.max(x1, px)
      y0 = Math.min(y0, py)
      y1 = Math.max(y1, py)
    }
    const set = this.levelSet(level)
    const kx0 = Math.floor(x0 / span)
    const kx1 = Math.floor(x1 / span)
    const ky0 = Math.floor(y0 / span)
    const ky1 = Math.floor(y1 / span)
    const budget = { l0: L0_BUDGET }
    this.deadline = performance.now() + L0_MS
    this.composed = 0
    const draw: Comp[] = []
    const fallback: TileKey[] = []
    if ((kx1 - kx0 + 1) * (ky1 - ky0 + 1) <= 4096) {
      for (let ky = ky0; ky <= ky1; ky++) {
        for (let kx = kx0; kx <= kx1; kx++) {
          const k = tileKey(kx, ky)
          if (!set.has(k)) continue
          const cp = this.ensure(level, k, budget)
          if (cp && cp.built) draw.push(cp)
          else fallback.push(k)
          if (level <= 1) this.touchSources(level, kx, ky)
        }
      }
    }
    for (const cp of this.gutterQ) this.syncGutters(cp)
    this.gutterQ = []

    // ---- background
    gpu.bindTarget(target ?? null, null)
    gl.viewport(0, 0, W, H)
    gl.disable(gl.BLEND)
    const setView = (p: ReturnType<GPU['program']>): void => {
      p.v2('uCenter', view.cx, view.cy).v2('uHalf', W / 2, H / 2).f('uZoom', Z).v2('uRot', c, s).f('uMirror', view.mirror ? -1 : 1).f('uH', H)
    }
    const bg = gpu.program('inf-bg', FS_VERT, BG_FS).use()
    setView(bg)
    bg.v3('uPaper', doc.background.color[0], doc.background.color[1], doc.background.color[2]).f('uPaperOn', doc.background.visible ? 1 : 0).f('uGrid', doc.infinite.grid ? 1 : 0)
    gpu.fullscreen()
    // ---- tiles
    const tp = gpu.program('inf-tile', FS_VERT, TILE_FS).use()
    setView(tp)
    tp.i('uTex', 0).f('uScale', 2 ** level)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.enable(gl.SCISSOR_TEST)
    let drawn = 0
    // placeholders: a tile whose composite is not ready yet shows the nearest coarser composite (pyramid) in its place
    for (const k of fallback) {
      let a: Comp | undefined
      for (let l = level + 1; l <= 14 && !a; l++) {
        const an = ancestorOf(tileKeyX(k), tileKeyY(k), l - level)
        const cand = this.levels[l]?.get(tileKey(an.tx, an.ty))
        if (cand?.built) a = cand
      }
      if (!a) continue
      const box = this.screenBox(view, W, H, sx, tileKeyX(k) * span, tileKeyY(k) * span, span, span)
      if (!box) continue
      const aspan = levelSpan(a.level)
      gl.scissor(box.x, box.y, box.w, box.h)
      gpu.bindTex(0, a.surf.tex)
      tp.f('uScale', 2 ** a.level).v2('uTileOrg', tileKeyX(a.key) * aspan, tileKeyY(a.key) * aspan)
      gpu.fullscreen()
    }
    tp.f('uScale', 2 ** level)
    for (const cp of draw) {
      const ox = tileKeyX(cp.key) * span
      const oy = tileKeyY(cp.key) * span
      const box = this.screenBox(view, W, H, sx, ox, oy, span, span)
      if (!box) continue
      gl.scissor(box.x, box.y, box.w, box.h)
      gpu.bindTex(0, cp.surf.tex)
      tp.v2('uTileOrg', ox, oy)
      gpu.fullscreen()
      drawn++
    }
    gl.disable(gl.SCISSOR_TEST)
    gl.disable(gl.BLEND)
    this.stats.drawn = drawn
    this.evict()
    if (this.stats.pending) this.onPending?.()
  }

  /** Keep the layer tiles under the shown composites recently used so they are not evicted while visible. */
  private touchSources(level: number, kx: number, ky: number): void {
    const n = level === 0 ? 1 : 2
    for (const l of this.getDoc().layers) {
      for (const st of [l.tiles, l.maskTiles]) {
        if (!st) continue
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) st.touch(tileKey(kx * n + i, ky * n + j))
      }
    }
  }

  // ------------------------------------------------------------------ readback
  /**
   * Render an arbitrary doc-space rect at `scale` (0 < scale <= 1) and read it back as straight RGBA8. Uses the pyramid, so a thumbnail
   * of 2000 tiles costs a few hundred small passes. The result is exactly round(rect.w*scale) x round(rect.h*scale).
   */
  readRect(rect: Rect, scale = 1, withBackground = true): FlatImage {
    this.blocking = this.readBlocking
    this.deadline = this.readPartial ? performance.now() + 20 : Infinity
    this.composed = 0
    try {
      return this.readRectNow(rect, scale, withBackground)
    } finally {
      this.blocking = false
    }
  }

  /**
   * Time-sliced pre-build of every composite `readRect(rect, scale)` will need (5 ms of composes per slice, the event loop in between), so
   * that the final readRect is cheap and a big thumbnail / export never blocks a frame. Evicted tiles are requested asynchronously.
   */
  async prewarm(rect: Rect, scale: number, nextTask: () => Promise<void>, maxMs = 8000): Promise<void> {
    const r0 = intRect(rect)
    scale = Math.min(1, Math.max(1e-4, scale))
    let k = levelForZoom(scale, 14)
    const max = this.gpu.maxTexture
    const dims = (): { x0: number; y0: number; x1: number; y1: number } => {
      const g = 2 ** k
      return { x0: Math.floor(r0.x / g), y0: Math.floor(r0.y / g), x1: Math.ceil((r0.x + r0.w) / g), y1: Math.ceil((r0.y + r0.h) / g) }
    }
    let d = dims()
    while ((d.x1 - d.x0 > max || d.y1 - d.y0 > max) && k < 14) (k++, (d = dims()))
    const t0 = performance.now()
    for (;;) {
      this.frame++
      this.gutterQ = []
      this.deadline = performance.now() + 2 // thumbnails are background work: smaller slices than the on-screen 5 ms
      this.composed = 0
      this.stats.pending = false
      const miss0 = this.coldMiss
      const set = this.levelSet(k)
      for (let ty = Math.floor(d.y0 / TILE); ty <= Math.floor((d.y1 - 1) / TILE); ty++) {
        for (let tx = Math.floor(d.x0 / TILE); tx <= Math.floor((d.x1 - 1) / TILE); tx++) {
          const key = tileKey(tx, ty)
          if (set.has(key)) this.ensure(k, key, { l0: Infinity })
        }
      }
      for (const cp of this.gutterQ) this.syncGutters(cp)
      this.gutterQ = []
      if (!this.stats.pending) return
      if (this.coldMiss === miss0 && !this.composed && !tileMemory.pendingRestores) return
      if (performance.now() - t0 > maxMs) return
      await nextTask()
    }
  }

  /**
   * Assemble the pyramid composites that cover `rect` at `scale` into ONE new surface (caller disposes) WITHOUT reading it back: GPU commands only, so
   * a thumbnail can be downscaled and read through the fenced asynchronous band reader (io/asyncSave.ts) instead of a pipeline-stalling `readPixels`.
   * `fw/fh` = size of the requested result, `rect` = document area the surface really covers (grid aligned).
   */
  assembleRect(rect: Rect, scale = 1): { asm: Surface; fw: number; fh: number; rect: Rect } {
    this.blocking = this.readBlocking
    this.deadline = this.readPartial ? performance.now() + 20 : Infinity
    this.composed = 0
    try {
      const a = this.assembleNow(rect, scale)
      return { asm: a.asm, fw: a.fw, fh: a.fh, rect: { x: a.d.x0 * a.grid, y: a.d.y0 * a.grid, w: a.d.aw * a.grid, h: a.d.ah * a.grid } }
    } finally {
      this.blocking = false
    }
  }

  private assembleNow(rect: Rect, scale: number): { asm: Surface; d: { x0: number; y0: number; aw: number; ah: number }; grid: number; fw: number; fh: number } {
    const gpu = this.gpu
    const r0 = intRect(rect)
    if (r0.w < 1 || r0.h < 1) throw new RangeError('readFlattened: empty rect')
    scale = Math.min(1, Math.max(1e-4, scale))
    const fw = Math.max(1, Math.round(r0.w * scale))
    const fh = Math.max(1, Math.round(r0.h * scale))
    let k = levelForZoom(scale, 14)
    const max = gpu.maxTexture
    let grid = 2 ** k
    const dims = (): { x0: number; y0: number; aw: number; ah: number } => {
      const x0 = Math.floor(r0.x / grid)
      const y0 = Math.floor(r0.y / grid)
      return { x0, y0, aw: Math.ceil((r0.x + r0.w) / grid) - x0, ah: Math.ceil((r0.y + r0.h) / grid) - y0 }
    }
    let d = dims()
    while ((d.aw > max || d.ah > max) && k < 14) {
      k++
      grid = 2 ** k
      d = dims()
    }
    if (d.aw > max || d.ah > max) throw new RangeError('readFlattened: rect too large')
    this.frame++
    const asm = gpu.surface(d.aw, d.ah, this.fmt())
    const set = this.levelSet(k)
    const budget = { l0: Infinity }
    const t0x = Math.floor(d.x0 / TILE)
    const t0y = Math.floor(d.y0 / TILE)
    const t1x = Math.floor((d.x0 + d.aw - 1) / TILE)
    const t1y = Math.floor((d.y0 + d.ah - 1) / TILE)
    this.gutterQ = []
    for (let ty = t0y; ty <= t1y; ty++) {
      for (let tx = t0x; tx <= t1x; tx++) {
        const key = tileKey(tx, ty)
        if (!set.has(key)) continue
        const cp = this.ensure(k, key, budget)
        if (!cp) continue
        const gx0 = Math.max(d.x0, tx * TILE)
        const gy0 = Math.max(d.y0, ty * TILE)
        const gx1 = Math.min(d.x0 + d.aw, (tx + 1) * TILE)
        const gy1 = Math.min(d.y0 + d.ah, (ty + 1) * TILE)
        gpu.blit(cp.surf, { x: GUTTER + gx0 - tx * TILE, y: GUTTER + gy0 - ty * TILE, w: gx1 - gx0, h: gy1 - gy0 }, asm, gx0 - d.x0, gy0 - d.y0)
      }
    }
    for (const cp of this.gutterQ) this.syncGutters(cp)
    this.gutterQ = []
    return { asm, d, grid, fw, fh }
  }

  private readRectNow(rect: Rect, scale: number, withBackground: boolean): FlatImage {
    const gpu = this.gpu
    const doc = this.getDoc()
    const { asm, d, grid, fw, fh } = this.assembleNow(rect, scale)
    let out = asm
    if (fw !== d.aw || fh !== d.ah) {
      out = gpu.surface(fw, fh, this.fmt())
      const gl = gpu.gl
      const p = gpu.program('save-thumb-box', FS_VERT, THUMB_FS).use()
      gpu.bindTex(0, asm.tex)
      p.i('uSrc', 0).v2('uFoot', 1 / fw, 1 / fh)
      gpu.bindTarget(out, null)
      gl.disable(gl.BLEND)
      gpu.fullscreen()
    }
    const px = gpu.readRGBA8(out, { x: 0, y: 0, w: fw, h: fh })
    if (out !== asm) out.dispose()
    asm.dispose()
    if (withBackground && doc.background.visible) {
      const [br, bg, bb] = doc.background.color.map((v) => v * 255)
      for (let i = 0; i < px.length; i += 4) {
        const a = px[i + 3] / 255
        px[i] = px[i] * a + br * (1 - a)
        px[i + 1] = px[i + 1] * a + bg * (1 - a)
        px[i + 2] = px[i + 2] * a + bb * (1 - a)
        px[i + 3] = 255
      }
    }
    return { px, w: fw, h: fh, rect: { x: d.x0 * grid, y: d.y0 * grid, w: d.aw * grid, h: d.ah * grid } }
  }
}
