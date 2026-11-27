/* ==========================================================================
   Baton — the stream of light (WebGL)
   --------------------------------------------------------------------------
   One fixed WebGL canvas draws a single bundle of light strands along a
   spline. All geometry lives on the GPU: each strand is a static ribbon of
   vertices that the vertex shader bends along the spline every frame, so the
   CPU only uploads ~30 numbers per frame and nothing is allocated per frame.

   Passes per frame
     1. glow    : ribbon body, core, a third of the strands and the pinch
                  light into a quarter-resolution buffer, then a separable
                  gaussian blur (small = bloom, large = "out of focus")
     2. compose : background + upscaled glow + vignette + dither -> screen
     3. sharp   : every strand as an anti-aliased line, plus sparks and motes,
                  added on top (skipped while a section is out of focus)

   Every section tagged [data-stream="key"] owns a keyframe; scrolling blends
   between keyframes so the stream bends, drifts and changes focus.

   Debug: add ?fps to the URL for a live frame-rate meter.
          BatonStream.bench() in the console measures GPU+CPU cost per frame.
   ========================================================================== */
(() => {
  'use strict';

  const wrap = document.getElementById('stream');
  const canvas = document.getElementById('streamGL');
  if (!wrap || !canvas) return;

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const showFps = /[?&]fps\b/.test(window.location.search);
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const rand = (a, b) => a + Math.random() * (b - a);

  /* Keyframes ---------------------------------------------------------------
     pts   : five spline points [x, y, spread]. x/y are fractions of the
             viewport; spread is the half-width of the bundle as a fraction of
             sqrt(width * height). A tiny spread makes the bright "pinch".
     m     : optional points used on narrow (phone) screens.
     focus : 1 = crisp strands, 0 = soft out-of-focus glow.
     cool  : how strongly the teal/blue strands show.
     drift : how much the shape travels up while you scroll through a section.
     twist : how many half-turns the strands make around the bundle.        */
  const KF = {
    hero: {
      pts: [[0.98, -0.24, 0.27], [0.7, 0.19, 0.14], [0.385, 0.6, 0.016], [0.61, 0.86, 0.09], [1.22, 1.1, 0.25]],
      m: [[1.25, 0.02, 0.22], [0.88, 0.28, 0.12], [0.12, 0.62, 0.02], [0.68, 0.8, 0.09], [1.4, 0.96, 0.22]],
      focus: 1, intensity: 1, cool: 0.75, drift: 0.55, twist: 0.35,
    },
    apps: {
      pts: [[0.58, -0.35, 0.12], [0.8, 0.16, 0.1], [0.73, 0.55, 0.08], [0.6, 0.95, 0.11], [0.72, 1.35, 0.14]],
      m: [[0.4, -0.3, 0.12], [0.9, 0.15, 0.1], [0.76, 0.55, 0.09], [0.35, 0.95, 0.12], [0.6, 1.3, 0.14]],
      focus: 1, intensity: 0.85, cool: 1.15, drift: 0.35, twist: 0.9,
    },
    glue: {
      pts: [[1.25, -0.25, 0.22], [0.82, 0.18, 0.17], [0.42, 0.52, 0.15], [0.12, 0.86, 0.17], [-0.25, 1.25, 0.22]],
      focus: 0, intensity: 0.85, cool: 1, drift: 0.2, twist: 0.5,
    },
    plate: {
      pts: [[1.2, 0.05, 0.2], [0.82, 0.28, 0.15], [0.5, 0.5, 0.13], [0.18, 0.72, 0.15], [-0.2, 0.95, 0.2]],
      focus: 0, intensity: 0.55, cool: 0.9, drift: 0.1, twist: 0.5,
    },
    reliability: {
      pts: [[1.35, -0.15, 0.2], [0.98, 0.12, 0.15], [0.8, 0.45, 0.13], [0.95, 0.82, 0.15], [1.35, 1.1, 0.2]],
      m: [[1.3, -0.1, 0.18], [0.9, 0.15, 0.14], [0.7, 0.45, 0.12], [0.9, 0.8, 0.14], [1.3, 1.1, 0.18]],
      focus: 0.05, intensity: 0.8, cool: 1, drift: 0.2, twist: 0.6,
    },
    daily: {
      pts: [[1.25, 0.0, 0.2], [0.82, 0.28, 0.16], [0.45, 0.45, 0.14], [0.1, 0.7, 0.16], [-0.3, 0.98, 0.2]],
      focus: 0, intensity: 0.8, cool: 1.15, drift: 0.2, twist: 0.6,
    },
    numbers: {
      pts: [[-0.3, 0.15, 0.18], [0.06, 0.42, 0.12], [0.3, 0.78, 0.1], [0.7, 0.98, 0.12], [1.3, 1.12, 0.18]],
      focus: 0.15, intensity: 0.85, cool: 1, drift: 0.25, twist: 0.7,
    },
    pricing: {
      pts: [[-0.25, 0.94, 0.14], [0.2, 0.74, 0.11], [0.52, 0.52, 0.06], [0.82, 0.3, 0.1], [1.25, 0.1, 0.16]],
      focus: 1, intensity: 0.95, cool: 1.35, drift: 0.35, twist: 0.8,
    },
    cta: {
      pts: [[-0.25, 0.4, 0.14], [0.2, 0.3, 0.1], [0.55, 0.24, 0.07], [0.85, 0.15, 0.1], [1.25, 0.04, 0.14]],
      focus: 0.9, intensity: 0.65, cool: 1.25, drift: 0.25, twist: 0.7,
    },
  };

  const PALETTE = {
    lime: [194, 242, 73],
    pale: [230, 255, 170],
    green: [126, 216, 96],
    teal: [84, 214, 188],
    blue: [98, 162, 255],
  };
  const rgb = (c) => [c[0] / 255, c[1] / 255, c[2] / 255];
  const BG = rgb([5, 6, 5]);

  /* Shaders ---------------------------------------------------------------- */
  const VS_HEAD = `
precision highp float;
uniform vec3 u_c0;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_c3;
uniform vec3 u_c4;
uniform vec3 u_c5;
uniform vec3 u_c6;
uniform float u_minSpread;
uniform float u_time;
uniform float u_twist;
uniform vec2 u_view;
vec3 spine(float u, out vec2 tg) {
  float s = clamp(u, 0.0, 1.0) * 4.0;
  vec3 p0; vec3 p1; vec3 p2; vec3 p3; float t;
  if (s < 1.0) { p0 = u_c0; p1 = u_c1; p2 = u_c2; p3 = u_c3; t = s; }
  else if (s < 2.0) { p0 = u_c1; p1 = u_c2; p2 = u_c3; p3 = u_c4; t = s - 1.0; }
  else if (s < 3.0) { p0 = u_c2; p1 = u_c3; p2 = u_c4; p3 = u_c5; t = s - 2.0; }
  else { p0 = u_c3; p1 = u_c4; p2 = u_c5; p3 = u_c6; t = s - 3.0; }
  vec3 a = 2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3;
  vec3 b = 3.0 * p1 - p0 - 3.0 * p2 + p3;
  vec3 c = p2 - p0;
  tg = 0.5 * (c.xy + 2.0 * a.xy * t + 3.0 * b.xy * t * t);
  vec3 r = 0.5 * (2.0 * p1 + c * t + a * t * t + b * t * t * t);
  r.z = max(r.z, u_minSpread);
  return r;
}
vec2 normalOf(vec2 d) {
  float l = length(d);
  return l > 1e-5 ? vec2(-d.y, d.x) / l : vec2(0.0, 1.0);
}
float strandOff(float u, vec4 p1, vec4 p2) {
  return p1.x * cos(p1.y + u_twist * u + u_time * p1.z) + p1.w * sin(p2.x * u * 6.2831853 + u_time * p2.y + p2.z);
}
vec4 clipPos(vec2 p) {
  vec2 c = p / u_view * 2.0 - 1.0;
  return vec4(c.x, -c.y, 0.0, 1.0);
}
`;

  const FS_HEAD = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 u_res;
uniform float u_vig;
float vignette() {
  vec2 q = (gl_FragCoord.xy / u_res - vec2(0.5, 0.55)) / vec2(0.65, 0.475);
  return 1.0 - u_vig * smoothstep(0.55, 1.0, length(q));
}
float dither() {
  return fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5;
}
`;

  // strands, ribbon body, core: a quad strip bent along the spline
  const RIBBON_VS = VS_HEAD + `
attribute float a_u;
attribute float a_side;
attribute vec4 a_p1;
attribute vec4 a_p2;
attribute vec4 a_p3;
attribute vec3 a_col;
uniform float u_scale;
uniform float u_reveal;
uniform float u_alpha;
uniform float u_cool;
uniform float u_sigma;
varying float v_x;
varying float v_hw;
varying vec3 v_col;
varying float v_a;
vec2 pointAt(float u, out float spread) {
  vec2 tg;
  vec3 sp = spine(u, tg);
  spread = sp.z;
  return sp.xy + normalOf(tg) * sp.z * strandOff(u, a_p1, a_p2);
}
void main() {
  float spread;
  float tmp;
  vec2 P = pointAt(a_u, spread);
  vec2 A = pointAt(max(a_u - 0.004, 0.0), tmp);
  vec2 B = pointAt(min(a_u + 0.004, 1.0), tmp);
  vec2 N = normalOf(B - A);
  float hw = a_p3.z > 0.5 ? spread * a_p3.w * u_scale : 0.5 * a_p3.x * u_scale;
  float ext = u_sigma > 0.0 ? 2.8 * max(u_sigma, hw * 0.6) : hw + 2.2;
  gl_Position = clipPos(P + N * (a_side * ext / u_scale));
  v_x = a_side * ext;
  v_hw = hw;
  v_col = a_col;
  v_a = a_p2.w * u_alpha * mix(1.0, u_cool, a_p3.y) * (1.0 - smoothstep(u_reveal - 0.025, u_reveal, a_u));
}
`;
  const RIBBON_FS = FS_HEAD + `
uniform float u_fsig;
varying float v_x;
varying float v_hw;
varying vec3 v_col;
varying float v_a;
void main() {
  float x = abs(v_x);
  float I;
  if (u_fsig > 0.0) {
    float s = max(u_fsig, v_hw * 0.6);
    I = exp(-0.5 * x * x / (s * s));
  } else {
    float h = v_hw + 1.2;
    I = clamp(v_hw + 0.5 - x, 0.0, 1.0) + 0.16 * exp(-2.0 * x * x / (h * h));
  }
  float a = I * v_a * vignette();
  gl_FragColor = vec4(v_col * a, a);
}
`;

  // sparks riding the strands
  const SPARK_VS = VS_HEAD + `
attribute vec4 a_p1;
attribute vec4 a_p2;
attribute vec4 a_s;
attribute vec2 a_t;
uniform float u_scale;
uniform float u_reveal;
uniform float u_alpha;
varying float v_a;
void main() {
  float u = fract(a_s.x + a_s.y * u_time);
  vec2 tg;
  vec3 sp = spine(u, tg);
  vec2 P = sp.xy + normalOf(tg) * sp.z * (strandOff(u, a_p1, a_p2) + a_s.z);
  float tw = 0.5 + 0.5 * sin(u_time * a_t.x + a_t.y);
  v_a = u_alpha * (0.12 + 0.88 * tw * tw * tw) * (1.0 - smoothstep(u_reveal - 0.03, u_reveal, u));
  gl_PointSize = max(2.0, a_s.w * u_scale * 2.6);
  gl_Position = clipPos(P);
}
`;
  const SPARK_FS = FS_HEAD + `
uniform vec3 u_col;
varying float v_a;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = exp(-16.0 * dot(d, d)) * v_a * vignette();
  gl_FragColor = vec4(u_col * a, a);
}
`;

  // soft out-of-focus motes floating beside the bundle
  const MOTE_VS = VS_HEAD + `
attribute vec4 a_m;
attribute float a_ma;
uniform float u_scale;
uniform float u_reveal;
uniform float u_alpha;
varying float v_a;
void main() {
  float u = fract(a_m.x + a_m.y * u_time);
  vec2 tg;
  vec3 sp = spine(u, tg);
  vec2 P = sp.xy + normalOf(tg) * sp.z * a_m.z;
  v_a = a_ma * u_alpha * (1.0 - step(u_reveal, u));
  gl_PointSize = max(2.0, a_m.w * 2.0 * u_scale);
  gl_Position = clipPos(P);
}
`;
  const MOTE_FS = FS_HEAD + `
uniform vec3 u_col;
varying float v_a;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float I = mix(0.55, 0.18, smoothstep(0.0, 0.55, r)) * (1.0 - smoothstep(0.55, 1.0, r));
  float a = I * v_a * vignette();
  gl_FragColor = vec4(u_col * a, a);
}
`;

  // the light where the bundle pinches
  const GLOW_VS = `
