import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { allRoutes, loadPage, repoRoot } from './helpers';

// Code blocks titled with a repository path are filled from that file at build time.
// These tests prove the docs show exactly the code the core test suite runs.
function includedBlocks() {
  const blocks: Array<{ route: string; file: string; shown: string }> = [];
  for (const route of allRoutes) {
    const { $ } = loadPage(route);
    $('.code-title[data-file]').each((_, title) => {
      const pre = $(title).next('pre');
      blocks.push({ route, file: $(title).attr('data-file')!, shown: pre.find('code').text() });
    });
  }
  return blocks;
}

describe('code included from the repository', () => {
  const blocks = includedBlocks();

  it('is used on the example pages', () => {
    const files = new Set(blocks.map((b) => b.file));
    for (const f of ['examples/hello/tools.ts', 'examples/triage/tools.ts', 'examples/emails/emails.mmd', 'examples/summarize/tools.ts', 'examples/sync/tools.ts', 'examples/review-loop/tools.ts']) {
      expect(files.has(f), f).toBe(true);
    }
  });

  it('matches the file on disk exactly', () => {
    for (const { route, file, shown } of blocks) {
      const onDisk = fs.readFileSync(path.join(repoRoot, file), 'utf8').replace(/\n+$/, '');
      expect(shown, `${route} shows ${file}`).toBe(onDisk);
    }
  });

  it('only includes files the core test suite runs', () => {
    const tested = fs.readFileSync(path.join(repoRoot, 'test/examples.test.ts'), 'utf8');
    for (const { file } of blocks) {
      const example = file.split('/')[1]!;
      expect(tested, `${file} is shown in the docs but examples/${example} is not in test/examples.test.ts`).toContain(`examples/${example}/`);
    }
  });
});

describe('code highlighting', () => {
  it('highlights every block with the dark theme only', () => {
    for (const route of allRoutes) {
      const { $ } = loadPage(route);
      $('pre.astro-code').each((_, pre) => {
        expect($(pre).hasClass('github-dark'), route).toBe(true);
        expect($(pre).attr('style') ?? '', route).not.toContain('--shiki-light');
      });
    }
  });
});
