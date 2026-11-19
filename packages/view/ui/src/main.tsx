import { render, type ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Field, FlowNode, FlowSummary, FlowView, Meta, NodeKind, ViewDiagnostic } from '../../src/contract.ts';
import { httpClient, readConfig, SUPPORTED_SCHEMA, type DataClient } from './client.ts';
import { Diagram, Preview } from './diagram.tsx';

const KIND: Record<NodeKind, { label: string; hint: string }> = {
  tool: { label: 'Tool', hint: 'Runs your code' },
  agent: { label: 'Agent', hint: 'Asks a model' },
  human: { label: 'Human', hint: 'Waits for a person' },
  decision: { label: 'Decision', hint: 'Chooses a path' },
  marker: { label: 'Marker', hint: 'Start or end; runs nothing' },
  foreach: { label: 'For each', hint: 'Runs once per list item' },
  unbound: { label: 'Step', hint: 'Its code was not read' },
};
const TABS = ['diagram', 'steps', 'problems', 'source', 'data'] as const;
type Tab = (typeof TABS)[number];

interface Route {
  flow?: string;
  tab: Tab;
}
function readRoute(): Route {
  const [, kind, id, tab] = location.hash.replace(/^#/, '').split('/');
  if (kind === 'flow' && id) return { flow: decodeURIComponent(id), tab: (TABS as readonly string[]).includes(tab ?? '') ? (tab as Tab) : 'diagram' };
  return { tab: 'diagram' };
}
const href = (flow?: string, tab?: Tab) => (flow ? `#/flow/${encodeURIComponent(flow)}${tab && tab !== 'diagram' ? `/${tab}` : ''}` : '#/');

function useDark(): [boolean, () => void] {
  const media = useMemo(() => matchMedia('(prefers-color-scheme: dark)'), []);
  const [choice, setChoice] = useState<string | null>(() => {
    try {
      return localStorage.getItem('viewer-theme');
    } catch {
      return null;
    }
  });
  const [system, setSystem] = useState(media.matches);
  useEffect(() => {
    const on = () => setSystem(media.matches);
    media.addEventListener('change', on);
    return () => media.removeEventListener('change', on);
  }, []);
  const dark = choice ? choice === 'dark' : system;
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [dark]);
  return [
    dark,
    () => {
      const next = dark ? 'light' : 'dark';
      try {
        localStorage.setItem('viewer-theme', next);
      } catch {
        // The choice just will not be remembered.
      }
      setChoice(next);
    },
  ];
}

