import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { unified } from '@astrojs/markdown-remark';
import remarkSiteLinks from './src/lib/remark-site-links.mjs';
import remarkIncludeFile from './src/lib/remark-include-file.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const docsDir = path.join(repoRoot, 'docs') + path.sep;
const readme = path.join(repoRoot, 'README.md');

export default defineConfig({
  site: 'https://typemaid.pages.dev',
  output: 'static',
  trailingSlash: 'always',
  integrations: [sitemap()],
  markdown: {
    processor: unified({
      remarkPlugins: [
        [remarkIncludeFile, { repoRoot }],
        [remarkSiteLinks, { repoRoot, docsDir, readme }],
      ],
    }),
    // The site is dark only; global.css replaces the theme's background with the site's own.
    shikiConfig: { theme: 'github-dark' },
  },
});
