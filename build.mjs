// Stage 2 — BUILD: generate an Astro project from the study evidence.
// Usage: node build.mjs [--study DIR] [--out DIR] [--pin-all slug,…|all]
import fs from 'node:fs';
import path from 'node:path';
import { SAFE_TAGS, VIEWPORTS, escapeHtml } from './lib/common.mjs';

const args = process.argv.slice(2);
const studyDir = args.includes('--study') ? args[args.indexOf('--study') + 1] : 'work/study';
const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'work/site';
// --pin-all: emit measured absolute coordinates per viewport, for fixed-canvas
// builders whose transform/overlay layouts can't be reproduced as flow
const pinAllArg = args.includes('--pin-all') ? (args[args.indexOf('--pin-all') + 1] || 'all') : null;
const pinAllSlugs = pinAllArg ? new Set(pinAllArg.split(',')) : null;

const site = JSON.parse(fs.readFileSync(path.join(studyDir, 'site.json'), 'utf8'));
const VPS = VIEWPORTS.map((v) => v.name);
const DESIGN_W = Object.fromEntries(VIEWPORTS.map((v) => [v.name, v.width]));
const VOID = new Set(['img', 'hr', 'input', 'br']);

const px = (v) => parseFloat(v) || 0;
const isText = (n) => n.tag === '#text';
const kebab = (prop) => prop.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
// .astro templates treat braces as expressions
const esc = (s) => escapeHtml(s).replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, 'src/pages'), { recursive: true });
fs.mkdirSync(path.join(outDir, 'src/styles'), { recursive: true });
fs.mkdirSync(path.join(outDir, 'public/assets'), { recursive: true });

for (const name of Object.values(site.assetMap)) {
  const src = path.join(studyDir, 'assets', name);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(outDir, 'public/assets', name));
}

const internalPaths = new Set(site.pages.map((p) => p.path.replace(/\/$/, '') || '/'));

function localHref(href, pageUrl) {
  if (!href) return null;
  try {
    const u = new URL(href, pageUrl);
    if (u.origin !== new URL(site.origin).origin) return u.href;
    const key = u.pathname.replace(/\/$/, '') || '/';
    if (internalPaths.has(key)) return (key === '/' ? '/' : key + '/') + u.hash;
    return u.pathname + u.search + u.hash;
  } catch { return href; }
}

const localSrc = (src) => (site.assetMap[src] ? `/assets/${site.assetMap[src]}` : src);

// ---------------------------------------------------------------- styles

const RESET = [
  `*, *::before, *::after { box-sizing: border-box; }`,
  `* { margin: 0; padding: 0; }`,
  // every element inherits type by default, so a rule is only emitted where the
  // measured value differs from the parent's
  `h1, h2, h3, h4, h5, h6, b, strong, em, i, small, th, address, code, pre, button, input, textarea, a, sup, sub { font: inherit; color: inherit; letter-spacing: inherit; text-transform: inherit; text-align: inherit; white-space: inherit; }`,
  `a { text-decoration: none; }`,
  `ul, ol { list-style: inherit; }`,
  `img { display: block; max-width: 100%; }`,
  `button { cursor: pointer; border: 0; background: none; }`,
];

const INHERITED = new Set([
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing',
  'color', 'textAlign', 'textTransform', 'listStyleType', 'whiteSpace',
]);
const DEFAULTS = {
  position: 'static', float: 'none', clear: 'none', backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none', boxShadow: 'none',
  textDecorationLine: 'none', borderRadius: '0px', opacity: '1', overflow: 'visible', objectFit: 'fill',
  aspectRatio: 'auto', objectPosition: '50% 50%', clipPath: 'none', zIndex: 'auto', verticalAlign: 'baseline', order: '0', alignSelf: 'auto',
  flexGrow: '0', flexShrink: '1', flexBasis: 'auto', maxWidth: 'none', gridTemplateColumns: 'none',
  paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px',
  marginTop: '0px', marginRight: '0px', marginBottom: '0px', marginLeft: '0px',
  gap: 'normal', flexDirection: 'row', flexWrap: 'nowrap', justifyContent: 'normal', alignItems: 'normal',
};
const NEVER = new Set(['width', 'height', 'rowGap', 'columnGap']);
const FLEX_ONLY = new Set(['flexDirection', 'flexWrap', 'justifyContent', 'alignItems', 'gap', 'gridTemplateColumns']);
const OFFSETS = new Set(['top', 'left', 'right', 'bottom']);
const SIDES = ['Top', 'Right', 'Bottom', 'Left'];
const BLOCK_TAGS = new Set(['div', 'section', 'header', 'footer', 'main', 'nav', 'aside', 'article', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'figure', 'figcaption', 'blockquote', 'form', 'address', 'pre', 'hr', 'img']);
const INLINE_TAGS = new Set(['a', 'span', 'strong', 'em', 'b', 'i', 'small', 'sup', 'sub', 'code', 'label', 'time', 'picture']);
const uaDisplay = (tag) => (BLOCK_TAGS.has(tag) ? 'block' : INLINE_TAGS.has(tag) ? 'inline' : tag === 'li' ? 'list-item' : null);

