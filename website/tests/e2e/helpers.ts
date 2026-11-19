import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser } from 'playwright';
import { dist } from '../site/helpers';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.wasm': 'application/wasm', '.pf_meta': 'application/octet-stream', '.pf_index': 'application/octet-stream',
  '.pf_fragment': 'application/octet-stream', '.pf_filter': 'application/octet-stream',
};

/** Serves dist/ like Cloudflare Pages does: "/docs/faq/" -> dist/docs/faq/index.html. */
export async function serveDist(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    let file = path.join(dist, pathname);
    if (!file.startsWith(dist)) { res.writeHead(403).end(); return; }
    if (pathname.endsWith('/')) file = path.join(file, 'index.html');
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) };
}

/** Uses installed Chrome when present, otherwise Playwright's Chromium (npx playwright install chromium). */
export async function launch(): Promise<Browser> {
  try {
    return await chromium.launch({ channel: 'chrome' });
  } catch {
    return await chromium.launch();
  }
}
