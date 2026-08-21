/**
 * The three durable moves preparation owns: gathering what the ticket's passed
 * work declared, writing the immutable attempt and the bundle it pinned, and
 * asking a person to approve one prepared candidate.
 *
 * THE GATHER READS ROWS AND DECIDES NOTHING. Whether the artifacts it found are
 * a candidate's worth is `../../interpreter/finalizerPreparation.ts`'s to say,
 * so this file has no notion of a refusal and no notion of an approval policy —
 * it hands back the passed work, its artifacts in path order, and the canonical
 * configuration those executions ran under.
 *
 * THE FINALIZER READS EXECUTION ROWS AND WRITES NONE. Migration eleven revokes
 * every scheduler relation from the role and then grants back `SELECT` on the
 * four a handoff is spelled across, which is the same revoke-then-narrow shape
 * the role's other reads take. A handoff is metadata the scheduler wrote and
 * the finalizer is the first thing that needs it as content.
 *
 * AN ATTEMPT AND ITS BUNDLE COMMIT TOGETHER. The bundle is what the candidate's
 * commit message names, so an attempt whose bundle was not written would point
 * at a reference nobody can resolve; both rows are written in one transaction
 * and the attempt names the bundle it pinned, so a rework materialized from
 * that attempt carries its references forward rather than re-deriving them.
 *
 * NOTHING HERE UPDATES ANYTHING. `finalization_attempt`, `input_bundle` and
 * `input_bundle_reference` each carry a trigger refusing every UPDATE and
 * DELETE, so a second preparation is another identity rather than a revision,
 * and a re-run of a preparation that already committed is refused by the
 * primary key rather than by a read.
 *
 * THE APPROVAL GOES THROUGH A DOOR AND NOT A TABLE. The action is the ticket
 * service's row and this role holds `SELECT` on it and no more, so the ask is
 * `request_finalization_approval`, which builds the row from durable rows and
 * refuses a binding they disagree with.
 *
 * THE GLOBAL LOCK ORDER IS REQUEST, THEN REPOSITORY, THEN PROJECT, THEN PERMIT,
 * THEN ATTEMPT. The record takes the request row and then writes the bundle and
 * the attempt; the gather takes nothing; the door takes the request and then the
 * ticket service's own rows inside it.
 */

import { randomUUID } from "node:crypto";
import type pg from "pg";

import { asCanonicalConfiguration } from "../../interpreter/authoring.ts";
import type {
  ApprovalAsk,
  ApprovalAsked,
  AttemptRecord,
  AttemptRecorded,
  HandoffArtifact,
  HandoffGathering,
  HandoffWork,
} from "../../interpreter/finalizerPreparation.ts";
import { allApprovalRefusals } from "../../interpreter/finalizerPreparation.ts";
import type { FinalizationClaim } from "../../interpreter/finalizer.ts";
import {
  asArtifactDigest,
  asArtifactPath,
  asResultManifestId,
} from "../../interpreter/resultManifest.ts";
import {
  asAttemptId,
  asExecutionId,
} from "../../interpreter/schedulerIdentity.ts";
import { postgresInputBundleWrite } from "./inputBundle.ts";
import { projectRowCounter } from "./rows.ts";
import {
  finalizerLiveRequestStates,
  finalizerRowValue,
} from "./finalizerRows.ts";
import { approvalRequestFunction } from "./schema.ts";

/** One passed work execution of the ticket, with the revision it ran under. */
interface WorkRow {
  readonly execution: string;
  readonly attempt: string;
  readonly manifest: string;
  readonly configuration_revision: string;
  readonly configuration_digest: string;
  readonly canonical: string;
}

/** One handoff artifact one of those executions declared. */
interface ArtifactRow {
  readonly execution: string;
  readonly attempt: string;
  readonly path: string;
  readonly digest: string;
  readonly bytes: string;
}

/** What the approval door answered about one prepared attempt. */
interface ApprovalRow {
  readonly result: string;
  readonly action: string | null;
}

/**
 * The executions whose passed work one finalization promotes. Only a `Work`
 * task's result is authoritative passed-task output, so an evaluation's
 * artifacts are not among them.
 */
const preparationPassedWork = `
  WITH passed AS (
    SELECT e.tenant, e.project, e.execution, r.attempt, r.manifest,
           e.configuration_revision, e.configuration_digest, c.canonical
      FROM execution e
      JOIN execution_request_task t
        ON t.tenant = e.tenant AND t.project = e.project
           AND t.request = e.source_request AND t.task = e.task
      JOIN execution_result r
        ON r.tenant = e.tenant AND r.project = e.project
           AND r.execution = e.execution
      JOIN configuration_revision c
        ON c.tenant = e.tenant AND c.project = e.project
           AND c.revision = e.configuration_revision
           AND c.digest = e.configuration_digest
     WHERE e.tenant = $1 AND e.project = $2 AND e.ticket = $3
       AND t.kind = 'Work' AND e.status = 'Terminal' AND e.outcome = 'Passed'
       AND r.verdict = 'Pass')
`;

