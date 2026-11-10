// End-to-end test: migrate a local fixture site and check the properties the
// project promises. Run with `npm test` (takes a couple of minutes).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIME = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.js': 'text/javascript', '.png': 'image/png' };

function serve(root) {
  const server = http.createServer((req, res) => {
    let file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

let work, origin, fixtureServer;
const read = (...p) => fs.readFileSync(path.join(work, ...p), 'utf8');

before(async () => {
  fixtureServer = await serve(path.join(HERE, 'fixture'));
  origin = `http://localhost:${fixtureServer.address().port}`;
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'opensiteexit-test-'));
  // spawn, not execFileSync: this process also serves the fixture
  await new Promise((resolve, reject) => {
    const child = spawn('node', [path.join(HERE, '..', 'run.mjs'), origin, '--max-pages', '5', '--work', work], { stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`pipeline exited with ${code}`))));
  });
}, { timeout: 600_000 });

after(() => {
  fixtureServer?.close();
  if (work) fs.rmSync(work, { recursive: true, force: true });
});

test('crawls every linked page, including nested paths', () => {
  const paths = JSON.parse(read('study', 'site.json')).pages.map((p) => p.path).sort();
  assert.deepEqual(paths, ['/', '/about/team/']);
  assert.ok(fs.existsSync(path.join(work, 'site', 'dist', 'about', 'team', 'index.html')));
});

test('keeps text and inline links in their original order', () => {
  const page = read('site', 'src', 'pages', 'index.astro');
  assert.match(page, /visit our <a [^>]*>workshop<\/a> or call <strong[^>]*>today<\/strong>, we are open\./);
});

test('does not bake a popup into the rebuild', () => {
  assert.ok(!read('site', 'src', 'pages', 'index.astro').includes('Subscribe to our newsletter'));
});

test('escapes braces so page text cannot break the Astro template', () => {
  assert.ok(read('site', 'src', 'pages', 'index.astro').includes('&#123;curly&#125;'));
});

test('writes canonical tags, a sitemap and robots.txt', () => {
  assert.ok(read('site', 'dist', 'index.html').includes(`<link rel="canonical" href="${origin}/"`));
  const sitemap = read('site', 'dist', 'sitemap.xml');
  assert.ok(sitemap.includes(`<loc>${origin}/</loc>`) && sitemap.includes(`<loc>${origin}/about/team/</loc>`));
  assert.ok(read('site', 'dist', 'robots.txt').includes('sitemap.xml'));
});

test('scores the fixture as a great fit', () => {
  const fidelity = JSON.parse(read('fidelity-report', 'fidelity.json'));
  assert.ok(fidelity.meanAligned >= 0.97, `content match was ${fidelity.meanAligned}`);
  assert.ok(fidelity.meanStructure >= 0.95, `structure was ${fidelity.meanStructure}`);
  assert.equal(fidelity.verdict, 'great-fit');
  assert.equal(fidelity.incompleteOriginal, false);
  assert.ok(fidelity.results.every((r) => r.layout === 'flow'));
});

test('rebuilds a plain responsive site as flow layout, without pinned coordinates', () => {
  assert.ok(!read('site', 'src', 'styles', 'index.css').includes('position: absolute'));
});

test('keeps the stylesheet small', () => {
  const bytes = fs.statSync(path.join(work, 'site', 'src', 'styles', 'index.css')).size;
  assert.ok(bytes < 12_000, `index.css is ${bytes} bytes`);
});

test('leaves a self-contained project behind', () => {
  assert.ok(!fs.existsSync(path.join(work, 'site', 'node_modules')));
  assert.ok(fs.existsSync(path.join(work, 'site', 'package.json')));
});

test('never overflows sideways, also at widths that were not measured', async () => {
  const distServer = await serve(path.join(work, 'site', 'dist'));
  const browser = await chromium.launch();
  try {
    for (const width of [1920, 1100, 900, 414, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      await page.goto(`http://localhost:${distServer.address().port}/`, { waitUntil: 'load' });
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(scrollWidth <= width + 1, `at ${width}px the page is ${scrollWidth}px wide`);
      await page.close();
    }
  } finally {
    await browser.close();
    distServer.close();
  }
});
