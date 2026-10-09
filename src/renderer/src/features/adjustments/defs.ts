import type { FX } from '../../gl/filters'
import { bakeCurveLut, bakeGradientLut, unpackColor } from './math'
import type { AdjDef, ParamDef, Params } from './types'
import { liquifyDef } from './liquify'
import { cloneDef } from './clone'

const pct = (key: string, label: string, def: number, extra: Partial<ParamDef> = {}): ParamDef => ({ key, label, min: 0, max: 100, def, unit: '%', ...extra })
const bal = (key: string, label: string, show: (p: Params) => boolean): ParamDef => ({ key, label, min: -100, max: 100, def: 0, unit: '%', show })
const sel = (key: string, label: string, options: string[], def = 0, show?: (p: Params) => boolean): ParamDef => ({ key, label, min: 0, max: options.length - 1, def, kind: 'select', options, show })
const tog = (key: string, label: string, def: number, show?: (p: Params) => boolean): ParamDef => ({ key, label, min: 0, max: 1, def, kind: 'toggle', show })
const angle = (key: string, label: string, def: number): ParamDef => ({ key, label, min: 0, max: 360, def, unit: '°', step: 1 })
const colorParam = (key: string, label: string, def: number): ParamDef => ({ key, label, min: 0, max: 0xffffff, def, kind: 'color' })
const num = (key: string, label: string, min: number, max: number, def: number, show?: (p: Params) => boolean): ParamDef => ({ key, label, min, max, def, step: 1, unit: '', show })
const point = (key: string, key2: string, label: string): ParamDef => ({ key, key2, label, min: 0, max: 1, def: 0.5, kind: 'point' })

const rad = (deg: number): number => (deg * Math.PI) / 180
/** Blur radius in px for a 0..100 slider on a canvas whose longest side is `md`. */
export const blurSigma = (v: number, md: number): number => (v / 100) * 0.05 * md + (v > 0 ? 0.3 : 0)

// ------------------------------------------------------------------------------------------ colour
const hsb: AdjDef = {
  id: 'hsb',
  local: true,
  name: 'Hue, Saturation, Brightness',
  params: [pct('hue', 'Hue', 50), pct('sat', 'Saturation', 50), pct('bri', 'Brightness', 50)],
  main: 'hue',
  render(fx, src, dst, p) {
    fx.pass(
      'hsb',
      `uniform vec3 uHSB;
       vec4 fx(){ vec4 c = texture(uT0, vUv); vec3 rgb = unp(c); vec3 h = rgb2hsv(rgb);
         h.x = fract(h.x + (uHSB.x - 50.0) / 100.0); h.y = clamp(h.y * uHSB.y / 50.0, 0.0, 1.0); rgb = hsv2rgb(h);
         float t = (uHSB.z - 50.0) / 50.0; rgb = t >= 0.0 ? 1.0 - (1.0 - rgb) * (1.0 - t) : rgb * (1.0 + t);
         return pre(clamp(rgb, 0.0, 1.0), c.a); }`,
      dst,
      { tex: [src], u: { uHSB: [p.hue, p.sat, p.bri] } }
    )
  }
}

