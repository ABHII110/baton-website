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

