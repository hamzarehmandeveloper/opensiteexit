// Stage 4 — REFINE: turn fidelity results into per-page refinement briefs,
// optionally run a coding agent on each, then re-check.
// Usage: node refine.mjs [--work DIR] [--threshold 0.9] [--max-pages 3] [--agent "<cmd>"]
import fs from 'node:fs';
import path from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const work = args.includes('--work') ? args[args.indexOf('--work') + 1] : 'work/sqsp';
const threshold = Number(args.includes('--threshold') ? args[args.indexOf('--threshold') + 1] : 0.9);
const maxPages = Number(args.includes('--max-pages') ? args[args.indexOf('--max-pages') + 1] : 3);
const agentCmd = args.includes('--agent') ? args[args.indexOf('--agent') + 1] : null;

const reportDir = path.join(work, 'fidelity-report');
const siteDir = path.join(work, 'site');
const studyDir = path.join(work, 'study');
const briefDir = path.join(work, 'refine');
const fidelity = JSON.parse(fs.readFileSync(path.join(reportDir, 'fidelity.json'), 'utf8'));
fs.mkdirSync(briefDir, { recursive: true });

const ranked = fidelity.results
  .filter((r) => !r.error)
  .map((r) => {
    const worst = Math.min(...Object.values(r.viewports).map((v) => v.aligned ?? v.similarity));
    return { ...r, worst };
  })
  .filter((r) => r.worst < threshold)
  .sort((a, b) => a.worst - b.worst)
  .slice(0, maxPages);

if (!ranked.length) {
  console.log(`[refine] nothing under threshold ${threshold}; done.`);
  process.exit(0);
}

const briefs = [];
for (const r of ranked) {
  const vpLines = Object.entries(r.viewports)
    .map(([vp, v]) => `- **${vp}**: content match ${(100 * (v.aligned ?? v.similarity)).toFixed(1)}%, strict ${(100 * v.similarity).toFixed(1)}%`)
    .join('\n');
  const astroFile = r.slug === 'index' ? 'src/pages/index.astro' : `src/pages/${r.slug.replace(/__/g, '/')}.astro`;
  const brief = `# Refinement brief: ${r.path}

## Goal
Raise this page's visual similarity to the original above ${(threshold * 100).toFixed(0)}% content match
at every viewport, WITHOUT changing its text content, links, or meta tags.

## Current scores
${vpLines}

## Files you may edit (Astro project root: ${path.resolve(siteDir)})
- ${astroFile}
- src/styles/${r.slug}.css

## Reference material (read, do not edit)
- Original screenshots: ${path.resolve(studyDir, 'pages', r.slug)}/original-{desktop,tablet,mobile}.png
- Rebuilt screenshots:  ${path.resolve(reportDir, 'img')}/${r.slug}-rebuilt-{desktop,tablet,mobile}.png
- Diff overlays (red = mismatch): ${path.resolve(reportDir, 'img')}/${r.slug}-diff-{desktop,tablet,mobile}.png
- Measured evidence (computed styles + geometry per element, 3 viewports): ${path.resolve(studyDir, 'pages', r.slug, 'evidence.json')}

## Method
1. Look at the original vs rebuilt screenshots at each viewport; identify the 2–3 largest visual defects by area.
2. Fix them in the page's CSS (preferred) or markup. Class names map to data in evidence.json.
3. Common defect classes seen in this pipeline: image crop/scale (use measured aspect-ratio + object-fit),
   hero background position/size, missing background layers, column layout at tablet/mobile, font fallback width.
4. Do not fabricate content; everything you need is measured in evidence.json.

## Acceptance (run from ${path.resolve('.')})
node check.mjs --study ${studyDir} --site ${siteDir} --out ${reportDir} --only ${r.slug}
The page passes when every viewport's content match is >= ${(threshold * 100).toFixed(0)}%.
`;
  const briefPath = path.join(briefDir, `${r.slug}.md`);
  fs.writeFileSync(briefPath, brief);
  briefs.push({ slug: r.slug, path: r.path, worst: r.worst, briefPath });
  console.log(`[refine] brief: ${briefPath} (worst ${(r.worst * 100).toFixed(1)}%)`);
}

if (!agentCmd) {
  console.log(`\n[refine] ${briefs.length} brief(s) written. Run an agent on them, e.g.:`);
  for (const b of briefs) console.log(`  claude -p "$(cat ${b.briefPath})"`);
  process.exit(0);
}

for (const b of briefs) {
  console.log(`[refine] agent pass on ${b.path}…`);
  const prompt = fs.readFileSync(b.briefPath, 'utf8');
  try {
    execSync(`${agentCmd} ${JSON.stringify(prompt)}`, { stdio: 'inherit', timeout: 15 * 60 * 1000 });
    execFileSync('node', [path.join(HERE, 'check.mjs'), '--study', studyDir, '--site', siteDir, '--out', reportDir, '--only', b.slug], { stdio: 'inherit' });
  } catch (e) {
    console.error(`[refine] agent pass failed for ${b.path}: ${e.message}`);
  }
}
console.log('[refine] done.');
