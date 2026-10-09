import { BLEND_CHUNK, STROKE_CHUNK } from './shaders'
import { CLIP_CHUNK } from './clipMask'

/**
 * Layer compositing pass with masks, clipping and live-stroke overlay.
 * uStrokeTarget: 0 = the live stroke belongs to this layer's pixels, 1 = to this layer's mask,
 * 2 = to the CLIP BASE layer (so clipped layers above the layer being painted follow the stroke live).
 * Mask value = luminance of the premultiplied mask colour (white shows, black hides).
 */
export const LAYER_COMPOSITE_FS = `#version 300 es
precision highp float;
uniform sampler2D uBack;
uniform sampler2D uSrc;
uniform sampler2D uClip;
uniform sampler2D uMask;
uniform sampler2D uClipMask;
uniform float uOpacity;
uniform int uBlend;
uniform float uClipOn;
uniform float uClipMul;
uniform float uMaskOn;
uniform float uMaskView;
uniform float uClipMaskOn;
uniform int uStrokeTarget;
in vec2 vUv;
out vec4 o;
${STROKE_CHUNK}
${BLEND_CHUNK}
float maskVal(vec4 m){ return clamp(dot(m.rgb, vec3(0.3, 0.59, 0.11)), 0.0, 1.0); }
void main(){
  vec4 L = texture(uSrc, vUv);
  if (uStrokeTarget == 0) L = applyStroke(L, vUv);
  float mv = 1.0;
  if (uMaskOn > 0.5) {
    vec4 M = texture(uMask, vUv);
    if (uStrokeTarget == 1) M = applyStroke(M, vUv);
    mv = maskVal(M);
  }
  if (uMaskView > 0.5) { L = vec4(vec3(mv), 1.0); mv = 1.0; }
  vec4 B = texture(uBack, vUv);
  float k = uOpacity * mv;
  if (uClipOn > 0.5) {
    vec4 C = texture(uClip, vUv);
    if (uStrokeTarget == 2) C = applyStroke(C, vUv);
    float cm = uClipMaskOn > 0.5 ? maskVal(texture(uClipMask, vUv)) : 1.0;
    k *= C.a * cm * uClipMul;
  }
  float as = L.a * k;
  if (as <= 0.0) { o = B; return; }
  vec3 cs = L.rgb / L.a;
  if (B.a <= 0.0) { o = vec4(cs * as, as); return; }
  vec3 cb = B.rgb / B.a;
  vec3 bl = blendFn(uBlend, cb, cs);
  vec3 c = as * (1.0 - B.a) * cs + as * B.a * bl + (1.0 - as) * B.rgb;
  o = vec4(c, as + B.a * (1.0 - as));
}`

/** Pass-through group with opacity/mask: lerp the backdrop toward the group's rendered result. */
export const GROUP_MIX_FS = `#version 300 es
precision highp float;
uniform sampler2D uBack;
uniform sampler2D uGrp;
uniform sampler2D uMask;
uniform float uK;
uniform float uMaskOn;
in vec2 vUv;
out vec4 o;
void main(){
  float k = uK;
  if (uMaskOn > 0.5) k *= clamp(dot(texture(uMask, vUv).rgb, vec3(0.3, 0.59, 0.11)), 0.0, 1.0);
  o = mix(texture(uBack, vUv), texture(uGrp, vUv), k);
}`

/**
 * Whole-layer pixel operations reading a scratch copy of the layer (uSrc) and writing the layer.
 * uOp: 0 fill colour, 1 invert colours, 2 apply mask, 3 invert mask, 4 multiply by selection (cut-out),
 *      6 write the selection as a mask (white = selected),
 *      5 erase inside selection.  uSel is the selection coverage in .r (gl/clipMask) (uSelOn = 0 -> whole layer).
 */
export const LAYER_OP_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform sampler2D uMask;
uniform int uOp;
${CLIP_CHUNK}
uniform vec3 uColor;
uniform float uAlphaLock;
in vec2 vUv;
out vec4 o;
float lumOf(vec3 c){ return clamp(dot(c, vec3(0.3, 0.59, 0.11)), 0.0, 1.0); }
void main(){
  vec4 s = texture(uSrc, vUv);
  float sel = selCov(vUv);
  if (uOp == 4) { o = s * sel; return; }
  if (uOp == 5) { o = s * (1.0 - sel); return; }
  if (uOp == 6) { o = vec4(vec3(selCov(vUv)), 1.0); return; }
  vec4 r = s;
  if (uOp == 0) r = uAlphaLock > 0.5 ? vec4(uColor * s.a, s.a) : vec4(uColor, 1.0);
  else if (uOp == 1) r = vec4(s.a - s.rgb, s.a);
  else if (uOp == 2) r = s * lumOf(texture(uMask, vUv).rgb);
  else if (uOp == 3) r = vec4(vec3(1.0 - lumOf(s.rgb)), 1.0);
  o = mix(s, r, sel);
}`

/** Box-ish downscale for thumbnails: 8x8 bilinear taps over each output pixel's footprint. */
export const THUMB_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uFoot; // footprint of one output pixel in uv units
in vec2 vUv;
out vec4 o;
void main(){
  vec4 acc = vec4(0.0);
  for (int j = 0; j < 8; j++) for (int i = 0; i < 8; i++) {
    vec2 d = (vec2(float(i), float(j)) + 0.5) / 8.0 - 0.5;
    acc += texture(uSrc, vUv + d * uFoot);
  }
  o = acc / 64.0;
}`
