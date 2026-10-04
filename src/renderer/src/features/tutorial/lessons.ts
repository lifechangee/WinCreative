import { getAction, actionLabel, runAction, actionEnv } from '../../input/actions'
import { prefs } from '../../input/prefs'
import { t } from '../../i18n'
import { openPrefs } from '../interface/prefsDialog'
import { isUIHidden } from '../interface/appearance'
import type { LessonDef, StepCtx, StepDef } from './types'

const q = (s: string): HTMLElement | null => document.querySelector<HTMLElement>(s)
const qa = (s: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(s)]
const topBtn = (i: number) => (): HTMLElement | null => qa('.tb-left .tb-btn')[i] ?? null
const popover = (): HTMLElement | null => {
  const p = q('.popover')
  return p && p.style.display !== 'none' ? p : null
}
const popId = (c: StepCtx): string | null => c.ui.popovers.current
const sel = (c: StepCtx): any => (c.app as any).selection
const guides = (): any => (window as any).brushwork_guides
/** label of the action currently bound to a pen button / gesture slot */
const bound = (id: string): string => {
  const a = id && id !== 'none' ? getAction(id) : undefined
  return a ? actionLabel(a) : t('tutorial.none')
}
const menuOrAction = (c: StepCtx, menuId: string): void => {
  c.on('menu', (m) => m.id === menuId && c.pass())
  c.on('action', (a) => a.id.endsWith(':' + menuId) && c.pass())
}
const cta = (id: string): ((c: StepCtx) => void) => (c) => void runAction(id, actionEnv())
const prefsTab = (tab: string): ((c: StepCtx) => void) => (c) => openPrefs(c.app, tab)
const prefsTabOpen = (tab: string) => (c: StepCtx): void => c.poll(() => !!q(`.prefs-tabs button.sel[data-id="${tab}"]`))
const strokes = (n: number) => (c: StepCtx): void => {
  let k = 0
  c.on('commit', (e) => e.type === 'stroke' && ++k >= n && c.pass())
}

/** Spread of a colourful drawing used by the Adjustments lesson. */
const rainbow = (p: import('./practice').Practice): void => {
  const cols = [0, 30, 55, 130, 200, 270]
  cols.forEach((h, i) => p.paint([[300, 220 + i * 90], [560, 170 + i * 90], [820, 270 + i * 90], [1080, 200 + i * 90], [1300, 250 + i * 90]], { size: 46, color: { h, s: 0.9, v: 0.95 } }))
}

const basics: LessonDef = {
  id: 'basics',
  icon: 'brush',
  steps: [
    { id: 'intro', anim: 'devices', live: 'devices' },
    { id: 'draw', anim: 'penDraw', watch: strokes(3) },
    {
      id: 'size',
      target: () => qa('.sidebar .vslider')[0] ?? null,
      anim: 'slider:size',
      watch: (c) => {
        const s0 = c.app.state.settings.size
        c.poll(() => Math.abs(c.app.state.settings.size - s0) / s0 > 0.4)
      }
    },
    {
      id: 'opacity',
      target: () => qa('.sidebar .vslider')[1] ?? null,
      anim: 'slider:opacity',
      watch: (c) => {
        const o0 = c.app.state.settings.opacity
        c.poll(() => Math.abs(c.app.state.settings.opacity - o0) > 0.25)
      }
    },
    {
      id: 'undo',
      target: () => qa('.sidebar .round-btn')[0] ?? null,
      anim: 'keys:Ctrl+Z',
      watch: (c) => c.on('commit', (e) => e.type === 'undo' && c.pass())
    },
    {
      id: 'redo',
      target: () => qa('.sidebar .round-btn')[1] ?? null,
      anim: 'keys:Ctrl+Shift+Z',
      prepare: (c) => {
        if (!c.app.doc.history.canRedo && c.app.doc.history.canUndo) c.app.undo()
      },
      watch: (c) => c.on('commit', (e) => e.type === 'redo' && c.pass())
    }
  ]
}

