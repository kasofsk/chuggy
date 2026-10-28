/**
 * The durable row one change proposal leaves: the attempt counted before the
 * forge is asked for it, and the answers recorded against that row afterwards.
 *
 * THE ATTEMPT IS COUNTED BEFORE `create` IS CALLED, AND THAT ORDER IS WHY THE
 * ROW EXISTS. The request is derivable from the ticket's own frozen brief, so a
 * row that only held it would be the stored duplicate standing rule three
 * rejects; what is not derivable is that a create may have happened. An attempt
 * no refusal and no answer has caught up with is exactly that, so a crash
 * between the count and the answer sends the next pass to `readByMarker` and
 * never to a second create.
 *
 * THE COUNTERS ARE THE WHOLE STATE. `attempts` counts the creates this row may
 * have sent, `refusals` the ones readings proved nothing came of, and
 * `declines` the ones the forge would not take at all, so `attempts = refusals
 * + declines` is nothing in flight and one more than that is a create nobody
 * heard back from. The relation admits no other difference, which is what makes
 * a second create impossible while one is outstanding and possible once one is
 * released; what the create ceiling is spent from is `attempts - declines`, the
 * creates that may have reached the forge, so a deployment whose credential was
 * unreadable for a few passes has spent nothing and waits. `reconciliations`
 * counts the readings taken about those creates, and is what the reconciliation
 * ceiling is spent from.
 *
 * A RELEASED ATTEMPT TAKES ITS READING WITH IT. A reading is only ever taken
 * about the create in flight, so the release that ends one clears what was read
 * about it and every later pass reads a reading that belongs to the create it
 * is looking at.
 *
 * A MERGE THE FORGE'S OWN RULES REFUSED IS THE ONE RELEASE THAT KEEPS ITS
 * READING. That reading is what the merge waits on, so nothing in flight with a
 * reading still standing is a wait rather than a release, and every later
 * reading overwrites it without spending a reading a merge in flight may take;
 * the next merge is what clears it. A row answered as a moved head is read the
 * same way, and `merge_heard_at` is when the forge was last heard about the
 * merge at all, which is what either wait is aged from.
 *
 * AN UPDATE IS IN FLIGHT UNTIL A READING SEES IT, ONE PER BASE. The forge
 * answers an update before it makes it, so `merge_update_unread` stands from
 * the count until the next reading of the proposal is recorded. Whose turn it
 * is to update is read across every open request's proposal on the same
 * repository and base: none may update while another's update is unread, and
 * only the oldest found behind may update at all. The count takes a lock on
 * that repository and base for its transaction and asks the first half again
 * under it, so two finalizers cannot both start one.
 *
 * AN ADOPTED HEAD IS WRITTEN BESIDE THE ONE ASKED FOR, never over it, and only
 * where the reading the row keeps found the proposal at that head.
 *
 * NO WRITE OUTLIVES THE CLAIM THAT AUTHORIZED IT. Every write here reads the
 * current epoch and rechecks the claim under the request row's lock, because
 * the first of them authorizes a call to the forge and the rest answer one: a
 * holder whose lease lapsed mid-create would otherwise spend a create against a
 * row another finalizer now owns, and only the forge's own duplicate refusal
 * would catch it.
 *
 * NO FORGE CALL HAPPENS INSIDE EITHER TRANSACTION. Every function here takes a
 * client and returns; the port that reaches the forge is the caller's and is
 * held nowhere in this file, so the ordering is structural rather than careful.
 *
 * A CREATION ANSWER IS WRITTEN ONCE AND A READING AS OFTEN AS ONE IS TAKEN. The
 * insert claims the row by primary key, so two passes cannot both start one; the
 * update recording an answer matches only a row that has none, so two passes
 * cannot both answer it; and the trigger refuses either from rewriting what the
 * forge was asked for.
 *
 * EVIDENCE NO COLUMN HOLDS IS RECORDED WITHOUT IT. A NUL and an unpaired
 * surrogate are characters `jsonb` takes no value carrying and a document over
 * the bound is one this relation refuses, and a create is already made by the
 * time any of them would be discovered — so the answer is stored as unstorable
 * instead, which counts and settles rather than raising out of a pass that
 * cannot then record anything at all.
 *
 * STORED EVIDENCE IS PARSED AND NEVER CAST. The pure step compares every field
 * of it against the request, so evidence that arrived as a document the driver
 * knows nothing about is parsed back into the branded shape here — a row this
 * code could not read raises rather than travelling on as a type the compiler
 * was told to believe.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";
import { z } from "zod";

import { assertNever } from "../../domain/assertNever.ts";
import { textCodePointsCount } from "../../contract/http.ts";
import {
  allChangeProposalContradictions,
  allChangeProposalCreationsStored,
  allChangeProposalMergeabilities,
  allChangeProposalMergeAnswers,
  allChangeProposalMergeReconciliationsStored,
  allChangeProposalReconciliationsStored,
  allChangeProposalStatuses,
  allChangeProposalUnmergeableSettled,
  asChangeProposalRequestIdentity,
  asForgeBindingId,
  asProposalDisplayUrl,
  asProposalMarker,
  asProposalMergeState,
  asProposalNumber,
  asProposalRemoteIdentity,
  proposalEvidenceCharsMax,
  type ChangeProposalContradiction,
  type ChangeProposalCreationAnswer,
  type ChangeProposalCreationStored,
  type ChangeProposalEvidence,
  type ChangeProposalMergeAnswer,
  type ChangeProposalMergeConcluded,
  type ChangeProposalMergeReconciliationAnswer,
  type ChangeProposalMergeReconciliationStored,
  type ChangeProposalMerging,
  type ChangeProposalReconciliationAnswer,
  type ChangeProposalReconciliationStored,
  type ChangeProposalUpdating,
  type OpenedChangeProposalPublication,
} from "../../interpreter/changeProposal.ts";
import type {
  ChangeProposalAsked,
  ChangeProposalUpdateWrite,
  ChangeProposalMergeResult,
  ChangeProposalRecord,
  ChangeProposalResult,
  ChangeProposalWritten,
  StoredChangeProposal,
} from "../../interpreter/finalizationProposal.ts";
import {
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
  type FinalizationClaim,
  type GitObjectId,
} from "../../interpreter/finalizer.ts";
import { projectRowCounter } from "./rows.ts";
import { finalizerRowValue } from "./finalizerRows.ts";
import { postgresOwnershipEpoch } from "./ownership.ts";

/** One stored proposal as the pure step reads it back. */
interface ChangeProposalRow {
  readonly proposal_request: string;
  readonly head_ref: string;
  readonly head_commit: string;
  readonly base_ref: string;
  readonly base_commit: string;
  readonly title: string;
  readonly body: string;
  readonly creation: string | null;
  readonly creation_contradiction: string | null;
  readonly creation_evidence: unknown;
  readonly reconciliation: string | null;
  readonly reconciliation_contradiction: string | null;
  readonly reconciliation_evidence: unknown;
  readonly attempts: string;
  readonly refusals: string;
  readonly declines: string;
  readonly reconciliations: string;
  readonly merge: string | null;
  readonly merge_reason: string | null;
  readonly merge_commit: string | null;
  readonly merge_reading: string | null;
  readonly merge_reading_contradiction: string | null;
  readonly merge_reading_evidence: unknown;
  readonly merge_attempts: string;
  readonly merge_refusals: string;
  readonly merge_declines: string;
  readonly merge_readings: string;
  readonly merge_heard_secs: string | null;
  readonly merge_head: string | null;
  readonly merge_updates: string;
  readonly merge_update_declines: string;
  readonly merge_update_unread: boolean;
  readonly update_turn: boolean;
}

