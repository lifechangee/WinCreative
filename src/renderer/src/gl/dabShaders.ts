import { CLIP_CHUNK } from './clipMask'
import { BLEND_CHUNK } from './shaders'

/** Shaders of the brush engine: dab stamping (paint / smudge / wet mix), stroke finalising, direct blend commit. */

export const DAB_VS = `#version 300 es
precision highp float;
in vec4 aA; // x, y, size, angle
in vec4 aB; // alpha, roundness, prevX, prevY
in vec4 aC; // r, g, b, flags
in vec4 aD; // grainDepth, grainX, grainY, soft
in vec4 aE; // dilution, blur, grainScaleMul, unused
uniform vec2 uCanvas;
out vec2 vLocal;
out float vRad;
out float vAlpha;
out float vRho;
out vec2 vWorld;
out vec2 vDelta;
out vec3 vColor;
out float vFlags;
out vec4 vD;
out vec3 vE;
out vec2 vCenter;
void main(){
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1)) * 2.0 - 1.0;
  float R = aA.z * 0.5;
  float rho = aB.y;
  float m = 1.5;
  vec2 local = vec2(c.x * (R + m), c.y * (R * rho + m));
  float ca = cos(aA.w), sa = sin(aA.w);
  vec2 w = aA.xy + vec2(ca * local.x - sa * local.y, sa * local.x + ca * local.y);
  vLocal = local; vRad = R; vAlpha = aB.x; vRho = rho; vWorld = w; vDelta = aB.zw - aA.xy;
  vColor = aC.rgb; vFlags = aC.w; vD = aD; vE = aE.xyz; vCenter = aA.xy;
  gl_Position = vec4(w / uCanvas * 2.0 - 1.0, 0.0, 1.0);
}`

