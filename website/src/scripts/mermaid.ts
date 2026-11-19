// Renders Mermaid diagrams in the browser. Mermaid is large, so it is loaded from the jsDelivr CDN
// only when a page actually draws a diagram, and renders run one at a time (each can use its own colours).
import type { Mermaid, MermaidConfig } from 'mermaid';

/** Keep this version equal to the `mermaid` version in package.json (a unit test checks it). */
export const MERMAID_VERSION = '12.3.0';
export const MERMAID_URL = `https://cdn.jsdelivr.net/npm/mermaid@${MERMAID_VERSION}/dist/mermaid.esm.min.mjs`;

export type DiagramTheme = 'docs' | 'stage';

const font = 'ui-sans-serif, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif';

const themes: Record<DiagramTheme, MermaidConfig['themeVariables']> = {
  // Diagrams in the docs, on the site's black background.
  docs: {
    fontFamily: font,
    primaryColor: '#101a28',
    primaryBorderColor: '#4f86c6',
    primaryTextColor: '#e6edf5',
    lineColor: '#7d8896',
    edgeLabelBackground: '#0a0a0a',
    tertiaryColor: '#0a0a0a',
  },
  // The live diagram in the landing page hero.
  stage: {
    fontFamily: font,
    fontSize: '19px',
    primaryColor: '#0e1a2c',
    primaryBorderColor: '#2a4468',
    primaryTextColor: '#dbe7f5',
    lineColor: '#34506f',
    edgeLabelBackground: '#0a1424',
    tertiaryColor: '#0a1424',
  },
};

let mermaid: Promise<Mermaid> | undefined;
let queue: Promise<unknown> = Promise.resolve();
let count = 0;

/** Starts downloading Mermaid early, for example when a diagram is about to scroll into view. */
export function loadMermaid(): Promise<Mermaid> {
  mermaid ??= import(/* @vite-ignore */ MERMAID_URL).then((m: { default: Mermaid }) => m.default);
  return mermaid;
}

/** Renders Mermaid source to an SVG string. Throws with Mermaid's message if it cannot draw it. */
export function renderMermaid(source: string, theme: DiagramTheme): Promise<string> {
  mermaid ??= loadMermaid();
  const job = queue.then(async () => {
    const m = await mermaid!;
    const stage = theme === 'stage';
    m.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      themeVariables: themes[theme],
      flowchart: stage ? { curve: 'basis', padding: 12, nodeSpacing: 26, rankSpacing: 34 } : { curve: 'basis', padding: 10, nodeSpacing: 28, rankSpacing: 30 },
    });
    const id = `mmd-${++count}`;
    try {
      return (await m.render(id, source)).svg;
    } finally {
      // Mermaid leaves a scratch element behind when a render fails.
      document.getElementById(`d${id}`)?.remove();
    }
  });
  queue = job.catch(() => undefined);
  return job;
}
