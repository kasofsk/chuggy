import type { Partition } from "./projectStore.ts";
import type { ProjectInventoryPage } from "./nativeWeb.ts";
import {
  observeSelectorProject,
  runObservedSelectorCycle,
  type SelectorCycleIdentity,
  type SelectorObservationSource,
  type SelectorOperationSource,
  type SelectorPolicyHost,
  type SelectorProjectState,
  type SelectorProposal,
  selectorSettingsFence,
  selectorSettingsFenceHolds,
  type SelectorResolvedSettings,
  type SelectorRuntimeSettingsSource,
  type SelectorStateStore,
  type SelectorTicketService,
} from "./selector.ts";
import {
  reconcileSelectorAttempts,
  settleFailedSelectorAttempt,
} from "./selectorAttemptRuntime.ts";
import {
  deliverPendingSelectorProposals,
  reconcileSubmittedSelectorProposals,
} from "./selectorDeliveryRuntime.ts";
import type { SelectorRunFailure } from "./selectorRuntimeTypes.ts";
export type { SelectorRunFailure } from "./selectorRuntimeTypes.ts";

export interface SelectorRuntimeSource
  extends
    SelectorObservationSource,
    SelectorOperationSource,
    SelectorTicketService {
  projects(
    after: Partition | undefined,
    limit: number,
  ): Promise<ProjectInventoryPage>;
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
    candidateScan: { state: "Unstarted" },
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
    const result = await observeProject(
      partition,
      store,
      source,
      policy,
      identities,
      control,
    );
    failures.push(...result.failures);
    if (result.stop) break;
    scanned += 1;
    if (result.observed) observed += 1;
    if (result.proposed) proposed += 1;
  }
  return { scanned, observed, proposed, failures };
}

interface ProjectObservationResult {
  readonly stop: boolean;
  readonly observed: boolean;
  readonly proposed: boolean;
  readonly failures: readonly SelectorRunFailure[];
}

async function observeProject(
  partition: Partition,
  store: SelectorStateStore,
  source: SelectorRuntimeSource,
  policy: SelectorPolicyHost,
  identities: SelectorIdentityFactory,
  control: SelectorRuntimeSettingsSource,
): Promise<ProjectObservationResult> {
  let settings: SelectorResolvedSettings;
  try {
    if ((await control.settings()).mode === "Paused")
      return stoppedProjectObservation;
    settings = await control.projectSettings(partition);
  } catch {
    return projectObservationFailure("Settings", partition);
  }
  if (settings.mode === "Paused") return emptyProjectObservation;
  const identity = identities.next(partition);
  let allocated: boolean;
  try {
    allocated = await store.allocateAttempt(
      identity.selectorDecisionReference,
      partition,
      {
        concurrentDecisions: settings.limits.concurrentDecisions,
        selectionsPerMinute: settings.limits.selectionsPerMinute,
        millisecondsPerDecision: settings.limits.millisecondsPerDecision,
      },
    );
  } catch {
    return projectObservationFailure("PermitAcquisition", partition);
  }
  if (!allocated) return emptyProjectObservation;
  return observePermittedProject(
    partition,
    settings,
    store,
    source,
    policy,
    identity,
    control,
  );
}

const emptyProjectObservation: ProjectObservationResult = {
  stop: false,
  observed: false,
  proposed: false,
  failures: [],
};
const stoppedProjectObservation = { ...emptyProjectObservation, stop: true };

function projectObservationFailure(
  phase: SelectorRunFailure["phase"],
  partition: Partition,
): ProjectObservationResult {
  return { ...emptyProjectObservation, failures: [{ phase, partition }] };
}

