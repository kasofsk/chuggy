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
 * back by its marker under the ceilings this step is given. Under
 * `PullRequestMerge` the finalizer then asks the forge to merge that proposal
 * and the ticket concludes on proof of the merge instead — the approval that
 * gated the promotion being the only human gate either landing has, and the
 * forge's own rules still refusing whatever this step asks, so `model/` sees
 * the same four outcomes it always did.
 *
 * WHICH ANSWERS ARE WRITTEN DOWN IS DECIDED HERE AND NOWHERE ELSE. A forge that
 * would not be asked has said nothing about a proposal, so it is not recorded
 * as one and the attempt it declined is released without spending one of the
 * creates the request is allowed — the deployment holds and asks again, as it
 * does for every other answer about itself. The caller performs the recording
 * this step names and decides none of it, which is what keeps the vocabulary in
 * one place.
 *
 * THE BASE IS OBSERVED ONCE, AND ONLY TO ASK FOR THE PROPOSAL. A proposal is
 * opened into a branch, and a branch the remote does not hold is not one a
 * proposal can name — so an unreadable base holds the opening, and creating it
 * is nobody's job here: the promotion creates the branch the work lands on,
 * which is the head, and the base is somebody else's line of development. Once
 * the row exists the request is rebuilt from it, so a proposal already proved
 * concludes whatever became of the branch it was opened into afterwards.
 *
 * THIS STEP AWAITS NOTHING AND REACHES NO FORGE. The request, the durable row
 * and any observation they needed are gathered before it runs, so what it reads
 * of a proposal is what was written down about one and never what a forge says
 * now.
 */

import { textCodePointsCount } from "../contract/http.ts";
import type { BriefFinalizationMode } from "../contract/rosters.ts";
import { assertNever } from "../domain/assertNever.ts";
import type { TicketId } from "../domain/ids.ts";
import {
  changeProposalMergeNext,
  changeProposalAddressed,
  changeProposalMergeRequest,
  changeProposalPublicationNext,
  proposalBodyCharsMax,
  proposalTitleCharsMax,
  type ChangeProposalCreated,
  type ChangeProposalCreationAnswer,
  type ChangeProposalEvidence,
  type ChangeProposalMerged,
  type ChangeProposalMergedStanding,
  type ChangeProposalMergeAnswer,
  type ChangeProposalMergeReconciled,
  type ChangeProposalMergeReconciliationAnswer,
  type ChangeProposalMergeRequest,
  type ChangeProposalMerging,
  type ChangeProposalMergingBounds,
  type ChangeProposalPublication,
  type ChangeProposalPublicationBounds,
  type ChangeProposalReconciled,
  type ChangeProposalReconciliationAnswer,
  type ChangeProposalRequest,
  type ChangeProposalRequestIdentity,
  type OpenedChangeProposalPublication,
  type ProposalMarker,
} from "./changeProposal.ts";
import { allClosingLifecycles } from "./finalizer.ts";
import type { CommitPermitId, FinalizationClaim } from "./finalizer.ts";
import type { FinalizationHoldKind } from "./finalizer.ts";
import type { Lifecycle } from "./projectStore.ts";
import {
  briefIntentLines,
  type BriefIntent,
  type DraftBrief,
} from "./ticketBrief.ts";

/** The lines a proposal's body puts between the ticket's own words and its marker. */
const finalizationProposalMarkerSeparator = "\n\n";

/**
 * Everything the step below reads of one proposal, absent where this deployment
 * could not build a request at all and where the base read for it turned out to
 * be the head it would be opened from.
 */
export type FinalizationProposalGathered =
  | {
      readonly gathered: "Request";
      readonly request: ChangeProposalRequest;
      readonly publication: ChangeProposalPublication;
      readonly merging: ChangeProposalMerging;
    }
  | { readonly gathered: "Unbound" }
  | { readonly gathered: "BaseUnreadable" }
  | { readonly gathered: "BaseIsHead" };

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
  | {
      readonly decide: "MergeProposal";
      readonly request: ChangeProposalRequest;
      readonly merge: ChangeProposalMergeRequest;
    }
  | {
      readonly decide: "ReconcileMerge";
      readonly request: ChangeProposalRequest;
      readonly merge: ChangeProposalMergeRequest;
    }
  | { readonly decide: "RefuseMergeAttempt" }
  | { readonly decide: "RecordMergeConflict" }
  | { readonly decide: "Abort" }
  | { readonly decide: "Conclude" }
  | { readonly decide: "Hold"; readonly hold: FinalizationHoldKind };

