import { Diagnostics } from './diagnostics.ts';

export type Shape = 'rect' | 'round' | 'stadium' | 'circle' | 'diamond' | 'hexagon';

export interface Pos {
  line: number;
  column: number;
}

export interface NodeDecl extends Pos {
  id: string;
  shape?: Shape;
  label?: string;
  quoted?: boolean;
  classes: string[];
  subgraph?: string;
}

export interface EdgeDecl extends Pos {
  from: string;
  to: string;
  label?: string;
}

export interface SubgraphDecl extends Pos {
  id: string;
  title?: string;
  classes: string[];
}

export interface Ast {
  nodes: NodeDecl[];
  edges: EdgeDecl[];
  subgraphs: SubgraphDecl[];
  /** Class names given a style with `classDef`. */
  classDefs: string[];
}

/** Words Mermaid's flowchart grammar treats specially; they cannot be node ids. */
export const RESERVED = new Set([
  'end', 'call', 'click', 'style', 'class', 'classDef', 'linkStyle', 'interpolate', 'graph',
  'flowchart', 'subgraph', 'href', 'default', 'direction', 'TB', 'TD', 'BT', 'LR', 'RL', 'v',
]);

const ID = /^[A-Za-z_][A-Za-z0-9_]*/;
const MAX_SOURCE = 200_000;
const MAX_LINE = 2_000;

interface NodeRef extends Pos {
  id: string;
  shape?: Shape;
  label?: string;
  quoted?: boolean;
  classes: string[];
}

const SHAPES: Array<{ open: string; close: string; shape: Shape }> = [
  { open: '([', close: '])', shape: 'stadium' },
  { open: '((', close: '))', shape: 'circle' },
  { open: '{{', close: '}}', shape: 'hexagon' },
  { open: '[', close: ']', shape: 'rect' },
  { open: '(', close: ')', shape: 'round' },
  { open: '{', close: '}', shape: 'diamond' },
];
const UNSUPPORTED_OPEN = ['@{', '[[', '[(', '[/', '[\\', '(((', '>'];

