// Rewrites the links inside the Markdown source so they work on the site.
// The Markdown files stay exactly as they are in docs/ and the root README.
import path from 'node:path';

function walk(node, fn) {
  fn(node);
  if (node.children) for (const child of node.children) walk(child, fn);
}

const isExternal = (url) => /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('#') || url.startsWith('/');

// Files at the repository root that are pages on the site, by path relative to the root.
export const ROOT_PAGES = {
  'README.md': '/docs/diagram-reference/',
  'CONTRIBUTING.md': '/docs/contributing/',
};

export default function remarkSiteLinks({ repoRoot, docsDir, readme, rootPages = ROOT_PAGES }) {
  return (tree, file) => {
    const from = file.path ?? file.history?.[0];
    if (!from) return;
    const fromDir = path.dirname(from);

    // The root README starts with the logo and title block. The site has no logo, so drop everything before the first section.
    if (path.resolve(from) === readme) {
      const firstSection = tree.children.findIndex((n) => n.type === 'heading' && n.depth === 2);
      if (firstSection > 0) tree.children.splice(0, firstSection);
    }

    walk(tree, (node) => {
      if (node.type === 'image' && !isExternal(node.url)) {
        const abs = path.resolve(fromDir, node.url);
        if (abs.startsWith(docsDir)) node.url = `/docs/${path.basename(abs)}`;
        return;
      }
      if (node.type !== 'link' || isExternal(node.url)) return;

      const [target, hashPart = ''] = node.url.split('#');
      const hash = hashPart ? `#${hashPart}` : '';
      const abs = path.resolve(fromDir, target);

      const rootPage = rootPages[path.relative(repoRoot, abs)];
      if (rootPage) {
        node.url = rootPage + hash;
      } else if (abs.startsWith(docsDir) && abs.endsWith('.md')) {
        const name = path.basename(abs, '.md');
        node.url = (name === 'README' ? '/docs/' : `/docs/${name}/`) + hash;
      } else if (abs.startsWith(repoRoot)) {
        // Points at a file that is not part of the site: show it as code text instead of a broken link.
        const text = node.children.map((c) => c.value ?? '').join('');
        node.type = 'inlineCode';
        node.value = path.relative(repoRoot, abs) || text;
        delete node.children;
        delete node.url;
      }
    });
  };
}