const isR = (n: number) => (p: Params) => p.range === n
const colorBalance: AdjDef = {
  id: 'colorBalance',
  local: true,
  name: 'Color Balance',
  params: [
    sel('range', 'Range', ['Shadows', 'Midtones', 'Highlights'], 1),
    bal('shCR', 'Cyan - Red', isR(0)),
    bal('shMG', 'Magenta - Green', isR(0)),
    bal('shYB', 'Yellow - Blue', isR(0)),
    bal('miCR', 'Cyan - Red', isR(1)),
    bal('miMG', 'Magenta - Green', isR(1)),
    bal('miYB', 'Yellow - Blue', isR(1)),
    bal('hiCR', 'Cyan - Red', isR(2)),
    bal('hiMG', 'Magenta - Green', isR(2)),
    bal('hiYB', 'Yellow - Blue', isR(2)),
    tog('preserve', 'Preserve luminosity', 1)
  ],
  main: 'miCR',
  render(fx, src, dst, p) {
    fx.pass(
      'balance',
      `uniform vec3 uSh; uniform vec3 uMi; uniform vec3 uHi; uniform float uPres;
       vec4 fx(){ vec4 c = texture(uT0, vUv); vec3 rgb = unp(c); float l = lum(rgb);
         float ws = clamp(1.0 - 2.0 * l, 0.0, 1.0), wh = clamp(2.0 * l - 1.0, 0.0, 1.0), wm = 1.0 - ws - wh;
         vec3 o2 = rgb + (ws * uSh + wm * uMi + wh * uHi) / 100.0 * 0.4;
         if (uPres > 0.5) o2 += l - lum(o2);
         return pre(clamp(o2, 0.0, 1.0), c.a); }`,
      dst,
      { tex: [src], u: { uSh: [p.shCR, p.shMG, p.shYB], uMi: [p.miCR, p.miMG, p.miYB], uHi: [p.hiCR, p.hiMG, p.hiYB], uPres: p.preserve } }
    )
  }
}

const curves: AdjDef = {
  id: 'curves',
  local: true,
  name: 'Curves',
  params: [],
  custom: 'curves',
  noDrag: true,
  render(fx, src, dst, _p, x) {
    const lut = fx.lut('curves', bakeCurveLut(x.curves))
    fx.pass(
      'curves',
      `vec4 L(vec3 v){ return vec4(texture(uT1, vec2((v.r * 255.0 + 0.5) / 256.0, 0.5)).r, texture(uT1, vec2((v.g * 255.0 + 0.5) / 256.0, 0.5)).g, texture(uT1, vec2((v.b * 255.0 + 0.5) / 256.0, 0.5)).b, 1.0); }
       vec4 fx(){ vec4 c = texture(uT0, vUv); vec3 rgb = clamp(unp(c), 0.0, 1.0); return pre(L(rgb).rgb, c.a); }`,
      dst,
      { tex: [src, lut] }
    )
  }
}

const gradientMap: AdjDef = {
  id: 'gradientMap',
  local: true,
  name: 'Gradient Map',
  params: [pct('amount', 'Intensity', 100)],
  main: 'amount',
  custom: 'gradient',
  render(fx, src, dst, p, x) {
    const lut = fx.lut('gradient', bakeGradientLut(x.stops))
    fx.pass(
      'gradmap',
      `uniform float uAmt;
       vec4 fx(){ vec4 c = texture(uT0, vUv); vec3 rgb = unp(c); float l = clamp(lum(rgb), 0.0, 1.0);
         vec3 g = texture(uT1, vec2((l * 255.0 + 0.5) / 256.0, 0.5)).rgb; return pre(mix(rgb, g, uAmt), c.a); }`,
      dst,
      { tex: [src, lut], u: { uAmt: p.amount / 100 } }
    )
  }
}

const recolor: AdjDef = {
  id: 'recolor',
  local: true,
  name: 'Recolor',
  params: [pct('amount', 'Intensity', 100), colorParam('color', 'Color', 0xe8412c)],
  main: 'amount',
  render(fx, src, dst, p) {
    fx.pass(
      'recolor',
      `uniform vec3 uColor; uniform float uAmt;
       vec3 clipC(vec3 c){ float l = lum(c), n = min(min(c.r,c.g),c.b), x = max(max(c.r,c.g),c.b);
         if (n < 0.0) c = l + (c - l) * l / (l - n); if (x > 1.0) c = l + (c - l) * (1.0 - l) / (x - l); return c; }
       vec4 fx(){ vec4 c = texture(uT0, vUv); vec3 rgb = unp(c);
         vec3 r = clipC(uColor + (lum(rgb) - lum(uColor)));
         return pre(mix(rgb, clamp(r, 0.0, 1.0), uAmt), c.a); }`,
      dst,
      { tex: [src], u: { uColor: unpackColor(p.color), uAmt: p.amount / 100 } }
    )
  }
}

