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
    // Both themes are emitted as CSS variables; global.css picks one from data-theme.
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false,
    },
  },
});
