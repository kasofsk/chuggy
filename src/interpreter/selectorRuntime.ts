import type { Partition } from "./projectStore.ts";
import type { ProjectInventoryPage } from "./nativeWeb.ts";
import {
  leadInputBytesMax,
  observeSelectorProject,
  runObservedSelectorCycle,
  type SelectorChangeTrigger,
  type SelectorRefusalLedger,
  type SelectorCycleIdentity,
  selectorNotificationPageLimit,
  type SelectorObservation,
  type SelectorObservationSource,
  type SelectorOperationSource,
  type SelectorPolicyHost,
  selectorProjectMoved,
  type SelectorProjectState,
  type SelectorProposedDecision,
  selectorSettingsFence,
  selectorSettingsFenceHolds,
  type SelectorResolvedSettings,
  type SelectorRuntimeSettingsSource,
  type SelectorStateStore,
  type SelectorTicketService,
  unwrittenDispatches,
} from "./selector.ts";
import {
  reconcileSelectorAttempts,
  settleFailedSelectorAttempt,
} from "./selectorAttemptRuntime.ts";
import {
  deliverPendingSelectorProposals,
  reconcileSubmittedSelectorProposals,
} from "./selectorDeliveryRuntime.ts";
import type {
  SelectorHostedRunsPhase,
  SelectorRunFailure,
} from "./selectorRuntimeTypes.ts";
export type {
  SelectorHostedRunsPhase,
  SelectorRunFailure,
} from "./selectorRuntimeTypes.ts";

export interface SelectorRuntimeSource
  extends
    SelectorChangeTrigger,
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

/**
 * One quantum's account. `proposed` counts the decisions this run retained
 * that named a dispatch and `dispatched` the delivery rows they left, so one
 * decision with three dispatches reads differently from three decisions with
 * one — and a decision the relation retained but took no row of reads as one
 * proposal and no dispatch, which is what its failures are about.
 */
export interface SelectorRunResult {
  /** The projects the sweep reached, whether it served them, passed them over or failed on them. */
  readonly reached: readonly Partition[];
  readonly observed: number;
  readonly proposed: number;
  readonly dispatched: number;
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
    handoffNote: {},
    candidateScan: { state: "Unstarted" },
  };
}

async function observeProjects(
  projects: readonly Partition[],
  refusals: SelectorRefusalLedger,
  store: SelectorStateStore,
  source: SelectorRuntimeSource,
  policy: SelectorPolicyHost,
  identities: SelectorIdentityFactory,
  control: SelectorRuntimeSettingsSource,
): Promise<{
  readonly reached: readonly Partition[];
  readonly observed: number;
  readonly proposed: number;
  readonly dispatched: number;
  readonly failures: readonly SelectorRunFailure[];
}> {
  let proposed = 0;
  let dispatched = 0;
  let observed = 0;
  const reached: Partition[] = [];
  const failures: SelectorRunFailure[] = [];
  for (const partition of projects) {
    const result = await observeProject(
      partition,
      refusals,
      store,
      source,
      policy,
      identities,
      control,
    );
    failures.push(...result.failures);
    if (result.stop) break;
    reached.push(partition);
    if (result.observed) observed += 1;
    if (result.proposed) proposed += 1;
    dispatched += result.dispatched;
  }
  return { reached, observed, proposed, dispatched, failures };
}

interface ProjectObservationResult {
  readonly stop: boolean;
  readonly observed: boolean;
  /** Whether this project's turn left a decision in the relation for the writer to answer. */
  readonly proposed: boolean;
  /** The delivery rows this project's decision left, which a decision that proposed nothing makes zero. */
  readonly dispatched: number;
  readonly failures: readonly SelectorRunFailure[];
}

/**
 * Runs one swept project, taking its permit only once the observation the
 * decision would stand on exists — a change log that moved is not by itself
 * something to decide about, and the notification cursor is saved by a
 * completed cycle alone, so allocating on the trigger charges a decision
 * reference, a `selector_interaction` row and a selections-per-minute slot to
 * every pass of a project whose changes leave the dispatch view where it was.
 * A project with nothing to decide therefore costs its bounded reads and
 * nothing else — no permit, no decision reference, no turn and no quota — and
 * the sweep still counts it as scanned, so discovery goes on.
 */
