// Stage 3 — CHECK: build + serve the Astro site, screenshot, pixel-compare, emit Fidelity Report.
// Usage: node check.mjs [--study DIR] [--site DIR] [--out DIR]
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { VIEWPORTS, preparePage, escapeHtml } from './lib/common.mjs';

const args = process.argv.slice(2);
const studyDir = args.includes('--study') ? args[args.indexOf('--study') + 1] : 'work/study';
const siteDir = args.includes('--site') ? args[args.indexOf('--site') + 1] : 'work/site';
const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'work/fidelity-report';

const site = JSON.parse(fs.readFileSync(path.join(studyDir, 'site.json'), 'utf8'));
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
if (only) site.pages = site.pages.filter((p) => p.slug === only);
fs.mkdirSync(path.join(outDir, 'img'), { recursive: true });

// Astro is installed once into a shared cache and linked into the generated
// site for the build, instead of a fresh 160 MB install on every run.
const runtime = path.join(process.env.OPENSITEEXIT_CACHE || path.join(os.homedir(), '.cache', 'opensiteexit'), 'astro-runtime');
if (!fs.existsSync(path.join(runtime, 'node_modules', 'astro'))) {
  console.log('[check] installing Astro into the shared cache (first run only)…');
  fs.mkdirSync(runtime, { recursive: true });
  fs.writeFileSync(path.join(runtime, 'package.json'), JSON.stringify({ private: true, dependencies: { astro: '^5.0.0' } }));
  execSync('npm install --no-audit --no-fund', { cwd: runtime, stdio: 'inherit' });
}
const modulesLink = path.join(siteDir, 'node_modules');
const linked = !fs.existsSync(modulesLink);
if (linked) fs.symlinkSync(path.join(runtime, 'node_modules'), modulesLink, 'dir');
try {
  execSync('npx astro build', { cwd: siteDir, stdio: 'inherit' });
} finally {
  if (linked) fs.unlinkSync(modulesLink);
}

const dist = path.join(siteDir, 'dist');
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.gif': 'image/gif', '.avif': 'image/avif', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(dist, p);
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) file = path.join(dist, p, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
console.log(`[check] serving dist on :${port}`);

// content score: best strip match within a vertical window, so a section that
// drifted a few px doesn't count everything below it as different
function sampledSim(a, b, w, ay, by, sh) {
  let same = 0, tot = 0;
  for (let y = 0; y < sh; y += 2) {
    const ar = (ay + y) * w, br = (by + y) * w;
    for (let x = 0; x < w; x += 2) {
      const ai = (ar + x) * 4, bi = (br + x) * 4;
      const d = Math.abs(a[ai] - b[bi]) + Math.abs(a[ai + 1] - b[bi + 1]) + Math.abs(a[ai + 2] - b[bi + 2]);
      tot++;
      if (d < 60) same++;
    }
  }
  return tot ? same / tot : 1;
}
function alignedScore(A, B, w, h) {
  const STRIP = 120, WIN = 240, STEP = 8;
  let acc = 0, wsum = 0;
  for (let y0 = 0; y0 < h; y0 += STRIP) {
    const sh = Math.min(STRIP, h - y0);
    if (sh < 20) break;
    let best = 0;
    for (let dy = -WIN; dy <= WIN; dy += STEP) {
      const by = y0 + dy;
      if (by < 0 || by + sh > h) continue;
      const s = sampledSim(A.data, B.data, w, y0, by, sh);
      if (s > best) best = s;
      if (best > 0.995) break;
    }
    acc += best * sh; wsum += sh;
  }
  return wsum ? acc / wsum : 0;
}

// structure score: the share of measured elements that came out at their
// measured size. Unlike pixel comparison it is not fooled by flat backgrounds,
// where misplaced text or a missing image changes few pixels.
function structureScore(original, rebuilt) {
  let total = 0, matched = 0;
  for (const [id, [w, h]] of Object.entries(rebuilt)) {
    const o = original?.[id];
    if (!o || o.display === 'inline' || o.__rectW * o.__rectH < 400) continue;
    total++;
    if (Math.abs(w - o.__rectW) <= Math.max(8, o.__rectW * 0.15) && Math.abs(h - o.__rectH) <= Math.max(8, o.__rectH * 0.15)) matched++;
  }
  return total ? matched / total : 1;
}
const MEASURE_BOXES = `(() => {
  const out = {};
  for (const el of document.querySelectorAll('[class]')) {
    const id = el.classList[0];
    if (!/^e\\d+$/.test(id)) continue;
    const r = el.getBoundingClientRect();
    out[id] = [Math.round(r.width), Math.round(r.height)];
  }
  return out;
})()`;

function padTo(png, w, h) {
  if (png.width === w && png.height === h) return png;
  const out = new PNG({ width: w, height: h, fill: true });
  out.data.fill(255);
  PNG.bitblt(png, out, 0, 0, Math.min(png.width, w), Math.min(png.height, h), 0, 0);
  return out;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 1, reducedMotion: 'reduce' });