/** The columns one answer writes, whichever arm it came back on. */
interface ChangeProposalResultColumns {
  readonly kind: string;
  readonly contradiction: string | null;
  readonly evidence: string | null;
}

/** One side of a proposal, as a stored document spells it. */
const changeProposalStoredRef = z.object({
  ref: z.string(),
  commit: z.string(),
});

/** The evidence a stored result carries, in the shape this code writes it. */
const changeProposalStoredEvidenceSchema = z.object({
  identity: z.object({
    forge: z.string(),
    remote: z.string(),
    number: z.number().optional(),
  }),
  repository: z.string(),
  marker: z.string(),
  head: changeProposalStoredRef,
  base: changeProposalStoredRef,
  title: z.string(),
  body: z.string(),
  status: z.string(),
  mergeability: z.string().optional(),
  mergeState: z.string().optional(),
  mergeCommit: z.string().optional(),
  url: z.string().optional(),
});

/** Brands one stored document back into the evidence the pure step compares. */
function changeProposalEvidenceOf(
  stored: unknown,
  what: string,
): ChangeProposalEvidence {
  const parsed = changeProposalStoredEvidenceSchema.safeParse(stored);
  if (!parsed.success) {
    throw new Error(`finalizer row: ${what} carries no evidence to compare`);
  }
  const value = parsed.data;
  return {
    identity: {
      forge: asForgeBindingId(value.identity.forge),
      remote: asProposalRemoteIdentity(value.identity.remote),
      ...(value.identity.number === undefined
        ? {}
        : { number: asProposalNumber(value.identity.number) }),
    },
    repository: asRepositoryId(value.repository),
    marker: asProposalMarker(value.marker),
    head: {
      ref: asGitRefName(value.head.ref),
      commit: asGitObjectId(value.head.commit),
    },
    base: {
      ref: asGitRefName(value.base.ref),
      commit: asGitObjectId(value.base.commit),
    },
    title: value.title,
    body: value.body,
    status: finalizerRowValue(
      allChangeProposalStatuses,
      value.status,
      "change proposal status",
    ),
    ...(value.mergeability === undefined
      ? {}
      : {
          mergeability: finalizerRowValue(
            allChangeProposalMergeabilities,
            value.mergeability,
            "change proposal mergeability",
          ),
        }),
    ...(value.mergeState === undefined
      ? {}
      : { mergeState: asProposalMergeState(value.mergeState) }),
    ...(value.mergeCommit === undefined
      ? {}
      : { mergeCommit: asGitObjectId(value.mergeCommit) }),
    ...(value.url === undefined
      ? {}
      : { url: asProposalDisplayUrl(value.url) }),
  };
}

/** The contradiction a stored result names, refused where the row names none. */
function changeProposalContradictionOf(
  stored: string | null,
  what: string,
): ChangeProposalContradiction {
  if (stored === null) {
    throw new Error(`finalizer row: ${what} names no contradiction`);
  }
  return finalizerRowValue(
    allChangeProposalContradictions,
    stored,
    "change proposal contradiction",
  );
}

