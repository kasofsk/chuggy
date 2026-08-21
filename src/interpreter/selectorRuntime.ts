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
  readonly failures: readonly SelectorRunFailure[];
}

export interface SelectorRunFailure {
  readonly phase:
    | "Inventory"
    | "Observation"
    | "PermitRelease"
    | "DeliveryClaim"
    | "Delivery"
    | "ReconciliationClaim"
    | "Reconciliation";
  readonly partition?: Partition;
  readonly decision?: string;
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
  readonly failures: readonly SelectorRunFailure[];
}> {
  let proposed = 0;
  let observed = 0;
  let scanned = 0;
  const failures: SelectorRunFailure[] = [];
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
      failures.push({ phase: "Observation", partition });
    } finally {
      await source.releaseDecisionPermit(permit).catch(() => {
        failures.push({ phase: "PermitRelease", partition });
      });
    }
    scanned += 1;
    if (completed) observed += 1;
    if (proposal !== undefined) proposed += 1;
  }
  return { scanned, observed, proposed, failures };
}

async function deliverPending(
  store: SelectorStateStore,
  source: SelectorRuntimeSource,
  limit: number,
): Promise<{ delivered: number; failures: readonly SelectorRunFailure[] }> {
  let delivered = 0;
  const failures: SelectorRunFailure[] = [];
  try {
    for (const delivery of await store.pending(limit)) {
      if (
        (await deliverSelectorProposal(store, source, delivery)).result ===
        "Delivered"
      )
        delivered += 1;
      else
        failures.push({
          phase: "Delivery",
          partition: delivery.partition,
          decision: delivery.decision,
        });
    }
  } catch {
    failures.push({ phase: "DeliveryClaim" });
  }
  return { delivered, failures };
}

async function reconcileSubmitted(
  store: SelectorStateStore,
  source: SelectorRuntimeSource,
  limit: number,
): Promise<{ reconciled: number; failures: readonly SelectorRunFailure[] }> {
  let reconciled = 0;
  const failures: SelectorRunFailure[] = [];
  try {
    for (const delivery of await store.submittedDeliveries(limit)) {
      try {
        if (await reconcileSelectorProposal(store, source, delivery))
          reconciled += 1;
      } catch {
        failures.push({
          phase: "Reconciliation",
          partition: delivery.partition,
          decision: delivery.decision,
        });
      }
    }
  } catch {
    failures.push({ phase: "ReconciliationClaim" });
  }
  return { reconciled, failures };
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
  const failures: SelectorRunFailure[] = [];
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
    failures.push(...progress.failures);
    if (progress.scanned > 0 || inventory.nextAfter !== undefined)
      await store.saveInventoryCursor(
        progress.scanned === projects.length
          ? inventory.nextAfter
          : projects.at(progress.scanned - 1),
      );
  } catch {
    failures.push({ phase: "Inventory" });
  }
  const delivery = await deliverPending(
    store,
    source,
    checkedBound(config.deliveriesMax, "selector delivery bound"),
  );
  failures.push(...delivery.failures);
  const reconciliation = await reconcileSubmitted(
    store,
    source,
    checkedBound(config.reconciliationsMax, "selector reconciliation bound"),
  );
  failures.push(...reconciliation.failures);
  return {
    observed,
    proposed,
    delivered: delivery.delivered,
    reconciled: reconciliation.reconciled,
    failures,
  };
}