/** What the finalization itself brings to this step: how its brief lands, and what its project will still admit. */
export interface FinalizationProposalStanding {
  readonly mode: BriefFinalizationMode | undefined;
  readonly lifecycle: Lifecycle;
}

/** The ceilings the two halves of one proposal are continued under. */
export interface FinalizationProposalBounds {
  readonly publication: ChangeProposalPublicationBounds;
  readonly merging: ChangeProposalMergingBounds;
}

/**
 * What a proposal the forge has already merged is to a landing: the thing it
 * asked for where it would have merged the proposal itself, and a contradiction
 * where merging it was somebody else's to do.
 */
export function finalizationProposalMergedStanding(
  mode: BriefFinalizationMode | undefined,
): ChangeProposalMergedStanding {
  return mode === "PullRequestMerge" ? "Accepted" : "Contradictory";
}

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

/** The hold each reason a merge is held under is, named as this layer names it. */
function finalizationProposalMergeHeld(
  reason: Extract<
    ReturnType<typeof changeProposalMergeNext>,
    { next: "Held" }
  >["reason"],
): FinalizationHoldKind {
  switch (reason) {
    case "MergesExhausted":
      return "ProposalMergesExhausted";
    case "Blocked":
      return "ProposalMergeBlocked";
    case "ProposalAbsent":
      return "ProposalAbsent";
    case "EvidenceUnstorable":
      return "ProposalEvidenceUnstorable";
    default:
      return assertNever(reason);
  }
}

/**
 * What one settled merge answer leaves the finalization to do. A head the forge
 * found moved is held rather than merged again, because the commit the permit
 * landed is the only one this request ever asked to have merged.
 */
function finalizationProposalMerged(
  merge: ChangeProposalMergeAnswer,
): FinalizationProposalDecision {
  switch (merge.merged) {
    case "Merged":
      return { decide: "Conclude" };
    case "HeadMoved":
      return { decide: "Hold", hold: "ProposalHeadMoved" };
    case "NotMergeable":
      return merge.reason === "Conflict"
        ? { decide: "RecordMergeConflict" }
        : { decide: "Hold", hold: "ProposalMergeBlocked" };
    default:
      return assertNever(merge);
  }
}

/**
 * The one act a merge address authorizes, and a hold where the evidence names
 * a proposal no number addresses. Evidence stored before a landing could merge
 * carries no number, and a proposal nothing can be asked of is an operator's
 * to settle rather than a reason to stop reading the row.
 */
function finalizationProposalAddressed(
  request: ChangeProposalRequest,
  evidence: ChangeProposalEvidence,
  decide: "MergeProposal" | "ReconcileMerge",
): FinalizationProposalDecision {
  const proposal = changeProposalAddressed(evidence.identity);
  if (proposal === undefined)
    return { decide: "Hold", hold: "ProposalUnaddressed" };
  const merge = changeProposalMergeRequest({
    binding: request.binding,
    partition: request.partition,
    repository: request.repository,
    proposal,
    marker: request.marker,
    headCommit: request.head.commit,
  });
  return { decide, request, merge };
}

/**
 * What one proved proposal's merge authorizes. A proposal the create already
 * found merged is the success it asked for and reaches no forge again; a
 * project that will admit no further irreversible act aborts rather than
 * merges; and a merge already in flight is read back whatever the lifecycle
 * says, the forge being the only authority on whether it landed.
 */
