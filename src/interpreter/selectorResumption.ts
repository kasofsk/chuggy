/**
 * The decisions a selector process began and did not finish, found at the start
 * of every quantum and finished or ended before any project is observed.
 *
 * A DECISION OUTLIVES THE PROCESS THAT BEGAN IT. The oldest unfinished decision
 * of a project whose turn is in the mailbox, or has ended, is finished from what
 * the store kept: its observation, its fence and the turn's answer. It is
 * recorded as the process that offered the turn would have recorded it.
 *
 * ONE THAT CANNOT BE FINISHED IS ENDED WHEN IT IS FOUND. A decision that offered
 * no turn is terminated once its observation is older than the bound, which is
 * what keeps a live sibling's attempt from being ended before it offers its
 * turn. A decision that cannot be fenced is void: its turn is withdrawn and it
 * is terminated, as is every younger decision of the same project that offered one.
 *
 * A PROJECT WITH A DECISION STILL STANDING IS NOT OBSERVED, and nothing is
 * finished or ended while the installation or the project is paused, because
 * finishing a decision dispatches. A project's resolved mode is paused under
 * either, so its settings are the one read that answers both.
 */

import type { Partition } from "./projectStore.ts";
import {
  runResumedSelectorCycle,
  selectorInitialState,
  type SelectorObservation,
  type SelectorObservationSource,
  type SelectorPolicyHost,
  type SelectorProjectState,
  type SelectorProposedDecision,
  type SelectorRefusalLedger,
  type SelectorResolvedSettings,
  type SelectorRuntimeSettingsSource,
  type SelectorStateStore,
  type SelectorTurnStanding,
  type SelectorUnfinishedAttempt,
  unwrittenDispatches,
} from "./selector.ts";
import { settleFailedSelectorAttempt } from "./selectorAttemptRuntime.ts";
import type {
  SelectorIdentityFactory,
  SelectorRunFailure,
} from "./selectorRuntimeTypes.ts";

/** How many unfinished decisions one quantum reads, which the store's own bound on a read caps. */
export const selectorUnfinishedAttemptsMax = 100;

/** What one quantum's resumption left: the projects still held, and what the decisions it finished proposed. */
export interface SelectorResumptionProgress {
  /** The projects whose unfinished decision still stands, which no pass of this quantum observes. */
  readonly held: readonly Partition[];
  readonly proposed: number;
  readonly dispatched: number;
  readonly failures: readonly SelectorRunFailure[];
}

/** The ports one resumption reads and writes through. */
interface SelectorResumptionPorts {
  readonly refusals: SelectorRefusalLedger;
  readonly store: SelectorStateStore;
  readonly source: SelectorObservationSource;
  readonly policy: SelectorPolicyHost;
  readonly identities: SelectorIdentityFactory;
  /** The source's clock when the store answered the decisions' ages. */
  readonly readAtMs: number;
}

/** What handling one unfinished decision left. */
interface SelectorAttemptResumption {
  /** Whether the decision still stands, holding its project from observation. */
  readonly standing: boolean;
  readonly proposal?: SelectorProposedDecision;
  readonly failures: readonly SelectorRunFailure[];
}

const resumptionEnded: SelectorAttemptResumption = {
  standing: false,
  failures: [],
};
const resumptionStanding: SelectorAttemptResumption = {
  standing: true,
  failures: [],
};

/** Every unfinished decision grouped by its project, each group oldest first and the groups by their oldest. */
function selectorUnfinishedByProject(
  found: readonly SelectorUnfinishedAttempt[],
): readonly (readonly SelectorUnfinishedAttempt[])[] {
  const projects = new Map<string, SelectorUnfinishedAttempt[]>();
  for (const attempt of found) {
    const key = JSON.stringify([
      attempt.partition.tenant,
      attempt.partition.project,
    ]);
    const group = projects.get(key);
    if (group === undefined) projects.set(key, [attempt]);
    else group.push(attempt);
  }
  return [...projects.values()];
}

