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
  readonly failures: readonly SelectorRunFailure[];
}

export type SelectorRunFailure =
  | {
      readonly phase: "Delivery" | "Reconciliation";
      readonly decision: string;
      readonly error: unknown;
    }
  | {
      readonly phase: "Observation";
      readonly partition: Partition;
      readonly error: unknown;
    };

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

function nextInventoryCursor(
  previous: Partition | undefined,
  projects: readonly Partition[],
  limit: number,
  failures: readonly SelectorRunFailure[],
): Partition | undefined {
  const failed = failures.find((failure) => failure.phase === "Observation");
  if (failed !== undefined) {
    const index = projects.findIndex(
      (partition) =>
        partition.tenant === failed.partition.tenant &&
        partition.project === failed.partition.project,
    );
    if (index === 0) return previous;
    if (index > 0) return projects[index - 1];
  }
  return projects.length < limit ? undefined : projects.at(-1);
}

async function deliverPending(
  store: SelectorStateStore,
  source: SelectorRuntimeSource,
  limit: number,
  failures: SelectorRunFailure[],
): Promise<number> {
  let delivered = 0;
  for (const delivery of await store.pending(limit)) {
    try {
      if (
        (await deliverSelectorProposal(store, source, delivery)).result ===
        "Delivered"
      )
        delivered += 1;
    } catch (error) {
      failures.push({ phase: "Delivery", decision: delivery.decision, error });
    }
  }
  return delivered;
}

async function reconcileSubmitted(
  store: SelectorStateStore,
  source: SelectorRuntimeSource,
  limit: number,
  failures: SelectorRunFailure[],
): Promise<number> {
  let reconciled = 0;
  for (const delivery of await store.submittedDeliveries(limit)) {
    try {
      if (await reconcileSelectorProposal(store, source, delivery))
        reconciled += 1;
    } catch (error) {
      failures.push({
        phase: "Reconciliation",
        decision: delivery.decision,
        error,
      });
    }
  }
  return reconciled;
}

async function observeProjects(
  store: SelectorStateStore,
  source: SelectorRuntimeSource,
  policy: SelectorPolicy,
  identities: SelectorIdentityFactory,
  projects: readonly Partition[],
  failures: SelectorRunFailure[],
): Promise<number> {
  let proposed = 0;
  for (const partition of projects) {
    try {
      const state = (await store.project(partition)) ?? initialState(partition);
      const proposal = await runSelectorCycle(
        state,
        source,
        store,
        policy,
        identities.next(partition),
      );
      if (proposal !== undefined) proposed += 1;
    } catch (error) {
      failures.push({ phase: "Observation", partition, error });
    }
  }
  return proposed;
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
  const deliveriesMax = checkedBound(
    config.deliveriesMax,
    "selector delivery bound",
  );
  const reconciliationsMax = checkedBound(
    config.reconciliationsMax,
    "selector reconciliation bound",
  );
  const failures: SelectorRunFailure[] = [];
  const delivered = await deliverPending(
    store,
    source,
    deliveriesMax,
    failures,
  );
  const reconciled = await reconcileSubmitted(
    store,
    source,
    reconciliationsMax,
    failures,
  );
  const inventoryCursor = await store.inventoryCursor();
  const projects = await source.projects(inventoryCursor, projectsMax);
  const failuresBeforeObservation = failures.length;
  const proposed = await observeProjects(
    store,
    source,
    policy,
    identities,
    projects,
    failures,
  );
  await store.saveInventoryCursor(
    nextInventoryCursor(
      inventoryCursor,
      projects,
      projectsMax,
      failures.slice(failuresBeforeObservation),
    ),
  );
  return {
    observed: projects.length,
    proposed,
    delivered,
    reconciled,
    failures,
  };
}
