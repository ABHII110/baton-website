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