const pen: LessonDef = {
  id: 'pen',
  icon: 'brush',
  pen: true,
  steps: [
    {
      id: 'pressure',
      anim: 'penPressure',
      live: 'pressure',
      needsPen: true,
      prepare: (c) => {
        c.app.state.setPreset('brush', 'ink-brushpen')
        c.app.state.setSize(30)
      },
      watch: (c) =>
        c.on('stroke', (s) => {
          if (s.device === 'pen' && s.maxP - s.minP >= 0.45 && s.maxP >= 0.7) c.pass()
        })
    },
    {
      id: 'tilt',
      anim: 'penTilt',
      live: 'tilt',
      needsPen: true,
      prepare: (c) => {
        c.app.state.setPreset('brush', 'pencil-6b')
        c.app.state.setSize(40)
      },
      watch: (c) =>
        c.on('stroke', (s) => {
          if (s.device === 'pen' && s.maxTilt >= 30) c.pass()
        })
    },
    {
      id: 'eraser',
      anim: 'penEraser',
      live: 'buttons',
      needsPen: true,
      prepare: (c) => {
        c.app.state.setPreset('brush', 'hard-round')
        c.app.state.setSize(40)
        c.practice.paint([[500, 500], [1100, 500]], { size: 60 })
      },
      params: () => ({ eraser: bound(prefs.v.pen.eraserEnd) }),
      watch: (c) => c.on('stroke', (s) => s.eraser && c.pass())
    },
    {
      id: 'hover',
      anim: 'penHover',
      needsPen: true,
      watch: (c) => {
        const h0 = c.hub.hoverCount
        c.poll(() => c.hub.hoverCount - h0 >= 12)
      }
    },
    {
      id: 'hoverAdjust',
      anim: 'penHoverAdjust',
      needsPen: true,
      target: () => qa('.sidebar .vslider')[0] ?? null,
      watch: (c) => {
        const s0 = c.app.state.settings.size
        c.poll(() => Math.abs(c.app.state.settings.size - s0) / s0 > 0.15 && c.hub.pen.hovering)
      }
    }
  ]
}

const penSetup: LessonDef = {
  id: 'penSetup',
  icon: 'crosshair',
  pen: true,
  steps: [
    {
      id: 'barrel',
      anim: 'penButton',
      live: 'buttons',
      needsPen: true,
      params: () => ({ barrel: bound(prefs.v.pen.barrel), barrel2: bound(prefs.v.pen.barrel2) }),
      watch: (c) => c.on('button', () => c.pass())
    },
    {
      id: 'remap',
      anim: 'menu:Pen,Pressure,Gestures',
      target: '.prefs-tabs button[data-id="pen"]',
      cta: prefsTab('pen'),
      watch: prefsTabOpen('pen')
    },
    {
      id: 'curve',
      anim: 'curve',
      target: '.prefs-tabs button[data-id="pressure"]',
      cta: prefsTab('pressure'),
      watch: prefsTabOpen('pressure')
    },
    { id: 'ink', anim: 'ring' },
    {
      id: 'diag',
      anim: 'diag',
      target: '.prefs-tabs button[data-id="diagnostics"]',
      cta: prefsTab('diagnostics'),
      watch: prefsTabOpen('diagnostics')
    }
  ]
}

const nav: LessonDef = {
  id: 'nav',
  icon: 'crosshair',
  steps: [
    {
      id: 'pinch',
      anim: 'pinch',
      watch: (c) => {
        const z0 = c.app.view.zoom
        c.poll(() => Math.abs(Math.log(c.app.view.zoom / z0)) > 0.25)
      }
    },
    {
      id: 'rotate',
      anim: 'twist',
      params: () => ({ key: 'R' }),
      watch: (c) => {
        const r0 = c.app.view.rot
        c.poll(() => Math.abs(c.app.view.rot - r0) > 0.35)
      }
    },
    {
      id: 'snap',
      anim: 'twist',
      prepare: (c) => {
        if (Math.abs(c.app.view.rot) < 0.3) c.app.setView({ ...c.app.view, rot: 0.5 })
      },
      watch: (c) => {
        const q90 = Math.PI / 2
        const off = (): number => {
          const m = ((c.app.view.rot % q90) + q90) % q90
          return Math.min(m, q90 - m)
        }
        let wasOff = off() > 0.12
        c.poll(() => {
          const o = off()
          if (o > 0.12) wasOff = true
          return wasOff && o < 0.004
        })
      }
    },
    {
      id: 'pan',
      anim: 'pan2',
      watch: (c) => {
        const v0 = c.app.view
        c.poll(() => Math.hypot(c.app.view.cx - v0.cx, c.app.view.cy - v0.cy) * c.app.view.zoom > 80)
      }
    },
    {
      id: 'quick',
      anim: 'quickPinch',
      prepare: (c) => c.app.setView({ ...c.app.view, zoom: c.app.view.zoom * 2.4, rot: 0.4 }),
      params: () => ({ key: 'Ctrl+0' }),
      watch: (c) => {
        c.on('gesture', (g) => g.type === 'quickPinch' && c.pass())
        c.on('action', (a) => a.id === 'view.fit' && c.pass())
      }
    }
  ]
}