// ------------------------------------------------------------------------------------------ blurs
const gaussian: AdjDef = {
  id: 'gaussian',
  pad: 0.16,
  name: 'Gaussian Blur',
  params: [pct('radius', 'Radius', 20)],
  main: 'radius',
  render(fx, src, dst, p) {
    fx.blur(src, dst, blurSigma(p.radius, fx.maxDim))
  }
}

const MOTION_BODY = `uniform vec2 uDir; uniform float uN; uniform float uBack;
  vec4 fx(){ vec4 acc = vec4(0.0); float n = 0.0;
    for (int i = 0; i < 128; i++) { if (float(i) >= uN) break; float t = (float(i) + 0.5) / uN; t = uBack > 0.5 ? -t : t - 0.5;
      acc += texture(uT0, vUv + uDir * t); n += 1.0; }
    return acc / max(n, 1.0); }`

const motion: AdjDef = {
  id: 'motion',
  pad: 0.07,
  name: 'Motion Blur',
  params: [pct('amount', 'Amount', 30), angle('angle', 'Direction', 0), tog('back', 'Backward only', 0)],
  main: 'amount',
  render(fx, src, dst, p) {
    const len = (p.amount / 100) * 0.12 * fx.maxDim
    if (len < 0.4) return fx.gpu.blit(src, { x: 0, y: 0, w: src.w, h: src.h }, dst, 0, 0)
    const a = rad(p.angle)
    fx.pass('motion', MOTION_BODY, dst, { tex: [src], u: { uDir: [(Math.cos(a) * len) / fx.w, (Math.sin(a) * len) / fx.h], uN: Math.min(128, Math.max(4, Math.ceil(len))), uBack: p.back } })
  }
}

const perspective: AdjDef = {
  id: 'perspective',
  name: 'Perspective Blur',
  params: [pct('amount', 'Amount', 40), sel('mode', 'Type', ['Positional', 'Directional']), angle('angle', 'Direction', 0), point('px', 'py', 'Focal point')],
  main: 'amount',
  render(fx, src, dst, p) {
    const a = rad(p.angle)
    fx.pass(
      'perspective',
      `uniform float uMode; uniform float uAmt; uniform vec2 uCenter; uniform vec2 uDir;
       vec4 fx(){ vec2 v = vUv - uCenter; float dist = length(v * uCanvas) / length(uCanvas) * 2.0; vec4 acc = vec4(0.0);
         vec2 d = uMode < 0.5 ? -v * uAmt * 0.4 : uDir * uAmt * 0.16 * (0.08 + dist) / uCanvas * max(uCanvas.x, uCanvas.y);
         for (int i = 0; i < 64; i++) { float t = (float(i) + 0.5) / 64.0; acc += texture(uT0, vUv + d * (uMode < 0.5 ? t : t - 0.5)); }
         return acc / 64.0; }`,
      dst,
      { tex: [src], u: { uMode: p.mode, uAmt: p.amount / 100, uCenter: [p.px, p.py], uDir: [Math.cos(a), Math.sin(a)] } }
    )
  }
}

