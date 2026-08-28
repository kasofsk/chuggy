/**
 * The durable rows one change proposal leaves: the row written before the forge
 * is asked for it, and the results recorded against that row afterwards.
 *
 * THE ROW IS INSERTED BEFORE `create` IS CALLED, AND THAT ORDER IS WHY IT
 * EXISTS. The request is derivable from the ticket's own frozen brief, so a row
 * that only held it would be the stored duplicate standing rule three rejects;
 * what is not derivable is that a create may have happened. A row with no
 * creation result is exactly that, and `changeProposalPublicationNext` reads it
 * as an ambiguous create — so a crash between the insert and the answer sends
 * the next pass to `readByMarker` and never to a second create.
 *
 * NO FORGE CALL HAPPENS INSIDE EITHER TRANSACTION. Every function here takes a
 * client and returns; the port that reaches the forge is the caller's and is
 * held nowhere in this file, so the ordering is structural rather than careful.
 *
 * A CREATION RESULT IS WRITTEN ONCE AND A RECONCILIATION AS OFTEN AS ONE IS
 * READ. The insert claims the row by primary key, so two passes cannot both open
 * one; the update recording a creation matches only a row that has none, so two
 * passes cannot both answer it; and the trigger refuses either from rewriting
 * what the forge was asked for.
 *
 * THE COUNT IS THE ROW'S AND NOT THE CALLER'S. Every recorded reconciliation
 * increments it in the same statement that writes the verdict, which is what
 * makes the bound the pure step reads a bound on readings that happened rather
 * than on ones a caller remembered.
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
  allChangeProposalCreations,
  allChangeProposalReconciliations,
  allChangeProposalStatuses,
  asChangeProposalRequestIdentity,
  asForgeBindingId,
  asProposalDisplayUrl,
  asProposalRemoteIdentity,
  proposalEvidenceCharsMax,
  type ChangeProposalContradiction,
  type ChangeProposalCreated,
  type ChangeProposalEvidence,
  type ChangeProposalPublicationView,
  type ChangeProposalReconciled,
  type ProposalMarker,
} from "../../interpreter/changeProposal.ts";
import type {
  ChangeProposalAsked,
  ChangeProposalOpened,
  ChangeProposalRecord,
  ChangeProposalRecorded,
  ChangeProposalResult,
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
  readonly reconciliations: string;
}

/** The columns one result writes, whichever arm it came back on. */
interface ChangeProposalResultColumns {
  readonly kind: string;
  readonly contradiction: string | null;
  readonly evidence: string | null;
  readonly url: string | null;
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

/** What the row says the create came to, narrowed to the closed set the port declares. */
function changeProposalCreatedOf(
  row: ChangeProposalRow & { readonly creation: string },
): ChangeProposalCreated {
  const created = finalizerRowValue(
    allChangeProposalCreations,
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
    case "Ambiguous":
    case "Unavailable":
    case "Denied":
      return { created };
    default:
      return assertNever(created);
  }
}

/** What the row says the last reading came to, narrowed the same way. */
function changeProposalReconciledOf(
  row: ChangeProposalRow & { readonly reconciliation: string },
): ChangeProposalReconciled {
  const reconciled = finalizerRowValue(
    allChangeProposalReconciliations,
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
    case "Unavailable":
    case "Denied":
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

/** What the row says has come back, a row with no creation result being an ambiguous create. */
function publicationOf(row: ChangeProposalRow): ChangeProposalPublicationView {
  const creation = row.creation;
  const reconciliation = row.reconciliation;
  return {
    creation:
      creation === null
        ? { created: "Ambiguous" }
        : changeProposalCreatedOf({ ...row, creation }),
    ...(reconciliation === null
      ? {}
      : {
          reconciliation: changeProposalReconciledOf({
            ...row,
            reconciliation,
          }),
        }),
    reconciliations: projectRowCounter(
      row.reconciliations,
      "change proposal reconciliations",
    ),
  };
}

/**
 * Everything the pure step reads of one stored proposal, absent until one is
 * opened. A row carrying no creation result is a create that may have happened
 * and is read as an ambiguous one, which is the whole reason the row is written
 * before the forge is called: the answer it authorizes is a reading, never a
 * second create.
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
 * Writes the row that says a create may have happened. A row already there is
 * refused rather than replaced, because the one already there is the evidence
 * this insert exists to leave.
 */
export async function finalizerChangeProposalOpen(
  client: pg.PoolClient,
  record: ChangeProposalRecord,
): Promise<ChangeProposalOpened> {
  const { claim, request } = record;
  const opened = await client.query(
    sql`INSERT INTO finalization_change_proposal
       (tenant, project, request, permit, proposal_request,
        head_ref, head_commit, base_ref, base_commit, title, body)
     VALUES (${claim.partition.tenant},${claim.partition.project},${claim.request},
             ${record.permit},${request.request},
             ${request.head.ref},${request.head.commit},
             ${request.base.ref},${request.base.commit},
             ${request.title},${request.body})
     ON CONFLICT (tenant, project, request) DO NOTHING`,
  );
  return opened.rowCount === 1 ? { opened: "Opened" } : { opened: "Refused" };
}

/** The evidence one result carries, refused rather than truncated past what a row holds. */
function changeProposalStoredEvidence(
  evidence: ChangeProposalEvidence | undefined,
): string | null {
  if (evidence === undefined) return null;
  const encoded = JSON.stringify(evidence);
  if (encoded.length > proposalEvidenceCharsMax) {
    throw new RangeError(
      "postgres finalizer: a proposal's evidence is past what a row holds",
    );
  }
  return encoded;
}

/** The columns one create's answer writes. */
function changeProposalCreationColumns(
  created: ChangeProposalCreated,
): ChangeProposalResultColumns {
  const carrying =
    created.created === "Created" ||
    created.created === "AlreadyExists" ||
    created.created === "Contradictory";
  const evidence = carrying ? created.evidence : undefined;
  return {
    kind: created.created,
    contradiction:
      created.created === "Contradictory" ? created.contradiction : null,
    evidence: changeProposalStoredEvidence(evidence),
    url: evidence?.url ?? null,
  };
}

/** The columns one reading's answer writes, a reading naming no display URL of its own. */
function changeProposalReconciliationColumns(
  reconciled: ChangeProposalReconciled,
): ChangeProposalResultColumns {
  const carrying =
    reconciled.reconciled === "Accepted" ||
    reconciled.reconciled === "Contradictory";
  return {
    kind: reconciled.reconciled,
    contradiction:
      reconciled.reconciled === "Contradictory"
        ? reconciled.contradiction
        : null,
    evidence: changeProposalStoredEvidence(
      carrying ? reconciled.evidence : undefined,
    ),
    url: carrying ? (reconciled.evidence.url ?? null) : null,
  };
}

/** Records what the create returned, over a row that has no creation result yet. */
async function finalizerChangeProposalCreated(
  client: pg.PoolClient,
  claim: FinalizationClaim,
  created: ChangeProposalCreated,
): Promise<ChangeProposalRecorded> {
  const columns = changeProposalCreationColumns(created);
  const recorded = await client.query(
    sql`UPDATE finalization_change_proposal
        SET creation = ${columns.kind},
            creation_contradiction = ${columns.contradiction},
            creation_evidence = ${columns.evidence}::jsonb,
            proposal_url = ${columns.url}
      WHERE tenant = ${claim.partition.tenant} AND project = ${claim.partition.project}
        AND request = ${claim.request} AND creation IS NULL`,
  );
  return recorded.rowCount === 1
    ? { recorded: "Result" }
    : { recorded: "Refused" };
}

/**
 * Records what one reading read and counts it, over a row whose create answered
 * and over one whose create never did — which is the row a crash leaves and the
 * only row a reading can settle. A reading that found the proposal carries the
 * display URL forward, which is how a surface reaches one whose create never
 * answered.
 */
async function finalizerChangeProposalReconciled(
  client: pg.PoolClient,
  claim: FinalizationClaim,
  reconciled: ChangeProposalReconciled,
): Promise<ChangeProposalRecorded> {
  const columns = changeProposalReconciliationColumns(reconciled);
  const recorded = await client.query(
    sql`UPDATE finalization_change_proposal
        SET reconciliation = ${columns.kind},
            reconciliation_contradiction = ${columns.contradiction},
            reconciliation_evidence = ${columns.evidence}::jsonb,
            proposal_url = coalesce(${columns.url}, proposal_url),
            reconciliations = reconciliations + 1
      WHERE tenant = ${claim.partition.tenant} AND project = ${claim.partition.project}
        AND request = ${claim.request}`,
  );
  return recorded.rowCount === 1
    ? { recorded: "Result" }
    : { recorded: "Refused" };
}

/** Records one result against the open row, whichever of the two it is. */
export function finalizerChangeProposalRecord(
  client: pg.PoolClient,
  record: ChangeProposalResult,
): Promise<ChangeProposalRecorded> {
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
