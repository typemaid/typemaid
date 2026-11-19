import { watch, type FSWatcher } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { bind, BRAND, check, FlowError, VERSION, type BoundFlow, type Diagnostic, type Tools } from 'typemaid';
import { collect, findTools, loadTools } from 'typemaid/node';
import { VIEW_SCHEMA_VERSION, type FlowView, type Meta, type ViewerEvent } from './contract.ts';
import { toFlowView, toSummary } from './project.ts';
import type { ViewerSource } from './source.ts';

export interface FileSourceOptions {
  /** Diagram files and folders to show. */
  paths: string[];
  /** A tools file to use for every diagram, or false to read diagrams only and import no code. */
  tools?: string | false;
  /** Watch for changes. Default true. */
  watch?: boolean;
}

export interface FileSource extends ViewerSource {
  /** Tools files that were imported (their top-level code ran). Display paths. */
  toolsFiles(): string[];
  /** Id of the only flow, when exactly one file was asked for. */
  single(): string | undefined;
}

interface Entry {
  stamp: string;
  view: FlowView;
}

/** Reads diagrams (and the tools next to them) from disk and presents them through the viewer contract. */
export async function fileSource(options: FileSourceOptions): Promise<FileSource> {
  const targets = options.paths.map((p) => path.resolve(p));
  const infos = await Promise.all(targets.map((t) => stat(t).then((s) => ({ t, dir: s.isDirectory() }), () => undefined)));
  const missing = targets.filter((_, i) => !infos[i]);
  if (missing.length > 0) throw new Error(`Not found: ${missing.map((m) => path.relative(process.cwd(), m) || m).join(', ')}`);
  const root = commonDir(infos.map((i) => (i!.dir ? i!.t : path.dirname(i!.t))));
  const home = homedir();
  const display = (file: string) => path.relative(root, file).split(path.sep).join('/');
  const clean = (text: string) => text.replaceAll(root + path.sep, '').replaceAll(root, '.').replaceAll(home, '~');

  const entries = new Map<string, Entry>();
  const imported = new Set<string>();
  const listeners = new Set<(event: ViewerEvent) => void>();
  const watchers = new Map<string, FSWatcher>();
  let revision = 1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let scanning: Promise<string[]> | undefined;

  async function build(file: string, toolsFile: string | undefined): Promise<FlowView> {
    const source = await readFile(file, 'utf8');
    const checked = check(source, { file: display(file) });
    const id = Buffer.from(display(file)).toString('base64url');
    let bound: BoundFlow | undefined;
    let toolDiagnostics: Diagnostic[] | undefined;
    let toolsError: string | undefined;
    if (checked.flow && toolsFile !== undefined) {
      let tools: Tools | undefined;
      try {
        tools = await loadTools(toolsFile, true);
        imported.add(display(toolsFile));
      } catch (err) {
        toolsError = err instanceof Error ? err.message : String(err);
      }
      if (tools) {
        try {
          bound = bind(checked.flow, tools, checked.source);
          toolDiagnostics = bound.warnings;
        } catch (err) {
          if (!(err instanceof FlowError)) throw err;
          toolDiagnostics = err.diagnostics;
        }
      }
    }
    return toFlowView({
      id,
      file: display(file),
      checked,
      clean,
      ...(bound ? { bound } : {}),
      ...(toolDiagnostics ? { toolDiagnostics } : {}),
      ...(toolsFile !== undefined ? { toolsFile: display(toolsFile) } : {}),
      ...(toolsError !== undefined ? { toolsError } : {}),
    });
  }

  /** Re-read whatever changed. Returns the ids that are new, changed or gone. */
  async function scan(): Promise<string[]> {
    const files: string[] = [];
    for (const target of targets) await collect(target, files).catch(() => undefined);
    const changed: string[] = [];
    const seen = new Set<string>();
    const dirs = new Set<string>(infos.filter((i) => i!.dir).map((i) => i!.t));
    for (const file of [...new Set(files)]) {
      const toolsFile = options.tools === false ? undefined : await findTools(file, options.tools);
      dirs.add(path.dirname(file));
      if (toolsFile) dirs.add(path.dirname(toolsFile));
      const mtime = (f: string | undefined) => (f ? stat(f).then((s) => s.mtimeMs, () => 0) : 0);
      const stamp = `${await mtime(file)}:${toolsFile ?? ''}:${await mtime(toolsFile)}`;
      seen.add(file);
      if (entries.get(file)?.stamp === stamp) continue;
      try {
        const view = await build(file, toolsFile);
        entries.set(file, { stamp, view });
        changed.push(view.id);
      } catch {
        // The file vanished or could not be read between listing and reading; the next scan settles it.
      }
    }
    for (const [file, entry] of entries) {
      if (!seen.has(file)) {
        entries.delete(file);
        changed.push(entry.view.id);
      }
    }
    if (options.watch !== false) rewatch(dirs);
    return changed;
  }

  function rewatch(dirs: Set<string>): void {
    for (const [dir, w] of watchers) {
      if (!dirs.has(dir)) {
        w.close();
        watchers.delete(dir);
      }
    }
    for (const dir of dirs) {
      if (watchers.has(dir)) continue;
      try {
        const w = watch(dir, { persistent: false }, () => {
          clearTimeout(timer);
          timer = setTimeout(() => void refresh(), 120);
        });
        w.on('error', () => undefined);
        watchers.set(dir, w);
      } catch {
        // A folder that cannot be watched only loses live reload.
      }
    }
  }

  async function refresh(): Promise<void> {
    scanning = (scanning ?? Promise.resolve([])).then(scan, scan);
    const ids = await scanning;
    if (ids.length === 0) return;
    revision++;
    for (const listener of listeners) listener({ type: 'flows.changed', revision, ids });
  }

  await scan();
  const sorted = () => [...entries.values()].map((e) => e.view).sort((a, b) => (a.file < b.file ? -1 : 1));

  return {
    async meta(): Promise<Meta> {
      return {
        schemaVersion: VIEW_SCHEMA_VERSION,
        generator: { name: BRAND.name, version: VERSION },
        generatedAt: new Date().toISOString(),
        mode: 'live',
        capabilities: { liveReload: options.watch !== false, runs: false, runData: false, actions: false },
        rootName: path.basename(root) || 'workflows',
      };
    },
    async listFlows() {
      return { revision, flows: sorted().map(toSummary) };
    },
    async getFlow(id) {
      return sorted().find((v) => v.id === id);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async close() {
      clearTimeout(timer);
      for (const w of watchers.values()) w.close();
      watchers.clear();
      listeners.clear();
    },
    toolsFiles: () => [...imported].sort(),
    single: () => (infos.length === 1 && !infos[0]!.dir ? sorted()[0]?.id : undefined),
  };
}

function commonDir(dirs: string[]): string {
  let parts = dirs[0]!.split(path.sep);
  for (const dir of dirs.slice(1)) {
    const other = dir.split(path.sep);
    let i = 0;
    while (i < parts.length && i < other.length && parts[i] === other[i]) i++;
    parts = parts.slice(0, i);
  }
  return parts.join(path.sep) || path.sep;
}
