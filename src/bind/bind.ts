import { forkRegions, type CompiledFlow, type IRNode } from '../core/compile.ts';
import { Diagnostics, FlowError, sortDiagnostics, suggest, type Diagnostic } from '../core/diagnostics.ts';
import { exprRoots } from '../core/expr.ts';
import { placeholders, stepDefOf, type StepDef, type ToolContext } from './helpers.ts';
import { isStandardSchema, shapeOf, type FieldShape, type Kind, type Shape } from './schema.ts';

export type Predicate = (ctx: Readonly<Record<string, unknown>>) => boolean;

/** A compiled flow joined to the code that runs each step. */
export interface BoundFlow {
  flow: CompiledFlow;
  steps: Map<string, StepDef>;
  predicates: Map<string, Predicate>;
  /** For each entry point: the fields that must (or may) be supplied to run(). */
  inputs: Record<string, Shape>;
  /** For each entry point and input field: the first node that reads it. */
  neededBy: Record<string, Record<string, string>>;
  /** For each node: the fields it reads and writes. */
  io: Record<string, { reads: Shape; writes: Record<string, { kind: Kind; required: boolean }> }>;
  /** For-each blocks with the list and item names resolved. */
  loops: Record<string, { list: string[]; item: string }>;
  warnings: Diagnostic[];
}

export type Tools = Readonly<Record<string, unknown>>;

interface NodeIO {
  reads: Shape;
  writes: Record<string, { kind: Kind; required: boolean }>;
  /** True when the step's output could not be worked out, so it may write any field. */
  open: boolean;
}

/** Stands for "some field we cannot name" in the sets used by the data-flow analysis. */
const ANY = '*';

