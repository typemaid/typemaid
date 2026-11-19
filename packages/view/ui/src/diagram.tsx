/**
 * Draws a diagram from its Mermaid text and lets the user pan, zoom and pick nodes.
 * The picture comes from the text; everything shown about a node comes from the graph data,
 * never from the picture. If the picture's nodes cannot be matched to the data, the diagram
 * is still shown and nodes can be picked from the list beside it.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { FlowGraph } from '../../src/contract.ts';

type Mermaid = (typeof import('mermaid'))['default'];
let mermaidLoad: Promise<Mermaid> | undefined;
let queue: Promise<unknown> = Promise.resolve();
let counter = 0;

/** Mermaid keeps shared state while drawing, so drawings are done one at a time. */
export function renderMermaid(source: string, dark: boolean): Promise<string> {
  const job = queue.then(async () => {
    mermaidLoad ??= import('mermaid').then((m) => m.default);
    const mermaid = await mermaidLoad;
    const css = getComputedStyle(document.documentElement);
    const v = (name: string) => css.getPropertyValue(name).trim();
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      // The classic layout, the one most Mermaid previews use. The larger layout engine is left out of the page.
      layout: 'dagre',
      fontFamily: v('--font'),
      flowchart: { htmlLabels: true, curve: 'basis', padding: 14 },
      themeVariables: {
        darkMode: dark,
        background: v('--canvas'),
        primaryColor: v('--node'),
        primaryTextColor: v('--text'),
        primaryBorderColor: v('--node-line'),
        secondaryColor: v('--panel-2'),
        tertiaryColor: v('--group'),
        tertiaryBorderColor: v('--line'),
        tertiaryTextColor: v('--muted'),
        lineColor: v('--edge'),
        textColor: v('--text'),
        edgeLabelBackground: v('--canvas'),
        clusterBkg: v('--group'),
        clusterBorder: v('--line'),
        fontSize: '14px',
      },
    });
    const id = `fmd${++counter}`;
    try {
      return (await mermaid.render(id, source)).svg;
    } finally {
      // On a failed drawing Mermaid can leave a helper element behind.
      document.getElementById(id)?.remove();
      document.getElementById(`d${id}`)?.remove();
    }
  });
  queue = job.catch(() => undefined);
  return job;
}

/** Find the element for each node of the graph inside a drawn diagram. */
function mapNodes(svg: SVGSVGElement, graph: FlowGraph | undefined): Map<string, SVGGElement> {
  const found = new Map<string, SVGGElement>();
  if (!graph) return found;
  const known = new Set(graph.nodes.map((n) => n.id));
  for (const el of svg.querySelectorAll<SVGGElement>('g.node')) {
    const match = /(?:^|-)flowchart-(.+)-\d+$/.exec(el.id);
    if (match && known.has(match[1]!)) found.set(match[1]!, el);
  }
  // A for-each block is drawn as a box around its steps, not as a node.
  for (const el of svg.querySelectorAll<SVGGElement>('g.cluster')) {
    const id = [...known].filter((k) => !found.has(k) && (el.id === k || el.id.endsWith(`-${k}`))).sort((x, y) => y.length - x.length)[0];
    if (id) found.set(id, el);
  }
  return found;
}

export function Preview(props: { source: string; dark: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'idle' | 'drawn' | 'failed'>('idle');
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let cancelled = false;
    const draw = () =>
      renderMermaid(props.source, props.dark).then(
        (svg) => {
          if (cancelled) return;
          el.innerHTML = svg;
          const node = el.querySelector('svg');
          node?.removeAttribute('style');
          node?.setAttribute('width', '100%');
          node?.setAttribute('height', '100%');
          setState('drawn');
        },
        () => !cancelled && setState('failed'),
      );
    // Draw only when the card scrolls into view, so a long list stays quick.
    const seen = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        seen.disconnect();
        void draw();
      }
    });
    seen.observe(el);
    return () => {
      cancelled = true;
      seen.disconnect();
    };
  }, [props.source, props.dark]);
  return (
    <div class="preview" aria-hidden="true">
      <div class="preview-svg" ref={host} />
      {state === 'failed' && <div class="preview-note">This diagram has problems and cannot be drawn</div>}
    </div>
  );
}

interface DiagramProps {
  /** Changes when a different workflow is shown; the view is fitted again. */
  flowId: string;
  source: string;
  graph: FlowGraph | undefined;
  dark: boolean;
  selected: string | undefined;
  onSelect: (id: string | undefined) => void;
  /** Told whether the nodes in the picture could be matched to the data. */
  onMapped: (ok: boolean) => void;
}

