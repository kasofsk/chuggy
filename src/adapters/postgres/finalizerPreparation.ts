/**
 * The two durable moves preparation owns: gathering what the ticket's passed
 * work declared, and writing the immutable attempt and the bundle it pinned.
 *
 * THE PASSED SET IS SPELLED IN EACH STATEMENT THAT DRAWS ON IT. A tagged
 * query's interpolations are values, so a fragment shared between the two
 * draws would arrive as one parameter rather than as the predicate it reads
 * like, and a query `check-queries` cannot see whole is a query no server has
 * agreed to.
 *
 * THE GATHER READS ROWS AND DECIDES NOTHING. Whether the artifacts it found are
 * a candidate's worth is `../../interpreter/finalizerPreparation.ts`'s to say,
 * so this file has no notion of a refusal — it hands back the passed work, its
 * artifacts in path order, and the configuration revision those executions ran
 * under. Every draw stops one row past the
 * ceiling the decision is made against, which is what keeps the refusal for
 * exceeding it reachable while bounding what a decision is ever handed.
 *
 * A REWORKED TICKET'S PASSED WORK IS SEVERAL SPAWNS DEEP, and which of them
 * supersedes the rest is the interpreter's to say, so each draw is ordered by
 * descending task number: the latest spawn's rows are the ones a ceiling can
 * never truncate, and the rows a truncation drops are the superseded ones the
 * decision was going to discard anyway. The task number is the wire's name
 * for a task rather than what the machine calls it, and each spawn's numbers
 * continue the ticket's, so descending task order is descending spawn order.
 *
 * EVERY ONE OF THOSE SORTS NAMES THE BIGINT AND NOT AN OUTPUT COLUMN. A bare
 * name in `ORDER BY` binds to the select list first, and the work draw renders
 * its task as text for the row type, so an unqualified sort there would order
 * the ticket's spawns as text and put its tenth spawn behind its ninth.
 *
 * THE FINALIZER READS EXECUTION ROWS AND WRITES NONE. Migration thirteen revokes
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
 * THE GLOBAL LOCK ORDER IS REQUEST, THEN REPOSITORY, THEN PROJECT, THEN PERMIT,
 * THEN ATTEMPT. The record takes the request row and then writes the bundle and
 * the attempt; the gather takes nothing.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import type {
  AttemptRecord,
  AttemptRecorded,
  HandoffArtifact,
  HandoffGathering,
  HandoffSource,
  HandoffWork,
} from "../../interpreter/finalizerPreparation.ts";
import type { FinalizationClaim } from "../../interpreter/finalizer.ts";
import {
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
  candidateExecutionsMax,
  candidateFilesMax,
} from "../../interpreter/finalizer.ts";
import {
  asArtifactDigest,
  asArtifactPath,
  asResultManifestId,
} from "../../interpreter/resultManifest.ts";
import {
  asAttemptId,
  asExecutionId,
  type AttemptId,
} from "../../interpreter/schedulerIdentity.ts";
import { postgresInputBundleWrite } from "./inputBundle.ts";
import { postgresOwnershipEpoch } from "./ownership.ts";
import { projectRowCounter } from "./rows.ts";

/** One passed work execution of the ticket, with the revision it ran under. */
interface WorkRow {
  readonly execution: string;
  readonly attempt: string | null;
  readonly spawn: string;
  readonly task: string;
  readonly manifest: string;
  readonly configuration_revision: string;
  readonly configuration_digest: string;
}

/** One handoff artifact one of those executions declared. */
interface ArtifactRow {
  readonly execution: string;
  readonly attempt: string | null;
  readonly path: string;
  readonly digest: string;
  readonly bytes: string;
}

/** One source handoff declared by passed work. */
interface SourceRow {
  readonly execution: string;
  readonly attempt: string | null;
  readonly repository: string;
  readonly ref: string;
  readonly commit: string;
  readonly base: string;
  readonly expected_base: string;
}

/**
 * The executions whose passed work one finalization promotes. Only a `Work`
 * task's result is authoritative passed-task output, so an evaluation's
 * artifacts are not among them.
 */
