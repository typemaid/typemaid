/**
 * Every diagram this package accepts must also be a valid Mermaid flowchart with the same
 * nodes and arrows. The official Mermaid parser is the referee. It needs a browser-like
 * environment, so jsdom globals are set up before it is imported.
 */
import { JSDOM } from 'jsdom';
import { beforeAll, describe, expect, it } from 'bun:test';
import { compile } from 'typemaid';
import { accept } from './files.ts';

interface Parsed {
  nodes: string[];
  edges: string[];
}

let parseWithMermaid: (source: string) => Promise<Parsed>;

beforeAll(async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  const g = globalThis as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  for (const key of ['Element', 'HTMLElement', 'SVGElement', 'Node', 'DOMParser', 'MutationObserver']) {
    g[key] ??= (dom.window as unknown as Record<string, unknown>)[key];
  }
  const mermaid = (await import('mermaid')).default;
  mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
  parseWithMermaid = async (source) => {
    const diagram = await mermaid.mermaidAPI.getDiagramFromText(source);
    const db = diagram.db as unknown as {
      getVertices(): Map<string, unknown>;
      getEdges(): Array<{ start: string; end: string }>;
      getSubGraphs(): Array<{ id: string }>;
    };
    const subgraphs = new Set(db.getSubGraphs().map((s) => s.id));
    return {
      nodes: [...db.getVertices().keys()].filter((id) => !subgraphs.has(id)).sort(),
      edges: db.getEdges().map((e) => `${e.start}->${e.end}`).sort(),
    };
  };
}, 60_000);

describe('agrees with the official Mermaid parser', () => {
  it.each(accept)('$name', async ({ source }) => {
    const flow = compile(source);
    const ours: Parsed = {
      nodes: Object.values(flow.nodes).filter((n) => n.kind !== 'foreach').map((n) => n.id).sort(),
      edges: flow.edges.map((e) => `${e.from}->${e.to}`).sort(),
    };
    expect(ours).toEqual(await parseWithMermaid(source));
  });

  it('Mermaid rejects the reserved words we reject', async () => {
    await expect(parseWithMermaid('flowchart TD\n  a --> end')).rejects.toThrow();
    await expect(parseWithMermaid('flowchart TD\n  call --> b')).rejects.toThrow();
  });

  it('Mermaid misreads a missing space before a name starting with o, which we refuse', async () => {
    const parsed = await parseWithMermaid('flowchart TD\n  a---order');
    expect(parsed.nodes).not.toContain('order');
    expect(() => compile('flowchart TD\n  a---order')).toThrow(/Only `-->` arrows/);
  });
});
