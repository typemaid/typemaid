// The plain Markdown copy of every docs page: /docs/getting-started/ -> /docs/getting-started.md.
import type { APIRoute, GetStaticPaths } from 'astro';
import { markdownRouteOf, pages, type DocPage } from '../../lib/nav';
import { pageMarkdown } from '../../lib/page-markdown';

export const getStaticPaths: GetStaticPaths = () =>
  pages.map((page) => ({
    params: { slug: markdownRouteOf(page).slice('/docs/'.length, -'.md'.length) },
    props: { page },
  }));

export const GET: APIRoute = ({ props }) =>
  new Response(pageMarkdown((props as { page: DocPage }).page), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
