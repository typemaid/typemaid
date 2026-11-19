import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { agent, bind, checkFlow, compile, FlowError, human, tool } from 'typemaid';
import { accept } from './files.ts';
import * as tools from './tools.ts';

function problems(source: string, t: Record<string, unknown>): string[] {
  try {
    bind(compile(source), t);
    return [];
  } catch (err) {
    if (!(err instanceof FlowError)) throw err;
    return err.diagnostics.map((d) => `${d.code}@${d.line} ${d.message}`);
  }
}

describe('binding diagrams to tools', () => {
  it.each(accept.filter((f) => !f.name.startsWith('example-')))('$name binds to the test tools', ({ source }) => {
    expect(problems(source, tools)).toEqual([]);
  });

  it('a missing tool is reported with its line and a suggestion', () => {
    const out = problems('flowchart TD\n  add --> duble', tools);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/^E1201@2 The box `duble` needs a tool named `duble`.*Did you mean `double`\?/);
  });

  it('reports every missing tool at once', () => {
    expect(problems('flowchart TD\n  one --> two --> three', {}).map((p) => p.slice(0, 7))).toEqual(['E1201@2', 'E1201@2', 'E1201@2']);
  });

  it('explains how to write a marker when a :::start node has no tool', () => {
    try {
      bind(compile('flowchart TD\n  hook[Webhook]:::start --> add'), tools);
      expect.unreachable();
    } catch (err) {
      expect((err as FlowError).diagnostics[0]!.hint).toContain('hook([Webhook])');
    }
  });

  it('rejects exports that are not steps', () => {
    expect(problems('flowchart TD\n  fn --> thing', { fn: () => 1, thing: { a: 1 } })).toEqual([
      'E1202@2 `fn` is a plain function. Steps must be made with tool(), agent() or human().',
      'E1202@2 `thing` is exported but was not made with tool(), agent() or human().',
    ]);
  });

  it('checks :::agent and :::human against the real export', () => {
    expect(problems('flowchart TD\n  add:::agent --> double:::human', tools).map((p) => p.slice(0, 5))).toEqual(['E1202', 'E1202']);
  });

  it('inherited names such as constructor never bind', () => {
    expect(problems('flowchart TD\n  constructor --> toString', {})).toHaveLength(2);
  });

  it('a tool made by another copy of the package still binds', () => {
    const foreign = Object.defineProperty({ kind: 'tool', spec: { run: () => ({}) } }, Symbol.for('typemaid.node'), { value: 'tool' });
    expect(problems('flowchart TD\n  foreign', { foreign })).toEqual([]);
  });

  it('accepts an AI SDK style tool (inputSchema + execute)', () => {
    const sdkTool = { inputSchema: z.object({ q: z.string() }), outputSchema: z.object({ hits: z.number() }), execute: async () => ({ hits: 1 }) };
    const bound = bind(compile('flowchart TD\n  search'), { search: sdkTool });
    expect(bound.inputs.search).toEqual({ q: { kind: 'string', required: true } });
  });

  it('works out which inputs run() needs', () => {
    const bound = bind(compile('flowchart TD\n  add --> double'), tools);
    expect(bound.inputs.add).toEqual({ a: { kind: 'number', required: true }, b: { kind: 'number', required: true } });
  });

  it('two steps writing one field with different types is an error', () => {
    const t = {
      one: tool({ output: z.object({ value: z.string() }), run: () => ({ value: 'x' }) }),
      two: tool({ output: z.object({ value: z.number() }), run: () => ({ value: 1 }) }),
    };
    expect(problems('flowchart TD\n  one --> two', t)[0]).toMatch(/^E1204@2 Steps `one` and `two` both output `value`/);
  });

  it('a step reading a field as the wrong type is an error', () => {
    const t = {
      one: tool({ output: z.object({ value: z.string() }), run: () => ({ value: 'x' }) }),
      two: tool({ input: z.object({ value: z.number() }), run: () => undefined }),
    };
    expect(problems('flowchart TD\n  one --> two', t)[0]).toMatch(/^E1205@2 `two` expects `value` to be a number, but `one` outputs it as a string/);
  });

  it('a decision on a field that is not true/false is an error', () => {
    expect(problems('flowchart TD\n  add --> ok{sum}\n  ok -->|yes| double\n  ok -->|no| negate', tools)[0]).toMatch(/^E1205@2 `ok` expects `sum` to be a boolean/);
  });

  it('parallel steps writing the same field is an error', () => {
    expect(problems('flowchart TD\n  add --> double\n  add --> negate\n  double --> merge\n  negate --> merge', { ...tools, merge: tool({ run: () => undefined }) })[0]).toMatch(/^E1210@\d Parallel steps `double` and `negate` both output `sum`/);
  });

  it('labelled arrows need a `decision` output', () => {
    expect(problems('flowchart TD\n  add -->|small| double\n  add -->|large| negate', tools)[0]).toMatch(/^E1207@2 .*must output a `decision` field/);
  });

  it('agent placeholders are read from the context; instructions must be fixed text', () => {
    const t = {
      a: agent({ prompt: 'Hi {name}, {profile.age}', output: z.object({ reply: z.string() }) }),
      b: agent({ prompt: 'x', instructions: 'Be {tone}', output: z.object({ other: z.string() }) }),
    };
    expect(problems('flowchart TD\n  a --> b', t)[0]).toMatch(/^E1206@2 The instructions of agent `b` contain/);
    const bound = bind(compile('flowchart TD\n  a'), t);
    expect(Object.keys(bound.inputs.a!).sort()).toEqual(['name', 'profile']);
  });

  it('for-each: the list is inferred when the step before outputs exactly one list', () => {
    const { source } = accept.find((f) => f.name === 'foreach-inferred')!;
    expect(bind(compile(source), tools).loops.each).toEqual({ list: ['numbers'], item: 'item' });
  });

  it('for-each: asks for an explicit title when it cannot tell', () => {
    const src = 'flowchart TD\n  add --> each\n  subgraph each [Things]\n    square\n  end\n  class each foreach';
    expect(problems(src, tools)[0]).toMatch(/^E1208@3 For-each block `each` does not say which list/);
  });

  it('for-each: a human step inside is refused for now', () => {
    const src = 'flowchart TD\n  listNumbers --> each\n  subgraph each["for n in numbers"]\n    approve\n  end\n  class each foreach';
    expect(problems(src, tools)[0]).toMatch(/^E1209@4/);
  });

  it('warns when a field is produced on only some paths', () => {
    const src = 'flowchart TD\n  add --> big{"sum > 3"}\n  big -->|yes| left\n  big -->|no| right\n  left --> merge\n  right --> merge';
    const result = checkFlow(src, tools);
    expect(result.diagnostics.map((d) => `${d.severity} ${d.code}`)).toEqual(['warning W1250', 'warning W1250']);
    expect(result.diagnostics[0]!.message).toContain('`merge` needs `l`');
  });

  it('warns when a schema cannot be checked', () => {
    const t = { when: tool({ output: z.object({ at: z.date() }), run: () => ({ at: new Date() }) }) };
    expect(checkFlow('flowchart TD\n  when', t).diagnostics.map((d) => d.code)).toEqual(['W1251']);
  });

  it('checkFlow returns problems instead of throwing', () => {
    const result = checkFlow('flowchart TD\n  add --> nope', tools, { file: 'x.mmd' });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ code: 'E1201', file: 'x.mmd', line: 2, column: 11 });
  });

  it('helpers are frozen and typed from their schemas', () => {
    expect(Object.isFrozen(tools.add)).toBe(true);
    expect(() => human()).not.toThrow();
  });
});
