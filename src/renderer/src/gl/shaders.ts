import { FS_VERT } from './gpu'
import { CLIP_CHUNK } from './clipMask'
export { FS_VERT }

/**
 * Shader sources. All colour data is PREMULTIPLIED alpha, sRGB-encoded values (blending in
 * gamma space like Procreate/Photoshop default). Canvas textures: texel row = document y.
 */

// ---------------------------------------------------------------- stroke application
export const STROKE_CHUNK = `${CLIP_CHUNK}
uniform sampler2D uStroke;
uniform int uStrokeMode;      // 0 none, 1 paint, 2 erase
uniform float uStrokeOpacity; // whole-stroke opacity cap
uniform float uWet;           // wet edge amount
uniform float uAlphaLock;
vec4 applyStroke(vec4 L, vec2 uv){
  if (uStrokeMode == 0) return L;
  vec4 s = texture(uStroke, uv);
  if (s.a <= 0.0) return L;
  if (uWet > 0.0) {
    float a = s.a;
    float a2 = clamp(sqrt(a) * (1.0 - 0.35 * a), 0.0, 1.0);
    s *= mix(a, a2, uWet) / a;
  }
  s *= uStrokeOpacity * selCov(uv);
  if (uStrokeMode == 2) { return uAlphaLock > 0.5 ? L : L * (1.0 - s.a); }
  vec4 r = s + L * (1.0 - s.a);
  if (uAlphaLock > 0.5) { float k = r.a > 1e-6 ? L.a / r.a : 0.0; return vec4(r.rgb * k, L.a); }
  return r;
}
`

// ---------------------------------------------------------------- blend modes (mirror of core/blend.ts)
export const BLEND_CHUNK = `
float lum(vec3 c){ return dot(c, vec3(0.3, 0.59, 0.11)); }
vec3 clipColor(vec3 c){
  float l = lum(c), n = min(min(c.r,c.g),c.b), x = max(max(c.r,c.g),c.b);
  if (n < 0.0) c = l + (c - l) * l / (l - n);
  if (x > 1.0) c = l + (c - l) * (1.0 - l) / (x - l);
  return c;
}
vec3 setLum(vec3 c, float l){ return clipColor(c + (l - lum(c))); }
float sat(vec3 c){ return max(max(c.r,c.g),c.b) - min(min(c.r,c.g),c.b); }
vec3 setSat(vec3 c, float s){
  float mx = max(max(c.r,c.g),c.b), mn = min(min(c.r,c.g),c.b);
  if (mx > mn) return (c - mn) * s / (mx - mn);
  return vec3(0.0);
}
float softL(float cb, float cs){
  if (cs <= 0.5) return cb - (1.0 - 2.0*cs) * cb * (1.0 - cb);
  float d = cb <= 0.25 ? ((16.0*cb - 12.0)*cb + 4.0)*cb : sqrt(cb);
  return cb + (2.0*cs - 1.0) * (d - cb);
}
float hardL(float cb, float cs){ return cs <= 0.5 ? cb * 2.0 * cs : 1.0 - (1.0 - cb) * (1.0 - (2.0*cs - 1.0)); }
float dodge(float cb, float cs){ return cb == 0.0 ? 0.0 : (cs >= 1.0 ? 1.0 : min(1.0, cb / (1.0 - cs))); }
float burn(float cb, float cs){ return cb >= 1.0 ? 1.0 : (cs <= 0.0 ? 0.0 : 1.0 - min(1.0, (1.0 - cb) / cs)); }
vec3 sepF(int m, vec3 b, vec3 s){
  vec3 r;
  for (int i = 0; i < 3; i++) {
    float cb = b[i], cs = s[i], v;
    if (m == 1) v = cb * cs;
    else if (m == 2) v = cb + cs - cb * cs;
    else if (m == 3) v = hardL(cs, cb);
    else if (m == 4) v = softL(cb, cs);
    else if (m == 5) v = hardL(cb, cs);
    else if (m == 6) v = dodge(cb, cs);
    else if (m == 7) v = burn(cb, cs);
    else if (m == 8) v = min(cb, cs);
    else if (m == 9) v = max(cb, cs);
    else if (m == 10) v = abs(cb - cs);
    else if (m == 11) v = cb + cs - 2.0 * cb * cs;
    else v = min(1.0, cb + cs);
    r[i] = v;
  }
  return r;
}
vec3 extF(int m, vec3 b, vec3 s){
  if (m == 18) return lum(b) < lum(s) ? b : s;
  if (m == 19) return lum(b) > lum(s) ? b : s;
  vec3 r;
  for (int i = 0; i < 3; i++) {
    float cb = b[i], cs = s[i], v;
    if (m == 17) v = max(0.0, cb + cs - 1.0);
    else if (m == 20) v = cs <= 0.5 ? burn(cb, 2.0 * cs) : dodge(cb, 2.0 * (cs - 0.5));
    else if (m == 21) v = clamp(cb + 2.0 * cs - 1.0, 0.0, 1.0);
    else if (m == 22) v = cs < 0.5 ? min(cb, 2.0 * cs) : max(cb, 2.0 * (cs - 0.5));
    else if (m == 23) v = cb + cs >= 1.0 ? 1.0 : 0.0;
    else if (m == 24) v = max(0.0, cb - cs);
    else v = cs <= 0.0 ? 1.0 : min(1.0, cb / cs);
    r[i] = v;
  }
  return r;
}
vec3 blendFn(int m, vec3 cb, vec3 cs){
  if (m == 0) return cs;
  if (m <= 12) return sepF(m, cb, cs);
  if (m == 13) return setLum(setSat(cs, sat(cb)), lum(cb));
  if (m == 14) return setLum(setSat(cb, sat(cs)), lum(cb));
  if (m == 15) return setLum(cs, lum(cb));
  if (m == 16) return setLum(cb, lum(cs));
  return extF(m, cb, cs);
}
`

