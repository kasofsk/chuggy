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

import { asTicketId } from "../../src/domain/ids.ts";
import { asGitObjectId } from "../../src/interpreter/finalizer.ts";
import { stackRecordWrite } from "../../src/adapters/postgres/evaluationStack.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import type { EvaluationStack } from "../../src/interpreter/evaluationStack.ts";
import {
  finalizerBriefLanding,
  finalizerBriefProposal,
  finalizerCommit,
  finalizerDeclareSource,
  finalizerDigest,
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
  /** Whether the attempt's bundle pins a result manifest, which it does unless a case says it does not. */
  readonly pinned?: false;
  /**
   * The proposal it lands by, where it lands by one: the attempt is then
   * prepared onto `head` and pushes `candidate` there, and the proposal is
   * opened into `landingTarget` at `onto` and merged at `merged`, where it was.
   */
  readonly proposal?: { readonly head: string; readonly merged?: string };
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
       SELECT tenant, project, $3, $4, $5,
              (SELECT max(manifest_ordinal) + 1 FROM execution_result
                WHERE tenant=$1 AND project=$2),
              schema_version, repeat('1',64), verdict
         FROM execution_result
        WHERE tenant=$1 AND project=$2 AND execution=$6 AND attempt=$7`,
      [tenant, named, manifest, execution, run, work.execution, work.attempt],
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
  const onto = landing.proposal?.head ?? landingTarget;
  const attempt = await finalizerPrepare(rig, prepared, label, {
    target: landing.onto,
    candidate: landing.candidate,
    targetRef: onto,
  });
  if (landing.pinned !== false)
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
      onto,
      landing.verdict ?? "Promoted",
    ],
  );
  await rig.as(
    `UPDATE commit_permit SET state='Concluded', concluded_at=now()
      WHERE tenant=$1 AND project=$2 AND permit=$3`,
    [tenant, named, permit],
  );
  if (landing.proposal !== undefined)
    await landingProposed(rig, project, permit, landing, landing.proposal);
}

/** The proposal one landing opened from its head into `landingTarget`, merged where it says so. */
async function landingProposed(
  rig: FinalizerRig,
  project: FinalizerProject,
  permit: string,
  landing: Landing,
  proposal: NonNullable<Landing["proposal"]>,
): Promise<void> {
  const key = [project.partition.tenant, project.partition.project];
  await rig.as(
    `INSERT INTO finalization_change_proposal
       (tenant,project,request,permit,proposal_request,head_ref,head_commit,
        base_ref,base_commit,title,body,attempts)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ticket: land it','land it',1)`,
    [
      ...key,
      project.request,
      permit,
      finalizerDigest(),
      proposal.head,
      landing.candidate,
      landingTarget,
      landing.onto,
    ],
  );
  await rig.as(
    `UPDATE finalization_change_proposal
        SET creation='Created', creation_evidence=$4::jsonb
      WHERE tenant=$1 AND project=$2 AND request=$3`,
    [
      ...key,
      project.request,
      JSON.stringify({ title: "ticket: land it", body: "land it" }),
    ],
  );
  if (proposal.merged !== undefined)
    await rig.as(
      `UPDATE finalization_change_proposal
          SET merge_attempts=1, merge='Merged', merge_commit=$4
        WHERE tenant=$1 AND project=$2 AND request=$3`,
      [...key, project.request, proposal.merged],
    );
}

/** A request of `ticket`'s own beside `project`'s, settled, which a landing by proposal is recorded under. */
export async function landingRequest(
  rig: FinalizerRig,
  project: FinalizerProject,
  ticket: number,
  label: string,
): Promise<FinalizerProject> {
  const request = finalizerIdentity(`request-${label}`);
  await rig.harness.query(
    `INSERT INTO finalization_request
       (tenant, project, request, authorizing_seq, effect_position, ticket,
        ticket_version, request_generation, kind, state, work_cycle,
        finalization_generation)
     VALUES ($1,$2,$3,$4,1,$5,$4,1,'RunFinalizer','Fulfilled',1,1)`,
    [
      project.partition.tenant,
      project.partition.project,
      request,
      project.authorizingSeq,
      ticket,
    ],
  );
  return { ...project, request };
}

/**
 * A Stacked ticket whose work, accepted at `accepted`, passed and awaits its
 * landing: a push, or a proposal into the default from `proposing` where named.
 */
export async function stackedSubject(
  rig: FinalizerRig,
  label: string,
  accepted = finalizerCommit(),
  proposing?: string,
) {
  const project = await finalizerProject(rig, label);
  await finalizerBriefLanding(
    rig,
    project.partition,
    project.ticket,
    "Stacked",
    project.repository,
  );
  if (proposing !== undefined)
    await finalizerBriefProposal(
      rig,
      project.partition,
      project.ticket,
      proposing,
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

/** Records the first cycle's stack over one ticket beneath that is in no queue, with the tree the stack was. */
export async function recordStackBeneathNobody(
  pool: pg.Pool,
  project: FinalizerProject,
  stackTree: string = finalizerCommit(),
): Promise<void> {
  await recordStack(pool, project.partition, {
    ticket: asTicketId(project.ticket),
    cycle: 1,
    repository: project.repository,
    target: landingTarget,
    tip: asGitObjectId(finalizerCommit()),
    beneath: [
      { ticket: asTicketId(999), commit: asGitObjectId(finalizerCommit()) },
    ],
    stackCommit: asGitObjectId(finalizerCommit()),
    stackTree: asGitObjectId(stackTree),
  });
}
