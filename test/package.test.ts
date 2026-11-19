import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'bun:test';
import { BRAND, VERSION } from 'typemaid';
import { root } from './files.ts';

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('package rules', () => {
  it('the product name is written in one source file only, so renaming stays easy', () => {
    const offenders = sources(path.join(root, 'src'))
      .filter((f) => !f.endsWith(path.join('src', 'brand.ts')))
      .filter((f) => readFileSync(f, 'utf8').toLowerCase().includes(BRAND.name));
    expect(offenders.map((f) => path.relative(root, f))).toEqual([]);
  });

  it('the compiler core has no platform imports and no dynamic code', () => {
    for (const file of sources(path.join(root, 'src/core'))) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/from 'node:|import\('node:|\beval\(|new Function\(/);
    }
  });

  it('only the adapter imports the AI SDK, and only lazily', () => {
    const users = sources(path.join(root, 'src')).filter((f) => /from 'ai'|import\('ai'\)/.test(readFileSync(f, 'utf8')));
    expect(users.map((f) => path.relative(root, f).split(path.sep).join('/'))).toEqual(['src/ai/adapter.ts']);
  });

  it('the built main entry has no static import of the AI SDK, SQLite or the file system', () => {
    const seen = new Set<string>();
    const staticImports = (file: string): string[] => {
      if (seen.has(file)) return [];
      seen.add(file);
      const text = readFileSync(file, 'utf8');
      const found = [...text.matchAll(/^(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|^import\s*["']([^"']+)["']/gm)].map((m) => m[1] ?? m[2]!);
      return found.flatMap((spec) => (spec.startsWith('.') ? staticImports(path.join(path.dirname(file), spec)) : [spec]));
    };
    const external = [...new Set(staticImports(path.join(root, 'dist/index.mjs')))];
    expect(external).toEqual([]);
  });

  it('a flow runs from the built package in a fresh process', () => {
    const script = path.join(root, 'dist', '.probe.mjs');
    writeFileSync(script, `import { run, tool } from './index.mjs';\nconst r = await run('flowchart TD\\n  a', { a: tool({ run: () => ({ ok: true }) }) });\nconsole.log(r.status);\n`);
    try {
      expect(execFileSync(process.execPath, [script], { cwd: root, encoding: 'utf8' }).trim()).toBe('completed');
    } finally {
      rmSync(script, { force: true });
    }
  });

  it('CommonJS code can require() the package', () => {
    const script = `const m = require(${JSON.stringify(path.join(root, 'dist/index.mjs'))}); console.log(typeof m.run, typeof m.tool)`;
    const out = execFileSync(process.execPath, ['-e', script], { cwd: root, encoding: 'utf8' });
    expect(out.trim()).toBe('function function');
  });
});

describe('workspace packages', () => {
  const names = readdirSync(path.join(root, 'packages')).filter((d) => statSync(path.join(root, 'packages', d)).isDirectory());
  const manifest = (dir: string) => JSON.parse(readFileSync(path.join(root, 'packages', dir, 'package.json'), 'utf8')) as Record<string, any>;

  it('there is a viewer and two stores', () => {
    expect(names.sort()).toEqual(['libsql', 'postgres', 'view']);
  });

  it('every package has the core version, needs exactly that core, and carries the same licence', () => {
    const licence = readFileSync(path.join(root, 'LICENSE.md'), 'utf8');
    for (const dir of names) {
      const pkg = manifest(dir);
      expect(pkg.name, dir).toBe(`@${BRAND.name}/${dir}`);
      expect(pkg.version, dir).toBe(VERSION);
      expect(pkg.peerDependencies, dir).toEqual({ [BRAND.name]: VERSION });
      expect(pkg.dependencies, dir).toBeUndefined();
      expect(pkg.license, dir).toBe('FSL-1.1-MIT');
      expect(readFileSync(path.join(root, 'packages', dir, 'LICENSE.md'), 'utf8'), dir).toBe(licence);
    }
  });

  it('a store is one file that knows the core only by its package name, and no database driver', () => {
    for (const dir of names.filter((d) => d !== 'view')) {
      const files = sources(path.join(root, 'packages', dir, 'src'));
      expect(files.map((f) => path.basename(f)), dir).toEqual(['index.ts']);
      const text = readFileSync(files[0]!, 'utf8');
      const imports = [...text.matchAll(/from\s+'([^']+)'|import\('([^']+)'\)/g)].map((m) => m[1] ?? m[2]!);
      expect(imports, dir).toEqual([BRAND.name]);
      expect(text.replace(`from '${BRAND.name}'`, '').toLowerCase(), dir).not.toContain(BRAND.name);
      const built = readFileSync(path.join(root, 'packages', dir, 'dist/index.mjs'), 'utf8');
      expect([...built.matchAll(/from\s*["']([^"']+)["']/g)].map((m) => m[1]), dir).toEqual([BRAND.name]);
    }
  });
});
