import type { Partition } from "./projectStore.ts";
import type { ProjectInventoryPage } from "./nativeWeb.ts";
import {
  deliverSelectorProposal,
  reconcileSelectorProposal,
  runSelectorCycle,
  type SelectorCycleIdentity,
  type SelectorObservationSource,
  type SelectorOperationSource,
  type SelectorPolicyHost,
  type SelectorProjectState,
  type SelectorProposal,
  type SelectorRuntimeSettingsSource,
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
  ): Promise<ProjectInventoryPage>;
  acquireDecisionPermit(
    partition: Partition,
    limits: {
      readonly concurrentDecisions: number;
      readonly selectionsPerMinute: number;
    },
  ): Promise<string | undefined>;
  releaseDecisionPermit(permit: string): Promise<void>;
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
  return {
    partition,
    notificationCursor: 0,
    revision: 0,
    attention: "Monitoring",
    workingMemory: {},
  };
}

async function observeProjects(
  projects: readonly Partition[],
  store: SelectorStateStore,
  source: SelectorRuntimeSource,
  policy: SelectorPolicyHost,
  identities: SelectorIdentityFactory,
  control: SelectorRuntimeSettingsSource,
): Promise<{
  readonly scanned: number;
  readonly observed: number;
  readonly proposed: number;
}> {
  let proposed = 0;
  let observed = 0;
  let scanned = 0;
  for (const partition of projects) {
    const settings = await control.settings();
    if (settings.mode === "Paused") break;
    const permit = await source.acquireDecisionPermit(partition, {
      concurrentDecisions: settings.limits.concurrentDecisions,
      selectionsPerMinute: settings.limits.selectionsPerMinute,
    });
    if (permit === undefined) {
      scanned += 1;
      continue;
    }
    let proposal: SelectorProposal | undefined;
    let completed = false;
    try {
      const confirmedSettings = await control.settings();
      if (
        confirmedSettings.mode === "Paused" ||
        confirmedSettings.revision !== settings.revision
      )
        break;
      const state = (await store.project(partition)) ?? initialState(partition);
      proposal = await runSelectorCycle(
        state,
        source,
        store,
        policy,
        identities.next(partition),
        confirmedSettings,
      );
      completed = true;
    } catch {
      proposal = undefined;
    } finally {
      await source.releaseDecisionPermit(permit).catch(() => undefined);
    }
    scanned += 1;
    if (completed) observed += 1;
    if (proposal !== undefined) proposed += 1;
  }
  return { scanned, observed, proposed };
}

/** Performs one bounded poll, policy, delivery, and reconciliation quantum. */
export async function selectorRunOnce(
  store: SelectorStateStore,
  source: SelectorRuntimeSource,
  policy: SelectorPolicyHost,
  identities: SelectorIdentityFactory,
  control: SelectorRuntimeSettingsSource,
  config: SelectorRuntimeConfig = selectorRuntimeDefaults,
): Promise<SelectorRunResult> {
  const projectsMax = checkedBound(
    config.projectsMax,
    "selector project bound",
  );
  let observed = 0;
  let proposed = 0;
  try {
    const initialSettings = await control.settings();
    const inventoryCursor = await store.inventoryCursor();
    const inventory =
      initialSettings.mode === "Paused"
        ? { projects: [] }
        : await source.projects(inventoryCursor, projectsMax);
    const projects = inventory.projects;
    const progress = await observeProjects(
      projects,
      store,
      source,
      policy,
      identities,
      control,
    );
    observed = progress.observed;
    proposed = progress.proposed;
    if (progress.scanned > 0 || inventory.nextAfter !== undefined)
      await store.saveInventoryCursor(
        progress.scanned === projects.length
          ? inventory.nextAfter
          : projects.at(progress.scanned - 1),
      );
  } catch {
    /** A later quantum retries project inventory and observation from durable state. */
  }
  let delivered = 0;
  try {
    for (const delivery of await store.pending(
      checkedBound(config.deliveriesMax, "selector delivery bound"),
    )) {
      if (
        (await deliverSelectorProposal(store, source, delivery)).result ===
        "Delivered"
      )
        delivered += 1;
    }
  } catch {
    /** Delivery claims become eligible for retry without changing proposal intent. */
  }
  let reconciled = 0;
  try {
    for (const delivery of await store.submittedDeliveries(
      checkedBound(config.reconciliationsMax, "selector reconciliation bound"),
    )) {
      try {
        if (await reconcileSelectorProposal(store, source, delivery))
          reconciled += 1;
      } catch {
        /** The reconciliation claim's retry time bounds the next attempt. */
      }
    }
  } catch {
    /** Claim acquisition is retried by a later runtime quantum. */
  }
  return { observed, proposed, delivered, reconciled };
}