const color: LessonDef = {
  id: 'color',
  icon: 'pipette',
  setup: (p) => {
    p.circle(520, 500, 150, { size: 14, color: { h: 210, s: 0.9, v: 0.6 } })
    p.circle(1010, 500, 150, { size: 14, color: { h: 350, s: 0.85, v: 0.7 } })
    p.paint([[420, 460], [620, 540]], { size: 40, color: { h: 45, s: 0.95, v: 1 } })
    p.sealHistory()
  },
  steps: [
    {
      id: 'pick',
      anim: 'touchHold',
      params: () => ({ key: 'Alt', action: bound(prefs.v.gestures.touchHold) }),
      watch: (c) => c.on('mode', (m) => m.mode === 'eyedropper' && m.on && c.pass())
    },
    {
      id: 'modify',
      anim: 'click',
      target: '.modify-btn',
      watch: (c) => c.on('mode', (m) => m.mode === 'eyedropper' && m.on && (m.src === 'modify' || m.src === 'modify-latch') && c.pass())
    },
    {
      id: 'drop',
      anim: 'dragColor',
      target: '.tb-color',
      prepare: (c) => c.app.state.setColor({ h: 30, s: 0.95, v: 1 }),
      watch: (c) => c.on('commit', (e) => e.label === 'ColorDrop' && c.pass())
    },
    {
      id: 'threshold',
      anim: 'threshold',
      target: '.tb-color',
      prepare: (c) => c.app.state.setColor({ h: 150, s: 0.8, v: 0.85 }),
      watch: (c) => {
        const seen = new Set<string>()
        c.poll(() => {
          const p = q('.bw-pill')
          if (p?.textContent) seen.add(p.textContent)
          return seen.size >= 2
        }, 80)
      }
    }
  ]
}

const shapes: LessonDef = {
  id: 'shapes',
  icon: 'star',
  steps: [
    {
      id: 'line',
      anim: 'penHold',
      params: () => ({ ms: 550 }),
      watch: (c) => c.poll(() => q('.bw-qs-pill')?.style.display === 'flex')
    },
    {
      id: 'circle',
      anim: 'quickShape',
      watch: (c) => {
        // the previous shape may still be open: only a NEW one (pill hides at the next stroke, shows again) counts
        let was = q('.bw-qs-pill')?.style.display === 'flex'
        c.poll(() => {
          const on = q('.bw-qs-pill')?.style.display === 'flex'
          const fresh = on && !was
          was = on
          return fresh
        }, 60)
      }
    },
    { id: 'edit', anim: 'quickShape' },
    {
      id: 'settings',
      anim: 'menu:Add,Canvas,QuickShape,Prefs',
      target: topBtn(1),
      cta: cta('menu:actions:quickshape-settings'),
      watch: (c) => menuOrAction(c, 'quickshape-settings')
    },
    {
      id: 'stream',
      anim: 'streamline',
      watch: (c) => {
        const st = c.app.state
        const sig = (): string => JSON.stringify([st.smoothingOverride, prefs.v.streamline])
        const s0 = sig()
        c.poll(() => sig() !== s0)
      }
    }
  ]
}

