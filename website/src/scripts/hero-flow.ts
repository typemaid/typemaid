// The landing page's live diagram: draws examples/research-writer/research-writer.mmd with Mermaid,
// then plays runs through it. AI agents plan, research in parallel, write and get scored by an AI
// judge; the run loops until the score is high enough, then pauses for the editor, like a real run.
import { renderMermaid } from './mermaid';

/** One step of a run: a single node, or several that run at the same time. */
interface Step {
  name: string | string[];
  /** Short result shown in the log, one per node. */
  note?: string | string[];
  /** The editor's decision, for the human step. */
  decision?: 'approved' | 'rejected';
}

interface Run {
  topic: string;
  steps: Step[];
}

const research: Step[] = [
  { name: 'plan', note: 'title + 3 sections' },
  { name: ['searchWeb', 'searchPapers'], note: ['4 sources', '2 papers'] },
  { name: 'write', note: 'draft v1' },
];

const RUNS: Run[] = [
  {
    topic: 'typed AI workflows',
    steps: [
      ...research,
      { name: 'judge', note: 'score: 6' },
      { name: 'good', note: 'no' },
      { name: 'revise', note: 'draft v2' },
      { name: 'judge', note: 'score: 9' },
      { name: 'good', note: 'yes' },
      { name: 'approve', decision: 'approved' },
      { name: 'publish', note: 'url ready' },
      { name: 'done' },
    ],
  },
  {
    topic: 'durable agents',
    steps: [
      ...research,
      { name: 'judge', note: 'score: 8' },
      { name: 'good', note: 'yes' },
      { name: 'approve', decision: 'rejected' },
      { name: 'revise', note: 'draft v2' },
      { name: 'judge', note: 'score: 9' },
      { name: 'good', note: 'yes' },
      { name: 'approve', decision: 'approved' },
      { name: 'publish', note: 'url ready' },
      { name: 'done' },
    ],
  },
];

const names = (step: Step) => (Array.isArray(step.name) ? step.name : [step.name]);
const notes = (step: Step) => (Array.isArray(step.note) ? step.note : [step.note ?? '']);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const root = document.querySelector<HTMLElement>('[data-hero-flow]');
if (root) start(root);

async function start(root: HTMLElement) {
  const canvas = root.querySelector<HTMLElement>('[data-canvas]')!;
  const log = root.querySelector<HTMLElement>('[data-log]')!;
  const status = root.querySelector<HTMLElement>('[data-status]')!;
  const topic = root.querySelector<HTMLElement>('[data-ticket]')!;
  // Left to right on wide screens; the file's own top-to-bottom layout on phones.
  const narrow = matchMedia('(max-width: 700px)').matches;
  const source = (narrow ? root.dataset.sourceNarrow! : root.dataset.source!).trim();

  try {
    canvas.innerHTML = await renderMermaid(source, 'stage');
  } catch {
    canvas.textContent = 'The diagram could not be drawn.';
    return;
  }
  root.classList.add('is-ready');
  const svg = canvas.querySelector('svg')!;
  svg.removeAttribute('style');

  const node = (name: string) =>
    [...svg.querySelectorAll<SVGGElement>('g.node')].find((g) => new RegExp(`-flowchart-${name}-\\d+$`).test(g.id));
  const edge = (from: string, to: string) => svg.querySelector<SVGPathElement>(`path[data-id="L_${from}_${to}_0"]`);

  // Only play while the diagram is on screen and the tab is visible.
  let onScreen = true;
  new IntersectionObserver(([e]) => (onScreen = e!.isIntersecting)).observe(root);
  const ready = () =>
    new Promise<void>((resolve) => {
      const check = () => (onScreen && !document.hidden ? resolve() : setTimeout(check, 300));
      check();
    });
  const sleep = async (ms: number) => {
    await ready();
    await new Promise((r) => setTimeout(r, ms));
  };

  const setStatus = (text: string, kind: 'running' | 'paused' | 'completed' | 'closed') => {
    status.textContent = text;
    status.dataset.kind = kind;
  };

  const line = (name: string, state: 'run' | 'ok' | 'wait', note = '') => {
    const row = document.createElement('li');
    row.dataset.state = state;
    row.innerHTML = `<span class="icon"></span><code></code><span class="note"></span>`;
    row.querySelector('code')!.textContent = name;
    row.querySelector('.note')!.textContent = note;
    log.append(row);
    return row;
  };

  if (reduced) {
    // No motion: show a finished run.
    for (const step of RUNS[0]!.steps) for (const n of names(step)) node(n)?.classList.add('is-done');
    setStatus('completed', 'completed');
    return;
  }

  // A light that travels along an arrow.
  const travel = (path: SVGPathElement, ms: number) =>
    new Promise<void>((resolve) => {
      path.classList.add('is-lit');
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('r', '5');
      dot.setAttribute('class', 'flow-dot');
      path.parentNode!.append(dot);
      const length = path.getTotalLength();
      const t0 = performance.now();
      const frame = (now: number) => {
        const t = Math.min(1, (now - t0) / ms);
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const p = path.getPointAtLength(eased * length);
        dot.setAttribute('cx', String(p.x));
        dot.setAttribute('cy', String(p.y));
        if (t < 1) requestAnimationFrame(frame);
        else {
          dot.remove();
          resolve();
        }
      };
      requestAnimationFrame(frame);
    });

  const reset = () => {
    svg.querySelectorAll('.is-active, .is-done, .is-waiting, .is-lit').forEach((el) => el.classList.remove('is-active', 'is-done', 'is-waiting', 'is-lit'));
    log.replaceChildren();
  };

  for (let i = 0; ; i = (i + 1) % RUNS.length) {
    const run = RUNS[i]!;
    reset();
    topic.textContent = run.topic;
    setStatus('running', 'running');
    await sleep(500);

    for (let s = 0; s < run.steps.length; s++) {
      const step = run.steps[s]!;
      const here = names(step);
      // A node that runs again starts fresh.
      for (const n of here) node(n)?.classList.remove('is-done');
      for (const n of here) node(n)?.classList.add('is-active');

      if (here[0] === 'done') {
        node('done')?.classList.replace('is-active', 'is-done');
        setStatus('completed', 'completed');
        line('completed', 'ok', run.topic);
        break;
      }

      if (step.decision) {
        const g = node(here[0]!);
        g?.classList.add('is-waiting');
        setStatus('paused · waiting for the editor', 'paused');
        const row = line(here[0]!, 'wait', 'waiting for a person…');
        await sleep(1900);
        g?.classList.remove('is-waiting');
        setStatus('resumed', 'running');
        row.dataset.state = 'ok';
        row.querySelector('.note')!.textContent = `decision: ${step.decision}`;
      } else {
        // Parallel steps run side by side and finish together.
        const rows = here.map((n) => line(n, 'run'));
        await sleep(here[0] === 'good' ? 350 : 750);
        rows.forEach((row, k) => {
          row.dataset.state = 'ok';
          row.querySelector('.note')!.textContent = notes(step)[k] ?? '';
        });
      }
      for (const n of here) node(n)?.classList.replace('is-active', 'is-done');

      // Light every arrow from this step to the next one, at the same time.
      const next = run.steps[s + 1];
      if (next) {
        const target = step.decision ? (step.decision === 'approved' ? ['publish'] : ['revise']) : names(next);
        const arrows = here.flatMap((from) => target.map((to) => edge(from, to))).filter((p): p is SVGPathElement => !!p);
        if (arrows.length > 0) {
          await ready();
          await Promise.all(arrows.map((p) => travel(p, 700)));
        }
      }
    }
    await sleep(2600);
  }
}
