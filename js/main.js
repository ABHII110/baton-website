/* ==========================================================================
   Baton — interactions and motion
   ========================================================================== */
(() => {
  'use strict';

  /* Helpers ----------------------------------------------------------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const root = document.documentElement;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(pointer: fine)').matches;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = {
    outCubic: (t) => 1 - Math.pow(1 - t, 3),
    outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    outBack: (t) => { const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  };
  const tween = (dur, fn, e = ease.outCubic) => new Promise((resolve) => {
    const t0 = performance.now();
    const tick = (now) => {
      const p = clamp((now - t0) / dur);
      fn(e(p), p);
      if (p < 1) requestAnimationFrame(tick); else resolve();
    };
    requestAnimationFrame(tick);
  });
  const fmt = new Intl.NumberFormat('en-US');
  const EASE_CSS = 'cubic-bezier(.22,.8,.2,1)';
  const EASE_IO = 'cubic-bezier(.76,0,.24,1)';
  function mulberry32(a) {
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Run loops only while their element is on screen ------------------------- */
  const visState = new WeakMap();
  const visIO = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      const s = visState.get(en.target);
      if (!s) return;
      s.on = en.isIntersecting;
      if (s.on) { s.wake.forEach((f) => f()); s.wake = []; }
    });
  }, { threshold: 0.05 });
  function whenVisible(el) {
    let s = visState.get(el);
    if (!s) { s = { on: false, wake: [] }; visState.set(el, s); visIO.observe(el); }
    return s.on ? Promise.resolve() : new Promise((r) => s.wake.push(r));
  }
  async function loopWhileVisible(el, fn) {
    for (;;) {
      await whenVisible(el);
      try { await fn(); } catch (err) { console.error(err); await sleep(1000); }
    }
  }

