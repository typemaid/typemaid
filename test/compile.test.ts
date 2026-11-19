import { describe, expect, it } from 'bun:test';
import { check, compile, FlowError, formatDiagnostics } from 'typemaid';
import { accept, matchesGolden, reject } from './files.ts';

describe('accepted diagrams', () => {
  it.each(accept)('$name compiles to the same JSON every time', async ({ name, file, source }) => {
    const first = check(source, { file });
    expect(formatDiagnostics(first.diagnostics, first.source)).toBe('');
    expect(first.flow).toBeDefined();
    const json = JSON.stringify(first.flow, null, 2) + '\n';
    expect(JSON.stringify(compile(source, { file }), null, 2) + '\n').toBe(json);
    const stored = matchesGolden(`accept/${name}.json`, json);
    expect(stored.actual).toBe(stored.expected);
  });

  it.each(accept)('$name: Windows line endings and a BOM do not change the result', ({ file, source }) => {
    const unix = compile(source, { file });
    const windows = compile('﻿' + source.replace(/\n/g, '\r\n'), { file });
    expect(windows).toEqual(unix);
  });

  it('the result is plain JSON', () => {
    for (const { source } of accept) {
      const flow = compile(source);
      expect(JSON.parse(JSON.stringify(flow))).toEqual(flow);
    }
  });
});

describe('rejected diagrams', () => {
  it.each(reject)('$name reports its problem with a position', async ({ name, file, source }) => {
    const result = check(source, { file });
    expect(result.flow).toBeUndefined();
    const code = name.split('-')[0]!;
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    expect(errors.map((d) => d.code)).toContain(code);
    for (const d of errors) expect(d.line).toBeGreaterThan(0);
    const stored = matchesGolden(`reject/${name}.txt`, formatDiagnostics(result.diagnostics, result.source) + '\n');
    expect(stored.actual).toBe(stored.expected);
    expect(() => compile(source, { file })).toThrow(FlowError);
  });

  it('reports every problem in one pass', () => {
    const result = check('flowchart TD\n  a --- b\n  c-->d\n  e --> call');
    expect(result.diagnostics.map((d) => d.code)).toEqual(['E1005', 'E1004', 'E1004', 'E1003']);
  });

  it('never throws on arbitrary text', () => {
    for (const text of ['', '\n\n', '---', 'flowchart', 'flowchart TD\n' + 'a --> '.repeat(500), '}{][)(', 'flowchart TD\n a[' + 'x'.repeat(3000)]) {
      expect(() => check(text)).not.toThrow();
      expect(check(text).flow).toBeUndefined();
    }
  });
});

describe('structure', () => {
  it('finds where parallel branches meet', () => {
    const flow = compile('flowchart TD\n  a --> b\n  a --> c\n  b --> d\n  c --> d\n  d --> e');
    expect(flow.nodes.a).toMatchObject({ route: 'fork', join: 'd' });
  });

  it('parallel branches that never meet run to the end', () => {
    const flow = compile('flowchart TD\n  a --> b\n  a --> c');
    expect(flow.nodes.a).toMatchObject({ route: 'fork', join: null });
  });

  it('an outer loop restarts the counters of loops inside it', () => {
    const { source } = accept.find((f) => f.name === 'nested-loops')!;
    const flow = compile(source);
    const capped = flow.edges.map((e, i) => ({ i, ...e })).filter((e) => e.max !== undefined);
    const [fix, next, replan] = capped;
    expect([fix!.from, next!.from, replan!.from]).toEqual(['fixed', 'more', 'approve']);
    expect(fix!.resets).toBeUndefined();
    expect(next!.resets).toEqual([fix!.i]);
    expect(replan!.resets).toEqual([fix!.i, next!.i]);
  });

  it('a first node that is also a loop target is still the start', () => {
    const flow = compile('flowchart TD\n  a --> d{ok}\n  d -->|no, max 2| a\n  d -->|yes| b');
    expect(flow.entries).toEqual(['a']);
  });

  it('several :::start nodes become named entries, in order', () => {
    const flow = compile('flowchart TD\n  a:::start --> c\n  b([Hook]):::start --> c');
    expect(flow.entries).toEqual(['a', 'b']);
  });

  it('`$name` in a label binds a different export; other labels are display text', () => {
    const flow = compile('flowchart TD\n  first[$double] --> second["Any text here"]');
    expect(flow.nodes.first!.ref).toBe('double');
    expect(flow.nodes.second!.ref).toBe('second');
  });

  it('respects limits set by the host', () => {
    expect(check('flowchart TD\n  a --> b --> c', { limits: { maxNodes: 2 } }).flow).toBeUndefined();
    expect(check('flowchart TD\n  a --> d{x}\n  d -->|no, max 50| a\n  d -->|yes| b', { limits: { maxLoopCap: 10 } }).flow).toBeUndefined();
  });
});
