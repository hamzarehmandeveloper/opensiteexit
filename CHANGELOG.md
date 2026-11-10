# Changelog

## 0.2.0 — 2026-11-10

The output is now meant to be kept, not only scored.

### Fixed

- Sentences containing links or bold text keep their word order. Inline
  elements were previously moved to the end of their paragraph.
- Promo popups and modal dialogs are hidden before measuring, so they are no
  longer baked into the rebuilt page.
- Pages no longer overflow sideways between the measured widths. A small head
  script scales the layout to fit any viewport.
- Flex items and positioned boxes that are as wide as their parent keep their
  width. They used to collapse to zero and take their images with them.
- Column widths and gaps are measured per viewport. A row that stacks on a
  phone no longer keeps its desktop column widths.
- Page text containing `{` or `}` no longer breaks the Astro build.
- A crawl that reads no pages exits with an error instead of reporting 0%.

### Added

- `sitemap.xml`, `robots.txt` and canonical tags in every generated site.
- Stylesheets state a property only where it differs from the parent or the
  default, which cuts generated CSS by about 80%.
- Wrapper elements that add depth without changing layout are removed.
- Clip shapes and image focal positions are measured and reproduced.
- The fidelity report lists each page's layout mode and stylesheet size, and
  warns when an original did not finish loading or when images in the rebuild
  are not visible.
- `run.mjs` keeps pinned layout for a page only when it scores better than
  flow layout.
- Astro is installed once into a shared cache instead of once per run.
- `opensiteexit` command, an end-to-end test suite (`npm test`) and CI.

## 0.1.0 — 2026-11-04

Initial release.

- Four-stage pipeline: study (crawl + measure), build (evidence → Astro),
  check (pixel comparison + fidelity report), refine (agent-ready briefs).
- Two layout engines: responsive flow (default) and pin-all (measured
  absolute coordinates per viewport) with automatic fallback in `run.mjs`.
- Fidelity report with strict and alignment-tolerant metrics, side-by-side
  screenshots, diff overlays, and SEO parity.
- SEO preservation: meta carry-over and generated `_redirects` map.
- Resilient crawling for heavy sites that never reach network idle.
