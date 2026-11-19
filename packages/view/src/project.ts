/**
 * Turns SDK results into the viewer contract. This is the ONLY file in the viewer that reads
 * compiled flows, bound flows and diagnostics; everything after it sees contract types only.
 * It has no platform imports, so it can run anywhere.
 */
import type { BoundFlow, CheckResult, Diagnostic } from 'typemaid';
import type { Field, FlowGraph, FlowNode, FlowSummary, FlowView, NodeKind, ViewDiagnostic } from './contract.ts';

export interface FlowParts {
  id: string;
  /** Display path, relative to the viewed root. */
  file: string;
  /** The result of checking the diagram alone. */
  checked: CheckResult;
  /** Present when the tools were read and matched the diagram. */
  bound?: BoundFlow;
  /** Problems found while matching tools (errors or warnings). */
  toolDiagnostics?: Diagnostic[];
  toolsFile?: string;
  toolsError?: string;
  /** Rewrites text so it contains no absolute paths. */
  clean?: (text: string) => string;
}

export function toFlowView(parts: FlowParts): FlowView {
  const clean = parts.clean ?? ((text: string) => text);
  const { checked, bound } = parts;
  const flow = checked.flow;
  const all = [...checked.diagnostics, ...(parts.toolDiagnostics ?? [])];
  const diagnostics: ViewDiagnostic[] = dedupe(all).map((d) => {
    const out: ViewDiagnostic = { code: d.code, severity: d.severity, message: clean(d.message), line: d.line, column: d.column };
    if (d.hint !== undefined) out.hint = clean(d.hint);
    return out;
  });

  let graph: FlowGraph | undefined;
  const counts = { nodes: 0, tools: 0, agents: 0, humans: 0, decisions: 0 };
  if (flow) {
    const nodes = Object.values(flow.nodes).map((n): FlowNode => {
      const def = bound?.steps.get(n.id);
      let kind: NodeKind;
      if (n.kind === 'step') kind = def ? def.kind : n.hints.includes('agent') ? 'agent' : n.hints.includes('human') ? 'human' : 'unbound';
      else kind = n.kind;
      const node: FlowNode = { id: n.id, kind, entry: flow.entries.includes(n.id), line: n.line, column: n.column };
      if (n.label !== undefined) node.label = n.label;
      if (n.ref !== undefined) node.ref = n.ref;
      if (def?.spec.description) node.description = def.spec.description;
      if (n.scope !== '') node.group = n.scope;
      if (n.cond) node.condition = n.cond.kind === 'expr' ? n.cond.text : n.cond.name;
      if (n.kind === 'decision' || n.route === 'choice') node.branching = 'exclusive';
      else if (n.route === 'fork') node.branching = 'parallel';
      const io = bound?.io[n.id];
      if (io && (n.kind === 'step' || n.kind === 'decision' || n.kind === 'foreach')) {
        node.reads = fields(io.reads);
        node.writes = fields(io.writes);
      }
      return node;
    });
    for (const n of nodes) {
      if (n.kind === 'marker') continue;
      counts.nodes++;
      if (n.kind === 'tool' || n.kind === 'unbound') counts.tools++;
      else if (n.kind === 'agent') counts.agents++;
      else if (n.kind === 'human') counts.humans++;
      else if (n.kind === 'decision') counts.decisions++;
    }
    graph = {
      entries: [...flow.entries],
      nodes,
      edges: flow.edges.map((e, index) => {
        const edge: FlowGraph['edges'][number] = { id: `e${index}`, from: e.from, to: e.to, line: e.line };
        if (e.branch !== undefined) edge.label = e.branch;
        if (e.max !== undefined) edge.max = e.max;
        return edge;
      }),
      groups: Object.values(flow.foreach).map((fe) => {
        const loop = bound?.loops[fe.id];
        const group: FlowGraph['groups'][number] = { id: fe.id, kind: 'foreach', entry: fe.entry, line: fe.line };
        const item = loop?.item ?? fe.item;
        const list = loop ? loop.list.join('.') : fe.list;
        if (item !== undefined) group.item = item;
        if (list !== undefined) group.list = list;
        return group;
      }),
    };
  }

  const view: FlowView = {
    id: parts.id,
    file: parts.file,
    title: titleOf(checked.source, parts.file),
    counts,
    errors: diagnostics.filter((d) => d.severity === 'error').length + (parts.toolsError ? 1 : 0),
    warnings: diagnostics.filter((d) => d.severity === 'warning').length,
    diagram: { source: checked.source, exact: true },
    diagnostics,
  };
  if (flow) view.version = flow.hash.slice(0, 12);
  if (graph) view.graph = graph;
  if (parts.toolsFile !== undefined) view.toolsFile = parts.toolsFile;
  if (parts.toolsError !== undefined) view.toolsError = clean(parts.toolsError).split('\n')[0]!;
  if (bound) {
    view.inputs = {};
    for (const [entry, shape] of Object.entries(bound.inputs)) view.inputs[entry] = fields(shape);
  }
  return view;
}

export function toSummary(view: FlowView): FlowSummary {
  const { id, file, title, version, counts, errors, warnings, toolsFile } = view;
  const summary: FlowSummary = { id, file, title, counts, errors, warnings };
  if (version !== undefined) summary.version = version;
  if (toolsFile !== undefined) summary.toolsFile = toolsFile;
  return summary;
}

function fields(shape: Record<string, { kind: Field['kind']; required: boolean; options?: string[] }>): Record<string, Field> {
  const out: Record<string, Field> = {};
  for (const [name, f] of Object.entries(shape)) {
    out[name] = { kind: f.kind, required: f.required };
    if (f.options) out[name].options = [...f.options];
  }
  return out;
}

/** The frontmatter title if there is one, otherwise a readable form of the file name. */
function titleOf(source: string, file: string): string {
  const front = /^---\n([\s\S]*?)\n---/.exec(source);
  const title = front && /^title:\s*(.+)$/m.exec(front[1]!)?.[1]?.trim().replace(/^["']|["']$/g, '');
  if (title) return title;
  const base = file.split('/').pop()!.replace(/\.[^.]+$/, '');
  const words = base.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function dedupe(list: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  return list.filter((d) => {
    const key = `${d.code}|${d.line}|${d.column}|${d.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