// ------------------------------------------------------------------------------------------ noise / sharpen / bloom
const noise: AdjDef = {
  id: 'noise',
  name: 'Noise',
  params: [
    pct('amount', 'Amount', 40),
    sel('type', 'Type', ['Clouds', 'Billows', 'Ridges', 'Grain']),
    pct('scale', 'Scale', 30, { show: (p) => p.type < 3 }),
    num('octaves', 'Octaves', 1, 8, 4, (p) => p.type < 3),
    pct('turb', 'Turbulence', 20, { show: (p) => p.type < 3 }),
    tog('mono', 'Monochrome', 1),
    pct('seed', 'Seed', 10)
  ],
  main: 'amount',
  render(fx, src, dst, p) {
    fx.pass(
      'noise',
      `uniform float uType, uScale, uOct, uTurb, uAmt, uMono, uSeed;
       float fbm(vec2 q){
         vec2 w = uTurb * vec2(pnoise(q * 0.6 + uSeed), pnoise(q * 0.6 + 9.1 + uSeed));
         q += w * 2.0; float a = 0.5, n = 0.0, tot = 0.0;
         for (int i = 0; i < 8; i++) { if (float(i) >= uOct) break; float v = pnoise(q + uSeed * 3.7);
           if (uType < 0.5) n += a * v; else if (uType < 1.5) n += a * (abs(v) * 2.0 - 0.6); else n += a * (0.6 - abs(v) * 2.0);
           tot += a; q = q * 2.03 + 11.7; a *= 0.5; }
         n /= tot; return clamp(n * 0.8 + 0.5, 0.0, 1.0); }
       float grain(vec2 fc, float k){ return hash21(fc + k + uSeed * 91.0); }
       vec4 fx(){ vec4 c = texture(uT0, vUv); vec3 rgb = unp(c); vec2 px = vUv * uCanvas; vec3 n;
         if (uType > 2.5) { n = vec3(grain(floor(px), 0.0)); if (uMono < 0.5) n = vec3(n.x, grain(floor(px), 17.0), grain(floor(px), 31.0)); }
         else { vec2 q = px / uScale; n = vec3(fbm(q)); if (uMono < 0.5) n = vec3(n.x, fbm(q + 31.7), fbm(q + 77.3)); }
         rgb = clamp(rgb + (n - 0.5) * 2.0 * uAmt * 0.8, 0.0, 1.0); return pre(rgb, c.a); }`,
      dst,
      { tex: [src], u: { uType: p.type, uScale: 6 + (p.scale / 100) * (p.scale / 100) * 0.4 * fx.maxDim, uOct: p.octaves, uTurb: p.turb / 100, uAmt: p.amount / 100, uMono: p.mono, uSeed: p.seed } }
    )
  }
}

const sharpen: AdjDef = {
  id: 'sharpen',
  pad: 0.03,
  name: 'Sharpen',
  params: [pct('amount', 'Amount', 40), pct('radius', 'Radius', 15)],
  main: 'amount',
  render(fx, src, dst, p) {
    const b = fx.tmp()
    fx.blur(src, b, 0.6 + (p.radius / 100) * 0.006 * fx.maxDim)
    fx.pass(
      'sharpen',
      `uniform float uK;
       vec4 fx(){ vec4 c = texture(uT0, vUv), b = texture(uT1, vUv); vec4 r = c + (c - b) * uK; r.a = clamp(r.a, 0.0, 1.0); r.rgb = clamp(r.rgb, 0.0, r.a); return r; }`,
      dst,
      { tex: [src, b], u: { uK: (p.amount / 100) * 4 } }
    )
    fx.free(b)
  }
}

const bloom: AdjDef = {
  id: 'bloom',
  pad: 0.2,
  name: 'Bloom',
  params: [pct('transition', 'Transition', 50), pct('size', 'Size', 30), pct('opacity', 'Opacity', 60), pct('burn', 'Burn', 20)],
  main: 'opacity',
  render(fx, src, dst, p) {
    const a = fx.tmp()
    const b = fx.tmp()
    fx.pass(
      'bloomBright',
      `uniform float uThr;
       vec4 fx(){ vec4 c = texture(uT0, vUv); float l = lum(unp(c)); return c * smoothstep(uThr - 0.12, uThr + 0.18, l); }`,
      a,
      { tex: [src], u: { uThr: 1 - (p.transition / 100) * 0.95 } }
    )
    fx.blur(a, b, 1 + (p.size / 100) * 0.06 * fx.maxDim)
    fx.pass(
      'bloomMix',
      `uniform float uOp, uBurn;
       vec4 fx(){ vec4 c = texture(uT0, vUv), g = texture(uT1, vUv); g *= uOp * 2.0 * (1.0 + uBurn * 3.0); g = clamp(g, 0.0, 1.0);
         vec4 r = c + g - c * g; return r; }`,
      dst,
      { tex: [src, b], u: { uOp: p.opacity / 100, uBurn: p.burn / 100 } }
    )
    fx.free(a, b)
  }
}