const results = [];

for (const p of site.pages) {
  const localUrl = `http://localhost:${port}${p.path === '/' ? '/' : p.path.replace(/\/$/, '') + '/'}`;
  const page = await ctx.newPage();
  const row = { path: p.path, slug: p.slug, viewports: {}, seo: {} };
  const evidence = JSON.parse(fs.readFileSync(path.join(studyDir, 'pages', p.slug, 'evidence.json'), 'utf8'));
  const cssFile = path.join(siteDir, 'src', 'styles', `${p.slug}.css`);
  if (fs.existsSync(cssFile)) row.cssBytes = fs.statSync(cssFile).size;
  if (p.health?.brokenImages) row.warning = `${p.health.brokenImages} of ${p.health.images} images did not load on the original when it was measured`;
  try {
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(localUrl, { waitUntil: 'networkidle', timeout: 30000 });
      await preparePage(page);
      const rebuiltShot = path.join(outDir, 'img', `${p.slug}-rebuilt-${vp.name}.png`);
      await page.screenshot({ path: rebuiltShot, fullPage: true });
      const structure = structureScore(evidence.stylesByViewport[vp.name], await page.evaluate(MEASURE_BOXES));

      const origShot = path.join(studyDir, 'pages', p.slug, `original-${vp.name}.png`);
      const a = PNG.sync.read(fs.readFileSync(origShot));
      const b = PNG.sync.read(fs.readFileSync(rebuiltShot));
      const w = Math.max(a.width, b.width);
      const h = Math.max(a.height, b.height);
      const A = padTo(a, w, h), B = padTo(b, w, h);
      const diff = new PNG({ width: w, height: h });
      const bad = pixelmatch(A.data, B.data, diff.data, w, h, { threshold: 0.15 });
      const similarity = 1 - bad / (w * h);
      const diffShot = path.join(outDir, 'img', `${p.slug}-diff-${vp.name}.png`);
      fs.writeFileSync(diffShot, PNG.sync.write(diff));
      fs.copyFileSync(origShot, path.join(outDir, 'img', `${p.slug}-original-${vp.name}.png`));
      const aligned = alignedScore(A, B, w, h);
      row.viewports[vp.name] = { similarity, aligned, structure, diffPixels: bad, width: w, height: h };
      console.log(`[check] ${p.path} @${vp.name}: strict ${(similarity * 100).toFixed(1)}% | content ${(aligned * 100).toFixed(1)}% | structure ${(structure * 100).toFixed(1)}%`);
    }
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto(localUrl, { waitUntil: 'load' });
    const got = await page.evaluate(() => ({
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.content || '',
      h1: [...document.querySelectorAll('h1')].map((h) => h.textContent.trim()),
      generator: document.querySelector('meta[name="generator"]')?.content || '',
      images: document.images.length,
      hiddenImages: [...document.images].filter((i) => i.offsetWidth * i.offsetHeight === 0).length,
    }));
    row.layout = got.generator.includes('pinned') ? 'pinned' : 'flow';
    // flat backgrounds can score well even when content is missing, so missing
    // images are counted directly rather than left to the pixel comparison
    if (got.hiddenImages) row.warning = [row.warning, `${got.hiddenImages} of ${got.images} images are not visible in the rebuild`].filter(Boolean).join('; ');
    const weakest = Math.min(...Object.values(row.viewports).map((v) => v.structure));
    if (weakest < 0.75) row.warning = [row.warning, `only ${Math.round(weakest * 100)}% of elements kept their measured size in the rebuild`].filter(Boolean).join('; ');
    row.seo = {
      title: { want: p.meta.title, got: got.title, ok: got.title === p.meta.title },
      description: { want: p.meta.description, got: got.description, ok: got.description === p.meta.description },
      h1: { want: p.meta.h1, got: got.h1, ok: JSON.stringify(got.h1) === JSON.stringify(p.meta.h1) },
    };
  } catch (e) {
    row.error = e.message;
    console.error(`[check] FAILED ${p.path}: ${e.message}`);
  } finally {
    await page.close();
  }
  results.push(row);
}
await browser.close();
server.close();

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const allScores = results.flatMap((r) => Object.values(r.viewports).map((v) => v.similarity));
const allAligned = results.flatMap((r) => Object.values(r.viewports).map((v) => v.aligned ?? v.similarity));
const meanAlignedScore = mean(allAligned);
const allStructure = results.flatMap((r) => Object.values(r.viewports).map((v) => v.structure ?? 1));
const verdictOf = (x) => x >= 0.9
  ? { id: 'great-fit', label: 'Great fit', note: 'This site migrates cleanly. Pages at this score are ready after a light review.' }
  : x >= 0.7
    ? { id: 'needs-refinement', label: 'Needs a refinement pass', note: 'The structure carried over; the lowest pages need targeted fixes before delivery.' }
    : { id: 'not-a-fit', label: 'Not a fit yet', note: 'This site relies on layouts or storefront features the migration does not reproduce.' };
