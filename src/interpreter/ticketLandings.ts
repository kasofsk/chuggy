/**
 * The read of a ticket's landings: each finalization request the ticket has
 * had, as what is recorded of it, the newest so many of them oldest first.
 *
 * IT IS AUTHORIZED AS THE TICKET'S OWN READ IS, and a ticket the caller may
 * not read is answered as one that does not exist.
 *
 * A LANDING'S STATE IS READ FROM THE REQUEST, ITS CONCLUSION, ITS HOLD AND ITS
 * MERGE, and `ticketLandingState` is the whole of that reading. A request the
 * finalizer still holds is `Held` where its hold columns are set, `AwaitingMerge` where its pull request's merge waits on
 * the forge, and `Running` otherwise. A concluded one is what its journal event
 * says: `Failed` for the ticket sent back to work, `Unavailable` for the one
 * escalated, and for a success `Landed` where a commit it landed at is
 * recorded and `Proposed` where only its pull request is. `Invalidated` is the
 * request's own state.
 *
 * WHERE THE ROWS CANNOT TELL TWO STATES APART THE ONE ANSWERED CLAIMS LESS.
 * Only the holds a resume could clear are recorded, and a pass held for any
 * other reason writes nothing either way, so a live landing's hold is the last
 * one recorded and may be older than what holds it now. A wait is answered under a recorded hold, because a
 * pass that found the proposal open clears the record and so one that stands
 * is newer than the last reading. A concluded landing answers neither, whatever
 * its columns still carry, except that an escalated one answers the hold it
 * escalated from, which is the last one recorded, since only a recorded hold's
 * dwell escalates.
 *
 * A CONFLICT IS READ FROM ITS MANIFEST, which is a project artifact and not a
 * row. A manifest not found and a store that cannot be reached both leave the
 * conflict out and answer the rest; bytes that are not a manifest contradict
 * the row that names them, and fail the read.
 *
 * A LINK IS ANSWERED ONLY WHERE A REPORT COULD CARRY IT, since a console
 * offers it to be opened.
 *
 * A STACKED TICKET'S READ ALSO ANSWERS WHAT EACH OF ITS NEWEST WORK CYCLES WAS
 * PREPARED OVER, a stack or a decision to evaluate unstacked, as the finalizer
 * left it. Whether a stack still stands is not answered: the finalizer derives
 * it from the queue it lands in and the landings since its tip, and this read
 * gathers neither.
 */

import { isActionReportLink } from "../contract/actionReport.ts";
import {
  ticketLandingConflictBytesMax,
  ticketLandingsAnsweredMax,
  ticketLandingStacksAnsweredMax,
  jsonTextBytes,
} from "../contract/http.ts";
import type {
  FinalizationUnavailableKind,
  TicketLandingState,
} from "../contract/rosters.ts";
import { assertNever } from "../domain/assertNever.ts";
import type { TicketId } from "../domain/ids.ts";
import { authorizedProjectRead } from "./authorizedProject.ts";
import type {
  ChangeProposalCreationStored,
  ChangeProposalMergeAnswer,
  ChangeProposalMerged,
  ChangeProposalMergeability,
  ChangeProposalMergeWait,
  ChangeProposalStatus,
  ChangeProposalUnmergeableSettled,
  ProposalMergeState,
  ProposalQueueWord,
} from "./changeProposal.ts";
import type {
  ConflictSummary,
  FinalizationAttemptOutcome,
  FinalizationFailureKind,
  FinalizationRecheckReason,
  FinalizationRequestState,
  GitObjectId,
} from "./finalizer.ts";
import {
  conflictManifestRead,
  type ProjectArtifactId,
  type ProjectArtifactPort,
} from "./finalizerPreparation.ts";
import type { UnstackedReason } from "./evaluationStack.ts";
import type { Principal } from "./principal.ts";
import type { ProjectAccess } from "./projectAccess.ts";
import type { Partition } from "./projectStore.ts";
import type { PublicInstant } from "./publicResource.ts";
import type { QueueFailedChecks } from "./queueFailedChecks.ts";
import type { StackMember } from "./stackChoice.ts";

/** How a concluded request's journal event says it concluded. */
export type TicketLandingConclusion = "Succeeded" | "NeedsWork" | "Unavailable";

/** Who removed a request's pull request from its base's merge queue, and the forge's own reason for it. */
export interface TicketLandingQueueRemoval {
  readonly reason: ProposalQueueWord;
  readonly actor?: ProposalQueueWord;
}

/**
 * The hold a request was last recorded at, the removal it escalates where it
 * is a queue's, and the files a job may not push that the target changed where
 * it is `TargetPathsRefused`, and the checks a spent rework's queue failed
 * where it is `ProposalMergesExhausted` and they were read.
 */
