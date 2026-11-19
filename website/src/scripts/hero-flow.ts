// The landing page's live diagram: draws examples/triage/triage.mmd with Mermaid, then plays
// runs through it. A light travels along each arrow, steps light up as they run, and the run
// pauses at the human step for a decision, like a real typemaid run.
import { renderMermaid } from './mermaid';

interface Run {
  ticket: string;
  path: string[];
  /** Short result shown in the log next to a step. */
  notes: Record<string, string>;
  /** The decision taken at the human step, if the run passes it. */
  decision?: 'approved' | 'rejected';
  end: string;
}

const RUNS: Run[] = [
  {
    ticket: 'T-1042',
    path: ['fetchTicket', 'classify', 'urgent', 'reply', 'send', 'done'],
    notes: { fetchTicket: 'ticket loaded', classify: 'priority: 2', urgent: 'no', reply: 'draft ready', send: 'sent: true' },
    end: 'completed',
  },
  {
    ticket: 'T-URGENT',
    path: ['fetchTicket', 'classify', 'urgent', 'approve', 'reply', 'send', 'done'],
    notes: { fetchTicket: 'ticket loaded', classify: 'priority: 5', urgent: 'yes', reply: 'draft ready', send: 'sent: true' },
    decision: 'approved',
    end: 'completed',
  },
  {
    ticket: 'T-0099',
    path: ['fetchTicket', 'classify', 'urgent', 'approve', 'closeTicket', 'closed'],
    notes: { fetchTicket: 'ticket loaded', classify: 'priority: 4', urgent: 'yes', closeTicket: 'closed: true' },
    decision: 'rejected',
    end: 'closed',
  },
];

const ENDS = new Set(['done', 'closed']);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const root = document.querySelector<HTMLElement>('[data-hero-flow]');
if (root) start(root);

async function start(root: HTMLElement) {
  const canvas = root.querySelector<HTMLElement>('[data-canvas]')!;
  const log = root.querySelector<HTMLElement>('[data-log]')!;
  const status = root.querySelector<HTMLElement>('[data-status]')!;
  const ticket = root.querySelector<HTMLElement>('[data-ticket]')!;
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
    for (const n of RUNS[1]!.path) node(n)?.classList.add('is-done');
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
    ticket.textContent = run.ticket;
    setStatus('running', 'running');
    await sleep(500);

    for (let s = 0; s < run.path.length; s++) {
      const name = run.path[s]!;
      const g = node(name);
      g?.classList.add('is-active');

      if (ENDS.has(name)) {
        g?.classList.replace('is-active', 'is-done');
        setStatus(run.end, run.end === 'closed' ? 'closed' : 'completed');
        line(run.end, 'ok', `run ${run.ticket}`);
        break;
      }

      if (name === 'approve' && run.decision) {
        g?.classList.add('is-waiting');
        setStatus('paused · waiting for a manager', 'paused');
        const row = line(name, 'wait', 'waiting for a person…');
        await sleep(1900);
        g?.classList.remove('is-waiting');
        setStatus('resumed', 'running');
        row.dataset.state = 'ok';
        row.querySelector('.note')!.textContent = `decision: ${run.decision}`;
      } else {
        const row = line(name, 'run');
        await sleep(name === 'urgent' ? 350 : 650);
        row.dataset.state = 'ok';
        row.querySelector('.note')!.textContent = run.notes[name] ?? '';
      }
      g?.classList.replace('is-active', 'is-done');

      const next = run.path[s + 1];
      const arrow = next && edge(name, next);
      if (arrow) {
        await ready();
        await travel(arrow, 700);
      }
    }
    await sleep(2600);
  }
}
