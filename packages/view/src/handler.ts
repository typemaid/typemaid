import type { ApiError } from './contract.ts';
import type { ViewerSource } from './source.ts';

export interface UiFile {
  body: Uint8Array;
  type: string;
  /** True for files whose name contains a content hash, so they can be cached for good. */
  hashed: boolean;
}

export interface HandlerOptions {
  /** The built UI, by URL path ('/index.html', '/chunk-abc.js', ...). */
  ui: Map<string, UiFile>;
  /** Extra host names the viewer may be reached under. Loopback names and IP addresses are always accepted. */
  allowedHosts?: string[];
}

const API = '/api/v1';
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * The viewer as a standard `(Request) => Response` function. It runs on Bun, Node and anything
 * else that speaks the Fetch API, and it knows nothing about the SDK: all data comes from `source`.
 * Read-only: every method other than GET and HEAD is refused.
 */
export function createViewerHandler(source: ViewerSource, options: HandlerOptions): (request: Request) => Promise<Response> {
  const allowed = new Set(['localhost', '127.0.0.1', '[::1]', ...(options.allowedHosts ?? [])]);
  const isIp = (host: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[');

  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
    });
  const fail = (status: number, code: string, message: string): Response => json({ error: { code, message } } satisfies ApiError, status);

  return async (request) => {
    const url = new URL(request.url);
    // Refuse requests that arrive under a name we do not expect, or from another site's page.
    // Binding to this machine alone does not stop a web page from reaching a local server.
    const host = (request.headers.get('host') ?? url.host).toLowerCase();
    const hostname = host.replace(/:\d+$/, '');
    if (!allowed.has(hostname) && !isIp(hostname)) return fail(403, 'forbidden_host', 'This host name is not allowed.');
    const origin = request.headers.get('origin');
    if (origin !== null && safeHost(origin) !== host) return fail(403, 'forbidden_origin', 'Requests from other sites are not allowed.');
    if (request.method !== 'GET' && request.method !== 'HEAD') return fail(405, 'read_only', 'The viewer is read-only.');

    const pathname = decodeURIComponent(url.pathname);
    try {
      if (pathname === `${API}/meta`) return json(await source.meta());
      if (pathname === `${API}/flows`) return json(await source.listFlows());
      if (pathname.startsWith(`${API}/flows/`)) {
        const flow = await source.getFlow(pathname.slice(`${API}/flows/`.length));
        return flow ? json(flow) : fail(404, 'not_found', 'No such workflow.');
      }
      if (pathname === `${API}/events`) return events(source, request);
      if (pathname.startsWith(`${API}/runs`)) return fail(404, 'not_supported', 'Runs are not available from this server.');
      if (pathname.startsWith('/api/')) return fail(404, 'not_found', 'Unknown API route.');
    } catch {
      return fail(500, 'internal', 'The viewer could not read its data.');
    }

    // Static UI. Only files from the fixed map are ever served; the request path is never used as a file path.
    const file = options.ui.get(pathname === '/' ? '/index.html' : pathname) ?? (/\.[a-z0-9]+$/i.test(pathname) ? undefined : options.ui.get('/index.html'));
    if (!file) return fail(404, 'not_found', 'Not found.');
    return new Response(request.method === 'HEAD' ? null : (file.body as unknown as ConstructorParameters<typeof Response>[0]), {
      headers: {
        'content-type': file.type,
        'cache-control': file.hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
        'x-content-type-options': 'nosniff',
        'content-security-policy': CSP,
        'referrer-policy': 'no-referrer',
      },
    });
  };
}

function safeHost(origin: string): string | undefined {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return undefined;
  }
}

/** A Server-Sent Events stream of changes, with a regular heartbeat so idle connections stay open. */
function events(source: ViewerSource, request: Request): Response {
  const encoder = new TextEncoder();
  let stop = (): void => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          stop();
        }
      };
      send('retry: 2000\n\n');
      const unsubscribe = source.subscribe?.((event) => send(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)) ?? (() => {});
      const beat = setInterval(() => send(': ping\n\n'), 5000);
      stop = () => {
        clearInterval(beat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      request.signal.addEventListener('abort', () => stop(), { once: true });
    },
    cancel() {
      stop();
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}