async function preparationPassedWork(
  client: pg.PoolClient,
  claim: FinalizationClaim,
): Promise<readonly WorkRow[]> {
  const { tenant, project } = claim.partition;
  const found = await client.query<WorkRow>(
    sql`WITH passed AS (
    SELECT e.tenant, e.project, e.execution, r.attempt, r.manifest,
           e.source_request, e.task,
           e.configuration_revision, e.configuration_digest
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
     WHERE e.tenant = ${tenant} AND e.project = ${project} AND e.ticket = ${claim.ticket}
       AND t.kind = 'Work' AND e.status = 'Terminal' AND e.outcome = 'Passed'
       AND r.verdict = 'Pass')
     SELECT execution, attempt, source_request AS spawn, task::text AS task,
            manifest, configuration_revision, configuration_digest
       FROM passed ORDER BY passed.task DESC LIMIT ${candidateExecutionsMax + 1}`,
  );
  return found.rows;
}

/** The handoff artifacts that passed work declared, latest spawn first and then in path order. */
async function preparationPassedArtifacts(
  client: pg.PoolClient,
  claim: FinalizationClaim,
): Promise<readonly ArtifactRow[]> {
  const { tenant, project } = claim.partition;
  const found = await client.query<ArtifactRow>(
    sql`WITH passed AS (
    SELECT e.tenant, e.project, e.execution, e.task, r.attempt, r.manifest
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
     WHERE e.tenant = ${tenant} AND e.project = ${project} AND e.ticket = ${claim.ticket}
       AND t.kind = 'Work' AND e.status = 'Terminal' AND e.outcome = 'Passed'
       AND r.verdict = 'Pass')
     SELECT p.execution, p.attempt, a.path, a.digest, a.bytes::text AS bytes
       FROM passed p
       JOIN execution_result_artifact a
         ON a.tenant = p.tenant AND a.project = p.project
            AND a.manifest = p.manifest
      WHERE a.role = 'Handoff' ORDER BY p.task DESC, a.path
      LIMIT ${candidateFilesMax + 1}`,
  );
  return found.rows;
}

/** The immutable source candidates that passed work declared, latest spawn first. */
async function preparationPassedSources(
  client: pg.PoolClient,
  claim: FinalizationClaim,
): Promise<readonly SourceRow[]> {
  const { tenant, project } = claim.partition;
  const found = await client.query<SourceRow>(
    sql`SELECT e.execution, r.attempt, s.repository, s.ref, s.commit, s.base,
               s.expected_base
      FROM execution e
      JOIN execution_request_task t
        ON t.tenant = e.tenant AND t.project = e.project
           AND t.request = e.source_request AND t.task = e.task
      JOIN execution_result r
        ON r.tenant = e.tenant AND r.project = e.project
           AND r.execution = e.execution
      JOIN execution_result_source s
        ON s.tenant = r.tenant AND s.project = r.project
           AND s.manifest = r.manifest
     WHERE e.tenant = ${tenant} AND e.project = ${project} AND e.ticket = ${claim.ticket}
       AND t.kind = 'Work' AND e.status = 'Terminal' AND e.outcome = 'Passed'
       AND r.verdict = 'Pass'
     ORDER BY e.task DESC LIMIT ${candidateExecutionsMax + 1}`,
  );
  return found.rows;
}

/**
 * The attempt whose worker reported a passed work result. Only an answer to an
 * evaluation approval writes a result naming none, and that is never work.
 */
function preparationWorkAttempt(attempt: string | null): AttemptId {
  if (attempt === null)
    throw new Error("finalizer preparation: a work result names no attempt");
  return asAttemptId(attempt);
}

