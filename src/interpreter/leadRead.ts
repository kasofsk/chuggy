/**
 * What a project's owner may read of its lead: the session's standing and the
 * tail of its mailbox.
 *
 * THE NOTE IS PREVIEWED RATHER THAN CARRIED. A handoff note may weigh a whole
 * wire body on its own, and this read carries a mailbox tail and a stream
 * listing beside it, so the note crosses as its size and its leading
 * characters. A reader that needs the note whole is the lead itself, and it is
 * given the note in its observation rather than over the wire.
 */

import {
  selectorHandoffNotePreviewCharsMax,
  textCodePointsCount,
} from "../contract/http.ts";
import type {
  SessionId,
  SessionState,
  SessionTurnFailure,
  SessionTurnId,
  SessionTurnInputKind,
  SessionTurnMeasured,
  SessionTurnState,
} from "./agentSession.ts";
import type { SessionStoreStreamRow } from "./sessionPlane.ts";
import type {
  LeadAbsenceUntimed,
  LeadAdmissionRefusal,
  LeadHold,
} from "../contract/rosters.ts";
import type { SessionStoreRowsRead } from "./sessionTranscriptPage.ts";
import type { Partition } from "./projectStore.ts";
import type { SubsidizedLeadSpend } from "./sessionPlacement.ts";
import type { JsonValue, SelectorProjectState } from "./selector.ts";

/** One turn of the lead's mailbox as a reader sees it; its input is not a reader's business. */
export interface LeadTurnRecord {
  readonly turn: SessionTurnId;
  readonly ordinal: number;
  readonly inputKind: SessionTurnInputKind;
  readonly state: SessionTurnState;
  readonly failure?: SessionTurnFailure;
  readonly measured?: SessionTurnMeasured;
  readonly batchFirst?: number;
  readonly batchLast?: number;
}

/** The project's lead, what it decided under, and the tail of its mailbox. */
export interface LeadStanding {
  readonly session: SessionId;
  readonly state: SessionState;
  readonly agentReference?: string;
  readonly attention: SelectorProjectState["attention"];
  readonly notificationCursor: number;
  readonly handoffNote: JsonValue;
  readonly turns: readonly LeadTurnRecord[];
}

/**
 * The API's own door onto one project's lead and the rows of its store. It
 * READS ROWS THROUGH THE SESSION-KEYED PORT rather than declaring a lead-only
 * one, because 062 retired the two definers that were keyed on `kind='Lead'`:
 * a thread's transcript is this walk over a different session, and two reads
 * differing in one predicate is where a fix lands in only one of them.
 */
export interface LeadReadStore extends SessionStoreRowsRead {
  /** The lead's standing with at most `turnsMax` of its mailbox, newest last. */
  standing(
    partition: Partition,
    turnsMax: number,
  ): Promise<LeadStanding | undefined>;
  /** Every stream one session's store holds, with the batches standing under each. */
  streams(
    partition: Partition,
    session: SessionId,
    limit: number,
  ): Promise<readonly SessionStoreStreamRow[]>;
  /** The lead refusal the selector keeps for the project, or nothing where none stands. */
  leadRefusal(partition: Partition): Promise<LeadRefused | undefined>;
  /** What the project's tenant and the deployment spent of the subsidy this month, absent where its lead runs as its own. */
  subsidizedLeadSpend(
    partition: Partition,
  ): Promise<SubsidizedLeadSpend | undefined>;
}

/** What a subsidized lead's tenant spent of the subsidy this month, beside its cap. */
export interface LeadSubsidy {
  readonly tenantMicros: number;
  readonly tenantMonthlyMicros: number;
}

/**
 * What the last selector cycle that needed a project's lead was refused
 * admission for, kept only until a cycle is admitted or has nothing to decide,
 * and since when that has been the answer. `until` is when a `UsagePaused`
 * refusal's pause ends as it stands at the read, absent where none holds now
 * or where `off` says only credentials turned off hold every live pool, and
 * the next month's first instant for `SubsidyExhausted`.
 */
export interface LeadRefused {
  readonly reason: LeadAdmissionRefusal;
  readonly since: string;
  readonly until?: string;
  readonly off?: true;
}

/** Why a project holds no lead: a reason no refusal dates, or the refusal the
 * selector keeps. */
export type LeadAbsence = { readonly reason: LeadAbsenceUntimed } | LeadRefused;

/** What holds a lead from dispatching whether or not it stands, outranking any refusal kept. */
export interface LeadHeld {
  readonly reason: LeadHold;
}

/** The absence of a project no refusal stands for and no released ticket waits in. */
export const leadNotNeeded: LeadAbsence = { reason: "NotNeeded" };

/** The absence of a project whose selector is paused, whatever refusal it keeps. */
export const leadPaused: LeadHeld = { reason: "Paused" };

/** The absence of a project the site's selector may not read, whatever refusal it keeps. */
export const leadSelectorNotGranted: LeadHeld = {
  reason: "SelectorNotGranted",
};

/** The absence of a project no refusal stands for and a released ticket waits in. */
export const leadAwaitingSelector: LeadAbsence = { reason: "AwaitingSelector" };

/** The absence of a project a released ticket waits in where no selector is named to reach it. */
export const leadSelectorUnnamed: LeadAbsence = { reason: "SelectorUnnamed" };

/** How large the handoff note is, and as much of it as the lead read carries. */
export interface HandoffNotePreview {
  readonly bytes: number;
  readonly preview: string;
  readonly truncated: boolean;
}

/**
 * A lead that holds a session carries what holds it from dispatching, where a
 * project holding none would answer `Paused` or `SelectorNotGranted`, the
 * refusal the selector keeps for it, where one stands and nothing holds it, and
 * a subsidized one its tenant's spend this month.
 */
export type LeadRead =
  | { readonly result: "NotFound" }
  | { readonly result: "None"; readonly absence: LeadAbsence }
  | {
      readonly result: "Found";
      readonly lead: LeadStanding;
      readonly streams: readonly SessionStoreStreamRow[];
      readonly held?: LeadHeld;
      readonly refusal?: LeadRefused;
      readonly subsidy?: LeadSubsidy;
    };

/** The note as the lead read carries it: its whole size, and its leading characters. */
export function handoffNotePreview(note: JsonValue): HandoffNotePreview {
  const text = JSON.stringify(note ?? null) ?? "null";
  return {
    bytes: new TextEncoder().encode(text).byteLength,
    preview: [...text].slice(0, selectorHandoffNotePreviewCharsMax).join(""),
    truncated: textCodePointsCount(text) > selectorHandoffNotePreviewCharsMax,
  };
}
