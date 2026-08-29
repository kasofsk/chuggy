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
 * THE THREE COUNTERS ARE THE WHOLE STATE. `attempts` counts the creates this
 * row may have sent, `refusals` the ones readings proved nothing came of, and
 * `declines` the ones the forge would not take at all, so `attempts = refusals
 * + declines` is nothing in flight and one more than that is a create nobody
 * heard back from. The relation admits no other difference, which is what makes
 * a second create impossible while one is outstanding and possible once one is
 * released; what the ceiling is spent from is `attempts - declines`, the
 * creates that may have reached the forge, so a deployment whose credential was
 * unreadable for a few passes has spent nothing and waits.
 *
 * A RELEASED ATTEMPT TAKES ITS READING WITH IT. A reading is only ever taken
 * about the create in flight, so the release that ends one clears what was read
 * about it and every later pass reads a reading that belongs to the create it
 * is looking at.
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
 * EVIDENCE NO COLUMN HOLDS IS RECORDED WITHOUT IT. A NUL is a character `jsonb`
 * takes no value carrying and a document over the bound is one this relation
 * refuses, and a create is already made by the time either would be discovered
 * — so the answer is stored as unstorable instead, which counts and settles
 * rather than raising out of a pass that cannot then record anything at all.
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
import {
  allChangeProposalContradictions,
  allChangeProposalCreationsStored,
  allChangeProposalReconciliationsStored,
  allChangeProposalStatuses,
  asChangeProposalRequestIdentity,
  asForgeBindingId,
  asProposalDisplayUrl,
  asProposalRemoteIdentity,
  proposalEvidenceCharsMax,
  type ChangeProposalContradiction,
  type ChangeProposalCreationAnswer,
  type ChangeProposalCreationStored,
  type ChangeProposalEvidence,
  type ChangeProposalReconciliationAnswer,
  type ChangeProposalReconciliationStored,
  type OpenedChangeProposalPublication,
  type ProposalMarker,
} from "../../interpreter/changeProposal.ts";
import type {
  ChangeProposalAsked,
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
  identity: z.object({ forge: z.string(), remote: z.string() }),
  repository: z.string(),
  marker: z.string(),
  head: changeProposalStoredRef,
  base: changeProposalStoredRef,
  title: z.string(),
  body: z.string(),
  status: z.string(),
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
    },
    repository: asRepositoryId(value.repository),
    marker: value.marker as ProposalMarker,
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
            reconciliations::text AS reconciliations
       FROM finalization_change_proposal
      WHERE tenant = ${claim.partition.tenant} AND project = ${claim.partition.project}
        AND request = ${claim.request}`,
  );
  const row = found.rows[0];
  if (row === undefined) return undefined;
  return { asked: changeProposalAskedOf(row), publication: publicationOf(row) };
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
 * it: a NUL is a character no `jsonb` value carries, and a document over the
 * bound is one the relation refuses. Either is discovered only after the create
 * it is recording has already been made, so the store is total against whatever
 * an adapter brands rather than raising out of the pass that must record it.
 */
function changeProposalStoredEvidence(
  evidence: ChangeProposalEvidence,
): string | undefined {
  let holdable = true;
  const document = JSON.stringify(evidence, (_key: string, value: unknown) => {
    if (typeof value === "string" && value.includes("\u0000")) {
      holdable = false;
    }
    return value;
  });
  return holdable && document.length <= proposalEvidenceCharsMax
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
