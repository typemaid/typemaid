// Copies the images used by the docs (and the logo the READMEs show on npm) into public/ so the site serves them.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '..', '..', 'docs');
const dest = path.resolve(here, '..', 'public', 'docs');

fs.mkdirSync(dest, { recursive: true });
for (const file of fs.readdirSync(src)) {
  if (/\.(png|jpe?g|svg|gif|webp)$/i.test(file)) {
    fs.copyFileSync(path.join(src, file), path.join(dest, file));
  }
}
