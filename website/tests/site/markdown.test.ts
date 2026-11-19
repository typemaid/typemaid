import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { markdownRouteOf, pages, routeOf, sections, sourcePathOf } from '../../src/lib/nav';
import { dist, fileForRoute, loadPage, repoRoot, SITE } from './helpers';

// The plain Markdown copies of the docs pages (/docs/<page>.md), llms.txt and llms-full.txt.
// They are what AI agents and the "Copy page" button read, so they must be complete and every
// link in them must work from outside the site.

const read = (route: string) => fs.readFileSync(path.join(dist, route), 'utf8');

type MdNode = { type: string; url?: string; lang?: string; meta?: string; value?: string; depth?: number; children?: MdNode[] };
const parse = (md: string) => unified().use(remarkParse).use(remarkGfm).parse(md) as MdNode;
function nodes(tree: MdNode, type: string): MdNode[] {
  const out: MdNode[] = [];
  const walk = (n: MdNode) => {
    if (n.type === type) out.push(n);
    n.children?.forEach(walk);
  };
  walk(tree);
  return out;
}
const text = (n: MdNode): string => n.value ?? (n.children ?? []).map(text).join('');

const copies = pages.map((page) => ({ page, route: routeOf(page), md: read(markdownRouteOf(page)) }));

