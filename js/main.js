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

  /* 1. Preloader: ring counts in, fills lime, folds into the nav logo -------- */
  async function runLoader() {
    const loader = $('#loader');
    const navMark = $('#navMark');
    const handOver = () => {
      document.body.classList.add('hero-in');
      if (window.BatonStream) window.BatonStream.start();
    };
    const finish = () => {
      root.classList.remove('is-loading');
      if (navMark) navMark.classList.add('is-ready');
      if (location.hash.length > 1) {
        const t = document.getElementById(location.hash.slice(1));
        if (t) t.scrollIntoView();
      }
    };

    if (!loader || reduce || !loader.animate) {
      handOver();
      finish();
      if (loader) loader.remove();
      return;
    }

    const bar = $('#loaderBar'), count = $('#loaderCount'), ring = $('#loaderRing');
    const lime = $('#loaderLime'), glyph = $('#loaderGlyph');
    const fontsReady = document.fonts && document.fonts.ready
      ? Promise.race([document.fonts.ready, sleep(2400)])
      : Promise.resolve();

    await tween(1050, (e) => {
      bar.style.strokeDashoffset = String(100 - e * 100);
      count.textContent = String(Math.round(e * 100)).padStart(3, '0');
    }, ease.inOutCubic);
    await fontsReady;

    const W = lime.clientWidth, H = lime.clientHeight;
    const R = Math.ceil(Math.hypot(W, H) / 2) + 4;
    ring.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.82)' }], { duration: 420, easing: EASE_IO, fill: 'forwards' });
    await lime.animate(
      [{ clipPath: 'circle(48px at 50% 50%)' }, { clipPath: `circle(${R}px at 50% 50%)` }],
      { duration: 680, easing: 'cubic-bezier(.7,0,.2,1)', fill: 'forwards' }
    ).finished;

    // the page now sits behind the lime: let it show as the lime retreats
    lime.style.clipPath = `circle(${R}px at 50% 50%)`;
    lime.getAnimations().forEach((a) => a.cancel());
    loader.classList.add('is-through');
    ring.remove();
    handOver();

    const S = Math.round(Math.min(136, W * 0.32));
    const rad = Math.round(S * 0.3);
    const sq = [(H - S) / 2, (W - S) / 2, (H - S) / 2, (W - S) / 2];
    const inset = (t, r, b, l, k) => `inset(${t}px ${r}px ${b}px ${l}px round ${k}px)`;
    glyph.animate(
      [{ opacity: 0, transform: 'translate(-50%,-50%) scale(.5)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1)' }],
      { duration: 700, delay: 260, easing: EASE_IO, fill: 'forwards' }
    );
    await lime.animate(
      [{ clipPath: inset(0, 0, 0, 0, 0) }, { clipPath: inset(sq[0], sq[1], sq[2], sq[3], rad) }],
      { duration: 860, easing: EASE_IO, fill: 'forwards' }
    ).finished;
    await sleep(140);

    const m = navMark ? navMark.getBoundingClientRect() : null;
    if (m && m.width) {
      const dx = m.left + m.width / 2 - W / 2;
      const dy = m.top + m.height / 2 - H / 2;
      const gs = (m.width * (17 / 26)) / glyph.offsetWidth;
      glyph.animate(
        [{ opacity: 1, transform: 'translate(-50%,-50%) scale(1)' }, { opacity: 1, transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(${gs})` }],
        { duration: 820, easing: EASE_IO, fill: 'forwards' }
      );
      await lime.animate(
        [{ clipPath: inset(sq[0], sq[1], sq[2], sq[3], rad) }, { clipPath: inset(m.top, W - m.right, H - m.bottom, m.left, 8) }],
        { duration: 820, easing: EASE_IO, fill: 'forwards' }
      ).finished;
    } else {
      await loader.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: 'forwards' }).finished;
    }
    finish();
    loader.remove();
  }

  /* 2. Nav ------------------------------------------------------------------- */
  function initNav() {
    const nav = $('#nav');
    if (!nav) return;
    const burger = $('.nav__burger', nav);
    const onScroll = () => nav.classList.toggle('is-scrolled', window.scrollY > 10);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    const close = () => { nav.classList.remove('is-open'); if (burger) burger.setAttribute('aria-expanded', 'false'); };
    if (burger) {
      burger.addEventListener('click', () => {
        const open = !nav.classList.contains('is-open');
        nav.classList.toggle('is-open', open);
        burger.setAttribute('aria-expanded', String(open));
      });
    }
    $$('.mobile-menu a', nav).forEach((a) => a.addEventListener('click', close));
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    window.addEventListener('resize', () => { if (window.innerWidth > 960) close(); });
  }

  /* 3. Buttons: a circle fills from wherever the pointer enters -------------- */
  function initButtons() {
    const set = (b, e) => {
      const r = b.getBoundingClientRect();
      b.style.setProperty('--x', `${e.clientX - r.left}px`);
      b.style.setProperty('--y', `${e.clientY - r.top}px`);
      b.style.setProperty('--s', String(Math.ceil((Math.hypot(r.width, r.height) * 2) / 10) + 1));
    };
    $$('.btn').forEach((b) => {
      b.addEventListener('pointerenter', (e) => set(b, e));
      b.addEventListener('pointerleave', (e) => set(b, e));
    });
  }

  /* 4. Reveal system: fade-ups, split words, typewriter, counters ----------- */
  function splitWords(el) {
    const nodes = Array.from(el.childNodes);
    el.textContent = '';
    let i = 0;
    const word = (text, tpl) => {
      const w = document.createElement('span');
      w.className = 'w';
      w.style.setProperty('--wi', i++);
      if (tpl) { const c = tpl.cloneNode(false); c.textContent = text; w.appendChild(c); }
      else w.textContent = text;
      el.appendChild(w);
    };
    nodes.forEach((n) => {
      if (n.nodeType === 1 && n.tagName === 'BR') { el.appendChild(n); return; }
      const tpl = n.nodeType === 1 ? n : null;
      (n.textContent || '').split(/(\s+)/).forEach((part) => {
        if (!part) return;
        if (/^\s+$/.test(part)) el.appendChild(document.createTextNode(' '));
        else word(part, tpl);
      });
    });
  }

  function typeIt(el) {
    const full = el.dataset.full || el.textContent.trim();
    el.dataset.full = full;
    if (reduce) { el.textContent = full; return; }
    el.style.minHeight = `${el.offsetHeight}px`;
    el.textContent = '';
    el.classList.add('is-typing');
    let i = 0;
    const step = () => {
      i += 1;
      el.textContent = full.slice(0, i);
      if (i < full.length) setTimeout(step, 18 + Math.random() * 38);
      else setTimeout(() => el.classList.remove('is-typing'), 1400);
    };
    setTimeout(step, 300);
  }

  function countUp(el) {
    const to = parseFloat(el.dataset.count);
    const dec = parseInt(el.dataset.decimals || '0', 10);
    const pre = el.dataset.prefix || '', suf = el.dataset.suffix || '';
    const f = new Intl.NumberFormat('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    if (reduce) { el.textContent = pre + f.format(to) + suf; return; }
    tween(parseInt(el.dataset.duration || '2000', 10), (e) => { el.textContent = pre + f.format(to * e) + suf; }, ease.outExpo);
  }

  function initRoll(el) {
    const txt = el.textContent.trim();
    el.textContent = '';
    el.setAttribute('aria-label', txt);
    Array.from(txt).forEach((ch, idx) => {
      if (!/\d/.test(ch)) { el.append(ch); return; }
      const col = document.createElement('span');
      col.className = 'roll';
      col.setAttribute('aria-hidden', 'true');
      const inner = document.createElement('span');
      inner.className = 'roll__in';
      for (let k = 0; k < 20; k++) { const s = document.createElement('span'); s.textContent = String(k % 10); inner.append(s); }
      inner.style.setProperty('--to', String(10 + Number(ch)));
      inner.style.transitionDelay = `${idx * 110}ms`;
      col.append(inner);
      el.append(col);
    });
  }

  const ANIMS = {};
  function reveal(el) {
    if (el.classList.contains('is-in')) return;
    el.classList.add('is-in');
    if (el.hasAttribute('data-reveal') && !reduce && el.animate) {
      el.animate(
        [{ opacity: 0, transform: 'translateY(28px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 1100, delay: parseFloat(el.dataset.delay || '0'), easing: EASE_CSS, fill: 'backwards' }
      );
    }
    if (el.hasAttribute('data-type')) typeIt(el);
    if (el.hasAttribute('data-count')) countUp(el);
    const a = el.dataset.anim;
    if (a && ANIMS[a]) ANIMS[a](el);
  }

  function initReveal() {
    $$('[data-split]').forEach(splitWords);
    $$('[data-roll]').forEach(initRoll);
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        io.unobserve(en.target);
        reveal(en.target);
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -6% 0px' });
    $$('[data-reveal], [data-split], [data-type], [data-count], [data-roll], [data-anim]').forEach((el) => io.observe(el));
  }

