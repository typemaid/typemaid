// Fills a code block from a file in the repository, so the docs show the exact code that the
// test suite runs. Write an empty fence with a `file=` meta:
//
//   ```ts file=examples/hello/tools.ts
//   ```
//
// The block gets the file's contents and a title line with the path (unless `codeTitle: false`,
// used for the plain Markdown copies of each page). A missing file fails the build.
import fs from 'node:fs';
import path from 'node:path';

const LANG_BY_EXT = { '.ts': 'ts', '.mts': 'ts', '.js': 'js', '.mjs': 'js', '.mmd': 'mermaid', '.mermaid': 'mermaid', '.json': 'json' };

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export default function remarkIncludeFile({ repoRoot, codeTitle = true }) {
  return (tree) => {
    const visit = (node) => {
      if (!node.children) return;
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        // A fence with no language (```` ``` file=x ````) is parsed with `file=x` as the language.
        if (child.type === 'code' && child.lang?.startsWith('file=')) {
          child.meta = child.meta ? `${child.lang} ${child.meta}` : child.lang;
          child.lang = null;
        }
        const match = child.type === 'code' && child.meta ? /(?:^|\s)file=(\S+)/.exec(child.meta) : null;
        if (match) {
          const rel = match[1];
          const abs = path.resolve(repoRoot, rel);
          if (!abs.startsWith(repoRoot + path.sep)) throw new Error(`file= must stay inside the repository: ${rel}`);
          if (!fs.existsSync(abs)) throw new Error(`file= points at a missing file: ${rel}`);
          child.value = fs.readFileSync(abs, 'utf8').replace(/\n+$/, '');
          child.lang ??= LANG_BY_EXT[path.extname(abs)] ?? null;
          child.data = { ...child.data, includedFrom: rel };
          if (codeTitle) {
            node.children.splice(i, 0, { type: 'html', value: `<div class="code-title" data-file="${escapeHtml(rel)}">${escapeHtml(rel)}</div>` });
            i++;
          }
        } else {
          visit(child);
        }
      }
    };
    visit(tree);
  };
}
