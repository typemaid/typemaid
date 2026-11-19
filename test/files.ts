import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));

export interface Fixture {
  name: string;
  file: string;
  source: string;
}

function read(dir: string): Fixture[] {
  const abs = path.join(root, dir);
  return readdirSync(abs)
    .filter((f) => f.endsWith('.mmd'))
    .sort()
    .map((f) => ({ name: f.replace(/\.mmd$/, ''), file: `${dir}/${f}`, source: readFileSync(path.join(abs, f), 'utf8') }));
}

export const accept: Fixture[] = [
  ...read('test/fixtures/accept'),
  ...readdirSync(path.join(root, 'examples'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .flatMap((d) => read(`examples/${d}`).map((f) => ({ ...f, name: `example-${f.name}` }))),
];
export const reject: Fixture[] = read('test/fixtures/reject');
export const golden = (rel: string) => path.join(root, 'test/golden', rel);
export { root };

/**
 * Compare text with a stored file. The file is written when it does not exist yet,
 * or when UPDATE_GOLDEN=1 is set; otherwise a difference fails the test.
 */
export function matchesGolden(rel: string, actual: string): { expected: string; actual: string } {
  const file = golden(rel);
  if (!existsSync(file) || process.env.UPDATE_GOLDEN === '1') {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, actual);
  }
  return { expected: readFileSync(file, 'utf8'), actual };
}