/** Strip BOM and normalise line endings so hashes and positions agree on every OS. */
export function normalizeSource(source: string): string {
  return source.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

export function parse(source: string, diags: Diagnostics): Ast {
  const nodes = new Map<string, NodeDecl>();
  const edges: EdgeDecl[] = [];
  const subgraphs = new Map<string, SubgraphDecl>();
  const classAssignments: Array<{ ids: string[]; name: string } & Pos> = [];
  const classDefs = new Set<string>();
  const styled: Array<{ id: string } & Pos> = [];
  const linkStyles: Array<{ index: number } & Pos> = [];
  const empty = (): Ast => ({ nodes: [], edges: [], subgraphs: [], classDefs: [] });
  const ast = (): Ast => finish();

  if (source.length > MAX_SOURCE) {
    diags.error('E1002', `The file is too large (${source.length} characters; limit ${MAX_SOURCE}).`);
    return empty();
  }

  const lines = source.split('\n');
  let seenHeader = false;
  let current: SubgraphDecl | undefined;
  let i = 0;

  // Optional frontmatter block. As in Mermaid, it must open on the very first line.
  if (/^---\s*$/.test(lines[0] ?? '')) {
    i = 1;
    let content = false;
    while (i < lines.length && !/^---\s*$/.test(lines[i]!)) {
      if (lines[i]!.trim() !== '') content = true;
      i++;
    }
    if (i >= lines.length) {
      diags.error('E1002', 'The frontmatter block opened with `---` is never closed.', { line: 1, column: 1 });
      return empty();
    }
    if (!content) diags.error('E1002', 'The frontmatter block is empty.', { line: 1, column: 1 }, 'Remove the two `---` lines.');
    i++;
  }

  for (; i < lines.length; i++) {
    const raw = lines[i]!;
    const lineNo = i + 1;
    if (raw.length > MAX_LINE) {
      diags.error('E1002', `Line is too long (limit ${MAX_LINE} characters).`, { line: lineNo, column: 1 });
      continue;
    }
    splitStatements(raw).forEach((seg, index) => {
      if (index > 0 && seg.text.trimStart().startsWith('%%')) {
        diags.error('E1008', 'A comment must be on its own line.', { line: lineNo, column: seg.column }, 'Move the `%%` comment to the line above.');
        return;
      }
      statement(seg.text, lineNo, seg.column);
    });
  }
  if (current) {
    diags.error('E1012', `Subgraph \`${current.id}\` is never closed.`, current, 'Add a line containing only `end`.');
  }
  if (!seenHeader && !diags.hasErrors) {
    diags.error('E1001', 'The diagram is empty.', { line: 1, column: 1 }, 'Start the file with `flowchart TD`.');
  }
  return ast();

  function statement(text: string, line: number, baseCol: number): void {
    const lead = text.length - text.trimStart().length;
    const body = text.trim();
    const column = baseCol + lead;
    if (body === '') return;
    if (body.startsWith('%%')) {
      if (body.startsWith('%%{')) {
        diags.error('E1009', 'Directives (`%%{ ... }%%`) are not supported.', { line, column }, 'Remove this line.');
      }
      return;
    }
    if (!seenHeader) {
      const m = /^(flowchart|graph)(\s+(TB|TD|BT|LR|RL))?\s*$/.exec(body);
      if (m) {
        seenHeader = true;
        return;
      }
      seenHeader = true; // report once, then keep parsing for more problems
      diags.error(
        'E1001',
        'The diagram must start with `flowchart TD` (or another direction).',
        { line, column },
        'Add `flowchart TD` as the first line.',
      );
      if (/^(sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|journey|mindmap)\b/.test(body)) return;
    } else if (/^(flowchart|graph)(\s|$)/.test(body)) {
      diags.error('E1001', 'Only one `flowchart` header is allowed.', { line, column });
      return;
    }

    const word = /^[A-Za-z]+/.exec(body)?.[0] ?? '';
    const afterWord = body.slice(word.length);
    const isKeyword = afterWord === '' || /^\s/.test(afterWord);

    if (word === 'end' && afterWord.trim() === '') {
      if (!current) diags.error('E1012', '`end` without a matching `subgraph`.', { line, column });
      current = undefined;
      return;
    }
    if (word === 'subgraph' && isKeyword) return subgraph(afterWord, line, column);
    if (word === 'direction' && isKeyword) {
      if (!/^\s+(TB|TD|BT|LR|RL)$/.test(afterWord)) {
        diags.error('E1002', 'Unknown direction.', { line, column }, 'Use one of TB, TD, BT, LR, RL.');
      }
      return;
    }
    // Styling lines have no meaning for execution, but they must still be valid Mermaid.
    const arrowAfter = /^\s*(-|=|~|<)/.test(afterWord);
    if (['classDef', 'style', 'linkStyle', 'accTitle', 'accDescr'].includes(word) && !arrowAfter && (isKeyword || afterWord.startsWith(':'))) {
      const parts = afterWord.trim().split(/\s+/);
      const bad = (how: string) => diags.error('E1002', `Could not read this \`${word}\` line.`, { line, column }, how);
      if (word === 'classDef') {
        if (parts.length < 2 || !/^[A-Za-z_][\w-]*(,[A-Za-z_][\w-]*)*$/.test(parts[0]!)) bad('Write `classDef name fill:#eef`.');
        else for (const name of parts[0]!.split(',')) classDefs.add(name);
      } else if (word === 'style') {
        if (parts.length < 2 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(parts[0]!)) bad('Write `style nodeId fill:#eef`.');
        else styled.push({ id: parts[0]!, line, column });
      } else if (word === 'linkStyle') {
        if (parts.length < 2 || !/^(default|\d+(,\d+)*)$/.test(parts[0]!)) bad('Write `linkStyle 0 stroke:#333`.');
        else if (parts[0] !== 'default') for (const n of parts[0]!.split(',')) linkStyles.push({ index: Number(n), line, column });
      } else if (!/^\s*:\s*\S/.test(afterWord)) {
        bad(`Write \`${word}: some text\`.`);
      }
      return;
    }
    if (word === 'class' && isKeyword) {
      // Split on spaces rather than using one large pattern, so odd input cannot make this slow.
      const parts = afterWord.trim().split(/\s+/);
      if (parts.length !== 2 || !/^[A-Za-z0-9_]+(,[A-Za-z0-9_]+)*$/.test(parts[0]!) || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(parts[1]!)) {
        diags.error('E1002', 'Could not read this `class` line.', { line, column }, 'Write `class nodeId className` (several ids: `class a,b className`, no spaces after commas).');
        return;
      }
      classAssignments.push({ ids: parts[0]!.split(','), name: parts[1]!, line, column });
      return;
    }
    if (['click', 'href', 'call'].includes(word) && isKeyword && !/^\s*-/.test(afterWord)) {
      diags.error('E1013', `\`${word}\` actions are not supported.`, { line, column }, 'Remove this line.');
      return;
    }
    chain(text, line, baseCol);
  }

  function subgraph(rest: string, line: number, column: number): void {
    if (current) {
      diags.error('E1012', 'Subgraphs inside subgraphs are not supported yet.', { line, column });
    }
    const m = /^\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[(.*)\])?\s*$/.exec(rest);
    if (!m) {
      diags.error(
        'E1012',
        'A subgraph needs an id.',
        { line, column },
        'Write `subgraph each["for item in items"]`.',
      );
      current = { id: `__subgraph_${line}`, classes: [], line, column };
      return;
    }
    const id = m[1]!;
    if (RESERVED.has(id)) reserved(id, { line, column });
    else if (id in Object.prototype) forbidden(id, { line, column });
    if (subgraphs.has(id)) {
      diags.error('E1007', `Subgraph \`${id}\` is declared twice.`, { line, column });
    }
    const decl: SubgraphDecl = { id, classes: [], line, column };
    let title = m[2]?.trim();
    if (title !== undefined) {
      const quoted = title.length >= 2 && title.startsWith('"') && title.endsWith('"');
      if (quoted) title = title.slice(1, -1).trim();
      if (title === '' || title.includes('"') || (!quoted && /[()[\]{}|]/.test(title))) {
        diags.error('E1010', 'This subgraph title cannot be read by Mermaid.', { line, column }, `Write \`subgraph ${id}["Your title"]\`.`);
      }
      decl.title = title;
    }
    subgraphs.set(id, decl);
    current = decl;
  }

  function reserved(id: string, at: Pos): void {
    diags.error(
      'E1003',
      `\`${id}\` is a reserved word in Mermaid and cannot be used as a node name.`,
      at,
      `Rename it, or keep the tool name and write \`${id}Step[$${id}]\`.`,
    );
  }

  function forbidden(id: string, at: Pos): void {
    diags.error('E1011', `\`${id}\` cannot be used as a node name.`, at, 'Choose a different name.');
  }

  function chain(text: string, line: number, baseCol: number): void {
    let pos = 0;
    const col = () => baseCol + pos;
    const skipWs = (): number => {
      const start = pos;
      while (pos < text.length && /\s/.test(text[pos]!)) pos++;
      return pos - start;
    };

    const readNode = (): NodeRef | undefined => {
      skipWs();
      const at = { line, column: col() };
      const rest = text.slice(pos);
      const m = ID.exec(rest);
      if (!m) {
        if (rest.startsWith('&')) {
          diags.error('E1005', '`&` is not supported.', at, 'Write one arrow per line instead.');
        } else if (rest === '') {
          diags.error('E1002', 'An arrow must point to a node.', at);
        } else if (/^[0-9]/.test(rest)) {
          diags.error('E1011', 'A node name cannot start with a digit.', at, 'Start the name with a letter.');
        } else {
          diags.error('E1011', `Expected a node name here, found \`${rest.slice(0, 12)}\`.`, at, 'Node names use letters, digits and `_` only.');
        }
        return undefined;
      }
      const id = m[0];
      pos += id.length;
      if (RESERVED.has(id)) reserved(id, at);
      else if (id in Object.prototype) forbidden(id, at);
      const ref: NodeRef = { id, classes: [], ...at };
      if (text[pos] === '-' && ID.test(text.slice(pos + 1)) && !text.startsWith('--', pos)) {
        diags.error('E1011', 'Node names cannot contain `-`.', at, 'Use `_` or camelCase.');
        return undefined;
      }

      const here = text.slice(pos);
      const bad = UNSUPPORTED_OPEN.find((o) => here.startsWith(o));
      if (bad) {
        diags.error('E1006', `The shape starting with \`${bad}\` is not supported.`, { line, column: col() }, 'Use `[text]`, `(text)`, `([text])`, `{condition}` or `{{text}}`.');
        return undefined;
      }
      const shape = SHAPES.find((s) => here.startsWith(s.open));
      if (shape) {
        const shapeAt = { line, column: col() };
        pos += shape.open.length;
        skipWs();
        let label: string;
        let quoted = false;
        if (text[pos] === '"') {
          const close = text.indexOf('"', pos + 1);
          if (close < 0) {
            diags.error('E1010', 'This quoted text is never closed.', { line, column: col() }, 'Add the closing `"`.');
            return undefined;
          }
          label = text.slice(pos + 1, close);
          if (label.trim() === '') {
            diags.error('E1010', 'The text of this node is empty.', { line, column: col() }, 'Write some text between the quotes, or remove the brackets.');
            return undefined;
          }
          quoted = true;
          pos = close + 1;
          skipWs();
          if (!text.startsWith(shape.close, pos)) {
            diags.error('E1010', `Expected \`${shape.close}\` to close the node.`, { line, column: col() });
            return undefined;
          }
          pos += shape.close.length;
        } else {
          const close = text.indexOf(shape.close, pos);
          if (close < 0) {
            diags.error('E1010', `This node is never closed with \`${shape.close}\`.`, shapeAt);
            return undefined;
          }
          label = text.slice(pos, close).trim();
          if (label.includes('"')) {
            diags.error('E1010', 'Quotes must wrap the whole text of a node.', shapeAt, 'Write `id["text"]`.');
            return undefined;
          }
          if (label === '' || /[()[\]{}|]/.test(label)) {
            diags.error(
              'E1010',
              label === '' ? 'The text of this node is empty.' : 'Text containing brackets or `|` must be in double quotes.',
              shapeAt,
              label === '' ? 'Write some text, or remove the brackets.' : `Write \`${id}${shape.open}"${label}"${shape.close}\`.`,
            );
            return undefined;
          }
          pos = close + shape.close.length;
        }
        ref.shape = shape.shape;
        ref.label = label;
        ref.quoted = quoted;
      }
      if (text.startsWith(':::', pos)) {
        pos += 3;
        const cm = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(text.slice(pos));
        if (!cm) {
          diags.error('E1002', 'Expected a class name after `:::`.', { line, column: col() });
          return undefined;
        }
        ref.classes.push(cm[0]);
        pos += cm[0].length;
        if (text.startsWith(':::', pos)) {
          diags.error('E1002', 'A node can have only one `:::` class here.', { line, column: col() }, `Add further classes on their own line: \`class ${id} otherName\`.`);
          return undefined;
        }
      }
      return ref;
    };

    let prev = readNode();
    if (!prev) return;
    declare(prev);
    for (;;) {
      const ws = skipWs();
      if (pos >= text.length) return;
      const rest = text.slice(pos);
      const at = { line, column: col() };
      if (rest.startsWith('%%')) {
        diags.error('E1008', 'A comment must be on its own line.', at, 'Move the `%%` comment to the line above.');
        return;
      }
      const arrow = /^--+>/.exec(rest);
      if (!arrow) {
        if (/^(<-->|<--|--+[ox]|--+(?!>)|-\.|==|~~~|&)/.test(rest)) {
          const hint = rest.startsWith('-- ') ? 'Write the text as `-->|text|`.' : 'Use `-->`.';
          diags.error('E1005', 'Only `-->` arrows are supported.', at, hint);
        } else {
          diags.error('E1002', `Unexpected text \`${rest.slice(0, 16)}\`.`, at, 'Connect nodes with ` --> `.');
        }
        return;
      }
      if (ws === 0) {
        diags.error('E1004', 'Put a space before the arrow.', at, `Write \`${prev.id} -->\`.`);
      }
      pos += arrow[0].length;
      let label: string | undefined;
      const save = pos;
      skipWs();
      if (text[pos] === '|') {
        const close = text.indexOf('|', pos + 1);
        if (close < 0) {
          diags.error('E1010', 'This arrow text is never closed with `|`.', { line, column: col() });
          return;
        }
        label = text.slice(pos + 1, close).trim();
        pos = close + 1;
      } else {
        pos = save;
      }
      if (pos < text.length && !/\s/.test(text[pos]!)) {
        diags.error('E1004', 'Put a space after the arrow.', { line, column: col() }, 'Write `--> name`.');
      }
      const next = readNode();
      if (!next) return;
      declare(next);
      const edge: EdgeDecl = { from: prev.id, to: next.id, ...at };
      if (label !== undefined) edge.label = label;
      edges.push(edge);
      prev = next;
    }
  }

  function declare(ref: NodeRef): void {
    let node = nodes.get(ref.id);
    if (!node) {
      node = { id: ref.id, classes: [], line: ref.line, column: ref.column };
      nodes.set(ref.id, node);
    }
    if (ref.shape !== undefined) {
      if (node.shape !== undefined && (node.shape !== ref.shape || node.label !== ref.label)) {
        diags.error(
          'E1007',
          `Node \`${ref.id}\` is declared twice with different text or shape (first on line ${node.line}).`,
          ref,
          `Declare it once, then refer to it as \`${ref.id}\`.`,
        );
      } else {
        node.shape = ref.shape;
        if (ref.label !== undefined) node.label = ref.label;
        if (ref.quoted) node.quoted = true;
        node.line = ref.line;
        node.column = ref.column;
      }
    }
    for (const c of ref.classes) if (!node.classes.includes(c)) node.classes.push(c);
    if (current) {
      if (node.subgraph !== undefined && node.subgraph !== current.id) {
        diags.error('E1012', `Node \`${ref.id}\` appears in two subgraphs.`, ref);
      } else {
        node.subgraph = current.id;
      }
    }
  }

  function finish(): Ast {
    for (const a of classAssignments) {
      for (const id of a.ids) {
        const target = subgraphs.get(id) ?? nodes.get(id);
        if (!target) {
          diags.error('E1002', `\`class\` refers to \`${id}\`, which is not in the diagram.`, a);
          continue;
        }
        if (!target.classes.includes(a.name)) target.classes.push(a.name);
      }
    }
    // A subgraph id used in an arrow is first seen as a plain node; fold it into the subgraph.
    for (const sg of subgraphs.values()) {
      const shadow = nodes.get(sg.id);
      if (!shadow) continue;
      if (shadow.shape !== undefined) {
        diags.error('E1007', `\`${sg.id}\` is used both as a node and as a subgraph.`, shadow);
      }
      if (shadow.subgraph === sg.id) {
        diags.error('E1012', `Subgraph \`${sg.id}\` cannot contain an arrow to itself.`, shadow);
      }
      for (const c of shadow.classes) if (!sg.classes.includes(c)) sg.classes.push(c);
      nodes.delete(sg.id);
    }
    for (const st of styled) {
      if (!nodes.has(st.id) && !subgraphs.has(st.id)) diags.error('E1002', `\`style\` refers to \`${st.id}\`, which is not in the diagram.`, st);
    }
    for (const ls of linkStyles) {
      if (ls.index >= edges.length) diags.error('E1002', `\`linkStyle ${ls.index}\` refers to an arrow that does not exist (the diagram has ${edges.length}).`, ls);
    }
    return { nodes: [...nodes.values()], edges, subgraphs: [...subgraphs.values()], classDefs: [...classDefs] };
  }
}

/** Split a line on `;` that is outside quotes and brackets. */
function splitStatements(line: string): Array<{ text: string; column: number }> {
  if (!line.includes(';')) return [{ text: line, column: 1 }];
  if (line.trimStart().startsWith('%%')) return [{ text: line, column: 1 }];
  const out: Array<{ text: string; column: number }> = [];
  let depth = 0;
  let quote = false;
  let pipe = false;
  let start = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote) {
      if (ch === '"') quote = false;
    } else if (ch === '"') quote = true;
    else if (ch === '|') pipe = !pipe;
    else if ('[({'.includes(ch)) depth++;
    else if ('])}'.includes(ch)) depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0 && !pipe) {
      out.push({ text: line.slice(start, i), column: start + 1 });
      start = i + 1;
    }
  }
  out.push({ text: line.slice(start), column: start + 1 });
  return out;
}
