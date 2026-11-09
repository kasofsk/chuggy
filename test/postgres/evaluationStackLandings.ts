/**
 * The landings of other tickets, for a project that drives one real ticket.
 *
 * THEY ARE ROWS A CASE PLACES DIRECTLY. Standing is about the order a
 * reference moved in, so the tickets that landed before the real one are an
 * attempt, its permit, its promotion and the result manifest whose source is
 * the commit the ticket was accepted at. The manifest's execution is a copy of
 * the real ticket's, written with the checks that tie an execution to a ticket
 * the project released switched off for that one transaction.
 */

import type pg from "pg";

import { stackRecordWrite } from "../../src/adapters/postgres/evaluationStack.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import type { EvaluationStack } from "../../src/interpreter/evaluationStack.ts";
import {
  finalizerBriefLanding,
  finalizerCommit,
  finalizerDeclareSource,
  finalizerGrantPermit,
  finalizerIdentity,
  finalizerPassedWork,
  finalizerPrepare,
  finalizerProject,
  type FinalizerProject,
  type FinalizerRig,
} from "./finalizerHarness.ts";

/** The reference every landing here is promoted onto. */
export const landingTarget = "refs/heads/main";

/** What a landing of `ticket` accepted at `accepted` is written with. */
export interface Landing {
  readonly ticket: number;
  readonly accepted: string;
  readonly onto: string;
  readonly candidate: string;
  readonly verdict?: "Promoted" | "NotPromoted";
}

/** The passed work the landings are copied from. */
export interface LandingWork {
  readonly execution: string;
  readonly attempt: string;
}

/** Distinct commits of the real width, named by what a case calls them. */
export function landingCommits<Name extends string>(
  ...names: readonly Name[]
): Record<Name, string> {
  const entries = names.map((name): [Name, string] => [
    name,
    finalizerCommit(),
  ]);
  return Object.fromEntries(entries) as Record<Name, string>;
}

/** Gives `ticket` a passed result manifest of its own beside the project's real one. */
async function landingManifest(
  rig: FinalizerRig,
  project: FinalizerProject,
  work: LandingWork,
  label: string,
  ticket: number,
): Promise<string> {
  const { tenant, project: named } = project.partition;
  const manifest = finalizerIdentity(`manifest-${label}`);
  const run = finalizerIdentity(`run-${label}`);
  const execution = finalizerIdentity(`execution-${label}`);
  const transaction = await rig.harness.begin();
  try {
    await transaction.query(`SET LOCAL session_replication_role = replica`);
    await transaction.query(
      `CREATE TEMP TABLE landing_execution ON COMMIT DROP AS
         SELECT * FROM execution WHERE tenant=$1 AND project=$2 AND execution=$3`,
      [tenant, named, work.execution],
    );
    await transaction.query(
      `UPDATE landing_execution
          SET execution=$1, requirement_identity=$1, ticket=$2, status='Running',
              outcome=NULL, result_manifest=NULL, completion_operation=NULL,
              terminal_at=NULL`,
      [execution, ticket],
    );
    await transaction.query(
      `INSERT INTO execution SELECT * FROM landing_execution`,
    );
    await transaction.query(
      `INSERT INTO execution_attempt
         (tenant, project, execution, attempt, attempt_number, recovery_epoch,
          state, ended_at, capability, capability_secret_digest, manifest)
       VALUES ($1,$2,$3,$4,1,$5,'Reported',now(),
               'capability-' || gen_random_uuid(), repeat('0',64),
               'manifest-' || gen_random_uuid())`,
      [tenant, named, execution, run, project.epoch],
    );
    await transaction.query(
      `INSERT INTO execution_result
         (tenant, project, manifest, execution, attempt, manifest_ordinal,
          schema_version, digest, verdict)
       SELECT tenant, project, $3, $4, $5, manifest_ordinal + $6,
              schema_version, repeat('1',64), verdict
         FROM execution_result
        WHERE tenant=$1 AND project=$2 AND execution=$7 AND attempt=$8`,
      [
        tenant,
        named,
        manifest,
        execution,
        run,
        ticket,
        work.execution,
        work.attempt,
      ],
    );
    await transaction.commit();
  } catch (failure) {
    await transaction.rollback();
    throw failure;
  }
  return manifest;
}

/** Writes the attempt, the permit, the reconciliation and the manifest source of one landing. */
export async function landingWrite(
  rig: FinalizerRig,
  project: FinalizerProject,
  work: LandingWork,
  label: string,
  landing: Landing,
): Promise<void> {
  const { tenant, project: named } = project.partition;
  const manifest = await landingManifest(
    rig,
    project,
    work,
    label,
    landing.ticket,
  );
  await finalizerDeclareSource(
    rig,
    project,
    { ...work, manifest },
    "refs/heads/work",
    landing.accepted,
  );
  const prepared = { ...project, ticket: landing.ticket };
  const attempt = await finalizerPrepare(rig, prepared, label, {
    target: landing.onto,
    candidate: landing.candidate,
  });
  await rig.as(
    `INSERT INTO input_bundle_reference
       (tenant, project, bundle, ordinal, reference_kind, reference_id)
     SELECT tenant, project, input_bundle, 2, 'ResultManifest', $4
       FROM finalization_attempt WHERE tenant=$1 AND project=$2 AND attempt=$3`,
    [tenant, named, attempt, manifest],
  );
  const permit = await finalizerGrantPermit(rig, prepared, attempt, label);
  await rig.as(
    `INSERT INTO finalization_reconciliation
       (tenant, project, permit, candidate_commit, target_ref, verdict, observed_commit)
     VALUES ($1,$2,$3,$4,$5,$6,$4)`,
    [
      tenant,
      named,
      permit,
      landing.candidate,
      landingTarget,
      landing.verdict ?? "Promoted",
    ],
  );
  await rig.as(
    `UPDATE commit_permit SET state='Concluded', concluded_at=now()
      WHERE tenant=$1 AND project=$2 AND permit=$3`,
    [tenant, named, permit],
  );
}

/** A Stacked ticket whose work, accepted at `accepted`, passed and awaits its landing. */
export async function stackedSubject(
  rig: FinalizerRig,
  label: string,
  accepted = finalizerCommit(),
) {
  const project = await finalizerProject(rig, label);
  await finalizerBriefLanding(
    rig,
    project.partition,
    project.ticket,
    "Stacked",
    project.repository,
  );
  const work = await finalizerPassedWork(rig, project, label, []);
  await finalizerDeclareSource(rig, project, work, "refs/heads/work", accepted);
  return { project, work };
}

/** Writes a stack record as the finalizer role, for a cycle whatever its evaluations are. */
export async function recordStack(
  pool: pg.Pool,
  partition: Partition,
  stack: EvaluationStack,
): Promise<"Written" | "Present"> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const written = await stackRecordWrite(client, partition, stack);
    await client.query("COMMIT");
    return written;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