// ---------------------------------------------------------------- layer composite pass
export const COMPOSITE_FS = `#version 300 es
precision highp float;
uniform sampler2D uBack;
uniform sampler2D uSrc;
uniform sampler2D uClip;
uniform float uOpacity;
uniform int uBlend;
uniform float uClipOn;
uniform float uClipMul;
in vec2 vUv;
out vec4 o;
${STROKE_CHUNK}
${BLEND_CHUNK}
void main(){
  vec4 L = applyStroke(texture(uSrc, vUv), vUv);
  vec4 B = texture(uBack, vUv);
  float k = uOpacity;
  if (uClipOn > 0.5) k *= texture(uClip, vUv).a * uClipMul;
  float as = L.a * k;
  if (as <= 0.0) { o = B; return; }
  vec3 cs = L.rgb / L.a;
  if (B.a <= 0.0) { o = vec4(cs * as, as); return; }
  vec3 cb = B.rgb / B.a;
  vec3 bl = blendFn(uBlend, cb, cs);
  vec3 c = as * (1.0 - B.a) * cs + as * B.a * bl + (1.0 - as) * B.rgb;
  o = vec4(c, as + B.a * (1.0 - as));
}`

/** Bakes the stroke buffer into a layer (reads a scratch copy of the layer). */
export const COMMIT_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
in vec2 vUv;
out vec4 o;
${STROKE_CHUNK}
uniform float uDither; // 1 when the target layer is 8-bit: dither the baked stroke so soft gradients do not band
uniform vec2 uOrigin;  // doc-space origin of the target tile (0 on fixed documents): the dither pattern is global
void main(){
  vec4 src = texture(uSrc, vUv);
  o = applyStroke(src, vUv);
  if (uDither > 0.5 && o.a > 0.0 && o.a < 0.995 && any(notEqual(o, src))) {
    vec2 fc = gl_FragCoord.xy + uOrigin;
    float n = fract(52.9829189 * fract(dot(fc, vec2(0.06711056, 0.00583715)))) - 0.5;
    n += fract(sin(dot(fc, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
    o += o / o.a * (n / 255.0);
    o = clamp(o, 0.0, 1.0);
  }
}`

// ---------------------------------------------------------------- brush dabs
export const DAB_VS = `#version 300 es
precision highp float;
in vec4 aA; // x, y, size, angle
in vec4 aB; // alpha, roundness, prevX, prevY
uniform vec2 uCanvas;
out vec2 vLocal;
out float vRad;
out float vAlpha;
out float vRho;
out vec2 vWorld;
out vec2 vDelta;
void main(){
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1)) * 2.0 - 1.0;
  float R = aA.z * 0.5;
  float rho = aB.y;
  vec2 local = vec2(c.x * (R + 1.5), c.y * (R * rho + 1.5));
  float ca = cos(aA.w), sa = sin(aA.w);
  vec2 w = aA.xy + vec2(ca * local.x - sa * local.y, sa * local.x + ca * local.y);
  vLocal = local; vRad = R; vAlpha = aB.x; vRho = rho; vWorld = w; vDelta = aB.zw - aA.xy;
  gl_Position = vec4(w / uCanvas * 2.0 - 1.0, 0.0, 1.0);
}`

export const DAB_FS = `#version 300 es
precision highp float;
uniform int uMode;            // 0 paint into stroke buffer, 1 smudge into layer
uniform vec3 uColor;
uniform float uHardness;
uniform vec2 uCanvas;
uniform int uHasTip;
uniform sampler2D uTip;
uniform int uHasGrain;
uniform sampler2D uGrain;
uniform vec4 uGrainP;         // scale, depth, moving, texSize
uniform sampler2D uSrc;       // smudge: scratch copy of layer
uniform float uStrength;
${CLIP_CHUNK}
in vec2 vLocal;
in float vRad;
in float vAlpha;
in float vRho;
in vec2 vWorld;
in vec2 vDelta;
out vec4 o;
void main(){
  vec2 q = vec2(vLocal.x, vLocal.y / vRho);
  float a;
  if (uHasTip == 1) {
    vec2 uv = q / vRad * 0.5 + 0.5;
    a = texture(uTip, uv).r;
    // gentle window so nothing leaks at quad borders
    a *= 1.0 - smoothstep(vRad * 0.94, vRad * 1.02, length(q));
  } else {
    float w = max(vRad * (1.0 - uHardness), 1.0);
    float t = clamp((vRad + 0.5 - length(q)) / w, 0.0, 1.0);
    a = t * t * (3.0 - 2.0 * t);
  }
  a *= min(1.0, 4.0 * vRad * vRad);
  if (uHasGrain == 1) {
    vec2 gp = uGrainP.z > 0.5 ? (q / (uGrainP.x * uGrainP.w) + 0.5) : vWorld / (uGrainP.x * uGrainP.w);
    a *= mix(1.0, texture(uGrain, gp).r, uGrainP.y);
  }
  a *= vAlpha;
  if (uMode == 0) { o = vec4(uColor * a, a); return; }
  vec4 here = texelFetch(uSrc, ivec2(gl_FragCoord.xy), 0);
  vec4 s = texture(uSrc, (vWorld + vDelta) / uCanvas);
  o = mix(here, s, clamp(a * uStrength * selCov(vWorld / uCanvas), 0.0, 1.0));
}`

// ---------------------------------------------------------------- display
export const DISPLAY_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uDoc;
uniform vec2 uCenter;
uniform vec2 uHalf;
uniform float uZoom;   // device px per doc px
uniform vec2 uRot;     // cos, sin
uniform float uMirror; // 1, or -1 when the view is mirrored
uniform float uH;
uniform vec3 uPaper;
uniform float uPaperOn;
in vec2 vUv;
out vec4 o;
vec4 sampleDoc(vec2 p){
  vec2 c = p - 0.5;
  if (uZoom > 1.0) {
    vec2 n = floor(c);
    vec2 f = c - n;
    vec2 g = clamp((f - 0.5) * uZoom + 0.5, 0.0, 1.0);
    return texture(uTex, (n + 0.5 + g) / uDoc);
  }
  return texture(uTex, p / uDoc);
}
void main(){
  vec2 d = vec2((gl_FragCoord.x - uHalf.x) * uMirror, (uH - gl_FragCoord.y) - uHalf.y);
  vec2 p = uCenter + vec2(uRot.x * d.x + uRot.y * d.y, -uRot.y * d.x + uRot.x * d.y) / uZoom;
  vec3 ws = vec3(0.105, 0.105, 0.115);
  if (p.x < 0.0 || p.y < 0.0 || p.x >= uDoc.x || p.y >= uDoc.y) {
    // soft drop shadow
    vec2 e = max(max(-p, p - uDoc), 0.0) * uZoom;
    float sh = exp(-length(e) / 14.0) * 0.35;
    o = vec4(ws * (1.0 - sh), 1.0);
    return;
  }
  vec4 t;
  if (uZoom < 1.0) {
    int n = int(clamp(ceil(1.0 / uZoom), 1.0, 6.0));
    vec4 acc = vec4(0.0);
    for (int j = 0; j < 6; j++) {
      if (j >= n) break;
      for (int i = 0; i < 6; i++) {
        if (i >= n) break;
        vec2 off = ((vec2(float(i), float(j)) + 0.5) / float(n) - 0.5) / uZoom;
        acc += texture(uTex, (p + off) / uDoc);
      }
    }
    t = acc / float(n * n);
  } else t = sampleDoc(p);
  vec3 bg;
  if (uPaperOn > 0.5) bg = uPaper;
  else { vec2 cell = floor(gl_FragCoord.xy / 10.0); bg = vec3(mod(cell.x + cell.y, 2.0) < 1.0 ? 0.86 : 0.72); }
  vec3 col = t.rgb + bg * (1.0 - t.a);
  float dith = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  col += (dith - 0.5) / 255.0;
  o = vec4(col, 1.0);
}`

// ---------------------------------------------------------------- misc
/** Generic 1-input filter: `vec4 filterPixel(vec4 premult, vec2 uv)` is supplied by the filter. */
export const filterFragment = (body: string): string => `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uCanvas;
in vec2 vUv;
out vec4 o;
${CLIP_CHUNK}
${body}
void main(){ vec4 s = texture(uSrc, vUv); o = mix(s, filterPixel(s, vUv), selCov(vUv)); }`
