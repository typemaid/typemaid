import type { FlowList, FlowView, Meta, ViewerEvent } from './contract.ts';

/**
 * Where a viewer gets its data. The HTTP handler knows only this interface, so the same
 * handler and UI work over local files today and over any other backend later.
 */
export interface ViewerSource {
  meta(): Promise<Meta>;
  listFlows(): Promise<FlowList>;
  getFlow(id: string): Promise<FlowView | undefined>;
  /** Calls `listener` when something changes. Returns a function that stops it. */
  subscribe?(listener: (event: ViewerEvent) => void): () => void;
  close?(): Promise<void>;
}
