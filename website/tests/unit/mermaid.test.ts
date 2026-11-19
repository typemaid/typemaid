import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MERMAID_URL, MERMAID_VERSION } from '../../src/scripts/mermaid';

const website = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));

describe('Mermaid from the CDN', () => {
  it('is the same version as the mermaid package the site and the referee test use', () => {
    expect(readJson(path.join(website, 'package.json')).dependencies.mermaid).toBe(MERMAID_VERSION);
    expect(readJson(path.join(website, '..', 'package.json')).devDependencies.mermaid).toBe(MERMAID_VERSION);
  });

  it('is a pinned ES module on jsDelivr', () => {
    expect(MERMAID_URL).toBe(`https://cdn.jsdelivr.net/npm/mermaid@${MERMAID_VERSION}/dist/mermaid.esm.min.mjs`);
  });
});
