import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { markdownRouteOf, neighbours, pages, redirects, routeOf, sections, sourcePathOf } from '../../src/lib/nav';
import { ROOT_PAGES } from '../../src/lib/remark-site-links.mjs';

const website = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const repoRoot = path.dirname(website);
const guideDir = path.join(website, 'src/content/guide');

const sourceFile = (page: (typeof pages)[number]) => path.join(repoRoot, sourcePathOf(page));

describe('nav manifest', () => {
  it('has unique routes, titles and sources', () => {
    const unique = (xs: string[]) => new Set(xs).size === xs.length;
    expect(unique(pages.map(routeOf))).toBe(true);
    expect(unique(pages.map((p) => p.title))).toBe(true);
    expect(unique(pages.map((p) => `${p.source.collection}:${p.source.id}`))).toBe(true);
  });

  it('puts every route under /docs/ with a trailing slash', () => {
    for (const p of pages) expect(routeOf(p)).toMatch(/^\/docs\/([a-z0-9-]+\/)*$/);
  });

  it('has no empty sections', () => {
    for (const s of sections) expect(s.pages.length, s.title).toBeGreaterThan(0);
  });

  it('points every page at a source file that exists', () => {
    for (const p of pages) expect(fs.existsSync(sourceFile(p)), `${routeOf(p)} -> ${sourceFile(p)}`).toBe(true);
  });

  it('gives every page a Markdown copy next to its route', () => {
    for (const p of pages) {
      expect(markdownRouteOf(p)).toMatch(/^\/docs\/([a-z0-9-]+\/)*[a-z0-9-]+\.md$/);
      if (p.slug) expect(markdownRouteOf(p)).toBe(routeOf(p).slice(0, -1) + '.md');
    }
    expect(new Set(pages.map(markdownRouteOf)).size).toBe(pages.length);
  });

  it('routes every root page (README, CONTRIBUTING) to the page that shows it', () => {
    for (const [file, route] of Object.entries(ROOT_PAGES)) {
      const page = pages.find((p) => sourcePathOf(p) === file);
      expect(page, file).toBeDefined();
      expect(routeOf(page!)).toBe(route);
    }
  });

  it('lists every written guide page, so none is unreachable', () => {
    const files = fs.globSync('**/*.md', { cwd: guideDir }).map((f) => f.replace(/\.md$/, '').split(path.sep).join('/'));
    const listed = pages.filter((p) => p.source.collection === 'guide').map((p) => p.source.id);
    expect(files.sort()).toEqual(listed.sort());
  });

  it('lists every page in the repository docs/ folder except its index', () => {
    const files = fs.readdirSync(path.join(repoRoot, 'docs')).filter((f) => f.endsWith('.md') && f !== 'README.md').map((f) => f.replace(/\.md$/, ''));
    const listed = pages.filter((p) => p.source.collection === 'docs').map((p) => p.source.id);
    expect(files.sort()).toEqual(listed.sort());
  });
});

describe('descriptions', () => {
  it('are 50 to 160 characters, for search snippets', () => {
    for (const p of pages) {
      expect(p.description.length, `${routeOf(p)}: ${p.description.length} characters`).toBeGreaterThanOrEqual(50);
      expect(p.description.length, `${routeOf(p)}: ${p.description.length} characters`).toBeLessThanOrEqual(160);
    }
  });

  it('are unique', () => {
    const all = pages.map((p) => p.description);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('guide pages', () => {
  it('do not start with their own h1 (the layout adds the title)', () => {
    for (const p of pages.filter((x) => x.source.collection === 'guide')) {
      const prose = fs.readFileSync(sourceFile(p), 'utf8').replace(/^```[\s\S]*?^```/gm, '');
      expect(prose, routeOf(p)).not.toMatch(/^# /m);
    }
  });
});

describe('neighbours', () => {
  it('chains every page in sidebar order', () => {
    expect(neighbours(pages[0]!).prev).toBeUndefined();
    expect(neighbours(pages.at(-1)!).next).toBeUndefined();
    for (let i = 1; i < pages.length; i++) {
      expect(neighbours(pages[i]!).prev).toBe(pages[i - 1]);
      expect(neighbours(pages[i - 1]!).next).toBe(pages[i]);
    }
  });
});

describe('redirects', () => {
  it('send every old route to a page that exists', () => {
    const routes = new Set(pages.map(routeOf));
    for (const [from, to] of Object.entries(redirects)) expect(routes.has(to), `${from} -> ${to}`).toBe(true);
  });

  it('match public/_redirects exactly', () => {
    const lines = fs.readFileSync(path.join(website, 'public/_redirects'), 'utf8').trim().split('\n');
    const parsed = Object.fromEntries(lines.map((l) => {
      const [from, to, code] = l.trim().split(/\s+/);
      expect(code, l).toBe('301');
      return [from, to];
    }));
    expect(parsed).toEqual(redirects);
  });
});