/** Runs one decision under settings the fence has just been re-read against. */
async function observeFencedProject(
  partition: Partition,
  settings: SelectorResolvedSettings,
  store: SelectorStateStore,
  source: SelectorRuntimeSource,
  policy: SelectorPolicyHost,
  identity: SelectorCycleIdentity,
): Promise<SelectorProposal | undefined> {
  const state = (await store.project(partition)) ?? initialState(partition);
  const observation = await observeSelectorProject(
    state,
    source,
    100,
    Math.floor(settings.limits.inputBytesPerDecision / 2),
  );
  if (observation === undefined) {
    await store.terminateAttempt(
      identity.selectorDecisionReference,
      "no current observation",
    );
    return undefined;
  }
  await store.runningAttempt(
    identity.selectorDecisionReference,
    observation,
    selectorSettingsFence(settings),
  );
  return runObservedSelectorCycle(
    state,
    observation,
    source,
    store,
    policy,
    identity,
    settings,
  );
}

async function observePermittedProject(
  partition: Partition,
  expectedSettings: SelectorResolvedSettings,
  store: SelectorStateStore,
  source: SelectorRuntimeSource,
  policy: SelectorPolicyHost,
  identity: SelectorCycleIdentity,
  control: SelectorRuntimeSettingsSource,
): Promise<ProjectObservationResult> {
  const failures: SelectorRunFailure[] = [];
  let proposal: SelectorProposal | undefined;
  let observed = false;
  let stop = false;
  try {
    const settings = await control.projectSettings(partition);
    if (
      settings.mode === "Paused" ||
      !selectorSettingsFenceHolds(
        selectorSettingsFence(expectedSettings),
        settings,
      )
    ) {
      stop = true;
      await store.terminateAttempt(
        identity.selectorDecisionReference,
        "settings changed before policy execution",
      );
    } else {
      proposal = await observeFencedProject(
        partition,
        settings,
        store,
        source,
        policy,
        identity,
      );
      observed = true;
    }
  } catch (error) {
    failures.push({ phase: "Observation", partition });
    await settleFailedSelectorAttempt(
      store,
      identity,
      partition,
      error,
      failures,
    );
  }
  return { stop, observed, proposed: proposal !== undefined, failures };
}

async function observeInventory(
  store: SelectorStateStore,
  source: SelectorRuntimeSource,
  policy: SelectorPolicyHost,
  identities: SelectorIdentityFactory,
  control: SelectorRuntimeSettingsSource,
  projectsMax: number,
): Promise<{
  readonly observed: number;
  readonly proposed: number;
  readonly failures: readonly SelectorRunFailure[];
}> {
  await store.setAutomaticReadiness(policy.productionReady);
  const settings = await control.settings();
  const inventoryCursor = await store.inventoryCursor();
  const inventory =
    settings.mode === "Paused"
      ? { projects: [] }
      : await source.projects(inventoryCursor, projectsMax);
  const progress = await observeProjects(
    inventory.projects,
    store,
    source,
    policy,
    identities,
    control,
  );
  if (progress.scanned > 0 || inventory.nextAfter !== undefined)
    await store.saveInventoryCursor(
      progress.scanned === inventory.projects.length
        ? inventory.nextAfter
        : inventory.projects.at(progress.scanned - 1),
    );
  return progress;
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
    const progress = await observeInventory(
      store,
      source,
      policy,
      identities,
      control,
      projectsMax,
    );
    observed = progress.observed;
    proposed = progress.proposed;
    failures.push(...progress.failures);
  } catch {
    failures.push({ phase: "Inventory" });
  }
  const delivery = await deliverPendingSelectorProposals(
    store,
    source,
    checkedBound(config.deliveriesMax, "selector delivery bound"),
  );
  failures.push(...delivery.failures);
  const reconciliation = await reconcileSubmittedSelectorProposals(
    store,
    source,
    checkedBound(config.reconciliationsMax, "selector reconciliation bound"),
  );
  failures.push(...reconciliation.failures);
  try {
    await reconcileSelectorAttempts(store, policy);
  } catch {
    failures.push({ phase: "AttemptReconciliation" });
  }
  return {
    observed,
    proposed,
    delivered: delivery.delivered,
    reconciled: reconciliation.reconciled,
    failures,
  };
}