export const DAB_FS = `#version 300 es
precision highp float;
uniform int uMode;            // 0 stamp into stroke buffer, 1 smudge into layer, 2 wet mix into layer
uniform float uHardness;
uniform vec2 uCanvas;
uniform int uHasTip;
uniform int uTipInvert;
uniform sampler2D uTip;
uniform int uHasGrain;
uniform sampler2D uGrain;
uniform vec4 uGrainP;         // scale, moving(0/1), movement, texSize
uniform vec4 uGrainQ;         // rotation(rad), cropped(0/1), blendMode, invert(0/1)
uniform vec2 uGrainCB;        // contrast, brightness
uniform float uBuild;         // glaze build-up exponent
uniform sampler2D uSrc;       // smudge / mix: scratch copy of the layer
uniform sampler2D uLoad;      // mix: 1x1 brush load (premultiplied)
uniform vec4 uMix;            // pull strength (smudge) / attack, grade, intense
uniform float uAlphaLock;
${CLIP_CHUNK}
in vec2 vLocal;
in float vRad;
in float vAlpha;
in float vRho;
in vec2 vWorld;
in vec2 vDelta;
in vec3 vColor;
in float vFlags;
in vec4 vD;
in vec3 vE;
in vec2 vCenter;
out vec4 o;

float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1,0)), f.x), mix(hash12(i + vec2(0,1)), hash12(i + vec2(1,1)), f.x), f.y);
}

void main(){
  vec2 q = vec2(vLocal.x, vLocal.y / vRho);
  float b;
  if (uHasTip == 1) {
    vec2 qq = q;
    if (mod(vFlags, 2.0) >= 1.0) qq.x = -qq.x;
    if (vFlags >= 2.0) qq.y = -qq.y;
    vec2 uv = qq / vRad * 0.5 + 0.5;
    b = texture(uTip, uv).r;
    if (uTipInvert == 1) b = 1.0 - b;
    b *= 1.0 - smoothstep(vRad * 0.94, vRad * 1.02, length(q));
  } else {
    float hard = uHardness * (1.0 - vD.w);
    float w = max(vRad * (1.0 - hard), 1.0);
    float t = clamp((vRad + 0.5 - length(q)) / w, 0.0, 1.0);
    b = t * t * (3.0 - 2.0 * t);
  }
  b *= min(1.0, 4.0 * vRad * vRad);
  float a = b * vAlpha;
  if (uHasGrain == 1 && vD.x > 0.0) {
    float sc = max(uGrainP.x, 0.02);
    vec2 pos = vWorld - vCenter * uGrainP.y * uGrainP.z + vD.yz;
    vec2 uv;
    if (uGrainQ.y > 0.5) uv = pos / (2.0 * vRad * sc * max(vE.z, 0.01)) + 0.5;
    else uv = pos / (sc * uGrainP.w);
    float cs = cos(uGrainQ.x), sn = sin(uGrainQ.x);
    uv = vec2(cs * uv.x - sn * uv.y, sn * uv.x + cs * uv.y);
    float g = texture(uGrain, uv).r;
    if (uGrainQ.w > 0.5) g = 1.0 - g;
    g = clamp((g - 0.5) * uGrainCB.x + 0.5 + uGrainCB.y, 0.0, 1.0);
    float t = mix(1.0, g, vD.x);
    int bm = int(uGrainQ.z + 0.5);
    float r;
    if (bm == 0) r = a * t;
    else if (bm == 1) r = max(0.0, a - (1.0 - t) * 1.5);
    else if (bm == 2) r = min(a, t);
    else if (bm == 3) r = max(0.0, a + t - 1.0);
    else if (bm == 4) r = t <= 0.0 ? 0.0 : 1.0 - min(1.0, (1.0 - a) / t);
    else r = b * max(vAlpha, g * vD.x);
    a = r;
  }
  if (uBuild != 1.0) a = 1.0 - pow(max(0.0, 1.0 - a), uBuild);
  a = clamp(a, 0.0, 1.0);
  if (uMode == 0) { o = vec4(vColor * a, a); return; }
  a *= selCov(vWorld / uCanvas);
  vec4 here = texelFetch(uSrc, ivec2(gl_FragCoord.xy), 0);
  vec4 res;
  if (uMode == 1) {
    vec4 s = texture(uSrc, (vWorld + vDelta) / uCanvas);
    float k = clamp(a * uMix.x, 0.0, 1.0);
    if (vE.y > 0.0) {
      float r = vRad * 0.35 * vE.y + 0.5;
      vec4 acc = vec4(0.0);
      for (int i = 0; i < 4; i++) {
        float an = 1.5708 * float(i);
        acc += texture(uSrc, (vWorld + vDelta + vec2(cos(an), sin(an)) * r) / uCanvas);
      }
      s = mix(s, (s + acc) / 5.0 * 1.25, min(1.0, vE.y));
    }
    res = mix(here, s, k);
  } else {
    vec4 L = texelFetch(uLoad, ivec2(0), 0);
    float dil = vE.x;
    float k = a * uMix.x * (1.0 - 0.6 * dil);
    if (uMix.y > 0.0) k *= mix(1.0, 0.25 + 1.5 * vnoise(vWorld * 0.7), uMix.y);
    k = clamp(k, 0.0, 1.0);
    vec4 base = here;
    if (vE.y > 0.0) {
      float r = vRad * 0.3 * vE.y + 0.5;
      vec4 acc = here;
      for (int i = 0; i < 6; i++) {
        float an = 1.0472 * float(i);
        acc += texture(uSrc, (vWorld + vec2(cos(an), sin(an)) * r) / uCanvas);
      }
      base = mix(here, acc / 7.0, clamp(a * 2.0 * vE.y, 0.0, 1.0));
    }
    res = base * (1.0 - k) + L * k;
  }
  if (uAlphaLock > 0.5) {
    float kk = res.a > 1e-6 ? here.a / res.a : 0.0;
    res = vec4(res.rgb * kk, here.a);
  }
  o = res;
}`

