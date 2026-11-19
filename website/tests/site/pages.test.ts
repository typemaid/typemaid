import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { pages, routeOf, sourcePathOf } from '../../src/lib/nav';
import { SITE, allRoutes, dist, docRoutes, fileForRoute, loadPage, repoRoot } from './helpers';

describe('every page is built', () => {
  it.each(allRoutes)('%s', (route) => {
    expect(fs.existsSync(fileForRoute(route)), `${fileForRoute(route)} is missing`).toBe(true);
  });
});

describe('SEO metadata', () => {
  describe.each(allRoutes)('%s', (route) => {
    it('has a title, and a description of 50 to 160 characters', () => {
      const { $ } = loadPage(route);
      expect($('title').text().trim()).not.toBe('');
      const d = $('meta[name="description"]').attr('content') ?? '';
      expect(d.length).toBeGreaterThanOrEqual(50);
      expect(d.length).toBeLessThanOrEqual(160);
    });

    it('has a canonical URL on the production domain', () => {
      expect(loadPage(route).$('link[rel="canonical"]').attr('href')).toBe(`${SITE}${route}`);
    });

    it('has Open Graph and Twitter tags that match the title and description', () => {
      const { $ } = loadPage(route);
      const title = $('title').text();
      const description = $('meta[name="description"]').attr('content');
      expect($('meta[property="og:title"]').attr('content')).toBe(title);
      expect($('meta[property="og:description"]').attr('content')).toBe(description);
      expect($('meta[property="og:url"]').attr('content')).toBe(`${SITE}${route}`);
      expect($('meta[property="og:image"]').attr('content')).toBe(`${SITE}/og.png`);
      expect($('meta[name="twitter:card"]').attr('content')).toBe('summary_large_image');
      expect($('meta[name="twitter:title"]').attr('content')).toBe(title);
    });

    it('has exactly one h1', () => {
      expect(loadPage(route).$('h1').length).toBe(1);
    });
  });

  it('gives every page a unique title and description', () => {
    const titles = allRoutes.map((r) => loadPage(r).$('title').text());
    const descriptions = allRoutes.map((r) => loadPage(r).$('meta[name="description"]').attr('content'));
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  it('uses the description from nav.ts on every docs page', () => {
    for (const p of pages) {
      expect(loadPage(routeOf(p)).$('meta[name="description"]').attr('content'), routeOf(p)).toBe(p.description);
    }
  });

  it('has JSON-LD only on the landing page, and it parses', () => {
    const json = JSON.parse(loadPage('/').$('script[type="application/ld+json"]').text());
    expect(json['@graph'].map((n: { '@type': string }) => n['@type'])).toEqual(['WebSite', 'SoftwareApplication']);
    for (const route of docRoutes) expect(loadPage(route).$('script[type="application/ld+json"]').length, route).toBe(0);
  });
});

describe('docs layout', () => {
  describe.each(pages.map((p) => [routeOf(p), p] as const))('%s', (route, page) => {
    it('has the right h1', () => {
      const h1 = loadPage(route).$('h1').text().trim();
      // Pages whose source starts with "# Title" keep it; the others get the title from nav.ts.
      const prose = fs.readFileSync(path.join(repoRoot, sourcePathOf(page)), 'utf8').replace(/^```[\s\S]*?^```/gm, '');
      const own = /^# (.+)$/m.exec(prose)?.[1];
      expect(h1).toBe(own ? own.replace(/`/g, '').trim() : page.title);
    });

    it('lists every docs page in the sidebar, in nav order, and marks this one current', () => {
      const { $ } = loadPage(route);
      const links = $('.sidebar a').map((_, a) => $(a).attr('href')).get();
      expect(links).toEqual(docRoutes);
      expect($('.sidebar a[aria-current="page"]').attr('href')).toBe(route);
      expect($('.sidebar a[aria-current="page"]').length).toBe(1);
    });

    it('links to the previous and next pages in sidebar order', () => {
      const { $ } = loadPage(route);
      const i = docRoutes.indexOf(route);
      expect($('.pager a[rel="prev"]').attr('href')).toBe(docRoutes[i - 1]);
      expect($('.pager a[rel="next"]').attr('href')).toBe(docRoutes[i + 1]);
    });

    it('has a table of contents whose links all point at headings on the page', () => {
      const { $ } = loadPage(route);
      $('.toc a').each((_, a) => {
        const id = $(a).attr('href')!.slice(1);
        expect($(`[id="${id}"]`).length, `#${id}`).toBe(1);
      });
    });

    it('marks the content for the search index', () => {
      expect(loadPage(route).$('[data-pagefind-body]').length).toBe(1);
    });
  });
});

describe('content', () => {
  it('shows the TM mark and the TypeMaid wordmark in the header, and links the favicons', () => {
    for (const route of allRoutes) {
      const { $ } = loadPage(route);
      expect($('.wordmark svg.mark text').text(), route).toBe('TM');
      expect($('.wordmark .word').text(), route).toBe('TypeMaid');
      for (const href of ['/favicon.ico', '/favicon.svg']) expect($(`link[rel="icon"][href="${href}"]`).length, route).toBe(1);
      expect($('link[rel="apple-touch-icon"]').attr('href'), route).toBe('/apple-touch-icon.png');
    }
    for (const f of ['favicon.ico', 'favicon.svg', 'apple-touch-icon.png']) expect(fs.existsSync(path.join(dist, f)), f).toBe(true);
  });

  it('serves every image it references', () => {
    for (const route of allRoutes) {
      const { $ } = loadPage(route);
      $('img').each((_, el) => {
        const src = $(el).attr('src') ?? '';
        if (src.startsWith('/')) expect(fs.existsSync(path.join(dist, src)), `${route} -> ${src}`).toBe(true);
      });
    }
  });
});

describe('top bar and loading', () => {
  it('links to the GitHub repository with a star button on every page', () => {
    for (const route of allRoutes) {
      const { $ } = loadPage(route);
      const link = $('header .github');
      expect(link.attr('href'), route).toBe('https://github.com/typemaid/typemaid');
      expect(link.attr('aria-label'), route).toMatch(/GitHub/);
      expect(link.find('.github-star').text().trim(), route).toMatch(/^(Star|\d+(\.\d)?k?)$/);
    }
  });

  it('puts the site CSS in the page and loads no stylesheet before the first paint', () => {
    for (const route of allRoutes) {
      const { $ } = loadPage(route);
      expect($('head link[rel="stylesheet"]').length, route).toBe(0);
      expect($('head style').text().length, route).toBeGreaterThan(1000);
    }
  });

  it('shows a plain search box and loads Pagefind only when it is used', () => {
    for (const route of allRoutes) {
      const { $ } = loadPage(route);
      expect($('#search [data-search-stub]').attr('aria-label'), route).toBe('Search docs');
      expect($('script[src*="pagefind"]').length, route).toBe(0);
    }
  });

  it('caches hashed assets for a year', () => {
    const headers = fs.readFileSync(path.join(dist, '_headers'), 'utf8');
    expect(headers).toMatch(/\/_astro\/\*\n\s+Cache-Control: public, max-age=31536000, immutable/);
  });
});
