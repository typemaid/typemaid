import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import { markdownRouteOf, pages, routeOf, SITE } from '../../src/lib/nav';

export { SITE };
export const website = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const repoRoot = path.dirname(website);
export const dist = path.join(website, 'dist');

/** Every built page: the landing page plus every docs page from nav.ts. */
export const docRoutes = pages.map(routeOf);
export const allRoutes = ['/', ...docRoutes];

/** The Markdown copy of a docs page ("/docs/faq/" -> "/docs/faq.md"), or undefined for other routes. */
export function markdownForRoute(route: string): string | undefined {
  const page = pages.find((p) => routeOf(p) === route);
  return page && markdownRouteOf(page);
}

/** Maps a route to its built file: "/docs/faq/" -> dist/docs/faq/index.html. */
export function fileForRoute(route: string): string {
  const clean = route.split('#')[0]!.split('?')[0]!;
  return clean.endsWith('/') ? path.join(dist, clean, 'index.html') : path.join(dist, clean);
}

const cache = new Map<string, { html: string; $: cheerio.CheerioAPI }>();

/** Parses a built page once and reuses it across tests. */
export function loadPage(route: string) {
  let page = cache.get(route);
  if (!page) {
    const html = fs.readFileSync(fileForRoute(route), 'utf8');
    page = { html, $: cheerio.load(html) };
    cache.set(route, page);
  }
  return page;
}
