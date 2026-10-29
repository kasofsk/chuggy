import { asOperationId } from "./operationInbox.ts";
import type { Partition } from "./projectStore.ts";
import type { LeadAdmission } from "./sessionPlacement.ts";
import type { ProjectInventoryPage } from "./nativeWeb.ts";
import {
  leadInputBytesMax,
  observeSelectorProjectPass,
  runObservedSelectorCycle,
  type SelectorChangeTrigger,
  type SelectorRefusalLedger,
  type SelectorCycleIdentity,
  selectorInitialState,
  selectorNotificationPageLimit,
  type SelectorObservation,
  type SelectorObservationSource,
  type SelectorOperationSource,
  type SelectorPolicyHost,
  selectorProjectMoved,
  type SelectorProjectPass,
  type SelectorProjectState,
  selectorQuietCycle,
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
  SelectorAdmissionPhase,
  SelectorIdentityFactory,
  SelectorRunFailure,
} from "./selectorRuntimeTypes.ts";
import {
  resumeSelectorDecisions,
  type SelectorResumptionProgress,
} from "./selectorResumption.ts";
export type {
  SelectorAdmissionPhase,
  SelectorIdentityFactory,
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

const selectorDecisionPrefix = "selector-decision-";
const selectorOperationPrefix = "selector-operation-";

/** A decision's operation and its reference, both named from one identifier so either names the other. */
function selectorIdentityOf(identifier: string): SelectorCycleIdentity {
  return {
    operation: asOperationId(`${selectorOperationPrefix}${identifier}`),
    selectorDecisionReference: `${selectorDecisionPrefix}${identifier}`,
  };
}

/**
 * Names each new decision from an identifier `draw` gives, and a stored
 * reference from the identifier it carries, so a successor names a finished
 * decision's dispatches under the operations the process that began it would have.
 */
export function selectorIdentityFactory(
  draw: () => string,
): SelectorIdentityFactory {
  return {
    next: () => selectorIdentityOf(draw()),
    resumed: (reference) => {
      if (
        !reference.startsWith(selectorDecisionPrefix) ||
        reference.length === selectorDecisionPrefix.length
      )
        return undefined;
      try {
        return selectorIdentityOf(
          reference.slice(selectorDecisionPrefix.length),
        );
      } catch {
        return undefined;
      }
    },
  };
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
  /** The projects whose observation held nothing for the lead, and whose state moved without a turn. */
  readonly quiet: number;
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

async function observeProjects(
  projects: readonly Partition[],
  refusals: SelectorRefusalLedger,
  store: SelectorStateStore,
  source: SelectorRuntimeSource,
  policy: SelectorPolicyHost,
  identities: SelectorIdentityFactory,
  control: SelectorRuntimeSettingsSource,
  held: readonly Partition[],
): Promise<SelectorSweepProgress> {
  let proposed = 0;
  let dispatched = 0;
  let observed = 0;
  let quiet = 0;
  const reached: Partition[] = [];
  const failures: SelectorRunFailure[] = [];
  for (const partition of projects) {
    if (selectorProjectHeld(held, partition)) {
      reached.push(partition);
      continue;
    }
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
    if (result.quiet) quiet += 1;
    if (result.proposed) proposed += 1;
    dispatched += result.dispatched;
  }
  return { reached, observed, quiet, proposed, dispatched, failures };
}

/** Whether a project's unfinished decision still stands, which passes it over this quantum. */
function selectorProjectHeld(
  held: readonly Partition[],
  partition: Partition,
): boolean {
  return held.some(
    (standing) =>
      standing.tenant === partition.tenant &&
      standing.project === partition.project,
  );
}

type SelectorSweepProgress = Pick<
  SelectorRunResult,
  "reached" | "observed" | "quiet" | "proposed" | "dispatched" | "failures"
>;

interface ProjectObservationResult {
  readonly stop: boolean;
  readonly observed: boolean;
  /** Whether this project's observation was stored as a quiet cycle rather than offered as a turn. */
  readonly quiet: boolean;
  /** Whether this project's turn left a decision in the relation for the writer to answer. */
  readonly proposed: boolean;
  /** The delivery rows this project's decision left, which a decision that proposed nothing makes zero. */
  readonly dispatched: number;
  readonly failures: readonly SelectorRunFailure[];
}

/**
 * Runs one swept project, taking its permit only once the observation the
 * decision would stand on exists and holds something the lead can judge — a
 * change log that moved is not by itself something to decide about, so
 * allocating on the trigger charges a decision reference, a
 * `selector_interaction` row and a selections-per-minute slot to every pass of
 * a project whose changes leave the lead nothing to answer. A project with
 * nothing to decide therefore costs its bounded reads and at most the quiet
 * cycle's writes, of its cursor and scan and of its lead refusal forgotten —
 * no permit, no decision reference, no turn and no quota — and the sweep
 * still counts it as scanned, so discovery goes on.
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
  let pass: SelectorProjectPass | undefined;
  try {
    state = (await store.project(partition)) ?? selectorInitialState(partition);
    pass = await projectObservation(state, refusals, store, source, settings);
    if (pass?.result === "Unmoved") await store.recordQuietCycle(pass.state);
  } catch {
    return projectObservationFailure("Observation", partition);
  }
  if (pass?.result !== "Observed") return emptyProjectObservation;
  const observation = pass.observation;
  const quiet = selectorQuietCycle(state, observation);
  if (quiet !== undefined) return observeQuietProject(partition, store, quiet);
  const admission = await observeProjectAdmission(partition, policy, store);
  if (!admission.admitted) return admission.passedOver;
  const admitted = await observeAdmittedProject(
    partition,
    settings,
    state,
    observation,
    refusals,
    store,
    source,
    policy,
    identities,
    control,
  );
  return admission.failures.length === 0
    ? admitted
    : { ...admitted, failures: [...admission.failures, ...admitted.failures] };
}

/** Takes an admitted project's permit and, where one is given, runs its decision. */
async function observeAdmittedProject(
  partition: Partition,
  settings: SelectorResolvedSettings,
  state: SelectorProjectState,
  observation: SelectorObservation,
  refusals: SelectorRefusalLedger,
  store: SelectorStateStore,
  source: SelectorRuntimeSource,
  policy: SelectorPolicyHost,
  identities: SelectorIdentityFactory,
  control: SelectorRuntimeSettingsSource,
): Promise<ProjectObservationResult> {
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
 * Stores a quiet cycle's state, which a pass whose revision is stale leaves
 * unwritten, after forgetting the project's lead refusal: a project with
 * nothing to decide needs no lead, so a refusal kept from before is no longer
 * why it has none. The refusal goes first, so a write that fails leaves the
 * cursor where the next pass finds the same changes and forgets it again.
 */
async function observeQuietProject(
  partition: Partition,
  store: SelectorStateStore,
  quiet: SelectorProjectState,
): Promise<ProjectObservationResult> {
  try {
    await store.clearLeadRefusal(partition);
    return (await store.recordQuietCycle(quiet))
      ? { ...emptyProjectObservation, quiet: true }
      : emptyProjectObservation;
  } catch {
    return projectObservationFailure("Observation", partition);
  }
}

/** Whether a project's lead may take a turn now, and what keeping its refusal failed. */
type ProjectAdmission =
  | { readonly admitted: false; readonly passedOver: ProjectObservationResult }
  | {
      readonly admitted: true;
      readonly failures: readonly SelectorRunFailure[];
    };

/**
 * Why a project with something to decide is passed over before its permit, or
 * that its lead may take a turn now: a refusal or a read that could not say
 * moves no notification cursor, so the next pass that reaches the project asks
 * again and finds its changes waiting. A refusal is kept and an admission
 * forgets it, for a reader of a project with no lead; a read that could not say
 * leaves what is kept, and a store that cannot keep or forget is reported under
 * `Observation` and changes no admission.
 */
async function observeProjectAdmission(
  partition: Partition,
  policy: SelectorPolicyHost,
  store: SelectorStateStore,
): Promise<ProjectAdmission> {
  let admission: LeadAdmission;
  try {
    admission = await policy.leadAdmission(partition);
  } catch {
    return {
      admitted: false,
      passedOver: projectObservationFailure("AdmissionUndecided", partition),
    };
  }
  const unkept = await observeProjectAdmissionKept(partition, store, admission);
  return admission === "Admitted"
    ? { admitted: true, failures: unkept }
    : {
        admitted: false,
        passedOver: {
          ...emptyProjectObservation,
          failures: [{ phase: admission, partition }, ...unkept],
        },
      };
}

/** Keeps a refused admission or forgets the refusal kept, answering the failure where the store could not. */
async function observeProjectAdmissionKept(
  partition: Partition,
  store: SelectorStateStore,
  admission: LeadAdmission,
): Promise<readonly SelectorRunFailure[]> {
  try {
    if (admission === "Admitted") await store.clearLeadRefusal(partition);
    else await store.recordLeadRefusal(partition, admission);
    return [];
  } catch {
    return [{ phase: "Observation", partition }];
  }
}

/**
 * What this project has to decide about, the step past changes that left its
 * exhausted view where it was, or nothing. The notification page is read once
 * and handed to the observation, so a row cannot arrive between two reads and
 * be counted as the trigger for a window that does not contain it.
 */
async function projectObservation(
  state: SelectorProjectState,
  refusals: SelectorRefusalLedger,
  held: Pick<SelectorStateStore, "heldAmong">,
  source: SelectorRuntimeSource,
  settings: SelectorResolvedSettings,
): Promise<SelectorProjectPass | undefined> {
  const changes = await source.moved(
    state.partition,
    state.notificationCursor,
    selectorNotificationPageLimit,
  );
  if (!selectorProjectMoved(state, changes)) return undefined;
  return observeSelectorProjectPass(
    state,
    source,
    refusals,
    held,
    changes,
    selectorNotificationPageLimit,
    Math.floor(leadInputBytesMax(settings) / 2),
  );
}

const emptyProjectObservation: ProjectObservationResult = {
  stop: false,
  observed: false,
  quiet: false,
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
    state.revision,
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
    quiet: false,
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
  held: readonly Partition[],
): Promise<SelectorSweepProgress> {
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
    held,
  );
  await saveInventoryProgress(store, inventory, progress.reached.length);
  return progress;
}

/** A paused installation reads no inventory, so it has no progress to record. */
const pausedInventory = {
  reached: [],
  observed: 0,
  quiet: 0,
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

/**
 * The decisions a predecessor left, finished or ended first, and then the
 * inventory, which passes over every project whose decision still stands. A
 * resumption that could not read what is unfinished observes nothing, because
 * it cannot say which projects are held.
 */
async function selectorSweep(
  refusals: SelectorRefusalLedger,
  store: SelectorStateStore,
  source: SelectorRuntimeSource,
  policy: SelectorPolicyHost,
  identities: SelectorIdentityFactory,
  control: SelectorRuntimeSettingsSource,
  projectsMax: number,
): Promise<SelectorSweepProgress> {
  let resumed: SelectorResumptionProgress;
  try {
    resumed = await resumeSelectorDecisions(
      refusals,
      store,
      source,
      policy,
      identities,
      control,
    );
  } catch {
    return { ...pausedInventory, failures: [{ phase: "Resumption" }] };
  }
  let progress: SelectorSweepProgress;
  try {
    progress = await observeInventory(
      refusals,
      store,
      source,
      policy,
      identities,
      control,
      projectsMax,
      resumed.held,
    );
  } catch {
    progress = { ...pausedInventory, failures: [{ phase: "Inventory" }] };
  }
  return {
    ...progress,
    proposed: progress.proposed + resumed.proposed,
    dispatched: progress.dispatched + resumed.dispatched,
    failures: [...resumed.failures, ...progress.failures],
  };
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
  const sweep = await selectorSweep(
    refusals,
    store,
    source,
    policy,
    identities,
    control,
    checkedBound(config.projectsMax, "selector project bound"),
  );
  const failures: SelectorRunFailure[] = [...sweep.failures];
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
    reached: sweep.reached,
    observed: sweep.observed,
    quiet: sweep.quiet,
    proposed: sweep.proposed,
    dispatched: sweep.dispatched,
    delivered: delivery.delivered,
    reconciled: reconciliation.reconciled,
    failures,
  };
}

/** One project a run passed over because its lead may not take a turn, and which answer stopped it. */
export interface SelectorAdmissionSkip {
  readonly partition: Partition;
  readonly phase: SelectorAdmissionPhase;
}

/** What has been reported of each skipped project, keyed by `selectorAdmissionChangesKey`. */
export type SelectorAdmissionReported = ReadonlyMap<
  string,
  SelectorAdmissionPhase
>;

/** A partition as one key, its two halves kept apart so no pair reads as another. */
function selectorAdmissionChangesKey(partition: Partition): string {
  return JSON.stringify([partition.tenant, partition.project]);
}

const selectorAdmissionPhases: ReadonlySet<SelectorRunFailure["phase"]> =
  new Set<SelectorAdmissionPhase>([
    "HostedRunsNotGranted",
    "RunnerOffline",
    "AdmissionUndecided",
  ]);

function selectorAdmissionPhase(
  phase: SelectorRunFailure["phase"],
): phase is SelectorAdmissionPhase {
  return selectorAdmissionPhases.has(phase);
}

/**
 * The admission skips a run names that were not already reported under the
 * same phase, and what stands reported after it. A project the run reached and
 * did not skip is forgotten, so one passed over on every pass that reaches it is
 * reported once, and again only after a pass reached it without skipping it or
 * named another phase.
 */
export function selectorAdmissionChanges(
  reported: SelectorAdmissionReported,
  run: Pick<SelectorRunResult, "reached" | "failures">,
): {
  readonly changed: readonly SelectorAdmissionSkip[];
  readonly reported: SelectorAdmissionReported;
} {
  const standing = new Map(reported);
  for (const partition of run.reached)
    standing.delete(selectorAdmissionChangesKey(partition));
  const changed: SelectorAdmissionSkip[] = [];
  for (const { phase, partition } of run.failures) {
    if (!selectorAdmissionPhase(phase)) continue;
    if (partition === undefined) continue;
    const key = selectorAdmissionChangesKey(partition);
    if (reported.get(key) !== phase) changed.push({ partition, phase });
    standing.set(key, phase);
  }
  return { changed, reported: standing };
}
