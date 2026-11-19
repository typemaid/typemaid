/**
 * The small condition language used inside decision nodes, e.g. "score >= 8 and status == 'ok'".
 * It is parsed once into a plain tree and interpreted. It can only read values:
 * no calls, no assignment, no computed access, no time, no randomness.
 */
export type Expr =
  | { t: 'lit'; v: string | number | boolean | null }
  | { t: 'path'; p: string[] }
  | { t: 'not'; e: Expr }
  | { t: 'bin'; op: BinOp; l: Expr; r: Expr };

export type BinOp = 'and' | 'or' | '==' | '!=' | '>' | '>=' | '<' | '<=';

export class ExprError extends Error {
  readonly offset: number;
  constructor(message: string, offset: number) {
    super(message);
    this.name = 'ExprError';
    this.offset = offset;
  }
}

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_LENGTH = 500;
const MAX_DEPTH = 40;

type Tok =
  | { k: 'num'; v: number; at: number }
  | { k: 'str'; v: string; at: number }
  | { k: 'id'; v: string; at: number }
  | { k: 'op'; v: string; at: number }
  | { k: 'end'; at: number };

function tokenize(text: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const rest = text.slice(i);
    let m: RegExpExecArray | null;
    const last = toks[toks.length - 1];
    const afterValue = last !== undefined && (last.k === 'num' || last.k === 'str' || (last.k === 'id' && !['and', 'or', 'not'].includes(last.v)) || (last.k === 'op' && last.v === ')'));
    if ((m = /^\d+(\.\d+)?(?![A-Za-z_.\d])/.exec(rest)) || (!afterValue && (m = /^-\d+(\.\d+)?(?![A-Za-z_.\d])/.exec(rest)))) {
      toks.push({ k: 'num', v: Number(m[0]), at: i });
    } else if (ch === "'") {
      const close = text.indexOf("'", i + 1);
      if (close < 0) throw new ExprError('Text in single quotes is never closed.', i);
      toks.push({ k: 'str', v: text.slice(i + 1, close), at: i });
      i = close + 1;
      continue;
    } else if ((m = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*/.exec(rest))) {
      toks.push({ k: 'id', v: m[0], at: i });
    } else if ((m = /^(==|!=|>=|<=|&&|\|\||[><!()])/.exec(rest))) {
      toks.push({ k: 'op', v: m[0], at: i });
    } else if (ch === '"') {
      throw new ExprError("Use single quotes for text, like 'ok'.", i);
    } else if (/^-?\d/.test(rest)) {
      throw new ExprError('Write numbers as plain digits, like 10 or -2.5.', i);
    } else if (ch === '=') {
      throw new ExprError('Use `==` to compare.', i);
    } else {
      throw new ExprError(`Unexpected character \`${ch}\`.`, i);
    }
    i += m[0].length;
  }
  toks.push({ k: 'end', at: text.length });
  return toks;
}