/** What the row says the create came to, narrowed to the closed set a row records. */
function changeProposalCreatedOf(
  row: ChangeProposalRow & { readonly creation: string },
): ChangeProposalCreationStored {
  const created = finalizerRowValue(
    allChangeProposalCreationsStored,
    row.creation,
    "change proposal creation",
  );
  switch (created) {
    case "Created":
    case "AlreadyExists":
      return {
        created,
        evidence: changeProposalEvidenceOf(row.creation_evidence, created),
      };
    case "Contradictory":
      return {
        created,
        contradiction: changeProposalContradictionOf(
          row.creation_contradiction,
          created,
        ),
        evidence: changeProposalEvidenceOf(row.creation_evidence, created),
      };
    case "Unstorable":
      return { created };
    default:
      return assertNever(created);
  }
}

/** What the row says the last reading came to, narrowed the same way. */
function changeProposalReconciledOf(
  row: ChangeProposalRow & { readonly reconciliation: string },
): ChangeProposalReconciliationStored {
  const reconciled = finalizerRowValue(
    allChangeProposalReconciliationsStored,
    row.reconciliation,
    "change proposal reconciliation",
  );
  switch (reconciled) {
    case "Accepted":
      return {
        reconciled,
        evidence: changeProposalEvidenceOf(
          row.reconciliation_evidence,
          reconciled,
        ),
      };
    case "Contradictory":
      return {
        reconciled,
        contradiction: changeProposalContradictionOf(
          row.reconciliation_contradiction,
          reconciled,
        ),
        evidence: changeProposalEvidenceOf(
          row.reconciliation_evidence,
          reconciled,
        ),
      };
    case "Absent":
    case "Unstorable":
      return { reconciled };
    default:
      return assertNever(reconciled);
  }
}

/** What the row says a concluded merge came to, narrowed to the closed set a row records. */
function changeProposalMergedOf(
  row: ChangeProposalRow,
  merged: ChangeProposalMergeConcluded["merged"],
): ChangeProposalMergeConcluded {
  switch (merged) {
    case "Merged": {
      if (row.merge_commit === null) {
        throw new Error("finalizer row: a merge names no commit it left");
      }
      return { merged, mergeCommit: asGitObjectId(row.merge_commit) };
    }
    case "NotMergeable": {
      if (row.merge_reason === null) {
        throw new Error("finalizer row: a refused merge names no reason");
      }
      return {
        merged,
        reason: finalizerRowValue(
          allChangeProposalUnmergeableSettled,
          row.merge_reason,
          "change proposal merge reason",
        ),
      };
    }
    default:
      return assertNever(merged);
  }
}

/** What the row says the last reading of the merge came to, narrowed the same way. */
function changeProposalMergeReadOf(
  row: ChangeProposalRow & { readonly merge_reading: string },
): ChangeProposalMergeReconciliationStored {
  const reconciled = finalizerRowValue(
    allChangeProposalMergeReconciliationsStored,
    row.merge_reading,
    "change proposal merge reading",
  );
  switch (reconciled) {
    case "Accepted":
    case "Unmerged":
      return {
        reconciled,
        evidence: changeProposalEvidenceOf(
          row.merge_reading_evidence,
          reconciled,
        ),
      };
    case "Contradictory":
      return {
        reconciled,
        contradiction: changeProposalContradictionOf(
          row.merge_reading_contradiction,
          reconciled,
        ),
        evidence: changeProposalEvidenceOf(
          row.merge_reading_evidence,
          reconciled,
        ),
      };
    case "Absent":
    case "Unstorable":
      return { reconciled };
    default:
      return assertNever(reconciled);
  }
}

/** What the row says the last reading of the merge came to, absent where none stands. */
function changeProposalMergeReadingOf(
  row: ChangeProposalRow,
): ChangeProposalMergeReconciliationStored | undefined {
  const reading = row.merge_reading;
  return reading === null
    ? undefined
    : changeProposalMergeReadOf({ ...row, merge_reading: reading });
}

/** How many seconds before this read the forge was last heard about the merge, which every waiting row has been. */
function changeProposalMergeHeardAgeOf(row: ChangeProposalRow): number {
  if (row.merge_heard_secs === null) {
    throw new Error("finalizer row: a waiting merge was never heard about");
  }
  const age = Number(row.merge_heard_secs);
  if (!Number.isSafeInteger(age)) {
    throw new Error("finalizer row: a waiting merge's age is not a count");
  }
  return age;
}

/** The merge half of a row its merge settled, a moved head being one that waits on whoever moved it. */
function mergingAnsweredOf(
  row: ChangeProposalRow & { readonly merge: string },
): ChangeProposalMerging {
  const merged = finalizerRowValue(
    allChangeProposalMergeAnswers,
    row.merge,
    "change proposal merge",
  );
  return merged === "HeadMoved"
    ? {
        merging: "Moved",
        reading: changeProposalMergeReadingOf(row),
        heardAgeSecs: changeProposalMergeHeardAgeOf(row),
      }
    : { merging: "Answered", merge: changeProposalMergedOf(row, merged) };
}

/**
 * Which state the merge half of the row stands in. A row nobody has asked a
 * merge of is apart from one whose merges have all been released, because the
 * second has spent something and the first has not, and a release that kept
 * its reading is a merge waiting on the forge.
 */