function finalizationProposalMergeNext(
  finalization: FinalizationProposalStanding,
  request: ChangeProposalRequest,
  evidence: ChangeProposalEvidence,
  merging: ChangeProposalMerging,
  bounds: ChangeProposalMergingBounds,
): FinalizationProposalDecision {
  if (evidence.status === "Merged" && evidence.mergeCommit !== undefined)
    return { decide: "Conclude" };
  const next = changeProposalMergeNext(request, merging, bounds);
  switch (next.next) {
    case "Merge":
      return allClosingLifecycles.includes(finalization.lifecycle)
        ? { decide: "Abort" }
        : finalizationProposalAddressed(request, evidence, "MergeProposal");
    case "ReadByNumber":
      return finalizationProposalAddressed(request, evidence, "ReconcileMerge");
    case "RefuseAttempt":
      return { decide: "RefuseMergeAttempt" };
    case "Concluded":
      return finalizationProposalMerged(next.merge);
    case "Refused":
      return { decide: "Hold", hold: "ProposalRefused" };
    case "Held":
      return {
        decide: "Hold",
        hold: finalizationProposalMergeHeld(next.reason),
      };
    default:
      return assertNever(next);
  }
}

/**
 * The one act one gathered proposal authorizes. A deployment that binds no forge
 * for the repository is denied rather than crashed, because a binding is
 * operational and a ticket is not evidence about one.
 */
