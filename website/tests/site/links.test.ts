import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allRoutes, fileForRoute, loadPage, markdownForRoute } from './helpers';

function internalLinks() {
  const links: Array<{ from: string; href: string }> = [];
  for (const route of allRoutes) {
    const { $ } = loadPage(route);
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href')!;
      if (href.startsWith('/')) links.push({ from: route, href });
      else if (href.startsWith('#')) links.push({ from: route, href: `${route}${href}` });
    });
  }
  return links;
}

describe('links', () => {
  const links = internalLinks();

  it('finds plenty of internal links to check', () => {
    expect(links.length).toBeGreaterThan(500);
  });

  it("never link to a Markdown file (except the page's own copy) or a relative path", () => {
    for (const route of allRoutes) {
      const { $ } = loadPage(route);
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href')!;
        if (href === markdownForRoute(route) && $(el).is('[data-markdown-link]')) return;
        expect(href, `${route} links to ${href}`).not.toMatch(/\.md(#|$)/);
        expect(href, `${route} links to ${href}`).not.toMatch(/^\.\.?\//);
      });
    }
  });

  it('every internal link points at a built page', () => {
    const broken = links.filter(({ href }) => !fs.existsSync(fileForRoute(href)));
    expect(broken).toEqual([]);
  });

  it('every #anchor exists on its target page', () => {
    const broken: string[] = [];
    for (const { from, href } of links) {
      const [route, hash] = href.split('#');
      if (!hash || !fs.existsSync(fileForRoute(route!))) continue;
      if (loadPage(route!).$(`[id="${decodeURIComponent(hash)}"]`).length === 0) broken.push(`${from} -> ${href}`);
    }
    expect(broken).toEqual([]);
  });

  it('internal page links end with a slash, matching the canonical URLs', () => {
    const bad = links.filter(({ href }) => {
      const pathPart = href.split('#')[0]!;
      return !pathPart.includes('.') && !pathPart.endsWith('/');
    });
    expect(bad).toEqual([]);
  });
});