precision highp float;
attribute vec2 a_pos;
uniform vec2 u_pt;
uniform float u_size;
uniform vec2 u_view;
void main() {
  vec2 c = u_pt / u_view * 2.0 - 1.0;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0) + vec4(a_pos * 0.0, 0.0, 0.0);
  gl_PointSize = u_size;
}
`;
  const GLOW_FS = `
precision mediump float;
uniform float u_a;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float I = 0.55 * exp(-14.0 * r * r) + 0.42 * (1.0 - smoothstep(0.0, 1.0, r));
  vec3 col = mix(vec3(0.91, 1.0, 0.63), vec3(0.76, 0.95, 0.29), smoothstep(0.0, 0.35, r));
  float a = I * u_a;
  gl_FragColor = vec4(col * a, a);
}
`;

  const QUAD_VS = `
precision highp float;
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;
  // 9-tap gaussian in 5 bilinear fetches
  const BLUR_FS = `
precision mediump float;
uniform sampler2D u_tex;
uniform vec2 u_dir;
uniform float u_dither;
varying vec2 v_uv;
void main() {
  vec2 o1 = u_dir * 1.3846153846;
  vec2 o2 = u_dir * 3.2307692308;
  vec3 c = texture2D(u_tex, v_uv).rgb * 0.2270270270;
  c += texture2D(u_tex, v_uv + o1).rgb * 0.3162162162;
  c += texture2D(u_tex, v_uv - o1).rgb * 0.3162162162;
  c += texture2D(u_tex, v_uv + o2).rgb * 0.0702702703;
  c += texture2D(u_tex, v_uv - o2).rgb * 0.0702702703;
  float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5;
  gl_FragColor = vec4(max(c + n * u_dither, 0.0), 1.0);
}
`;
  const COMPOSE_FS = FS_HEAD + `
uniform sampler2D u_tex;
uniform float u_gain;
uniform float u_sat;
uniform vec3 u_bg;
varying vec2 v_uv;
void main() {
  vec3 g = texture2D(u_tex, v_uv).rgb * u_gain;
  float l = dot(g, vec3(0.299, 0.587, 0.114));
  g = max(mix(vec3(l), g, u_sat), 0.0) * vignette();
  gl_FragColor = vec4(u_bg + g + dither() / 255.0, 1.0);
}
`;

