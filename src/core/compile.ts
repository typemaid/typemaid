import { DIALECT, RUN_FORMAT } from '../brand.ts';
import { Diagnostics, FlowError, sortDiagnostics, suggest, type Diagnostic } from './diagnostics.ts';
import { ExprError, parseExpr, type Expr } from './expr.ts';
import { sha256 } from './hash.ts';
import { normalizeSource, parse, type Ast, type EdgeDecl, type NodeDecl, type Pos } from './parse.ts';

export type NodeKind = 'step' | 'decision' | 'marker' | 'foreach';

export type Cond = { kind: 'name'; name: string } | { kind: 'expr'; text: string; ast: Expr };

export interface IRNode extends Pos {
  id: string;
  kind: NodeKind;
  /** '' for the top level, or the id of the for-each block that contains the node. */
  scope: string;
  /** step: name of the export this node runs. */
  ref?: string;
  label?: string;
  /** Meaningful classes on the node: start, stop, agent, human, tool. */
  hints: string[];
  cond?: Cond;
  /** Indexes into `edges`, in the order the arrows were written. */
  out: number[];
  /** Set when the node has several outgoing arrows: run all of them, or pick one by label. */
  route?: 'fork' | 'choice';
  /** fork: the node where the branches meet again, or null when they run to the end. */
  join?: string | null;
}

export interface IREdge extends Pos {
  from: string;
  to: string;
  branch?: string;
  /** How many times this arrow may be followed in one run. */
  max?: number;
  /** Arrows whose counters start again each time this arrow is followed (inner loops). */
  resets?: number[];
}

export interface IRForeach extends Pos {
  id: string;
  item?: string;
  list?: string;
  entry: string;
}

/** The checked diagram as plain JSON. This is what gets cached, stored with a run, and executed. */
export interface CompiledFlow {
  format: number;
  dialect: number;
  hash: string;
  file?: string;
  entries: string[];
  nodes: Record<string, IRNode>;
  edges: IREdge[];
  foreach: Record<string, IRForeach>;
}

export interface CheckResult {
  flow?: CompiledFlow;
  diagnostics: Diagnostic[];
  source: string;
}

export interface CompileOptions {
  file?: string;
  limits?: { maxNodes?: number; maxEdges?: number; maxLoopCap?: number };
}

const HINTS = new Set(['start', 'stop', 'agent', 'human', 'tool']);
const EXIT = '\u0000exit';

/** Parse and check a diagram. Never throws for problems in the diagram; they are returned. */
export function check(source: string, options: CompileOptions = {}): CheckResult {
  const text = normalizeSource(source);
  const diags = new Diagnostics(options.file);
  const ast = parse(text, diags);
  let flow: CompiledFlow | undefined;
  if (!diags.hasErrors) flow = build(ast, text, diags, options);
  const diagnostics = sortDiagnostics(diags.list);
  const result: CheckResult = { diagnostics, source: text };
  if (flow && !diags.hasErrors) result.flow = flow;
  return result;
}

/** Parse and check a diagram, throwing a FlowError that lists every problem found. */
export function compile(source: string, options: CompileOptions = {}): CompiledFlow {
  const result = check(source, options);
  if (!result.flow) throw new FlowError(result.diagnostics.filter((d) => d.severity === 'error'), result.source);
  return result.flow;
}