const summary = {
  target: site.target, checkedAt: new Date().toISOString(),
  pages: results.length,
  meanSimilarity: mean(allScores),
  meanAligned: meanAlignedScore,
  meanStructure: mean(allStructure),
  worst: Math.min(...allScores, 1),
  worstAligned: Math.min(...allAligned, 1),
  verdict: verdictOf(meanAlignedScore).id,
  incompleteOriginal: results.some((r) => r.warning?.includes('original')),
  hiddenImages: results.some((r) => r.warning?.includes('rebuild')),
  results,
};
const suffix = only ? `-${only}` : '';
fs.writeFileSync(path.join(outDir, `fidelity${suffix}.json`), JSON.stringify(summary, null, 1));

const pct = (x) => (x * 100).toFixed(1) + '%';
const tone = (x) => x >= 0.9 ? 'var(--pass)' : x >= 0.7 ? 'var(--hold)' : 'var(--diff)';
const scoreCell = (v) => `
        <td class="num" style="color:${tone(v)}">${pct(v)}</td>
        <td class="barcell"><div class="bar"><i style="width:${(v * 100).toFixed(1)}%; background:${tone(v)}"></i></div></td>`;
const verdict = verdictOf(summary.meanAligned);
const rows = results.map((r) => {
  const worstPage = r.error ? 0 : Math.min(...Object.values(r.viewports).map((v) => v.aligned ?? v.similarity));
  const vpRows = Object.entries(r.viewports).map(([name, v]) => `
      <tr>
        <td class="mono">${name}</td>${scoreCell(v.aligned ?? v.similarity)}
        <td class="num muted">${pct(v.similarity)}</td>
        <td class="num" style="color:${tone(v.structure ?? 1)}">${v.structure != null ? pct(v.structure) : ''}</td>
      </tr>`).join('');
  const shots = Object.keys(r.viewports).map((name) => `
      <details>
        <summary>Screenshots at ${name} width</summary>
        <div class="tri">
          <figure><img src="img/${r.slug}-original-${name}.png" alt="Original page at ${name} width" loading="lazy"><figcaption>Original</figcaption></figure>
          <figure><img src="img/${r.slug}-rebuilt-${name}.png" alt="Rebuilt page at ${name} width" loading="lazy"><figcaption>Rebuilt</figcaption></figure>
          <figure><img src="img/${r.slug}-diff-${name}.png" alt="Difference overlay at ${name} width" loading="lazy"><figcaption>Diff</figcaption></figure>
        </div>
      </details>`).join('');
  const seoRow = (label, s) => `
      <tr><td>${label}</td><td>${escapeHtml(s.want ?? '')}</td><td>${escapeHtml(s.got ?? '')}</td>
      <td>${s.ok ? '<span class="ok">match</span>' : '<span class="bad">differs</span>'}</td></tr>`;
  const seo = r.seo.title ? `
    <table class="seo">
      <tr><th>Tag</th><th>Original</th><th>Rebuilt</th><th>Parity</th></tr>
      ${seoRow('Title', r.seo.title)}
      ${seoRow('Description', r.seo.description)}
      ${seoRow('H1', { want: (r.seo.h1.want || []).join(' | '), got: (r.seo.h1.got || []).join(' | '), ok: r.seo.h1.ok })}
    </table>` : '';
  const body = r.error
    ? `<p class="bad">This page could not be checked: ${escapeHtml(r.error)}</p>`
    : `<table class="vps">
      <tr><th>Viewport</th><th>Content match</th><th></th><th>Strict</th><th>Structure</th></tr>${vpRows}
    </table>${shots}${seo}`;
  return `
<section class="page-card">
  <div class="page-head">
    <h2 class="mono">${escapeHtml(r.path)}</h2>
    ${r.error ? '' : `<span class="num muted">${r.layout || 'flow'} layout${r.cssBytes ? ` · ${Math.round(r.cssBytes / 1024)} KB css` : ''} · <span style="color:${tone(worstPage)}">${pct(worstPage)} worst</span></span>`}
  </div>
  <div>${r.warning ? `<p class="bad">${escapeHtml(r.warning)}. Scores for this page are not reliable.</p>` : ''}
  </div>
  ${body}
</section>`;
}).join('\n');

