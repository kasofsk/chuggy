/**
 * One queue candidate as a row answers it, read the one way the finalizer's
 * claim and the API's read of a project's landing queues both read it, so the
 * two cannot disagree about a ticket's reference or its rank.
 */

import { phaseRoster } from "../../contract/rosters.ts";
import { asTicketId } from "../../domain/ids.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import type { SerializedCandidate } from "../../interpreter/serializedHolder.ts";
import { briefLandsOn } from "../../interpreter/ticketBrief.ts";
import { finalizerRowPresent, finalizerRowValue } from "./finalizerRows.ts";
import { projectRowCounter } from "./rows.ts";
import { releasedBriefOf } from "./ticketBrief.ts";

/** One ticket on the path to its landing: its brief as released, and its rank where it has one. */
export interface SerializedCandidateRow {
  readonly ticket: string | null;
  readonly phase: string | null;
  readonly brief: string | null;
  readonly rank: string | null;
}

/** `row` as a queue reads it, the ticket of `partition`. */
export function serializedCandidateOfRow(
  partition: Partition,
  row: SerializedCandidateRow,
): SerializedCandidate {
  const brief = releasedBriefOf(row.brief);
  return {
    partition,
    ticket: asTicketId(
      projectRowCounter(
        finalizerRowPresent(row.ticket, "serialized ticket"),
        "serialized ticket",
      ),
    ),
    phase: finalizerRowValue(
      phaseRoster,
      finalizerRowPresent(row.phase, "ticket phase"),
      "ticket phase",
    ),
    finalization: brief?.finalization,
    repository: brief?.repository,
    target: brief === undefined ? undefined : briefLandsOn(brief),
    rank:
      row.rank === null
        ? undefined
        : projectRowCounter(row.rank, "serialized rank"),
  };
}