function App({ client }: { client: DataClient }) {
  const [meta, setMeta] = useState<Meta>();
  const [flows, setFlows] = useState<FlowSummary[]>();
  const [flow, setFlow] = useState<FlowView>();
  const [route, setRoute] = useState(readRoute);
  const [error, setError] = useState<string>();
  const [connected, setConnected] = useState(true);
  const [toast, setToast] = useState<string>();
  const [dark, toggleDark] = useDark();
  const current = useRef(route.flow);
  current.current = route.flow;

  useEffect(() => {
    const on = () => setRoute(readRoute());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);

  const loadList = () => client.flows().then((list) => setFlows(list.flows));
  const loadFlow = (id: string) =>
    client.flow(id).then(
      (f) => current.current === id && setFlow(f),
      () => current.current === id && setFlow(undefined),
    );

  useEffect(() => {
    client
      .meta()
      .then((m) => {
        setMeta(m);
        if (m.schemaVersion !== SUPPORTED_SCHEMA) return;
        return loadList();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    return client.subscribe(
      (event) => {
        if (event.type !== 'flows.changed') return;
        void loadList();
        if (current.current && event.ids.includes(current.current)) void loadFlow(current.current);
        setToast('Updated from disk');
        setTimeout(() => setToast(undefined), 2200);
      },
      (ok) => {
        setConnected((was) => {
          if (ok && !was) {
            void loadList();
            if (current.current) void loadFlow(current.current);
          }
          return ok;
        });
      },
    );
  }, []);

  useEffect(() => {
    setFlow((f) => (f && f.id === route.flow ? f : undefined));
    if (route.flow) void loadFlow(route.flow);
  }, [route.flow]);

  useEffect(() => {
    const name = route.flow ? flow?.title : undefined;
    document.title = `${name ? `${name} · ` : ''}${meta?.rootName ?? 'Workflows'}`;
  }, [flow, meta, route.flow]);

  let body: ComponentChildren;
  if (error) body = <Notice title="The viewer cannot reach its data" text={error} />;
  else if (meta && meta.schemaVersion !== SUPPORTED_SCHEMA) {
    body = <Notice title="This viewer is out of date" text={`The data is in format ${meta.schemaVersion}; this viewer reads format ${SUPPORTED_SCHEMA}. Update the viewer to match.`} />;
  } else if (!meta || !flows) body = <div class="loading">Loading…</div>;
  else if (flows.length === 0) {
    body = <Notice title="No workflows found" text="Add a .mmd file (a Mermaid flowchart) to this folder and it will appear here." />;
  } else if (route.flow) {
    const missing = !flows.some((f) => f.id === route.flow);
    body = missing ? (
      <Notice title="This workflow is no longer here" text="The file may have been moved or deleted." action={<a class="button" href={href()}>See all workflows</a>} />
    ) : (
      <FlowPage flows={flows} flow={flow} id={route.flow} tab={route.tab} dark={dark} />
    );
  } else body = <Home flows={flows} client={client} dark={dark} />;

  return (
    <div class="shell">
      <header class="top">
        <a class="brand" href={href()}>
          <span class="brand-mark" aria-hidden="true" />
          <span class="brand-name">{meta?.rootName ?? 'Workflows'}</span>
        </a>
        <span class="top-meta">{flows ? `${flows.length} workflow${flows.length === 1 ? '' : 's'}` : ''}</span>
        <span class="grow" />
        {meta?.capabilities.liveReload && (
          <span class={`live ${connected ? 'on' : 'off'}`} title={connected ? 'Changes on disk appear here automatically' : 'Trying to reconnect'}>
            <span class="dot" aria-hidden="true" />
            {connected ? 'Live' : 'Reconnecting…'}
          </span>
        )}
        <button type="button" class="icon-button" onClick={toggleDark} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} title={dark ? 'Light theme' : 'Dark theme'}>
          {dark ? '☀' : '☾'}
        </button>
      </header>
      {!connected && <div class="banner" role="status">Connection lost. What you see may be out of date; reconnecting…</div>}
      <main class="main">{body}</main>
      {toast && <div class="toast" role="status">{toast}</div>}
    </div>
  );
}

/** Text from the checker marks names with backticks; show those as code. */
function Rich({ text }: { text: string }) {
  return <>{text.split('`').map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : part))}</>;
}

function Notice(props: { title: string; text: string; action?: ComponentChildren }) {
  return (
    <div class="notice">
      <h1>{props.title}</h1>
      <p>{props.text}</p>
      {props.action}
    </div>
  );
}

function Status({ flow }: { flow: FlowSummary }) {
  if (flow.errors > 0) return <span class="pill bad">{flow.errors} error{flow.errors === 1 ? '' : 's'}</span>;
  if (flow.warnings > 0) return <span class="pill warn">{flow.warnings} warning{flow.warnings === 1 ? '' : 's'}</span>;
  return <span class="pill ok">No problems</span>;
}

function Counts({ flow }: { flow: FlowSummary }) {
  const c = flow.counts;
  const parts: Array<[number, string, NodeKind]> = [
    [c.tools, 'tool', 'tool'],
    [c.agents, 'agent', 'agent'],
    [c.humans, 'human', 'human'],
    [c.decisions, 'decision', 'decision'],
  ];
  return (
    <span class="counts">
      {parts
        .filter(([n]) => n > 0)
        .map(([n, word, kind]) => (
          <span class="count" key={word}>
            <span class={`swatch k-${kind}`} aria-hidden="true" />
            {n} {word}
            {n === 1 ? '' : 's'}
          </span>
        ))}
    </span>
  );
}