fs.writeFileSync(path.join(outDir, only ? `report${suffix}.html` : 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fidelity report — ${escapeHtml(new URL(site.target).hostname)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;700&family=Source+Sans+3:wght@400;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
  :root {
    --paper: #f7f6f2; --ink: #1a1d21; --ink-soft: #4d545c; --rule: #d8d5cc;
    --panel: #ffffff; --blueprint: #1d5fae; --diff: #d93025; --pass: #177245; --hold: #b45309;
    --display: "Archivo", "Helvetica Neue", Arial, sans-serif;
    --body: "Source Sans 3", "Segoe UI", system-ui, sans-serif;
    --mono: "IBM Plex Mono", Consolas, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --paper: #16181c; --ink: #e8e6e1; --ink-soft: #9aa1ab; --rule: #31353c;
      --panel: #1e2126; --blueprint: #6aa5e8; --diff: #ff6b5e; --pass: #4fbf84; --hold: #d79b4a;
      color-scheme: dark;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--paper); color: var(--ink); font: 16px/1.5 var(--body); }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 0 max(16px, env(safe-area-inset-left, 0px)) 0 max(16px, env(safe-area-inset-right, 0px)); }
  .mono { font-family: var(--mono); }
  .num { font-family: var(--mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .muted { color: var(--ink-soft); }
  header { border-bottom: 1px solid var(--rule); }
  header .wrap { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 8px 24px; padding-block: 16px; }
  .wordmark { font-family: var(--display); font-weight: 700; font-size: 17px; }
  .wordmark .x { color: var(--diff); }
  .meta { font-family: var(--mono); font-size: 13px; color: var(--ink-soft); }
  .verdict { border-bottom: 1px solid var(--rule); }
  .verdict .wrap { display: flex; align-items: baseline; gap: 16px 40px; flex-wrap: wrap; padding-block: 36px; }
  .score { font-family: var(--display); font-weight: 700; font-size: 56px; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
  .verdict h1 { font-family: var(--display); font-weight: 700; font-size: 24px; margin: 0; }
  .verdict p { margin: 4px 0 0; color: var(--ink-soft); max-width: 52ch; }
  .statline { width: 100%; display: flex; gap: 8px 32px; flex-wrap: wrap; font-family: var(--mono); font-size: 13px; color: var(--ink-soft); }
  main .wrap { padding-block: 32px 48px; display: grid; gap: 24px; }
  .page-card { background: var(--panel); border: 1px solid var(--rule); border-radius: 8px; padding: 20px; }
  .page-head { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; flex-wrap: wrap; margin-bottom: 12px; }
  .page-head h2 { font-size: 16px; font-weight: 500; margin: 0; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  table.vps th, table.seo th { font-family: var(--mono); font-size: 13px; font-weight: 500; color: var(--ink-soft); text-align: left; padding: 8px 12px 8px 0; border-bottom: 1px solid var(--rule); }
  table.vps td, table.seo td { padding: 8px 12px 8px 0; border-bottom: 1px solid var(--rule); vertical-align: baseline; }
  .barcell { width: 40%; min-width: 120px; }
  .bar { height: 6px; border-radius: 3px; background: var(--rule); overflow: hidden; }
  .bar i { display: block; height: 100%; border-radius: 3px; }
  details { margin-top: 12px; }
  summary { cursor: pointer; font-size: 14px; color: var(--ink-soft); }
  summary:hover, summary:focus-visible { color: var(--ink); }
  .tri { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 8px; }
  .tri figure { margin: 0; }
  .tri img { width: 100%; border: 1px solid var(--rule); border-radius: 4px; }
  figcaption { text-align: center; font-family: var(--mono); font-size: 12px; color: var(--ink-soft); margin-top: 4px; }
  table.seo { margin-top: 16px; }
  .ok { color: var(--pass); font-family: var(--mono); font-size: 13px; }
  .bad { color: var(--diff); font-family: var(--mono); font-size: 13px; }
  footer { border-top: 1px solid var(--rule); }
  footer .wrap { padding-block: 20px 32px; font-family: var(--mono); font-size: 13px; color: var(--ink-soft); }
  :focus-visible { outline: 2px solid var(--blueprint); outline-offset: 2px; }
</style></head><body>
<header><div class="wrap">
  <span class="wordmark">OpenSite<span class="x">Exit</span></span>
  <span class="meta">${escapeHtml(site.target)} · ${summary.checkedAt.slice(0, 10)}</span>
</div></header>
<div class="verdict"><div class="wrap">
  <span class="score" style="color:${tone(summary.meanAligned)}">${pct(summary.meanAligned)}</span>
  <div>
    <h1>${verdict.label}</h1>
    <p>${verdict.note}</p>
    ${summary.incompleteOriginal ? '<p class="bad">Some originals did not finish loading when they were measured. Run the scan again before relying on these scores.</p>' : ''}
  </div>
  <div class="statline">
    <span>${results.length} pages checked</span>
    <span>strict overlay ${pct(summary.meanSimilarity)}</span>
    <span>structure ${pct(summary.meanStructure)}</span>
    <span>worst page-viewport ${pct(summary.worstAligned)}</span>
    <span>widths 1366 / 768 / 375 px</span>
  </div>
</div></div>
<main><div class="wrap">
${rows}
</div></main>
<footer><div class="wrap">
  Content match tolerates small vertical offsets between sections; strict is an exact overlay.
  Structure is the share of measured elements that kept their measured size, which catches
  layout damage that flat backgrounds hide from a pixel comparison.
  Similarity is 1 − differing pixels / total pixels (pixelmatch, threshold 0.15), measured on
  full-page screenshots. Generated by OpenSiteExit.
</div></footer>
</body></html>`);

console.log(`[check] done. Content match ${pct(summary.meanAligned)} | strict ${pct(summary.meanSimilarity)} -> ${outDir}/index.html`);
