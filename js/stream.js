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

  /* State ------------------------------------------------------------------ */
  let gl = null, gl2 = false, ready = false, halfFloat = false, maxPoint = 64;
  let pRibbon, pSpark, pMote, pGlow, pBlur, pCompose;
  let vboRibbon, iboRibbon, vboSpark, vboMote, vboQuad;
  let tA = null, tB = null;
  let enabledAttribs = 0;

  let W = 0, H = 0, unit = 1, scale = 1, small = false, built = false;
  let S = 128, N = 96, G = 32, IPR = 0, nSparks = 0, nMotes = 0;
  let sections = [];
  const tgt = { pts: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], focus: 1, intensity: 1, cool: 1, twist: 0.5 };
  const cur = { pts: null, focus: 1, intensity: 1, cool: 1, twist: 0.5 };
  const pa = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const pb = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const CP = new Float32Array(21);
  const tmp3 = new Float32Array(3);
  const mouse = { x: 0.5, y: 0.5, sx: 0.5, sy: 0.5 };
  let started = false, startAt = 0, introP = reduce ? 1 : 0, last = 0;
  const t0 = performance.now();

  // frame-rate meter (?fps)
  let fpsEl = null, frames = 0, fpsStamp = 0, fps = 0, cpuAcc = 0, cpuMs = 0;
  // adaptive resolution: render fewer pixels if frames keep arriving late
  let budgetScale = 1, refreshMs = 16.7, emaMs = 16.7, slowFrames = 0, drsHold = 0;

  /* Public API (exists even if WebGL is unavailable) --------------------- */
  window.BatonStream = {
    start() {
      if (started) return;
      started = true;
      startAt = performance.now();
      if (reduce) { introP = 1; requestStatic(); }
    },
    measure,
    stats: () => ({
      fps: Math.round(fps), jsMs: +cpuMs.toFixed(3), webgl2: gl2, halfFloat, renderScale: +scale.toFixed(2),
      canvas: [canvas.width, canvas.height], glow: tA ? [tA.w, tA.h] : null, strands: N,
    }),
    bench(count = 240) {
      if (!ready || !computeTarget()) return null;
      approach(1);
      const saved = introP;
      introP = 1;
      const px = new Uint8Array(4);
      draw(0);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const start = performance.now();
      for (let i = 0; i < count; i++) {
        draw(i / 120);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // waits for the GPU
      }
      const ms = (performance.now() - start) / count;
      introP = saved;
      return { msPerFrame: +ms.toFixed(3), maxFps: Math.round(1000 / ms) };
    },
  };

  /* WebGL setup ------------------------------------------------------------ */
  const CTX = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' };

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(gl.getShaderInfoLog(s) || 'shader compile failed');
    return s;
  }
  function program(vs, fs, attribs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    attribs.forEach((name, i) => gl.bindAttribLocation(p, i, name));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(gl.getProgramInfoLog(p) || 'program link failed');
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name);
    }
    return { p, u };
  }

  function makeTarget(w, h, useHalf) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (useHalf) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    if (!ok) { gl.deleteFramebuffer(fb); gl.deleteTexture(tex); return null; }
    return { tex, fb, w, h };
  }
  function freeTarget(t) { if (t) { gl.deleteFramebuffer(t.fb); gl.deleteTexture(t.tex); } }
  function makeTargets(w, h) {
    freeTarget(tA); freeTarget(tB);
    tA = tB = null;
    if (halfFloat) {
      tA = makeTarget(w, h, true);
      tB = tA && makeTarget(w, h, true);
      if (!tA || !tB) { freeTarget(tA); freeTarget(tB); halfFloat = false; }
    }
    if (!halfFloat) { tA = makeTarget(w, h, false); tB = makeTarget(w, h, false); }
  }

  function initGL() {
    gl = canvas.getContext('webgl2', CTX);
    gl2 = !!gl;
    if (!gl) gl = canvas.getContext('webgl', CTX) || canvas.getContext('experimental-webgl', CTX);
    if (!gl) throw new Error('WebGL unavailable');
    halfFloat = gl2 && !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    maxPoint = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1] || 64;
    pRibbon = program(RIBBON_VS, RIBBON_FS, ['a_u', 'a_side', 'a_p1', 'a_p2', 'a_p3', 'a_col']);
    pSpark = program(SPARK_VS, SPARK_FS, ['a_p1', 'a_p2', 'a_s', 'a_t']);
    pMote = program(MOTE_VS, MOTE_FS, ['a_m', 'a_ma']);
    pGlow = program(GLOW_VS, GLOW_FS, ['a_pos']);
    pBlur = program(QUAD_VS, BLUR_FS, ['a_pos']);
    pCompose = program(QUAD_VS, COMPOSE_FS, ['a_pos']);
    vboRibbon = gl.createBuffer();
    iboRibbon = gl.createBuffer();
    vboSpark = gl.createBuffer();
    vboMote = gl.createBuffer();
    vboQuad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vboQuad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    enabledAttribs = 0;
    tA = tB = null;
    built = false;
    W = 0;
    resize();
    ready = true;
  }

  /* Geometry: built once, bent on the GPU ---------------------------------- */
  function buildScene() {
    S = small ? 96 : 128;
    N = small ? 48 : 96;
    G = Math.round(N / 3);
    const alphaScale = (small ? 44 : 78) / N;
    const ribbons = [
      // [p1], [p2 (.w = alpha)], [p3 = lineWidth, cool, widthIsFractionOfSpread, fraction], colour
      { p1: [0, 0, 0, 0], p2: [0, 0, 0, 0.2], p3: [0, 0, 1, 1.15], col: rgb([140, 210, 80]) },  // ribbon body
      { p1: [0, 0, 0, 0], p2: [0, 0, 0, 0.29], p3: [18, 1, 0, 0], col: rgb([90, 190, 200]) },  // cool vein
      { p1: [0, 0, 0, 0], p2: [0, 0, 0, 0.4], p3: [10, 0, 0, 0], col: rgb([205, 246, 120]) },  // bright core
    ];
    const strands = [];
    for (let i = 0; i < N; i++) {
      const r = Math.pow(Math.random(), 0.75);
      const roll = Math.random();
      let col = 'lime';
      if (r < 0.45 && roll < 0.42) col = roll < 0.2 ? 'blue' : 'teal';
      else if (roll < 0.12) col = 'pale';
      else if (roll < 0.36) col = 'green';
      const st = {
        p1: [0.12 + r * 0.95, rand(0, TAU), rand(0.12, 0.32) * (Math.random() < 0.5 ? -1 : 1), rand(0.03, 0.15)],
        p2: [rand(0.6, 2.2), rand(0.2, 0.7), rand(0, TAU), rand(0.16, 0.6) * alphaScale],
        p3: [Math.random() < 0.1 ? rand(1.5, 2.3) : rand(0.55, 1.25), col === 'blue' || col === 'teal' ? 1 : 0, 0, 0],
        col: rgb(PALETTE[col]),
      };
      strands.push(st);
      ribbons.push(st);
    }

    const R = ribbons.length;
    const vd = new Float32Array(R * S * 2 * 17);
    let o = 0;
    for (let k = 0; k < R; k++) {
      const rb = ribbons[k];
      for (let i = 0; i < S; i++) {
        const u = i / (S - 1);
        for (let side = -1; side <= 1; side += 2) {
          vd[o++] = u; vd[o++] = side;
          vd.set(rb.p1, o); o += 4;
          vd.set(rb.p2, o); o += 4;
          vd.set(rb.p3, o); o += 4;
          vd.set(rb.col, o); o += 3;
        }
      }
    }
    IPR = (S - 1) * 6;
    const id = new Uint16Array(R * IPR);
    let q = 0;
    for (let k = 0; k < R; k++) {
      const b = k * S * 2;
      for (let i = 0; i < S - 1; i++) {
        const v = b + i * 2;
        id[q++] = v; id[q++] = v + 1; id[q++] = v + 2;
        id[q++] = v + 1; id[q++] = v + 3; id[q++] = v + 2;
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, vboRibbon);
    gl.bufferData(gl.ARRAY_BUFFER, vd, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iboRibbon);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, id, gl.STATIC_DRAW);

    nSparks = small ? 110 : 240;
    const sd = new Float32Array(nSparks * 14);
    o = 0;
    for (let i = 0; i < nSparks; i++) {
      const st = strands[(Math.random() * N) | 0];
      sd.set(st.p1, o); o += 4;
      sd.set(st.p2, o); o += 4;
      sd[o++] = Math.random(); sd[o++] = rand(0.012, 0.05); sd[o++] = rand(-0.35, 0.35); sd[o++] = rand(0.6, 1.9);
      sd[o++] = rand(1.4, 4); sd[o++] = rand(0, TAU);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, vboSpark);
    gl.bufferData(gl.ARRAY_BUFFER, sd, gl.STATIC_DRAW);

    nMotes = small ? 6 : 12;
    const md = new Float32Array(nMotes * 5);
    o = 0;
    for (let i = 0; i < nMotes; i++) {
      md[o++] = Math.random(); md[o++] = rand(0.004, 0.012);
      md[o++] = rand(1.3, 2.8) * (Math.random() < 0.5 ? -1 : 1); md[o++] = rand(4, 15);
      md[o++] = rand(0.05, 0.14);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, vboMote);
    gl.bufferData(gl.ARRAY_BUFFER, md, gl.STATIC_DRAW);
  }

  const L_RIBBON = [[1, 0], [1, 1], [4, 2], [4, 6], [4, 10], [3, 14]];
  const L_SPARK = [[4, 0], [4, 4], [4, 8], [2, 12]];
  const L_MOTE = [[4, 0], [1, 4]];
  const L_QUAD = [[2, 0]];
  function attribs(buffer, stride, spec) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    for (let i = 0; i < spec.length; i++) {
      gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i, spec[i][0], gl.FLOAT, false, stride * 4, spec[i][1] * 4);
    }
    for (let i = spec.length; i < enabledAttribs; i++) gl.disableVertexAttribArray(i);
    enabledAttribs = spec.length;
  }

  /* Sizing ------------------------------------------------------------------ */
  function resize() {
    if (!gl) return;
    const cw = wrap.clientWidth, ch = wrap.clientHeight;
    if (!cw || !ch) return;
    const nextSmall = cw < 720;
    const dpr = window.devicePixelRatio || 1;
    const maxPx = (nextSmall ? 2.4e6 : 4.2e6) * budgetScale;
    const sc = Math.max(Math.min(1, dpr), Math.min(dpr, 2, Math.sqrt(maxPx / (cw * ch))));
    const bw = Math.round(cw * sc), bh = Math.round(ch * sc);
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    W = cw; H = ch; unit = Math.sqrt(W * H); scale = bw / cw;
    const gw = Math.max(8, Math.round(cw / 4)), gh = Math.max(8, Math.round(ch / 4));
    if (!tA || tA.w !== gw || tA.h !== gh) makeTargets(gw, gh);
    if (!built || nextSmall !== small) { small = nextSmall; buildScene(); built = true; }
    measure();
    if (reduce) requestStatic();
  }

  function measure() {
    const y = window.scrollY;
    sections = Array.from(document.querySelectorAll('[data-stream]'))
      .map((el) => { const r = el.getBoundingClientRect(); return { kf: KF[el.dataset.stream], top: r.top + y, bottom: r.bottom + y }; })
      .filter((s) => s.kf && s.bottom > s.top)
      .sort((a, b) => a.top - b.top);
  }

  /* Scroll -> keyframe blend (allocation-free) ----------------------------- */
  function pointsFor(sec, s, vh, out) {
    const src = small && sec.kf.m ? sec.kf.m : sec.kf.pts;
    const mid = (sec.top + sec.bottom) / 2;
    const d = clamp((-(s - mid) / vh) * sec.kf.drift, -0.7, 0.7);
    for (let i = 0; i < 5; i++) { out[i][0] = src[i][0]; out[i][1] = src[i][1] + d; out[i][2] = src[i][2]; }
  }

  function computeTarget() {
    const n = sections.length;
    if (!n) return false;
    const vh = window.innerHeight;
    const s = window.scrollY + vh * 0.5;
    let k = n - 1;
    for (let i = 0; i < n; i++) { if (s < sections[i].bottom) { k = i; break; } }
    const T = vh * 0.45;
    const sec = sections[k];
    let a = k, b = k, f = 0;
    if (k > 0 && s < sec.top + T) { a = k - 1; f = smooth((s - (sec.top - T)) / (2 * T)); }
    else if (k < n - 1 && s > sec.bottom - T) { b = k + 1; f = smooth((s - (sec.bottom - T)) / (2 * T)); }
    const A = sections[a], B = sections[b];
    pointsFor(A, s, vh, pa);
    pointsFor(B, s, vh, pb);
    for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) tgt.pts[i][j] = lerp(pa[i][j], pb[i][j], f);
    tgt.focus = lerp(A.kf.focus, B.kf.focus, f);
    tgt.intensity = lerp(A.kf.intensity, B.kf.intensity, f);
    tgt.cool = lerp(A.kf.cool, B.kf.cool, f);
    tgt.twist = lerp(A.kf.twist, B.kf.twist, f);
    return true;
  }

  function approach(k) {
    if (!cur.pts) {
      cur.pts = tgt.pts.map((p) => p.slice());
      cur.focus = tgt.focus; cur.intensity = tgt.intensity; cur.cool = tgt.cool; cur.twist = tgt.twist;
      return;
    }
    for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) cur.pts[i][j] = lerp(cur.pts[i][j], tgt.pts[i][j], k);
    cur.focus = lerp(cur.focus, tgt.focus, k);
    cur.intensity = lerp(cur.intensity, tgt.intensity, k);
    cur.cool = lerp(cur.cool, tgt.cool, k);
    cur.twist = lerp(cur.twist, tgt.twist, k);
  }

  /* Spline control points (CSS px) + CPU copy of the spine for the pinch -- */
  function setControlPoints() {
    const ox = (mouse.sx - 0.5) * W * 0.035, oy = (mouse.sy - 0.5) * H * 0.03;
    const useMouse = !small && !reduce;
    for (let i = 0; i < 5; i++) {
      let x = cur.pts[i][0] * W, y = cur.pts[i][1] * H;
      if (useMouse && i > 0 && i < 4) { const w = i === 2 ? 1 : 0.55; x += ox * w; y += oy * w; }
      CP[(i + 1) * 3] = x; CP[(i + 1) * 3 + 1] = y; CP[(i + 1) * 3 + 2] = cur.pts[i][2] * unit;
    }
    CP[0] = 2 * CP[3] - CP[6]; CP[1] = 2 * CP[4] - CP[7]; CP[2] = CP[5];
    CP[18] = 2 * CP[15] - CP[12]; CP[19] = 2 * CP[16] - CP[13]; CP[20] = CP[17];
  }
  function evalSpine(u, out) {
    const s = clamp(u, 0, 1) * 4;
    const seg = Math.min(3, Math.floor(s));
    const t = s - seg;
    for (let k = 0; k < 3; k++) {
      const p0 = CP[seg * 3 + k], p1 = CP[(seg + 1) * 3 + k], p2 = CP[(seg + 2) * 3 + k], p3 = CP[(seg + 3) * 3 + k];
      const a = 2 * p0 - 5 * p1 + 4 * p2 - p3, b = 3 * p1 - p0 - 3 * p2 + p3, c = p2 - p0;
      out[k] = 0.5 * (2 * p1 + c * t + a * t * t + b * t * t * t);
    }
  }

  function setSpine(P, time) {
    const u = P.u;
    gl.uniform3f(u.u_c0, CP[0], CP[1], CP[2]);
    gl.uniform3f(u.u_c1, CP[3], CP[4], CP[5]);
    gl.uniform3f(u.u_c2, CP[6], CP[7], CP[8]);
    gl.uniform3f(u.u_c3, CP[9], CP[10], CP[11]);
    gl.uniform3f(u.u_c4, CP[12], CP[13], CP[14]);
    gl.uniform3f(u.u_c5, CP[15], CP[16], CP[17]);
    gl.uniform3f(u.u_c6, CP[18], CP[19], CP[20]);
    gl.uniform1f(u.u_minSpread, unit * 0.006);
    gl.uniform1f(u.u_time, time);
    gl.uniform1f(u.u_twist, cur.twist * Math.PI);
    gl.uniform2f(u.u_view, W, H);
  }

  function blurPass(step) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, tB.fb);
    gl.viewport(0, 0, tB.w, tB.h);
    gl.bindTexture(gl.TEXTURE_2D, tA.tex);
    gl.uniform2f(pBlur.u.u_dir, step / tA.w, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, tA.fb);
    gl.viewport(0, 0, tA.w, tA.h);
    gl.bindTexture(gl.TEXTURE_2D, tB.tex);
    gl.uniform2f(pBlur.u.u_dir, 0, step / tA.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