/** Updates the 1x1 brush load: pick up canvas colour under the dab, refill from the brush colour. */
export const LOAD_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform sampler2D uLoad;
uniform vec2 uCanvas;
uniform vec3 uPos;      // x, y, radius
uniform vec4 uBrush;    // premultiplied brush colour, a = 1
uniform vec2 uRates;    // pull, refill
out vec4 o;
void main(){
  vec4 acc = vec4(0.0);
  for (int j = 0; j < 5; j++) for (int i = 0; i < 5; i++) {
    vec2 off = (vec2(float(i), float(j)) - 2.0) * 0.5 * uPos.z * 0.8;
    acc += texture(uSrc, (uPos.xy + off) / uCanvas);
  }
  acc /= 25.0;
  vec4 L = texelFetch(uLoad, ivec2(0), 0);
  L = mix(L, acc, uRates.x);
  L = mix(L, uBrush, uRates.y);
  o = L;
}`

/** Combines primary + dual stroke buffers and applies wet edge, burnt edges and alpha threshold. */
export const FINAL_FS = `#version 300 es
precision highp float;
uniform sampler2D uA;
uniform sampler2D uB;
uniform int uDual;
uniform int uDualMode;
uniform float uDualOpacity;
uniform float uWet;
uniform float uBurnt;
uniform int uBurntMode;
uniform float uThr;
in vec2 vUv;
out vec4 o;
void main(){
  vec4 A = texture(uA, vUv);
  if (uDual == 1) {
    vec4 B = texture(uB, vUv) * uDualOpacity;
    float a = A.a, b = B.a, r;
    if (uDualMode == 0) r = a * b;
    else if (uDualMode == 1) r = a + b - a * b;
    else if (uDualMode == 2) r = min(a, b);
    else if (uDualMode == 3) r = max(0.0, a + b - 1.0);
    else if (uDualMode == 4) r = b <= 0.0 ? 0.0 : 1.0 - min(1.0, (1.0 - a) / b);
    else if (uDualMode == 5) r = max(a, b);
    else if (uDualMode == 6) r = a + b - a * b;
    else if (uDualMode == 7) r = min(1.0, a + b);
    else r = max(0.0, a - b);
    vec3 c = a > 0.0 ? A.rgb / a : (b > 0.0 ? B.rgb / b : vec3(0.0));
    A = vec4(c * r, r);
  }
  float a = A.a;
  if (a <= 0.0) { o = vec4(0.0); return; }
  if (uWet > 0.0) {
    float a2 = clamp(sqrt(a) * (1.0 - 0.35 * a), 0.0, 1.0);
    A *= mix(a, a2, uWet) / a;
    a = A.a;
  }
  if (uBurnt > 0.0 && a > 0.0) {
    vec3 c = A.rgb / a;
    float e = smoothstep(0.0, 0.25, a) * (1.0 - smoothstep(0.3, 1.0, a));
    vec3 d;
    if (uBurntMode == 0) d = c * c;
    else if (uBurntMode == 1) d = 1.0 - min(vec3(1.0), (1.0 - c) / max(c, vec3(0.02)));
    else if (uBurntMode == 2) d = max(vec3(0.0), 2.0 * c - 1.0);
    else d = c * 0.6;
    c = mix(c, d, clamp(e * uBurnt * 1.4, 0.0, 1.0));
    A = vec4(c * a, a);
  }
  if (uThr > 0.0) {
    float t = smoothstep(uThr - 0.07, uThr + 0.07, a);
    A *= t / a;
  }
  o = A;
}`

/** Direct commit for strokes with a blend mode: layer = blend(base, stroke). */
export const DIRECT_FS = `#version 300 es
precision highp float;
uniform sampler2D uBase;
uniform sampler2D uStroke;
uniform int uBlend;
uniform float uOpacity;
uniform float uAlphaLock;
uniform int uMode;   // 1 paint, 2 erase
${CLIP_CHUNK}
in vec2 vUv;
out vec4 o;
${BLEND_CHUNK}
void main(){
  vec4 L = texture(uBase, vUv);
  vec4 s = texture(uStroke, vUv) * uOpacity * selCov(vUv);
  if (s.a <= 0.0) { o = L; return; }
  if (uMode == 2) { o = uAlphaLock > 0.5 ? L : L * (1.0 - s.a); return; }
  float as = s.a;
  vec3 cs = s.rgb / as;
  vec4 r;
  if (L.a <= 0.0) r = vec4(cs * as, as);
  else {
    vec3 cb = L.rgb / L.a;
    vec3 bl = blendFn(uBlend, cb, cs);
    r = vec4(as * (1.0 - L.a) * cs + as * L.a * bl + (1.0 - as) * L.rgb, as + L.a * (1.0 - as));
  }
  if (uAlphaLock > 0.5) { float k = r.a > 1e-6 ? L.a / r.a : 0.0; r = vec4(r.rgb * k, L.a); }
  o = r;
}`
