import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Builds the site (with the search index) once before the site and e2e tests read dist/.
// Set SKIP_BUILD=1 to test an existing dist/ (npm test builds first, then sets it).
export default function setup() {
  if (process.env.SKIP_BUILD === '1') return;
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'pipe' });
}