export function Diagram(props: DiagramProps) {
  const frame = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<string, SVGGElement>());
  const view = useRef({ x: 0, y: 0, k: 1 });
  const size = useRef({ w: 0, h: 0 });
  const fittedFor = useRef<string | undefined>(undefined);
  const [zoom, setZoom] = useState(100);
  const [failed, setFailed] = useState<string | undefined>(undefined);
  const select = useRef(props.onSelect);
  select.current = props.onSelect;

  const apply = () => {
    const { x, y, k } = view.current;
    if (layer.current) layer.current.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
    setZoom(Math.round(k * 100));
  };
  const fit = () => {
    const el = frame.current;
    if (!el || !size.current.w) return;
    // Leave room at the bottom for the legend and the zoom buttons.
    const pad = 40;
    const bottom = 56;
    const height = el.clientHeight - bottom;
    const k = Math.min(1.25, (el.clientWidth - pad) / size.current.w, (height - pad) / size.current.h);
    const scale = Math.max(0.1, k);
    view.current = { k: scale, x: (el.clientWidth - size.current.w * scale) / 2, y: (height - size.current.h * scale) / 2 };
    apply();
  };
  const zoomBy = (factor: number, cx?: number, cy?: number) => {
    const el = frame.current;
    if (!el) return;
    const px = cx ?? el.clientWidth / 2;
    const py = cy ?? el.clientHeight / 2;
    const { x, y, k } = view.current;
    const next = Math.min(4, Math.max(0.1, k * factor));
    view.current = { k: next, x: px - ((px - x) * next) / k, y: py - ((py - y) * next) / k };
    apply();
  };

  // Draw when the text or the theme changes. Picking a node never redraws.
  useEffect(() => {
    let cancelled = false;
    renderMermaid(props.source, props.dark).then(
      (svg) => {
        if (cancelled || !layer.current) return;
        layer.current.innerHTML = svg;
        const el = layer.current.querySelector('svg');
        if (!el) return;
        const box = el.viewBox.baseVal;
        size.current = { w: box.width || el.clientWidth, h: box.height || el.clientHeight };
        el.removeAttribute('style');
        el.setAttribute('width', String(size.current.w));
        el.setAttribute('height', String(size.current.h));
        el.setAttribute('role', 'img');
        nodes.current = mapNodes(el, props.graph);
        const kinds = new Map(props.graph?.nodes.map((n) => [n.id, n.kind]));
        for (const [id, g] of nodes.current) {
          g.classList.add('fm-node', `fm-kind-${kinds.get(id)}`);
          g.setAttribute('tabindex', '0');
          g.setAttribute('role', 'button');
          g.setAttribute('aria-label', `Step ${id}`);
          g.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              select.current(id);
            }
          });
        }
        const expected = props.graph?.nodes.length ?? 0;
        props.onMapped(expected === 0 || nodes.current.size === expected);
        setFailed(undefined);
        if (fittedFor.current !== props.flowId) {
          fittedFor.current = props.flowId;
          fit();
        } else apply();
        mark();
      },
      (err: unknown) => {
        if (cancelled) return;
        if (layer.current) layer.current.innerHTML = '';
        nodes.current = new Map();
        props.onMapped(false);
        setFailed(err instanceof Error ? err.message.split('\n')[0]! : 'The diagram could not be drawn.');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [props.source, props.dark, props.flowId]);

  const mark = () => {
    for (const [id, g] of nodes.current) g.classList.toggle('fm-selected', id === props.selected);
  };
  useEffect(mark, [props.selected]);

  // Panning, zooming and picking.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomBy(Math.exp(-e.deltaY * 0.012), e.clientX - rect.left, e.clientY - rect.top);
      else {
        view.current.x -= e.deltaX;
        view.current.y -= e.deltaY;
        apply();
      }
    };
    let drag: { x: number; y: number; moved: boolean } | undefined;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || (e.target as Element).closest('.diagram-tools')) return;
      drag = { x: e.clientX, y: e.clientY, moved: false };
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      if (!drag.moved) {
        drag.moved = true;
        el.setPointerCapture(e.pointerId);
        el.classList.add('dragging');
      }
      view.current.x += dx;
      view.current.y += dy;
      drag.x = e.clientX;
      drag.y = e.clientY;
      apply();
    };
    const onUp = (e: PointerEvent) => {
      const wasDrag = drag?.moved;
      drag = undefined;
      el.classList.remove('dragging');
      if (wasDrag || e.button !== 0 || (e.target as Element).closest('.diagram-tools')) return;
      const hit = (e.target as Element).closest<SVGGElement>('g.fm-node');
      const id = hit ? [...nodes.current].find(([, g]) => g === hit)?.[0] : undefined;
      select.current(id);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.target !== el) return;
      if (e.key === '+' || e.key === '=') zoomBy(1.2);
      else if (e.key === '-') zoomBy(1 / 1.2);
      else if (e.key === '0') fit();
      else if (e.key.startsWith('Arrow')) {
        const step = 40;
        view.current.x += e.key === 'ArrowLeft' ? step : e.key === 'ArrowRight' ? -step : 0;
        view.current.y += e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0;
        apply();
      } else return;
      e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('keydown', onKey);
    const resize = new ResizeObserver(() => {
      if (fittedFor.current === undefined) fit();
    });
    resize.observe(el);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('keydown', onKey);
      resize.disconnect();
    };
  }, []);

  return (
    <div class="diagram" ref={frame} tabIndex={0} aria-label="Workflow diagram. Drag to move, pinch or use plus and minus to zoom, 0 to fit.">
      <div class="diagram-layer" ref={layer} />
      {failed !== undefined && (
        <div class="diagram-empty">
          <strong>This diagram cannot be drawn yet</strong>
          <span>Fix the problems listed under “Problems”, and it will appear here.</span>
        </div>
      )}
      <div class="diagram-tools" role="toolbar" aria-label="Zoom">
        <button type="button" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out" title="Zoom out (−)">−</button>
        <span class="zoom-value" aria-live="off">{zoom}%</span>
        <button type="button" onClick={() => zoomBy(1.25)} aria-label="Zoom in" title="Zoom in (+)">+</button>
        <button type="button" class="wide" onClick={fit} title="Fit to screen (0)">Fit</button>
      </div>
    </div>
  );
}
