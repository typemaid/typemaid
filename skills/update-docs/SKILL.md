---
name: update-docs
description: Change typemaid's documentation (docs/ guides, the README, or the Astro docs site in website/) and check every page, link and code example. Use when editing docs, adding a docs page, or after a change in behaviour that the docs describe.
---

# Update the docs

## Where things live

| Source | Shown at |
|---|---|
| `docs/*.md` (getting-started, durability, retries, stores, models, faq) | `/docs/<name>/` exactly as written. Links between them stay relative (`[stores](stores.md)`); the site rewrites them. |
| `website/src/content/guide/**.md` (introduction, concepts, guides, examples, API) | `/docs/<path>/`. No `# Title`; the layout adds it from `nav.ts`. |
| `README.md` | `/docs/diagram-reference/`, and the npm page. Its links and images use full `https://typemaid.pages.dev/...` URLs so they also work on npm. |
| `CONTRIBUTING.md` | `/docs/contributing/` |
| `website/src/lib/nav.ts` | The sidebar, routes, prev/next links and page descriptions. Every page must be listed here. |

## Rules

- Every code sample must be true. Prefer embedding a real file with an empty fence: ```` ```ts file=examples/hello/tools.ts ```` (filled from disk at build time). For inline snippets, check them by running them.
- Descriptions in `nav.ts`: 50 to 160 characters, unique.
- When behaviour changes, update the guide that describes it, the API page, and the README if the syntax changed.
- Plain words, short sentences, no marketing.

## Check

```bash
cd website
npm install          # first time only
npm run dev          # preview at http://localhost:4321
npm test             # build, then check every page, link, anchor, code example and the Markdown copies
npm run test:e2e     # browser tests: theme, search, copy buttons, mobile menu
```

`npm test` fails on a broken link, a missing anchor, a page not in `nav.ts`, an embedded file that differs from disk, or an example shown in the docs that `test/examples.test.ts` doesn't run.