/** Match every node to an export and check the data that flows between steps. Throws with every problem found. */
export function bind(flow: CompiledFlow, tools: Tools, source?: string): BoundFlow {
  const diags = new Diagnostics(flow.file);
  const table = new Map<string, unknown>();
  for (const key of Object.keys(tools)) table.set(key, (tools as Record<string, unknown>)[key]);
  const stepNames = [...table.keys()].filter((k) => stepDefOf(table.get(k)) !== undefined);

  const steps = new Map<string, StepDef>();
  const predicates = new Map<string, Predicate>();
  const io = new Map<string, NodeIO>();
  const loops: BoundFlow['loops'] = {};
  const nodes = Object.values(flow.nodes);

  // --- resolve steps and conditions ------------------------------------------------------------
  for (const node of nodes) {
    const entry: NodeIO = { reads: Object.create(null) as Shape, writes: Object.create(null) as NodeIO['writes'], open: false };
    io.set(node.id, entry);
    if (node.kind === 'step') {
      const def = resolveStep(node);
      if (!def) continue;
      steps.set(node.id, def);
      describeStep(node, def, entry);
    } else if (node.kind === 'decision' && node.cond) {
      if (node.cond.kind === 'expr') {
        for (const root of exprRoots(node.cond.ast)) entry.reads[root] = { kind: 'unknown', required: true };
      } else {
        const value = table.get(node.cond.name);
        if (typeof value === 'function') {
          predicates.set(node.id, value as Predicate);
        } else if (value !== undefined) {
          diags.error('E1203', `Decision \`${node.id}\` uses \`${node.cond.name}\`, which is exported but is not a function.`, node, 'Export a function `(ctx) => boolean`, or use a field name from an earlier step.');
        } else {
          entry.reads[node.cond.name] = { kind: 'boolean', required: true };
        }
      }
    }
  }

  // --- for-each blocks -------------------------------------------------------------------------
  for (const fe of Object.values(flow.foreach)) {
    let list = fe.list;
    let item = fe.item;
    if (list === undefined) {
      const feeders = flow.edges.filter((e) => e.to === fe.id).map((e) => e.from);
      const arrays = new Set<string>();
      for (const id of feeders) {
        for (const [field, w] of Object.entries(io.get(id)?.writes ?? {})) if (w.kind === 'array') arrays.add(field);
      }
      if (arrays.size === 1) {
        list = [...arrays][0]!;
        item = 'item';
      } else {
        diags.error(
          'E1208',
          `For-each block \`${fe.id}\` does not say which list to go through${arrays.size > 1 ? ` (candidates: ${[...arrays].sort().join(', ')})` : ''}.`,
          fe,
          `Give it a title such as \`subgraph ${fe.id}["for item in items"]\`.`,
        );
        continue;
      }
    }
    loops[fe.id] = { list: list.split('.'), item: item! };
    for (const node of nodes) {
      if (node.scope === fe.id && steps.get(node.id)?.kind === 'human') {
        diags.error('E1209', `\`${node.id}\` waits for a person inside for-each block \`${fe.id}\`. This is not supported yet.`, node, 'Move the approval after the block.');
      }
    }
  }

  // --- data flow -------------------------------------------------------------------------------
  const inputs: Record<string, Shape> = {};
  const neededBy: Record<string, Record<string, string>> = {};
  if (!diags.hasErrors) {
    // A for-each block reads its list plus whatever its body needs from outside.
    for (const fe of Object.values(flow.foreach)) {
      const loop = loops[fe.id]!;
      const entry = io.get(fe.id)!;
      const ids = nodes.filter((n) => n.scope === fe.id).map((n) => n.id);
      const inner = analyse([fe.entry], ids, new Set([loop.item]), fe.id).needed;
      entry.reads[loop.list[0]!] = { kind: loop.list.length === 1 ? 'array' : 'unknown', required: true };
      for (const [field, shape] of Object.entries(inner)) {
        if (!(field in entry.reads)) entry.reads[field] = shape;
      }
      entry.writes[fe.id] = { kind: 'array', required: true };
    }
    const top = nodes.filter((n) => n.scope === '').map((n) => n.id);
    const known = new Set([...top.flatMap((id) => Object.keys(io.get(id)!.writes)), ...[...table.keys()].filter((k) => typeof table.get(k) === 'function')]);
    for (const start of flow.entries) {
      const result = analyse([start], top, new Set(), '');
      inputs[start] = result.needed;
      neededBy[start] = result.by;
      for (const [field, shape] of Object.entries(result.needed)) {
        // Very short names are too easy to mistake for one another, so only longer ones get a hint.
        const near = shape.required && field.length >= 4 ? suggest(field, known) : undefined;
        if (near !== undefined && near !== field) {
          const reader = result.by[field]!;
          diags.warn('W1252', `\`${reader}\` reads \`${field}\`, which no step produces. Did you mean \`${near}\`?`, flow.nodes[reader], `If \`${field}\` is right, pass it to run().`);
        }
      }
    }
    checkKinds(top);
    for (const fe of Object.values(flow.foreach)) {
      const produced = new Set(top.flatMap((id) => Object.keys(io.get(id)!.writes)));
      const item = loops[fe.id]!.item;
      if (produced.has(item)) {
        diags.error('E1208', `The item name \`${item}\` in for-each block \`${fe.id}\` is also a field produced by a step.`, fe, 'Choose a different item name.');
      }
    }
    checkParallelWrites();
  }

  const sorted = sortDiagnostics(dedupe(diags.list));
  const errors = sorted.filter((d) => d.severity === 'error');
  if (errors.length > 0) throw new FlowError(errors, source);
  const fields: BoundFlow['io'] = {};
  for (const [id, entry] of io) fields[id] = { reads: entry.reads, writes: entry.writes };
  return { flow, steps, predicates, inputs, neededBy, io: fields, loops, warnings: sorted };

  // ---------------------------------------------------------------------------------------------

  function resolveStep(node: IRNode): StepDef | undefined {
    const name = node.ref!;
    const value = table.get(name);
    if (value === undefined) {
      const near = suggest(name, stepNames);
      const marker = node.hints.includes('start') || node.hints.includes('stop');
      diags.error(
        'E1201',
        `The box \`${node.id}\` needs a tool named \`${name}\`, and there is none in the tools you passed.${near ? ` Did you mean \`${near}\`?` : ''}`,
        node,
        marker
          ? `If \`${node.id}\` is only a start or end marker, write it as \`${node.id}([${node.label ?? node.id}])\`. Otherwise export \`${name}\` from your tools file.`
          : `Export \`${name}\` from your tools file${stepNames.length ? ` (found: ${stepNames.slice().sort().join(', ')})` : ''}.`,
      );
      return undefined;
    }
    let def = stepDefOf(value);
    if (!def) def = fromForeignTool(value);
    if (!def) {
      diags.error(
        'E1202',
        typeof value === 'function'
          ? `\`${name}\` is a plain function. Steps must be made with tool(), agent() or human().`
          : `\`${name}\` is exported but was not made with tool(), agent() or human().`,
        node,
        typeof value === 'function' ? `Write \`export const ${name} = tool({ input, output, run: ${name}Impl })\`.` : undefined,
      );
      return undefined;
    }
    for (const hint of ['agent', 'human', 'tool'] as const) {
      if (node.hints.includes(hint) && def.kind !== hint) {
        diags.error('E1202', `\`${node.id}\` is marked \`:::${hint}\` in the diagram, but \`${name}\` is ${def.kind === 'agent' ? 'an agent' : `a ${def.kind}`}.`, node, `Remove \`:::${hint}\` or change the export.`);
      }
    }
    return def;
  }

  function describeStep(node: IRNode, def: StepDef, entry: NodeIO): void {
    const name = node.ref!;
    const unknownShape = (which: string) =>
      void diags.warn('W1251', `The ${which} of \`${name}\` cannot be checked: it is not an object schema, or it uses a type with no JSON form (such as a date).`, node);
    if (def.kind === 'tool') {
      if (def.spec.input !== undefined) {
        const shape = shapeOf(def.spec.input, 'input');
        if (shape) Object.assign(entry.reads, shape);
        else unknownShape('input');
      }
      if (def.spec.output !== undefined) addWrites(def.spec.output, 'output');
    } else if (def.kind === 'agent') {
      if (typeof def.spec.prompt !== 'string' || def.spec.prompt === '') {
        diags.error('E1206', `Agent \`${name}\` has no prompt.`, node);
      }
      for (const path of placeholders(def.spec.prompt ?? '')) entry.reads[path[0]!] = { kind: 'unknown', required: true };
      if (placeholders(def.spec.instructions ?? '').length > 0) {
        diags.error('E1206', `The instructions of agent \`${name}\` contain a \`{field}\` placeholder.`, node, 'Put placeholders in `prompt`; keep `instructions` fixed.');
      }
      if (def.spec.tools !== undefined && !(Number.isInteger(def.spec.maxSteps) && def.spec.maxSteps! >= 1)) {
        diags.error('E1206', `Agent \`${name}\` is given tools, so it needs \`maxSteps\`: the most turns the model may take.`, node, 'Add `maxSteps: 5` (or another limit) to the agent.');
      }
      if (!isStandardSchema(def.spec.output)) {
        diags.error('E1206', `Agent \`${name}\` needs an \`output\` schema.`, node);
      } else addWrites(def.spec.output, 'output');
    } else {
      if (def.spec.resume !== undefined) addWrites(def.spec.resume, 'resume schema');
      if (node.route === 'choice') entry.writes.decision = { kind: 'string', required: true };
    }
    if (node.route === 'choice' && def.kind !== 'human' && !entry.open && !('decision' in entry.writes)) {
      const labels = node.out.map((i) => flow.edges[i]!.branch).join(', ');
      diags.error('E1207', `The arrows leaving \`${node.id}\` are labelled (${labels}), so \`${name}\` must output a \`decision\` field naming one of them.`, node, `Add \`decision: z.enum([...])\` to the output of \`${name}\`.`);
    }

    function addWrites(schema: unknown, which: string): void {
      const shape = shapeOf(schema, 'output');
      if (!shape) {
        entry.open = true;
        return unknownShape(which);
      }
      for (const [field, s] of Object.entries(shape)) entry.writes[field] = { kind: s.kind, required: s.required };
    }
  }

  /** Accept a Vercel AI SDK tool (an object with inputSchema and execute) as a step. */
  function fromForeignTool(value: unknown): StepDef | undefined {
    if (typeof value !== 'object' || value === null) return undefined;
    const t = value as { inputSchema?: unknown; outputSchema?: unknown; execute?: unknown };
    if (!isStandardSchema(t.inputSchema) || typeof t.execute !== 'function') return undefined;
    const execute = t.execute as (input: unknown, options: unknown) => unknown;
    const spec: { input: unknown; output?: unknown; run: (input: unknown, ctx: ToolContext) => unknown } = {
      input: t.inputSchema,
      run: (input, ctx) => execute(input, { toolCallId: ctx.key, messages: [], abortSignal: ctx.signal }),
    };
    if (isStandardSchema(t.outputSchema)) spec.output = t.outputSchema;
    return { kind: 'tool', spec: spec as never };
  }

  /**
   * Forward analysis from the given starts. Returns the fields the scope needs from outside
   * (and which node reads each first), and warns about fields that only some paths produce.
   */
  function analyse(starts: string[], ids: string[], given: Set<string>, scope: string): { needed: Shape; by: Record<string, string> } {
    const inScope = new Set(ids);
    const succ = (id: string) => flow.nodes[id]!.out.map((i) => flow.edges[i]!.to).filter((t) => inScope.has(t));
    const reach = new Set<string>(starts);
    const stack = [...starts];
    while (stack.length > 0) for (const n of succ(stack.pop()!)) if (!reach.has(n)) (reach.add(n), stack.push(n));

    const preds = new Map<string, string[]>([...reach].map((id) => [id, []]));
    for (const id of reach) for (const t of succ(id)) preds.get(t)!.push(id);

    // Where parallel branches meet, the join has everything from every branch, not only what they share.
    const branchOf = new Map<string, Map<string, string>>();
    const forks = [...reach].filter((id) => flow.nodes[id]!.route === 'fork' && typeof flow.nodes[id]!.join === 'string');
    const regions = new Map(forks.map((f) => [f, forkRegions(flow, f)]));
    for (const f of forks) {
      const join = flow.nodes[f]!.join as string;
      const nested = forks.some((g) => g !== f && flow.nodes[g]!.join === join && regions.get(g)!.some((r) => r.includes(f)));
      if (nested || !reach.has(join)) continue;
      const groups = branchOf.get(join) ?? new Map<string, string>();
      regions.get(f)!.forEach((region, index) => {
        for (const p of preds.get(join)!) if (region.includes(p)) groups.set(p, `${f}\u0000${index}`);
        if (region.length === 0) groups.set(f, `${f}\u0000${index}`);
      });
      branchOf.set(join, groups);
    }

    const intersect = (a: Set<string> | undefined, b: Set<string>) => (a === undefined ? new Set(b) : new Set([...a].filter((f) => b.has(f))));
    const out = new Map<string, Set<string>>();
    const incoming = (id: string): Set<string> | undefined => {
      if (starts.includes(id)) return new Set(given);
      const groups = branchOf.get(id);
      const perBranch = new Map<string, Set<string>>();
      let acc: Set<string> | undefined;
      for (const p of preds.get(id)!) {
        const o = out.get(p);
        if (!o) continue;
        const g = groups?.get(p);
        if (g === undefined) acc = intersect(acc, o);
        else perBranch.set(g, intersect(perBranch.get(g), o));
      }
      const perFork = new Map<string, Set<string>>();
      for (const [g, set] of perBranch) {
        const f = g.split('\u0000')[0]!;
        perFork.set(f, new Set([...(perFork.get(f) ?? []), ...set]));
      }
      for (const set of perFork.values()) acc = intersect(acc, set);
      return acc;
    };
    const same = (a: Set<string> | undefined, b: Set<string>) => a !== undefined && a.size === b.size && [...b].every((f) => a.has(f));
    for (let pass = 0, changed = true; changed && pass < 1000; pass++) {
      changed = false;
      for (const id of reach) {
        const base = incoming(id);
        if (!base) continue;
        const node = io.get(id)!;
        for (const [f, w] of Object.entries(node.writes)) if (w.required) base.add(f);
        if (node.open) base.add(ANY);
        if (!same(out.get(id), base)) {
          out.set(id, base);
          changed = true;
        }
      }
    }

    // What might be present when a node is reached, on at least one path (including round a loop).
    const mayOut = new Map<string, Set<string>>();
    const mayIn = (id: string): Set<string> => {
      const acc = new Set<string>(starts.includes(id) ? given : []);
      for (const p of preds.get(id)!) for (const f of mayOut.get(p) ?? []) acc.add(f);
      return acc;
    };
    for (let changed = true; changed; ) {
      changed = false;
      for (const id of reach) {
        const base = mayIn(id);
        const node = io.get(id)!;
        for (const f of Object.keys(node.writes)) base.add(f);
        if (node.open) base.add(ANY);
        if (base.size !== (mayOut.get(id)?.size ?? -1)) {
          mayOut.set(id, base);
          changed = true;
        }
      }
    }

    const needed: Shape = Object.create(null) as Shape;
    const by: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const id of reach) {
      const have = incoming(id) ?? new Set<string>();
      const may = mayIn(id);
      for (const [field, shape] of Object.entries(io.get(id)!.reads)) {
        if (have.has(field) || have.has(ANY)) continue;
        if (may.has(field) || may.has(ANY)) {
          if (shape.required && may.has(field)) {
            diags.warn(
              'W1250',
              scope === '' && flow.entries.length > 1
                ? `When the run starts at \`${starts[0]}\`, \`${id}\` needs \`${field}\`, but only some paths to it produce that field.`
                : `\`${id}\` needs \`${field}\`, but only some paths to it produce that field.`,
              flow.nodes[id],
              scope === '' ? `Make sure it is produced on every path, or pass it in when starting the run.` : undefined,
            );
          }
          continue;
        }
        const prev = needed[field];
        needed[field] = {
          kind: prev && prev.kind !== 'unknown' ? prev.kind : shape.kind,
          required: (prev?.required ?? false) || shape.required,
        };
        by[field] ??= id;
      }
    }
    return { needed, by };
  }

  function checkKinds(ids: string[]): void {
    const producers = new Map<string, Array<{ id: string; kind: Kind }>>();
    for (const id of ids) {
      for (const [field, w] of Object.entries(io.get(id)!.writes)) {
        if (!producers.has(field)) producers.set(field, []);
        producers.get(field)!.push({ id, kind: w.kind });
      }
    }
    for (const [field, list] of producers) {
      const known = list.filter((p) => p.kind !== 'unknown');
      const first = known[0];
      const other = known.find((p) => p.kind !== first!.kind);
      if (first && other) {
        diags.error('E1204', `Steps \`${first.id}\` and \`${other.id}\` both output \`${field}\`, but with different types (${first.kind} and ${other.kind}).`, flow.nodes[other.id], 'Rename one of the fields.');
      }
    }
    for (const id of ids) {
      for (const [field, shape] of Object.entries(io.get(id)!.reads)) {
        if (shape.kind === 'unknown') continue;
        const bad = producers.get(field)?.find((p) => p.kind !== 'unknown' && p.kind !== shape.kind && p.id !== id);
        if (bad) {
          diags.error('E1205', `\`${id}\` expects \`${field}\` to be ${article(shape.kind)}, but \`${bad.id}\` outputs it as ${article(bad.kind)}.`, flow.nodes[id]);
        }
      }
    }
  }

  function checkParallelWrites(): void {
    for (const node of nodes) {
      if (node.route !== 'fork') continue;
      const regions = forkRegions(flow, node.id);
      const owner = new Map<string, string>();
      for (const region of regions) {
        const mine = new Map<string, string>();
        for (const id of region) for (const field of Object.keys(io.get(id)!.writes)) if (!mine.has(field)) mine.set(field, id);
        for (const [field, id] of mine) {
          const other = owner.get(field);
          if (other !== undefined) {
            diags.error('E1210', `Parallel steps \`${other}\` and \`${id}\` both output \`${field}\`. The result would depend on which finishes last.`, flow.nodes[id], 'Rename one of the fields.');
          } else owner.set(field, id);
        }
      }
    }
  }
}

function article(kind: Kind): string {
  return kind === 'array' || kind === 'object' ? `an ${kind}` : `a ${kind}`;
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
