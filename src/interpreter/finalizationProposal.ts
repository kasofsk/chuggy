/**
 * What a finalization that lands by opening a change proposal does once its
 * candidate is promoted: the request it opens, the durable rows that record it,
 * and the pure step that says which act comes next.
 *
 * THE PROMOTION IS NOT THE END OF A PULL REQUEST FINALIZATION. The candidate is
 * landed on the ticket's own branch exactly as a push with no target lands one —
 * the same conditional ref update, the same permit, the same reading — and the
 * proposal is what follows. A ticket concludes `FinalizationSucceeded` on
 * evidence that the forge holds a proposal for it: a create that answered with
 * evidence is that proof itself, and a create nobody heard back from is read
 * back by its marker under the ceilings this step is given. Who merges that
 * proposal, and when, is outside this machine entirely, so `model/` sees the
 * same success it always did.
 *
 * WHICH ANSWERS ARE WRITTEN DOWN IS DECIDED HERE AND NOWHERE ELSE. A forge that
 * would not be asked has said nothing about a proposal, so it is not recorded
 * as one and it releases the attempt it refused rather than spending the
 * request's only create. The caller performs the recording this step names and
 * decides none of it, which is what keeps the vocabulary in one place.
 *
 * THE BASE IS OBSERVED ONCE, AND ONLY TO ASK FOR THE PROPOSAL. A proposal is
 * opened into a branch, and a branch the remote does not hold is not one a
 * proposal can name — so an unreadable base holds the opening, and creating it
 * is nobody's job here: the promotion creates the branch the work lands on,
 * which is the head, and the base is somebody else's line of development. Once
 * the row exists the request is rebuilt from it, so a proposal already proved
 * concludes whatever became of the branch it was opened into afterwards.
 *
 * A HANDOFF NEVER PROPOSES. A handoff promotion lands in a repository the ticket
 * never worked in and carries its own publication afterwards, so the mode a
 * brief names says nothing about it and the promotion concludes as it always
 * has. This step is reached only under `RunFinalizer`.
 *
 * THIS STEP AWAITS NOTHING AND REACHES NO FORGE. The request, the durable row
 * and any observation they needed are gathered before it runs, so what it reads
 * of a proposal is what was written down about one and never what a forge says
 * now.
 */

import { assertNever } from "../domain/assertNever.ts";
import type { TicketId } from "../domain/ids.ts";
import {
  changeProposalPublicationNext,
  proposalBodyCharsMax,
  proposalTitleCharsMax,
  type ChangeProposalCreated,
  type ChangeProposalCreationAnswer,
  type ChangeProposalPublication,
  type ChangeProposalPublicationBounds,
  type ChangeProposalReconciled,
  type ChangeProposalReconciliationAnswer,
  type ChangeProposalRequest,
  type ChangeProposalRequestIdentity,
  type OpenedChangeProposalPublication,
  type ProposalMarker,
} from "./changeProposal.ts";
import type { CommitPermitId, FinalizationClaim } from "./finalizer.ts";
import type { FinalizationHoldKind } from "./finalizer.ts";
import { briefIntentLines, type BriefIntent } from "./ticketBrief.ts";

/** The lines a proposal's body puts between the ticket's own words and its marker. */
const finalizationProposalMarkerSeparator = "\n\n";

/**
 * Everything the step below reads of one proposal, absent where this deployment
 * could not build a request at all.
 */
export type FinalizationProposalGathered =
  | {
      readonly gathered: "Request";
      readonly request: ChangeProposalRequest;
      readonly publication: ChangeProposalPublication;
    }
  | { readonly gathered: "Unbound" }
  | { readonly gathered: "BaseUnreadable" };

/**
 * The one act a promoted candidate's proposal authorizes, in the finalizer's own
 * vocabulary. Every arm is performed by the caller; nothing here performs one.
 */