function build(ast: Ast, text: string, diags: Diagnostics, options: CompileOptions): CompiledFlow | undefined {
  const maxNodes = options.limits?.maxNodes ?? 500;
  const maxEdges = options.limits?.maxEdges ?? 2000;
  const maxLoopCap = options.limits?.maxLoopCap ?? 1000;
  if (ast.nodes.length > maxNodes) diags.error('E1002', `Too many nodes (${ast.nodes.length}; limit ${maxNodes}).`);
  if (ast.edges.length > maxEdges) diags.error('E1002', `Too many arrows (${ast.edges.length}; limit ${maxEdges}).`);
  if (diags.hasErrors) return undefined;
  if (ast.nodes.length === 0) {
    diags.error('E1101', 'The diagram has no nodes.', { line: 1, column: 1 });
    return undefined;
  }

  const foreachIds = new Set<string>();
  const foreach: Record<string, IRForeach> = {};
  const nodes: Record<string, IRNode> = {};

  // --- for-each blocks -------------------------------------------------------------------------
  for (const sg of ast.subgraphs) {
    if (!sg.classes.includes('foreach')) continue;
    foreachIds.add(sg.id);
  }
  const scopeOf = (decl: NodeDecl): string => (decl.subgraph !== undefined && foreachIds.has(decl.subgraph) ? decl.subgraph : '');

  // --- nodes -----------------------------------------------------------------------------------
  for (const decl of ast.nodes) {
    const hints = decl.classes.filter((c) => HINTS.has(c));
    for (const c of decl.classes) {
      if (HINTS.has(c) || c === 'foreach' || ast.classDefs.includes(c)) continue;
      const near = suggest(c, [...HINTS, 'foreach']);
      if (near !== undefined && near !== c) {
        diags.warn('W1150', `Class \`${c}\` on \`${decl.id}\` has no meaning here. Did you mean \`:::${near}\`?`, decl);
      }
    }
    const node: IRNode = { id: decl.id, kind: 'step', scope: scopeOf(decl), hints, out: [], line: decl.line, column: decl.column };
    if (decl.label !== undefined && decl.label !== '') node.label = decl.label;
    if (decl.classes.includes('foreach')) {
      diags.error('E1111', '`foreach` can only be put on a subgraph.', decl, `Write \`subgraph ${decl.id}["for item in items"]\`.`);
    }
    if (decl.shape === 'diamond') {
      node.kind = 'decision';
      const cond = readCond(decl, diags);
      if (cond) node.cond = cond;
    } else if (decl.shape === 'stadium' || decl.shape === 'circle') {
      node.kind = 'marker';
    } else {
      const label = decl.label ?? '';
      if (label.startsWith('$')) {
        const ref = label.slice(1).trim();
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(ref)) node.ref = ref;
        else diags.error('E1011', `\`${label}\` is not a valid tool name.`, decl, 'After `$` use letters, digits and `_` only.');
      } else {
        node.ref = decl.id;
      }
    }
    nodes[decl.id] = node;
  }
  for (const sg of ast.subgraphs) {
    if (!foreachIds.has(sg.id)) continue;
    nodes[sg.id] = { id: sg.id, kind: 'foreach', scope: '', hints: [], out: [], line: sg.line, column: sg.column };
    const fe: IRForeach = { id: sg.id, entry: '', line: sg.line, column: sg.column };
    const m = /^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)$/i.exec(sg.title ?? '');
    if (m) {
      fe.item = m[1]!;
      fe.list = m[2]!;
    }
    foreach[sg.id] = fe;
  }

  // --- edges -----------------------------------------------------------------------------------
  const edges: IREdge[] = [];
  const seen = new Set<string>();
  for (const decl of ast.edges) {
    const from = nodes[decl.from];
    const to = nodes[decl.to];
    if (!from || !to) {
      const missing = !from ? decl.from : decl.to;
      const cosmetic = ast.subgraphs.some((s) => s.id === missing);
      diags.error(
        'E1108',
        cosmetic
          ? `Arrows can only connect to a subgraph that is a for-each block; \`${missing}\` is not.`
          : `Unknown node \`${missing}\`.`,
        decl,
        cosmetic ? `Add \`class ${missing} foreach\`, or connect to a node inside it.` : undefined,
      );
      continue;
    }
    if (from.scope !== to.scope) {
      diags.error(
        'E1108',
        `The arrow from \`${from.id}\` to \`${to.id}\` crosses the edge of a for-each block.`,
        decl,
        'Connect to the block itself, not to a node inside it.',
      );
      continue;
    }
    const edge: IREdge = { from: decl.from, to: decl.to, line: decl.line, column: decl.column };
    readEdgeLabel(decl, edge, from, diags, maxLoopCap);
    const key = `${edge.from}\u0001${edge.to}\u0001${edge.branch ?? ''}`;
    if (seen.has(key)) {
      diags.error('E1114', `The arrow from \`${edge.from}\` to \`${edge.to}\` is written twice.`, decl);
      continue;
    }
    seen.add(key);
    from.out.push(edges.length);
    edges.push(edge);
  }
  if (diags.hasErrors) return undefined;

  // --- per-scope analysis ----------------------------------------------------------------------
  const scopes = ['', ...Object.keys(foreach)];
  const entries: string[] = [];
  for (const scope of scopes) {
    const ids = Object.keys(nodes).filter((id) => nodes[id]!.scope === scope);
    const found = analyzeScope(scope, ids, nodes, edges, diags, foreach[scope]);
    if (scope === '') entries.push(...found);
    else if (foreach[scope] && found[0] !== undefined) foreach[scope]!.entry = found[0];
  }
  if (diags.hasErrors) return undefined;

  const flow: CompiledFlow = {
    format: RUN_FORMAT,
    dialect: DIALECT,
    hash: sha256(`${DIALECT}\n${text}`),
    entries,
    nodes,
    edges,
    foreach,
  };
  if (options.file !== undefined) flow.file = options.file.replaceAll('\\', '/');
  return flow;
}