function mergingOf(row: ChangeProposalRow): ChangeProposalMerging {
  const merge = row.merge;
  if (merge !== null) return mergingAnsweredOf({ ...row, merge });
  const attempts = projectRowCounter(
    row.merge_attempts,
    "change proposal merge attempts",
  );
  if (attempts === 0) return { merging: "Unasked" };
  const refusals = projectRowCounter(
    row.merge_refusals,
    "change proposal merge refusals",
  );
  const declines = projectRowCounter(
    row.merge_declines,
    "change proposal merge declines",
  );
  const merges = attempts - declines;
  const reading = changeProposalMergeReadingOf(row);
  if (attempts === refusals + declines)
    return reading === undefined
      ? { merging: "Idle", merges }
      : {
          merging: "Waiting",
          merges,
          reading,
          heardAgeSecs: changeProposalMergeHeardAgeOf(row),
        };
  if (attempts !== refusals + declines + 1) {
    throw new Error(
      "finalizer row: a change proposal counts more merges in flight than one",
    );
  }
  return {
    merging: "Unanswered",
    merges,
    readings: projectRowCounter(
      row.merge_readings,
      "change proposal merge readings",
    ),
    reading,
  };
}

/** What the row says the forge was asked for, which every later pass rebuilds its request from. */
function changeProposalAskedOf(row: ChangeProposalRow): ChangeProposalAsked {
  return {
    request: asChangeProposalRequestIdentity(row.proposal_request),
    head: {
      ref: asGitRefName(row.head_ref),
      commit: asGitObjectId(row.head_commit),
    },
    base: {
      ref: asGitRefName(row.base_ref),
      commit: asGitObjectId(row.base_commit),
    },
    title: row.title,
    body: row.body,
  };
}

/** What the row says the last reading came to, absent where no reading has been taken. */
function changeProposalReadingOf(
  row: ChangeProposalRow,
): ChangeProposalReconciliationStored | undefined {
  const reconciliation = row.reconciliation;
  return reconciliation === null
    ? undefined
    : changeProposalReconciledOf({ ...row, reconciliation });
}

/**
 * Which of the three states the row stands in, and how many of its creates may
 * have reached the forge. An attempt no release has caught up with is a create
 * nobody heard back from, and the relation admits no row counting more of those
 * than one.
 */
function publicationOf(
  row: ChangeProposalRow,
): OpenedChangeProposalPublication {
  const creation = row.creation;
  if (creation !== null)
    return {
      publication: "Answered",
      creation: changeProposalCreatedOf({ ...row, creation }),
    };
  const attempts = projectRowCounter(row.attempts, "change proposal attempts");
  const refusals = projectRowCounter(row.refusals, "change proposal refusals");
  const declines = projectRowCounter(row.declines, "change proposal declines");
  const creations = attempts - declines;
  if (attempts === refusals + declines)
    return { publication: "Idle", creations };
  if (attempts !== refusals + declines + 1) {
    throw new Error(
      "finalizer row: a change proposal counts more creates in flight than one",
    );
  }
  return {
    publication: "Unanswered",
    creations,
    reconciliations: projectRowCounter(
      row.reconciliations,
      "change proposal reconciliations",
    ),
    reading: changeProposalReadingOf(row),
  };
}

/** How updating the row stands, the ceiling spent from the updates the forge may have taken. */
function changeProposalUpdatingOf(
  row: ChangeProposalRow,
): ChangeProposalUpdating {
  const updates = projectRowCounter(
    row.merge_updates,
    "change proposal updates",
  );
  const declines = projectRowCounter(
    row.merge_update_declines,
    "change proposal update declines",
  );
  return {
    updates: updates - declines,
    unread: row.merge_update_unread,
    turn: row.update_turn,
  };
}

/**
 * Everything the pure step reads of one stored proposal, absent until one is
 * attempted. The state is read from the counters, which is the whole reason the
 * attempt is written before the forge is called: what one no answer caught up
 * with authorizes is a reading, never a second create.
 */
export async function finalizerChangeProposalRead(
  client: pg.PoolClient,
  claim: FinalizationClaim,
): Promise<StoredChangeProposal | undefined> {
  const found = await client.query<ChangeProposalRow>(
    sql`SELECT proposal_request, head_ref, head_commit, base_ref, base_commit,
            title, body,
            creation, creation_contradiction, creation_evidence,
            reconciliation, reconciliation_contradiction, reconciliation_evidence,
            attempts::text AS attempts, refusals::text AS refusals,
            declines::text AS declines,
            reconciliations::text AS reconciliations,
            merge, merge_reason, merge_commit,
            merge_reading, merge_reading_contradiction, merge_reading_evidence,
            merge_attempts::text AS merge_attempts,
            merge_refusals::text AS merge_refusals,
            merge_declines::text AS merge_declines,
            merge_readings::text AS merge_readings,
            CASE WHEN merge_heard_at IS NOT NULL
                 THEN floor(extract(epoch FROM (now() - merge_heard_at)))
                        ::bigint::text END AS merge_heard_secs,
            merge_head,
            merge_updates::text AS merge_updates,
            merge_update_declines::text AS merge_update_declines,
            merge_update_unread,
            NOT EXISTS (
              SELECT 1 FROM finalization_change_proposal s
                JOIN finalization_request f
                  ON f.tenant = s.tenant AND f.project = s.project
                 AND f.request = s.request
               WHERE s.base_ref = c.base_ref
                 AND s.merge_reading_evidence->>'repository'
                     = c.merge_reading_evidence->>'repository'
                 AND (s.tenant, s.project, s.request)
                     <> (c.tenant, c.project, c.request)
                 AND f.state IN ('Open', 'Registered')
                 AND s.merge IS NULL
                 AND (s.merge_update_unread
                      OR (s.merge_reading = 'Unmerged'
                          AND s.merge_reading_evidence->>'mergeability' = 'Behind'
                          AND (s.opened_at, s.tenant, s.project, s.request)
                              < (c.opened_at, c.tenant, c.project, c.request)))
            ) AS update_turn
       FROM finalization_change_proposal c
      WHERE tenant = ${claim.partition.tenant} AND project = ${claim.partition.project}
        AND request = ${claim.request}`,
  );
  const row = found.rows[0];
  if (row === undefined) return undefined;
  return {
    asked: changeProposalAskedOf(row),
    publication: publicationOf(row),
    merging: mergingOf(row),
    ...(row.merge_head === null
      ? {}
      : { adopted: asGitObjectId(row.merge_head) }),
    updating: changeProposalUpdatingOf(row),
  };
}

