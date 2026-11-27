# Baton — black & lime landing page

A workflow-automation landing page where one stream of light runs the whole
length of the site. Plain HTML, CSS and JavaScript: no framework, no build step.

## Run it

Any static server works. From this folder:

```bash
python -m http.server 5173
```

Then open http://localhost:5173. (Opening `index.html` directly also works,
but a server is closer to how it will be hosted.)

## Files

| File | What it does |
| --- | --- |
| `index.html` | All sections and copy |
| `css/styles.css` | Design tokens (top of file), layout, components, responsive rules |
| `js/stream.js` | The light stream: two fixed canvases, one keyframe per section |
| `js/main.js` | Preloader, live hero flow, reveals, lime plate, bento, pricing, form |
| `assets/favicon.svg` | Logo mark |
| `dist/baton-website.html` | The whole site in one file (generated, don't edit) |
| `build-single-file.mjs` | Regenerates the one-file copy: `node build-single-file.mjs` |

## Customising

- **Brand name / copy**: edit `index.html` ("Baton" appears in the nav, hero,
  chat, CTA and footer).
- **Colours**: `--lime`, `--bg`, `--ink` at the top of `css/styles.css`. The
  stream's colours are in `PALETTE` in `js/stream.js`.
- **Stream shape per section**: each `<section data-stream="key">` maps to an
  entry in `KF` in `js/stream.js`. Five points `[x, y, spread]` define the
  spline (x/y as fractions of the screen); `focus` 1 = sharp, 0 = blurred.
- **Pricing tiers**: `PLANS` in `initPricing()` in `js/main.js`, plus the three
  plan cards in `index.html`.
- **Signup form**: front-end only. Replace the success branch in
  `initSignup()` with a `fetch()` to your backend or form service.

Respects `prefers-reduced-motion` (no preloader, static stream, instant reveals).

## Performance

The light stream is drawn with WebGL: every strand is a static ribbon of
vertices that the GPU bends along the spline, so JavaScript only sends ~30
numbers a frame (about 0.1 ms). The glow is rendered at quarter resolution and
blurred on the GPU. If frames keep arriving late on a high-DPI screen, the
stream lowers its own resolution (never below one pixel per CSS pixel).
Everything else that loops is animated with `transform`/`opacity` only.

- Add `?fps` to the URL for a live frame-rate meter.
- Run `BatonStream.bench()` in the browser console to measure the GPU + CPU
  cost of one stream frame (it waits for the GPU each frame, so it's a
  conservative number).
- The browser caps the frame rate at your monitor's refresh rate, so a 60 Hz
  screen shows 60 fps; a 120/144 Hz screen shows 120/144.
- If WebGL is unavailable the page falls back to a static lime glow.