const layers: LessonDef = {
  id: 'layers',
  icon: 'layers',
  setup: (p, app) => {
    p.circle(800, 500, 220, { size: 60, color: { h: 20, s: 0.9, v: 1 } })
    app.doc.addLayer()
    p.sealHistory()
  },
  steps: [
    {
      id: 'open',
      target: '.tb-layers',
      anim: 'click',
      watch: (c) => c.poll(() => popId(c) === 'layers')
    },
    {
      id: 'add',
      target: () => q('.popover .lp-top button'),
      anim: 'click',
      watch: (c) => {
        const n0 = c.app.doc.layers.length
        c.poll(() => c.app.doc.layers.length > n0)
      }
    },
    {
      id: 'opacity',
      target: () => q('.popover .layer-props .row') ?? q('.popover'),
      anim: 'layerRow:altDrag',
      watch: (c) => {
        c.poll(() => c.app.doc.layers.some((l) => l.opacity < 0.95))
      }
    },
    {
      id: 'blend',
      target: () => qa('.popover .layer-props .row')[1] ?? q('.popover'),
      anim: 'blend',
      watch: (c) => c.poll(() => c.app.doc.layers.some((l) => l.blendMode !== 'normal'))
    },
    {
      id: 'options',
      target: () => q('.popover .layer-row.sel') ?? q('.popover'),
      anim: 'layerRow:swipeL',
      watch: (c) => c.poll(() => !!q('.popover .lp-opt'))
    },
    {
      id: 'alpha',
      target: popover,
      anim: 'layerRow:alpha',
      watch: (c) => {
        const n0 = c.app.doc.layers.filter((l) => l.alphaLock).length
        c.poll(() => c.app.doc.layers.filter((l) => l.alphaLock).length > n0)
      }
    },
    {
      id: 'clip',
      target: popover,
      anim: 'clip',
      watch: (c) => {
        const n0 = c.app.doc.layers.filter((l) => l.clipping).length
        c.poll(() => c.app.doc.layers.filter((l) => l.clipping).length > n0)
      }
    },
    {
      id: 'mask',
      target: popover,
      anim: 'mask',
      watch: (c) => {
        const n0 = c.app.doc.layers.filter((l) => l.mask).length
        c.poll(() => c.app.doc.layers.filter((l) => l.mask).length > n0)
      }
    }
  ]
}

const selxf: LessonDef = {
  id: 'selxf',
  icon: 'grid',
  setup: (p) => {
    p.paint([[600, 380], [1000, 380], [1000, 640], [600, 640], [600, 380]], { size: 60, color: { h: 150, s: 0.75, v: 0.8 } })
    p.paint([[640, 420], [960, 600]], { size: 90, color: { h: 150, s: 0.75, v: 0.8 } })
    p.sealHistory()
  },
  steps: [
    { id: 'menu', target: topBtn(3), anim: 'menu:Rectangle,Ellipse,Freehand,Automatic', watch: (c) => c.poll(() => popId(c) === 'menu-selection') },
    {
      id: 'select',
      anim: 'select',
      watch: (c) => c.poll(() => !!sel(c)?.hasSelection?.())
    },
    {
      id: 'transform',
      target: topBtn(4),
      anim: 'menu:Freeform,Uniform,Distort,Warp',
      params: () => ({ key: 'Ctrl+T' }),
      watch: (c) => c.poll(() => !!(window as any).brushwork_xform?.session)
    },
    { id: 'handles', anim: 'transform' },
    {
      id: 'apply',
      anim: 'click',
      watch: (c) => {
        // closing the session counts (a transform without any change commits nothing, but the step is still done)
        let seen = false
        c.poll(() => {
          const open = !!(window as any).brushwork_xform?.session
          if (open) seen = true
          return seen && !open
        })
      }
    },
    {
      id: 'deselect',
      anim: 'keys:Ctrl+D',
      watch: (c) => {
        c.poll(() => !sel(c)?.hasSelection?.() && !(window as any).brushwork_xform?.session)
      }
    }
  ]
}

const adjust: LessonDef = {
  id: 'adjust',
  icon: 'star',
  setup: (p) => {
    rainbow(p)
    p.sealHistory()
  },
  steps: [
    { id: 'menu', target: topBtn(2), anim: 'menu:Hue,Blur,Curves,Noise', watch: (c) => c.poll(() => popId(c) === 'menu-adjustments') },
    { id: 'pick', anim: 'click', watch: (c) => c.poll(() => !!q('.adj-bar')) },
    {
      id: 'slide',
      target: '.adj-bar',
      anim: 'slideCanvas',
      watch: (c) => {
        let v0: string | null = null
        c.poll(() => {
          const v = q('.adj-bar .val')?.textContent ?? null
          if (v0 === null) v0 = v
          return v0 !== null && v !== null && v !== v0
        })
      }
    },
    {
      id: 'pencil',
      target: '.adj-bar',
      anim: 'pencilMode',
      watch: (c) => c.poll(() => q('.adj-bar .seg button:nth-child(2)')?.classList.contains('on') === true)
    },
    {
      id: 'apply',
      target: '.adj-bar',
      anim: 'click',
      watch: (c) => {
        let seen = false
        c.poll(() => {
          const open = !!q('.adj-bar')
          if (open) seen = true
          return seen && !open
        })
      }
    }
  ]
}