export interface TicketLandingHold {
  readonly kind: FinalizationUnavailableKind;
  readonly passes: number;
  readonly since: PublicInstant;
  readonly removal?: TicketLandingQueueRemoval;
  readonly refused?: ConflictSummary;
  readonly failedChecks?: QueueFailedChecks;
}

/**
 * The holds a removal from a merge queue is escalated at, which are the ones
 * that carry it: merges exhausted among them, which a spent rework of a
 * failed-check removal holds at, and which carries none where the proposal's
 * standing records none.
 */
export const ticketLandingQueueRemovalHolds: readonly FinalizationUnavailableKind[] =
  [
    "ProposalQueueChecksFailed",
    "ProposalQueueTimedOut",
    "ProposalDequeued",
    "ProposalMergesExhausted",
  ];

/**
 * Why one attempt was sent back to re-check, and the ref of the base it was
 * read against where its target is a proposal's head: the base it read, or
 * for a merged proposal the base that proposal was opened into.
 */
export interface TicketLandingRecheck {
  readonly reason: FinalizationRecheckReason;
  readonly baseRef?: string;
}

/**
 * One request's newest attempt, as its row holds it, its re-check present
 * where it recorded one and its failed checks where its queue's were read.
 */
export interface TicketLandingAttempt {
  readonly outcome: FinalizationAttemptOutcome;
  readonly failureKind?: FinalizationFailureKind;
  readonly recheck?: TicketLandingRecheck;
  readonly failedChecks?: QueueFailedChecks;
  readonly targetRef: string;
  readonly targetCommit: GitObjectId;
  readonly candidateCommit?: GitObjectId;
  readonly preparedAt: PublicInstant;
}

/** One request's pull request, opened at `headCommit`, each other field present where its row holds it. */
export interface TicketLandingProposal {
  readonly url?: string;
  readonly headRef: string;
  readonly headCommit: GitObjectId;
  readonly baseRef: string;
  readonly creation?: ChangeProposalCreationStored["created"];
  /** What the forge last said of the proposal itself. */
  readonly status?: ChangeProposalStatus;
  readonly merge?: ChangeProposalMergeAnswer["merged"];
  readonly mergeReason?: ChangeProposalUnmergeableSettled;
  readonly mergeability?: ChangeProposalMergeability;
  readonly mergeState?: ProposalMergeState;
  readonly mergeCommit?: GitObjectId;
  /** The head the forge merged, where it is not `headCommit`: a person moved it before merging. */
  readonly mergedHead?: GitObjectId;
  /** How many merges of it the forge was asked for, where it was asked for any. */
  readonly mergesAsked?: number;
  readonly mergeAnswer?: TicketLandingMergeAnswer;
}

/**
 * What the forge answered the newest merge it was asked for: when it was asked
 * and, once heard, when it answered, what that came to, and its status and
 * message, cut where `messageCut` says so, or the failure that reached no forge.
 */
export interface TicketLandingMergeAnswer {
  readonly askedAt: PublicInstant;
  readonly answeredAt?: PublicInstant;
  readonly outcome?: ChangeProposalMerged["merged"];
  readonly status?: number;
  readonly failure?: string;
  readonly message?: string;
  readonly messageCut?: true;
}

/** What a request's merge waits on at the forge, and when the forge was last heard about it. */
export interface TicketLandingWait {
  readonly reason: ChangeProposalMergeWait;
  readonly checkedAt: PublicInstant;
}

/**
 * What the store reads of one request. `landedCommit` is where the request
 * landed by the rule `read_ticket_landed_commit` states, wherever it ended.
 */
export interface TicketLandingRecord {
  readonly cycle: number;
  readonly generation: number;
  readonly request: FinalizationRequestState;
  readonly concluded?: TicketLandingConclusion;
  readonly hold?: TicketLandingHold;
  readonly attempts: number;
  readonly attempt?: TicketLandingAttempt;
  /** The conflict manifest the newest attempt recorded, where it recorded one. */
  readonly conflictManifest?: ProjectArtifactId;
  readonly proposal?: TicketLandingProposal;
  readonly wait?: TicketLandingWait;
  readonly landedCommit?: GitObjectId;
}

export interface TicketLandingsStore {
  /**
   * The newest `count` of a ticket's requests oldest first, leaving out one
   * that concluded as succeeded with no attempt, or nothing for a ticket the
   * project does not have.
   */
  landings(
    partition: Partition,
    ticket: TicketId,
    count: number,
  ): Promise<readonly TicketLandingRecord[] | undefined>;
}

/**
 * What one work cycle's evaluation was prepared over: a stack, or the decision
 * to evaluate it unstacked, `restacked` where the cycle before it was sent back
 * to re-stack.
 */
