import fc from 'fast-check';
import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { bind, check, memoryStore, run, tool, type CompiledFlow } from 'typemaid';

/** Random small diagrams built from the syntax this package accepts (and some it does not). */
const diagram = fc
  .record({
    size: fc.integer({ min: 1, max: 7 }),
    diamonds: fc.array(fc.boolean(), { minLength: 7, maxLength: 7 }),
    edges: fc.array(
      fc.record({ from: fc.integer({ min: 0, max: 6 }), to: fc.integer({ min: 0, max: 6 }), label: fc.constantFrom('', '', '', 'yes', 'no', 'max 2', 'yes, max 2', 'no, max 3', 'left', 'right') }),
      { maxLength: 12 },
    ),
  })
  .map(({ size, diamonds, edges }) => {
    const name = (i: number) => (diamonds[i % size] ? `d${i % size}{c${i % size}}` : `n${i % size}`);
    const lines = ['flowchart TD'];
    for (let i = 0; i < size; i++) lines.push(`  ${name(i)}`);
    for (const e of edges) lines.push(`  ${name(e.from).replace(/\{.*/, '')} -->${e.label ? `|${e.label}|` : ''} ${name(e.to).replace(/\{.*/, '')}`);
    return lines.join('\n');
  });

/** Diagrams built around a chain, with decisions, loops, parallel splits and choices added. Most of these compile. */
const structured = fc
  .record({
    kinds: fc.array(fc.constantFrom('plain', 'plain', 'decision', 'fork', 'choice'), { minLength: 2, maxLength: 8 }),
    targets: fc.array(fc.nat(), { minLength: 8, maxLength: 8 }),
    extra: fc.array(fc.record({ from: fc.nat(), to: fc.nat() }), { maxLength: 1 }),
    chaos: fc.boolean(),
  })
  .map(({ kinds, targets, extra, chaos }) => {
    const k = kinds.length;
    const decl = (i: number) => (kinds[i] === 'decision' && i < k - 1 ? `d${i}{c${i}}` : `n${i}`);
    const id = (i: number) => decl(i).replace(/\{.*/, '');
    const lines = ['flowchart TD', `  ${decl(0)}:::start`];
    for (let i = 0; i < k - 1; i++) {
      const j = targets[i]! % k;
      const cap = j <= i ? ', max 2' : '';
      if (kinds[i] === 'decision') {
        lines.push(`  ${decl(i)} -->|yes| ${decl(i + 1)}`, `  ${id(i)} -->|no${cap}| ${decl(j)}`);
      } else if (kinds[i] === 'fork' && j > i + 1) {
        lines.push(`  ${id(i)} --> ${decl(i + 1)}`, `  ${id(i)} --> ${decl(j)}`);
      } else if (kinds[i] === 'choice' && j !== i + 1) {
        lines.push(`  ${id(i)} -->|left| ${decl(i + 1)}`, `  ${id(i)} -->|right${cap}| ${decl(j)}`);
      } else {
        lines.push(`  ${id(i)} --> ${decl(i + 1)}`);
      }
    }
    if (chaos) for (const e of extra) lines.push(`  ${id(e.from % k)} --> ${id(e.to % k)}`);
    return lines.join('\n');
  });

function toolsFor(flow: CompiledFlow, seed: number): Record<string, unknown> {
  const tools: Record<string, unknown> = {};
  let state = seed;
  const coin = () => ((state = (state * 1103515245 + 12345) & 0x7fffffff) >> 8) % 2 === 0;
  for (const node of Object.values(flow.nodes)) {
    if (node.kind === 'step') {
      const labels = node.route === 'choice' ? node.out.map((i) => flow.edges[i]!.branch!) : undefined;
      tools[node.ref!] = labels
        ? tool({ output: z.object({ decision: z.string() }), run: () => ({ decision: labels[coin() ? 0 : labels.length - 1]! }) })
        : tool({ run: () => undefined });
    } else if (node.kind === 'decision' && node.cond?.kind === 'name') {
      tools[node.cond.name] = () => coin();
    }
  }
  return tools;
}

describe('properties', () => {
  it('checking any generated diagram never throws, and gives the same answer twice', () => {
    fc.assert(
      fc.property(fc.oneof(diagram, structured), (source) => {
        const a = check(source);
        const b = check(source);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
        if (!a.flow) expect(a.diagnostics.some((d) => d.severity === 'error')).toBe(true);
      }),
      { numRuns: 1500 },
    );
  });

  it('every diagram that compiles runs to an end: it completes or hits a loop limit, never hangs or deadlocks', async () => {
    let compiled = 0;
    await fc.assert(
      fc.asyncProperty(structured, fc.integer({ min: 1, max: 1000 }), async (source, seed) => {
        const { flow } = check(source);
        if (!flow) return;
        let bound;
        try {
          bound = bind(flow, toolsFor(flow, seed));
        } catch {
          return; // e.g. labelled arrows from a step with no `decision` output schema
        }
        compiled++;
        const outcomes = [];
        for (let i = 0; i < 2; i++) {
          const store = memoryStore();
          const result = await run(flow, toolsFor(flow, seed), {}, { store, limits: { maxSteps: 2000 } });
          expect(result.status, source).not.toBe('paused');
          if (result.status === 'failed') expect(result.error.code, `${source}\n${result.error.message}`).toBe('E1313');
          const record = await store.load('default', result.runId);
          if (result.status === 'completed') {
            // Nothing is left behind: every parallel block joined and every position reached an end.
            expect(record!.state.forks, source).toEqual({});
            expect(record!.state.tokens).toEqual([]);
          }
          outcomes.push(JSON.stringify([result.status, record!.state.visits]));
        }
        // Same diagram, same decisions: the same nodes run the same number of times.
        expect(outcomes[0]).toBe(outcomes[1]);
        void bound;
      }),
      { numRuns: 2500 },
    );
    console.log(`property test ran ${compiled} compiled diagrams`);
    expect(compiled).toBeGreaterThan(500);
  });
});