/**
 * Whether the claim that authorized one write still holds the request, read
 * under that row's own lock. The epoch is asked for separately because a
 * restore leaves the request row's own fences untouched, so the row alone
 * cannot say it moved.
 */
async function finalizerChangeProposalClaimStands(
  client: pg.PoolClient,
  claim: FinalizationClaim,
): Promise<boolean> {
  if ((await postgresOwnershipEpoch(client)) !== claim.recoveryEpoch)
    return false;
  const held = await client.query<{ one: number }>(
    sql`SELECT 1 AS one FROM finalization_request
      WHERE tenant = ${claim.partition.tenant} AND project = ${claim.partition.project}
        AND request = ${claim.request}
        AND claim_owner = ${claim.owner} AND claim_generation = ${claim.claimGeneration}
        AND recovery_epoch = ${claim.recoveryEpoch}
        AND state IN ('Open', 'Registered')
      FOR UPDATE`,
  );
  return held.rowCount === 1;
}

/**
 * Counts the attempt one create is about to be made under, starting the row
 * where there is none. A row already counting a create nobody heard back from,
 * one already answered, and one whose claim has been retired are each left
 * exactly as they stand.
 */
export async function finalizerChangeProposalAttempt(
  client: pg.PoolClient,
  record: ChangeProposalRecord,
): Promise<ChangeProposalWritten> {
  const { claim, request } = record;
  if (!(await finalizerChangeProposalClaimStands(client, claim)))
    return { wrote: "Nothing" };
  const marked = await client.query(
    sql`INSERT INTO finalization_change_proposal
       (tenant, project, request, permit, proposal_request,
        head_ref, head_commit, base_ref, base_commit, title, body, attempts)
     VALUES (${claim.partition.tenant},${claim.partition.project},${claim.request},
             ${record.permit},${request.request},
             ${request.head.ref},${request.head.commit},
             ${request.base.ref},${request.base.commit},
             ${request.title},${request.body},1)
     ON CONFLICT (tenant, project, request) DO UPDATE
        SET attempts = finalization_change_proposal.attempts + 1
      WHERE finalization_change_proposal.creation IS NULL
        AND finalization_change_proposal.attempts
            = finalization_change_proposal.refusals
              + finalization_change_proposal.declines`,
  );
  return marked.rowCount === 1 ? { wrote: "Row" } : { wrote: "Nothing" };
}

/**
 * Releases the attempt in flight, counting it against the creates this request
 * is allowed where the forge may have taken it and not counting it where the
 * forge would not. The reading goes with it, because the next reading is about
 * whatever create comes after this one.
 */
async function finalizerChangeProposalReleased(
  client: pg.PoolClient,
  claim: FinalizationClaim,
  released: "Refused" | "Declined",
): Promise<ChangeProposalWritten> {
  if (!(await finalizerChangeProposalClaimStands(client, claim)))
    return { wrote: "Nothing" };
  const wrote = await client.query(
    sql`UPDATE finalization_change_proposal
        SET refusals = refusals + ${released === "Refused" ? 1 : 0},
            declines = declines + ${released === "Declined" ? 1 : 0},
            reconciliation = NULL,
            reconciliation_contradiction = NULL,
            reconciliation_evidence = NULL
      WHERE tenant = ${claim.partition.tenant} AND project = ${claim.partition.project}
        AND request = ${claim.request}
        AND creation IS NULL AND attempts = refusals + declines + 1`,
  );
  return wrote.rowCount === 1 ? { wrote: "Row" } : { wrote: "Nothing" };
}

/** Records that no reading found the create in flight, which spends it and releases the attempt. */
export function finalizerChangeProposalRefuse(
  client: pg.PoolClient,
  claim: FinalizationClaim,
): Promise<ChangeProposalWritten> {
  return finalizerChangeProposalReleased(client, claim, "Refused");
}

/** Records that the forge would not take the create, which releases the attempt unspent. */
export function finalizerChangeProposalDecline(
  client: pg.PoolClient,
  claim: FinalizationClaim,
): Promise<ChangeProposalWritten> {
  return finalizerChangeProposalReleased(client, claim, "Declined");
}

/**
 * The document one answer's evidence is stored as, absent where no column holds
 * it: a NUL and an unpaired surrogate are characters no `jsonb` value carries,
 * and a document over the bound is one the relation refuses. Any of them is
 * discovered only after the create it is recording has already been made, so
 * the store is total against whatever an adapter brands rather than raising out
 * of the pass that must record it.
 */
function changeProposalStoredEvidence(
  evidence: ChangeProposalEvidence,
): string | undefined {
  let holdable = true;
  const document = JSON.stringify(evidence, (_key: string, value: unknown) => {
    if (
      typeof value === "string" &&
      (value.includes("\u0000") || !value.isWellFormed())
    ) {
      holdable = false;
    }
    return value;
  });
  return holdable && textCodePointsCount(document) <= proposalEvidenceCharsMax
    ? document
    : undefined;
}