async function observeProject(
  partition: Partition,
  refusals: SelectorRefusalLedger,
  store: SelectorStateStore,
  source: SelectorRuntimeSource,
  policy: SelectorPolicyHost,
  identities: SelectorIdentityFactory,
  control: SelectorRuntimeSettingsSource,
): Promise<ProjectObservationResult> {
  let settings: SelectorResolvedSettings;
  try {
    settings = await control.projectSettings(partition);
  } catch {
    return projectObservationFailure("Settings", partition);
  }
  if (settings.installationMode === "Paused") return stoppedProjectObservation;
  if (settings.mode === "Paused") return emptyProjectObservation;
  let state: SelectorProjectState;
  let observation: SelectorObservation | undefined;
  try {
    state = (await store.project(partition)) ?? initialState(partition);
    observation = await projectObservation(state, refusals, source, settings);
  } catch {
    return projectObservationFailure("Observation", partition);
  }
  if (observation === undefined) return emptyProjectObservation;
  const passedOver = await observeProjectHostedRuns(partition, policy);
  if (passedOver !== undefined) return passedOver;
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
    state,
    observation,
    refusals,
    store,
    source,
    policy,
    identity,
    control,
  );
}

/**
 * Why a project with something to decide is passed over before its permit, or
 * nothing where its tenant grants the policy's principal the hosted runs every
 * turn spends: a refusal, or an authority that could not say. Neither is kept,
 * because the notification cursor moves only with a completed cycle, so the next
 * pass that reaches the project asks again and finds its changes waiting.
 */
async function observeProjectHostedRuns(
  partition: Partition,
  policy: SelectorPolicyHost,
): Promise<ProjectObservationResult | undefined> {
  let granted: boolean;
  try {
    granted = await policy.hostedRunsGranted(partition);
  } catch {
    return projectObservationFailure("HostedRunsUndecided", partition);
  }
  return granted
    ? undefined
    : projectObservationFailure("HostedRunsNotGranted", partition);
}

/**
 * What this project has to decide about, or nothing. The notification page is
 * read once and handed to the observation, so a row cannot arrive between two
 * reads and be counted as the trigger for a window that does not contain it.
 */
async function projectObservation(
  state: SelectorProjectState,
  refusals: SelectorRefusalLedger,
  source: SelectorRuntimeSource,
  settings: SelectorResolvedSettings,
): Promise<SelectorObservation | undefined> {
  const changes = await source.moved(
    state.partition,
    state.notificationCursor,
    selectorNotificationPageLimit,
  );
  if (!selectorProjectMoved(state, changes)) return undefined;
  return observeSelectorProject(
    state,
    source,
    refusals,
    changes,
    selectorNotificationPageLimit,
    Math.floor(leadInputBytesMax(settings) / 2),
  );
}

const emptyProjectObservation: ProjectObservationResult = {
  stop: false,
  observed: false,
  proposed: false,
  dispatched: 0,
  failures: [],
};
const stoppedProjectObservation = { ...emptyProjectObservation, stop: true };

function projectObservationFailure(
  phase: SelectorRunFailure["phase"],
  partition: Partition,
): ProjectObservationResult {
  return { ...emptyProjectObservation, failures: [{ phase, partition }] };
}

/**
 * Runs one decision under settings the fence has just been re-read against, on
 * the state and the observation the trigger already built. Neither is read
 * again: the observation the permit was taken for is the one the decision
 * stands on, and re-reading it would let the view move between the two.
 */
async function observeFencedProject(
  settings: SelectorResolvedSettings,
  state: SelectorProjectState,
  observation: SelectorObservation,
  refusals: SelectorRefusalLedger,
  store: SelectorStateStore,
  source: SelectorRuntimeSource,
  policy: SelectorPolicyHost,
  identity: SelectorCycleIdentity,
): Promise<SelectorProposedDecision | undefined> {
  await store.runningAttempt(
    identity.selectorDecisionReference,
    observation,
    selectorSettingsFence(settings),
  );
  return runObservedSelectorCycle(
    state,
    observation,
    source,
    refusals,
    store,
    policy,
    identity,
    settings,
  );
}

/**
 * Runs one permitted decision, re-reading the settings the permit was taken
 * under. Only an installation pause stops the sweep: a project's own pause and
 * either half of the fence moving are that project's events, so the attempt is
 * terminated and the sweep goes on to the next project.
 */