/** Finishes or ends every unfinished decision the store holds, answering the projects that must not be observed. */
export async function resumeSelectorDecisions(
  refusals: SelectorRefusalLedger,
  store: SelectorStateStore,
  source: SelectorObservationSource,
  policy: SelectorPolicyHost,
  identities: SelectorIdentityFactory,
  control: SelectorRuntimeSettingsSource,
): Promise<SelectorResumptionProgress> {
  const projects = selectorUnfinishedByProject(
    await store.unfinishedAttempts(selectorUnfinishedAttemptsMax),
  );
  if (projects.length === 0)
    return { held: [], proposed: 0, dispatched: 0, failures: [] };
  const readAtMs = await source.currentTimeEpochMs();
  const ports = { refusals, store, source, policy, identities, readAtMs };
  const held: Partition[] = [];
  const failures: SelectorRunFailure[] = [];
  let proposed = 0;
  let dispatched = 0;
  for (const group of projects) {
    const outcomes = await resumeProjectDecisions(group, ports, control);
    const partition = group[0]?.partition;
    if (partition !== undefined && outcomes.some((one) => one.standing))
      held.push(partition);
    for (const outcome of outcomes) {
      failures.push(...outcome.failures);
      if (outcome.proposal === undefined) continue;
      proposed += 1;
      dispatched += outcome.proposal.dispatched.length;
    }
  }
  return { held, proposed, dispatched, failures };
}

/** One project's unfinished decisions: the oldest finished where it can be, the rest void. */
async function resumeProjectDecisions(
  group: readonly SelectorUnfinishedAttempt[],
  ports: SelectorResumptionPorts,
  control: SelectorRuntimeSettingsSource,
): Promise<readonly SelectorAttemptResumption[]> {
  const [oldest, ...younger] = group;
  if (oldest === undefined) return [];
  let settings: SelectorResolvedSettings;
  try {
    settings = await control.projectSettings(oldest.partition);
  } catch {
    return [
      {
        standing: true,
        failures: [{ phase: "Settings", partition: oldest.partition }],
      },
    ];
  }
  if (settings.mode === "Paused") return [resumptionStanding];
  const outcomes = [
    await resumeSelectorAttempt(oldest, () =>
      resumeOldestSelectorAttempt(oldest, ports, settings),
    ),
  ];
  for (const attempt of younger)
    outcomes.push(
      await resumeSelectorAttempt(attempt, () =>
        resumeYoungerSelectorAttempt(attempt, ports, settings),
      ),
    );
  return outcomes;
}

/** Handles one unfinished decision, a failure holding its project for this quantum and naming the decision. */
async function resumeSelectorAttempt(
  found: SelectorUnfinishedAttempt,
  handle: () => Promise<SelectorAttemptResumption>,
): Promise<SelectorAttemptResumption> {
  try {
    return await handle();
  } catch {
    return {
      standing: true,
      failures: [
        {
          phase: "Resumption",
          partition: found.partition,
          decision: found.attempt,
        },
      ],
    };
  }
}

/**
 * A decision's age when it is reached, which is later than the read by however
 * long the decisions before it waited. Only the time elapsed on the source's
 * own clock is added, so no instant of one clock is subtracted from another's.
 */
async function reachedSelectorAttempt(
  found: SelectorUnfinishedAttempt,
  ports: SelectorResumptionPorts,
): Promise<SelectorUnfinishedAttempt> {
  const elapsedMs = (await ports.source.currentTimeEpochMs()) - ports.readAtMs;
  return { ...found, ageMs: found.ageMs + Math.max(0, elapsedMs) };
}

/** Where the turn of an unfinished decision stands, an attempt still `Starting` having offered none. */
async function resumedTurnStanding(
  found: SelectorUnfinishedAttempt,
  policy: SelectorPolicyHost,
): Promise<SelectorTurnStanding> {
  return found.state === "Starting"
    ? "Absent"
    : policy.turnStanding(found.attempt);
}

/**
 * A decision that offered no turn, terminated once its observation is older
 * than the bound and left standing until then. It consumed no change, so nothing
 * is recorded and the next pass observes the same ones.
 */
async function resumeUnofferedAttempt(
  found: SelectorUnfinishedAttempt,
  store: SelectorStateStore,
  settings: SelectorResolvedSettings,
): Promise<SelectorAttemptResumption> {
  if (found.ageMs <= settings.operationalContextMaxAgeMs)
    return resumptionStanding;
  await store.terminateAttempt(
    found.attempt,
    "the decision offered no turn before its observation expired",
  );
  return resumptionEnded;
}