function readCond(decl: NodeDecl, diags: Diagnostics): Cond | undefined {
  const label = (decl.label ?? '').trim();
  if (label === '') {
    diags.error('E1112', `Decision \`${decl.id}\` has no condition.`, decl, `Write \`${decl.id}{"score >= 8"}\` or \`${decl.id}{fieldName}\`.`);
    return undefined;
  }
  if (!decl.quoted && /^[A-Za-z_][A-Za-z0-9_]*$/.test(label)) return { kind: 'name', name: label };
  if (!decl.quoted) {
    let readable = true;
    try {
      parseExpr(label);
    } catch {
      readable = false;
    }
    if (readable) {
      diags.error('E1112', 'A condition that is more than a single name must be in double quotes.', decl, `Write \`${decl.id}{"${label}"}\`.`);
    } else {
      diags.error(
        'E1112',
        'A decision needs a condition over fields, not a sentence.',
        decl,
        `Write a condition such as \`${decl.id}{"score >= 8"}\`, or name a true/false field or exported function: \`${decl.id}{isGood}\`.`,
      );
    }
    return undefined;
  }
  if (label.includes('#')) {
    diags.error('E1113', 'Character codes like `#quot;` cannot be used in a condition.', decl);
    return undefined;
  }
  try {
    return { kind: 'expr', text: label, ast: parseExpr(label) };
  } catch (err) {
    if (!(err instanceof ExprError)) throw err;
    diags.error('E1113', `Cannot read the condition "${label}": ${err.message}`, decl, 'Conditions can compare fields with ==, !=, >, >=, <, <= and combine them with and, or, not.');
    return undefined;
  }
}

function readEdgeLabel(decl: EdgeDecl, edge: IREdge, from: IRNode, diags: Diagnostics, maxLoopCap: number): void {
  if (decl.label === undefined) return;
  if (decl.label === '') {
    diags.error('E1014', 'The arrow text is empty.', decl, 'Remove the `||` or write a label.');
    return;
  }
  for (const part of decl.label.split(',').map((s) => s.trim())) {
    const max = /^max\s+(\d+)$/i.exec(part);
    if (max) {
      const n = Number(max[1]);
      if (n < 1 || n > maxLoopCap) {
        diags.error('E1014', `\`max\` must be between 1 and ${maxLoopCap}.`, decl);
      } else if (edge.max !== undefined) {
        diags.error('E1014', '`max` is written twice on this arrow.', decl);
      } else {
        edge.max = n;
      }
      continue;
    }
    if (/^(timeout\b.*|error)$/i.test(part)) {
      diags.error('E1014', `\`${part.split(/\s/)[0]}\` on an arrow is reserved and not supported yet.`, decl);
      continue;
    }
    if (/^max\b/i.test(part)) {
      diags.error('E1014', `Cannot read \`${part}\`.`, decl, 'Write `max 5`.');
      continue;
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(part)) {
      diags.error('E1014', `Arrow text \`${part}\` is not understood.`, decl, 'Use one word such as `yes`, `no` or `approved`, optionally followed by `, max 5`.');
      continue;
    }
    if (edge.branch !== undefined) {
      diags.error('E1014', 'An arrow can have only one label.', decl);
      continue;
    }
    if (from.kind === 'decision') {
      const lower = part.toLowerCase();
      edge.branch = lower === 'true' ? 'yes' : lower === 'false' ? 'no' : lower;
    } else {
      edge.branch = part;
    }
  }
}