// Is this property worth stating at all, given the element's other styles?
function relevant(prop, s) {
  if (NEVER.has(prop) || prop.startsWith('__') || prop.startsWith('border') && prop !== 'borderRadius') return false;
  const display = s.display || '';
  if (FLEX_ONLY.has(prop)) return display.includes('flex') || display.includes('grid');
  if (prop === 'backgroundSize' || prop === 'backgroundPosition' || prop === 'backgroundRepeat') return s.backgroundImage && s.backgroundImage !== 'none';
  // an SVG clip shape lives in the original document and cannot be referenced from here
  if (prop === 'clipPath') return !s.clipPath.includes('url(');
  if (OFFSETS.has(prop)) return s.position && s.position !== 'static' && s[prop] !== 'auto';
  if (prop === 'minHeight') return s.minHeight !== '0px' && s.minHeight !== 'auto';
  return true;
}

function declaration(prop, val) {
  if (prop === 'backgroundImage') {
    const m = val.match(/url\("?([^")]+)"?\)/);
    if (m) return `background-image: url('${localSrc(m[1])}')`;
    if (!val.includes('gradient')) return 'background-image: none';
  }
  return `${kebab(prop)}: ${val}`;
}

const borderOf = (s, side) => {
  const w = px(s[`border${side}Width`]);
  const style = s[`border${side}Style`] || 'solid';
  return w > 0 && style !== 'none' ? `${w}px ${style} ${s[`border${side}Color`]}` : null;
};

// ---------------------------------------------------------------- tree

// A wrapper that occupies exactly its only child's box and paints nothing adds
// depth without meaning. Removing it must be safe at every measured width.
function isPassThrough(w, parent, page) {
  if (w.tag !== 'div' && SAFE_TAGS.has(w.tag)) return false;
  if (w.text || w.children.length !== 1 || isText(w.children[0])) return false;
  const c = w.children[0];
  for (const vp of VPS) {
    const sw = page.stylesByViewport[vp]?.[w.id];
    const sc = page.stylesByViewport[vp]?.[c.id];
    const sp = page.stylesByViewport[vp]?.[parent.id];
    if (!sw || !sc || !sp) return false;
    if (sw.display === 'none' || sw.zIndex !== 'auto' || sw.opacity !== '1' || sw.overflow !== 'visible') return false;
    if ((sw.float || 'none') !== 'none' || (sc.float || 'none') !== 'none') return false;
    if (sw.backgroundColor !== DEFAULTS.backgroundColor || sw.backgroundImage !== 'none' || sw.boxShadow !== 'none') return false;
    if (SIDES.some((side) => borderOf(sw, side))) return false;
    if (['X', 'Y', 'W', 'H'].some((k) => Math.abs(sw[`__rect${k}`] - sc[`__rect${k}`]) > 1)) return false;
    if (page.pinAll) continue;
    if (sw.display !== 'block' || sp.display !== 'block' || sw.position !== 'static' || sw.maxWidth !== 'none') return false;
    if (!['block', 'flex', 'grid'].includes(sc.display)) return false;
    if (SIDES.some((side) => px(sw[`padding${side}`]) || px(sw[`margin${side}`]))) return false;
  }
  return true;
}

function collapseWrappers(n, page) {
  n.children = n.children.map((c) => {
    if (isText(c)) return c;
    let w = c;
    while (isPassThrough(w, n, page)) w = w.children[0];
    return collapseWrappers(w, page);
  });
  return n;
}