/**
 * Ends a decision that cannot be fenced: its turn withdrawn where one is still
 * in the mailbox, and the attempt terminated with why. A withdrawal nothing
 * proved leaves the attempt to the reaper, which reconciles it by the same withdrawal.
 */
async function voidSelectorAttempt(
  found: SelectorUnfinishedAttempt,
  ports: SelectorResumptionPorts,
  turn: SelectorTurnStanding,
  evidence: string,
): Promise<SelectorAttemptResumption> {
  if (turn === "Pending") {
    const withdrawn = await ports.policy.withdraw(found.attempt);
    if (withdrawn.status !== "Terminated") {
      await ports.store.quarantineAttempt(found.attempt);
      return resumptionEnded;
    }
  }
  await ports.store.terminateAttempt(found.attempt, evidence);
  return resumptionEnded;
}

/** A decision younger than its project's oldest, which is void unless it may still be a sibling about to offer. */
async function resumeYoungerSelectorAttempt(
  read: SelectorUnfinishedAttempt,
  ports: SelectorResumptionPorts,
  settings: SelectorResolvedSettings,
): Promise<SelectorAttemptResumption> {
  const found = await reachedSelectorAttempt(read, ports);
  const turn = await resumedTurnStanding(found, ports.policy);
  if (turn === "Absent")
    return resumeUnofferedAttempt(found, ports.store, settings);
  return voidSelectorAttempt(
    found,
    ports,
    turn,
    "an older unfinished decision of the project is finished first",
  );
}

/** What a decision is finished from, or why it cannot be fenced. */
type SelectorResumable =
  | {
      readonly resumable: true;
      readonly state: SelectorProjectState;
      readonly observation: SelectorObservation;
    }
  | { readonly resumable: false; readonly evidence: string };

/** The project state at the revision the decision is fenced on, which is never one the successor read for itself. */
async function selectorResumable(
  found: SelectorUnfinishedAttempt,
  store: SelectorStateStore,
): Promise<SelectorResumable> {
  if (found.projectRevision === undefined)
    return {
      resumable: false,
      evidence:
        "the decision was stored without the project revision it is fenced on",
    };
  if (found.observation === undefined)
    return {
      resumable: false,
      evidence: "the decision's observation does not read back",
    };
  const state =
    (await store.project(found.partition)) ??
    selectorInitialState(found.partition);
  if (state.revision !== found.projectRevision)
    return {
      resumable: false,
      evidence: "the project moved off the revision the decision is fenced on",
    };
  return { resumable: true, state, observation: found.observation };
}

/** The oldest unfinished decision of a project, finished where its turn was offered and it can be fenced. */
async function resumeOldestSelectorAttempt(
  read: SelectorUnfinishedAttempt,
  ports: SelectorResumptionPorts,
  settings: SelectorResolvedSettings,
): Promise<SelectorAttemptResumption> {
  const found = await reachedSelectorAttempt(read, ports);
  const turn = await resumedTurnStanding(found, ports.policy);
  if (turn === "Absent")
    return resumeUnofferedAttempt(found, ports.store, settings);
  const identity = ports.identities.resumed(found.attempt);
  if (identity === undefined)
    return voidSelectorAttempt(
      found,
      ports,
      turn,
      "the decision's reference names no operation",
    );
  const resumable = await selectorResumable(found, ports.store);
  if (!resumable.resumable)
    return voidSelectorAttempt(found, ports, turn, resumable.evidence);
  const failures: SelectorRunFailure[] = [];
  try {
    const proposal = await runResumedSelectorCycle(
      resumable.state,
      { observation: resumable.observation, turn, ageMs: found.ageMs },
      ports.source,
      ports.refusals,
      ports.store,
      ports.policy,
      identity,
      settings,
    );
    if (proposal === undefined) return resumptionEnded;
    for (const ticket of unwrittenDispatches(proposal))
      failures.push({
        phase: "Record",
        partition: found.partition,
        decision: found.attempt,
        ticket,
      });
    return { standing: false, proposal, failures };
  } catch (error) {
    failures.push({
      phase: "Resumption",
      partition: found.partition,
      decision: found.attempt,
    });
    await settleFailedSelectorAttempt(
      ports.store,
      identity,
      found.partition,
      error,
      failures,
    );
    return { standing: true, failures };
  }
}