export function finalizationProposalNext(
  finalization: FinalizationProposalStanding,
  gathered: FinalizationProposalGathered,
  bounds: FinalizationProposalBounds,
): FinalizationProposalDecision {
  if (gathered.gathered === "Unbound")
    return { decide: "Hold", hold: "ProposalDenied" };
  if (gathered.gathered === "BaseUnreadable")
    return { decide: "Hold", hold: "ProposalBaseUnreadable" };
  if (gathered.gathered === "BaseIsHead")
    return { decide: "Hold", hold: "ProposalBaseIsHead" };
  const { request } = gathered;
  const merged = finalizationProposalMergedStanding(finalization.mode);
  const merges = merged === "Accepted";
  const next = changeProposalPublicationNext(
    request,
    gathered.publication,
    bounds.publication,
    merged,
  );
  switch (next.next) {
    case "Create":
      return { decide: "ProposeChange", request };
    case "Reconcile":
      return { decide: "ReconcileProposal", request };
    case "RefuseAttempt":
      return { decide: "RefuseProposalAttempt" };
    case "Accepted":
      return merges
        ? finalizationProposalMergeNext(
            finalization,
            request,
            next.evidence,
            gathered.merging,
            bounds.merging,
          )
        : { decide: "Conclude" };
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
  | { readonly record: "Decline"; readonly hold: FinalizationHoldKind }
  | { readonly record: "Nothing"; readonly hold: FinalizationHoldKind }
  | { readonly record: "Unanswered" };

/**
 * What one create's answer is written down as. A forge that would not take the
 * create has said nothing about a proposal, so the attempt it declined is
 * released and the create it stood for is unspent; one that answered nothing at
 * all leaves the attempt exactly where it is.
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
      return { record: "Decline", hold: "ProposalUnavailable" };
    case "Denied":
      return { record: "Decline", hold: "ProposalDenied" };
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

/**
 * What one forge answer about merging is written against the row, and what it
 * leaves the pass holding. Nothing here writes anything; the caller performs
 * the arm it names.
 */
export type FinalizationProposalMergeRecording =
  | { readonly record: "Merge"; readonly merged: ChangeProposalMergeAnswer }
  | {
      readonly record: "Reading";
      readonly reconciled: ChangeProposalMergeReconciliationAnswer;
    }
  | { readonly record: "Decline"; readonly hold: FinalizationHoldKind }
  | { readonly record: "Nothing"; readonly hold: FinalizationHoldKind }
  | { readonly record: "Unanswered" };

/**
 * What one merge's answer is written down as. A forge that would not take the
 * merge has said nothing about it, so the attempt it declined is released and
 * the merge it stood for is unspent; one that refused without naming a reason
 * has said nothing a row settles on, and is read back like an answer nobody
 * heard at all.
 */
export function finalizationProposalMergeRecording(
  merged: ChangeProposalMerged,
): FinalizationProposalMergeRecording {
  switch (merged.merged) {
    case "Merged":
    case "HeadMoved":
      return { record: "Merge", merged };
    case "NotMergeable":
      return merged.reason === "Unknown"
        ? { record: "Unanswered" }
        : {
            record: "Merge",
            merged: { merged: "NotMergeable", reason: merged.reason },
          };
    case "Unavailable":
      return { record: "Decline", hold: "ProposalUnavailable" };
    case "Denied":
      return { record: "Decline", hold: "ProposalDenied" };
    case "Ambiguous":
      return { record: "Unanswered" };
    default:
      return assertNever(merged);
  }
}

/**
 * What one reading of a merge is written down as. A read that could not be made
 * and one the forge refused are answers about this deployment rather than about
 * the proposal, so neither is recorded and neither spends a reading.
 */
export function finalizationProposalMergeReadingRecording(
  reconciled: ChangeProposalMergeReconciled,
): FinalizationProposalMergeRecording {
  switch (reconciled.reconciled) {
    case "Accepted":
    case "Unmerged":
    case "Absent":
    case "Contradictory":
      return { record: "Reading", reconciled };
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
  return textCodePointsCount(value) <= charsMax
    ? value
    : [...value].slice(0, charsMax).join("");
}

/**
 * The one line a proposal is titled with: the ticket it is for, and what it is
 * called — the brief's own title where it names one, and the first line of its
 * intent where it does not.
 */
export function finalizationProposalTitle(
  ticket: TicketId,
  brief: Pick<DraftBrief, "title" | "intent">,
): string {
  const [first] = briefIntentLines(brief.intent);
  return finalizationProposalBounded(
    `ticket ${String(ticket)}: ${brief.title ?? first ?? ""}`,
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

/** One answer offered against the merge half of that row: what a merge returned, or what one reading read. */
export interface ChangeProposalMergeResult {
  readonly claim: FinalizationClaim;
  readonly result:
    | { readonly records: "Merge"; readonly merged: ChangeProposalMergeAnswer }
    | {
        readonly records: "Reading";
        readonly reconciled: ChangeProposalMergeReconciliationAnswer;
      };
}

/** One stored proposal whole: what it asked the forge for, and what has come back. */
export interface StoredChangeProposal {
  readonly asked: ChangeProposalAsked;
  readonly publication: OpenedChangeProposalPublication;
  readonly merging: ChangeProposalMerging;
}

/**
 * The durable rows one change proposal leaves, which the finalizer role reaches
 * and nothing else does. Every attempt is counted before the create it stands
 * for is called and every write is fenced on the claim, so a crash between the
 * two reads back as a create in flight and a holder a takeover has retired
 * writes nothing at all.
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

  /** Records that no reading found the create in flight, which releases the attempt it spent. */
  refuseChangeProposalAttempt(
    claim: FinalizationClaim,
  ): Promise<ChangeProposalWritten>;

  /** Records that the forge would not take the create, which releases the attempt unspent. */
  declineChangeProposalAttempt(
    claim: FinalizationClaim,
  ): Promise<ChangeProposalWritten>;

  /** Records one answer against that row, the creation's being writable exactly once. */
  recordChangeProposal(
    record: ChangeProposalResult,
  ): Promise<ChangeProposalWritten>;

  /** Counts one merge attempt, refused where a merge is already in flight or answered. */
  markChangeProposalMergeAttempt(
    claim: FinalizationClaim,
  ): Promise<ChangeProposalWritten>;

  /** Records that no reading found the merge in flight, which releases the attempt it spent. */
  refuseChangeProposalMergeAttempt(
    claim: FinalizationClaim,
  ): Promise<ChangeProposalWritten>;

  /** Records that the forge would not take the merge, which releases the attempt unspent. */
  declineChangeProposalMergeAttempt(
    claim: FinalizationClaim,
  ): Promise<ChangeProposalWritten>;

  /** Records one answer about merging against that row, the merge's being writable exactly once. */
  recordChangeProposalMerge(
    record: ChangeProposalMergeResult,
  ): Promise<ChangeProposalWritten>;
}
