/**
 * The viewer contract: the only thing a viewer UI knows about this package.
 *
 * Everything here is plain JSON. This file imports nothing, so a UI (ours, a hosted one, or
 * someone else's) can depend on it without depending on how the SDK works inside.
 *
 * Compatibility rule: adding optional fields keeps `schemaVersion`; removing or renaming a
 * field, or changing what one means, increases it. Ids are opaque: never parse them.
 */
export const VIEW_SCHEMA_VERSION = 1;

/** GET /api/v1/meta. A UI reads this first and refuses a schemaVersion it does not know. */
export interface Meta {
  schemaVersion: number;
  generator: { name: string; version: string };
  generatedAt: string;
  /** 'live' is a running server; 'static' is an exported snapshot. */
  mode: 'live' | 'static';
  capabilities: {
    /** The server sends `flows.changed` events when files change. */
    liveReload: boolean;
    /** Runs can be listed and opened. */
    runs: boolean;
    /** Run data values are included, not only their field names. */
    runData: boolean;
    /** Runs can be started, answered or cancelled from the UI. */
    actions: boolean;
  };
  /** Display name of what is being viewed. Never an absolute path. */
  rootName?: string;
}

export type FieldKind = 'string' | 'number' | 'boolean' | 'array' | 'object' | 'unknown';

export interface Field {
  kind: FieldKind;
  required: boolean;
  options?: string[];
}

export interface ViewDiagnostic {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  /** 1-based; 0 means the problem has no position in the diagram. */
  line: number;
  column: number;
  hint?: string;
}

/** GET /api/v1/flows */
export interface FlowList {
  /** Increases whenever any flow changes. */
  revision: number;
  flows: FlowSummary[];
}

export interface FlowSummary {
  /** Opaque and URL-safe. */
  id: string;
  /** Path for display, relative to the viewed root. */
  file: string;
  title: string;
  /** Changes when the diagram text changes. Absent when the diagram has errors. */
  version?: string;
  counts: { nodes: number; tools: number; agents: number; humans: number; decisions: number };
  errors: number;
  warnings: number;
  /** Display path of the tools file used; absent means only the diagram was read. */
  toolsFile?: string;
}

/** GET /api/v1/flows/{id} */
export interface FlowView extends FlowSummary {
  /** Mermaid text to draw. `exact` is false when it was regenerated rather than read from the author's file. */
  diagram: { source: string; exact: boolean };
  /** Absent when the diagram itself has errors. */
  graph?: FlowGraph;
  /** Fields that must be supplied to start a run, per entry node. Present only when tools were read. */
  inputs?: Record<string, Record<string, Field>>;
  diagnostics: ViewDiagnostic[];
  /** Why the tools file could not be read, if it could not. */
  toolsError?: string;
}

export interface FlowGraph {
  entries: string[];
  nodes: FlowNode[];
  edges: FlowEdge[];
  groups: FlowGroup[];
}

export type NodeKind = 'tool' | 'agent' | 'human' | 'decision' | 'marker' | 'foreach' | 'unbound';

export interface FlowNode {
  id: string;
  label?: string;
  /** 'unbound' is a step whose code was not read, so its type is not known. */
  kind: NodeKind;
  /** Name of the export this node runs. */
  ref?: string;
  description?: string;
  entry: boolean;
  /** Id of the group that contains the node. */
  group?: string;
  /** Decision text or function name. */
  condition?: string;
  /** How several outgoing arrows behave: all at once, or one of them. */
  branching?: 'parallel' | 'exclusive';
  line: number;
  column: number;
  reads?: Record<string, Field>;
  writes?: Record<string, Field>;
}

export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  /** Most times this arrow may be followed in one run. */
  max?: number;
  line: number;
}

export interface FlowGroup {
  id: string;
  kind: 'foreach';
  item?: string;
  list?: string;
  entry: string;
  line: number;
}

export type RunStatus = 'running' | 'paused' | 'completed' | 'failed';
export type NodeStatus = 'done' | 'active' | 'waiting' | 'failed';

/** GET /api/v1/runs. Served only when capabilities.runs is true. */
export interface RunList {
  runs: RunSummary[];
  nextCursor?: string;
}

export interface RunSummary {
  runId: string;
  flowId?: string;
  flowVersion: string;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  error?: { code: string; message: string; node?: string };
}

/** GET /api/v1/runs/{runId} */
export interface RunView extends RunSummary {
  diagram: { source: string; exact: boolean };
  graph: FlowGraph;
  /** Nodes that were never reached are absent. */
  nodes: Record<string, { status: NodeStatus; visits: number }>;
  edges: Record<string, { taken: number }>;
  waiting: Array<{ node: string }>;
  stepCount: number;
  /** Names and kinds of the run's data fields. Values are only in `data`. */
  dataKeys: Record<string, FieldKind>;
  data?: Record<string, unknown>;
}

/** A whole viewer state in one document, for a static export. */
export interface Snapshot {
  schemaVersion: number;
  meta: Meta;
  flows: FlowView[];
  runs: RunView[];
}

/** The body of every response that is not a success. */
export interface ApiError {
  error: { code: string; message: string };
}

/** GET /api/v1/events (Server-Sent Events). */
export type ViewerEvent = { type: 'flows.changed'; revision: number; ids: string[] } | { type: 'run.changed'; runId: string; status: RunStatus };
