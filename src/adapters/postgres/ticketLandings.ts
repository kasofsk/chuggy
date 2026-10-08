/**
 * PostgreSQL reads for a ticket's landings, through the one door that reads
 * the finalizer's rows for the API.
 *
 * THE TICKET IS FOUND FIRST in the projection the API already reads, so a
 * ticket the project does not have is told from one that has had no landing.
 *
 * A COLUMN THE DOOR ANSWERS IS NARROWED TO ITS ROSTER HERE, and a value no
 * writer of this tree can have stored fails the read rather than reaching a
 * reader as a code it was never told of.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import {
  finalizationUnavailableKinds,
  type FinalizationUnavailableKind,
} from "../../contract/rosters.ts";
import type { TicketId } from "../../domain/ids.ts";
import {
  allChangeProposalCreationsStored,
  allChangeProposalMergeabilities,
  allChangeProposalMergeAnswers,
  allChangeProposalUnmergeableSettled,
} from "../../interpreter/changeProposal.ts";
import {
  allFinalizationAttemptOutcomes,
  allFinalizationFailureKinds,
  allFinalizationRequestStates,
  asGitObjectId,
} from "../../interpreter/finalizer.ts";
import { asProjectArtifactId } from "../../interpreter/finalizerPreparation.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import { asPublicInstant } from "../../interpreter/publicResource.ts";
import {
  type TicketLandingAttempt,
  type TicketLandingConclusion,
  type TicketLandingHold,
  type TicketLandingProposal,
  type TicketLandingRecord,
  type TicketLandingsStore,
} from "../../interpreter/ticketLandings.ts";
import { finalizerRowPresent, finalizerRowValue } from "./finalizerRows.ts";
import { projectRowCounter } from "./rows.ts";

/** One request as the door answers it, every column nullable because the door is reached through an outer join. */
interface TicketLandingRow {
  readonly request: string | null;
  readonly authorizing_seq: string | null;
  readonly work_cycle: string | null;
  readonly finalization_generation: string | null;
  readonly state: string | null;
  readonly concluded: string | null;
  readonly hold_kind: string | null;
  readonly hold_passes: number | null;
  readonly held_since: string | null;
  readonly attempts: number | null;
  readonly outcome: string | null;
  readonly failure_kind: string | null;
  readonly target_ref: string | null;
  readonly target_commit: string | null;
  readonly candidate_commit: string | null;
  readonly prepared_at: string | null;
  readonly conflict_manifest: string | null;
  readonly approval_open: boolean | null;
  readonly proposed: boolean | null;
  readonly head_ref: string | null;
  readonly base_ref: string | null;
  readonly creation: string | null;
  readonly url: string | null;
  readonly merge: string | null;
  readonly merge_reason: string | null;
  readonly mergeability: string | null;
  readonly merge_commit: string | null;
  readonly landed_commit: string | null;
}

/** The event names a conclusion is journalled under, beside the conclusion each names. */
const ticketLandingConclusionEvents: Readonly<
  Record<string, TicketLandingConclusion>
> = {
  TicketFinalizationSucceeded: "Succeeded",
  TicketFinalizationNeedsWork: "NeedsWork",
  TicketFinalizationUnavailable: "Unavailable",
};

function ticketLandingConclusion(
  event: string | null,
): TicketLandingConclusion | undefined {
  if (event === null) return undefined;
  const concluded = ticketLandingConclusionEvents[event];
  if (concluded === undefined)
    throw new Error(`ticket landings: ${event} concludes no finalization`);
  return concluded;
}

function ticketLandingHold(
  row: TicketLandingRow,
): TicketLandingHold | undefined {
  if (row.hold_kind === null) return undefined;
  const kinds: readonly FinalizationUnavailableKind[] =
    finalizationUnavailableKinds;
  return {
    kind: finalizerRowValue(kinds, row.hold_kind, "hold kind"),
    passes: finalizerRowPresent(row.hold_passes, "hold passes"),
    since: asPublicInstant(finalizerRowPresent(row.held_since, "held since")),
  };
}

function ticketLandingAttempt(
  row: TicketLandingRow,
): TicketLandingAttempt | undefined {
  if (row.outcome === null) return undefined;
  return {
    outcome: finalizerRowValue(
      allFinalizationAttemptOutcomes,
      row.outcome,
      "attempt outcome",
    ),
    ...(row.failure_kind === null
      ? {}
      : {
          failureKind: finalizerRowValue(
            allFinalizationFailureKinds,
            row.failure_kind,
            "failure kind",
          ),
        }),
    targetRef: finalizerRowPresent(row.target_ref, "target ref"),
    targetCommit: asGitObjectId(
      finalizerRowPresent(row.target_commit, "target commit"),
    ),
    ...(row.candidate_commit === null
      ? {}
      : { candidateCommit: asGitObjectId(row.candidate_commit) }),
    preparedAt: asPublicInstant(
      finalizerRowPresent(row.prepared_at, "prepared at"),
    ),
  };
}

