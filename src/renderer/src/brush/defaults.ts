import type { BrushInput } from '../core/brush'

/**
 * Default brush library: content is data. Each set lists BrushInput presets (partial JSON, filled by
 * normalizeBrush). Ids that existed before the library rewrite are kept (soft-airbrush, hard-round,
 * pencil-6b, ink-pen, watercolor-wet, chalk, smudge-*, eraser-*).
 */
export interface DefaultSet {
  id: string
  name: string
  brushes: BrushInput[]
}

const px = (id: string, name: string, o: Omit<BrushInput, 'id' | 'name'>): BrushInput => ({ id, name, ...o })
const smudge = (id: string, name: string, o: Omit<BrushInput, 'id' | 'name'>): BrushInput => ({ id, name, category: 'smudge', ...o })
const eraser = (id: string, name: string, o: Omit<BrushInput, 'id' | 'name'>): BrushInput => ({ id, name, category: 'erase', ...o })

const inkTaper = { pressure: { start: 0.22, end: 0.35, size: 0.85, opacity: 0, tip: 0.35, pressure: 0.3 }, linked: false }
const softTaper = { pressure: { start: 0.12, end: 0.3, size: 0.6, opacity: 0.3, tip: 0.5, pressure: 0.4 }, linked: false }

export const DEFAULT_SETS: DefaultSet[] = [
  {
    id: 'set-sketching',
    name: 'Sketching',
    brushes: [
      px('pencil-6b', '6B Pencil', {
        defaultSize: 9, hardness: 0.75, spacing: 0.07, flow: 0.55, streamline: 0.1,
        grain: { texture: 'grain-pencil', scale: 1.2, depth: 0.85, moving: false },
        dynamics: { pressureSize: 0.25, pressureOpacity: 0.8, tiltSize: 1.5, tiltRoundness: 0.5, tiltOpacity: 0.35, tiltGradation: 0.5 },
        shape: { inputStyle: 'azimuth' }
      }),
      px('pencil-hb', 'HB Pencil', {
        defaultSize: 5, hardness: 0.9, spacing: 0.06, flow: 0.7, streamline: 0.12,
        grain: { texture: 'grain-pencil', scale: 1, depth: 0.7 },
        dynamics: { pressureSize: 0.2, pressureOpacity: 0.7, tiltSize: 1, tiltOpacity: 0.3 },
        shape: { inputStyle: 'azimuth' }
      }),
      px('sketch-graphite', 'Soft Graphite', {
        defaultSize: 16, hardness: 0.35, spacing: 0.06, flow: 0.28, streamline: 0.15,
        grain: { texture: 'grain-paper', scale: 1.3, depth: 0.75 },
        dynamics: { pressureSize: 0.3, pressureOpacity: 0.85, tiltSize: 1.4, tiltGradation: 0.8, tiltOpacity: 0.2 }
      }),
      px('sketch-mechanical', 'Mechanical Lead', {
        defaultSize: 3, hardness: 1, spacing: 0.05, flow: 0.9, streamline: 0.2,
        dynamics: { pressureSize: 0.1, pressureOpacity: 0.5 }
      }),
      px('sketch-carpenter', 'Carpenter', {
        defaultSize: 14, hardness: 0.95, roundness: 0.28, angle: 35, spacing: 0.05, flow: 0.65, streamline: 0.15,
        grain: { texture: 'grain-pencil', scale: 1.1, depth: 0.7 },
        dynamics: { pressureSize: 0.2, pressureOpacity: 0.5 }
      }),
      px('sketch-colored', 'Colored Pencil', {
        defaultSize: 8, hardness: 0.8, spacing: 0.06, flow: 0.65, streamline: 0.1,
        grain: { texture: 'grain-rough', scale: 0.9, depth: 0.7 },
        dynamics: { pressureSize: 0.2, pressureOpacity: 0.85 },
        color: { stampJitter: { lightness: 0.06 } }
      }),
      px('sketch-rough', 'Rough Sketch', {
        defaultSize: 12, hardness: 0.7, spacing: 0.08, flow: 0.5, streamline: 0.05,
        grain: { texture: 'grain-charcoal', scale: 1.4, depth: 0.85 },
        path: { lateralJitter: 0.04 },
        dynamics: { pressureSize: 0.35, pressureOpacity: 0.75, sizeJitter: 0.1 }
      })
    ]
  },
  {
    id: 'set-inking',
    name: 'Inking',
    brushes: [
      px('ink-pen', 'Ink Pen', {
        defaultSize: 12, hardness: 1, spacing: 0.04, flow: 1, streamline: 0.55,
        dynamics: { pressureSize: 0.92 }, taper: inkTaper, stab: { streamlinePressure: 0.4 }
      }),
      px('ink-technical', 'Technical Pen', {
        defaultSize: 4, hardness: 1, spacing: 0.04, flow: 1, streamline: 0.35,
        dynamics: { pressureSize: 0 }, stab: { stabilization: 0.35, motionFiltering: 0.25 }
      }),
      px('ink-brushpen', 'Brush Pen', {
        defaultSize: 18, hardness: 0.95, spacing: 0.035, flow: 1, streamline: 0.6,
        dynamics: { pressureSize: 1 }, taper: { pressure: { start: 0.3, end: 0.5, size: 1, opacity: 0, tip: 0.2, pressure: 0.5 }, linked: false },
        stab: { streamlinePressure: 0.6 }
      }),
      px('ink-monoline', 'Monoline', {
        defaultSize: 8, hardness: 1, spacing: 0.03, flow: 1, streamline: 0.5,
        dynamics: { pressureSize: 0 }, stab: { stabilization: 0.5, motionFiltering: 0.3 }
      }),
      px('ink-dip', 'Dip Pen', {
        defaultSize: 10, hardness: 1, roundness: 0.7, angle: 20, spacing: 0.035, flow: 1, streamline: 0.5,
        dynamics: { pressureSize: 0.95, speedSize: -0.25 }, taper: softTaper, stab: { streamlinePressure: 0.5 }
      }),
      px('ink-studio', 'Studio Pen', {
        defaultSize: 9, hardness: 0.97, spacing: 0.04, flow: 1, streamline: 0.45,
        dynamics: { pressureSize: 0.75 }, taper: { pressure: { start: 0.1, end: 0.2, size: 0.7, opacity: 0, tip: 0.6, pressure: 0.2 }, linked: false }
      }),
      px('ink-gel', 'Gel Pen', {
        defaultSize: 6, hardness: 0.95, spacing: 0.04, flow: 1, streamline: 0.35,
        dynamics: { pressureSize: 0.5 }, render: { burnt: 0.25 }
      })
    ]
  },
  {
    id: 'set-drawing',
    name: 'Drawing',
    brushes: [
      px('hard-round', 'Hard Round', {
        defaultSize: 24, hardness: 1, spacing: 0.06, flow: 1, streamline: 0.25, dynamics: { pressureSize: 0.65 }
      }),
      px('draw-fineliner', 'Fineliner', {
        defaultSize: 5, hardness: 1, spacing: 0.04, flow: 1, streamline: 0.35, dynamics: { pressureSize: 0.3 }, stab: { motionFiltering: 0.2 }
      }),
      px('draw-marker', 'Marker', {
        defaultSize: 28, hardness: 0.9, roundness: 0.6, angle: 40, spacing: 0.05, flow: 1, streamline: 0.3,
        render: { mode: 'uniformedGlaze' }, opacity: 0.85, dynamics: { pressureSize: 0.1, pressureOpacity: 0 }
      }),
      px('draw-felt', 'Felt Tip', {
        defaultSize: 16, hardness: 0.85, spacing: 0.05, flow: 1, streamline: 0.3,
        render: { mode: 'uniformedGlaze' }, opacity: 0.9, dynamics: { pressureSize: 0.25 },
        grain: { texture: 'grain-noise', scale: 0.8, depth: 0.25 }
      }),
      px('draw-crayon', 'Wax Crayon', {
        defaultSize: 26, tipTexture: 'tip-crayon', spacing: 0.1, flow: 0.8, streamline: 0.1,
        grain: { texture: 'grain-rough', scale: 1, depth: 0.65 },
        dynamics: { pressureSize: 0.3, pressureOpacity: 0.5, angleJitter: 180 }
      }),
      px('draw-pastel', 'Soft Pastel', {
        defaultSize: 40, tipTexture: 'tip-charcoal', spacing: 0.12, flow: 0.55, streamline: 0.1,
        grain: { texture: 'grain-canvas', scale: 1.2, depth: 0.8 },
        dynamics: { pressureSize: 0.3, pressureOpacity: 0.6, angleJitter: 180 }
      })
    ]
  },
  {
    id: 'set-calligraphy',
    name: 'Calligraphy',
    brushes: [
      px('cal-chisel', 'Chisel Nib', {
        defaultSize: 20, hardness: 1, roundness: 0.18, angle: 40, spacing: 0.03, flow: 1, streamline: 0.5, dynamics: { pressureSize: 0.2 }
      }),
      px('cal-broad', 'Broad Edge', {
        defaultSize: 30, hardness: 1, roundness: 0.1, angle: 30, spacing: 0.03, flow: 1, streamline: 0.45, dynamics: { pressureSize: 0.15 }
      }),
      px('cal-lettering', 'Brush Lettering', {
        defaultSize: 22, hardness: 0.98, spacing: 0.03, flow: 1, streamline: 0.7,
        dynamics: { pressureSize: 1 }, taper: inkTaper, stab: { streamlinePressure: 0.7 }
      }),
      px('cal-italic', 'Italic Nib', {
        defaultSize: 14, hardness: 1, roundness: 0.3, angle: 45, spacing: 0.03, flow: 1, streamline: 0.55,
        dynamics: { pressureSize: 0.4 }, taper: softTaper
      }),
      px('cal-flex', 'Flex Nib', {
        defaultSize: 16, hardness: 1, roundness: 0.5, angle: 55, spacing: 0.03, flow: 1, streamline: 0.6,
        dynamics: { pressureSize: 1, speedSize: -0.3 }, stab: { streamlinePressure: 0.5 }
      })
    ]
  },
  {
    id: 'set-painting',
    name: 'Painting',
    brushes: [
      px('paint-round', 'Round Brush', {
        defaultSize: 40, hardness: 0.8, spacing: 0.06, flow: 0.75, streamline: 0.35,
        dynamics: { pressureSize: 0.6, pressureOpacity: 0.3 }
      }),
      px('paint-flat', 'Flat Brush', {
        defaultSize: 50, tipTexture: 'tip-flat', spacing: 0.06, flow: 0.8, streamline: 0.3, shape: { follow: 1 },
        grain: { texture: 'grain-canvas', scale: 1.1, depth: 0.35 }, dynamics: { pressureSize: 0.35 }
      }),
      px('paint-oil', 'Oil Bristle', {
        defaultSize: 60, tipTexture: 'tip-oil', spacing: 0.07, flow: 0.9, streamline: 0.3, shape: { follow: 1 },
        render: { mode: 'uniformBlending' }, wet: { dilution: 0.15, charge: 0.6, attack: 0.7, pull: 0.55, grade: 0.4, blur: 0.05 },
        dynamics: { pressureSize: 0.3, pressureOpacity: 0.3 }
      }),
      px('paint-gouache', 'Gouache', {
        defaultSize: 50, hardness: 0.75, spacing: 0.06, flow: 0.9, streamline: 0.3,
        render: { mode: 'uniformedGlaze' }, grain: { texture: 'grain-watercolor', scale: 1.2, depth: 0.3 },
        dynamics: { pressureSize: 0.4, pressureOpacity: 0.15 }
      }),
      px('paint-impasto', 'Impasto', {
        defaultSize: 70, tipTexture: 'tip-bristle', spacing: 0.08, flow: 1, streamline: 0.25, shape: { follow: 1 },
        render: { mode: 'heavyGlaze', burnt: 0.35 }, grain: { texture: 'grain-canvas', scale: 0.8, depth: 0.5, moving: true, movement: 1 },
        dynamics: { pressureSize: 0.25, pressureOpacity: 0.2 }
      }),
      px('paint-knife', 'Palette Knife', {
        defaultSize: 80, tipTexture: 'tip-square', roundness: 0.3, spacing: 0.05, flow: 1, streamline: 0.3, shape: { follow: 1 },
        render: { mode: 'intenseBlending' }, wet: { dilution: 0.05, charge: 0.4, attack: 0.9, pull: 0.85, grade: 0.15 },
        dynamics: { pressureSize: 0.1 }
      }),
      px('paint-soft', 'Blend Brush', {
        defaultSize: 70, hardness: 0.45, spacing: 0.07, flow: 0.8, streamline: 0.35,
        render: { mode: 'uniformBlending' }, wet: { dilution: 0.4, charge: 0.3, attack: 0.5, pull: 0.7, blur: 0.2 },
        dynamics: { pressureSize: 0.3, pressureOpacity: 0.3 }
      })
    ]
  },
  {
    id: 'set-artistic',
    name: 'Artistic',
    brushes: [
      px('art-dry', 'Dry Brush', {
        defaultSize: 60, tipTexture: 'tip-dry', spacing: 0.07, flow: 0.9, streamline: 0.3, shape: { follow: 1 },
        grain: { texture: 'grain-rough', scale: 1, depth: 0.5 }, dynamics: { pressureSize: 0.3, pressureOpacity: 0.4 }
      }),
      px('art-sponge', 'Sponge', {
        defaultSize: 70, tipTexture: 'tip-sponge', spacing: 0.2, flow: 0.7, streamline: 0.1, shape: { count: 1 },
        dynamics: { pressureSize: 0.2, pressureOpacity: 0.4, angleJitter: 180 }
      }),
      px('art-stipple', 'Stippler', {
        defaultSize: 40, tipTexture: 'tip-stipple', spacing: 0.25, flow: 0.9, streamline: 0.1,
        dynamics: { pressureSize: 0.3, angleJitter: 180, scatter: 0.05 }
      }),
      px('art-leaves', 'Leaf Scatter', {
        defaultSize: 40, tipTexture: 'tip-leaf', spacing: 0.7, flow: 1, streamline: 0.1,
        shape: { count: 2, follow: 0.4 }, dynamics: { pressureSize: 0.3, angleJitter: 180, sizeJitter: 0.4 },
        path: { lateralJitter: 0.7 }, color: { stampJitter: { hue: 0.04, lightness: 0.2, saturation: 0.15 } }
      }),
      px('art-hair', 'Hair Bristle', {
        defaultSize: 50, tipTexture: 'tip-hair', spacing: 0.06, flow: 0.85, streamline: 0.4, shape: { follow: 1 },
        dynamics: { pressureSize: 0.3, pressureOpacity: 0.2 }
      }),
      px('art-splat', 'Ink Splash', {
        defaultSize: 60, tipTexture: 'tip-splash', spacing: 0.5, flow: 1, streamline: 0.1,
        dynamics: { pressureSize: 0.4, angleJitter: 180, sizeJitter: 0.5 }
      })
    ]
  },
  {
    id: 'set-airbrushing',
    name: 'Airbrushing',
    brushes: [
      px('soft-airbrush', 'Soft Airbrush', {
        defaultSize: 80, hardness: 0, spacing: 0.06, flow: 0.1, streamline: 0.3, dynamics: { pressureSize: 0.1, pressureOpacity: 0.6 }
      }),
      px('air-hard', 'Hard Airbrush', {
        defaultSize: 60, hardness: 0.6, spacing: 0.05, flow: 0.12, streamline: 0.3, dynamics: { pressureSize: 0.1, pressureOpacity: 0.55 }
      }),
      px('air-medium', 'Medium Airbrush', {
        defaultSize: 70, hardness: 0.3, spacing: 0.05, flow: 0.14, streamline: 0.3, dynamics: { pressureSize: 0.1, pressureOpacity: 0.55 }
      }),
      px('air-speckle', 'Speckle Spray', {
        defaultSize: 90, tipTexture: 'tip-spray', spacing: 0.12, flow: 0.9, streamline: 0.2,
        dynamics: { pressureSize: 0.2, pressureOpacity: 0.3, angleJitter: 180 }
      }),
      px('air-grain', 'Grainy Airbrush', {
        defaultSize: 90, hardness: 0.1, spacing: 0.06, flow: 0.2, streamline: 0.3,
        grain: { texture: 'grain-noise', scale: 0.7, depth: 0.9 }, dynamics: { pressureSize: 0.1, pressureOpacity: 0.5 }
      }),
      px('air-glow', 'Glow Spray', {
        defaultSize: 120, hardness: 0, spacing: 0.06, flow: 0.06, streamline: 0.3, render: { blendMode: 'screen' },
        dynamics: { pressureSize: 0.1, pressureOpacity: 0.6 }
      })
    ]
  },
  {
    id: 'set-textures',
    name: 'Textures',
    brushes: [
      px('tex-canvas', 'Canvas Texture', {
        defaultSize: 90, hardness: 0.85, spacing: 0.06, flow: 0.8, grain: { texture: 'grain-canvas', scale: 1, depth: 1 }, dynamics: { pressureSize: 0.2 }
      }),
      px('tex-paper', 'Paper Grain', {
        defaultSize: 90, hardness: 0.7, spacing: 0.06, flow: 0.75, grain: { texture: 'grain-rough', scale: 1.4, depth: 1 }, dynamics: { pressureSize: 0.2 }
      }),
      px('tex-concrete', 'Concrete', {
        defaultSize: 100, hardness: 0.7, spacing: 0.06, flow: 0.9, grain: { texture: 'grain-concrete', scale: 1.5, depth: 1 }, dynamics: { pressureSize: 0.15 }
      }),
      px('tex-halftone', 'Halftone Dots', {
        defaultSize: 100, hardness: 0.9, spacing: 0.06, flow: 1, grain: { texture: 'grain-halftone', scale: 0.7, depth: 1, blend: 'subtract' },
        dynamics: { pressureSize: 0.1, pressureOpacity: 0.5 }
      }),
      px('tex-hatch', 'Hatching', {
        defaultSize: 80, hardness: 0.9, spacing: 0.06, flow: 1, grain: { texture: 'grain-hatch', scale: 0.8, depth: 1 }, dynamics: { pressureSize: 0.15 }
      }),
      px('tex-linen', 'Linen', {
        defaultSize: 90, hardness: 0.8, spacing: 0.06, flow: 0.9, grain: { texture: 'grain-linen', scale: 1, depth: 1 }, dynamics: { pressureSize: 0.15 }
      }),
      px('tex-sand', 'Sandstone', {
        defaultSize: 80, hardness: 0.7, spacing: 0.06, flow: 0.9, grain: { texture: 'grain-sand', scale: 1, depth: 1 }, dynamics: { pressureSize: 0.15 }
      }),
      px('tex-wood', 'Wood Grain', {
        defaultSize: 100, hardness: 0.8, spacing: 0.06, flow: 0.9, grain: { texture: 'grain-wood', scale: 1.2, depth: 1 }, dynamics: { pressureSize: 0.15 }
      })
    ]
  },
  {
    id: 'set-charcoals',
    name: 'Charcoals',
    brushes: [
      px('char-stick', 'Charcoal Stick', {
        defaultSize: 36, tipTexture: 'tip-charcoal', spacing: 0.1, flow: 0.8, streamline: 0.1,
        grain: { texture: 'grain-charcoal', scale: 1.2, depth: 0.9 }, dynamics: { pressureSize: 0.3, pressureOpacity: 0.6, angleJitter: 180 }
      }),
      px('char-vine', 'Vine Charcoal', {
        defaultSize: 22, tipTexture: 'tip-charcoal', spacing: 0.08, flow: 0.45, streamline: 0.1,
        grain: { texture: 'grain-paper', scale: 1.2, depth: 0.85 }, dynamics: { pressureSize: 0.3, pressureOpacity: 0.8, angleJitter: 180 }
      }),
      px('char-compressed', 'Compressed', {
        defaultSize: 30, tipTexture: 'tip-chalk', spacing: 0.08, flow: 1, streamline: 0.1,
        grain: { texture: 'grain-charcoal', scale: 1, depth: 0.6 }, dynamics: { pressureSize: 0.25, pressureOpacity: 0.3, angleJitter: 180 }
      }),
      px('chalk', 'Chalk', {
        defaultSize: 40, tipTexture: 'tip-chalk', spacing: 0.14, flow: 0.85, streamline: 0.1,
        grain: { texture: 'grain-canvas', scale: 1.2, depth: 0.7 }, dynamics: { pressureSize: 0.35, pressureOpacity: 0.3, angleJitter: 180, scatter: 0.06 }
      }),
      px('char-pencil', 'Charcoal Pencil', {
        defaultSize: 10, hardness: 0.7, spacing: 0.06, flow: 0.7, streamline: 0.1,
        grain: { texture: 'grain-charcoal', scale: 1, depth: 0.85 }, dynamics: { pressureSize: 0.25, pressureOpacity: 0.7, tiltSize: 1.5, tiltGradation: 0.5 }
      })
    ]
  },
  {
    id: 'set-water',
    name: 'Water',
    brushes: [
      px('watercolor-wet', 'Watercolor Wet', {
        defaultSize: 70, hardness: 0.35, spacing: 0.1, flow: 0.22, opacity: 0.75, wetEdge: 0.75, streamline: 0.35,
        grain: { texture: 'grain-paper', scale: 1.5, depth: 0.5 },
        dynamics: { pressureSize: 0.35, pressureOpacity: 0.4, sizeJitter: 0.05, opacityJitter: 0.2 }
      }),
      px('water-dry', 'Watercolor Dry', {
        defaultSize: 60, hardness: 0.5, spacing: 0.08, flow: 0.3, opacity: 0.8, wetEdge: 0.4, streamline: 0.3,
        grain: { texture: 'grain-watercolor', scale: 1, depth: 0.9 }, dynamics: { pressureSize: 0.3, pressureOpacity: 0.5 }
      }),
      px('water-wash', 'Wash', {
        defaultSize: 160, hardness: 0.2, spacing: 0.08, flow: 0.12, opacity: 0.6, wetEdge: 0.85, streamline: 0.4,
        grain: { texture: 'grain-watercolor', scale: 1.5, depth: 0.35 }, dynamics: { pressureSize: 0.2, pressureOpacity: 0.3 }
      }),
      px('water-bloom', 'Bloom', {
        defaultSize: 80, tipTexture: 'tip-blot', spacing: 0.15, flow: 0.25, opacity: 0.8, wetEdge: 0.9, streamline: 0.25,
        dynamics: { pressureSize: 0.3, angleJitter: 180, opacityJitter: 0.3, sizeJitter: 0.2 }
      }),
      px('water-ink', 'Ink Wash', {
        defaultSize: 50, hardness: 0.4, spacing: 0.07, flow: 0.4, opacity: 0.85, wetEdge: 0.5, streamline: 0.5,
        dynamics: { pressureSize: 0.5, pressureOpacity: 0.5 }, taper: softTaper
      })
    ]
  },
  {
    id: 'set-elements',
    name: 'Elements',
    brushes: [
      px('el-grass', 'Grass', {
        defaultSize: 60, tipTexture: 'tip-grass', spacing: 0.35, flow: 1, streamline: 0.15, shape: { follow: 0, count: 1 },
        dynamics: { pressureSize: 0.2, sizeJitter: 0.35, angleJitter: 25 }, color: { stampJitter: { lightness: 0.15, hue: 0.03 } }
      }),
      px('el-stars', 'Stars', {
        defaultSize: 30, tipTexture: 'tip-star', spacing: 1.4, flow: 1, streamline: 0.1,
        dynamics: { pressureSize: 0.3, angleJitter: 180, sizeJitter: 0.6 }, path: { lateralJitter: 0.5 }
      }),
      px('el-clouds', 'Clouds', {
        defaultSize: 120, tipTexture: 'tip-blot', spacing: 0.25, flow: 0.25, streamline: 0.3,
        dynamics: { pressureSize: 0.2, angleJitter: 180, sizeJitter: 0.35, opacityJitter: 0.3 }, path: { lateralJitter: 0.25 }
      }),
      px('el-rain', 'Rain', {
        defaultSize: 28, hardness: 1, roundness: 0.06, angle: 75, spacing: 1.6, flow: 0.9, streamline: 0.1,
        dynamics: { pressureSize: 0.1, sizeJitter: 0.4, opacityJitter: 0.5 }, path: { lateralJitter: 4, linearJitter: 1 }
      }),
      px('el-foliage', 'Foliage', {
        defaultSize: 50, tipTexture: 'tip-leaf', spacing: 0.4, flow: 1, streamline: 0.15, shape: { count: 3 },
        dynamics: { angleJitter: 180, sizeJitter: 0.5 }, path: { lateralJitter: 0.9 },
        color: { stampJitter: { lightness: 0.2, saturation: 0.2, hue: 0.05 } }
      })
    ]
  },
  {
    id: 'set-spraypaints',
    name: 'Spraypaints',
    brushes: [
      px('spray-can', 'Spray Can', {
        defaultSize: 70, hardness: 0.1, spacing: 0.05, flow: 0.18, streamline: 0.3,
        grain: { texture: 'grain-noise', scale: 0.6, depth: 0.7, moving: true, movement: 0.3 }, dynamics: { pressureSize: 0.1, pressureOpacity: 0.5 }
      }),
      px('spray-fat', 'Fat Cap', {
        defaultSize: 130, hardness: 0.05, spacing: 0.05, flow: 0.2, streamline: 0.3, dynamics: { pressureSize: 0.1, pressureOpacity: 0.5 },
        render: { mode: 'intenseGlaze' }
      }),
      px('spray-splatter', 'Splatter', {
        defaultSize: 100, tipTexture: 'tip-splatter', spacing: 0.5, flow: 1, streamline: 0.1,
        dynamics: { pressureSize: 0.3, angleJitter: 180, sizeJitter: 0.4 }, path: { lateralJitter: 0.3 }
      }),
      px('spray-fine', 'Fine Mist', {
        defaultSize: 50, tipTexture: 'tip-spray', spacing: 0.1, flow: 0.9, streamline: 0.2,
        dynamics: { pressureSize: 0.2, pressureOpacity: 0.4, angleJitter: 180 }
      })
    ]
  },
  {
    id: 'set-abstract',
    name: 'Abstract',
    brushes: [
      px('abs-rainbow', 'Rainbow Stroke', {
        defaultSize: 40, hardness: 0.7, spacing: 0.05, flow: 0.9, streamline: 0.3,
        color: { strokeJitter: { hue: 1 }, pressure: { hue: 0.2 } }, dynamics: { pressureSize: 0.4 }
      }),
      px('abs-confetti', 'Confetti', {
        defaultSize: 24, tipTexture: 'tip-square', spacing: 1.6, flow: 1, streamline: 0.1,
        dynamics: { pressureSize: 0.3, angleJitter: 180, sizeJitter: 0.5 }, path: { lateralJitter: 1.5 },
        color: { stampJitter: { hue: 1, saturation: 0.1, lightness: 0.1 } }
      }),
      px('abs-scatter', 'Color Scatter', {
        defaultSize: 50, tipTexture: 'tip-blot', spacing: 0.4, flow: 0.9, streamline: 0.2,
        dynamics: { pressureSize: 0.3, angleJitter: 180, sizeJitter: 0.4 }, path: { lateralJitter: 0.6 },
        color: { stampJitter: { hue: 0.15, lightness: 0.25, saturation: 0.3 } }
      }),
      px('abs-dual', 'Textured Blob', {
        defaultSize: 70, hardness: 0.85, spacing: 0.08, flow: 0.9, streamline: 0.3,
        dual: { enabled: true, mode: 'multiply', size: 0.8, brush: { id: 'abs-dual-2', name: 'Grain dab', tipTexture: 'tip-sponge', spacing: 0.25, dynamics: { angleJitter: 180, pressureSize: 0 } } },
        dynamics: { pressureSize: 0.4 }
      }),
      px('abs-gradient', 'Two-tone', {
        defaultSize: 60, hardness: 0.8, spacing: 0.05, flow: 0.9, streamline: 0.3,
        color: { pressure: { secondary: 1 } }, dynamics: { pressureSize: 0.3 }
      })
    ]
  },
  {
    id: 'set-vintage',
    name: 'Vintage',
    brushes: [
      px('vin-typewriter', 'Typewriter Ink', {
        defaultSize: 14, tipTexture: 'tip-sponge', spacing: 0.4, flow: 0.9, streamline: 0.1,
        grain: { texture: 'grain-paper', scale: 1, depth: 0.6 }, dynamics: { pressureSize: 0.2, angleJitter: 180, opacityJitter: 0.3 }
      }),
      px('vin-etching', 'Etching Line', {
        defaultSize: 3, hardness: 1, spacing: 0.05, flow: 0.9, streamline: 0.3, dynamics: { pressureSize: 0.4 },
        grain: { texture: 'grain-linen', scale: 0.7, depth: 0.5 }, stab: { motionFiltering: 0.2 }
      }),
      px('vin-litho', 'Lithograph Crayon', {
        defaultSize: 28, tipTexture: 'tip-crayon', spacing: 0.1, flow: 0.9, streamline: 0.1,
        grain: { texture: 'grain-sand', scale: 1, depth: 0.95, blend: 'subtract' }, dynamics: { pressureSize: 0.3, angleJitter: 180 }
      }),
      px('vin-stamp', 'Rubber Stamp', {
        defaultSize: 60, tipTexture: 'tip-sponge', spacing: 0.25, flow: 1, streamline: 0.1,
        grain: { texture: 'grain-rough', scale: 1, depth: 0.7 }, dynamics: { angleJitter: 180 }
      })
    ]
  },
  {
    id: 'set-luminance',
    name: 'Luminance',
    brushes: [
      px('lum-glow', 'Soft Glow', {
        defaultSize: 120, hardness: 0, spacing: 0.06, flow: 0.08, streamline: 0.3, render: { blendMode: 'screen' },
        dynamics: { pressureSize: 0.1, pressureOpacity: 0.6 }
      }),
      px('lum-light', 'Light Beam', {
        defaultSize: 30, hardness: 0.3, spacing: 0.04, flow: 0.3, streamline: 0.5, render: { blendMode: 'add' },
        dynamics: { pressureSize: 0.3, pressureOpacity: 0.4 }, taper: softTaper
      }),
      px('lum-dodge', 'Dodge', {
        defaultSize: 90, hardness: 0.2, spacing: 0.06, flow: 0.15, streamline: 0.3, render: { blendMode: 'colorDodge' },
        dynamics: { pressureSize: 0.1, pressureOpacity: 0.6 }
      }),
      px('lum-burn', 'Burn', {
        defaultSize: 90, hardness: 0.2, spacing: 0.06, flow: 0.15, streamline: 0.3, render: { blendMode: 'multiply' },
        dynamics: { pressureSize: 0.1, pressureOpacity: 0.6 }
      }),
      px('lum-lightness', 'Lightness Only', {
        defaultSize: 70, hardness: 0.3, spacing: 0.06, flow: 0.3, streamline: 0.3, render: { luminance: true },
        dynamics: { pressureSize: 0.1, pressureOpacity: 0.5 }
      })
    ]
  },
  {
    id: 'set-industrial',
    name: 'Industrial',
    brushes: [
      px('ind-rust', 'Rust', {
        defaultSize: 80, tipTexture: 'tip-sponge', spacing: 0.2, flow: 0.6, streamline: 0.1,
        grain: { texture: 'grain-concrete', scale: 1.2, depth: 0.9 }, dynamics: { angleJitter: 180, pressureOpacity: 0.4 },
        color: { stampJitter: { lightness: 0.2, hue: 0.03 } }
      }),
      px('ind-scratch', 'Scratches', {
        defaultSize: 18, tipTexture: 'tip-hair', spacing: 0.1, flow: 0.8, streamline: 0.2, shape: { follow: 1 },
        dynamics: { pressureSize: 0.2, sizeJitter: 0.3 }
      }),
      px('ind-stencil', 'Stencil Spray', {
        defaultSize: 90, hardness: 0.95, spacing: 0.05, flow: 0.4, streamline: 0.3,
        grain: { texture: 'grain-halftone', scale: 0.6, depth: 0.85 }, dynamics: { pressureSize: 0.1 }
      }),
      px('ind-grime', 'Grime', {
        defaultSize: 100, hardness: 0.3, spacing: 0.08, flow: 0.3, streamline: 0.3,
        grain: { texture: 'grain-concrete', scale: 1.6, depth: 1 }, dynamics: { pressureSize: 0.2, pressureOpacity: 0.5 }
      })
    ]
  },
  {
    id: 'set-organic',
    name: 'Organic',
    brushes: [
      px('org-moss', 'Moss', {
        defaultSize: 60, tipTexture: 'tip-sponge', spacing: 0.3, flow: 0.9, streamline: 0.1, shape: { count: 3 },
        path: { lateralJitter: 0.5 }, dynamics: { angleJitter: 180, sizeJitter: 0.4 },
        color: { stampJitter: { lightness: 0.25, hue: 0.06, saturation: 0.2 } }
      }),
      px('org-fur', 'Fur', {
        defaultSize: 40, tipTexture: 'tip-hair', spacing: 0.12, flow: 0.9, streamline: 0.4, shape: { follow: 1 },
        dynamics: { pressureSize: 0.3, sizeJitter: 0.2 }, color: { stampJitter: { lightness: 0.12 } }
      }),
      px('org-bark', 'Bark', {
        defaultSize: 80, hardness: 0.7, spacing: 0.06, flow: 0.95, streamline: 0.3,
        grain: { texture: 'grain-wood', scale: 1.4, depth: 1, blend: 'subtract' }, dynamics: { pressureSize: 0.2 }
      }),
      px('org-bubbles', 'Bubbles', {
        defaultSize: 40, hardness: 0.9, spacing: 1.2, flow: 0.5, streamline: 0.1,
        grain: { texture: 'grain-bubbles', scale: 1, depth: 0.5 }, dynamics: { sizeJitter: 0.7 }, path: { lateralJitter: 1 }
      })
    ]
  },
  {
    id: 'set-retro',
    name: 'Retro',
    brushes: [
      px('ret-halftone', 'Comic Halftone', {
        defaultSize: 80, hardness: 1, spacing: 0.06, flow: 1, streamline: 0.3,
        grain: { texture: 'grain-halftone', scale: 0.5, depth: 1, blend: 'subtract' }, render: { alphaThreshold: 0.5 }, dynamics: { pressureSize: 0.1 }
      }),
      px('ret-pixel', 'Pixel Block', {
        defaultSize: 8, tipTexture: 'tip-square', spacing: 1, flow: 1, streamline: 0, dynamics: { pressureSize: 0 }, render: { alphaThreshold: 0.3 }
      }),
      px('ret-scanline', 'Scanline', {
        defaultSize: 60, hardness: 1, spacing: 0.05, flow: 1, streamline: 0.3,
        grain: { texture: 'grain-hatch', scale: 0.4, depth: 1, blend: 'linearBurn', rotation: 45 }, dynamics: { pressureSize: 0.1 }
      }),
      px('ret-neon', 'Neon Tube', {
        defaultSize: 14, hardness: 0.5, spacing: 0.04, flow: 0.7, streamline: 0.5, render: { burnt: 0, blendMode: 'normal' },
        dynamics: { pressureSize: 0.3 }, dual: { enabled: true, mode: 'lighten', size: 2.4, opacity: 0.35, flow: 0.5, brush: { id: 'ret-neon-2', name: 'Glow', hardness: 0, spacing: 0.06, dynamics: { pressureSize: 0 } } }
      })
    ]
  },
  {
    id: 'set-touchups',
    name: 'Touchups',
    brushes: [
      smudge('smudge-soft', 'Soft Smudge', { defaultSize: 60, hardness: 0.3, spacing: 0.06, smudgeStrength: 0.6, streamline: 0.3, dynamics: { pressureSize: 0, pressureOpacity: 0.7 } }),
      smudge('smudge-bristle', 'Bristle Smudge', {
        defaultSize: 50, tipTexture: 'tip-bristle', spacing: 0.07, smudgeStrength: 0.75, shape: { follow: 1 }, dynamics: { pressureSize: 0.2, pressureOpacity: 0.5 }
      }),
      smudge('smudge-blur', 'Blur', { defaultSize: 70, hardness: 0.2, spacing: 0.05, smudgeStrength: 0.5, wet: { blur: 0.9 }, dynamics: { pressureSize: 0, pressureOpacity: 0.6 } }),
      smudge('smudge-dry', 'Dry Smear', {
        defaultSize: 60, tipTexture: 'tip-dry', spacing: 0.06, smudgeStrength: 0.85, shape: { follow: 1 }, grain: { texture: 'grain-rough', scale: 1, depth: 0.5 }, dynamics: { pressureOpacity: 0.4 }
      }),
      smudge('smudge-finger', 'Finger', { defaultSize: 40, hardness: 0.7, spacing: 0.05, smudgeStrength: 0.9, dynamics: { pressureSize: 0.3, pressureOpacity: 0.3 } }),
      eraser('eraser-hard', 'Hard Eraser', { defaultSize: 30, hardness: 1, spacing: 0.06, streamline: 0.2, dynamics: { pressureSize: 0.5 } }),
      eraser('eraser-soft', 'Soft Eraser', { defaultSize: 60, hardness: 0.1, spacing: 0.07, flow: 0.4, dynamics: { pressureSize: 0.2, pressureOpacity: 0.6 } }),
      eraser('eraser-pencil', 'Pencil Eraser', {
        defaultSize: 14, hardness: 0.85, spacing: 0.06, flow: 0.6, grain: { texture: 'grain-pencil', scale: 1, depth: 0.5 }, dynamics: { pressureSize: 0.2, pressureOpacity: 0.6 }
      }),
      eraser('eraser-chalk', 'Chalk Eraser', {
        defaultSize: 40, tipTexture: 'tip-chalk', spacing: 0.12, flow: 0.8, grain: { texture: 'grain-canvas', scale: 1.2, depth: 0.6 }, dynamics: { pressureSize: 0.3, angleJitter: 180 }
      })
    ]
  }
]
