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

  /* 5. Hero: glass tilt + the live refund flow ------------------------------- */
  function initGlass() {
    const glass = $('#glass'), hero = $('.hero');
    if (!glass || reduce) return;
    let inView = true, heroH = hero.offsetHeight || 1;
    new IntersectionObserver(([en]) => { inView = en.isIntersecting; }).observe(hero);
    window.addEventListener('resize', () => { heroH = hero.offsetHeight || 1; });
    if (finePointer) {
      let raf = 0, tx = 0, ty = 0, lx = '', ly = '';
      window.addEventListener('pointermove', (e) => {
        if (!inView) return;
        tx = (e.clientX / window.innerWidth) * 2 - 1;
        ty = (e.clientY / window.innerHeight) * 2 - 1;
        if (!raf) raf = requestAnimationFrame(() => {
          raf = 0;
          const x = tx.toFixed(2), y = ty.toFixed(2);
          if (x !== lx) { glass.style.setProperty('--tx', x); lx = x; }
          if (y !== ly) { glass.style.setProperty('--ty', y); ly = y; }
        });
      }, { passive: true });
    }
    let sraf = 0, lastSp = '';
    const onScroll = () => {
      if (sraf) return;
      sraf = requestAnimationFrame(() => {
        sraf = 0;
        const sp = clamp(window.scrollY / heroH).toFixed(3);
        if (sp !== lastSp) { glass.style.setProperty('--sp', sp); lastSp = sp; }
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  function initFlow() {
    const flow = $('#flow');
    if (!flow) return;
    const svg = $('#flowEdges');
    const nodes = {};
    $$('.node', flow).forEach((n) => { nodes[n.dataset.node] = n; });
    const labels = {};
    $$('[data-edge-label]', flow).forEach((l) => { labels[l.dataset.edgeLabel] = l; });
    const chip = $('#flowChip');
    const askStatus = $('#askStatus'), logStatus = $('#logStatus');
    const runs = $('#runs');
    const EDGES = [['trigger', 'cond'], ['cond', 'ask'], ['cond', 'log']];
    const LAYOUT = {
      wide: { trigger: [0.13, 0.5], cond: [0.46, 0.5], ask: [0.83, 0.2], log: [0.83, 0.8] },
      tall: { trigger: [0.5, 0.09], cond: [0.5, 0.42], ask: [0.25, 0.86], log: [0.75, 0.86] },
    };

    function layout() {
      const w = flow.clientWidth, h = flow.clientHeight;
      if (!w || !h) return;
      const mode = w < 470 ? 'tall' : 'wide';
      flow.dataset.mode = mode;
      const L = LAYOUT[mode];
      const box = {};
      Object.keys(nodes).forEach((k) => {
        const el = nodes[k];
        const nw = el.offsetWidth, nh = el.offsetHeight;
        const x = Math.round(clamp(L[k][0] * w - nw / 2, 0, w - nw));
        const y = Math.round(clamp(L[k][1] * h - nh / 2, 0, h - nh));
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        box[k] = { x, y, w: nw, h: nh };
      });
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      let html = '';
      EDGES.forEach(([a, b]) => {
        const A = box[a], B = box[b];
        let p1, p2, d;
        if (mode === 'wide') {
          p1 = [A.x + A.w, A.y + A.h / 2];
          p2 = [B.x, B.y + B.h / 2];
          const dx = (p2[0] - p1[0]) * 0.55;
          d = `M${p1[0]},${p1[1]} C${p1[0] + dx},${p1[1]} ${p2[0] - dx},${p2[1]} ${p2[0]},${p2[1]}`;
        } else {
          p1 = [A.x + A.w / 2, A.y + A.h];
          p2 = [B.x + B.w / 2, B.y];
          const dy = (p2[1] - p1[1]) * 0.55;
          d = `M${p1[0]},${p1[1]} C${p1[0]},${p1[1] + dy} ${p2[0]},${p2[1] - dy} ${p2[0]},${p2[1]}`;
        }
        const id = `${a}-${b}`;
        html += `<path class="edge" data-edge="${id}" d="${d}"/><path class="edge-glow" data-pulse="${id}" d="${d}" pathLength="1"/><path class="edge-pulse" data-pulse="${id}" d="${d}" pathLength="1"/>`;
        html += `<circle class="port" cx="${p1[0]}" cy="${p1[1]}" r="3"/><circle class="port" cx="${p2[0]}" cy="${p2[1]}" r="3"/>`;
        const lab = labels[id];
        if (lab) { lab.style.left = `${(p1[0] + p2[0]) / 2}px`; lab.style.top = `${(p1[1] + p2[1]) / 2}px`; }
      });
      svg.innerHTML = html;
      if (chip) {
        const A = box.ask;
        chip.hidden = mode === 'tall';
        chip.style.left = `${A.x}px`;
        chip.style.top = `${A.y + A.h + 10}px`;
      }
    }
    layout();
    if ('ResizeObserver' in window) new ResizeObserver(layout).observe(flow);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);

    const pulse = (id, dur = 700) => {
      const ps = svg.querySelectorAll(`[data-pulse="${id}"]`);
      const e = svg.querySelector(`[data-edge="${id}"]`);
      if (e) e.classList.add('is-lit');
      if (!ps.length || !ps[0].animate || reduce) return sleep(dur);
      return Promise.all(Array.from(ps, (p) => p.animate(
        [{ strokeDashoffset: 0.26 }, { strokeDashoffset: -1.02 }],
        { duration: dur, easing: 'cubic-bezier(.45,0,.2,1)' }
      ).finished.catch(() => {})));
    };
    const reset = () => {
      Object.values(nodes).forEach((n) => n.classList.remove('is-active', 'is-done'));
      Object.values(labels).forEach((l) => l.classList.remove('is-lit'));
      $$('.edge', svg).forEach((e) => e.classList.remove('is-lit'));
      askStatus.textContent = 'waiting on a yes';
      logStatus.textContent = 'postgres';
    };
    const pad = (n) => String(n).padStart(2, '0');
    const now = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
    const addRun = (name, dur) => {
      const li = document.createElement('li');
      li.className = 'is-new';
      li.innerHTML = `<i></i><time class="mono">${now()}</time><span class="mono">${name}</span><span class="runs__dur mono">${dur}</span>`;
      runs.prepend(li);
      requestAnimationFrame(() => requestAnimationFrame(() => li.classList.remove('is-new')));
      setTimeout(() => { while (runs.children.length > 3) runs.lastElementChild.remove(); }, 700);
    };

    if (reduce) { nodes.trigger.classList.add('is-done'); nodes.cond.classList.add('is-done'); nodes.ask.classList.add('is-active'); return; }

    let n = 0, order = 4472;
    const hero = $('.hero');
    (async () => {
      while (!document.body.classList.contains('hero-in')) await sleep(200);
      await sleep(1400);
      loopWhileVisible(hero, async () => {
        reset();
        const big = n % 3 !== 2;
        n += 1;
        nodes.trigger.classList.add('is-active');
        await sleep(650);
        await pulse('trigger-cond');
        nodes.trigger.classList.replace('is-active', 'is-done');
        nodes.cond.classList.add('is-active');
        await sleep(550);
        const id = big ? 'cond-ask' : 'cond-log';
        labels[id].classList.add('is-lit');
        await pulse(id);
        nodes.cond.classList.replace('is-active', 'is-done');
        const target = big ? nodes.ask : nodes.log;
        target.classList.add('is-active');
        if (big) {
          await sleep(1700);
          askStatus.textContent = 'approved by Dana';
        } else {
          logStatus.textContent = 'writing...';
          await sleep(900);
          logStatus.textContent = '12 rows written';
        }
        target.classList.replace('is-active', 'is-done');
        order += 1;
        addRun(`refund #${order}`, big ? `${18 + Math.floor(Math.random() * 30)} s` : `${96 + Math.floor(Math.random() * 90)} ms`);
        await sleep(1900);
      });
    })();
  }

  /* 6. Integrations: a signal hops across the tiles --------------------------- */
  function initApps() {
    const row = $('#appsRow');
    if (!row || reduce) return;
    const apps = $$('.app', row);
    let i = -1;
    loopWhileVisible(row, async () => {
      i = (i + 1) % (apps.length + 3);
      apps.forEach((a, j) => { a.classList.toggle('is-on', j === i); a.classList.toggle('is-past', j < i); });
      await sleep(i >= apps.length ? 650 : 380);
    });
  }

  /* 7. Feature visuals --------------------------------------------------------- */
  ANIMS.trace = (el) => {
    const rows = $$('.trace__row', el);
    const status = $('[data-trace-status]', el);
    const SCALE = 200;
    // bars get their final width once and grow with a GPU-friendly scaleX
    rows.forEach((r) => {
      const start = Number(r.dataset.start);
      const span = r.hasAttribute('data-wait') ? SCALE - start : Number(r.dataset.dur);
      const bar = $('.trace__bar', r);
      bar.style.left = `${(start / SCALE) * 100}%`;
      bar.style.width = `${(span / SCALE) * 100}%`;
    });
    const play = async () => {
      rows.forEach((r) => { r.classList.remove('is-run', 'is-done', 'is-wait'); $('.trace__bar', r).style.transform = 'scaleX(0)'; $('.trace__ms', r).textContent = '-'; });
      status.textContent = 'running';
      status.classList.remove('is-ok');
      await sleep(500);
      for (const r of rows) {
        const bar = $('.trace__bar', r), ms = $('.trace__ms', r);
        r.classList.add('is-run');
        if (r.hasAttribute('data-wait')) {
          r.classList.add('is-wait');
          ms.textContent = 'waiting';
          await tween(380, (e) => { bar.style.transform = `scaleX(${e.toFixed(4)})`; });
          await sleep(1900);
          r.classList.remove('is-wait');
          r.classList.add('is-done');
          ms.textContent = 'yes, 26 s';
        } else {
          const dur = Number(r.dataset.dur);
          await tween(Math.max(320, dur * 8), (e) => {
            bar.style.transform = `scaleX(${e.toFixed(4)})`;
            ms.textContent = `${Math.round(dur * e)} ms`;
          });
          r.classList.add('is-done');
        }
      }
      status.textContent = 'done';
      status.classList.add('is-ok');
      await sleep(2800);
    };
    if (reduce) {
      rows.forEach((r) => {
        r.classList.add('is-run', 'is-done');
        $('.trace__bar', r).style.transform = 'none';
        $('.trace__ms', r).textContent = r.hasAttribute('data-wait') ? 'yes, 26 s' : `${r.dataset.dur} ms`;
      });
      status.textContent = 'done';
      status.classList.add('is-ok');
      return;
    }
    loopWhileVisible(el, play);
  };

  ANIMS.chat = (el) => {
    const steps = $$('[data-step]', el);
    const approve = $('[data-approve]', el);
    const label = approve ? approve.querySelector('span') : null;
    const show = (n, on = true) => steps.forEach((s) => { if (Number(s.dataset.step) === n) s.classList.toggle('is-in', on); });
    const press = (on) => { if (!approve) return; approve.classList.toggle('is-pressed', on); if (label) label.textContent = on ? 'Approved' : 'Approve'; };
    if (reduce) { show(1); show(3); show(4); press(true); return; }
    loopWhileVisible(el, async () => {
      el.classList.add('is-fading');
      await sleep(420);
      steps.forEach((s) => s.classList.remove('is-in'));
      press(false);
      el.classList.remove('is-fading');
      await sleep(400);
      show(1); await sleep(1500);
      show(2); await sleep(1700);
      show(2, false); show(3); await sleep(900);
      press(true); await sleep(900);
      show(4); await sleep(4200);
    });
  };

  ANIMS.iso = (el) => {
    const svg = $('svg', el);
    if (!svg) return;
    const vals = [0.46, 0.58, 0.7, 0.84, 1, 0.32];
    const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const VW = 560, base = 190, maxH = 128, hw = 30, dd = 15, th = 6;
    const xs = vals.map((_, i) => 64 + i * ((VW - 128) / (vals.length - 1)));
    const defs = `<defs>
      <linearGradient id="isoL" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#32372f"/><stop offset="1" stop-color="#121410"/></linearGradient>
      <linearGradient id="isoR" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1e211c"/><stop offset="1" stop-color="#090a08"/></linearGradient>
      <linearGradient id="isoCap" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d5d9cf"/><stop offset="1" stop-color="#7c8178"/></linearGradient>
      <linearGradient id="isoHL" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8db631"/><stop offset="1" stop-color="#3d4f12"/></linearGradient>
      <linearGradient id="isoHR" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5f7c1d"/><stop offset="1" stop-color="#26320a"/></linearGradient>
    </defs>`;
    let body = '';
    vals.forEach((v, i) => {
      const hot = i === vals.length - 1 ? ' is-hot' : '';
      body += `<path class="iso__shadow" d="M${xs[i]},${base - dd + 4} L${xs[i] + hw + 10},${base + 4} L${xs[i]},${base + dd + 9} L${xs[i] - hw - 6},${base + 4} Z" opacity=".6"/>`;
      body += `<g class="prism${hot}"><path class="p-left"/><path class="p-right"/><path class="p-top"/><g class="cap"><path class="c-left"/><path class="c-right"/><path class="c-top"/></g></g>`;
      body += `<text class="iso__day${hot}" x="${xs[i]}" y="${base + dd + 36}">${days[i]}</text>`;
    });
    svg.innerHTML = defs + body;
    const groups = $$('.prism', svg);
    const P = (pts) => `M${pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' L')} Z`;
    const set = (i, h, lift) => {
      const g = groups[i], cx = xs[i], by = base, ty = by - h;
      g.children[0].setAttribute('d', P([[cx - hw, ty], [cx, ty + dd], [cx, by + dd], [cx - hw, by]]));
      g.children[1].setAttribute('d', P([[cx, ty + dd], [cx + hw, ty], [cx + hw, by], [cx, by + dd]]));
      g.children[2].setAttribute('d', P([[cx, ty - dd], [cx + hw, ty], [cx, ty + dd], [cx - hw, ty]]));
      const cy = ty - lift;
      const cap = g.children[3].children;
      cap[0].setAttribute('d', P([[cx - hw, cy - th], [cx, cy - th + dd], [cx, cy + dd], [cx - hw, cy]]));
      cap[1].setAttribute('d', P([[cx, cy - th + dd], [cx + hw, cy - th], [cx + hw, cy], [cx, cy + dd]]));
      cap[2].setAttribute('d', P([[cx, cy - th - dd], [cx + hw, cy - th], [cx, cy - th + dd], [cx - hw, cy - th]]));
    };
    if (reduce) { vals.forEach((v, i) => set(i, v * maxH, 0)); return; }
    vals.forEach((v, i) => set(i, 3, 56));
    const t0 = performance.now();
    const tick = (now) => {
      let running = false;
      vals.forEach((v, i) => {
        const a = clamp((now - t0 - i * 140) / 1100);
        const b = clamp((now - t0 - i * 140 - 520) / 900);
        if (a < 1 || b < 1) running = true;
        set(i, Math.max(3, v * maxH * ease.outCubic(a)), Math.max(-3, 56 * (1 - ease.outBack(b))));
      });
      if (running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  /* 8. The lime plate: opens out of the logo, folds back into it -------------- */
  function initPlate() {
    const sec = $('#plate'), card = $('#plateCard'), glyph = $('#plateGlyph'), title = $('#plateTitle');
    if (!sec || !card || !glyph || !title) return;
    const label = $('.plate__label', sec);

    // split the headline into words we can drive with scroll
    const nodes = Array.from(title.childNodes);
    title.textContent = '';
    nodes.forEach((n) => {
      const tpl = n.nodeType === 1 ? n : null;
      (n.textContent || '').split(/(\s+)/).forEach((part) => {
        if (!part) return;
        if (/^\s+$/.test(part)) { title.appendChild(document.createTextNode(' ')); return; }
        const w = document.createElement('span');
        w.className = 'pw';
        if (tpl) { const c = tpl.cloneNode(false); c.textContent = part; w.appendChild(c); } else w.textContent = part;
        title.appendChild(w);
      });
    });
    const words = $$('.pw', title);

    if (reduce) { sec.classList.add('plate--static'); card.style.clipPath = 'none'; return; }

    let ticking = false, active = true, lastClip = '', lastDots = '', lastLabel = '';
    const update = () => {
      ticking = false;
      if (!active) return;
      const vh = window.innerHeight;
      const r = sec.getBoundingClientRect();
      const total = sec.offsetHeight - vh * 0.4;
      const p = clamp((vh * 0.6 - r.top) / total);
      const cw = card.offsetWidth, ch = card.offsetHeight;
      const gx = glyph.offsetLeft + glyph.offsetWidth / 2;
      const gy = glyph.offsetTop + glyph.offsetHeight / 2;
      const L = 136 * ease.outCubic(clamp(p / 0.1));

      let e;
      if (p < 0.12) e = 0;
      else if (p < 0.38) e = ease.inOutCubic((p - 0.12) / 0.26);
      else if (p < 0.7) e = 1;
      else if (p < 0.86) e = 1 - ease.inOutCubic((p - 0.7) / 0.16);
      else e = 0;

      const t = lerp(gy - L / 2, 0, e);
      const l = lerp(gx - L / 2, 0, e);
      const rr = lerp(cw - (gx + L / 2), 0, e);
      const b = lerp(ch - (gy + L / 2), 0, e);
      const rad = lerp(L * 0.3, cw < 600 ? 28 : 40, e);
      const clip = `inset(${t.toFixed(1)}px ${rr.toFixed(1)}px ${b.toFixed(1)}px ${l.toFixed(1)}px round ${rad.toFixed(1)}px)`;
      if (clip !== lastClip) { card.style.clipPath = clip; lastClip = clip; }
      const dots = e.toFixed(3);
      if (dots !== lastDots) { card.style.setProperty('--dots', dots); lastDots = dots; }

      const textAlpha = Math.min(clamp((e - 0.55) / 0.45), 1 - clamp((p - 0.66) / 0.05));
      const la = textAlpha.toFixed(3);
      if (label && la !== lastLabel) { label.style.opacity = la; lastLabel = la; }
      const q = clamp((p - 0.28) / 0.3);
      const n = words.length;
      words.forEach((w, i) => {
        const wp = clamp((q * (n + 2) - i) / 2);
        const op = (textAlpha * (0.14 + 0.86 * wp)).toFixed(3);
        const bl = wp < 0.999 && textAlpha > 0.001 ? `blur(${((1 - wp) * 7).toFixed(1)}px)` : 'none';
        const tr = `translateY(${((1 - wp) * 0.22).toFixed(3)}em)`;
        // only touch the DOM when something actually changed
        if (w._op !== op) { w.style.opacity = op; w._op = op; }
        if (w._bl !== bl) { w.style.filter = bl; w._bl = bl; }
        if (w._tr !== tr) { w.style.transform = tr; w._tr = tr; }
      });
    };
    const onScroll = () => { if (active && !ticking) { ticking = true; requestAnimationFrame(update); } };
    // only do layout reads while the plate is near the screen
    new IntersectionObserver(([en]) => {
      active = en.isIntersecting;
      if (active) onScroll();
    }, { rootMargin: '60% 0px 60% 0px' }).observe(sec);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', () => { lastClip = ''; onScroll(); });
    update();
  }

  /* 9. Daily view ---------------------------------------------------------------- */
  function initWeek() {
    const grid = $('[data-week]');
    if (!grid) return;
    const rnd = mulberry32(7);
    let html = '';
    for (let c = 0; c < 7; c++) {
      html += '<div class="week__col">';
      for (let r = 0; r < 4; r++) {
        const hot = c === 1 && r === 2;
        html += `<div class="week__cell${hot ? ' is-hot' : ''}" style="--c:${c};--r:${r}">`;
        for (let b = 0; b < 3; b++) {
          const a = hot ? 1 : c > 4 ? 0.03 + rnd() * 0.05 : 0.06 + rnd() * 0.13;
          const w = hot ? 1 : 0.45 + rnd() * 0.55;
          html += `<i style="--a:${a.toFixed(3)};--w:${w.toFixed(2)}"></i>`;
        }
        html += '</div>';
      }
      html += '</div>';
    }
    grid.innerHTML = html;

    const cd = $('[data-countdown]');
    if (cd && !reduce) {
      let left = 12 * 60;
      setInterval(() => {
        left = left <= 0 ? 12 * 60 : left - 1;
        cd.textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
      }, 1000);
    }
  }

  function initWaves() {
    $$('[data-wave]').forEach((p) => {
      const k = Number(p.dataset.wave);
      const amp = k ? 16 : 24;
      const phase = k * Math.PI;
      let d = '';
      for (let x = 0; x <= 600; x += 5) {
        const y = 45 + Math.sin((x / 150) * Math.PI * 2 + phase) * amp;
        d += `${x ? 'L' : 'M'}${x} ${y.toFixed(2)}`;
      }
      p.setAttribute('d', d);
    });
  }

  // rough continents [lon, lat] for the dotted map, plus a few inland seas
  const LAND = [
    [[-168, 65], [-162, 70], [-156, 71.5], [-141, 69.8], [-128, 70], [-115, 68.5], [-95, 72], [-82, 69], [-78, 62], [-64, 60], [-56, 52], [-60, 47], [-67, 44.5], [-70, 41.5], [-75, 38], [-76, 35], [-81, 31.5], [-80.5, 25.5], [-82, 27], [-84, 30], [-89, 30], [-94, 29.5], [-97.5, 26], [-97.5, 21], [-95, 18.5], [-91, 18.5], [-87.5, 21], [-88, 15.8], [-83.5, 15], [-83.5, 10.5], [-79.5, 9], [-77.5, 8], [-80, 7.5], [-83, 8.5], [-86, 11.5], [-91.5, 14], [-96, 15.8], [-105, 20], [-106, 23], [-112.5, 29], [-110, 23], [-114.5, 30.5], [-117, 32.5], [-120.5, 34.5], [-122.5, 37.5], [-124.2, 42], [-124, 46.5], [-123, 49], [-127, 51], [-130.5, 54.5], [-135, 57.5], [-140, 59.8], [-147, 61], [-152, 59], [-157, 58], [-162, 60], [-165, 62.5]],
    [[-73, 78], [-60, 82], [-32, 83.5], [-18, 80], [-20, 75], [-22, 70], [-30, 68], [-40, 65], [-43, 60], [-48, 61], [-52, 65], [-54, 69], [-58, 75], [-66, 77]],
    [[-80, 9], [-75, 11], [-71.5, 12.5], [-63, 10.7], [-60, 8.5], [-52, 5], [-50, 1], [-44, -2.5], [-35, -5.5], [-35, -9], [-39, -13.5], [-39, -18], [-41, -22], [-48, -26], [-48.5, -28.5], [-53, -33.5], [-57.5, -35], [-57, -38], [-62, -39], [-65, -41], [-64, -45], [-67.5, -46.5], [-66, -48.5], [-69, -51], [-68.5, -53], [-71.5, -53.5], [-74, -51], [-75.5, -47], [-74, -42], [-73.5, -37], [-71.5, -30], [-70.5, -23], [-70, -18], [-76, -14], [-79.5, -8], [-81.2, -5], [-80, -2], [-80.5, 1], [-78.8, 1.8], [-77.5, 4], [-77.5, 7]],
    [[-9.5, 37], [-9, 43], [-1.5, 43.5], [-1.5, 46.5], [-4.5, 48], [-1.5, 49.5], [2, 51], [4.5, 52.5], [8.5, 53.5], [8.5, 57], [10.5, 57.7], [12.5, 56], [11, 59], [5.5, 59], [5, 62], [10, 64], [14, 67.5], [19, 70], [25, 71], [31, 70], [41, 67.5], [44, 68.5], [53, 68.5], [60, 69.5], [68, 69], [73, 72.5], [80, 72.5], [87, 75], [100, 78], [113, 74], [128, 72.5], [140, 72], [150, 71], [160, 69.5], [170, 70], [180, 69], [180, 65], [174, 61.5], [166, 60], [163, 58], [162.5, 56], [160, 53], [156.5, 51], [156, 57], [160, 61], [156, 61.5], [152, 59.2], [143, 59.3], [137, 54], [141, 52.5], [140, 48], [135, 43.5], [131, 42.5], [129, 40], [126.5, 37.5], [126.5, 34.5], [129, 35], [129.5, 38], [128, 40], [124.5, 40], [121, 40.5], [118, 39], [120.5, 37], [122.5, 37], [119, 35], [121, 32], [122, 30], [120, 26.5], [117, 23.5], [113, 22], [108.5, 21.6], [106.5, 19], [108.5, 15.5], [109, 11.5], [105, 8.6], [103, 10.5], [100.5, 13.5], [100, 9.5], [103.5, 4.5], [104, 1.3], [101, 2.8], [98.5, 8], [98, 15], [94.5, 16], [94, 19.5], [92, 21.5], [90, 22], [87, 21.5], [86, 20], [82, 16.5], [80, 13.5], [79.8, 10.3], [77.5, 8], [76.5, 9.5], [74.5, 14.5], [73, 19], [72.6, 21.3], [69, 22.5], [67, 24.8], [62, 25.2], [57, 25.8], [56.4, 27], [52, 28], [49, 30], [48, 29.5], [50, 26.5], [51.5, 24.5], [55, 25.5], [56.3, 25.2], [57, 23.9], [59.8, 22.5], [57.7, 19], [55, 17], [52, 15.5], [45, 13], [43.4, 12.7], [42.7, 14.5], [40, 19.5], [38.5, 22], [36, 26], [34.5, 28], [34.9, 29.5], [34.3, 31.3], [34.9, 32.5], [35.9, 35.5], [33, 36.2], [29, 36.5], [26.5, 38.5], [26.5, 40.5], [29, 41.2], [28, 42], [28, 43.5], [30, 45.5], [33.5, 44.5], [36.5, 45.3], [39.5, 47.2], [41, 42], [37.5, 41.2], [33, 42], [29, 41], [26, 40.8], [23, 40], [24, 38], [22.5, 36.5], [21, 38.5], [19.5, 41.8], [16, 43.5], [13.5, 45.5], [12.5, 44.5], [14, 42], [16, 41], [18.5, 40.2], [16, 38], [15.6, 40], [12.5, 41.5], [10, 44], [7.5, 43.8], [4, 43.5], [3.2, 42], [0.5, 40.5], [-0.3, 38.5], [-2, 36.8], [-5.5, 36], [-6.5, 37]],
    [[-17, 21], [-16.5, 24], [-13, 27.8], [-9.8, 30], [-9, 32.5], [-6.5, 34], [-5.5, 35.8], [-2, 35.2], [3, 36.8], [9.5, 37.3], [11, 37], [10, 34], [11, 33], [15, 32.3], [19.5, 30.5], [20, 32], [23, 32.7], [25, 31.7], [29, 30.9], [32.3, 31.3], [34.2, 31.2], [34.9, 29.5], [33.5, 28], [32.6, 29.8], [35, 24], [37.3, 21], [38.5, 18], [39.5, 15.5], [41.5, 13.5], [43.3, 12], [44, 10.5], [51, 11.8], [51.2, 10.5], [49, 6], [47, 3.5], [44, 0.5], [41, -2], [39.3, -5], [39.5, -8], [40.5, -11], [40.5, -15], [37, -17.5], [35.3, -21], [35.5, -24], [32.8, -26], [32.5, -28.5], [30, -31.5], [27.5, -33.5], [22.5, -34], [20, -34.8], [18.4, -34], [17.8, -31], [15.2, -27], [14.5, -23], [11.8, -17.5], [12.3, -13], [13.6, -10.5], [12, -5], [9.5, -2], [9.8, 3], [8.5, 4.5], [5.5, 4.3], [2, 6.3], [-2, 4.8], [-7.5, 4.4], [-11, 6.8], [-13.2, 8.5], [-15, 11], [-16.8, 12.5], [-17.4, 14.7], [-16.2, 19.5]],
    [[44, -25], [47, -25], [49.5, -17], [50.4, -15.5], [49.3, -12], [47, -13.5], [44, -17], [43.3, -22]],
    [[113.5, -22], [114.2, -26], [115, -34], [118, -35], [123.5, -33.8], [129, -31.6], [131.5, -31.5], [135, -34.8], [137.8, -33], [138, -35.5], [140, -37.7], [144, -38.4], [146.5, -39], [150, -37.5], [152.5, -32], [153.6, -28], [153, -25], [149.5, -22], [146, -19], [145.4, -15], [143.5, -14], [142.5, -10.7], [141.5, -13.5], [141.5, -17], [139.5, -17.4], [136.5, -15.5], [137, -12], [132.5, -11.4], [130, -13], [129.5, -15], [127, -14], [125, -15], [122.5, -17], [121, -19.5], [117, -20.6]],
    [[145, -40.8], [148.3, -41], [146.8, -43.6], [145.3, -42.5]],
    [[130.5, 31.2], [131.5, 33.5], [133, 34.5], [135.3, 34.5], [137, 34.6], [139.8, 35], [141, 38], [142, 40], [141.4, 41.5], [140, 40.6], [139.7, 38.5], [137, 37], [135.5, 35.6], [133, 35.5], [131, 34.3]],
    [[140, 41.5], [141.5, 42.5], [143.5, 42], [145.5, 43.3], [142.5, 45.5], [141.5, 45]],
    [[-5.7, 50], [-3, 50.6], [1.4, 51.2], [1.7, 52.7], [0.3, 53.5], [-1.5, 55.5], [-2, 57.6], [-4, 58.6], [-5, 58.6], [-6.2, 56.5], [-5, 55], [-3, 54.6], [-3.2, 53.4], [-4.6, 53.3], [-4.2, 52.2], [-5.3, 51.7], [-3.2, 51.4], [-5.6, 50.1]],
    [[-6, 52.2], [-6.2, 54], [-7.5, 55.3], [-10, 54], [-10.4, 51.8], [-8, 51.6]],
    [[-24, 65.5], [-22, 66.4], [-16, 66.5], [-13.5, 65], [-18, 63.4], [-22.5, 63.8]],
    [[95.3, 5.6], [98, 4], [103.8, -1], [106, -3], [106, -5.8], [102, -4], [100, -1], [97, 2.2]],
    [[109, 1.5], [110.5, -1], [111.5, -3.4], [116, -4], [116.5, -1.5], [118, 1], [119, 5], [117, 7], [115.5, 5], [113, 3.2]],
    [[105.3, -6.8], [108, -7.8], [112, -8.3], [114.5, -8.8], [114.4, -7.7], [110.5, -6.6], [106, -5.9]],
    [[119.4, -5.5], [120.5, -1], [121, 1], [124.8, 1.5], [123, -0.8], [121.4, -1.9], [122, -4.8], [120.5, -5.6]],
    [[131, -1.3], [134, -0.8], [138, -1.6], [141, -2.6], [145.5, -4.6], [147.5, -6.2], [150, -10.4], [147, -10.1], [144, -7.8], [141, -9.1], [138, -8.4], [137.5, -5], [133, -4], [132, -2.8]],
    [[120, 18.5], [122.3, 18.5], [122, 16], [121.5, 14], [124, 13], [126, 9], [125.5, 6], [122, 7], [121.5, 9.5], [120.5, 13], [119.8, 16]],
    [[79.8, 6], [80, 9.8], [81.9, 7.5], [81.2, 6.2]],
    [[172.7, -34.4], [174.8, -36.9], [178.5, -37.7], [177, -39.5], [174.8, -41.5], [173.8, -39.2]],
    [[172.7, -40.5], [174.3, -41.7], [171.2, -44.3], [169, -46.6], [166.5, -46], [168.3, -44]],
  ];
  const WATER = [
    [[-95, 59], [-92, 57], [-87, 55.5], [-82, 52.5], [-79, 54.5], [-77, 60], [-80, 63], [-87, 64], [-94, 61]],
    [[47, 45], [50, 46.5], [53, 45.5], [53, 42], [54, 38], [51, 36.8], [49, 38], [49.5, 40.5], [47.5, 42.5]],
    [[10.5, 54.5], [14, 54], [19, 54.4], [21, 56.5], [21.5, 57.5], [24, 57.3], [23.5, 59.3], [29.5, 60], [22.5, 60.5], [21.5, 61.5], [21.5, 63.5], [25, 65], [24.2, 65.8], [21.5, 65.5], [17.5, 62.5], [18.5, 60], [16.5, 57], [14, 55.5], [12.5, 55.8]],
  ];

  function initMap() {
    const wrap = $('[data-map]');
    if (!wrap) return;
    const cv = $('canvas', wrap);
    const ctx = cv.getContext('2d');
    const N = 80, S = -58;
    const proj = (lon, lat) => [(lon + 180) / 360, (N - lat) / (N - S)];
    const prep = (list) => list.map((poly) => {
      const pts = poly.map(([lon, lat]) => proj(lon, lat));
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      return { pts, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    });
    const land = prep(LAND), water = prep(WATER);
    const inside = (x, y, poly) => {
      if (x < poly.x0 || x > poly.x1 || y < poly.y0 || y > poly.y1) return false;
      const p = poly.pts;
      let c = false;
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        if ((p[i][1] > y) !== (p[j][1] > y) && x < ((p[j][0] - p[i][0]) * (y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c;
      }
      return c;
    };
    const pins = $$('.pin', wrap).map((pin) => {
      const [x, y] = proj(Number(pin.dataset.lon), Number(pin.dataset.lat));
      pin.style.setProperty('--x', x.toFixed(4));
      pin.style.setProperty('--y', y.toFixed(4));
      return [x, y];
    });
    let lastW = 0;
    const draw = () => {
      const w = wrap.clientWidth, h = wrap.clientHeight;
      if (!w || !h || w === lastW) return;
      lastW = w;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const step = Math.max(4, w / 86);
      const r = Math.max(0.85, step * 0.2);
      for (let y = step / 2; y < h; y += step) {
        for (let x = step / 2; x < w; x += step) {
          const nx = x / w, ny = y / h;
          if (!land.some((p) => inside(nx, ny, p)) || water.some((p) => inside(nx, ny, p))) continue;
          let hot = 0;
          pins.forEach(([px, py]) => { const d = Math.hypot((px - nx) * w, (py - ny) * h); hot = Math.max(hot, 1 - d / (step * 3.2)); });
          ctx.fillStyle = hot > 0 ? `rgba(194,242,73,${(0.25 + hot * 0.6).toFixed(2)})` : 'rgba(240,243,234,0.2)';
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };
    draw();
    if ('ResizeObserver' in window) new ResizeObserver(draw).observe(wrap);
  }

