import { t } from '../../i18n'
import type { App } from '../../app/app'
import { Emitter } from '../../core/events'
import type { Document } from '../../doc/document'
import { Layer } from '../../doc/layer'
import type { Surface } from '../../gl/gpu'
import { FrameRenderer } from '../../io/frameRender'
import { registerBwkExtension } from '../../io/bwk'
import { resample } from '../../io/gpuUtil'
import { regionPieces } from '../../core/tiles'
import { TileStore } from '../../doc/tileStore'
import { PlayMode, onionFrames, playbackSequence, stepAtTick } from './schedule'

export interface OnionSettings {
  on: boolean
  before: number
  after: number
  /** 0..1 opacity of the nearest ghost */
  opacity: number
  colorBefore: string
  colorAfter: string
}

export interface AnimState {
  enabled: boolean
  fps: number
  mode: PlayMode
  onion: OnionSettings
  /** false: ghosts are drawn above the current frame */
  blendPrimary: boolean
  /** hold duration in ticks (1/fps s), by root layer id; default 1 */
  holds: Record<string, number>
  background: string[]
  foreground: string[]
  current: number
}

export const defaultAnim = (): AnimState => ({
  enabled: false,
  fps: 12,
  mode: 'loop',
  onion: { on: true, before: 2, after: 1, opacity: 0.5, colorBefore: '#ff4d4d', colorAfter: '#3fbf6f' },
  blendPrimary: true,
  holds: {},
  background: [],
  foreground: [],
  current: 0
})

