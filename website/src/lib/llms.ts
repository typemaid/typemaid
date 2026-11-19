// llms.txt (https://llmstxt.org): an index of the docs for AI agents, with links to the
// plain Markdown copy of every page. llms-full.txt has every page in one file.
import { SITE, markdownRouteOf, routeOf, sections } from './nav';
import { pageMarkdown } from './page-markdown';

const SUMMARY =
  'typemaid runs workflows drawn as Mermaid flowcharts. Each box in the diagram is a TypeScript step typed with Zod; ' +
  'the diagram decides what runs next. Runs can pause for a person and resume later, retry steps, be saved to SQLite, ' +
  'Postgres or libSQL, and call any AI model through the Vercel AI SDK.';

const ABOUT = [
  'Packages: `typemaid` (core, with `typemaid/ai` and `typemaid/sqlite`), `@typemaid/postgres`, `@typemaid/libsql` and `@typemaid/view`.',
  'Every link below is the plain Markdown copy of a page. The HTML page is the same address without `.md`.',
];

export function llmsTxt(): string {
  const out = ['# typemaid', '', `> ${SUMMARY}`, '', ...ABOUT, ''];
  for (const section of sections) {
    out.push(`## ${section.title}`, '');
    for (const page of section.pages) out.push(`- [${page.title}](${SITE}${markdownRouteOf(page)}): ${page.description}`);
    out.push('');
  }
  out.push(`The whole documentation in one file: ${SITE}/llms-full.txt`, '');
  return out.join('\n');
}

export function llmsFullTxt(): string {
  const out = ['# typemaid documentation', '', `> ${SUMMARY}`, ''];
  for (const section of sections) {
    for (const page of section.pages) {
      out.push('---', '', `Source: ${SITE}${routeOf(page)}`, '', pageMarkdown(page).trim(), '');
    }
  }
  return out.join('\n');
}
