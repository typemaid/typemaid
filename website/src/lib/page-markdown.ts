// Builds the plain Markdown copy of a docs page, served at /docs/<page>.md and used by the
// "Copy page" button, llms.txt and llms-full.txt. It is the page's own Markdown source with:
//   - `file=` code blocks filled from the repository, as on the HTML page,
//   - links rewritten to full https:// URLs of the site's pages,
//   - a "# Title" at the top when the source has none.
// Everything else is left exactly as written, so the copy reads like the original file.
import fs from 'node:fs';
import path from 'node:path';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { VFile } from 'vfile';
import remarkIncludeFile from './remark-include-file.mjs';
import remarkSiteLinks from './remark-site-links.mjs';
import { SITE, sourcePathOf, type DocPage } from './nav';

// The site is built from website/, so the repository is its parent folder.
const repoRoot = path.resolve(process.cwd(), '..');

interface Edit {
  start: number;
  end: number;
  text: string;
}

type Node = {
  type: string;
  url?: string;
  value?: string;
  lang?: string | null;
  depth?: number;
  data?: { includedFrom?: string };
  children?: Node[];
  position?: { start: { offset?: number; column: number }; end: { offset?: number } };
};

function walk(node: Node, fn: (n: Node) => void) {
  fn(node);
  for (const child of node.children ?? []) walk(child, fn);
}

const absolute = (url: string) => (url.startsWith('/') ? SITE + url : url);

function fence(lang: string | null | undefined, file: string, value: string, indent: string): string {
  // A fence longer than any run of backticks inside the code.
  const longest = Math.max(2, ...(value.match(/`+/g) ?? []).map((m) => m.length));
  const ticks = '`'.repeat(longest + 1);
  const lines = [`${ticks}${lang ?? ''} title="${file}"`, ...value.split('\n'), ticks];
  return lines.map((l, i) => (i === 0 || l === '' ? l : indent + l)).join('\n');
}

export function pageMarkdown(page: DocPage): string {
  const file = path.join(repoRoot, sourcePathOf(page));
  const source = fs.readFileSync(file, 'utf8');

  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkIncludeFile, { repoRoot, codeTitle: false })
    .use(remarkSiteLinks, {
      repoRoot,
      docsDir: path.join(repoRoot, 'docs') + path.sep,
      readme: path.join(repoRoot, 'README.md'),
    });
  const vfile = new VFile({ path: file, value: source });
  const tree = processor.parse(vfile) as Node;

  // Note each link, image and code block, with its original URL, before the plugins change them.
  const seen: Array<{ node: Node; url?: string }> = [];
  walk(tree, (n) => {
    if (n.type === 'link' || n.type === 'image' || n.type === 'code') seen.push({ node: n, url: n.url });
  });
  const firstBefore = tree.children?.[0];
  processor.runSync(tree as never, vfile);

  const edits: Edit[] = [];
  // The plugins may drop the start of the file (the README's logo block).
  let cut = 0;
  const firstAfter = tree.children?.[0];
  if (firstAfter && firstAfter !== firstBefore) {
    cut = firstAfter.position!.start.offset!;
    edits.push({ start: 0, end: cut, text: '' });
  }

  for (const { node, url } of seen) {
    const pos = node.position;
    if (!pos || pos.start.offset === undefined || pos.end.offset === undefined || pos.start.offset < cut) continue;
    const start = pos.start.offset;
    const end = pos.end.offset;

    if (node.type === 'code') {
      if (node.data?.includedFrom) {
        const indent = ' '.repeat(pos.start.column - 1);
        edits.push({ start, end, text: fence(node.lang, node.data.includedFrom, node.value ?? '', indent) });
      }
    } else if (node.type === 'inlineCode') {
      // A link to a repository file that is not on the site: shown as code, as on the HTML page.
      edits.push({ start, end, text: `\`${node.value}\`` });
    } else if (url !== undefined) {
      const next = absolute(node.url!);
      if (next === url) continue;
      const slice = source.slice(start, end);
      const at = slice.lastIndexOf(url);
      if (at === -1) throw new Error(`${sourcePathOf(page)}: cannot find the link "${url}" in its source`);
      edits.push({ start: start + at, end: start + at + url.length, text: next });
    }
  }

  // Apply from the end of the file backwards, so earlier offsets stay valid.
  edits.sort((a, b) => b.start - a.start);
  let out = source;
  let limit = Infinity;
  for (const e of edits) {
    if (e.end > limit) throw new Error(`${sourcePathOf(page)}: overlapping edits at offset ${e.start}`);
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    limit = e.start;
  }

  out = out.trim();
  const hasTitle = tree.children?.some((n) => n.type === 'heading' && n.depth === 1);
  if (!hasTitle) out = `# ${page.title}\n\n${out}`;
  return out + '\n';
}