/** The kind and evidence one answer writes, one no document holds keeping neither. */
function changeProposalEvidenceColumns(
  kind: string,
  contradiction: ChangeProposalContradiction | null,
  evidence: ChangeProposalEvidence,
): ChangeProposalResultColumns {
  const document = changeProposalStoredEvidence(evidence);
  return document === undefined
    ? { kind: "Unstorable", contradiction: null, evidence: null }
    : { kind, contradiction, evidence: document };
}

/** The columns one create's answer writes. */
function changeProposalCreationColumns(
  created: ChangeProposalCreationAnswer,
): ChangeProposalResultColumns {
  return changeProposalEvidenceColumns(
    created.created,
    created.created === "Contradictory" ? created.contradiction : null,
    created.evidence,
  );
}

/** The columns one reading writes, a reading that found nothing carrying no evidence. */
function changeProposalReconciliationColumns(
  reconciled: ChangeProposalReconciliationAnswer,
): ChangeProposalResultColumns {
  if (reconciled.reconciled === "Absent")
    return { kind: reconciled.reconciled, contradiction: null, evidence: null };
  return changeProposalEvidenceColumns(
    reconciled.reconciled,
    reconciled.reconciled === "Contradictory" ? reconciled.contradiction : null,
    reconciled.evidence,
  );
}

/** Records what the create returned, over the attempt still in flight. */
async function finalizerChangeProposalCreated(
  client: pg.PoolClient,
  claim: FinalizationClaim,
  created: ChangeProposalCreationAnswer,
): Promise<ChangeProposalWritten> {
  if (!(await finalizerChangeProposalClaimStands(client, claim)))
    return { wrote: "Nothing" };
  const columns = changeProposalCreationColumns(created);
  const recorded = await client.query(
    sql`UPDATE finalization_change_proposal
        SET creation = ${columns.kind},
            creation_contradiction = ${columns.contradiction},
            creation_evidence = ${columns.evidence}::jsonb
      WHERE tenant = ${claim.partition.tenant} AND project = ${claim.partition.project}
        AND request = ${claim.request}
        AND creation IS NULL AND attempts = refusals + declines + 1`,
  );
  return recorded.rowCount === 1 ? { wrote: "Row" } : { wrote: "Nothing" };
}

/**
 * Records what one reading read and counts it, over the create it was taken
 * about. A reading is only ever taken about a create nobody heard back from, so
 * a row that has since been answered or released takes none.
 */
async function finalizerChangeProposalReconciled(
  client: pg.PoolClient,
  claim: FinalizationClaim,
  reconciled: ChangeProposalReconciliationAnswer,
): Promise<ChangeProposalWritten> {
  if (!(await finalizerChangeProposalClaimStands(client, claim)))
    return { wrote: "Nothing" };
  const columns = changeProposalReconciliationColumns(reconciled);
  const recorded = await client.query(
    sql`UPDATE finalization_change_proposal
        SET reconciliation = ${columns.kind},
            reconciliation_contradiction = ${columns.contradiction},
            reconciliation_evidence = ${columns.evidence}::jsonb,
            reconciliations = reconciliations + 1
      WHERE tenant = ${claim.partition.tenant} AND project = ${claim.partition.project}
        AND request = ${claim.request}
        AND creation IS NULL AND attempts = refusals + declines + 1`,
  );
  return recorded.rowCount === 1 ? { wrote: "Row" } : { wrote: "Nothing" };
}

/** Records one answer against the row in flight, whichever of the two it is. */
export function finalizerChangeProposalRecord(
  client: pg.PoolClient,
  record: ChangeProposalResult,
): Promise<ChangeProposalWritten> {
  return record.result.records === "Creation"
    ? finalizerChangeProposalCreated(
        client,
        record.claim,
        record.result.created,
      )
    : finalizerChangeProposalReconciled(
        client,
        record.claim,
        record.result.reconciled,
      );
}

/**
 * Counts the attempt one merge is about to be made under, clearing the reading
 * a wait kept because the next reading is about this merge. A row already
 * counting a merge nobody heard back from, one already answered, one holding no
 * evidence of a proposal to address, and one whose claim has been retired are
 * each left exactly as they stand.
 */
export async function finalizerChangeProposalMergeAttempt(
  client: pg.PoolClient,
  claim: FinalizationClaim,
): Promise<ChangeProposalWritten> {
  if (!(await finalizerChangeProposalClaimStands(client, claim)))
    return { wrote: "Nothing" };
  const marked = await client.query(
    sql`UPDATE finalization_change_proposal
        SET merge_attempts = merge_attempts + 1,
            merge_reading = NULL,
            merge_reading_contradiction = NULL,
            merge_reading_evidence = NULL
      WHERE tenant = ${claim.partition.tenant} AND project = ${claim.partition.project}
        AND request = ${claim.request}
        AND merge IS NULL
        AND merge_attempts = merge_refusals + merge_declines
        AND (creation_evidence IS NOT NULL
             OR reconciliation_evidence IS NOT NULL)`,
  );
  return marked.rowCount === 1 ? { wrote: "Row" } : { wrote: "Nothing" };
}

/**
 * Releases the merge attempt in flight, counting it against the merges this
 * request is allowed where the forge may have made it and not counting it where
 * the forge would not. The reading goes with it, because the next reading is
 * about whatever merge comes after this one.
 */
