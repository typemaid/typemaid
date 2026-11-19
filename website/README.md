# typemaid docs site

An Astro site for the typemaid docs, live at https://typemaid.pages.dev.

```bash
npm install
npm run dev      # local preview at http://localhost:4321 (no search in dev)
npm run build    # static site and search index in dist/
```

## Structure

- `src/lib/nav.ts`: the list of every docs page, grouped into sections. It drives the sidebar, routes, prev/next links, page descriptions and the tests. To add a page, add it here and write it in `src/content/guide/` (or `../docs/`).
- `src/content/guide/`: pages written for the site (introduction, concepts, guides, examples, API reference). No `# Title`: the layout adds it from `nav.ts`.
- `../docs/*.md` and `../README.md`: shown as they are. Links between them are rewritten to site routes at build time (`src/lib/remark-site-links.mjs`).
- Code blocks written as `` ```ts file=examples/hello/tools.ts `` are filled from that file at build time (`src/lib/remark-include-file.mjs`), so the docs always show the code the core test suite runs.
- `public/_redirects`: old routes from the first version of the site, moved under `/docs/`.
- The logo is the blue "TM" tile (`public/favicon.svg`, also `docs/logo.svg` with the wordmark). It is drawn inline in the header.
- Every docs page also has a plain Markdown copy at `/docs/<page>.md` (`src/lib/page-markdown.ts`), used by the "Copy page" menu, `/llms.txt` and `/llms-full.txt` for AI agents. `public/_headers` serves them as Markdown and keeps them out of search results.
- Mermaid flowcharts in the docs get a "Preview" button that draws the diagram (`src/scripts/mermaid-preview.ts`). The landing page draws `examples/triage/triage.mmd` and plays runs through it (`src/scripts/hero-flow.ts`). Mermaid is loaded only when a diagram is drawn.

Light and dark mode follow the system setting until the reader picks one with the toggle; the choice is kept in `localStorage`. Search is [Pagefind](https://pagefind.app), built into `dist/pagefind` after the site.

## Tests

[Vitest](https://vitest.dev), with three projects:

```bash
npm test            # build, then unit + site tests (no browser)
npm run test:e2e    # browser tests (builds first)
npm run test:all    # build, then everything
npm run test:unit   # fast, no build
npm run test:watch  # unit tests in watch mode
```

| Project | What it checks |
|---|---|
| `unit` | The page list (unique routes and titles, every source file exists, no orphan pages, description lengths, redirects match `_redirects`); the link-rewriting and file-including Markdown plugins, run on real Markdown. |
| `site` | The built HTML: SEO tags, one h1, sidebar order and current page, prev/next, table of contents anchors, every internal link and `#anchor`, sitemap, robots, redirects, search index, theme wiring, and that every included code block matches its file and is covered by `test/examples.test.ts`. |
| `e2e` | A real browser (Playwright): theme follows the system, toggles and persists, no flash before paint, code colours change with the theme; copy buttons; search; the mobile menu; no JavaScript errors or failed requests on any page. |

The e2e tests use installed Google Chrome when available, otherwise Playwright's Chromium (`npx playwright install chromium`).
