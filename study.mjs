// Stage 1 — STUDY: crawl the live site, measure what a visitor sees.
// Usage: node study.mjs <url> [--max-pages N] [--out DIR]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { VIEWPORTS, STYLE_PROPS, pagePathToSlug, preparePage } from './lib/common.mjs';

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
if (!target) { console.error('usage: node study.mjs <url> [--max-pages N] [--out DIR]'); process.exit(1); }
const maxPages = Number(args[args.indexOf('--max-pages') + 1] || 10);
const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'work/study';

const origin = new URL(target).origin;
fs.mkdirSync(path.join(outDir, 'assets'), { recursive: true });

const EXTRACT_TREE = `(() => {
  const STYLE_PROPS = ${JSON.stringify(STYLE_PROPS)};
  let counter = 0;
  const SKIP = new Set(['SCRIPT','STYLE','NOSCRIPT','TEMPLATE','LINK','META','IFRAME']);
  function visible(el, cs) {
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 && r.height < 1 && cs.position !== 'absolute' && cs.position !== 'fixed') return false;
    return true;
  }
  function grab(el) {
    const cs = getComputedStyle(el);
    const o = {};
    for (const p of STYLE_PROPS) o[p] = cs[p];
    return o;
  }
  function walk(el) {
    if (SKIP.has(el.tagName)) return null;
    const cs = getComputedStyle(el);
    if (!visible(el, cs)) return null;
    if (!el.dataset.ceId) el.dataset.ceId = 'e' + (counter++);
    const r = el.getBoundingClientRect();
    const node = {
      id: el.dataset.ceId,
      tag: el.tagName.toLowerCase(),
      rect: { x: Math.round(r.x), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height) },
      text: null, href: null, src: null, alt: null, children: [],
    };
    if (node.tag === 'a') node.href = el.getAttribute('href');
    if (node.tag === 'img') { node.src = el.currentSrc || el.src; node.alt = el.alt || ''; }
    if (node.tag === 'input') { node.type = el.type; node.placeholder = el.placeholder || ''; }
    if (node.tag === 'svg' || el.tagName.toLowerCase() === 'svg') return null;
    // text and inline elements keep their document order, so a sentence with a
    // link in the middle reads the same in the rebuild
    const parts = [];
    for (const c of el.childNodes) {
      if (c.nodeType === 3) {
        const t = c.textContent.replace(/\\s+/g, ' ');
        if (t.trim()) parts.push({ tag: '#text', text: t });
        else if (t && parts.length) parts.push({ tag: '#text', text: ' ' });
      } else if (c.nodeType === 1) { const sub = walk(c); if (sub) parts.push(sub); }
    }
    const hasElements = parts.some((p) => p.tag !== '#text');
    const hasWords = parts.some((p) => p.tag === '#text' && p.text.trim());
    if (!hasElements) node.text = parts.map((p) => p.text).join('').trim() || null;
    else node.children = hasWords ? parts : parts.filter((p) => p.tag !== '#text');
    if (!node.text && !node.src && node.children.length === 0 && !['hr','input','textarea','button'].includes(node.tag)) {
      // keep empty elements that paint something (background layers, decorative fills)
      const paints = (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') || (cs.backgroundImage && cs.backgroundImage !== 'none');
      if (!(paints && node.rect.w * node.rect.h > 400)) return null;
    }
    return node;
  }
  const tree = walk(document.body);
  const meta = {
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.content || '',
    canonical: document.querySelector('link[rel="canonical"]')?.href || '',
    h1: [...document.querySelectorAll('h1')].map((h) => h.textContent.trim()),
    lang: document.documentElement.lang || 'en',
  };
  const links = [...document.querySelectorAll('a[href]')].map((a) => a.href);
  return { tree, meta, links };
})()`;

const GRAB_STYLES = `(() => {
  const STYLE_PROPS = ${JSON.stringify(STYLE_PROPS)};
  const out = {};
  for (const el of document.querySelectorAll('[data-ce-id]')) {
    const cs = getComputedStyle(el);
    const o = {};
    for (const p of STYLE_PROPS) o[p] = cs[p];
    const r = el.getBoundingClientRect();
    o.__rectW = Math.round(r.width); o.__rectH = Math.round(r.height);
    o.__rectX = Math.round(r.x); o.__rectY = Math.round(r.y + scrollY);
    out[el.dataset.ceId] = o;
  }
  return out;
})()`;