function Home({ flows, client, dark }: { flows: FlowSummary[]; client: DataClient; dark: boolean }) {
  const [query, setQuery] = useState('');
  const [onlyProblems, setOnlyProblems] = useState(false);
  const q = query.trim().toLowerCase();
  const shown = flows.filter((f) => (!q || f.title.toLowerCase().includes(q) || f.file.toLowerCase().includes(q)) && (!onlyProblems || f.errors + f.warnings > 0));
  const withProblems = flows.filter((f) => f.errors + f.warnings > 0).length;
  return (
    <div class="home">
      <div class="home-head">
        <h1>Workflows</h1>
        <div class="home-tools">
          <input type="search" class="search" placeholder="Search by name or file" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} aria-label="Search workflows" />
          <label class={`toggle ${withProblems === 0 ? 'disabled' : ''}`}>
            <input type="checkbox" checked={onlyProblems} disabled={withProblems === 0} onChange={(e) => setOnlyProblems((e.target as HTMLInputElement).checked)} />
            With problems ({withProblems})
          </label>
        </div>
      </div>
      {shown.length === 0 ? (
        <p class="empty">No workflows match.</p>
      ) : (
        <div class="grid">
          {shown.map((f) => (
            <Card key={`${f.id}:${f.version ?? ''}`} flow={f} client={client} dark={dark} />
          ))}
        </div>
      )}
    </div>
  );
}

function Card({ flow, client, dark }: { flow: FlowSummary; client: DataClient; dark: boolean }) {
  const [source, setSource] = useState<string>();
  useEffect(() => {
    let live = true;
    client.flow(flow.id).then((f) => live && setSource(f.diagram.source), () => undefined);
    return () => {
      live = false;
    };
  }, [flow.id, flow.version]);
  return (
    <a class="card" href={href(flow.id)}>
      <div class="card-picture">{source !== undefined && <Preview source={source} dark={dark} />}</div>
      <div class="card-body">
        <div class="card-title">
          <h2>{flow.title}</h2>
          <Status flow={flow} />
        </div>
        <div class="path">{flow.file}</div>
        <Counts flow={flow} />
      </div>
    </a>
  );
}