async function finalizerChangeProposalMergeReleased(
  client: pg.PoolClient,
  claim: FinalizationClaim,
  released: "Refused" | "Declined",
): Promise<ChangeProposalWritten> {
  if (!(await finalizerChangeProposalClaimStands(client, claim)))
    return { wrote: "Nothing" };
  const wrote = await client.query(
    sql`UPDATE finalization_change_proposal
        SET merge_refusals = merge_refusals + ${released === "Refused" ? 1 : 0},
            merge_declines = merge_declines + ${released === "Declined" ? 1 : 0},
            merge_reading = NULL,
            merge_reading_contradiction = NULL,
            merge_reading_evidence = NULL
      WHERE tenant = ${claim.partition.tenant} AND project = ${claim.partition.project}
        AND request = ${claim.request}
        AND merge IS NULL
        AND merge_attempts = merge_refusals + merge_declines + 1`,
  );
  return wrote.rowCount === 1 ? { wrote: "Row" } : { wrote: "Nothing" };
}

/** Records that no reading found the merge in flight, which spends it and releases the attempt. */
export function finalizerChangeProposalMergeRefuse(
  client: pg.PoolClient,
  claim: FinalizationClaim,
): Promise<ChangeProposalWritten> {
  return finalizerChangeProposalMergeReleased(client, claim, "Refused");
}

/** Records that the forge would not take the merge, which releases the attempt unspent. */
export function finalizerChangeProposalMergeDecline(
  client: pg.PoolClient,
  claim: FinalizationClaim,
): Promise<ChangeProposalWritten> {
  return finalizerChangeProposalMergeReleased(client, claim, "Declined");
}

/**
 * Records that the merge in flight waits on the forge, which spends the attempt
 * and keeps the reading that found the proposal blocked or closed as what the
 * merge now waits on.
 */
export async function finalizerChangeProposalMergeWait(
  client: pg.PoolClient,
  claim: FinalizationClaim,
): Promise<ChangeProposalWritten> {
  if (!(await finalizerChangeProposalClaimStands(client, claim)))
    return { wrote: "Nothing" };
  const wrote = await client.query(
    sql`UPDATE finalization_change_proposal
        SET merge_refusals = merge_refusals + 1
      WHERE tenant = ${claim.partition.tenant} AND project = ${claim.partition.project}
        AND request = ${claim.request}
        AND merge IS NULL
        AND merge_attempts = merge_refusals + merge_declines + 1
        AND (merge_reading = 'Unmerged'
             OR merge_reading_contradiction = 'Closed')`,
  );
  return wrote.rowCount === 1 ? { wrote: "Row" } : { wrote: "Nothing" };
}

/** Records what the merge answered, over the attempt still in flight, as the moment the forge was last heard. */
async function finalizerChangeProposalMerged(
  client: pg.PoolClient,
  claim: FinalizationClaim,
  merged: ChangeProposalMergeAnswer,
): Promise<ChangeProposalWritten> {
  if (!(await finalizerChangeProposalClaimStands(client, claim)))
    return { wrote: "Nothing" };
  const recorded = await client.query(
    sql`UPDATE finalization_change_proposal
        SET merge = ${merged.merged},
            merge_reason = ${merged.merged === "NotMergeable" ? merged.reason : null},
            merge_commit = ${merged.merged === "Merged" ? merged.mergeCommit : null},
            merge_heard_at = now()
      WHERE tenant = ${claim.partition.tenant} AND project = ${claim.partition.project}
        AND request = ${claim.request}
        AND merge IS NULL
        AND merge_attempts = merge_refusals + merge_declines + 1`,
  );
  return recorded.rowCount === 1 ? { wrote: "Row" } : { wrote: "Nothing" };
}

/** The columns one reading of a merge writes, a reading that found nothing carrying no evidence. */
function changeProposalMergeReadingColumns(
  reconciled: ChangeProposalMergeReconciliationAnswer,
): ChangeProposalResultColumns {
  if (reconciled.reconciled === "Absent")
    return { kind: reconciled.reconciled, contradiction: null, evidence: null };
  return changeProposalEvidenceColumns(
    reconciled.reconciled,
    reconciled.reconciled === "Contradictory" ? reconciled.contradiction : null,
    reconciled.evidence,
  );
}

/**
 * Records what one reading of the merge read, over the merge it was taken
 * about, and counts it only against a merge in flight. A reading is taken about
 * a merge nobody heard back from and about one waiting on the forge, so a row
 * released with nothing to wait on or settled by anything but a moved head
 * takes none.
 */
async function finalizerChangeProposalMergeRead(
  client: pg.PoolClient,
  claim: FinalizationClaim,
  reconciled: ChangeProposalMergeReconciliationAnswer,
): Promise<ChangeProposalWritten> {
  if (!(await finalizerChangeProposalClaimStands(client, claim)))
    return { wrote: "Nothing" };
  const columns = changeProposalMergeReadingColumns(reconciled);
  const recorded = await client.query(
    sql`UPDATE finalization_change_proposal
        SET merge_reading = ${columns.kind},
            merge_reading_contradiction = ${columns.contradiction},
            merge_reading_evidence = ${columns.evidence}::jsonb,
            merge_readings = merge_readings
              + CASE WHEN merge IS NULL
                      AND merge_attempts = merge_refusals + merge_declines + 1
                     THEN 1 ELSE 0 END,
            merge_update_unread = false,
            merge_heard_at = now()
      WHERE tenant = ${claim.partition.tenant} AND project = ${claim.partition.project}
        AND request = ${claim.request}
        AND ((merge IS NULL
              AND merge_attempts = merge_refusals + merge_declines + 1)
             OR (merge IS NULL
                 AND merge_attempts = merge_refusals + merge_declines
                 AND merge_reading IS NOT NULL)
             OR merge = 'HeadMoved')`,
  );
  return recorded.rowCount === 1 ? { wrote: "Row" } : { wrote: "Nothing" };
}