// ------------------------------------------------------------------------------------------ glitch
const GLITCH_MODES = ['Artifact', 'Wave', 'Displace', 'Signal', 'Tear', 'Diverge']
const glitch: AdjDef = {
  id: 'glitch',
  name: 'Glitch',
  params: [
    sel('type', 'Type', GLITCH_MODES),
    pct('amount', 'Amount', 50),
    pct('distance', 'Distance', 40),
    pct('offset', 'Offset', 30, { show: (p) => p.type === 2 || p.type === 3 || p.type === 4 }),
    pct('transition', 'Transition', 50, { show: (p) => p.type === 4 || p.type === 5 })
  ],
  main: 'amount',
  render(fx, src, dst, p) {
    fx.pass(
      'glitch',
      `uniform float uMode, uAmt, uDist, uOff, uTrans;
       vec4 S(vec2 px){ return texture(uT0, px / uCanvas); }
       vec4 split(vec2 px, vec2 d, float f){ vec4 a = S(px + d * (1.0 + f)), b = S(px + d), c = S(px + d * (1.0 - f)); return vec4(a.r, b.g, c.b, max(a.a, max(b.a, c.a))); }
       vec4 fx(){
         vec2 p = vUv * uCanvas; float md = max(uCanvas.x, uCanvas.y); float A = uAmt, D = uDist, O = uOff;
         vec4 c = S(p); int m = int(uMode + 0.5);
         if (m == 0) {
           float bs = mix(6.0, 90.0, D); vec2 cell = floor(p / bs); float r = hash21(cell + O * 97.0 + 3.0);
           if (r < A * 0.7) {
             vec2 off = (hash22(cell + 3.7) - 0.5) * bs * 3.0; c = S(p + off);
             if (hash21(cell + 9.1) < 0.5) c = S((cell + 0.5) * bs);
             float lv = mix(14.0, 3.0, A); vec3 u = unp(c); u = floor(u * lv + 0.5) / lv; c = pre(u, c.a);
             float sh = bs * 0.4 * hash21(cell + 5.5); c = split(p, vec2(sh * A, 0.0), 0.5) * 0.35 + c * 0.65;
           }
           return c;
         } else if (m == 1) {
           float wl = mix(20.0, 260.0, 1.0 - D * 0.85); float amp = A * (0.004 + D * 0.05) * md;
           float dx = amp * sin(p.y * 6.2832 / wl + O * 6.2832) + amp * 0.35 * sin(p.y * 6.2832 / (wl * 0.31) + O * 12.0);
           return split(p, vec2(dx, 0.0), 0.35 * A);
         } else if (m == 2) {
           float strip = floor(p.y / (3.0 + D * 70.0)); float r = hash11(strip * 1.7 + O * 211.0);
           if (r < A * 0.55) { float dx = (hash11(strip + 5.0) - 0.5) * 2.0 * (0.02 + D * 0.25) * md; return split(p, vec2(dx, 0.0), 0.15); }
           return c;
         } else if (m == 3) {
           float band = floor(p.y / 6.0); float on = step(0.86 - A * 0.4, hash11(band + floor(O * 50.0) * 3.1));
           float jit = (hash11(band * 1.3 + O * 40.0) - 0.5) * 2.0 * A * D * 0.06 * md * on;
           vec4 s = split(p, vec2(jit, 0.0), 0.0); vec4 cr = S(p + vec2(jit + A * D * 0.012 * md, 0.0)), cb = S(p + vec2(jit - A * D * 0.012 * md, 0.0));
           s = vec4(cr.r, s.g, cb.b, max(s.a, max(cr.a, cb.a)));
           s.rgb *= 1.0 - A * 0.35 * (0.5 + 0.5 * sin(p.y * 3.14159));
           s.rgb += s.a * (hash21(floor(p) + O * 57.0) - 0.5) * A * 0.25 * (0.3 + on);
           s.rgb = clamp(s.rgb, 0.0, s.a); return s;
         } else if (m == 4) {
           float dx = 0.0;
           for (int k = 0; k < 4; k++) { float fk = float(k); float cy = hash11(fk * 7.13 + O * 31.7); float hgt = 0.01 + D * 0.12;
             float w = 1.0 - smoothstep(hgt * (1.0 - uTrans), hgt * (1.0 + uTrans) + 1e-4, abs(vUv.y - cy));
             float on = step(hash11(fk + O * 13.0 + 2.0), A + 0.2); dx += w * on * (hash11(fk * 3.0 + O * 5.0) - 0.5) * 2.0 * (0.03 + D * 0.3) * md * A; }
           return split(p, vec2(dx, 0.0), 0.1);
         }
         float w = mix(1.0, abs(vUv.y - 0.5) * 2.0, uTrans); float sh = A * D * 0.09 * md * w;
         vec4 cr = S(p + vec2(sh, sh * 0.15)), cg = c, cb = S(p - vec2(sh, sh * 0.15));
         return vec4(cr.r, cg.g, cb.b, max(cr.a, max(cg.a, cb.a)));
       }`,
      dst,
      { tex: [src], u: { uMode: p.type, uAmt: p.amount / 100, uDist: p.distance / 100, uOff: p.offset / 100, uTrans: p.transition / 100 } }
    )
  }
}