function renderNode(n, ctx, o) {
  const { page, base, media } = ctx;
  const { parent, prevSib, pinParent, inline } = o;
  if (isText(n)) return esc(n.text);

  const tag = SAFE_TAGS.has(n.tag) ? n.tag : 'div';
  const pad = inline ? '' : '  '.repeat(o.indent);
  const nl = inline ? '' : '\n';
  const S = (vp, node = n) => page.stylesByViewport[vp]?.[node.id];
  const desktop = S('desktop') || {};
  const elementKids = n.children.filter((c) => !isText(c));
  const display = desktop.display || '';

  const isAbsContainer = elementKids.filter((c) => S('desktop', c)?.position === 'absolute').length >= 2;
  // Wix mosaics are overlapping one-cell grids; their children get pinned from measured rects
  // (a single grid child is pinned too: its column placement is not measured)
  const isGridContainer = display.includes('grid') && elementKids.length >= 1;
  const isPinContainer = isAbsContainer || isGridContainer || page.pinAll;
  const pinned = !!pinParent;
  const isRoot = n.id === page.tree.id;

  const inheritsEverywhere = (prop) => parent && VPS.every((vp) => !S(vp) || !S(vp, parent) || S(vp)[prop] === S(vp, parent)[prop]);

  // base rule: desktop values that differ from the parent (inherited) or the default
  const decls = [];
  for (const [prop, val] of Object.entries(desktop)) {
    if (val == null || val === '' || !relevant(prop, desktop)) continue;
    if (INHERITED.has(prop)) { if (inheritsEverywhere(prop)) continue; }
    else if (prop === 'display') { if (val === uaDisplay(tag)) continue; }
    else if (DEFAULTS[prop] === val) continue;
    decls.push(declaration(prop, val));
  }
  for (const side of SIDES) {
    const b = borderOf(desktop, side);
    if (b) decls.push(`border-${side.toLowerCase()}: ${b}`);
  }

  // measured geometry for flow layout, per viewport: a row that stacks on a
  // phone must not keep its desktop column widths
  const textOnlyLeaf = !n.children.length && n.text;
  const rectOf = (vp, node) => {
    const s = S(vp, node);
    return s && s.__rectW != null ? { x: s.__rectX, y: s.__rectY, w: s.__rectW, h: s.__rectH } : null;
  };
  const flowGeometry = (vp) => {
    const s = S(vp), r = rectOf(vp, n), g = {};
    if (!s || !r || pinned) return g;
    const ps = parent && S(vp, parent);
    const parentW = parent ? (ps ? Math.max(1, ps.__rectW - px(ps.paddingLeft) - px(ps.paddingRight)) : 0) : DESIGN_W[vp];
    const disp = s.display || '';
    if (parentW && r.w) {
      const ratio = r.w / parentW;
      // content measured as a single line must stay on one line, even when a
      // fallback font or a rounded width leaves it a pixel short
      const contentH = r.h - px(s.paddingTop) - px(s.paddingBottom);
      const lineH = px(s.lineHeight) || px(s.fontSize) * 1.2;
      if (tag !== 'img' && contentH >= lineH * 0.5 && contentH <= lineH * 1.5 && (s.whiteSpace || 'normal') === 'normal') g['white-space'] = 'nowrap';
      // the padding trick for fixed-ratio boxes: all padding, no content height
      if (contentH <= 1 && px(s.paddingTop) + px(s.paddingBottom) >= 8 && elementKids.length) g.height = '0';
      if (tag === 'img') {
        // replaced elements fall back to their intrinsic size without a width
        if (ratio > 0.03) g.width = `${Math.min(100, ratio * 100).toFixed(2)}%`;
      } else if (disp !== 'inline' && ratio > 0.03 && (!textOnlyLeaf || ratio > 0.45)) {
        // text-only leaves size naturally: forced widths + fallback fonts cause wrapping.
        // Only a plain block fills its parent on its own; a flex item or a
        // positioned box as wide as its parent still has to be told so.
        const pd = ps?.display || 'block';
        const fillsByItself = pd === 'block' && disp === 'block' && !['absolute', 'fixed'].includes(s.position);
        if (ratio < 0.97 || !fillsByItself) g.width = `${(ratio * 100).toFixed(2)}%`;
        if (disp.includes('flex') && ratio < 0.5) g['min-width'] = 'fit-content';
      }
    }
    const pr = prevSib && rectOf(vp, prevSib);
    if (pr && !(ps && px(ps.gap) > 0) && px(s.marginLeft) === 0) {
      const sameRow = r.y < pr.y + pr.h && r.y + r.h > pr.y;
      const hgap = r.x - (pr.x + pr.w);
      if (sameRow && hgap > 2 && hgap < 300) g['margin-left'] = `${hgap}px`;
    }
    return g;
  };
  const geometryReset = (prop, s) => ({ width: 'auto', height: 'auto', 'min-width': 'auto', 'margin-left': s.marginLeft || '0px', 'white-space': s.whiteSpace || 'normal' })[prop];

  const extras = Object.entries(flowGeometry('desktop')).map(([k, v]) => `${k}: ${v}`);
  if (tag === 'img' && !pinned && desktop.__rectH > 1) extras.push(`aspect-ratio: ${desktop.__rectW} / ${desktop.__rectH}`);

  const pinRule = (vp) => {
    const s = S(vp), ps = page.stylesByViewport[vp]?.[pinParent];
    if (!s || !ps || s.__rectX == null || ps.__rectX == null) return null;
    return `position: absolute; left: ${s.__rectX - ps.__rectX}px; top: ${s.__rectY - ps.__rectY}px; width: ${s.__rectW}px; height: ${s.__rectH}px; margin: 0`;
  };
  // the root's own box can lie (Wix pins body to the viewport), so the root
  // takes the measured extent of the whole page instead
  const pinHeight = (vp) => (isRoot ? page.pageHeights[vp] : S(vp)?.__rectH) || 0;
  const anchored = (vp) => {
    const s = S(vp);
    return s && s.__rectH > 150 && display !== 'inline' && tag !== 'img' && !pinned && !isPinContainer;
  };

  if (isPinContainer) {
    if ((desktop.position || 'static') === 'static') extras.push('position: relative');
    if (isGridContainer) extras.push('display: block');
    if (pinHeight('desktop')) extras.push(`height: ${pinHeight('desktop')}px`);
  }
  if (pinned && pinRule('desktop')) extras.push(pinRule('desktop'));
  const paintsImage = desktop.backgroundImage && desktop.backgroundImage !== 'none' && desktop.__rectH > 40;
  if (anchored('desktop') || (paintsImage && !pinned && !isPinContainer)) extras.push(`min-height: ${desktop.__rectH}px`);
  if (decls.length || extras.length) base.push(`.${n.id} { ${[...decls, ...extras].join('; ')}; }`);

  // narrower viewports: only what changed since the next wider one
  let prev = desktop;
  for (const vp of VPS.slice(1)) {
    const cur = S(vp);
    if (!cur) continue;
    const d = [];
    for (const [prop, val] of Object.entries(cur)) {
      if (val === prev[prop] || val == null || val === '') continue;
      if (prop === 'display' ? false : !relevant(prop, cur)) continue;
      if (INHERITED.has(prop) && inheritsEverywhere(prop)) continue;
      if (OFFSETS.has(prop) && (pinned || !['absolute', 'fixed'].includes(cur.position))) continue;
      d.push(declaration(prop, val));
    }
    for (const side of SIDES) {
      const b = borderOf(cur, side);
      if (b !== borderOf(prev, side)) d.push(`border-${side.toLowerCase()}: ${b || '0'}`);
    }
    const gPrev = flowGeometry(VPS[VPS.indexOf(vp) - 1]), gCur = flowGeometry(vp);
    for (const prop of new Set([...Object.keys(gPrev), ...Object.keys(gCur)])) {
      if (gPrev[prop] !== gCur[prop]) d.push(`${prop}: ${gCur[prop] ?? geometryReset(prop, cur)}`);
    }
    if (isPinContainer && pinHeight(vp)) d.push(`height: ${pinHeight(vp)}px`);
    if (pinned && pinRule(vp)) d.push(pinRule(vp));
    if (anchored(vp)) d.push(`min-height: ${cur.__rectH}px`);
    if (tag === 'img' && !pinned && cur.__rectW > 0 && cur.__rectH > 0) d.push(`aspect-ratio: ${cur.__rectW} / ${cur.__rectH}`);
    if (d.length) media[vp].push(`.${n.id} { ${d.join('; ')}; }`);
    prev = cur;
  }

  let attrs = ` class="${n.id}"`;
  if (tag === 'a' && n.href) attrs += ` href="${esc(localHref(n.href, page.url))}"`;
  if (tag === 'img' && n.src) attrs += ` src="${esc(localSrc(n.src))}" alt="${esc(n.alt)}" loading="lazy"`;
  if (tag === 'input') attrs += ` type="${esc(n.type || 'text')}" placeholder="${esc(n.placeholder || '')}"`;
  if (VOID.has(tag)) return `${pad}<${tag}${attrs} />${nl}`;

  let html = `${pad}<${tag}${attrs}>`;
  if (n.text) html += esc(n.text);
  if (n.children.length) {
    // mixed text and inline elements are written on one line: a newline between
    // them would render as a space the original doesn't have
    const mixed = inline || n.children.some(isText);
    let prevElement = null;
    if (!mixed) html += '\n';
    for (const c of n.children) {
      const cs = isText(c) ? null : S('desktop', c);
      const pinChild = cs && isPinContainer && cs.display !== 'inline'
        && (isGridContainer || page.pinAll || cs.position === 'absolute');
      html += renderNode(c, ctx, {
        indent: o.indent + 1, parent: n, prevSib: prevElement, pinParent: pinChild ? n.id : null, inline: mixed,
      });
      // a gap between siblings is only theirs to reproduce when no text sits in it
      prevElement = isText(c) ? null : c;
    }
    if (!mixed) html += pad;
  }
  return `${html}</${tag}>${nl}`;
}