/** Everything the ticket's passed work declared, gathered before any decision runs. */
export async function finalizerPreparationGathering(
  client: pg.PoolClient,
  claim: FinalizationClaim,
): Promise<HandoffGathering> {
  const work = await preparationPassedWork(client, claim);
  const artifacts = await preparationPassedArtifacts(client, claim);
  const sources = await preparationPassedSources(client, claim);
  return {
    work: work.map((row): HandoffWork => ({
      execution: asExecutionId(row.execution),
      attempt: preparationWorkAttempt(row.attempt),
      spawn: row.spawn,
      task: projectRowCounter(row.task, "execution task"),
      manifest: asResultManifestId(row.manifest),
      configuration: {
        revision: row.configuration_revision,
        digest: row.configuration_digest,
      },
    })),
    artifacts: artifacts.map((row): HandoffArtifact => ({
      execution: asExecutionId(row.execution),
      attempt: preparationWorkAttempt(row.attempt),
      path: asArtifactPath(row.path),
      digest: asArtifactDigest(row.digest),
      bytes: projectRowCounter(row.bytes, "artifact bytes"),
    })),
    sources: sources.map((row): HandoffSource => ({
      execution: asExecutionId(row.execution),
      attempt: preparationWorkAttempt(row.attempt),
      repository: asRepositoryId(row.repository),
      ref: asGitRefName(row.ref),
      commit: asGitObjectId(row.commit),
      base: asGitObjectId(row.base),
      expectedBase: asGitObjectId(row.expected_base),
    })),
  };
}

/**
 * Writes the immutable attempt and the bundle it pinned in one transaction. The
 * current epoch is read first and the claim is then rechecked under the request
 * row's lock, so an attempt cannot be written by a holder a takeover has
 * already retired — a restore leaves the request row's own fences untouched, so
 * the row alone cannot say the epoch moved.
 */
export async function finalizerPreparationRecord(
  client: pg.PoolClient,
  record: AttemptRecord,
): Promise<AttemptRecorded> {
  const { claim } = record;
  if ((await postgresOwnershipEpoch(client)) !== claim.recoveryEpoch) {
    return { recorded: "Fenced" };
  }
  const held = await client.query<{ one: number }>(
    sql`SELECT 1 AS one FROM finalization_request
      WHERE tenant = ${claim.partition.tenant} AND project = ${claim.partition.project}
        AND request = ${claim.request}
        AND claim_owner = ${claim.owner} AND claim_generation = ${claim.claimGeneration}
        AND recovery_epoch = ${claim.recoveryEpoch}
        AND state IN ('Open', 'Registered')
      FOR UPDATE`,
  );
  if (held.rowCount !== 1) return { recorded: "Fenced" };
  await postgresInputBundleWrite(client, claim.partition, record.bundle);
  await client.query(
    sql`INSERT INTO finalization_attempt
       (tenant, project, attempt, request, ticket, repository, input_bundle,
        input_bundle_digest, target_ref,
        target_commit, target_base_ref, strategy, configuration_revision,
        configuration_digest, outcome, candidate_commit,
        failure_kind, conflict_manifest, conflict_manifest_digest,
        proposal_base_ref, proposal_base_commit, queue_group_commit,
        recheck_commit, recheck_reason, recheck_base_ref, restack_tickets,
        restack_commits, attempt_digest)
     VALUES (${claim.partition.tenant},${claim.partition.project},${record.attempt},
             ${claim.request},${claim.ticket},${record.repository},
             ${record.bundle.bundle},${record.bundle.digest},${record.target.ref},
             ${record.target.commit},${record.target.baseRef ?? null},${record.strategy},
             ${record.configuration.revision},${record.configuration.digest},
             ${record.outcome},
             ${record.candidate ?? null},${record.failureKind ?? null},
             ${record.conflictManifest ?? null},${record.conflictDigest ?? null},
             ${record.proposalBase?.ref ?? null},
             ${record.proposalBase?.commit ?? null},
             ${record.groupCommit ?? null},
             ${record.recheckCommit ?? null},
             ${record.recheckReason ?? null},
             ${record.recheckBaseRef ?? null},
             ${record.restackBeneath?.map((member) => member.ticket) ?? null}::bigint[],
             ${record.restackBeneath?.map((member) => member.commit) ?? null}::text[],
             ${record.attemptDigest})`,
  );
  return { recorded: "Attempt" };
}