// ------------------------------------------------------------------------------------------ halftone
const halftone: AdjDef = {
  id: 'halftone',
  name: 'Halftone',
  params: [
    sel('type', 'Type', ['Full Color', 'Screen Print', 'Newspaper']),
    sel('pattern', 'Pattern', ['Dot', 'Line', 'Cross']),
    pct('size', 'Size', 35),
    pct('amount', 'Amount', 100),
    angle('angle', 'Screen angle', 0)
  ],
  main: 'size',
  render(fx, src, dst, p) {
    fx.pass(
      'halftone',
      `uniform float uType, uPat, uCell, uAng, uAmt;
       vec2 rot(vec2 v, float a){ float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
       float pat(vec2 f, float ink){
         vec2 d = f - 0.5; float e = 0.9 / uCell; ink = clamp(ink, 0.0, 1.0);
         if (uPat < 0.5) { float r = sqrt(ink / 3.14159) * 1.05; return 1.0 - smoothstep(r - e, r + e, length(d)); }
         if (uPat < 1.5) { float hw = ink * 0.5; return 1.0 - smoothstep(hw - e, hw + e, abs(d.y)); }
         float hw = ink * 0.36; return 1.0 - smoothstep(hw - e, hw + e, min(abs(d.x), abs(d.y)));
       }
       vec3 onPaper(vec2 world){ vec4 c = texture(uT0, world / uCanvas); return c.rgb + (1.0 - c.a); }
       // ink coverage of one screen: returns coverage, outputs cell colour
       float screen(vec2 p, float ang, int chan, out vec3 cellCol){
         vec2 q = rot(p, -ang) / uCell; vec2 cell = floor(q); vec2 f = fract(q);
         vec2 world = rot((cell + 0.5) * uCell, ang); vec3 col = onPaper(world); cellCol = col;
         float ink;
         if (chan == 0) { float k = 1.0 - max(col.r, max(col.g, col.b)); ink = (1.0 - col.r - k) / max(1.0 - k, 1e-3); }
         else if (chan == 1) { float k = 1.0 - max(col.r, max(col.g, col.b)); ink = (1.0 - col.g - k) / max(1.0 - k, 1e-3); }
         else if (chan == 2) { float k = 1.0 - max(col.r, max(col.g, col.b)); ink = (1.0 - col.b - k) / max(1.0 - k, 1e-3); }
         else if (chan == 3) ink = 1.0 - max(col.r, max(col.g, col.b));
         else ink = 1.0 - lum(col);
         return pat(f, ink);
       }
       vec4 fx(){
         vec4 c0 = texture(uT0, vUv); vec2 p = vUv * uCanvas; vec3 res; vec3 cc;
         if (uType < 0.5) {
           float C = screen(p, uAng + 0.2618, 0, cc), M = screen(p, uAng + 1.309, 1, cc), Y = screen(p, uAng, 2, cc), K = screen(p, uAng + 0.7854, 3, cc);
           res = vec3((1.0 - C * 0.95) * (1.0 - K * 0.9), (1.0 - M * 0.95) * (1.0 - K * 0.9), (1.0 - Y * 0.95) * (1.0 - K * 0.9));
           // colour inks: recompute channel ink so cyan removes red etc. (C,M,Y coverage already derived from r,g,b)
         } else if (uType < 1.5) {
           float cov = screen(p, uAng + 0.7854, 4, cc); vec3 col = clamp((cc - lum(cc)) * 1.35 + lum(cc), 0.0, 1.0);
           res = mix(vec3(0.97), col * 0.85, cov);
         } else {
           float cov = screen(p, uAng + 0.7854, 4, cc); res = mix(vec3(0.97), vec3(0.06), cov);
         }
         vec3 orig = unp(c0); return pre(mix(orig, clamp(res, 0.0, 1.0), uAmt), c0.a);
       }`,
      dst,
      { tex: [src], u: { uType: p.type, uPat: p.pattern, uCell: 3 + (p.size / 100) * 45, uAng: rad(p.angle), uAmt: p.amount / 100 } }
    )
  }
}