export type TicketLandingStack = { readonly restacked?: true } & (
  | {
      readonly cycle: number;
      readonly prepared: "Stacked";
      readonly beneath: readonly StackMember[];
      readonly reference: string;
      readonly tip: GitObjectId;
    }
  | {
      readonly cycle: number;
      readonly prepared: "Unstacked";
      readonly reason: UnstackedReason;
    }
);

export interface TicketLandingStacksStore {
  /**
   * The newest `count` of a Stacked ticket's work cycles the finalizer left a
   * stack or a decision for, oldest first, and none for any other ticket.
   */
  stacks(
    partition: Partition,
    ticket: TicketId,
    count: number,
  ): Promise<readonly TicketLandingStack[]>;
}

/** Where one landing stands, with the hold, the wait or the commit its state carries. */
export type TicketLandingStanding =
  | { readonly state: "Held"; readonly hold: TicketLandingHold }
  | { readonly state: "Unavailable"; readonly hold?: TicketLandingHold }
  | { readonly state: "AwaitingMerge"; readonly wait: TicketLandingWait }
  | { readonly state: "Landed"; readonly landedCommit: GitObjectId }
  | {
      readonly state: Exclude<
        TicketLandingState,
        "Held" | "Unavailable" | "AwaitingMerge" | "Landed"
      >;
    };

/** One landing as the read answers it. */
export type TicketLanding = TicketLandingStanding & {
  readonly cycle: number;
  readonly generation: number;
  readonly attempts: number;
  readonly attempt?: TicketLandingAttempt;
  readonly conflict?: ConflictSummary;
  readonly proposal?: TicketLandingProposal;
};

export interface TicketLandings {
  readonly landings: readonly TicketLanding[];
  readonly truncated: boolean;
  /** Absent where the finalizer prepared no work cycle of the ticket. */
  readonly stacks?: {
    readonly cycles: readonly TicketLandingStack[];
    readonly truncated: boolean;
  };
}

export interface TicketLandingReads {
  /** Answers nothing for a ticket the caller may not read or the project does not have. */
  read(
    principal: Principal,
    partition: Partition,
    ticket: TicketId,
  ): Promise<TicketLandings | undefined>;
}

export interface TicketLandingPorts {
  readonly access: ProjectAccess;
  readonly store: TicketLandingsStore;
  readonly stacks: TicketLandingStacksStore;
  readonly artifacts: Pick<ProjectArtifactPort, "readArtifact">;
}

/** What a concluded request's success stands at: the commit it landed at, else the pull request it left. */
function ticketLandingSucceeded(
  record: TicketLandingRecord,
): TicketLandingStanding {
  if (record.landedCommit !== undefined)
    return { state: "Landed", landedCommit: record.landedCommit };
  if (record.proposal !== undefined) return { state: "Proposed" };
  throw new Error(
    "ticket landings: a success landed nowhere and opened no pull request",
  );
}

/** What a concluded request stands at, read from the event that concluded it. */
function ticketLandingConcluded(
  record: TicketLandingRecord,
): TicketLandingStanding {
  switch (record.concluded) {
    case "NeedsWork":
      return { state: "Failed" };
    case "Unavailable":
      return record.hold === undefined
        ? { state: "Unavailable" }
        : { state: "Unavailable", hold: record.hold };
    case "Succeeded":
      return ticketLandingSucceeded(record);
    case undefined:
      throw new Error(
        "ticket landings: a fulfilled request has no event concluding it",
      );
    default:
      return assertNever(record.concluded);
  }
}

/** Where a request the finalizer still holds stands, a recorded hold over a wait. */
function ticketLandingLive(record: TicketLandingRecord): TicketLandingStanding {
  if (record.hold !== undefined) return { state: "Held", hold: record.hold };
  if (record.wait !== undefined)
    return { state: "AwaitingMerge", wait: record.wait };
  return { state: "Running" };
}

/** Where one recorded request stands, which reads nothing and performs nothing. */
export function ticketLandingState(
  record: TicketLandingRecord,
): TicketLandingStanding {
  switch (record.request) {
    case "Invalidated":
      return { state: "Invalidated" };
    case "Fulfilled":
      return ticketLandingConcluded(record);
    case "Open":
    case "Registered":
      return ticketLandingLive(record);
    default:
      return assertNever(record.request);
  }
}

/**
 * As many of a conflict's paths as one landing answers beside the `beside`
 * bytes its failed checks weigh, cut where the manifest was or where they stop
 * fitting.
 */
export function ticketLandingConflictBounded(
  conflict: ConflictSummary,
  beside: number,
): ConflictSummary {
  const paths: string[] = [];
  let bytes = beside;
  for (const path of conflict.paths) {
    bytes += jsonTextBytes(path);
    if (bytes > ticketLandingConflictBytesMax)
      return { paths, truncated: true };
    paths.push(path);
  }
  return { paths, truncated: conflict.truncated };
}

