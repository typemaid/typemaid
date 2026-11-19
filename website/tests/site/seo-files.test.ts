import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { redirects } from '../../src/lib/nav';
import { SITE, allRoutes, dist, fileForRoute } from './helpers';

describe('sitemap, robots and redirects', () => {
  it('sitemap index points at the sitemap', () => {
    expect(fs.readFileSync(path.join(dist, 'sitemap-index.xml'), 'utf8')).toContain(`${SITE}/sitemap-0.xml`);
  });

  it('sitemap lists exactly the built pages, on the production domain', () => {
    const sitemap = fs.readFileSync(path.join(dist, 'sitemap-0.xml'), 'utf8');
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs.sort()).toEqual(allRoutes.map((r) => `${SITE}${r}`).sort());
  });

  it('robots.txt allows crawling and names the sitemap', () => {
    const robots = fs.readFileSync(path.join(dist, 'robots.txt'), 'utf8');
    expect(robots).toMatch(/User-agent: \*/);
    expect(robots).not.toMatch(/^Disallow: \/$/m);
    expect(robots).toContain(`Sitemap: ${SITE}/sitemap-index.xml`);
  });

  it('ships _redirects, and every old route moved to a built page', () => {
    expect(fs.existsSync(path.join(dist, '_redirects'))).toBe(true);
    for (const [from, to] of Object.entries(redirects)) {
      expect(fs.existsSync(fileForRoute(to)), `${from} -> ${to}`).toBe(true);
      expect(fs.existsSync(fileForRoute(from)), `${from} should no longer be a page`).toBe(false);
    }
  });

  it('og.png is a 1200x630 PNG', () => {
    const buf = fs.readFileSync(path.join(dist, 'og.png'));
    expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(buf.readUInt32BE(16)).toBe(1200);
    expect(buf.readUInt32BE(20)).toBe(630);
  });

  it('ships the search index', () => {
    expect(fs.existsSync(path.join(dist, 'pagefind', 'pagefind-ui.js'))).toBe(true);
    expect(fs.existsSync(path.join(dist, 'pagefind', 'pagefind-entry.json'))).toBe(true);
  });
});