/** Checks one scope (the top level or one for-each body) and returns its entry nodes. */
function analyzeScope(
  scope: string,
  ids: string[],
  nodes: Record<string, IRNode>,
  edges: IREdge[],
  diags: Diagnostics,
  fe: IRForeach | undefined,
): string[] {
  const before = diags.list.length;
  const failed = () => diags.list.slice(before).some((d) => d.severity === 'error');
  const succ = (id: string) => nodes[id]!.out.map((i) => edges[i]!.to);
  const preds = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const id of ids) for (const to of succ(id)) preds.get(to)!.push(id);
  if (fe && ids.length === 0) {
    diags.error('E1111', `For-each block \`${fe.id}\` is empty.`, fe);
    return [];
  }

  // Loops need a cap: without the capped arrows the graph must have no cycle.
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (root: string): void => {
    // An explicit stack, so very long chains cannot overflow the call stack.
    const stack: Array<{ id: string; next: number }> = [{ id: root, next: 0 }];
    state.set(root, 1);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const out = nodes[frame.id]!.out;
      if (frame.next >= out.length) {
        state.set(frame.id, 2);
        stack.pop();
        continue;
      }
      const e = edges[out[frame.next++]!]!;
      if (e.max !== undefined) continue;
      const s = state.get(e.to) ?? 0;
      if (s === 1) {
        diags.error('E1106', `The arrow from \`${e.from}\` back to \`${e.to}\` makes a loop with no limit.`, e, `Add a limit to its label, for example \`|${e.branch ? `${e.branch}, ` : ''}max 5|\`.`);
      } else if (s === 0) {
        state.set(e.to, 1);
        stack.push({ id: e.to, next: 0 });
      }
    }
  };
  for (const id of ids) if ((state.get(id) ?? 0) === 0) visit(id);
  if (failed()) return [];

  // Entries.
  let entries: string[];
  if (scope === '') {
    entries = ids.filter((id) => nodes[id]!.hints.includes('start'));
    if (entries.length === 0) {
      entries = ids.filter((id) => preds.get(id)!.length === 0);
      if (entries.length === 0) {
        // Everything is part of a loop: the flow starts at the node written first.
        entries = [ids[0]!];
      } else if (entries.length > 1) {
        diags.error('E1102', `Several nodes could be the start: ${entries.map((e) => `\`${e}\``).join(', ')}.`, nodes[entries[1]!], 'Mark each intended entry point with `:::start`, or connect the others.');
      }
    }
  } else {
    for (const id of ids) {
      if (nodes[id]!.hints.includes('start')) diags.error('E1111', '`:::start` cannot be used inside a for-each block.', nodes[id]);
    }
    entries = ids.filter((id) => preds.get(id)!.length === 0);
    if (entries.length === 0) entries = [ids[0]!];
    if (entries.length !== 1) {
      diags.error('E1111', `For-each block \`${scope}\` must have exactly one first node (found ${entries.length}).`, fe);
    }
  }
  if (failed()) return [];

  // Per-node rules.
  for (const id of ids) {
    const node = nodes[id]!;
    const outs = node.out.map((i) => edges[i]!);
    if (node.hints.includes('stop') && outs.length > 0) {
      diags.error('E1109', `\`${id}\` is marked \`:::stop\` but has an arrow leaving it.`, node);
    }
    if (node.kind === 'decision') {
      const labels = outs.map((e) => e.branch).sort();
      if (outs.length !== 2 || labels[0] !== 'no' || labels[1] !== 'yes') {
        diags.error('E1104', `Decision \`${id}\` needs exactly two arrows, labelled \`yes\` and \`no\`.`, node, `Write \`${id} -->|yes| a\` and \`${id} -->|no| b\`.`);
      }
      continue;
    }
    const labelled = outs.filter((e) => e.branch !== undefined);
    if (labelled.length === 0) {
      if (outs.length > 1) node.route = 'fork';
    } else if (labelled.length !== outs.length || outs.length < 2) {
      diags.error(
        'E1105',
        outs.length < 2
          ? `The label \`${labelled[0]!.branch}\` on the arrow from \`${id}\` has no meaning: \`${id}\` is not a decision.`
          : `Arrows leaving \`${id}\` must either all have labels (pick one) or none (run all).`,
        labelled[0],
        node.kind === 'step' ? `For a yes/no decision use a diamond: \`name{condition}\`.` : undefined,
      );
    } else {
      node.route = 'choice';
    }
  }

  // Reachability.
  const reach = walk(entries, succ);
  for (const id of ids) {
    if (!reach.has(id)) {
      const root = preds.get(id)!.length === 0;
      diags.error(
        'E1103',
        `Node \`${id}\` can never be reached${scope === '' ? ` from the start (${entries.map((e) => `\`${e}\``).join(', ')})` : ''}.`,
        nodes[id],
        root && scope === '' ? `If the flow can also start here, mark it \`${id}:::start\`. Otherwise connect it with an arrow, or remove it.` : 'Connect it with an arrow, or remove it.',
      );
    }
  }
  // Every node must be able to reach an end.
  const ends = ids.filter((id) => nodes[id]!.out.length === 0);
  const canEnd = walk(ends, (id) => preds.get(id)!);
  const stuck = ids.filter((id) => !canEnd.has(id));
  if (stuck.length > 0) {
    diags.error('E1110', `The flow can never finish from \`${stuck[0]}\`: no path leads to an end.`, nodes[stuck[0]!], 'Add an arrow that leaves the loop.');
  }
  if (failed()) return entries;

  // Inner loops: following an outer loop arrow restarts the counters of loops inside it.
  const capped = ids.flatMap((id) => nodes[id]!.out).filter((i) => edges[i]!.max !== undefined);
  const bodies = new Map<number, Set<string>>();
  for (const i of capped) {
    const e = edges[i]!;
    const body = walk([e.from], (id) => (id === e.to ? [] : preds.get(id)!));
    body.add(e.to);
    bodies.set(i, body);
  }
  for (const i of capped) {
    const outer = bodies.get(i)!;
    const resets = capped.filter((j) => {
      if (j === i) return false;
      const inner = bodies.get(j)!;
      return inner.size < outer.size && [...inner].every((n) => outer.has(n));
    });
    if (resets.length > 0) edges[i]!.resets = resets;
  }

  // Parallel blocks: find where the branches meet and check the block is self-contained.
  const forks = ids.filter((id) => nodes[id]!.route === 'fork');
  if (forks.length > 0) {
    const pdom = postDominators(ids, succ);
    for (const id of forks) {
      const node = nodes[id]!;
      const mine = pdom.get(id)!;
      let join: string | null = null;
      for (const d of mine) {
        if (d === id || d === EXIT) continue;
        if (pdom.get(d)!.size === mine.size - 1) join = d;
      }
      node.join = join;
      const starts = succ(id);
      const regions = starts.map((s) => (s === join ? new Set<string>() : walk([s], (n) => succ(n).filter((t) => t !== join))));
      const owner = new Map<string, number>();
      let ok = true;
      regions.forEach((region, index) => {
        for (const n of region) {
          if (!ok) return;
          if (n === id) {
            diags.error('E1107', `A branch that starts at \`${id}\` loops back to \`${id}\`. A loop cannot leave a parallel block.`, node, 'Keep loops inside one branch, or move the loop outside the parallel part.');
            ok = false;
          } else if (owner.has(n)) {
            diags.error('E1107', `The parallel branches from \`${id}\` both reach \`${n}\` before they finish.`, nodes[n], `Branches must stay separate until they all meet at one node.`);
            ok = false;
          } else if (entries.includes(n)) {
            diags.error('E1107', `Entry point \`${n}\` is inside a parallel branch of \`${id}\`.`, nodes[n]);
            ok = false;
          } else {
            owner.set(n, index);
          }
        }
      });
      if (!ok) continue;
      for (const [n, index] of owner) {
        const outside = preds.get(n)!.find((p) => p !== id && owner.get(p) !== index);
        if (outside !== undefined) {
          diags.error('E1107', `The arrow from \`${outside}\` jumps into a parallel branch of \`${id}\` at \`${n}\`.`, nodes[n], 'Arrows may enter a parallel block only at its first node.');
          break;
        }
      }
    }
  }
  return entries;
}