function FlowPage(props: { flows: FlowSummary[]; flow: FlowView | undefined; id: string; tab: Tab; dark: boolean }) {
  const { flows, flow, id, tab, dark } = props;
  const summary = flows.find((f) => f.id === id)!;
  const [selected, setSelected] = useState<string>();
  const [mapped, setMapped] = useState(true);
  const [focusLine, setFocusLine] = useState<number>();
  useEffect(() => setSelected(undefined), [id]);
  const node = flow?.graph?.nodes.find((n) => n.id === selected);
  const problems = flow ? flow.diagnostics.length + (flow.toolsError ? 1 : 0) : summary.errors + summary.warnings;
  const labels: Record<Tab, string> = { diagram: 'Diagram', steps: 'Steps', problems: `Problems${problems ? ` (${problems})` : ''}`, source: 'Source', data: 'Data' };

  return (
    <div class={`flow ${flows.length > 1 ? 'with-side' : ''}`}>
      {flows.length > 1 && (
        <nav class="side" aria-label="Workflows">
          <a class="side-all" href={href()}>← All workflows</a>
          <ul>
            {flows.map((f) => (
              <li key={f.id}>
                <a href={href(f.id)} class={f.id === id ? 'current' : ''} aria-current={f.id === id ? 'page' : undefined}>
                  <span class={`state ${f.errors ? 'bad' : f.warnings ? 'warn' : 'ok'}`} aria-hidden="true" />
                  <span class="side-text">
                    <span class="side-title">{f.title}</span>
                    <span class="path">{f.file}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <section class="flow-main">
        <div class="flow-head">
          <div>
            <h1>{summary.title}</h1>
            <div class="flow-sub">
              <span class="path">{summary.file}</span>
              {summary.toolsFile ? <span class="sub-item">steps from <span class="path">{summary.toolsFile}</span></span> : <span class="sub-item">diagram only, no tools file read</span>}
            </div>
          </div>
          <div class="flow-head-right">
            <Counts flow={summary} />
            <Status flow={summary} />
          </div>
        </div>
        <div class="tabs" role="tablist">
          {TABS.map((t) => (
            <a key={t} role="tab" aria-selected={t === tab} class={t === tab ? 'current' : ''} href={href(id, t)}>
              {labels[t]}
            </a>
          ))}
        </div>
        {!flow ? (
          <div class="loading">Loading…</div>
        ) : tab === 'diagram' ? (
          <div class="split">
            <div class="canvas-wrap">
              <Diagram flowId={flow.id} source={flow.diagram.source} graph={flow.graph} dark={dark} selected={selected} onSelect={setSelected} onMapped={setMapped} />
              <Legend flow={flow} />
            </div>
            <aside class="inspector" aria-label="Details">
              {node ? <NodeDetails flow={flow} node={node} onClose={() => setSelected(undefined)} /> : <FlowDetails flow={flow} mapped={mapped} onSelect={setSelected} />}
            </aside>
          </div>
        ) : tab === 'steps' ? (
          <Steps flow={flow} onPick={(n) => { setSelected(n); location.hash = href(id); }} />
        ) : tab === 'problems' ? (
          <Problems flow={flow} onLine={(line) => { setFocusLine(line); location.hash = href(id, 'source'); }} />
        ) : tab === 'source' ? (
          <Source flow={flow} focus={focusLine} />
        ) : (
          <pre class="json" tabIndex={0}>{JSON.stringify(flow, null, 2)}</pre>
        )}
      </section>
    </div>
  );
}

function Legend({ flow }: { flow: FlowView }) {
  const kinds = [...new Set(flow.graph?.nodes.map((n) => n.kind) ?? [])].filter((k) => k !== 'marker');
  if (kinds.length === 0) return null;
  return (
    <div class="legend" aria-label="Legend">
      {kinds.map((k) => (
        <span key={k} title={KIND[k].hint}>
          <span class={`swatch k-${k}`} aria-hidden="true" />
          {KIND[k].label}
        </span>
      ))}
    </div>
  );
}

function Fields({ fields, empty }: { fields: Record<string, Field> | undefined; empty: string }) {
  const names = Object.keys(fields ?? {});
  if (!fields || names.length === 0) return <p class="none">{empty}</p>;
  return (
    <ul class="fields">
      {names.map((name) => (
        <li key={name}>
          <code>{name}</code>
          <span class="field-kind">{fields[name]!.kind === 'unknown' ? 'any' : fields[name]!.kind}</span>
          {!fields[name]!.required && <span class="field-opt">optional</span>}
          {fields[name]!.options && <span class="field-opt">one of {fields[name]!.options!.join(', ')}</span>}
        </li>
      ))}
    </ul>
  );
}

function KindBadge({ kind }: { kind: NodeKind }) {
  return (
    <span class={`badge k-${kind}`} title={KIND[kind].hint}>
      {KIND[kind].label}
    </span>
  );
}

function FlowDetails({ flow, mapped, onSelect }: { flow: FlowView; mapped: boolean; onSelect: (id: string) => void }) {
  const graph = flow.graph;
  return (
    <div class="details">
      <h2>About this workflow</h2>
      <p class="hint">Select a step in the diagram to see what it reads and writes.</p>
      {!graph && <p class="callout bad">The diagram has errors, so its steps cannot be listed. See the Problems tab.</p>}
      {flow.toolsError && <p class="callout bad">The tools file could not be read: {flow.toolsError}</p>}
      {graph && (
        <>
          <h3>Starts at</h3>
          {graph.entries.map((entry) => (
            <div class="entry" key={entry}>
              <button type="button" class="link" onClick={() => onSelect(entry)}>
                <code>{entry}</code>
              </button>
              {flow.inputs ? (
                <>
                  <p class="label">Needs these inputs to run</p>
                  <Fields fields={flow.inputs[entry]} empty="Nothing: it can run with no input." />
                </>
              ) : (
                <p class="none">Inputs are shown when a tools file is read.</p>
              )}
            </div>
          ))}
          {graph.groups.length > 0 && (
            <>
              <h3>Repeats</h3>
              <ul class="plain">
                {graph.groups.map((g) => (
                  <li key={g.id}>
                    <code>{g.id}</code> runs once for each <code>{g.item ?? 'item'}</code> in <code>{g.list ?? 'a list'}</code>
                  </li>
                ))}
              </ul>
            </>
          )}
          {!mapped && (
            <>
              <p class="callout">Steps in this picture cannot be clicked. Pick one here instead.</p>
              <ul class="plain picks">
                {graph.nodes.filter((n) => n.kind !== 'marker').map((n) => (
                  <li key={n.id}>
                    <button type="button" class="link" onClick={() => onSelect(n.id)}>
                      <code>{n.id}</code>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}

function NodeDetails({ flow, node, onClose }: { flow: FlowView; node: FlowNode; onClose: () => void }) {
  const out = flow.graph!.edges.filter((e) => e.from === node.id);
  const problems = flow.diagnostics.filter((d) => d.line === node.line && d.line > 0);
  const bound = node.reads !== undefined;
  return (
    <div class="details">
      <div class="details-head">
        <div>
          <KindBadge kind={node.kind} />
          <h2><code>{node.id}</code></h2>
        </div>
        <button type="button" class="icon-button" onClick={onClose} aria-label="Close details" title="Close">×</button>
      </div>
      {node.label && node.kind !== 'decision' && <p class="node-label">{node.label}</p>}
      {node.description && <p class="hint">{node.description}</p>}
      <dl class="facts">
        {node.ref && node.ref !== node.id && (<><dt>Runs</dt><dd><code>{node.ref}</code></dd></>)}
        {node.condition && (<><dt>Condition</dt><dd><code>{node.condition}</code></dd></>)}
        {node.entry && (<><dt>Entry</dt><dd>A run can start here</dd></>)}
        {node.group && (<><dt>Inside</dt><dd>for-each block <code>{node.group}</code></dd></>)}
        <dt>Line</dt><dd>{node.line}</dd>
      </dl>
      {problems.map((d, i) => (
        <p key={i} class={`callout ${d.severity === 'error' ? 'bad' : 'warn'}`}><Rich text={d.message} /></p>
      ))}
      {node.kind !== 'marker' && (
        <>
          <h3>Reads</h3>
          {bound ? <Fields fields={node.reads} empty="Nothing." /> : <p class="none">Shown when a tools file is read.</p>}
          {node.kind !== 'decision' && (
            <>
              <h3>Writes</h3>
              {bound ? <Fields fields={node.writes} empty="Nothing." /> : <p class="none">Shown when a tools file is read.</p>}
            </>
          )}
        </>
      )}
      <h3>Then</h3>
      {out.length === 0 ? (
        <p class="none">The flow ends here.</p>
      ) : (
        <>
          {out.length > 1 && <p class="label">{node.branching === 'parallel' ? 'Runs all of these at the same time' : 'Follows one of these'}</p>}
          <ul class="plain">
            {out.map((e) => (
              <li key={e.id}>
                {e.label && <span class="edge-label">{e.label}</span>} → <code>{e.to}</code>
                {e.max !== undefined && <span class="field-opt">at most {e.max} time{e.max === 1 ? '' : 's'}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Steps({ flow, onPick }: { flow: FlowView; onPick: (id: string) => void }) {
  if (!flow.graph) return <p class="empty">The diagram has errors, so its steps cannot be listed.</p>;
  const names = (fields: Record<string, Field> | undefined) => {
    const keys = Object.keys(fields ?? {});
    return keys.length ? keys.map((k) => <code key={k} class={fields![k]!.required ? '' : 'optional'}>{k}{fields![k]!.required ? '' : '?'}</code>) : <span class="none">–</span>;
  };
  return (
    <div class="table-wrap">
      <table class="steps">
        <thead>
          <tr><th>Step</th><th>Kind</th><th>Reads</th><th>Writes</th><th class="num">Line</th></tr>
        </thead>
        <tbody>
          {[...flow.graph.nodes].sort((a, b) => a.line - b.line || a.column - b.column).map((n) => (
            <tr key={n.id}>
              <td>
                <button type="button" class="link" onClick={() => onPick(n.id)}><code>{n.id}</code></button>
                {n.label && <span class="step-label">{n.kind === 'decision' ? n.condition : n.label}</span>}
              </td>
              <td><KindBadge kind={n.kind} /></td>
              <td class="chips">{n.reads ? names(n.reads) : <span class="none">–</span>}</td>
              <td class="chips">{n.writes ? names(n.writes) : <span class="none">–</span>}</td>
              <td class="num">{n.line}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Problems({ flow, onLine }: { flow: FlowView; onLine: (line: number) => void }) {
  const list: ViewDiagnostic[] = flow.diagnostics;
  if (list.length === 0 && !flow.toolsError) {
    return (
      <div class="notice small">
        <h1>No problems found</h1>
        <p>{flow.toolsFile ? 'The diagram and its steps fit together.' : 'The diagram is valid. Its steps were not checked because no tools file was read.'}</p>
      </div>
    );
  }
  return (
    <ul class="problems">
      {flow.toolsError && (
        <li class="bad">
          <span class="sev">Error</span>
          <div><p>The tools file could not be read: {flow.toolsError}</p></div>
        </li>
      )}
      {list.map((d, i) => (
        <li key={i} class={d.severity === 'error' ? 'bad' : 'warn'}>
          <span class="sev">{d.severity === 'error' ? 'Error' : 'Warning'}</span>
          <div>
            <p><Rich text={d.message} /></p>
            {d.hint && <p class="fix"><strong>Fix:</strong> <Rich text={d.hint} /></p>}
            <p class="where">
              <code>{d.code}</code>
              {d.line > 0 && <button type="button" class="link" onClick={() => onLine(d.line)}>line {d.line}</button>}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Source({ flow, focus }: { flow: FlowView; focus: number | undefined }) {
  const host = useRef<HTMLOListElement>(null);
  const lines = flow.diagram.source.replace(/\n$/, '').split('\n');
  const byLine = new Map<number, ViewDiagnostic[]>();
  for (const d of flow.diagnostics) if (d.line > 0) byLine.set(d.line, [...(byLine.get(d.line) ?? []), d]);
  useEffect(() => {
    if (focus) host.current?.querySelector(`[data-line="${focus}"]`)?.scrollIntoView({ block: 'center' });
  }, [focus, flow.id]);
  return (
    <ol class="source" ref={host}>
      {lines.map((text, i) => {
        const found = byLine.get(i + 1);
        const worst = found?.some((d) => d.severity === 'error') ? 'bad' : found ? 'warn' : '';
        return (
          <li key={i} data-line={i + 1} class={`${worst} ${focus === i + 1 ? 'focus' : ''}`}>
            <code>{text || ' '}</code>
            {found?.map((d, j) => <span key={j} class="inline-problem"><Rich text={d.message} /></span>)}
          </li>
        );
      })}
    </ol>
  );
}

render(<App client={httpClient(readConfig().apiBase)} />, document.getElementById('app')!);