export function parseExpr(text: string): Expr {
  if (text.length > MAX_LENGTH) throw new ExprError(`Condition is too long (limit ${MAX_LENGTH} characters).`, 0);
  const toks = tokenize(text);
  let pos = 0;
  let depth = 0;
  const peek = () => toks[pos]!;
  const isOp = (...ops: string[]) => {
    const t = peek();
    return (t.k === 'op' && ops.includes(t.v)) || (t.k === 'id' && ops.includes(t.v));
  };
  const enter = () => {
    if (++depth > MAX_DEPTH) throw new ExprError('Condition is nested too deeply.', peek().at);
  };

  const or = (): Expr => {
    let left = and();
    while (isOp('or', '||')) {
      pos++;
      left = { t: 'bin', op: 'or', l: left, r: and() };
    }
    return left;
  };
  const and = (): Expr => {
    let left = not();
    while (isOp('and', '&&')) {
      pos++;
      left = { t: 'bin', op: 'and', l: left, r: not() };
    }
    return left;
  };
  const not = (): Expr => {
    if (isOp('not', '!')) {
      pos++;
      enter();
      const e = not();
      depth--;
      return { t: 'not', e };
    }
    return cmp();
  };
  const cmp = (): Expr => {
    const left = prim();
    const t = peek();
    if (t.k === 'op' && ['==', '!=', '>', '>=', '<', '<='].includes(t.v)) {
      pos++;
      return { t: 'bin', op: t.v as BinOp, l: left, r: prim() };
    }
    return left;
  };
  const prim = (): Expr => {
    const t = peek();
    pos++;
    if (t.k === 'num') return { t: 'lit', v: t.v };
    if (t.k === 'str') return { t: 'lit', v: t.v };
    if (t.k === 'id') {
      if (t.v === 'true') return { t: 'lit', v: true };
      if (t.v === 'false') return { t: 'lit', v: false };
      if (t.v === 'null') return { t: 'lit', v: null };
      if (['and', 'or', 'not'].includes(t.v)) throw new ExprError(`Unexpected \`${t.v}\`.`, t.at);
      const p = t.v.split('.');
      const bad = p.find((s) => FORBIDDEN.has(s));
      if (bad) throw new ExprError(`\`${bad}\` cannot be used in a condition.`, t.at);
      return { t: 'path', p };
    }
    if (t.k === 'op' && t.v === '(') {
      enter();
      const e = or();
      depth--;
      const close = peek();
      if (!(close.k === 'op' && close.v === ')')) throw new ExprError('Missing `)`.', close.at);
      pos++;
      return e;
    }
    if (t.k === 'end') throw new ExprError('The condition ends too early.', t.at);
    throw new ExprError(`Unexpected \`${'v' in t ? t.v : ''}\`.`, t.at);
  };

  const result = or();
  const tail = peek();
  if (tail.k !== 'end') throw new ExprError(`Unexpected \`${'v' in tail ? tail.v : ''}\`.`, tail.at);
  return result;
}

export function readPath(ctx: unknown, path: readonly string[]): unknown {
  let v: unknown = ctx;
  for (const seg of path) {
    if (v === null || v === undefined) return undefined;
    if (seg === 'length' && (typeof v === 'string' || Array.isArray(v))) {
      v = v.length;
    } else if (typeof v === 'object' && !FORBIDDEN.has(seg) && Object.hasOwn(v, seg)) {
      v = (v as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return v;
}

export function evalExpr(e: Expr, ctx: unknown): unknown {
  switch (e.t) {
    case 'lit':
      return e.v;
    case 'path':
      return readPath(ctx, e.p);
    case 'not':
      return !evalExpr(e.e, ctx);
    case 'bin': {
      if (e.op === 'and') return Boolean(evalExpr(e.l, ctx)) && Boolean(evalExpr(e.r, ctx));
      if (e.op === 'or') return Boolean(evalExpr(e.l, ctx)) || Boolean(evalExpr(e.r, ctx));
      const l = evalExpr(e.l, ctx);
      const r = evalExpr(e.r, ctx);
      if (e.op === '==') return l === r;
      if (e.op === '!=') return l !== r;
      const comparable =
        (typeof l === 'number' && typeof r === 'number') || (typeof l === 'string' && typeof r === 'string');
      if (!comparable) return false;
      const a = l as number;
      const b = r as number;
      return e.op === '>' ? a > b : e.op === '>=' ? a >= b : e.op === '<' ? a < b : a <= b;
    }
  }
}

/** Top-level field names a condition reads. */
export function exprRoots(e: Expr, out = new Set<string>()): Set<string> {
  if (e.t === 'path') out.add(e.p[0]!);
  else if (e.t === 'not') exprRoots(e.e, out);
  else if (e.t === 'bin') {
    exprRoots(e.l, out);
    exprRoots(e.r, out);
  }
  return out;
}
