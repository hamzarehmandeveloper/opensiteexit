// Lists the elements of a rebuilt page whose size differs from the measurement,
// grouped by kind, to help find the bug class behind a low structure score.
// Usage: node tools/mismatches.mjs --work DIR [--page slug] [--viewport desktop|tablet|mobile]
import { chromium } from 'playwright';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { VIEWPORTS } from '../lib/common.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const work = opt('--work');
if (!work) { console.error('usage: node tools/mismatches.mjs --work DIR [--page slug] [--viewport desktop|tablet|mobile]'); process.exit(1); }
const slug = opt('--page', 'index');
const vp = VIEWPORTS.find((v) => v.name === opt('--viewport', 'desktop'));

const evidence = JSON.parse(fs.readFileSync(path.join(work, 'study', 'pages', slug, 'evidence.json'), 'utf8'));
const styles = evidence.stylesByViewport[vp.name];
const parentOf = {};
(function index(n) {
  for (const c of n.children || []) { if (c.id) { parentOf[c.id] = n.id; index(c); } }
})(evidence.tree);

const dist = path.join(work, 'site', 'dist');
const MIME = { '.html': 'text/html', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let file = path.join(dist, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
const pagePath = slug === 'index' ? '/' : `/${slug.replace(/__/g, '/')}/`;
await page.goto(`http://localhost:${server.address().port}${pagePath}`, { waitUntil: 'networkidle' });
const rebuilt = await page.evaluate(() => {
  const out = {};
  for (const el of document.querySelectorAll('[class]')) {
    const id = el.classList[0];
    if (!/^e\d+$/.test(id)) continue;
    const r = el.getBoundingClientRect();
    out[id] = { w: Math.round(r.width), h: Math.round(r.height), tag: el.tagName.toLowerCase() };
  }
  return out;
});
await browser.close();
server.close();

const groups = {};
const rows = [];
let total = 0;
for (const [id, b] of Object.entries(rebuilt)) {
  const o = styles[id];
  if (!o || o.display === 'inline' || o.__rectW * o.__rectH < 400) continue;
  total++;
  const wOff = Math.abs(b.w - o.__rectW) > Math.max(8, o.__rectW * 0.15);
  const hOff = Math.abs(b.h - o.__rectH) > Math.max(8, o.__rectH * 0.15);
  if (!wOff && !hOff) continue;
  const p = styles[parentOf[id]] || {};
  const kind = `${b.tag} ${o.display}/${o.position} in ${p.display || '?'}/${p.position || '?'} ${wOff ? 'W' : ''}${hOff ? 'H' : ''}`;
  groups[kind] = (groups[kind] || 0) + 1;
  rows.push({ id, kind, was: `${o.__rectW}x${o.__rectH}`, now: `${b.w}x${b.h}`, area: o.__rectW * o.__rectH });
}
console.log(`${slug} @${vp.name}: ${rows.length} of ${total} elements off by more than 15%\n`);
for (const [kind, n] of Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(String(n).padStart(4), kind);
console.log('\nlargest:');
for (const r of rows.sort((a, b) => b.area - a.area).slice(0, 14)) console.log(` .${r.id.padEnd(5)} ${r.was.padStart(10)} -> ${r.now.padEnd(10)} ${r.kind}`);
