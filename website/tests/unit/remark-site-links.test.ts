import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { VFile } from 'vfile';
import remarkSiteLinks from '../../src/lib/remark-site-links.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const docsDir = path.join(repoRoot, 'docs') + path.sep;
const readme = path.join(repoRoot, 'README.md');
const options = { repoRoot, docsDir, readme };

// Runs the real Markdown parser and the plugin on a source file, the same way Astro does.
function transform(markdown: string, filePath: string) {
  const processor = unified().use(remarkParse).use(remarkSiteLinks, options);
  const file = new VFile({ path: filePath, value: markdown });
  const tree = processor.parse(file);
  processor.runSync(tree, file);
  return tree;
}

// Collects every link and image as { type, url } or { type: 'inlineCode', value }.
function collect(tree: any): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const walk = (node: any) => {
    if (node.type === 'link' || node.type === 'image' || node.type === 'inlineCode') out.push(node);
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree);
  return out;
}

const docFile = path.join(docsDir, 'getting-started.md');

describe('remark-site-links: links between docs pages', () => {
  it('rewrites a docs page link to its route', () => {
    const tree = transform('[Stores](stores.md)', docFile);
    expect(collect(tree)[0]).toMatchObject({ type: 'link', url: '/docs/stores/' });
  });

  it('keeps the anchor on a docs page link', () => {
    const tree = transform('[Durability](durability.md#at-least-once)', docFile);
    expect(collect(tree)[0]).toMatchObject({ url: '/docs/durability/#at-least-once' });
  });

  it('maps the docs index README to /docs/', () => {
    const tree = transform('[Home](README.md)', docFile);
    expect(collect(tree)[0]).toMatchObject({ url: '/docs/' });
  });

  it('maps a link from the root README to docs/ to the same route', () => {
    const tree = transform('[Getting started](docs/getting-started.md)', readme);
    expect(collect(tree)[0]).toMatchObject({ url: '/docs/getting-started/' });
  });
});

describe('remark-site-links: CONTRIBUTING.md', () => {
  it('maps a link to the root CONTRIBUTING.md to /docs/contributing/', () => {
    const tree = transform('[contribute](../CONTRIBUTING.md#testing-your-change)', docFile);
    expect(collect(tree)[0]).toMatchObject({ type: 'link', url: '/docs/contributing/#testing-your-change' });
  });

  it('rewrites links from CONTRIBUTING.md into docs/', () => {
    const tree = transform('[stores](docs/stores.md)', path.join(repoRoot, 'CONTRIBUTING.md'));
    expect(collect(tree)[0]).toMatchObject({ type: 'link', url: '/docs/stores/' });
  });
});

describe('remark-site-links: links to the root README (reference page)', () => {
  it('maps ../README.md with an anchor to /docs/diagram-reference/', () => {
    const tree = transform('[the README](../README.md#what-you-can-draw)', docFile);
    expect(collect(tree)[0]).toMatchObject({ url: '/docs/diagram-reference/#what-you-can-draw' });
  });
});

describe('remark-site-links: links that leave the site', () => {
  it('leaves external URLs alone', () => {
    const tree = transform('[Vercel AI SDK](https://ai-sdk.dev)', docFile);
    expect(collect(tree)[0]).toMatchObject({ url: 'https://ai-sdk.dev' });
  });

  it('leaves site-absolute links alone', () => {
    const tree = transform('[API](/docs/api/run/)', docFile);
    expect(collect(tree)[0]).toMatchObject({ url: '/docs/api/run/' });
  });

  it('leaves in-page anchors alone', () => {
    const tree = transform('[up](#top)', docFile);
    expect(collect(tree)[0]).toMatchObject({ url: '#top' });
  });

  it('turns a link to a repo file outside the site into code text', () => {
    const tree = transform('[index](../packages/postgres/src/index.ts)', path.join(docsDir, 'stores.md'));
    expect(collect(tree)[0]).toMatchObject({ type: 'inlineCode', value: 'packages/postgres/src/index.ts' });
  });
});

describe('remark-site-links: images', () => {
  it('serves images from docs/ under /docs/', () => {
    const tree = transform('![viewer](viewer-all.png)', path.join(docsDir, 'getting-started.md'));
    expect(collect(tree)[0]).toMatchObject({ type: 'image', url: '/docs/viewer-all.png' });
  });

  it('rewrites docs/ image paths used from the root README', () => {
    const tree = transform('![viewer](docs/viewer-flow.png)', readme);
    expect(collect(tree)[0]).toMatchObject({ url: '/docs/viewer-flow.png' });
  });
});

describe('remark-site-links: root README header', () => {
  it('drops the logo and title block before the first section', () => {
    const md = '<p align="center"><img src="docs/logo.svg"></p>\n\n<h1 align="center">typemaid</h1>\n\n## Overview\n\nText.';
    const tree = transform(md, readme) as any;
    expect(tree.children[0]).toMatchObject({ type: 'heading', depth: 2 });
    expect(JSON.stringify(tree)).not.toContain('logo.svg');
  });

  it('does not touch the header of other pages', () => {
    const md = '# Title\n\nText.';
    const tree = transform(md, docFile) as any;
    expect(tree.children[0]).toMatchObject({ type: 'heading', depth: 1 });
  });
});