describe('Markdown copy of each page', () => {
  it('exists for every page, next to the HTML page', () => {
    for (const page of pages) expect(fs.existsSync(path.join(dist, markdownRouteOf(page))), markdownRouteOf(page)).toBe(true);
  });

  it('starts with the same title as the HTML page, and has only that one h1', () => {
    for (const { route, md } of copies) {
      const h1 = loadPage(route).$('h1').text().trim();
      expect(md.split('\n')[0], route).toBe(`# ${h1}`);
      expect(nodes(parse(md), 'heading').filter((h) => h.depth === 1), route).toHaveLength(1);
    }
  });

  it('has the same sections as the HTML page', () => {
    for (const { route, md } of copies) {
      const fromHtml = loadPage(route).$('article h2').map((_, el) => loadPage(route).$(el).text().trim()).get();
      const fromMd = nodes(parse(md), 'heading').filter((h) => h.depth === 2).map((h) => text(h).trim());
      expect(fromMd, route).toEqual(fromHtml);
    }
  });

  it('keeps the source file otherwise unchanged (pages with no links or included code)', () => {
    const plain = copies.filter(({ page }) => {
      const src = fs.readFileSync(path.join(repoRoot, sourcePathOf(page)), 'utf8');
      return !/\]\(|file=/.test(src) && page.source.collection !== 'reference';
    });
    expect(plain.length).toBeGreaterThan(0);
    for (const { page, md } of plain) {
      const src = fs.readFileSync(path.join(repoRoot, sourcePathOf(page)), 'utf8').trim();
      expect(md.trim().endsWith(src), sourcePathOf(page)).toBe(true);
    }
  });

  it('fills every included code block with the file it names', () => {
    let count = 0;
    for (const { route, md } of copies) {
      for (const code of nodes(parse(md), 'code')) {
        expect(code.meta ?? '', `${route}: an unfilled file= block`).not.toMatch(/(^|\s)file=/);
        const title = /title="([^"]+)"/.exec(code.meta ?? '')?.[1];
        if (!title) continue;
        count++;
        const file = fs.readFileSync(path.join(repoRoot, title), 'utf8').replace(/\n+$/, '');
        expect(code.value, `${route}: ${title}`).toBe(file);
      }
    }
    expect(count).toBeGreaterThan(15);
  });

  it('uses only full URLs or #anchors, so links work outside the site', () => {
    for (const { route, md } of copies) {
      for (const n of [...nodes(parse(md), 'link'), ...nodes(parse(md), 'image')]) {
        expect(n.url, `${route}: ${n.url}`).toMatch(/^(https?:\/\/|mailto:|#)/);
      }
    }
  });

  it('links only to site pages and anchors that exist', () => {
    const broken: string[] = [];
    for (const { route, md } of copies) {
      for (const n of [...nodes(parse(md), 'link'), ...nodes(parse(md), 'image')]) {
        const url = n.url!.startsWith('#') ? route + n.url : n.url!;
        if (!url.startsWith(SITE) && !url.startsWith('/')) continue;
        const [target, hash] = url.replace(SITE, '').split('#');
        if (!fs.existsSync(fileForRoute(target!))) broken.push(`${route} -> ${url}`);
        else if (hash && target!.endsWith('/') && loadPage(target!).$(`[id="${decodeURIComponent(hash)}"]`).length === 0) broken.push(`${route} -> ${url}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('drops the README logo block, like the HTML page', () => {
    const md = read('/docs/diagram-reference.md');
    expect(md).not.toContain('logo.svg');
    expect(md).not.toContain('<h1');
  });
});

describe('HTML pages point at their Markdown copy', () => {
  it('in a <link rel="alternate">, the Copy page button and the menu', () => {
    for (const page of pages) {
      const { $ } = loadPage(routeOf(page));
      const md = markdownRouteOf(page);
      expect($('link[rel="alternate"][type="text/markdown"]').attr('href'), routeOf(page)).toBe(md);
      expect($('.page-copy').attr('data-copy-page'), routeOf(page)).toBe(md);
      expect($('[data-markdown-link]').attr('href'), routeOf(page)).toBe(md);
      expect($('.page-actions').is('[data-pagefind-ignore]')).toBe(true);
    }
  });

  it('"Open in" links ask the chat to read the full URL of the copy', () => {
    for (const page of pages) {
      const { $ } = loadPage(routeOf(page));
      const hrefs = $('.page-menu a[target="_blank"]').map((_, a) => $(a).attr('href')).get();
      expect(hrefs.map((h) => new URL(h).host)).toEqual(['chatgpt.com', 'claude.ai']);
      for (const h of hrefs) expect(new URL(h).searchParams.get('q')).toContain(SITE + markdownRouteOf(page));
    }
  });
});

describe('llms.txt', () => {
  const txt = read('/llms.txt');
  const tree = parse(txt);

  it('follows the llms.txt layout: a title, a summary, then sections of links', () => {
    expect(txt.startsWith('# typemaid\n\n> ')).toBe(true);
    const h2 = nodes(tree, 'heading').filter((h) => h.depth === 2).map(text);
    expect(h2).toEqual(sections.map((s) => s.title));
  });

  it('lists every page once, in sidebar order, with its title and description', () => {
    const links = nodes(tree, 'link').filter((l) => l.url!.endsWith('.md'));
    expect(links.map((l) => l.url)).toEqual(pages.map((p) => SITE + markdownRouteOf(p)));
    for (const p of pages) expect(txt).toContain(`[${p.title}](${SITE}${markdownRouteOf(p)}): ${p.description}`);
  });

  it('points at llms-full.txt', () => {
    expect(txt).toContain(`${SITE}/llms-full.txt`);
  });

  it('is linked from every page head', () => {
    for (const page of pages) expect(loadPage(routeOf(page)).$('link[rel="alternate"][href="/llms.txt"]').length).toBe(1);
  });
});

describe('llms-full.txt', () => {
  const full = read('/llms-full.txt');

  it('contains every page, in order, each after its source URL', () => {
    let at = 0;
    for (const { page, md } of copies) {
      const marker = `Source: ${SITE}${routeOf(page)}\n\n${md.trim()}`;
      const found = full.indexOf(marker, at);
      expect(found, routeOf(page)).toBeGreaterThanOrEqual(at);
      at = found + marker.length;
    }
  });
});

describe('_headers', () => {
  it('serves the copies as Markdown and keeps them out of search results', () => {
    const headers = read('/_headers');
    expect(headers).toMatch(/^\/docs\/\*\.md\n {2}Content-Type: text\/markdown; charset=utf-8\n {2}X-Robots-Tag: noindex/m);
  });
});
