import type { Partition } from "./projectStore.ts";
import {
  deliverSelectorProposal,
  reconcileSelectorProposal,
  runSelectorCycle,
  type SelectorCycleIdentity,
  type SelectorObservationSource,
  type SelectorOperationSource,
  type SelectorPolicy,
  type SelectorProjectState,
  type SelectorStateStore,
  type SelectorTicketService,
} from "./selector.ts";

export interface SelectorRuntimeSource
  extends
    SelectorObservationSource,
    SelectorOperationSource,
    SelectorTicketService {
  projects(
    after: Partition | undefined,
    limit: number,
  ): Promise<readonly Partition[]>;
}

export interface SelectorIdentityFactory {
  next(partition: Partition): SelectorCycleIdentity;
}

export interface SelectorRunResult {
  readonly observed: number;
  readonly proposed: number;
  readonly delivered: number;
  readonly reconciled: number;
}

export interface SelectorRuntimeConfig {
  readonly projectsMax: number;
  readonly deliveriesMax: number;
  readonly reconciliationsMax: number;
}

export const selectorRuntimeDefaults: SelectorRuntimeConfig = {
  projectsMax: 100,
  deliveriesMax: 100,
  reconciliationsMax: 100,
};

function checkedBound(value: number, what: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100)
    throw new RangeError(`${what} must be between 1 and 100`);
  return value;
}

function initialState(partition: Partition): SelectorProjectState {
  return { partition, notificationCursor: 0, attention: "Monitoring" };
}

/** Performs one bounded poll, policy, delivery, and reconciliation quantum. */
export async function selectorRunOnce(
  store: SelectorStateStore,
  source: SelectorRuntimeSource,
  policy: SelectorPolicy,
  identities: SelectorIdentityFactory,
  config: SelectorRuntimeConfig = selectorRuntimeDefaults,
): Promise<SelectorRunResult> {
  const projectsMax = checkedBound(
    config.projectsMax,
    "selector project bound",
  );
  const inventoryCursor = await store.inventoryCursor();
  const projects = await source.projects(inventoryCursor, projectsMax);
  await store.saveInventoryCursor(
    projects.length < projectsMax ? undefined : projects.at(-1),
  );
  let proposed = 0;
  for (const partition of projects) {
    const state = (await store.project(partition)) ?? initialState(partition);
    const proposal = await runSelectorCycle(
      state,
      source,
      store,
      policy,
      identities.next(partition),
    );
    if (proposal !== undefined) proposed += 1;
  }
  let delivered = 0;
  for (const delivery of await store.pending(
    checkedBound(config.deliveriesMax, "selector delivery bound"),
  )) {
    if (
      (await deliverSelectorProposal(store, source, delivery)).result ===
      "Delivered"
    )
      delivered += 1;
  }
  let reconciled = 0;
  for (const delivery of await store.submittedDeliveries(
    checkedBound(config.reconciliationsMax, "selector reconciliation bound"),
  )) {
    if (await reconcileSelectorProposal(store, source, delivery))
      reconciled += 1;
  }
  return { observed: projects.length, proposed, delivered, reconciled };
}