async function observePermittedProject(
  partition: Partition,
  expectedSettings: SelectorResolvedSettings,
  state: SelectorProjectState,
  observation: SelectorObservation,
  refusals: SelectorRefusalLedger,
  store: SelectorStateStore,
  source: SelectorRuntimeSource,
  policy: SelectorPolicyHost,
  identity: SelectorCycleIdentity,
  control: SelectorRuntimeSettingsSource,
): Promise<ProjectObservationResult> {
  const failures: SelectorRunFailure[] = [];
  let proposal: SelectorProposedDecision | undefined;
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
      stop = settings.installationMode === "Paused";
      await store.terminateAttempt(
        identity.selectorDecisionReference,
        "settings changed before policy execution",
      );
    } else {
      proposal = await observeFencedProject(
        settings,
        state,
        observation,
        refusals,
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
  if (proposal !== undefined)
    for (const ticket of unwrittenDispatches(proposal))
      failures.push({
        phase: "Record",
        partition,
        decision: proposal.proposals.interaction.decision,
        ticket,
      });
  return {
    stop,
    observed,
    proposed: proposal !== undefined,
    dispatched: proposal?.dispatched.length ?? 0,
    failures,
  };
}

async function observeInventory(
  refusals: SelectorRefusalLedger,
  store: SelectorStateStore,
  source: SelectorRuntimeSource,
  policy: SelectorPolicyHost,
  identities: SelectorIdentityFactory,
  control: SelectorRuntimeSettingsSource,
  projectsMax: number,
): Promise<{
  readonly reached: readonly Partition[];
  readonly observed: number;
  readonly proposed: number;
  readonly dispatched: number;
  readonly failures: readonly SelectorRunFailure[];
}> {
  await store.setAutomaticReadiness(policy.productionReady);
  if ((await control.settings()).mode === "Paused") return pausedInventory;
  const inventory = await source.projects(
    await store.inventoryCursor(),
    projectsMax,
  );
  const progress = await observeProjects(
    inventory.projects,
    refusals,
    store,
    source,
    policy,
    identities,
    control,
  );
  await saveInventoryProgress(store, inventory, progress.reached.length);
  return progress;
}

/** A paused installation reads no inventory, so it has no progress to record. */
const pausedInventory = {
  reached: [],
  observed: 0,
  proposed: 0,
  dispatched: 0,
  failures: [],
} as const;

/**
 * Moves the cursor over the projects this sweep consumed and no further: to the
 * last one it consumed, or past the page when it consumed them all — which is
 * `nextAfter`, and `nextAfter` is absent exactly when there is no next page, so
 * an exhausted inventory wraps to the start rather than standing still, while a
 * sweep that consumed none of a page it was given leaves the cursor alone
 * because that page is the page the next sweep is owed. Every one of those
 * readings is of a page the inventory produced, so only a caller that read one
 * calls this.
 */
async function saveInventoryProgress(
  store: SelectorStateStore,
  inventory: ProjectInventoryPage,
  scanned: number,
): Promise<void> {
  if (scanned === 0 && inventory.projects.length > 0) return;
  await store.saveInventoryCursor(
    scanned === inventory.projects.length
      ? inventory.nextAfter
      : inventory.projects.at(scanned - 1),
  );
}

/** Performs one bounded poll, policy, delivery, and reconciliation quantum. */
export async function selectorRunOnce(
  refusals: SelectorRefusalLedger,
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
  let reached: readonly Partition[] = [];
  let observed = 0;
  let proposed = 0;
  let dispatched = 0;
  const failures: SelectorRunFailure[] = [];
  try {
    const progress = await observeInventory(
      refusals,
      store,
      source,
      policy,
      identities,
      control,
      projectsMax,
    );
    reached = progress.reached;
    observed = progress.observed;
    proposed = progress.proposed;
    dispatched = progress.dispatched;
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
    reached,
    observed,
    proposed,
    dispatched,
    delivered: delivery.delivered,
    reconciled: reconciliation.reconciled,
    failures,
  };
}

/** One project a run passed over for want of hosted runs, and which answer stopped it. */
export interface SelectorHostedRunsSkip {
  readonly partition: Partition;
  readonly phase: SelectorHostedRunsPhase;
}

/** What has been reported of each skipped project, keyed by `selectorHostedRunsChangesKey`. */
export type SelectorHostedRunsReported = ReadonlyMap<
  string,
  SelectorHostedRunsPhase
>;

/** A partition as one key, its two halves kept apart so no pair reads as another. */
function selectorHostedRunsChangesKey(partition: Partition): string {
  return JSON.stringify([partition.tenant, partition.project]);
}

/**
 * The hosted-runs skips a run names that were not already reported under the
 * same phase, and what stands reported after it. A project the run reached and
 * did not skip is forgotten, so one passed over on every pass that reaches it is
 * reported once, and again only after one that served it or named the other
 * phase.
 */
export function selectorHostedRunsChanges(
  reported: SelectorHostedRunsReported,
  run: Pick<SelectorRunResult, "reached" | "failures">,
): {
  readonly changed: readonly SelectorHostedRunsSkip[];
  readonly reported: SelectorHostedRunsReported;
} {
  const standing = new Map(reported);
  for (const partition of run.reached)
    standing.delete(selectorHostedRunsChangesKey(partition));
  const changed: SelectorHostedRunsSkip[] = [];
  for (const { phase, partition } of run.failures) {
    if (phase !== "HostedRunsNotGranted" && phase !== "HostedRunsUndecided")
      continue;
    if (partition === undefined) continue;
    const key = selectorHostedRunsChangesKey(partition);
    if (reported.get(key) !== phase) changed.push({ partition, phase });
    standing.set(key, phase);
  }
  return { changed, reported: standing };
}
