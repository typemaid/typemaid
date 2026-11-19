export type Severity = 'error' | 'warning';

export interface Diagnostic {
  /** Stable code, e.g. "E1203". Message text may change between releases; codes do not. */
  code: string;
  severity: Severity;
  message: string;
  file?: string;
  /** 1-based. 0 when the problem has no position in the diagram. */
  line: number;
  column: number;
  hint?: string;
}

export class FlowError extends Error {
  readonly diagnostics: Diagnostic[];
  constructor(diagnostics: Diagnostic[], source?: string) {
    super(formatDiagnostics(diagnostics, source));
    this.name = 'FlowError';
    this.diagnostics = diagnostics;
  }
}

export class Diagnostics {
  readonly list: Diagnostic[] = [];
  private readonly file: string | undefined;
  constructor(file?: string) {
    this.file = file;
  }
  error(code: string, message: string, at?: { line: number; column: number }, hint?: string): void {
    this.push('error', code, message, at, hint);
  }
  warn(code: string, message: string, at?: { line: number; column: number }, hint?: string): void {
    this.push('warning', code, message, at, hint);
  }
  get hasErrors(): boolean {
    return this.list.some((d) => d.severity === 'error');
  }
  private push(
    severity: Severity,
    code: string,
    message: string,
    at?: { line: number; column: number },
    hint?: string,
  ): void {
    const d: Diagnostic = { code, severity, message, line: at?.line ?? 0, column: at?.column ?? 0 };
    if (this.file !== undefined) d.file = this.file;
    if (hint !== undefined) d.hint = hint;
    this.list.push(d);
  }
}

/** Stable order: by position, then code, then message. */
export function sortDiagnostics(list: Diagnostic[]): Diagnostic[] {
  return [...list].sort(
    (a, b) =>
      a.line - b.line ||
      a.column - b.column ||
      (a.code < b.code ? -1 : a.code > b.code ? 1 : 0) ||
      (a.message < b.message ? -1 : a.message > b.message ? 1 : 0),
  );
}

export function formatDiagnostic(d: Diagnostic, source?: string | readonly string[]): string {
  const where = `${d.file ?? 'flow'}${d.line ? `:${d.line}:${d.column}` : ''}`;
  let out = `${where}  ${d.severity} ${d.code}  ${d.message}`;
  if (source !== undefined && d.line > 0) {
    const text = (typeof source === 'string' ? source.split('\n') : source)[d.line - 1];
    if (text !== undefined) {
      const gutter = String(d.line).padStart(4);
      out += `\n${gutter} | ${text.replace(/\r$/, '')}`;
      out += `\n     | ${' '.repeat(Math.max(0, d.column - 1))}^`;
    }
  }
  if (d.hint) out += `\n     fix: ${d.hint}`;
  return out;
}

/** Formats problems in a stable order. Long lists are cut off after `limit` entries. */
export function formatDiagnostics(list: Diagnostic[], source?: string, limit = 50): string {
  const lines = source?.split('\n');
  const sorted = sortDiagnostics(list);
  const shown = sorted.slice(0, limit).map((d) => formatDiagnostic(d, lines));
  if (sorted.length > limit) shown.push(`... and ${sorted.length - limit} more.`);
  return shown.join('\n');
}

/** Edit distance where swapping two neighbouring letters counts as one change. */
function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, d[i - 2]![j - 2]! + 1);
      d[i]![j] = best;
    }
  }
  return d[a.length]![b.length]!;
}

/** Closest candidate by edit distance, if it is close enough to be a likely typo. */
export function suggest(name: string, candidates: Iterable<string>): string | undefined {
  let best: string | undefined;
  let bestScore = Infinity;
  const lower = name.toLowerCase();
  for (const c of candidates) {
    const score = distance(lower, c.toLowerCase());
    if (score < bestScore || (score === bestScore && best !== undefined && c < best)) {
      best = c;
      bestScore = score;
    }
  }
  const limit = Math.max(1, Math.floor(name.length / 3));
  return best !== undefined && bestScore <= limit ? best : undefined;
}
