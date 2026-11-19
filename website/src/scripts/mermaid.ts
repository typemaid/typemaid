// Renders Mermaid diagrams in the browser. Mermaid is large, so it is loaded only when a
// page actually draws a diagram, and renders run one at a time (each can use its own colours).
import type { Mermaid, MermaidConfig } from 'mermaid';

export type DiagramTheme = 'light' | 'dark' | 'stage';

const font = 'ui-sans-serif, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif';

const themes: Record<DiagramTheme, MermaidConfig['themeVariables']> = {
  light: {
    fontFamily: font,
    primaryColor: '#eef4fb',
    primaryBorderColor: '#3178c6',
    primaryTextColor: '#0f172a',
    lineColor: '#64748b',
    edgeLabelBackground: '#ffffff',
    tertiaryColor: '#f8fafc',
  },
  dark: {
    fontFamily: font,
    primaryColor: '#13243b',
    primaryBorderColor: '#6aa7f0',
    primaryTextColor: '#e2e8f0',
    lineColor: '#94a3b8',
    edgeLabelBackground: '#0d1117',
    tertiaryColor: '#0f1629',
  },
  // The landing page's dark stage, the same in both site themes.
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

/** Renders Mermaid source to an SVG string. Throws with Mermaid's message if it cannot draw it. */
export function renderMermaid(source: string, theme: DiagramTheme): Promise<string> {
  mermaid ??= import('mermaid').then((m) => m.default);
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

/** The site's current theme. */
export const siteTheme = (): DiagramTheme => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

/** Calls `fn` whenever the site theme changes. */
export function onThemeChange(fn: () => void) {
  new MutationObserver(fn).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}
