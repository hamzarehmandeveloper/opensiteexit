# Contributing

Thanks for your interest in improving OpenSiteExit.

## Getting started

```sh
git clone https://github.com/hamzarehmandeveloper/opensiteexit.git
cd opensiteexit
npm install
npx playwright install chromium
npm test    # migrates the fixture site in test/fixture, about a minute
```

The suite runs the whole pipeline against a small local site and checks the
properties the project promises: text order, no baked-in popups, no sideways
overflow at any width, canonical tags and sitemap, stylesheet size, and the
fidelity score itself. If you fix a migration bug, add the smallest page that
reproduces it to `test/fixture` and an assertion for it.

## What helps most

1. **Benchmark reports.** Run the pipeline against a real public site and
   open an issue with the fidelity scores, the platform, and (if possible)
   the diff screenshots for the worst page. Benchmark runs find most layout bugs.
2. **Layout-engine fixes.** Most quality gains come from structural bug
   classes (an element type mispositioned, a background layer dropped), not
   from pixel tuning. If you can name the bug class, a fix is usually small.
3. **Roadmap items.** See the README roadmap; open an issue to discuss an
   approach before building anything large.

## Pull requests

`main` is protected. Every change, including the maintainer's, goes through a
pull request and has to pass CI before it can be merged.

- Keep changes focused; one concern per PR.
- Before submitting, run `npm test` and, for layout changes, at least one
  real-site run, and include the before/after scores in the PR description.
- Match the existing code style: plain Node ES modules, no build step, no
  new runtime dependencies without discussion.

## Reporting issues

Include the target URL (if public), the command you ran, the console output,
and the `fidelity.json` from the report directory when relevant.

## Code of conduct

Be respectful and constructive. Reports of abusive behavior can be sent to
the repository owner.
