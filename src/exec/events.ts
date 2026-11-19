export type RunEvent =
  | { type: 'run.start'; runId: string; entry: string }
  | { type: 'node.start'; runId: string; node: string; key: string }
  | { type: 'node.end'; runId: string; node: string; ms: number }
  | { type: 'node.retry'; runId: string; node: string; attempt: number; error: string }
  | { type: 'branch'; runId: string; node: string; taken: string }
  | { type: 'run.paused'; runId: string; node: string }
  | { type: 'run.end'; runId: string; status: 'completed' | 'paused' | 'failed' };

/**
 * The original diagram with the nodes of a run coloured in. The result is still plain Mermaid.
 */
export function runDiagram(
  source: string,
  run: { visits: Record<string, number>; waiting?: string[]; failed?: string },
): string {
  const done = Object.keys(run.visits).filter((id) => (run.visits[id] ?? 0) > 0 && id !== run.failed);
  const lines = [source.replace(/\s+$/, '')];
  lines.push('  classDef runDone fill:#d1fadf,stroke:#12b76a,color:#054f31');
  lines.push('  classDef runWaiting fill:#fef0c7,stroke:#f79009,color:#7a2e0e');
  lines.push('  classDef runFailed fill:#fee4e2,stroke:#f04438,color:#7a271a');
  if (done.length > 0) lines.push(`  class ${done.join(',')} runDone`);
  if (run.waiting && run.waiting.length > 0) lines.push(`  class ${run.waiting.join(',')} runWaiting`);
  if (run.failed) lines.push(`  class ${run.failed} runFailed`);
  return lines.join('\n') + '\n';
}