function assetName(url, buf) {
  const ext = (new URL(url).pathname.match(/\.(png|jpe?g|webp|gif|svg|avif|ico)$/i) || [, 'img'])[1].toLowerCase();
  return crypto.createHash('sha1').update(url).digest('hex').slice(0, 12) + '.' + (ext === 'img' ? 'png' : ext);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 1, reducedMotion: 'reduce' });
const queue = [target];
const seen = new Set();
const pages = [];
const assetMap = {}; // remote url -> local file

while (queue.length && pages.length < maxPages) {
  const url = queue.shift();
  const norm = url.replace(/[#?].*$/, '').replace(/\/$/, '') || origin;
  if (seen.has(norm)) continue;
  seen.add(norm);

  const page = await ctx.newPage();
  console.log(`[study] ${url}`);
  try {
    await page.setViewportSize({ width: VIEWPORTS[0].width, height: VIEWPORTS[0].height });
    // heavy sites (chat widgets, video) may never reach networkidle
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch (e) {
      console.warn(`[study] retrying ${url}: ${e.message.split('\n')[0]}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await preparePage(page);

    // an original that did not finish loading makes every score against it meaningless
    const health = await page.evaluate(() => {
      const imgs = [...document.images].filter((i) => i.currentSrc || i.src);
      return { images: imgs.length, brokenImages: imgs.filter((i) => i.complete && i.naturalWidth === 0).length };
    });
    if (health.brokenImages) console.warn(`[study] warning: ${health.brokenImages} of ${health.images} images did not load on ${url}`);

    const { tree, meta, links } = await page.evaluate(EXTRACT_TREE);
    const stylesByViewport = {};
    const screenshots = {};
    const slug = pagePathToSlug(new URL(url).pathname);
    const pdir = path.join(outDir, 'pages', slug);
    fs.mkdirSync(pdir, { recursive: true });

    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(500);
      await preparePage(page);
      stylesByViewport[vp.name] = await page.evaluate(GRAB_STYLES);
      const shot = path.join(pdir, `original-${vp.name}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      screenshots[vp.name] = shot;
    }

    const imgUrls = new Set();
    (function collect(n) {
      if (!n) return;
      if (n.src) imgUrls.add(n.src);
      const bg = n.id && stylesByViewport.desktop[n.id]?.backgroundImage;
      const m = bg && bg.match(/url\("?([^")]+)"?\)/);
      if (m && /^https?:/.test(m[1])) imgUrls.add(m[1]);
      (n.children || []).forEach(collect);
    })(tree);
    for (const u of imgUrls) {
      if (assetMap[u]) continue;
      try {
        const resp = await ctx.request.get(u, { timeout: 20000 });
        if (resp.ok()) {
          const buf = await resp.body();
          const name = assetName(u, buf);
          fs.writeFileSync(path.join(outDir, 'assets', name), buf);
          assetMap[u] = name;
        }
      } catch { /* skip failed asset */ }
    }

    for (const l of links) {
      try {
        const lu = new URL(l, url);
        if (lu.origin === origin && !/\.(pdf|zip|jpg|png|mp4)$/i.test(lu.pathname)) {
          const key = lu.href.replace(/[#?].*$/, '').replace(/\/$/, '') || origin;
          if (!seen.has(key)) queue.push(lu.href);
        }
      } catch { /* bad href */ }
    }

    pages.push({ url, path: new URL(url).pathname, slug, meta, health, tree, stylesByViewport, screenshots });
    fs.writeFileSync(path.join(pdir, 'evidence.json'), JSON.stringify({ url, meta, tree, stylesByViewport }, null, 1));
  } catch (e) {
    console.error(`[study] FAILED ${url}: ${e.message}`);
  } finally {
    await page.close();
  }
}

fs.writeFileSync(path.join(outDir, 'site.json'), JSON.stringify({
  origin, target, crawledAt: new Date().toISOString(),
  pages: pages.map((p) => ({ url: p.url, path: p.path, slug: p.slug, meta: p.meta, health: p.health })),
  assetMap,
}, null, 1));

await browser.close();
if (!pages.length) {
  console.error(`[study] no page of ${target} could be read; nothing to migrate`);
  process.exit(1);
}
console.log(`[study] done: ${pages.length} pages, ${Object.keys(assetMap).length} assets -> ${outDir}`);
