/**
 * The read of a ticket's landings: each finalization request the ticket has
 * had, as what is recorded of it, the newest so many of them oldest first.
 *
 * IT IS AUTHORIZED AS THE TICKET'S OWN READ IS, and a ticket the caller may
 * not read is answered as one that does not exist.
 *
 * A LANDING'S STATE IS READ FROM THE REQUEST, ITS CONCLUSION, ITS HOLD AND ITS
 * APPROVAL, and `ticketLandingState` is the whole of that reading. A request
 * the finalizer still holds is `AwaitingApproval` while its newest attempt
 * waits on an approval a person still has open, `Held` where its hold columns
 * are set, and `Running` otherwise. A concluded one is what its journal event
 * says: `Failed` for the ticket sent back to work, `Unavailable` for the one
 * escalated, and for a success `Landed` where a commit it landed at is
 * recorded and `Proposed` where only its pull request is. `Invalidated` is the
 * request's own state.
 *
 * WHERE THE ROWS CANNOT TELL TWO STATES APART THE ONE ANSWERED CLAIMS LESS.
 * Only the holds a resume could clear are recorded, and a pass held for any
 * other reason writes nothing either way, so a live landing's hold is the last
 * one recorded and may be older than what holds it now. An open approval is
 * no such record: nothing moves the attempt past it, so it is answered over a
 * hold recorded beside it. A concluded landing answers no hold, whatever its
 * columns still carry.
 *
 * A CONFLICT IS READ FROM ITS MANIFEST, which is a project artifact and not a
 * row. A manifest not found and a store that cannot be reached both leave the
 * conflict out and answer the rest; bytes that are not a manifest contradict
 * the row that names them, and fail the read.
 *
 * A LINK IS ANSWERED ONLY WHERE A REPORT COULD CARRY IT, since a console
 * offers it to be opened.
 */

import { isActionReportLink } from "../contract/actionReport.ts";
import {
  ticketLandingConflictBytesMax,
  ticketLandingsAnsweredMax,
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
  ChangeProposalMergeability,
  ChangeProposalUnmergeableSettled,
} from "./changeProposal.ts";
import type {
  ConflictSummary,
  FinalizationAttemptOutcome,
  FinalizationFailureKind,
  FinalizationRequestState,
  GitObjectId,
} from "./finalizer.ts";
import {
  conflictManifestRead,
  type ProjectArtifactId,
  type ProjectArtifactPort,
} from "./finalizerPreparation.ts";
import type { Principal } from "./principal.ts";
import type { ProjectAccess } from "./projectAccess.ts";
import type { Partition } from "./projectStore.ts";
import type { PublicInstant } from "./publicResource.ts";

/** How a concluded request's journal event says it concluded. */
export type TicketLandingConclusion = "Succeeded" | "NeedsWork" | "Unavailable";

/** The hold a request was last recorded at. */
export interface TicketLandingHold {
  readonly kind: FinalizationUnavailableKind;
  readonly passes: number;
  readonly since: PublicInstant;
}

/** One request's newest attempt, as its row holds it. */
export interface TicketLandingAttempt {
  readonly outcome: FinalizationAttemptOutcome;
  readonly failureKind?: FinalizationFailureKind;
  readonly targetRef: string;
  readonly targetCommit: GitObjectId;
  readonly candidateCommit?: GitObjectId;
  readonly preparedAt: PublicInstant;
}

/** One request's pull request, each field present where its row holds it. */
export interface TicketLandingProposal {
  readonly url?: string;
  readonly headRef: string;
  readonly baseRef: string;
  readonly creation?: ChangeProposalCreationStored["created"];
  readonly merge?: ChangeProposalMergeAnswer["merged"];
  readonly mergeReason?: ChangeProposalUnmergeableSettled;
  readonly mergeability?: ChangeProposalMergeability;
  readonly mergeCommit?: GitObjectId;
}

/**
 * What the store reads of one request. `approvalOpen` is the request live,
 * its newest attempt prepared and asking an approval, no permit for it, and
 * the approval its action asks still open; `landedCommit` is where the request
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
  readonly approvalOpen: boolean;
  readonly proposal?: TicketLandingProposal;
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

/** Where one landing stands, with the hold or the commit its state carries. */
export type TicketLandingStanding =
  | { readonly state: "Held"; readonly hold: TicketLandingHold }
  | { readonly state: "Landed"; readonly landedCommit: GitObjectId }
  | { readonly state: Exclude<TicketLandingState, "Held" | "Landed"> };

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
      return { state: "Unavailable" };
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
      if (record.approvalOpen) return { state: "AwaitingApproval" };
      return record.hold === undefined
        ? { state: "Running" }
        : { state: "Held", hold: record.hold };
    default:
      return assertNever(record.request);
  }
}

/** As many of a conflict's paths as one landing answers, cut where the manifest was or where they stop fitting. */
export function ticketLandingConflictBounded(
  conflict: ConflictSummary,
): ConflictSummary {
  const paths: string[] = [];
  let bytes = 0;
  for (const path of conflict.paths) {
    bytes += jsonTextBytes(path);
    if (bytes > ticketLandingConflictBytesMax)
      return { paths, truncated: true };
    paths.push(path);
  }
  return { paths, truncated: conflict.truncated };
}

/** The conflict one manifest records, or nothing where it was not found or the store could not be reached. */
async function ticketLandingConflict(
  ports: TicketLandingPorts,
  partition: Partition,
  artifact: ProjectArtifactId,
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
      return ticketLandingConflictBounded(conflict);
    }
    default:
      return assertNever(read);
  }
}

/** One request's pull request, its link kept only where a report could carry it. */
function ticketLandingProposal(
  proposal: TicketLandingProposal,
): TicketLandingProposal {
  const { url, ...rest } = proposal;
  return url !== undefined && isActionReportLink(url) ? { url, ...rest } : rest;
}

async function ticketLanding(
  ports: TicketLandingPorts,
  partition: Partition,
  record: TicketLandingRecord,
): Promise<TicketLanding> {
  const { attempt, conflictManifest } = record;
  const conflict =
    conflictManifest === undefined
      ? undefined
      : await ticketLandingConflict(ports, partition, conflictManifest);
  return {
    ...ticketLandingState(record),
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
  return { landings, truncated };
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
