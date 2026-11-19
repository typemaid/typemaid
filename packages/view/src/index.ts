import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createViewerHandler, type UiFile } from './handler.ts';
import { fileSource } from './source-fs.ts';

export type * from './contract.ts';
export { VIEW_SCHEMA_VERSION } from './contract.ts';

export interface ViewOptions {
  /** A tools file to use for every diagram, or false to read diagrams only and import no code. */
  tools?: string | false;
  /** Default 4747. If it is taken, the next free port is used. */
  port?: number;
  /** Fail instead of moving to another port. */
  strictPort?: boolean;
  /** Default '127.0.0.1' (this machine only). The viewer has no login; widen this with care. */
  host?: string;
  /** Extra host names the viewer may be reached under. */
  allowedHosts?: string[];
  /** Open the page in the default browser. Default false. */
  open?: boolean;
  /** Refresh the page when files change. Default true. */
  watch?: boolean;
  /** Folder with the built UI, if it is not in its usual place. */
  uiDir?: string;
}

export interface ViewerServer {
  url: string;
  port: number;
  /** Tools files whose code was imported to describe the steps. */
  toolsFiles: string[];
  close(): Promise<void>;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/**
 * Start the viewer for one diagram, several, or every diagram under a folder (default: the current folder).
 * One file opens straight on that diagram; a folder opens on the list of all workflows.
 */
export async function view(target: string | string[] = '.', options: ViewOptions = {}): Promise<ViewerServer> {
  const source = await fileSource({
    paths: Array.isArray(target) ? target : [target],
    ...(options.tools !== undefined ? { tools: options.tools } : {}),
    ...(options.watch !== undefined ? { watch: options.watch } : {}),
  });
  const ui = await loadUi(options.uiDir);
  const handler = createViewerHandler(source, { ui, ...(options.allowedHosts ? { allowedHosts: options.allowedHosts } : {}) });
  const host = options.host ?? '127.0.0.1';

  const server = createServer((req, res) => void bridge(handler, req, res));
  const port = await listen(server, host, options.port ?? 4747, options.strictPort ?? false);
  const shown = host === '0.0.0.0' || host === '::' ? 'localhost' : host.includes(':') ? `[${host}]` : host;
  const single = source.single();
  const url = `http://${shown}:${port}/${single ? `#/flow/${single}` : ''}`;
  if (options.open) openBrowser(url);

  return {
    url,
    port,
    toolsFiles: source.toolsFiles(),
    async close() {
      await source.close?.();
      await new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      });
    },
  };
}

/** Passes one node:http request through a fetch-style handler. node:http exists on both Node and Bun. */
async function bridge(handler: (request: Request) => Promise<Response>, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const abort = new AbortController();
  res.on('close', () => abort.abort());
  try {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') headers.set(name, value);
      else if (Array.isArray(value)) headers.set(name, value.join(', '));
    }
    const url = `http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`;
    const response = await handler(new Request(url, { method: req.method ?? 'GET', headers, signal: abort.signal }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (!response.body) {
      res.end();
      return;
    }
    const reader = response.body.getReader();
    res.on('close', () => void reader.cancel().catch(() => undefined));
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch {
    if (!res.headersSent) res.writeHead(400, { 'content-type': 'application/json' });
    res.end(res.writableEnded ? undefined : '{"error":{"code":"bad_request","message":"Bad request."}}');
  }
}

function listen(server: ReturnType<typeof createServer>, host: string, first: number, strict: boolean): Promise<number> {
  return new Promise((resolve, reject) => {
    let port = first;
    const attempt = () => {
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && !strict && port < first + 20) {
          port++;
          attempt();
        } else {
          reject(err.code === 'EADDRINUSE' ? new Error(`Port ${port} is already in use.`) : err);
        }
      });
      server.listen(port, host, () => {
        server.removeAllListeners('error');
        resolve(port);
      });
    };
    attempt();
  });
}

/** Reads the built UI into memory once, so serving never touches the disk with a request path. */
async function loadUi(explicit?: string): Promise<Map<string, UiFile>> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = explicit ? [path.resolve(explicit)] : [path.join(here, 'ui'), path.join(here, '../dist/ui')];
  for (const dir of candidates) {
    const files = new Map<string, UiFile>();
    const walk = async (sub: string): Promise<void> => {
      for (const entry of await readdir(path.join(dir, sub), { withFileTypes: true })) {
        const rel = `${sub}/${entry.name}`;
        if (entry.isDirectory()) await walk(rel);
        else {
          const type = TYPES[path.extname(entry.name)];
          if (type) files.set(rel, { body: await readFile(path.join(dir, rel)), type, hashed: /[-.][a-z0-9]{8,}\.[a-z0-9]+$/i.test(entry.name) });
        }
      }
    };
    try {
      await walk('');
    } catch {
      continue;
    }
    if (files.has('/index.html')) return files;
  }
  throw new Error('The viewer UI has not been built. Run the build first (bun run build).');
}

function openBrowser(url: string): void {
  const [command, args] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  // Arguments are passed as a list, never through a shell.
  execFile(command as string, args as string[], () => undefined);
}