// ---------------------------------------------------------------- pages

function googleFontsLink(page) {
  const fams = new Set();
  for (const s of Object.values(page.stylesByViewport.desktop)) {
    const f = (s.fontFamily || '').split(',')[0].replace(/["']/g, '').trim();
    if (f && !/^(-apple|system|serif|sans-serif|monospace|arial|helvetica|georgia|times|verdana|ui-)/i.test(f)) fams.add(f);
  }
  if (!fams.size) return '';
  const q = [...fams].slice(0, 4).map((f) => `family=${encodeURIComponent(f)}:wght@300;400;500;600;700`).join('&');
  return `<link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="stylesheet" href="https://fonts.googleapis.com/css2?${q}&display=swap" />`;
}

// The layout is measured at three widths. Between them the page scales to fit,
// so it never overflows at a width nobody measured.
const fitScript = (pinned) => `<script is:inline>
      (function () {
        var d = document.documentElement;
        function fit() {
          var w = d.clientWidth || innerWidth;
          var design = w > 1024 ? ${DESIGN_W.desktop} : w > 640 ? ${DESIGN_W.tablet} : ${DESIGN_W.mobile};
          var wide = design === ${DESIGN_W.desktop} && w >= design;
          d.style.setProperty('--fit-width', wide ? '${pinned ? DESIGN_W.desktop + 'px' : 'auto'}' : design + 'px');
          d.style.setProperty('--fit-zoom', wide ? '1' : String(w / design));
        }
        fit();
        addEventListener('resize', fit);
      })();
    </script>`;

const urlOf = (p) => site.origin + p.path;
const redirects = [];
for (const slim of site.pages) {
  const evidence = JSON.parse(fs.readFileSync(path.join(studyDir, 'pages', slim.slug, 'evidence.json'), 'utf8'));
  const page = { ...evidence, slug: slim.slug, path: slim.path, pinAll: !!(pinAllSlugs && (pinAllSlugs.has('all') || pinAllSlugs.has(slim.slug))) };
  page.pageHeights = {};
  for (const [vp, styles] of Object.entries(page.stylesByViewport)) {
    let maxY = 0;
    for (const s of Object.values(styles)) {
      if (s.position === 'fixed' || s.__rectY == null) continue;
      maxY = Math.max(maxY, s.__rectY + s.__rectH);
    }
    page.pageHeights[vp] = maxY;
  }
  collapseWrappers(page.tree, page);

  const ctx = { page, base: [...RESET], media: { tablet: [], mobile: [] } };
  const bodyHtml = renderNode(page.tree, ctx, { indent: 2, parent: null });
  ctx.base.push(`.${page.tree.id} { width: var(--fit-width, auto); zoom: var(--fit-zoom, 1); margin-inline: auto; }`);

  const css = [
    ...ctx.base,
    ctx.media.tablet.length ? `@media (max-width: 1024px) {\n${ctx.media.tablet.join('\n')}\n}` : '',
    ctx.media.mobile.length ? `@media (max-width: 640px) {\n${ctx.media.mobile.join('\n')}\n}` : '',
  ].filter(Boolean).join('\n') + '\n';
  fs.writeFileSync(path.join(outDir, 'src/styles', `${page.slug}.css`), css);

  const astroPath = page.slug === 'index' ? 'index.astro' : `${page.slug.replace(/__/g, '/')}.astro`;
  fs.mkdirSync(path.dirname(path.join(outDir, 'src/pages', astroPath)), { recursive: true });
  // a page at src/pages/<a>/<b>/x.astro needs depth+1 "../" hops to reach src/styles/
  const styleRel = '../'.repeat(astroPath.split('/').length) + `styles/${page.slug}.css`;
  const astro = `---
import '${styleRel}';
---
<!doctype html>
<html lang="${esc(page.meta.lang)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(page.meta.title)}</title>
    <meta name="description" content="${esc(page.meta.description)}" />
    <link rel="canonical" href="${esc(page.meta.canonical || urlOf(page))}" />
    <meta name="generator" content="OpenSiteExit (${page.pinAll ? 'pinned' : 'flow'} layout)" />
    <meta property="og:title" content="${esc(page.meta.title)}" />
    <meta property="og:description" content="${esc(page.meta.description)}" />
    ${googleFontsLink(page)}
    ${fitScript(page.pinAll)}
  </head>
  <body>
${bodyHtml}  </body>
</html>
`;
  fs.writeFileSync(path.join(outDir, 'src/pages', astroPath), astro);
  if (page.path !== '/') {
    const bare = page.path.replace(/\/$/, '');
    redirects.push(`${bare}  ${bare}/  301`);
  }
  console.log(`[build] ${page.path} -> src/pages/${astroPath} (${(css.length / 1024).toFixed(0)} KB css${page.pinAll ? ', pinned' : ''})`);
}

fs.writeFileSync(path.join(outDir, 'public/_redirects'), redirects.join('\n') + '\n');
fs.writeFileSync(path.join(outDir, 'public/sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${site.pages.map((p) => `  <url><loc>${escapeHtml(urlOf(p))}</loc></url>`).join('\n')}
</urlset>
`);
fs.writeFileSync(path.join(outDir, 'public/robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${site.origin}/sitemap.xml\n`);
fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify({
  name: 'migrated-site', private: true, type: 'module',
  scripts: { dev: 'astro dev', build: 'astro build', preview: 'astro preview' },
  dependencies: { astro: '^5.0.0' },
}, null, 2) + '\n');
fs.writeFileSync(path.join(outDir, 'astro.config.mjs'), `import { defineConfig } from 'astro/config';\n\nexport default defineConfig({});\n`);
fs.writeFileSync(path.join(outDir, '.gitignore'), 'node_modules/\ndist/\n.astro/\n');
fs.writeFileSync(path.join(outDir, 'README.md'), `# Your migrated site

Generated from ${site.target} on ${site.crawledAt.slice(0, 10)} by OpenSiteExit.

## Run it

\`\`\`sh
npm install
npm run dev      # preview at http://localhost:4321
npm run build    # static output in dist/, deploy it anywhere
\`\`\`

## What is here

- \`src/pages/\` has one \`.astro\` file per page, at the same URL path as before.
- \`src/styles/\` has one stylesheet per page. Class names like \`e42\` are
  generated; each rule holds the styles measured for that element.
- \`public/assets/\` holds your images. \`public/sitemap.xml\`, \`robots.txt\`
  and \`_redirects\` keep search engines pointed at the same URLs.

## Editing

Change text and links directly in the \`.astro\` files. The layout was measured
at ${VIEWPORTS.map((v) => v.width).join(', ')} px; between those widths a small script in each
page's head scales the page to fit. Pages marked "pinned" in the build log use
measured coordinates, so adding much more text to one of them means adjusting
the heights in its stylesheet.

Menus, sliders, forms and other scripted behaviour from the original site are
not reproduced. Forms need a form service or your own endpoint.
`);
console.log(`[build] done -> ${outDir}`);
