import fc from 'fast-check';
import { describe, expect, it } from 'bun:test';
import { evalExpr, ExprError, exprRoots, parseExpr } from '../src/core/expr.ts';

const ev = (text: string, ctx: unknown = {}) => evalExpr(parseExpr(text), ctx);

describe('conditions', () => {
  it('compares numbers and text', () => {
    expect(ev('score >= 8', { score: 9 })).toBe(true);
    expect(ev('score >= 8', { score: 7 })).toBe(false);
    expect(ev("status == 'ok'", { status: 'ok' })).toBe(true);
    expect(ev("status != 'ok'", { status: 'ok' })).toBe(false);
    expect(ev('a < b', { a: 'apple', b: 'pear' })).toBe(true);
  });

  it('combines with and, or, not and brackets', () => {
    const ctx = { a: 1, b: 2, flag: false };
    expect(ev('a == 1 and b == 2', ctx)).toBe(true);
    expect(ev('a == 2 or b == 2', ctx)).toBe(true);
    expect(ev('not flag', ctx)).toBe(true);
    expect(ev('!(a == 1 && b == 3) || flag', ctx)).toBe(true);
    expect(ev('a == 1 or a == 2 and b == 9', ctx)).toBe(true);
  });

  it('reads nested fields and lengths', () => {
    expect(ev('user.age > 17', { user: { age: 18 } })).toBe(true);
    expect(ev('tasks.length > 0', { tasks: [] })).toBe(false);
    expect(ev('name.length == 3', { name: 'abc' })).toBe(true);
  });

  it('treats missing or mismatched values as false, never as an error', () => {
    expect(ev('missing > 1', {})).toBe(false);
    expect(ev('a.b.c == 1', { a: null })).toBe(false);
    expect(ev("n > 'x'", { n: 5 })).toBe(false);
  });

  it('cannot reach inherited properties', () => {
    expect(ev('toString == null', {})).toBe(false);
    expect(evalExpr({ t: 'path', p: ['__proto__', 'x'] }, {})).toBeUndefined();
    expect(evalExpr({ t: 'path', p: ['a', 'constructor'] }, { a: {} })).toBeUndefined();
    expect(() => parseExpr('a.__proto__ == 1')).toThrow(ExprError);
    expect(() => parseExpr('constructor.name == 1')).toThrow(ExprError);
  });

  it('rejects anything that is not a comparison', () => {
    for (const bad of ['', 'a ==', 'f(x)', 'a = 1', 'a[0] == 1', '"x" == a', 'a + 1 > 2', 'a == 1 b', '(a == 1', 'a; b', '`x`', 'a ? b : c']) {
      expect(() => parseExpr(bad), bad).toThrow(ExprError);
    }
  });

  it('lists the fields a condition reads', () => {
    expect([...exprRoots(parseExpr("a.b > 1 and (c == 'x' or not d)"))].sort()).toEqual(['a', 'c', 'd']);
  });

  it('limits length and nesting', () => {
    expect(() => parseExpr('a == 1 and '.repeat(60) + 'a == 1')).toThrow(/too long/);
    expect(() => parseExpr('('.repeat(60) + 'a' + ')'.repeat(60))).toThrow(/too deeply/);
  });

  it('property: parsing arbitrary text either works or throws ExprError, and evaluating never throws', () => {
    const piece = fc.constantFrom('a', 'b.c', '1', "'s'", '==', '!=', '>', '<=', 'and', 'or', 'not', '(', ')', '!', '&&', '||', 'true', 'null', ' ', '.', '=', '"', '__proto__');
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.array(piece, { maxLength: 20 }).map((p) => p.join(' '))), fc.jsonValue(), (text, ctx) => {
        let ast;
        try {
          ast = parseExpr(text);
        } catch (err) {
          expect(err).toBeInstanceOf(ExprError);
          return;
        }
        expect(() => evalExpr(ast, ctx)).not.toThrow();
      }),
      { numRuns: 2000 },
    );
  });
});
