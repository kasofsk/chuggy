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
 * A MERGE WAITING ON THE FORGE IS HELD, AND ONE CLOSED UNMERGED ESCALATES ONLY
 * IF IT STAYS CLOSED. The forge's own rules and a head somebody else moved both
 * wait on a person at the forge, which a resume would not hurry, so each holds
 * off `finalizationUnavailableKinds` for as long as the forge says so. A
 * proposal closed unmerged is read again on the same cadence while it holds as
 * `ProposalAbsent`, every pass counting toward that dwell, so one a person
 * reopens waits again and one that stays closed escalates once the dwell is
 * spent.
 *
 * THE FINALIZER MERGES ONLY THE HEAD PINNED FOR IT, AND A MERGE ANYBODY MADE
 * LANDS. Its own merge is conditional on the promoted candidate or on a head
 * git proved is that candidate brought up to date with the base, so it never
 * merges a change nobody evaluated; a merge the forge reports, by whoever made
 * it and at whatever head, is a person's decision at the forge and concludes
 * `FinalizationSucceeded`, and the landing's read names the head that was
 * merged wherever it is not the one proposed.
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
  type ChangeProposalMergeConcluded,
  type ChangeProposalMergeGathered,
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
  type ChangeProposalUpdated,
  type ChangeProposalUpdating,
  type OpenedChangeProposalPublication,
  type ProposalMarker,
} from "./changeProposal.ts";
import { allClosingLifecycles } from "./finalizer.ts";
import type {
  CommitPermitId,
  FinalizationClaim,
  GitObjectId,
} from "./finalizer.ts";
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
      readonly merge: ChangeProposalMergeGathered;
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
  | {
      readonly decide: "UpdateProposal";
      readonly request: ChangeProposalRequest;
      readonly merge: ChangeProposalMergeRequest;
    }
  | { readonly decide: "AdoptProposalHead"; readonly head: GitObjectId }
  | { readonly decide: "RefuseMergeAttempt" }
  | { readonly decide: "WaitMergeAttempt"; readonly hold: FinalizationHoldKind }
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

/**
 * The hold each reason a merge is held under is, named as this layer names it.
 * A proposal closed unmerged is held as one absent, because either is a merge
 * no reading can land and a resume replaces it with a proposal of its own; and
 * updates spent are merges spent, an update being an act this request asks of
 * the forge toward its merge and counted afresh by the same resume.
 */
function finalizationProposalMergeHeld(
  reason: Extract<
    ReturnType<typeof changeProposalMergeNext>,
    { next: "Held" }
  >["reason"],
): FinalizationHoldKind {
  switch (reason) {
    case "MergesExhausted":
    case "UpdatesExhausted":
      return "ProposalMergesExhausted";
    case "Blocked":
      return "ProposalMergeBlocked";
    case "HeadMoved":
      return "ProposalHeadMoved";
    case "Closed":
    case "ProposalAbsent":
      return "ProposalAbsent";
    case "EvidenceUnstorable":
      return "ProposalEvidenceUnstorable";
    default:
      return assertNever(reason);
  }
}