/**
 * What the failed checks one landing names weigh as the JSON strings they are
 * sent as, which their bounds hold within `ticketLandingConflictBytesMax`.
 */
function ticketLandingFailedChecksBytes(record: TicketLandingRecord): number {
  const named = [
    ...(record.attempt?.failedChecks?.names ?? []),
    ...(record.hold?.failedChecks?.names ?? []),
  ];
  const bytes = named.reduce((sum, name) => sum + jsonTextBytes(name), 0);
  if (bytes > ticketLandingConflictBytesMax)
    throw new Error(
      "ticket landings: a landing's failed checks outweigh its paths' bound",
    );
  return bytes;
}

/** The conflict one manifest records, or nothing where it was not found or the store could not be reached. */
async function ticketLandingConflict(
  ports: TicketLandingPorts,
  partition: Partition,
  artifact: ProjectArtifactId,
  beside: number,
): Promise<ConflictSummary | undefined> {
  const read = await ports.artifacts.readArtifact({ partition, artifact });
  switch (read.read) {
    case "NotFound":
    case "Unavailable":
      return undefined;
    case "Content": {
      const conflict = conflictManifestRead(read.content);
      if (conflict === undefined)
        throw new Error(
          "ticket landings: a conflict manifest is not one its writer wrote",
        );
      return ticketLandingConflictBounded(conflict, beside);
    }
    default:
      return assertNever(read);
  }
}

/** One request's pull request, its link kept only where a report could carry it. */
export function ticketLandingProposal(
  proposal: TicketLandingProposal,
): TicketLandingProposal {
  const { url, ...rest } = proposal;
  return url !== undefined && isActionReportLink(url) ? { url, ...rest } : rest;
}

/** A standing whose hold names refused files, those files cut as a conflict's are. */
function ticketLandingRefusedBounded(
  standing: TicketLandingStanding,
  beside: number,
): TicketLandingStanding {
  if (standing.state !== "Held" && standing.state !== "Unavailable")
    return standing;
  const refused = standing.hold?.refused;
  if (standing.hold === undefined || refused === undefined) return standing;
  return {
    ...standing,
    hold: {
      ...standing.hold,
      refused: ticketLandingConflictBounded(refused, beside),
    },
  };
}

async function ticketLanding(
  ports: TicketLandingPorts,
  partition: Partition,
  record: TicketLandingRecord,
): Promise<TicketLanding> {
  const { attempt, conflictManifest } = record;
  const beside = ticketLandingFailedChecksBytes(record);
  const conflict =
    conflictManifest === undefined
      ? undefined
      : await ticketLandingConflict(ports, partition, conflictManifest, beside);
  return {
    ...ticketLandingRefusedBounded(ticketLandingState(record), beside),
    cycle: record.cycle,
    generation: record.generation,
    attempts: record.attempts,
    ...(attempt === undefined ? {} : { attempt }),
    ...(conflict === undefined ? {} : { conflict }),
    ...(record.proposal === undefined
      ? {}
      : { proposal: ticketLandingProposal(record.proposal) }),
  };
}

/** The newest work cycles the read answers the stack of, and whether there were more. */
async function ticketLandingsReadStacks(
  ports: TicketLandingPorts,
  partition: Partition,
  ticket: TicketId,
): Promise<TicketLandings["stacks"]> {
  const count = ticketLandingStacksAnsweredMax + 1;
  const cycles = await ports.stacks.stacks(partition, ticket, count);
  if (cycles.length > count)
    throw new Error(
      "ticket landings: the stack store answered more than it was asked",
    );
  if (cycles.length === 0) return undefined;
  const truncated = cycles.length > ticketLandingStacksAnsweredMax;
  return { cycles: truncated ? cycles.slice(1) : cycles, truncated };
}

async function ticketLandingsRead(
  ports: TicketLandingPorts,
  partition: Partition,
  ticket: TicketId,
): Promise<TicketLandings | undefined> {
  const count = ticketLandingsAnsweredMax + 1;
  const records = await ports.store.landings(partition, ticket, count);
  if (records === undefined) return undefined;
  if (records.length > count)
    throw new Error(
      "ticket landings: the store answered more than it was asked",
    );
  const truncated = records.length > ticketLandingsAnsweredMax;
  const answered = truncated ? records.slice(1) : records;
  const landings: TicketLanding[] = [];
  for (const record of answered)
    landings.push(await ticketLanding(ports, partition, record));
  const stacks = await ticketLandingsReadStacks(ports, partition, ticket);
  return {
    landings,
    truncated,
    ...(stacks === undefined ? {} : { stacks }),
  };
}

export function ticketLandingReads(
  ports: TicketLandingPorts,
): TicketLandingReads {
  return {
    read: authorizedProjectRead(ports.access, (partition, ticket: TicketId) =>
      ticketLandingsRead(ports, partition, ticket),
    ),
  };
}