export type FinalizationProposalDecision =
  | {
      readonly decide: "ProposeChange";
      readonly request: ChangeProposalRequest;
    }
  | {
      readonly decide: "ReconcileProposal";
      readonly request: ChangeProposalRequest;
    }
  | { readonly decide: "RefuseProposalAttempt" }
  | { readonly decide: "Conclude" }
  | { readonly decide: "Hold"; readonly hold: FinalizationHoldKind };

/** The hold each reason a publication is held under is, named as this layer names it. */
function finalizationProposalHeld(
  reason: Extract<
    ReturnType<typeof changeProposalPublicationNext>,
    { next: "Held" }
  >["reason"],
): FinalizationHoldKind {
  switch (reason) {
    case "CreationsExhausted":
      return "ProposalCreationsExhausted";
    case "EvidenceUnstorable":
      return "ProposalEvidenceUnstorable";
    default:
      return assertNever(reason);
  }
}

/**
 * The one act one gathered proposal authorizes. A deployment that binds no forge
 * for the repository is denied rather than crashed, because a binding is
 * operational and a ticket is not evidence about one.
 */
export function finalizationProposalNext(
  gathered: FinalizationProposalGathered,
  bounds: ChangeProposalPublicationBounds,
): FinalizationProposalDecision {
  if (gathered.gathered === "Unbound")
    return { decide: "Hold", hold: "ProposalDenied" };
  if (gathered.gathered === "BaseUnreadable")
    return { decide: "Hold", hold: "ProposalBaseUnreadable" };
  const { request } = gathered;
  const next = changeProposalPublicationNext(
    request,
    gathered.publication,
    bounds,
  );
  switch (next.next) {
    case "Create":
      return { decide: "ProposeChange", request };
    case "Reconcile":
      return { decide: "ReconcileProposal", request };
    case "RefuseAttempt":
      return { decide: "RefuseProposalAttempt" };
    case "Accepted":
      return { decide: "Conclude" };
    case "Refused":
      return { decide: "Hold", hold: "ProposalRefused" };
    case "Held":
      return { decide: "Hold", hold: finalizationProposalHeld(next.reason) };
    default:
      return assertNever(next);
  }
}

/**
 * What one forge answer is written against the row, and what it leaves the pass
 * holding. Nothing here writes anything; the caller performs the arm it names.
 */
export type FinalizationProposalRecording =
  | {
      readonly record: "Creation";
      readonly created: ChangeProposalCreationAnswer;
    }
  | {
      readonly record: "Reconciliation";
      readonly reconciled: ChangeProposalReconciliationAnswer;
    }
  | { readonly record: "Refusal"; readonly hold: FinalizationHoldKind }
  | { readonly record: "Nothing"; readonly hold: FinalizationHoldKind }
  | { readonly record: "Unanswered" };

/**
 * What one create's answer is written down as. A forge that would not take the
 * create has said nothing about a proposal and released the attempt it refused,
 * and one that answered nothing at all leaves the attempt exactly where it is.
 */
export function finalizationProposalCreationRecording(
  created: ChangeProposalCreated,
): FinalizationProposalRecording {
  switch (created.created) {
    case "Created":
    case "AlreadyExists":
    case "Contradictory":
      return { record: "Creation", created };
    case "Unavailable":
      return { record: "Refusal", hold: "ProposalUnavailable" };
    case "Denied":
      return { record: "Refusal", hold: "ProposalDenied" };
    case "Ambiguous":
      return { record: "Unanswered" };
    default:
      return assertNever(created);
  }
}

/**
 * What one reading is written down as. A read that could not be made and one
 * the forge refused are answers about this deployment rather than about the
 * proposal, so neither is recorded and neither spends a reading.
 */
export function finalizationProposalReadingRecording(
  reconciled: ChangeProposalReconciled,
): FinalizationProposalRecording {
  switch (reconciled.reconciled) {
    case "Accepted":
    case "Absent":
    case "Contradictory":
      return { record: "Reconciliation", reconciled };
    case "Unavailable":
      return { record: "Nothing", hold: "ProposalUnavailable" };
    case "Denied":
      return { record: "Nothing", hold: "ProposalDenied" };
    default:
      return assertNever(reconciled);
  }
}

