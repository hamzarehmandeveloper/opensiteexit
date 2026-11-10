export const VIEWPORTS = [
  { name: 'desktop', width: 1366, height: 900 },
  { name: 'tablet', width: 768, height: 900 },
  { name: 'mobile', width: 375, height: 760 },
];

// Computed-style properties we measure ("what a visitor sees").
export const STYLE_PROPS = [
  'display', 'position', 'float', 'clear', 'flexDirection', 'flexWrap', 'justifyContent', 'alignItems',
  'gap', 'rowGap', 'columnGap', 'gridTemplateColumns',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'width', 'maxWidth', 'minHeight', 'height',
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing',
  'color', 'backgroundColor', 'backgroundImage', 'backgroundSize', 'backgroundPosition', 'backgroundRepeat',
  'textAlign', 'textTransform', 'textDecorationLine',
  'borderRadius', 'borderTopWidth', 'borderTopStyle', 'borderTopColor',
  'borderBottomWidth', 'borderBottomStyle', 'borderBottomColor',
  'borderLeftWidth', 'borderLeftStyle', 'borderLeftColor',
  'borderRightWidth', 'borderRightStyle', 'borderRightColor',
  'boxShadow', 'opacity', 'overflow', 'objectFit', 'objectPosition', 'clipPath', 'aspectRatio',
  'listStyleType', 'flexGrow', 'flexShrink', 'flexBasis', 'alignSelf', 'order',
  'top', 'left', 'right', 'bottom', 'zIndex', 'verticalAlign', 'whiteSpace',
];

export const SAFE_TAGS = new Set([
  'div', 'section', 'header', 'footer', 'main', 'nav', 'aside', 'article',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'span', 'strong', 'em', 'b', 'i',
  'ul', 'ol', 'li', 'img', 'button', 'figure', 'figcaption', 'blockquote',
  'table', 'thead', 'tbody', 'tr', 'td', 'th', 'hr', 'form', 'input', 'textarea', 'label',
  'picture', 'time', 'address', 'small', 'sup', 'sub', 'code', 'pre',
]);

export function pagePathToSlug(urlPath) {
  const clean = urlPath.replace(/\/+$/, '').replace(/^\/+/, '');
  if (!clean) return 'index';
  return clean.replace(/[^a-zA-Z0-9/_-]/g, '_').replace(/\//g, '__');
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Hide cookie/consent overlays and freeze animation before screenshots.
export const STABILIZE_CSS = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
    caret-color: transparent !important;
  }
  html { scroll-behavior: auto !important; }
  [id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i],
  [id*="gdpr" i], [class*="gdpr" i], [aria-label*="cookie" i] {
    display: none !important;
  }
`;

// Promo popups and modal dialogs are transient state, not page content: hide
// them so they are neither measured nor baked into the rebuild.
const HIDE_OVERLAYS = `(() => {
  const area = innerWidth * innerHeight;
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' || cs.display === 'none') continue;
    const r = el.getBoundingClientRect();
    const isDialog = el.getAttribute('role') === 'dialog' || el.getAttribute('aria-modal') === 'true';
    const sig = el.id + ' ' + (typeof el.className === 'string' ? el.className : '') + ' ' + (el.getAttribute('data-slide-type') || '');
    const named = /popup|modal|lightbox|overlay|newsletter|interstitial/i.test(sig);
    if (isDialog || (named && r.width * r.height >= area * 0.25)) el.style.setProperty('display', 'none', 'important');
  }
})()`;

export async function preparePage(page) {
  await page.addStyleTag({ content: STABILIZE_CSS }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await page.evaluate(HIDE_OVERLAYS).catch(() => {});
  // trigger lazy-loading, then return to top
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let y = 0;
      const step = () => {
        y += 600;
        window.scrollTo(0, y);
        if (y < document.body.scrollHeight) setTimeout(step, 60);
        else { window.scrollTo(0, 0); setTimeout(resolve, 250); }
      };
      step();
    });
  }).catch(() => {});
  await page.waitForTimeout(400);
}