const hexRgb = (h: string): [number, number, number] => {
  const n = parseInt(h.replace('#', ''), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

const states = new WeakMap<Document, AnimState>()
export const animState = (doc: Document): AnimState => {
  let s = states.get(doc)
  if (!s) states.set(doc, (s = defaultAnim()))
  return s
}

registerBwkExtension({
  id: 'animio.animation',
  save: (doc) => ({ extra: animState(doc) }),
  load: (doc, extra) => {
    const d = defaultAnim()
    const e = (extra ?? {}) as Partial<AnimState>
    const ids = new Set(doc.layers.map((l) => l.id))
    const s: AnimState = {
      ...d,
      ...e,
      onion: { ...d.onion, ...(e.onion ?? {}) },
      holds: Object.fromEntries(Object.entries(e.holds ?? {}).filter(([k]) => ids.has(k))),
      background: (e.background ?? []).filter((i) => ids.has(i)),
      foreground: (e.foreground ?? []).filter((i) => ids.has(i))
    }
    if (!['loop', 'pingpong', 'oneshot'].includes(s.mode)) s.mode = 'loop'
    states.set(doc, s)
  }
})

export interface AnimEvents {
  /** frame list / current frame / settings / playback state changed */
  change: void
  /** thumbnails need a refresh (ids null = all) */
  dirty: string[] | null
}

/**
 * Animation Assist engine. Frames are the ROOT layers/groups of the document (bottom = first frame); each frame may
 * contain its own layers when it is a group. Background/foreground frames are drawn under/over every frame and are
 * not part of the sequence. The compositor's rootProvider hook shows only the current frame (+ onion skins).
 */
export class AnimAssist {
  readonly events = new Emitter<AnimEvents>()
  playing = false
  private fr: FrameRenderer | null = null
  private ghosts: { surf: Surface; layer: Layer }[] = []
  private ghostDirty = true
  private raf = 0
  private t0 = 0
  private offDoc: (() => void)[] = []
  private busyGhost = false

  constructor(private app: App) {
    app.events.on('doc', () => this.bind())
    this.bind()
  }

  get doc(): Document {
    return this.app.doc
  }
  get state(): AnimState {
    return animState(this.doc)
  }
  get enabled(): boolean {
    return this.state.enabled
  }

  private bind(): void {
    this.stop()
    this.offDoc.forEach((o) => o())
    this.offDoc = []
    this.fr?.dispose()
    this.fr = null
    this.freeGhosts()
    const doc = this.doc
    this.offDoc.push(
      doc.events.on('commit', (e) => {
        this.ghostDirty = true
        this.events.emit('dirty', e.layerId ? [this.rootOf(e.layerId)?.id ?? ''] : null)
      }),
      doc.events.on('layers', () => {
        this.syncCurrentFromActive()
        this.ghostDirty = true
        this.events.emit('change', undefined)
      })
    )
    this.apply()
    this.events.emit('change', undefined)
  }

  renderer(): FrameRenderer {
    return (this.fr ??= new FrameRenderer(this.app.gpu, this.doc))
  }

  rootOf(id: string): Layer | null {
    let l = this.doc.getLayer(id) ?? null
    let g = 0
    while (l?.parentId && g++ < 64) l = this.doc.getLayer(l.parentId) ?? null
    return l
  }

  /** Frames of the sequence (excludes background/foreground frames), bottom -> top. */
  frames(): Layer[] {
    const s = this.state
    return this.doc.childrenOf(null).filter((l) => !s.background.includes(l.id) && !s.foreground.includes(l.id))
  }
  backgrounds(): Layer[] {
    return this.state.background.map((i) => this.doc.getLayer(i)).filter((l): l is Layer => !!l && !l.parentId)
  }
  foregrounds(): Layer[] {
    return this.state.foreground.map((i) => this.doc.getLayer(i)).filter((l): l is Layer => !!l && !l.parentId)
  }
  holdOf(l: Layer): number {
    return Math.max(1, Math.round(this.state.holds[l.id] ?? 1))
  }
  get current(): number {
    const n = this.frames().length
    return Math.max(0, Math.min(n - 1, this.state.current))
  }

  // ------------------------------------------------------------ view
  private apply(): void {
    const comp = this.app.compositor
    comp.rootProvider = this.state.enabled ? (roots) => this.provide(roots) : null
    this.ghostDirty = true
    this.doc.events.emit('change', { rect: null })
  }

  setEnabled(on: boolean): void {
    if (on === this.state.enabled) return
    this.state.enabled = on
    if (!on) this.stop()
    if (on) this.syncCurrentFromActive()
    this.apply()
    this.events.emit('change', undefined)
  }

  private provide(roots: Layer[]): Layer[] {
    const fr = this.frames()
    if (!fr.length) return roots
    const cur = fr[this.current]
    const s = this.state
    if (this.ghostDirty && !this.busyGhost && !this.playing) {
      // infinite: the frame copy needs GPU work that must not run inside a compose pass: rebuild on the next frame
      if (!this.doc.isInfinite) this.rebuildGhosts()
      else if (!this.ghostTimer) {
        this.ghostTimer = requestAnimationFrame(() => {
          this.ghostTimer = 0
          if (!this.ghostDirty || this.playing) return
          this.rebuildGhosts()
          this.doc.events.emit('change', { rect: null })
        })
      }
    }
    const ghostLayers = !this.playing && s.onion.on ? this.ghosts.map((g) => g.layer) : []
    const primary = s.blendPrimary ? [...ghostLayers, cur] : [cur, ...ghostLayers]
    return [...this.backgrounds(), ...primary, ...this.foregrounds()]
  }

  private ghostTimer = 0

  private freeGhosts(): void {
    for (const g of this.ghosts) {
      if (g.layer.tiles) g.layer.dispose()
      else g.surf.dispose()
    }
    this.ghosts = []
  }

  private rebuildGhosts(): void {
    this.busyGhost = true
    try {
      this.ghostDirty = false
      this.freeGhosts()
      const s = this.state
      if (!s.onion.on) return
      const fr = this.frames()
      const specs = onionFrames(this.current, fr.length, s.onion.before, s.onion.after, s.onion.opacity)
      const doc = this.doc
      const r = this.renderer()
      for (const sp of specs) {
        const gpu = this.app.gpu
        const src = r.renderFull([fr[sp.frame]])
        const surf = gpu.surface(src.w, src.h, doc.format)
        const c = hexRgb(sp.offset < 0 ? s.onion.colorBefore : s.onion.colorAfter)
        resample(gpu, src, surf, { origin: [0, 0], step: [1, 1], tint: [c[0], c[1], c[2], 0.85], alpha: sp.opacity })
        if (doc.isInfinite) {
          // infinite canvas: the ghost lives in tiles at the frame rectangle (Animation Assist works inside the frame)
          const area = r.areaRect()
          const layer = new Layer('ghost:' + fr[sp.frame].id, gpu.surface(1, 1, 'rgba8'), { name: 'onion', opacity: 1 })
          layer.tiles = new TileStore(gpu, doc.format)
          for (const p of regionPieces(area)) gpu.blit(surf, { x: p.dx, y: p.dy, w: p.w, h: p.h }, layer.tiles.ensure(p.tx, p.ty), p.sx, p.sy)
          surf.dispose()
          this.ghosts.push({ surf: layer.pixels, layer })
          continue
        }
        const layer = new Layer('ghost:' + fr[sp.frame].id, surf, { name: 'onion', opacity: 1 })
        this.ghosts.push({ surf, layer })
      }
    } finally {
      this.busyGhost = false
    }
  }

  /** Something about the view changed (settings, current frame): recompose. */
  refresh(): void {
    this.ghostDirty = true
    this.doc.events.emit('change', { rect: null })
    this.events.emit('change', undefined)
  }

  // ------------------------------------------------------------ navigation
  setCurrent(i: number, syncActive = true): void {
    const fr = this.frames()
    if (!fr.length) return
    i = Math.max(0, Math.min(fr.length - 1, i))
    this.state.current = i
    if (syncActive) {
      const f = fr[i]
      const kids = f.isGroup ? this.doc.descendantsOf(f.id).filter((l) => !l.isGroup) : []
      const target = f.isGroup ? (kids.find((k) => k.id === this.doc.activeId) ?? kids[kids.length - 1] ?? f) : f
      this.suppress = true
      this.doc.setActive(target.id)
      this.suppress = false
    }
    this.refresh()
  }
  private suppress = false

  private syncCurrentFromActive(): void {
    if (this.suppress || !this.state.enabled) return
    const root = this.rootOf(this.doc.activeId)
    if (!root) return
    const i = this.frames().findIndex((f) => f.id === root.id)
    if (i >= 0 && i !== this.state.current) this.state.current = i
  }

  // ------------------------------------------------------------ frame operations
  addFrame(): void {
    const fr = this.frames()
    const ref = fr[this.current] ?? this.doc.childrenOf(null).pop()
    const l = this.doc.createLayer({ name: t('core.doc.frameN', { n: fr.length + 1 }) })
    this.doc.insertLayer(l, ref ? { id: ref.id, where: 'above' } : null, 'Add frame')
    this.setCurrent(this.frames().findIndex((f) => f.id === l.id))
  }
  duplicateFrame(i = this.current): void {
    const f = this.frames()[i]
    if (!f) return
    const d = this.doc.duplicateLayer(f.id)
    if (d) {
      this.state.holds[d.id] = this.holdOf(f)
      this.setCurrent(this.frames().findIndex((x) => x.id === d.id))
    }
  }
  deleteFrame(i = this.current): void {
    const f = this.frames()[i]
    if (!f) return
    this.doc.deleteLayer(f.id)
    delete this.state.holds[f.id]
    this.state.background = this.state.background.filter((x) => x !== f.id)
    this.state.foreground = this.state.foreground.filter((x) => x !== f.id)
    this.setCurrent(Math.min(i, this.frames().length - 1))
  }
  setHold(i: number, ticks: number): void {
    const f = this.frames()[i]
    if (!f) return
    this.state.holds[f.id] = Math.max(1, Math.min(240, Math.round(ticks)))
    this.events.emit('change', undefined)
  }
  /** role: move a frame out of the sequence into background/foreground (or back). */
  setRole(id: string, role: 'none' | 'bg' | 'fg'): void {
    const s = this.state
    s.background = s.background.filter((x) => x !== id)
    s.foreground = s.foreground.filter((x) => x !== id)
    if (role === 'bg') s.background.push(id)
    if (role === 'fg') s.foreground.push(id)
    this.setCurrent(this.state.current, false)
  }
  roleOf(id: string): 'none' | 'bg' | 'fg' {
    return this.state.background.includes(id) ? 'bg' : this.state.foreground.includes(id) ? 'fg' : 'none'
  }
  moveFrame(fromId: string, toId: string): void {
    const fr = this.doc.childrenOf(null)
    const a = fr.findIndex((l) => l.id === fromId)
    const b = fr.findIndex((l) => l.id === toId)
    if (a < 0 || b < 0 || a === b) return
    this.doc.moveLayerRelative(fromId, toId, a < b ? 'above' : 'below')
    this.setCurrent(this.frames().findIndex((f) => f.id === fromId), false)
  }
  private clip: string | null = null
  copyFrame(i = this.current): void {
    this.clip = this.frames()[i]?.id ?? null
  }
  get canPaste(): boolean {
    return !!this.clip && !!this.doc.getLayer(this.clip)
  }
  pasteFrame(): void {
    if (!this.clip || !this.doc.getLayer(this.clip)) return
    const src = this.doc.getLayer(this.clip)!
    const d = this.doc.duplicateLayer(src.id)
    if (!d) return
    // move the copy right after the current frame
    const cur = this.frames()[this.current]
    if (cur && cur.id !== d.id) this.doc.moveLayerRelative(d.id, cur.id, 'above')
    this.setCurrent(this.frames().findIndex((f) => f.id === d.id))
  }

  // ------------------------------------------------------------ playback
  sequence(): { frame: Layer; ticks: number }[] {
    const fr = this.frames()
    return playbackSequence(fr.map((f) => this.holdOf(f)), this.state.mode).map((s) => ({ frame: fr[s.frame], ticks: s.ticks }))
  }

  play(): void {
    if (this.playing || !this.state.enabled) return
    const fr = this.frames()
    if (fr.length < 2) return
    this.playing = true
    const seq = playbackSequence(fr.map((f) => this.holdOf(f)), this.state.mode)
    const once = this.state.mode === 'oneshot'
    this.t0 = performance.now()
    let lastStep = -1
    const loop = (t: number): void => {
      if (!this.playing) return
      const tick = ((t - this.t0) / 1000) * this.state.fps
      const { step, done } = stepAtTick(seq, tick, once)
      if (step !== lastStep) {
        lastStep = step
        this.state.current = seq[step].frame
        this.refresh()
      }
      if (done) {
        this.stop()
        return
      }
      this.raf = requestAnimationFrame(loop)
    }
    this.events.emit('change', undefined)
    this.raf = requestAnimationFrame(loop)
  }
  stop(): void {
    if (!this.playing) return
    this.playing = false
    cancelAnimationFrame(this.raf)
    this.ghostDirty = true
    this.syncActiveToCurrent()
    this.doc.events.emit('change', { rect: null })
    this.events.emit('change', undefined)
  }
  private syncActiveToCurrent(): void {
    const f = this.frames()[this.current]
    if (f) this.setCurrent(this.current)
  }
  toggle(): void {
    if (this.playing) this.stop()
    else this.play()
  }
}