/** The longest prefix of a value that is at most `charsMax` and is still well formed. */
function finalizationProposalBounded(value: string, charsMax: number): string {
  if (value.length <= charsMax) return value;
  let bounded = "";
  for (const point of value) {
    if (bounded.length + point.length > charsMax) break;
    bounded += point;
  }
  return bounded;
}

/** The one line a proposal is titled with: the ticket it is for, and what it was asked for. */
export function finalizationProposalTitle(
  ticket: TicketId,
  intent: BriefIntent,
): string {
  const [first] = briefIntentLines(intent);
  return finalizationProposalBounded(
    `ticket ${String(ticket)}: ${first ?? ""}`,
    proposalTitleCharsMax,
  );
}

/**
 * The ticket's own words with the marker on a line of its own. The marker is
 * what a read recognises the proposal by, so the words are bounded to leave room
 * for it rather than the whole being truncated onto it.
 */
export function finalizationProposalBody(
  intent: BriefIntent,
  marker: ProposalMarker,
): string {
  const room =
    proposalBodyCharsMax -
    marker.length -
    finalizationProposalMarkerSeparator.length;
  if (room < 1) {
    throw new RangeError("proposal body: the marker leaves no room for words");
  }
  const stated = finalizationProposalBounded(
    briefIntentLines(intent).join("\n"),
    room,
  );
  return `${stated}${finalizationProposalMarkerSeparator}${marker}`;
}

/** One change proposal a finalization is about to open, under the permit that promoted its head. */
export interface ChangeProposalRecord {
  readonly claim: FinalizationClaim;
  readonly permit: CommitPermitId;
  readonly request: ChangeProposalRequest;
}

/** What one durable write against the row did, a refusal leaving the proposal where it stood. */
export type ChangeProposalWritten =
  { readonly wrote: "Row" } | { readonly wrote: "Nothing" };

/** One answer offered against that row: what a create returned, or what one reading read. */
export interface ChangeProposalResult {
  readonly claim: FinalizationClaim;
  readonly result:
    | {
        readonly records: "Creation";
        readonly created: ChangeProposalCreationAnswer;
      }
    | {
        readonly records: "Reconciliation";
        readonly reconciled: ChangeProposalReconciliationAnswer;
      };
}

/**
 * What one stored row says the forge was asked for. It is what the request is
 * rebuilt from on every later pass, so a proposal is reconciled and concluded
 * against what was actually sent rather than against what the brief and the
 * remote would produce now.
 */
export interface ChangeProposalAsked {
  readonly request: ChangeProposalRequestIdentity;
  readonly head: ChangeProposalRequest["head"];
  readonly base: ChangeProposalRequest["base"];
  readonly title: string;
  readonly body: string;
}

/** One stored proposal whole: what it asked the forge for, and what has come back. */
export interface StoredChangeProposal {
  readonly asked: ChangeProposalAsked;
  readonly publication: OpenedChangeProposalPublication;
}

/**
 * The durable rows one change proposal leaves, which the finalizer role reaches
 * and nothing else does. Every attempt is counted before the create it stands
 * for is called, so a crash between the two reads back as a create in flight.
 */
export interface FinalizerProposalStore {
  /** What one finalization's proposal asked for and has come to, absent until one is attempted. */
  changeProposal(
    claim: FinalizationClaim,
  ): Promise<StoredChangeProposal | undefined>;

  /** Counts one attempt, refused where a create is already in flight or answered. */
  markChangeProposalAttempt(
    record: ChangeProposalRecord,
  ): Promise<ChangeProposalWritten>;

  /** Records that the attempt in flight was never taken, which releases it. */
  refuseChangeProposalAttempt(
    claim: FinalizationClaim,
  ): Promise<ChangeProposalWritten>;

  /** Records one answer against that row, the creation's being writable exactly once. */
  recordChangeProposal(
    record: ChangeProposalResult,
  ): Promise<ChangeProposalWritten>;
}
