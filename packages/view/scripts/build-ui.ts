/**
 * Builds the viewer page into dist/ui.
 *
 * The drawing library loads each diagram type on demand. Workflows are always flowcharts,
 * so every other diagram type, the maths renderer and the extra layout engines are replaced
 * by an empty file. The page asks for the classic layout (see ui/src/diagram.tsx), which is kept. If a library upgrade renames these parts, the size check at the end fails
 * rather than letting the page quietly grow again.
 */
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const outdir = path.join(root, 'dist/ui');
const unused = path.join(root, 'ui/src/unused.ts');
const KEEP = /^(flowDiagram|dagre)-/;
const DROP = /^(?:[A-Za-z0-9]+Diagram(?:-v2)?|diagram|[a-z]+-definition|elk|cose-bilkent|swimlanes|bpmnIcons)-[A-Z0-9]{8}\.mjs$/;
const dropped = new Set<string>();
/** Folders of the third-party packages whose code ends up in the page. */
const used = new Set<string>();
const MODULES = `${path.sep}node_modules${path.sep}`;
const note = (file: string) => {
  const at = file.lastIndexOf(MODULES);
  if (at < 0) return;
  const parts = file.slice(at + MODULES.length).split(path.sep);
  used.add(path.join(file.slice(0, at + MODULES.length), ...parts.slice(0, parts[0]!.startsWith('@') ? 2 : 1)));
};

rmSync(outdir, { recursive: true, force: true });
const result = await Bun.build({
  entrypoints: [path.join(root, 'ui/index.html')],
  outdir,
  minify: true,
  splitting: true,
  // Used below to learn whose code was bundled, then deleted.
  sourcemap: 'external',
  plugins: [
    {
      name: 'flowcharts-only',
      setup(build) {
        build.onResolve({ filter: /^katex$/ }, () => (dropped.add('katex'), { path: unused }));
        build.onResolve({ filter: /^\.\/.*\.mjs$/ }, (args) => {
          const name = path.basename(args.path);
          if (!args.importer.includes(`${path.sep}mermaid${path.sep}dist${path.sep}`) || KEEP.test(name) || !DROP.test(name)) return undefined;
          dropped.add(name.replace(/-[A-Z0-9]{8}\.mjs$/, ''));
          return { path: unused };
        });
      },
    },
  ],
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
for (const map of readdirSync(outdir).filter((f) => f.endsWith('.map'))) {
  const { sources } = JSON.parse(readFileSync(path.join(outdir, map), 'utf8')) as { sources: string[] };
  for (const source of sources) note(path.resolve(outdir, source));
  rmSync(path.join(outdir, map));
}
const files = readdirSync(outdir);
const bytes = files.reduce((sum, f) => sum + statSync(path.join(outdir, f)).size, 0);
console.log(`viewer page: ${files.length} files, ${(bytes / 1024 / 1024).toFixed(2)} MB (left out ${dropped.size} unused parts)`);
const LIMIT = 1.5 * 1024 * 1024;
if (bytes > LIMIT) {
  console.error(`The viewer page is larger than ${LIMIT / 1024 / 1024} MB. The list of left-out parts in this script probably needs updating.`);
  process.exit(1);
}

// The licences of everything bundled into the page, so they travel with the package.
const FENCE = '`'.repeat(3);
const notices = [...used]
  .map((dir) => {
    const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as { name: string; version: string; license?: string };
    const file = readdirSync(dir).find((f) => /^(licen[sc]e|copying)(\.|$)/i.test(f));
    return { name: pkg.name, version: pkg.version, license: pkg.license, text: file && existsSync(path.join(dir, file)) ? readFileSync(path.join(dir, file), 'utf8').trim() : undefined };
  })
  .sort((a, b) => a.name.localeCompare(b.name));
const missing = notices.filter((n) => !n.text && !n.license);
if (missing.length > 0) {
  console.error(`No licence found for: ${missing.map((n) => n.name).join(', ')}`);
  process.exit(1);
}
const section = (n: (typeof notices)[number]) =>
  `## ${n.name} ${n.version}\n\nLicence: ${n.license ?? 'see the text below'}\n\n` +
  (n.text ? `${FENCE}text\n${n.text.replaceAll(FENCE, "'''")}\n${FENCE}\n` : '(This package ships no licence file; the licence named above applies.)\n');
writeFileSync(
  path.join(root, 'THIRD-PARTY-NOTICES.md'),
  '# Third-party notices\n\nThe viewer page (`dist/ui`) includes code from the packages below. Each remains under its own licence.\nThis file is written by the build; do not edit it by hand.\n\n' +
    notices.map(section).join('\n'),
);
console.log(`third-party notices: ${notices.length} packages`);
