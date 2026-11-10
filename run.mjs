#!/usr/bin/env node
// One-command migration: opensiteexit <url> [--max-pages N] [--work DIR] [--no-fallback]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
if (!target) { console.error('usage: opensiteexit <url> [--max-pages N] [--work DIR] [--no-fallback]'); process.exit(1); }
const maxPages = args.includes('--max-pages') ? args[args.indexOf('--max-pages') + 1] : '10';
const work = args.includes('--work') ? args[args.indexOf('--work') + 1] : path.join('work', new URL(target).hostname);
const FALLBACK_BELOW = 0.75; // worst-viewport content match that triggers a pinned rebuild

const run = (script, extra) => execFileSync('node', [path.join(HERE, script), ...extra], { stdio: 'inherit' });
const dirs = ['--study', path.join(work, 'study'), '--site', path.join(work, 'site'), '--out', path.join(work, 'fidelity-report')];
const build = (pinned) => run('build.mjs', [...dirs.slice(0, 2), '--out', path.join(work, 'site'), ...(pinned.length ? ['--pin-all', pinned.join(',')] : [])]);
const check = () => {
  run('check.mjs', dirs);
  const fid = JSON.parse(fs.readFileSync(path.join(work, 'fidelity-report', 'fidelity.json'), 'utf8'));
  const scores = {};
  for (const r of fid.results) {
    if (r.error) continue;
    const vals = Object.values(r.viewports).map((v) => v.aligned ?? v.similarity);
    scores[r.slug] = { worst: Math.min(...vals), mean: vals.reduce((a, b) => a + b, 0) / vals.length };
  }
  return scores;
};

run('study.mjs', [target, '--max-pages', maxPages, '--out', path.join(work, 'study')]);
build([]);
const flow = check();

if (!args.includes('--no-fallback')) {
  const weak = Object.keys(flow).filter((slug) => flow[slug].worst < FALLBACK_BELOW);
  if (weak.length) {
    console.log(`\n[run] ${weak.length} page(s) under ${FALLBACK_BELOW * 100}%, rebuilding pinned: ${weak.join(', ')}`);
    build(weak);
    const pinned = check();
    // flow layout is the better deliverable, so a pinned page has to earn its place
    const keep = weak.filter((slug) => pinned[slug] && pinned[slug].mean > flow[slug].mean);
    if (keep.length < weak.length) {
      console.log(`\n[run] pinning did not help ${weak.length - keep.length} page(s), restoring flow layout for those`);
      build(keep);
      check();
    }
  }
}
const final = JSON.parse(fs.readFileSync(path.join(work, 'fidelity-report', 'fidelity.json'), 'utf8'));
if (final.incompleteOriginal) console.warn('\n[run] warning: some originals did not finish loading (see the report). Run again before relying on these scores.');
console.log(`\nDeliverables:\n  Astro project:   ${path.join(work, 'site')}\n  Fidelity report: ${path.join(work, 'fidelity-report', 'index.html')}`);
console.log(`\nPages under target? Write refinement briefs with:\n  node ${path.relative(process.cwd(), path.join(HERE, 'refine.mjs')) || 'refine.mjs'} --work ${work}`);
