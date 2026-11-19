/**
 * The viewer's only way to get data. It speaks the viewer contract over HTTP and knows nothing
 * else about where the data comes from. A hosted version passes its own `fetch` (for sign-in).
 */
import type { ApiError, FlowList, FlowView, Meta, ViewerEvent } from '../../src/contract.ts';

export const SUPPORTED_SCHEMA = 1;

export interface DataClient {
  meta(): Promise<Meta>;
  flows(): Promise<FlowList>;
  flow(id: string): Promise<FlowView>;
  /** Calls `onEvent` on changes and `onState` when the connection is lost or comes back. */
  subscribe(onEvent: (event: ViewerEvent) => void, onState: (connected: boolean) => void): () => void;
}

export function readConfig(): { apiBase: string } {
  try {
    const text = document.getElementById('viewer-config')?.textContent ?? '';
    const parsed = JSON.parse(text) as { apiBase?: unknown };
    if (typeof parsed.apiBase === 'string') return { apiBase: parsed.apiBase.replace(/\/$/, '') };
  } catch {
    // fall through to the default
  }
  return { apiBase: 'api/v1' };
}

export function httpClient(apiBase: string, doFetch: typeof fetch = fetch.bind(globalThis)): DataClient {
  const get = async <T>(path: string): Promise<T> => {
    const response = await doFetch(`${apiBase}${path}`, { headers: { accept: 'application/json' } });
    if (!response.ok) {
      const body = (await response.json().catch(() => undefined)) as ApiError | undefined;
      throw new Error(body?.error.message ?? `Request failed (${response.status}).`);
    }
    return (await response.json()) as T;
  };
  return {
    meta: () => get<Meta>('/meta'),
    flows: () => get<FlowList>('/flows'),
    flow: (id) => get<FlowView>(`/flows/${encodeURIComponent(id)}`),
    subscribe(onEvent, onState) {
      const stream = new EventSource(`${apiBase}/events`);
      stream.onopen = () => onState(true);
      stream.onerror = () => onState(false);
      stream.addEventListener('flows.changed', (e) => onEvent(JSON.parse((e as MessageEvent<string>).data) as ViewerEvent));
      return () => stream.close();
    },
  };
}