/** What one concluded merge leaves the finalization to do. */
function finalizationProposalMerged(
  merge: ChangeProposalMergeConcluded,
): FinalizationProposalDecision {
  switch (merge.merged) {
    case "Merged":
      return { decide: "Conclude" };
    case "NotMergeable":
      return { decide: "RecordMergeConflict" };
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
  head: GitObjectId,
  decide: "MergeProposal" | "ReconcileMerge" | "UpdateProposal",
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
    headCommit: head,
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
  merge: ChangeProposalMergeGathered,
  bounds: ChangeProposalMergingBounds,
): FinalizationProposalDecision {
  if (evidence.status === "Merged" && evidence.mergeCommit !== undefined)
    return { decide: "Conclude" };
  const next = changeProposalMergeNext(request, merging, merge, bounds);
  const closing = allClosingLifecycles.includes(finalization.lifecycle);
  switch (next.next) {
    case "Merge":
      return closing
        ? { decide: "Abort" }
        : finalizationProposalAddressed(
            request,
            evidence,
            merge.head,
            "MergeProposal",
          );
    case "Update":
      return closing
        ? { decide: "Abort" }
        : finalizationProposalAddressed(
            request,
            evidence,
            merge.head,
            "UpdateProposal",
          );
    case "Adopt":
      return { decide: "AdoptProposalHead", head: next.head };
    case "ReadByNumber":
      return finalizationProposalAddressed(
        request,
        evidence,
        merge.head,
        "ReconcileMerge",
      );
    case "RefuseAttempt":
      return { decide: "RefuseMergeAttempt" };
    case "Wait":
      return {
        decide: "WaitMergeAttempt",
        hold: finalizationProposalMergeHeld(next.reason),
      };
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
            gathered.merge,
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
      /** The hold the pass that recorded it ends at, which only a reading of a closed proposal names. */
      readonly hold: FinalizationHoldKind | undefined;
    }
  | { readonly record: "Decline"; readonly hold: FinalizationHoldKind }
  | { readonly record: "Nothing"; readonly hold: FinalizationHoldKind }
  | { readonly record: "Unanswered" };

/**
 * What one merge's answer is written down as. A forge that would not take the
 * merge has said nothing about it, so the attempt it declined is released and
 * the merge it stood for is unspent; one that refused for anything but a
 * conflict has said nothing a row settles on, its own rules being ones that may
 * lift, and is read back like an answer nobody heard at all.
 */
export function finalizationProposalMergeRecording(
  merged: ChangeProposalMerged,
): FinalizationProposalMergeRecording {
  switch (merged.merged) {
    case "Merged":
    case "HeadMoved":
      return { record: "Merge", merged };
    case "NotMergeable":
      return merged.reason === "Conflict"
        ? {
            record: "Merge",
            merged: { merged: "NotMergeable", reason: merged.reason },
          }
        : { record: "Unanswered" };
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
 * the proposal, so neither is recorded and neither spends a reading; a reading
 * of a closed proposal is recorded and holds as each pass it stays closed does,
 * so reading it again leaves the dwell counting.
 */
export function finalizationProposalMergeReadingRecording(
  reconciled: ChangeProposalMergeReconciled,
): FinalizationProposalMergeRecording {
  switch (reconciled.reconciled) {
    case "Accepted":
    case "Unmerged":
    case "Absent":
      return { record: "Reading", reconciled, hold: undefined };
    case "Contradictory":
      return {
        record: "Reading",
        reconciled,
        hold:
          reconciled.contradiction === "Closed"
            ? finalizationProposalMergeHeld("Closed")
            : undefined,
      };
    case "Unavailable":
      return { record: "Nothing", hold: "ProposalUnavailable" };
    case "Denied":
      return { record: "Nothing", hold: "ProposalDenied" };
    default:
      return assertNever(reconciled);
  }
}

/**
 * What one update's answer is written down as. One the forge accepted, or
 * answered nothing a row settles on, stands unread until a reading sees what
 * became of it; one it refused is spent and read; and one it would not take
 * is released unspent, the deployment holding as for any other decline.
 */
export type FinalizationProposalUpdateRecording =
  | { readonly record: "Asked" | "Refused" }
  | { readonly record: "Declined"; readonly hold: FinalizationHoldKind };

/** The writes an answered update makes against the row. */
export type ChangeProposalUpdateWrite = "Asked" | "Refused" | "Declined";

export function finalizationProposalUpdateRecording(
  updated: ChangeProposalUpdated,
): FinalizationProposalUpdateRecording {
  switch (updated.updated) {
    case "Accepted":
    case "Ambiguous":
      return { record: "Asked" };
    case "Refused":
      return { record: "Refused" };
    case "Unavailable":
      return { record: "Declined", hold: "ProposalUnavailable" };
    case "Denied":
      return { record: "Declined", hold: "ProposalDenied" };
    default:
      return assertNever(updated);
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

/**
 * One stored proposal whole: what it asked the forge for, what has come back,
 * the head adopted in place of the one it asked for where one has been, and how
 * updating it stands beside the other proposals on its base.
 */
export interface StoredChangeProposal {
  readonly asked: ChangeProposalAsked;
  readonly publication: OpenedChangeProposalPublication;
  readonly merging: ChangeProposalMerging;
  readonly adopted?: GitObjectId;
  readonly updating: ChangeProposalUpdating;
}

/**
 * The durable rows one change proposal leaves, which the finalizer role reaches
 * and nothing else does. Every attempt is counted before the create it stands
 * for is called and every write is fenced on the claim, so a crash between the
 * two reads back as a create in flight and a holder a takeover has retired
 * writes nothing at all.
 */
export interface FinalizerProposalStore {
  /** What one finalization's proposal asked for and has come to, absent until one is attempted, its waits aged by the database's clock. */
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

  /** Records that the merge waits on the forge, blocked or closed, which spends the attempt and keeps the reading it waits on. */
  waitChangeProposalMergeAttempt(
    claim: FinalizationClaim,
  ): Promise<ChangeProposalWritten>;

  /** Records one answer about merging against that row, the merge's being writable exactly once. */
  recordChangeProposalMerge(
    record: ChangeProposalMergeResult,
  ): Promise<ChangeProposalWritten>;

  /** Counts one update of a waiting merge's branch, refused where one is unread on its base already. */
  markChangeProposalUpdate(
    claim: FinalizationClaim,
  ): Promise<ChangeProposalWritten>;

  /** Records what the update in flight came to. */
  recordChangeProposalUpdate(
    claim: FinalizationClaim,
    write: ChangeProposalUpdateWrite,
  ): Promise<ChangeProposalWritten>;

  /** Pins the head the last reading found as the one merged at, a moved head's answer giving way to it. */
  adoptChangeProposalHead(
    claim: FinalizationClaim,
    head: GitObjectId,
  ): Promise<ChangeProposalWritten>;
}
