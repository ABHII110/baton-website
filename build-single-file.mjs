// Builds dist/baton-website.html: the whole site in one file (CSS, JS and favicon inlined).
// Run from anywhere:  node build-single-file.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(root, 'dist', 'baton-website.html');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

let html = read('index.html');
const css = read('css/styles.css');
const stream = read('js/stream.js');
const main = read('js/main.js');
const favicon = read('assets/favicon.svg').trim();

if (/<\/script/i.test(stream + main)) throw new Error('a script contains a closing script tag');
if (/<\/style/i.test(css)) throw new Error('the stylesheet contains a closing style tag');

// plain string splicing, so "$" sequences inside the code are left untouched
const swap = (src, find, repl) => {
  const i = src.indexOf(find);
  if (i < 0) throw new Error(`not found in index.html: ${find}`);
  return src.slice(0, i) + repl + src.slice(i + find.length);
};

html = swap(html, '<!doctype html>\n', '<!doctype html>\n<!-- Baton: single-file build. CSS and JavaScript are inlined below; the editable sources live in css/ and js/. -->\n');
html = swap(html, '<link rel="icon" href="assets/favicon.svg" type="image/svg+xml" />', `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(favicon)}" type="image/svg+xml" />`);
html = swap(html, '<link rel="stylesheet" href="css/styles.css" />', `<style>\n${css}</style>`);
html = swap(html, '<script src="js/stream.js"></script>', `<script>\n${stream}</script>`);
html = swap(html, '<script src="js/main.js"></script>', `<script>\n${main}</script>`);

mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`wrote ${path.relative(process.cwd(), out)} (${(html.length / 1024).toFixed(0)} KB)`);
