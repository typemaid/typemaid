import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { VFile } from 'vfile';
import remarkIncludeFile from '../../src/lib/remark-include-file.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

function transform(markdown: string) {
  const processor = unified().use(remarkParse).use(remarkIncludeFile, { repoRoot });
  const file = new VFile({ path: path.join(repoRoot, 'website/src/content/guide/page.md'), value: markdown });
  const tree = processor.parse(file);
  processor.runSync(tree, file);
  return tree as any;
}

const fence = (meta: string, body = '') => '```' + meta + '\n' + body + '```\n';

describe('remark-include-file', () => {
  it('fills an empty fence with the file contents', () => {
    const tree = transform(fence('ts file=examples/hello/tools.ts'));
    const code = tree.children.find((n: any) => n.type === 'code');
    const expected = fs.readFileSync(path.join(repoRoot, 'examples/hello/tools.ts'), 'utf8').replace(/\n+$/, '');
    expect(code.value).toBe(expected);
  });

  it('puts a title with the path right before the code', () => {
    const tree = transform(fence('ts file=examples/hello/tools.ts'));
    const i = tree.children.findIndex((n: any) => n.type === 'code');
    expect(tree.children[i - 1]).toMatchObject({ type: 'html' });
    expect(tree.children[i - 1].value).toContain('data-file="examples/hello/tools.ts"');
  });

  it('infers the language from the extension when the fence has none', () => {
    const tree = transform(fence(' file=examples/hello/hello.mmd'));
    expect(tree.children.find((n: any) => n.type === 'code').lang).toBe('mermaid');
  });

  it('keeps an explicit language', () => {
    const tree = transform(fence('text file=examples/hello/hello.mmd'));
    expect(tree.children.find((n: any) => n.type === 'code').lang).toBe('text');
  });

  it('replaces whatever was written inside the fence', () => {
    const tree = transform(fence('ts file=examples/hello/tools.ts', 'stale copy\n'));
    expect(tree.children.find((n: any) => n.type === 'code').value).not.toContain('stale copy');
  });

  it('includes files inside lists and other containers', () => {
    const tree = transform('- item\n\n  ' + fence('ts file=examples/hello/index.ts').replace(/\n(?!$)/g, '\n  '));
    expect(JSON.stringify(tree)).toContain('import { run } from');
  });

  it('leaves fences without file= alone', () => {
    const tree = transform(fence('ts', 'const a = 1;\n'));
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].value).toBe('const a = 1;');
  });

  it('fails the build on a missing file', () => {
    expect(() => transform(fence('ts file=examples/nope/tools.ts'))).toThrow(/missing file: examples\/nope\/tools.ts/);
  });

  it('refuses paths outside the repository', () => {
    expect(() => transform(fence('ts file=../../etc/passwd'))).toThrow(/inside the repository/);
  });
});