const guidesLesson: LessonDef = {
  id: 'guides',
  icon: 'grid',
  steps: [
    {
      id: 'open',
      target: topBtn(1),
      anim: 'menu:Add,Guide,Assist,Prefs',
      cta: cta('menu:actions:guide-edit'),
      watch: (c) => menuOrAction(c, 'guide-edit')
    },
    {
      id: 'sym',
      anim: 'symmetry',
      watch: (c) => c.poll(() => guides()?.state?.type === 'symmetry' && guides()?.state?.enabled === true)
    },
    {
      id: 'assist',
      target: topBtn(1),
      anim: 'menu:Add,Guide,Assist,Prefs',
      cta: cta('menu:actions:guide-assist'),
      watch: (c) => c.poll(() => guides()?.assistOn?.(c.app.doc.activeId) === true)
    },
    {
      id: 'draw',
      anim: 'symmetry',
      watch: strokes(1)
    },
    { id: 'more', anim: 'guides' }
  ]
}

const quick: LessonDef = {
  id: 'quick',
  icon: 'list',
  steps: [
    {
      id: 'open',
      anim: 'qm',
      params: () => ({ key: 'Q', barrel2: bound(prefs.v.pen.barrel2) }),
      watch: (c) => c.poll(() => !!q('.qm'), 80)
    },
    {
      id: 'pick',
      anim: 'qm',
      prepare: (c) => {
        if (!q('.qm')) void runAction('ui.quickMenu', actionEnv())
        void c
      },
      watch: (c) => {
        let seen = false
        c.poll(() => {
          const open = !!q('.qm')
          if (open) seen = true
          return seen && !open
        }, 80)
      }
    },
    {
      id: 'custom',
      anim: 'menu:Slot 1,Slot 2,Slot 3',
      cta: prefsTab('quickmenu'),
      target: '.prefs-tabs button[data-id="quickmenu"]',
      watch: prefsTabOpen('quickmenu')
    },
    { id: 'sheet', anim: 'cheat', watch: (c) => c.poll(() => !!q('.sheet'), 80) },
    {
      id: 'hide',
      anim: 'hideUI',
      params: () => ({ four: bound(prefs.v.gestures.fourFingerTap) }),
      watch: (c) => {
        let hidden = false
        c.poll(() => {
          if (isUIHidden()) hidden = true
          return hidden && !isUIHidden()
        })
      }
    }
  ]
}

const exportLesson: LessonDef = {
  id: 'export',
  icon: 'share',
  steps: [
    { id: 'draw', anim: 'penDraw', watch: strokes(3) },
    { id: 'menu', target: topBtn(1), anim: 'menu:Add,Video,Share,Prefs', watch: (c) => c.poll(() => popId(c) === 'menu-actions') },
    { id: 'replay', target: topBtn(5), anim: 'timelapse', watch: (c) => c.poll(() => !!q('.tle')) },
    { id: 'export', target: topBtn(1), anim: 'export', watch: (c) => c.on('menu', (m) => ['video-export', 'export-png', 'export-png-bg', 'export-jpg', 'share-pdf'].includes(m.id) && c.pass()) }
  ]
}

const gallery: LessonDef = {
  id: 'gallery',
  icon: 'grid',
  steps: [
    { id: 'menu', target: topBtn(0), anim: 'menu:Gallery,New,Open,Save', watch: (c) => c.poll(() => popId(c) === 'menu-gallery') },
    { id: 'open', target: topBtn(0), anim: 'gallery', watch: (c) => c.poll(() => !!q('.bw-gallery.open')) },
    { id: 'tour', anim: 'gallery' },
    { id: 'back', anim: 'keys:Esc', watch: (c) => c.poll(() => !q('.bw-gallery.open')) },
    { id: 'save', anim: 'keys:Ctrl+S' }
  ]
}

export const LESSONS: LessonDef[] = [basics, pen, penSetup, nav, color, shapes, layers, selxf, adjust, guidesLesson, quick, exportLesson, gallery]

export const lessonById = (id: string): LessonDef | undefined => LESSONS.find((l) => l.id === id)
/** i18n key helpers */
export const lessonKey = (l: LessonDef, part: string): string => `tutorial.l.${l.id}.${part}`
export const stepKey = (l: LessonDef, s: StepDef, part: 't' | 'b' | 'c'): string => `tutorial.l.${l.id}.${s.id}.${part}`
