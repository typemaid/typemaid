// Adds a "Preview" button to every Mermaid code block in the docs. It swaps the code for the
// drawn diagram, in the current theme, and back.
import { onThemeChange, renderMermaid, siteTheme } from './mermaid';

interface Block {
  pre: HTMLElement;
  view: HTMLElement;
  button: HTMLButtonElement;
  source: string;
  showing: boolean;
  drawnFor?: string;
}

const blocks: Block[] = [];
const MAX_HEIGHT = 680;

async function draw(block: Block) {
  const theme = siteTheme();
  if (block.drawnFor === theme) return;
  block.view.classList.add('is-loading');
  try {
    block.view.innerHTML = await renderMermaid(block.source, theme);
    // Draw at Mermaid's natural size, but no taller than MAX_HEIGHT; CSS shrinks it to fit the column.
    const svg = block.view.querySelector('svg');
    const box = svg?.viewBox.baseVal;
    if (svg && box?.width) {
      const scale = Math.min(1, MAX_HEIGHT / box.height);
      svg.removeAttribute('style');
      svg.setAttribute('width', String(Math.round(box.width * scale)));
      svg.setAttribute('height', String(Math.round(box.height * scale)));
    }
  } catch (e) {
    const p = document.createElement('p');
    p.className = 'diagram-error';
    p.textContent = `Mermaid could not draw this diagram: ${(e as Error).message ?? e}`;
    block.view.replaceChildren(p);
  }
  block.drawnFor = theme;
  block.view.classList.remove('is-loading');
}

async function show(block: Block, preview: boolean) {
  block.showing = preview;
  block.button.textContent = preview ? 'Code' : 'Preview';
  block.button.setAttribute('aria-pressed', String(preview));
  block.button.closest('.code-wrap')?.classList.toggle('is-previewing', preview);
  if (preview) {
    block.view.hidden = false;
    block.pre.hidden = true;
    await draw(block);
  } else {
    block.view.hidden = true;
    block.pre.hidden = false;
  }
}

for (const pre of document.querySelectorAll<HTMLElement>('pre.astro-code[data-language="mermaid"]')) {
  const wrap = pre.closest('.code-wrap') ?? pre.parentElement!;
  const source = pre.querySelector('code')?.textContent ?? '';
  if (!/^\s*(flowchart|graph)\b/m.test(source)) continue;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'preview-toggle';
  button.textContent = 'Preview';
  button.setAttribute('aria-pressed', 'false');
  button.setAttribute('aria-label', 'Show the drawn diagram or the code');

  const view = document.createElement('div');
  view.className = 'diagram-view';
  view.hidden = true;

  wrap.append(view, button);
  const block: Block = { pre, view, button, source, showing: false };
  button.addEventListener('click', () => show(block, !block.showing));
  blocks.push(block);
}

// Redraw open previews when the site theme changes.
onThemeChange(() => {
  for (const b of blocks) {
    b.drawnFor = undefined;
    if (b.showing) draw(b);
  }
});
