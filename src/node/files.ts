import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BRAND } from '../brand.ts';
import type { Tools } from '../bind/bind.ts';

export const rel = (file: string): string => path.relative(process.cwd(), file).split(path.sep).join('/') || file;

async function isFile(file: string): Promise<boolean> {
  return stat(file).then((s) => s.isFile(), () => false);
}

/** Add `target` (a diagram file), or every diagram file under it (a folder), to `out`. */
export async function collect(target: string, out: string[]): Promise<void> {
  const info = await stat(target);
  if (info.isFile()) {
    out.push(target);
    return;
  }
  for (const entry of (await readdir(target, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) await collect(full, out);
    else if (BRAND.extensions.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
}

/** The tools file for a diagram: the one given, or one beside the diagram, or one folder up. */
export async function findTools(flowFile: string, explicit?: string): Promise<string | undefined> {
  if (explicit !== undefined) return path.resolve(explicit);
  const dir = path.dirname(path.resolve(flowFile));
  for (const base of [dir, path.dirname(dir)]) {
    for (const name of BRAND.toolsFiles) {
      const candidate = path.join(base, name);
      if (await isFile(candidate)) return candidate;
    }
  }
  return undefined;
}

/** Import a tools file. With `fresh`, a changed file is read again instead of coming from the module cache. */
export async function loadTools(file: string, fresh = false): Promise<Tools> {
  try {
    let href = pathToFileURL(file).href;
    if (fresh) href += `?v=${(await stat(file)).mtimeMs}`;
    return (await import(href)) as Tools;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Node before 22.18 cannot read TypeScript files without a flag.
    const hint = /\.m?ts$/.test(file) && /Unknown file extension|ERR_UNKNOWN_FILE_EXTENSION/.test(message)
      ? ' This version of Node cannot load TypeScript directly: use Node 22.18 or newer, Bun, or a JavaScript tools file.'
      : '';
    throw new Error(`Could not load ${rel(file)}: ${message}${hint}`);
  }
}
