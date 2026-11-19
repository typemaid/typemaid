// Gives every Mermaid flowchart in the docs two tabs: Code and Preview. The diagram is drawn in the
// background as the block comes near the screen, so switching to Preview is instant.
import { loadMermaid, onThemeChange, renderMermaid, siteTheme } from './mermaid';

interface Block {
  wrap: HTMLElement;
  pre: HTMLElement;
  view: HTMLElement;
  tabs: HTMLButtonElement[];
  source: string;
  showing: 'code' | 'preview';
  drawnFor?: string;
  drawing?: Promise<void>;
}

const blocks: Block[] = [];
const MAX_HEIGHT = 680;
let uid = 0;

function draw(block: Block): Promise<void> {
  const theme = siteTheme();
  if (block.drawnFor === theme) return Promise.resolve();
  if (block.drawing) return block.drawing;
  block.view.classList.add('is-loading');
  block.drawing = (async () => {
    try {
      const svg = await renderMermaid(block.source, theme);
      block.view.innerHTML = svg;
      // Draw at Mermaid's natural size, but no taller than MAX_HEIGHT; CSS shrinks it to fit the column.
      const el = block.view.querySelector('svg');
      const box = el?.viewBox.baseVal;
      if (el && box?.width) {
        const scale = Math.min(1, MAX_HEIGHT / box.height);
        el.removeAttribute('style');
        el.setAttribute('width', String(Math.round(box.width * scale)));
        el.setAttribute('height', String(Math.round(box.height * scale)));
      }
    } catch (e) {
      const p = document.createElement('p');
      p.className = 'diagram-error';
      p.textContent = `Mermaid could not draw this diagram: ${(e as Error).message ?? e}`;
      block.view.replaceChildren(p);
    }
    block.drawnFor = theme;
    block.view.classList.remove('is-loading');
    block.drawing = undefined;
    // The theme may have changed while drawing.
    if (block.drawnFor !== siteTheme()) await draw(block);
  })();
  return block.drawing;
}

function show(block: Block, which: 'code' | 'preview') {
  if (block.showing === which) return;
  // Keep the block at least as tall as the code while the diagram loads, so the page does not jump.
  if (which === 'preview' && block.drawnFor !== siteTheme()) block.view.style.minHeight = `${block.pre.offsetHeight}px`;
  block.showing = which;
  block.wrap.dataset.showing = which;
  for (const tab of block.tabs) {
    const on = tab.dataset.tab === which;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
  }
  block.pre.hidden = which !== 'code';
  block.view.hidden = which !== 'preview';
  if (which === 'preview') void draw(block).then(() => block.view.style.removeProperty('min-height'));
}

function setup(pre: HTMLElement) {
  const wrap = (pre.closest('.code-wrap') as HTMLElement | null) ?? pre.parentElement!;
  const source = pre.querySelector('code')?.textContent ?? '';
  if (!/^\s*(flowchart|graph)\b/m.test(source)) return;
  const id = `diagram-${++uid}`;

  const bar = document.createElement('div');
  bar.className = 'diagram-tabs';
  bar.setAttribute('role', 'tablist');
  bar.setAttribute('aria-label', 'Show the code or the drawn diagram');

  const view = document.createElement('div');
  view.className = 'diagram-view';
  view.id = `${id}-preview`;
  view.setAttribute('role', 'tabpanel');
  view.setAttribute('aria-label', 'Diagram preview');
  view.hidden = true;
  pre.id ||= `${id}-code`;
  pre.setAttribute('role', 'tabpanel');

  const tabs = (['code', 'preview'] as const).map((name) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'diagram-tab';
    tab.dataset.tab = name;
    tab.textContent = name === 'code' ? 'Code' : 'Preview';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', name === 'code' ? pre.id : view.id);
    bar.append(tab);
    return tab;
  });

  wrap.classList.add('is-diagram');
  wrap.prepend(bar);
  wrap.append(view);

  const block: Block = { wrap, pre, view, tabs, source, showing: 'preview' };
  show(block, 'code');
  for (const tab of tabs) {
    tab.addEventListener('click', () => show(block, tab.dataset.tab as 'code' | 'preview'));
    // Left and right arrows move between the two tabs.
    tab.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const next = block.showing === 'code' ? 'preview' : 'code';
      show(block, next);
      tabs.find((t) => t.dataset.tab === next)?.focus();
    });
  }
  // Start loading Mermaid when the pointer is on its way to the Preview tab.
  tabs[1]!.addEventListener('pointerenter', () => void loadMermaid(), { once: true });
  blocks.push(block);
}

for (const pre of document.querySelectorAll<HTMLElement>('pre.astro-code[data-language="mermaid"]')) setup(pre);

const whenIdle = (fn: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 2000 }) : setTimeout(fn, 200));

// Draw each diagram in the background shortly before it scrolls into view.
if (blocks.length > 0 && 'IntersectionObserver' in window) {
  const byWrap = new Map(blocks.map((b) => [b.wrap, b]));
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        io.unobserve(entry.target);
        const block = byWrap.get(entry.target as HTMLElement);
        // Wait until the browser is idle, so drawing never competes with the page's first paint.
        if (block) whenIdle(() => void draw(block));
      }
    },
    { rootMargin: '400px 0px' },
  );
  for (const b of blocks) io.observe(b.wrap);
}

// Redraw diagrams when the site theme changes.
onThemeChange(() => {
  for (const b of blocks) {
    if (b.drawnFor === undefined) continue;
    b.drawnFor = undefined;
    void draw(b);
  }
});