// ------------------------------------------------------------------------------------------ chromatic aberration
const chromatic: AdjDef = {
  id: 'chromatic',
  name: 'Chromatic Aberration',
  params: [pct('amount', 'Amount', 50), sel('mode', 'Type', ['Perspective', 'Displace']), pct('distance', 'Distance', 50), pct('transition', 'Transition', 50, { show: (p) => p.mode === 0 }), angle('angle', 'Direction', 0), point('px', 'py', 'Focal point')],
  main: 'amount',
  render(fx, src, dst, p) {
    const a = rad(p.angle)
    fx.pass(
      'chromatic',
      `uniform float uMode, uAmt, uDist, uTrans; uniform vec2 uCenter; uniform vec2 uDir;
       vec4 fx(){
         vec2 v = vUv - uCenter; vec2 off;
         if (uMode < 0.5) { float d = length(v * uCanvas) / (0.5 * length(uCanvas)); float fall = pow(clamp(d, 0.0, 1.5), mix(0.3, 3.0, uTrans)); off = v * uAmt * uDist * 0.3 * fall; }
         else off = uDir * (uAmt * uDist * 0.04 * max(uCanvas.x, uCanvas.y)) / uCanvas;
         vec4 cr = texture(uT0, vUv + off), cg = texture(uT0, vUv), cb = texture(uT0, vUv - off);
         return vec4(cr.r, cg.g, cb.b, max(cr.a, max(cg.a, cb.a)));
       }`,
      dst,
      { tex: [src], u: { uMode: p.mode, uAmt: p.amount / 100, uDist: p.distance / 100, uTrans: p.transition / 100, uCenter: [p.px, p.py], uDir: [Math.cos(a), Math.sin(a)] } }
    )
  }
}

export const ADJUSTMENTS: AdjDef[] = [hsb, colorBalance, curves, gradientMap, recolor, gaussian, motion, perspective, noise, sharpen, bloom, glitch, halftone, chromatic, liquifyDef, cloneDef]
export const getAdjustment = (id: string): AdjDef | undefined => ADJUSTMENTS.find((a) => a.id === id)

/** Default numeric parameter values for a definition. */
export function defaultParams(def: AdjDef): Params {
  const p: Params = {}
  for (const d of def.params) {
    p[d.key] = d.def
    if (d.key2) p[d.key2] = d.def
  }
  return p
}