/** The codes a proposal's row may hold, each present where the row holds it. */
function ticketLandingProposalCodes(
  row: TicketLandingRow,
): Omit<TicketLandingProposal, "url" | "headRef" | "baseRef" | "mergeCommit"> {
  return {
    ...(row.creation === null
      ? {}
      : {
          creation: finalizerRowValue(
            allChangeProposalCreationsStored,
            row.creation,
            "proposal creation",
          ),
        }),
    ...(row.merge === null
      ? {}
      : {
          merge: finalizerRowValue(
            allChangeProposalMergeAnswers,
            row.merge,
            "proposal merge",
          ),
        }),
    ...(row.merge_reason === null
      ? {}
      : {
          mergeReason: finalizerRowValue(
            allChangeProposalUnmergeableSettled,
            row.merge_reason,
            "merge reason",
          ),
        }),
    ...(row.mergeability === null
      ? {}
      : {
          mergeability: finalizerRowValue(
            allChangeProposalMergeabilities,
            row.mergeability,
            "mergeability",
          ),
        }),
  };
}

function ticketLandingProposal(
  row: TicketLandingRow,
): TicketLandingProposal | undefined {
  if (row.proposed !== true) return undefined;
  return {
    ...(row.url === null ? {} : { url: row.url }),
    headRef: finalizerRowPresent(row.head_ref, "head ref"),
    baseRef: finalizerRowPresent(row.base_ref, "base ref"),
    ...ticketLandingProposalCodes(row),
    ...(row.merge_commit === null
      ? {}
      : { mergeCommit: asGitObjectId(row.merge_commit) }),
  };
}

function ticketLandingRecord(row: TicketLandingRow): TicketLandingRecord {
  const concluded = ticketLandingConclusion(row.concluded);
  const hold = ticketLandingHold(row);
  const attempt = ticketLandingAttempt(row);
  const proposal = ticketLandingProposal(row);
  return {
    cycle: projectRowCounter(
      finalizerRowPresent(row.work_cycle, "work cycle"),
      "work cycle",
    ),
    generation: projectRowCounter(
      finalizerRowPresent(row.finalization_generation, "generation"),
      "generation",
    ),
    request: finalizerRowValue(
      allFinalizationRequestStates,
      finalizerRowPresent(row.state, "request state"),
      "request state",
    ),
    ...(concluded === undefined ? {} : { concluded }),
    ...(hold === undefined ? {} : { hold }),
    attempts: finalizerRowPresent(row.attempts, "attempts"),
    ...(attempt === undefined ? {} : { attempt }),
    ...(row.conflict_manifest === null
      ? {}
      : { conflictManifest: asProjectArtifactId(row.conflict_manifest) }),
    approvalOpen: finalizerRowPresent(row.approval_open, "approval open"),
    ...(proposal === undefined ? {} : { proposal }),
    ...(row.landed_commit === null
      ? {}
      : { landedCommit: asGitObjectId(row.landed_commit) }),
  };
}

async function ticketLandingsRead(
  pool: pg.Pool,
  partition: Partition,
  ticket: TicketId,
  count: number,
): Promise<readonly TicketLandingRecord[] | undefined> {
  const found = await pool.query<TicketLandingRow>(
    sql`SELECT l.request,l.authorizing_seq::text AS authorizing_seq,
               l.work_cycle::text AS work_cycle,
               l.finalization_generation::text AS finalization_generation,
               l.state,l.concluded,l.hold_kind,l.hold_passes,
               to_char(l.held_since AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')::text AS held_since,
               l.attempts,l.outcome,l.failure_kind,l.target_ref,l.target_commit,
               l.candidate_commit,
               to_char(l.prepared_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')::text AS prepared_at,
               l.conflict_manifest,l.approval_open,l.proposed,l.head_ref,
               l.base_ref,l.creation,l.url,l.merge,l.merge_reason,
               l.mergeability,l.merge_commit,l.landed_commit
          FROM ticket_projection t
          LEFT JOIN LATERAL read_ticket_landings(t.tenant,t.project,t.ticket,${count}::integer) l
            ON true
         WHERE t.tenant=${partition.tenant} AND t.project=${partition.project}
           AND t.ticket=${ticket}
         ORDER BY l.authorizing_seq,l.request`,
  );
  if (found.rows.length === 0) return undefined;
  return found.rows
    .filter((row) => row.request !== null)
    .map(ticketLandingRecord);
}

export function postgresTicketLandings(pool: pg.Pool): TicketLandingsStore {
  return {
    landings: (partition, ticket, count) =>
      ticketLandingsRead(pool, partition, ticket, count),
  };
}