/** Records one answer about merging against the row in flight, whichever of the two it is. */
export function finalizerChangeProposalMergeRecord(
  client: pg.PoolClient,
  record: ChangeProposalMergeResult,
): Promise<ChangeProposalWritten> {
  return record.result.records === "Merge"
    ? finalizerChangeProposalMerged(client, record.claim, record.result.merged)
    : finalizerChangeProposalMergeRead(
        client,
        record.claim,
        record.result.reconciled,
      );
}

/**
 * Counts one update of a waiting merge's branch, under a lock on its
 * repository and base held to the end of the transaction, so no other update
 * there is counted beside it. A row with an update already unread, one not
 * waiting with a reading, one whose turn another proposal holds, and one whose
 * claim has been retired are each left exactly as they stand.
 */
export async function finalizerChangeProposalUpdateMark(
  client: pg.PoolClient,
  claim: FinalizationClaim,
): Promise<ChangeProposalWritten> {
  if (!(await finalizerChangeProposalClaimStands(client, claim)))
    return { wrote: "Nothing" };
  await client.query<{ locked: string | null }>(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(
              coalesce(merge_reading_evidence->>'repository', '') || ' ' || base_ref,
              0))::text AS locked
         FROM finalization_change_proposal
        WHERE tenant = ${claim.partition.tenant} AND project = ${claim.partition.project}
          AND request = ${claim.request}`,
  );
  const marked = await client.query(
    sql`UPDATE finalization_change_proposal c
        SET merge_updates = merge_updates + 1,
            merge_update_unread = true
      WHERE c.tenant = ${claim.partition.tenant} AND c.project = ${claim.partition.project}
        AND c.request = ${claim.request}
        AND c.merge IS NULL
        AND c.merge_attempts = c.merge_refusals + c.merge_declines
        AND c.merge_reading = 'Unmerged'
        AND NOT c.merge_update_unread
        AND NOT EXISTS (
          SELECT 1 FROM finalization_change_proposal s
            JOIN finalization_request f
              ON f.tenant = s.tenant AND f.project = s.project
             AND f.request = s.request
           WHERE s.base_ref = c.base_ref
             AND s.merge_reading_evidence->>'repository'
                 = c.merge_reading_evidence->>'repository'
             AND f.state IN ('Open', 'Registered')
             AND s.merge IS NULL
             AND s.merge_update_unread)`,
  );
  return marked.rowCount === 1 ? { wrote: "Row" } : { wrote: "Nothing" };
}

/**
 * Records what the update in flight came to: one the forge was asked for
 * stands unread and is the moment the forge was last heard, one it refused is
 * read and spent, and one it would not take is released unspent.
 */
export async function finalizerChangeProposalUpdateRecord(
  client: pg.PoolClient,
  claim: FinalizationClaim,
  write: ChangeProposalUpdateWrite,
): Promise<ChangeProposalWritten> {
  if (!(await finalizerChangeProposalClaimStands(client, claim)))
    return { wrote: "Nothing" };
  const wrote = await client.query(
    sql`UPDATE finalization_change_proposal
        SET merge_update_unread = ${write === "Asked"},
            merge_update_declines = merge_update_declines
              + ${write === "Declined" ? 1 : 0},
            merge_heard_at = CASE WHEN ${write === "Declined"}
                                  THEN merge_heard_at ELSE now() END
      WHERE tenant = ${claim.partition.tenant} AND project = ${claim.partition.project}
        AND request = ${claim.request}
        AND merge IS NULL
        AND merge_update_unread`,
  );
  return wrote.rowCount === 1 ? { wrote: "Row" } : { wrote: "Nothing" };
}

/**
 * Pins the head the kept reading found as the one this proposal is merged at.
 * A row answered as a moved head gives that answer up in the same write and
 * the merge it answered is released, so the next merge is counted afresh
 * under the same ceiling; a row with a merge in flight, one whose reading
 * found another head, and one whose claim has been retired take none.
 */
export async function finalizerChangeProposalAdopt(
  client: pg.PoolClient,
  claim: FinalizationClaim,
  head: GitObjectId,
): Promise<ChangeProposalWritten> {
  if (!(await finalizerChangeProposalClaimStands(client, claim)))
    return { wrote: "Nothing" };
  const wrote = await client.query(
    sql`UPDATE finalization_change_proposal
        SET merge_head = ${head},
            merge = NULL,
            merge_refusals = merge_refusals
              + CASE WHEN merge = 'HeadMoved' THEN 1 ELSE 0 END
      WHERE tenant = ${claim.partition.tenant} AND project = ${claim.partition.project}
        AND request = ${claim.request}
        AND merge_reading = 'Unmerged'
        AND merge_reading_evidence->'head'->>'commit' = ${head}
        AND merge_head IS DISTINCT FROM ${head}
        AND ((merge IS NULL
              AND merge_attempts = merge_refusals + merge_declines)
             OR merge = 'HeadMoved')`,
  );
  return wrote.rowCount === 1 ? { wrote: "Row" } : { wrote: "Nothing" };
}