/** Everything the ticket's passed work declared, gathered before any decision runs. */
export async function finalizerPreparationGathering(
  client: pg.PoolClient,
  claim: FinalizationClaim,
): Promise<HandoffGathering> {
  const values = [
    claim.partition.tenant,
    claim.partition.project,
    claim.ticket,
  ];
  const work = await client.query<WorkRow>(
    `${preparationPassedWork}
     SELECT execution, attempt, manifest, configuration_revision,
            configuration_digest, canonical
       FROM passed ORDER BY execution`,
    values,
  );
  const artifacts = await client.query<ArtifactRow>(
    `${preparationPassedWork}
     SELECT p.execution, p.attempt, a.path, a.digest, a.bytes::text AS bytes
       FROM passed p
       JOIN execution_result_artifact a
         ON a.tenant = p.tenant AND a.project = p.project
            AND a.manifest = p.manifest
      WHERE a.role = 'Handoff' ORDER BY a.path`,
    values,
  );
  return {
    work: work.rows.map((row): HandoffWork => ({
      execution: asExecutionId(row.execution),
      attempt: asAttemptId(row.attempt),
      manifest: asResultManifestId(row.manifest),
      configuration: {
        revision: row.configuration_revision,
        digest: row.configuration_digest,
      },
      canonical: asCanonicalConfiguration(row.canonical),
    })),
    artifacts: artifacts.rows.map((row): HandoffArtifact => ({
      execution: asExecutionId(row.execution),
      attempt: asAttemptId(row.attempt),
      path: asArtifactPath(row.path),
      digest: asArtifactDigest(row.digest),
      bytes: projectRowCounter(row.bytes, "artifact bytes"),
    })),
  };
}

/**
 * Writes the immutable attempt and the bundle it pinned in one transaction. The
 * claim is rechecked under the request row's lock, so an attempt cannot be
 * written by a holder a takeover has already retired.
 */
export async function finalizerPreparationRecord(
  client: pg.PoolClient,
  record: AttemptRecord,
): Promise<AttemptRecorded> {
  const { claim } = record;
  const held = await client.query(
    `SELECT 1 FROM finalization_request
      WHERE tenant = $1 AND project = $2 AND request = $3
        AND claim_owner = $4 AND claim_generation = $5 AND recovery_epoch = $6
        AND state IN (${finalizerLiveRequestStates})
      FOR UPDATE`,
    [
      claim.partition.tenant,
      claim.partition.project,
      claim.request,
      claim.owner,
      claim.claimGeneration,
      claim.recoveryEpoch,
    ],
  );
  if (held.rowCount !== 1) return { recorded: "Fenced" };
  await postgresInputBundleWrite(client, claim.partition, record.bundle);
  await client.query(
    `INSERT INTO finalization_attempt
       (tenant, project, attempt, request, ticket, repository, input_bundle,
        input_bundle_digest, target_ref,
        target_commit, strategy, configuration_revision, configuration_digest,
        approval_required, outcome, candidate_commit, failure_kind,
        conflict_manifest, conflict_manifest_digest, attempt_digest)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [
      claim.partition.tenant,
      claim.partition.project,
      record.attempt,
      claim.request,
      claim.ticket,
      record.repository,
      record.bundle.bundle,
      record.bundle.digest,
      record.target.ref,
      record.target.commit,
      record.strategy,
      record.configuration.revision,
      record.configuration.digest,
      record.approvalRequired,
      record.outcome,
      record.candidate ?? null,
      record.failureKind ?? null,
      record.conflictManifest ?? null,
      record.conflictDigest ?? null,
      record.attemptDigest,
    ],
  );
  return { recorded: "Attempt" };
}

/** Narrows the door's verdict to the closed set the port declares. */
function finalizerPreparationAsked(row: ApprovalRow): ApprovalAsked {
  if (row.result === "Requested") return { asked: "Requested" };
  if (row.result === "AlreadyRequested") return { asked: "AlreadyRequested" };
  return {
    asked: "Refused",
    refusal: finalizerRowValue(
      allApprovalRefusals,
      row.result,
      "approval refusal",
    ),
  };
}

/** Asks a person to approve one prepared candidate, through the one door that may open it. */
export async function finalizerPreparationApproval(
  client: pg.PoolClient,
  ask: ApprovalAsk,
): Promise<ApprovalAsked> {
  const { claim } = ask;
  const asked = await client.query<ApprovalRow>(
    `SELECT result, action FROM ${approvalRequestFunction}($1,$2,$3,$4,$5)`,
    [
      claim.partition.tenant,
      claim.partition.project,
      ask.attempt,
      `approval-${randomUUID()}`,
      claim.recoveryEpoch,
    ],
  );
  const row = asked.rows[0];
  if (row === undefined) {
    throw new Error(
      "postgres finalizer: the approval door returned no verdict at all",
    );
  }
  return finalizerPreparationAsked(row);
}