/** For a parallel node: the nodes of each branch, in the order the arrows were written. */
export function forkRegions(flow: CompiledFlow, id: string): string[][] {
  const node = flow.nodes[id]!;
  const succ = (n: string) => flow.nodes[n]!.out.map((i) => flow.edges[i]!.to);
  return succ(id).map((s) => (s === node.join ? [] : [...walk([s], (n) => succ(n).filter((t) => t !== node.join))]));
}

function walk(from: string[], next: (id: string) => string[]): Set<string> {
  const seen = new Set<string>(from);
  const stack = [...from];
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const n of next(id)) {
      if (!seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return seen;
}

function postDominators(ids: string[], succ: (id: string) => string[]): Map<string, Set<string>> {
  const all = new Set([...ids, EXIT]);
  const pdom = new Map<string, Set<string>>();
  for (const id of ids) pdom.set(id, succ(id).length === 0 ? new Set([id, EXIT]) : new Set(all));
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of ids) {
      const next = succ(id);
      if (next.length === 0) continue;
      let acc: Set<string> | undefined;
      for (const s of next) {
        const p = pdom.get(s)!;
        acc = acc === undefined ? new Set(p) : new Set([...acc].filter((x) => p.has(x)));
      }
      acc!.add(id);
      const cur = pdom.get(id)!;
      if (acc!.size !== cur.size) {
        pdom.set(id, acc!);
        changed = true;
      }
    }
  }
  return pdom;
}
