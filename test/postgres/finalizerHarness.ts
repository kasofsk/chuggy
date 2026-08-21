/**
 * What every finalizer case in this directory needs of a real PostgreSQL: a
 * project whose ticket a real decision put into `Finalizing`, the durable rows
 * migration eleven adds, and a connection as the role that will actually run
 * them.
 *
 * THE ROWS RUN AS `chuggy_finalizer` AND NOT AS THE MIGRATION OWNER. Every
 * grant migration eleven writes is a claim about what that role may do, and a
 * suite writing them as the owner would prove the DDL parses rather than that
 * the deployment can run it — a column grant omitting a column a legal move
 * writes is invisible to any other kind of test. The role is `NOLOGIN`, so the
 * pool asks for it as a startup option on a session the owner opened.
 *
 * THE REQUEST IS WRITTEN BY THE PART THAT OWNS IT. A finalization request is
 * I3's, materialized by the decision transaction that moved a ticket into
 * `Finalizing`, so this harness drives the real writer through release,
 * dispatch, work and evaluation rather than inserting the row it wants. An
 * attempt and a permit are each offered both ways: written by hand where a case
 * needs one to exist, and asked of the real transaction where the move is what
 * is under test.
 *
 * THE PASSED WORK IS WRITTEN BY HAND AND THE HANDOFFS ARE REAL BYTES. The
 * scheduler that would write an execution, its attempt and its result is
 * another slice's deployable and is not what these cases are about, but the
 * artifacts those rows declare are stored in the rig's own store under the
 * digest they really hash to — so a case that tampers with one is refused by
 * the verification it was meant to satisfy.
 *
 * THE GIT PORT IS A FAKE AND THE DURABLE AUTHORITY IS NOT. Substitution belongs
 * at the port, and the answers that matter here — a refused update, an ambiguous
 * one, an unreadable ref — are exactly the ones a real remote will not produce
 * on demand. The store underneath is the real adapter against the real server,
 * so nothing the fake says can make a durable move agree with it, and
 * `finalizerPreparation.test.ts` drives the real remote where a real one can
 * answer.
 *
 * COMMITS AND DIGESTS ARE REAL WIDTHS AND NOT PLACEHOLDERS. Every commit
 * identity a case writes matches the object-id pattern the DDL carries and
 * every digest matches the artifact-digest width, so a case that writes one
 * wrongly is refused by the constraint it was meant to satisfy rather than
 * passing on a value nothing checked.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import type pg from "pg";

import { taskDoneEvent } from "../../src/actor/decisionEvent.ts";
import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import {
  accountIdentityFunction,
  approvalRequestFunction,
  finalizerRole,
} from "../../src/adapters/postgres/schema.ts";
import { artifactStore } from "../../src/adapters/artifacts/artifactStore.ts";
import {
  artifactAttemptFile,
  artifactProjectDirectory,
} from "../../src/adapters/artifacts/artifactKey.ts";
import { asTaskId, asTicketId } from "../../src/domain/ids.ts";
import { postgresFinalizer } from "../../src/adapters/postgres/finalizer.ts";
import type { FinalizerService } from "../../src/interpreter/finalizerRun.ts";
import {
  allGitObjectIdChars,
  asFinalizationAttemptId,
  asFinalizerOwnerId,
  asInputBundleId,
  checkedFinalizerConfig,
  finalizerDefaults,
  type AncestryProved,
  type CandidateIntegrated,
  type CandidatePrepared,
  type CandidatePromoted,
  type CandidatePromotion,
  type FinalizationClaim,
  type GitPromotionPort,
  type ObservedTarget,
  type TargetObserved,
} from "../../src/interpreter/finalizer.ts";
import {
  asProjectArtifactId,
  type CanonicalFinalization,
  type FinalizerIdentityFactory,
} from "../../src/interpreter/finalizerPreparation.ts";
import {
  artifactDigestChars,
  asArtifactPath,
} from "../../src/interpreter/resultManifest.ts";
import { asOperationDecisionEvent } from "../../src/interpreter/operationInbox.ts";
import {
  asRecoveryEpoch,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import {
  projectWriterDecide,
  type ProjectMemory,
} from "../../src/interpreter/projectWriter.ts";
import { plainResult } from "../actor/harness.ts";
import { id } from "../domain/fixtures.ts";
import {
  postgresHarnessHistory,
  postgresHarnessJournal,
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessSubmission,
  postgresHarnessUrl,
  postgresHarnessWriter,
  type PostgresHarness,
} from "./harness.ts";

/** A pool whose every session runs as the finalizer's own role. */
export function finalizerRolePool(): pg.Pool {
  const url = new URL(postgresHarnessUrl());
  url.searchParams.set("options", `-c role=${finalizerRole}`);
  return postgresPool(url.toString());
}

/** One opened subject: the owner's harness, the finalizer's pool, and the way to give both back. */
export interface FinalizerRig {
  readonly harness: PostgresHarness;
  readonly pool: pg.Pool;
  readonly artifactRoot: string;
  readonly as: (
    sql: string,
    values?: readonly unknown[],
  ) => Promise<readonly Record<string, unknown>[]>;
  readonly refusal: (
    sql: string,
    values?: readonly unknown[],
  ) => Promise<string>;
  readonly ownerRefusal: (
    sql: string,
    values?: readonly unknown[],
  ) => Promise<string>;
  readonly close: () => Promise<void>;
}

/** The refusal a statement drew, or a failure saying the server allowed it. */
async function finalizerRefused(
  run: () => Promise<unknown>,
  sql: string,
): Promise<string> {
  try {
    await run();
  } catch (refused) {
    return refused instanceof Error ? refused.message : String(refused);
  }
  throw new Error(`finalizer harness: the server allowed \`${sql}\``);
}

/** Opens a migrated database and a finalizer-role pool over it. */
export async function finalizerRigOpen(): Promise<FinalizerRig> {
  const harness = await postgresHarnessOpen();
  const pool = finalizerRolePool();
  const artifactRoot = mkdtempSync(join(tmpdir(), "chuggy-artifacts-"));
  const as = async (
    sql: string,
    values?: readonly unknown[],
  ): Promise<readonly Record<string, unknown>[]> =>
    (await pool.query(sql, values === undefined ? undefined : [...values]))
      .rows as readonly Record<string, unknown>[];
  return {
    harness,
    pool,
    artifactRoot,
    as,
    refusal: (sql, values) => finalizerRefused(() => as(sql, values), sql),
    ownerRefusal: (sql, values) =>
      finalizerRefused(() => harness.query(sql, values), sql),
    close: async () => {
      await pool.end();
      await harness.close();
      rmSync(artifactRoot, { recursive: true, force: true });
    },
  };
}

/** The most decisions one fixture drains, which is what bounds the loop draining them. */
const finalizerDecisionsMax = 16;

/** One case's finalizing project: the request awaiting a finalizer and the rows it is bound to. */
export interface FinalizerProject {
  readonly partition: Partition;
  readonly request: string;
  readonly ticket: number;
  readonly authorizingSeq: number;
  readonly requestGeneration: number;
  readonly epoch: string;
  readonly repository: string;
  readonly configurationRevision: string;
  readonly configurationDigest: string;
  readonly memory: ProjectMemory;
}

/** What draining the queue left: the state the last decision installed, and what each one was. */
export interface FinalizerDrained {
  readonly memory: ProjectMemory;
  readonly decided: readonly string[];
}

/**
 * Decides everything the project's queue currently holds, which is how a
 * continuation the last commit emitted reaches the writer that must consume it.
 * A refusal is one of the answers a writer gives, so a fenced input drains and
 * is reported rather than raising.
 */
export async function finalizerDrain(
  harness: PostgresHarness,
  partition: Partition,
  memory: ProjectMemory,
): Promise<FinalizerDrained> {
  const writer = postgresHarnessWriter(harness);
  let carried = memory;
  const decided: string[] = [];
  for (let drained = 0; drained < finalizerDecisionsMax; drained++) {
    const input = await harness.discovery.next(partition, 300);
    if (input === undefined) return { memory: carried, decided };
    const step = await projectWriterDecide(writer, carried, input);
    decided.push(step.decided.decided);
    carried = step.memory;
  }
  throw new Error(
    "finalizer harness: the project queue did not drain within its bound",
  );
}

/** Accepts one reported task and decides it along with everything it enqueues. */
async function finalizerReport(
  harness: PostgresHarness,
  partition: Partition,
  memory: ProjectMemory,
  label: string,
  task: number,
): Promise<ProjectMemory> {
  const accepted = await harness.inbox.accept({
    ...postgresHarnessSubmission(partition, label),
    command: {
      version: 1,
      command: "Decide",
      event: asOperationDecisionEvent(
        taskDoneEvent(id(1), asTaskId(task), "Pass", plainResult),
      ),
    },
  });
  if (accepted.accepted !== "Accepted") {
    throw new Error(`finalizer harness: the report was ${accepted.accepted}`);
  }
  const drained = await finalizerDrain(harness, partition, memory);
  const refused = drained.decided.find((each) => each !== "Committed");
  if (refused !== undefined) {
    throw new Error(`finalizer harness: a queued decision was ${refused}`);
  }
  return drained.memory;
}

/** The repository, configuration and epoch a prepared attempt is bound to. */
async function finalizerBind(
  rig: FinalizerRig,
  partition: Partition,
  label: string,
  named?: string,
): Promise<{
  epoch: string;
  repository: string;
  revision: string;
  digest: string;
}> {
  const epoch = await rig.harness.store.currentRecoveryEpoch();
  const repository = named ?? `repository-${label}-${randomUUID()}`;
  await rig.harness.query(
    `INSERT INTO project_repository (tenant, project, repository, recovery_epoch)
     VALUES ($1,$2,$3,$4)`,
    [partition.tenant, partition.project, repository, epoch],
  );
  const found = (await rig.harness.query(
    `SELECT revision, digest FROM configuration_revision WHERE tenant=$1 AND project=$2`,
    [partition.tenant, partition.project],
  )) as readonly { revision: string; digest: string }[];
  const pinned = found[0];
  if (pinned === undefined) {
    throw new Error("finalizer harness: the release pinned no configuration");
  }
  return { epoch, repository, ...pinned };
}

/**
 * A project whose ticket a real decision put into `Finalizing`, with the
 * repository binding a preparation needs. Everything up to the request is the
 * writer's own work, so the request under test is one a decision authorized.
 */
export async function finalizerProject(
  rig: FinalizerRig,
  label: string,
  repository?: string,
): Promise<FinalizerProject> {
  const partition = await postgresHarnessProject(rig.harness.store, label);
  const first = await postgresHarnessHistory(
    rig.harness,
    partition,
    label,
    postgresHarnessJournal().length,
  );
  const worked = await finalizerReport(rig.harness, partition, first, label, 1);
  const memory = await finalizerReport(
    rig.harness,
    partition,
    worked,
    label,
    2,
  );
  const found = (await rig.harness.query(
    `SELECT request, ticket::text AS ticket, authorizing_seq::text AS seq,
            request_generation::text AS generation
       FROM finalization_request WHERE tenant=$1 AND project=$2`,
    [partition.tenant, partition.project],
  )) as readonly {
    request: string;
    ticket: string;
    seq: string;
    generation: string;
  }[];
  const row = found[0];
  if (row === undefined) {
    throw new Error(
      "finalizer harness: the evaluation left no finalization request",
    );
  }
  const bound = await finalizerBind(rig, partition, label, repository);
  return {
    partition,
    request: row.request,
    ticket: Number(row.ticket),
    authorizingSeq: Number(row.seq),
    requestGeneration: Number(row.generation),
    epoch: bound.epoch,
    repository: bound.repository,
    configurationRevision: bound.revision,
    configurationDigest: bound.digest,
    memory,
  };
}

/** Hexadecimal no other call has produced, at least as long as the widest identity a case needs. */
function finalizerHex(): string {
  return `${randomUUID()}${randomUUID()}`.replaceAll("-", "");
}

/** A commit identity of the shorter width git addresses objects at, distinct per call. */
export function finalizerCommit(): string {
  return finalizerHex().slice(0, allGitObjectIdChars[0]);
}

/** A digest of the width the artifact constraint admits, distinct per call. */
export function finalizerDigest(): string {
  return finalizerHex().slice(0, artifactDigestChars);
}

/** The identity of one attempt, permit, reconciliation or action no other case is using. */
export function finalizerIdentity(label: string): string {
  return `${label}-${randomUUID()}`;
}

/** What one prepared or failed attempt a case writes says, defaulted to the clean prepared one. */
export interface FinalizerAttempt {
  readonly attempt?: string;
  readonly target?: string;
  readonly outcome?: "Prepared" | "Failed";
  readonly candidate?: string | null;
  readonly failureKind?: string | null;
  readonly approvalRequired?: boolean;
}

/** Writes one attempt as the finalizer, which is the role that owns preparations. */
export async function finalizerPrepare(
  rig: FinalizerRig,
  project: FinalizerProject,
  label: string,
  attempt: FinalizerAttempt = {},
): Promise<string> {
  const identity = attempt.attempt ?? finalizerIdentity(`attempt-${label}`);
  const outcome = attempt.outcome ?? "Prepared";
  await rig.as(
    `INSERT INTO finalization_attempt
       (tenant, project, attempt, request, ticket, repository, target_ref,
        target_commit, strategy, configuration_revision, configuration_digest,
        approval_required, outcome, candidate_commit, failure_kind, attempt_digest)
     VALUES ($1,$2,$3,$4,$5,$6,'refs/heads/main',$7,'Merge',$8,$9,$10,$11,$12,$13,$14)`,
    [
      project.partition.tenant,
      project.partition.project,
      identity,
      project.request,
      project.ticket,
      project.repository,
      attempt.target ?? finalizerCommit(),
      project.configurationRevision,
      project.configurationDigest,
      attempt.approvalRequired ?? false,
      outcome,
      outcome === "Prepared" ? (attempt.candidate ?? finalizerCommit()) : null,
      outcome === "Failed" ? (attempt.failureKind ?? "MergeConflict") : null,
      finalizerDigest(),
    ],
  );
  return identity;
}

/** Claims the project's request as the finalizer would, which is what fences everything after it. */
export async function finalizerClaim(
  rig: FinalizerRig,
  project: FinalizerProject,
  owner: string,
): Promise<FinalizationClaim> {
  const claimed = await rig.as(
    `UPDATE finalization_request
        SET state='Registered', claim_owner=$4, claim_generation=claim_generation+1,
            claim_expires_at=now()+interval '60 seconds', recovery_epoch=$5
      WHERE tenant=$1 AND project=$2 AND request=$3 AND state='Open'
      RETURNING claim_generation::text AS claim_generation`,
    [
      project.partition.tenant,
      project.partition.project,
      project.request,
      owner,
      project.epoch,
    ],
  );
  const row = claimed[0];
  if (claimed.length !== 1 || row === undefined) {
    throw new Error("finalizer harness: the request was not claimable");
  }
  return {
    partition: project.partition,
    request: project.request,
    ticket: asTicketId(project.ticket),
    authorizingSeq: project.authorizingSeq,
    requestGeneration: project.requestGeneration,
    claimGeneration: Number(row["claim_generation"]),
    state: "Registered",
    recoveryEpoch: asRecoveryEpoch(project.epoch),
    owner: asFinalizerOwnerId(owner),
  };
}

/**
 * One prepared attempt whose promotion the target ref proved and whose permit is
 * spent, which is the evidence a succeeded result is refused without.
 */
export async function finalizerPromote(
  rig: FinalizerRig,
  project: FinalizerProject,
  label: string,
): Promise<string> {
  const candidate = finalizerCommit();
  const attempt = await finalizerPrepare(rig, project, label, { candidate });
  const permit = await finalizerGrantPermit(rig, project, attempt, label);
  await rig.as(
    `INSERT INTO finalization_reconciliation
       (tenant, project, permit, candidate_commit, target_ref, verdict, observed_commit)
     VALUES ($1,$2,$3,$4,'refs/heads/main','Promoted',$4)`,
    [project.partition.tenant, project.partition.project, permit, candidate],
  );
  await rig.as(
    `UPDATE commit_permit SET state='Concluded', concluded_at=now()
      WHERE tenant=$1 AND project=$2 AND permit=$3`,
    [project.partition.tenant, project.partition.project, permit],
  );
  return attempt;
}

/** Asks for the approval of one prepared attempt, through the one door that may open it. */
export async function finalizerRequestApproval(
  rig: FinalizerRig,
  project: FinalizerProject,
  attempt: string,
  action: string,
  epoch: string = project.epoch,
): Promise<Record<string, unknown>> {
  const asked = await rig.as(
    `SELECT result, action FROM ${approvalRequestFunction}($1,$2,$3,$4,$5)`,
    [
      project.partition.tenant,
      project.partition.project,
      attempt,
      action,
      epoch,
    ],
  );
  return asked[0] ?? { result: "no row" };
}

/**
 * The Git port a pass calls out through, answering whatever the case last told
 * it to and recording the acts it was asked for. Preparation and integration
 * raise until a case scripts them, because a pass reaching them unscripted is
 * doing work the case did not mean to authorize.
 */
export interface FinalizerGitFake extends GitPromotionPort {
  readonly acts: string[];
  target: TargetObserved;
  promotion: CandidatePromoted;
  ancestry: AncestryProved;
  preparation?: CandidatePrepared;
  integration?: CandidateIntegrated;
  beforePromotion?: (promotion: CandidatePromotion) => Promise<void>;
}

/** A Git port whose every answer one case chooses, over the target it names. */
export function finalizerGit(target: ObservedTarget): FinalizerGitFake {
  const fake: FinalizerGitFake = {
    acts: [],
    target: { observed: "Target", target },
    promotion: { promoted: "Advanced" },
    ancestry: { proved: "Ancestor", observed: target.commit },
    observeTarget: () => {
      fake.acts.push("observe");
      return Promise.resolve(fake.target);
    },
    prepareCandidate: () => {
      fake.acts.push("prepare");
      if (fake.preparation === undefined) {
        throw new Error("finalizer harness: the pass asked for a preparation");
      }
      return Promise.resolve(fake.preparation);
    },
    integrateCandidate: () => {
      fake.acts.push("integrate");
      if (fake.integration === undefined) {
        throw new Error("finalizer harness: the pass asked for an integration");
      }
      return Promise.resolve(fake.integration);
    },
    promoteCandidate: async (promotion) => {
      fake.acts.push("promote");
      await fake.beforePromotion?.(promotion);
      return fake.promotion;
    },
    proveCandidateAncestry: () => {
      fake.acts.push("prove");
      return Promise.resolve(fake.ancestry);
    },
  };
  return fake;
}

/** The identities a preparation mints, drawn per call so no two cases share one. */
export function finalizerIdentities(): FinalizerIdentityFactory {
  return {
    next: () => ({
      attempt: asFinalizationAttemptId(finalizerIdentity("attempt")),
      bundle: asInputBundleId(finalizerIdentity("bundle")),
      conflict: asProjectArtifactId(finalizerIdentity("conflict")),
    }),
  };
}

/** The hash the finalizer's canonical bytes are digested under, which the root also names. */
export function finalizerDigestOf(canonical: CanonicalFinalization): string {
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * The service one case drives: the real durable authority over the finalizer's
 * own role, a real store over the rig's own root, and the remote the case
 * scripts. The composition root wires the same set and nothing may import it, so
 * this states it a second time.
 */
export function finalizerService(
  rig: FinalizerRig,
  git: GitPromotionPort,
): FinalizerService {
  const artifacts = artifactStore({ root: rig.artifactRoot });
  return {
    store: postgresFinalizer(rig.pool),
    git,
    handoffs: artifacts,
    artifacts,
    identities: finalizerIdentities(),
    digestOf: finalizerDigestOf,
    config: checkedFinalizerConfig(finalizerDefaults),
  };
}

/** One handoff a case's passed work declares, its digest a real hash of the bytes stored for it. */
export interface FinalizerHandoff {
  readonly path: string;
  readonly content: string;
}

/** What one case's passed work left behind, which is what a preparation reads. */
export interface FinalizerWork {
  readonly execution: string;
  readonly attempt: string;
  readonly manifest: string;
}

/** Stores one attempt-scoped artifact's bytes read-only, which is what the store calls immutable. */
export function finalizerStoreArtifact(
  rig: FinalizerRig,
  project: FinalizerProject,
  work: FinalizerWork,
  handoff: FinalizerHandoff,
): void {
  const file = artifactAttemptFile(
    artifactProjectDirectory(
      rig.artifactRoot,
      project.partition.tenant,
      project.partition.project,
    ),
    work.execution,
    work.attempt,
    asArtifactPath(handoff.path),
  );
  if (file === undefined) {
    throw new Error(`finalizer harness: ${handoff.path} resolves nowhere`);
  }
  mkdirSync(dirname(file), { recursive: true });
  rmSync(file, { force: true });
  writeFileSync(file, handoff.content, { mode: 0o440 });
  chmodSync(file, 0o440);
}

/** The spawn request the project's dispatch left, and the next manifest ordinal free in it. */
async function finalizerSpawnRequest(
  rig: FinalizerRig,
  project: FinalizerProject,
): Promise<{ request: string; task: number; ordinal: number }> {
  const found = (await rig.harness.query(
    `SELECT t.request, t.task::text AS task,
            (SELECT count(*) FROM execution_result r
              WHERE r.tenant = t.tenant AND r.project = t.project)::text AS taken
       FROM execution_request_task t
       JOIN execution_request q
         ON q.tenant = t.tenant AND q.project = t.project AND q.request = t.request
      WHERE t.tenant = $1 AND t.project = $2 AND t.kind = 'Work'
        AND q.kind = 'SpawnWork' AND q.ticket = $3
      ORDER BY t.task LIMIT 1`,
    [project.partition.tenant, project.partition.project, project.ticket],
  )) as readonly { request: string; task: string; taken: string }[];
  const row = found[0];
  if (row === undefined) {
    throw new Error("finalizer harness: the dispatch left no work task");
  }
  return {
    request: row.request,
    task: Number(row.task),
    ordinal: Number(row.taken) + 1,
  };
}

/** The settled operation one terminal execution names, written by hand because no scheduler runs here. */
async function finalizerCompletion(
  rig: FinalizerRig,
  project: FinalizerProject,
  label: string,
): Promise<string> {
  const operation = finalizerIdentity(`completion-${label}`);
  await rig.harness.query(
    `INSERT INTO operation
       (tenant, project, operation, authority_kind, authority_subject, admission,
        key_version, key_digest, payload_digest, command, command_tag)
     VALUES ($1,$2,$3,'Scheduler','fixture','CorrectnessReducing','fixture-v1',
             $4,$4,'{}','TaskDone')`,
    [
      project.partition.tenant,
      project.partition.project,
      operation,
      finalizerDigest(),
    ],
  );
  return operation;
}

/** Declares one manifest's handoffs and stores the bytes each of them names. */
async function finalizerDeclareHandoffs(
  rig: FinalizerRig,
  project: FinalizerProject,
  work: FinalizerWork,
  handoffs: readonly FinalizerHandoff[],
): Promise<void> {
  for (const [index, handoff] of handoffs.entries()) {
    await rig.harness.query(
      `INSERT INTO execution_result_artifact
         (tenant, project, manifest, ordinal, role, path, digest, bytes)
       VALUES ($1,$2,$3,$4,'Handoff',$5,$6,$7)`,
      [
        project.partition.tenant,
        project.partition.project,
        work.manifest,
        index + 1,
        handoff.path,
        createHash("sha256").update(handoff.content, "utf8").digest("hex"),
        Buffer.byteLength(handoff.content, "utf8"),
      ],
    );
    finalizerStoreArtifact(rig, project, work, handoff);
  }
}

/**
 * One passed work execution of the project's ticket, with its result manifest,
 * its declared handoffs and their bytes in the rig's own store. The rows are
 * written as the migration owner because the scheduler that would write them is
 * another slice's deployable and is not what these cases are about.
 */
export async function finalizerPassedWork(
  rig: FinalizerRig,
  project: FinalizerProject,
  label: string,
  handoffs: readonly FinalizerHandoff[],
): Promise<FinalizerWork> {
  const work: FinalizerWork = {
    execution: finalizerIdentity(`execution-${label}`),
    attempt: finalizerIdentity(`attempt-run-${label}`),
    manifest: finalizerIdentity(`manifest-${label}`),
  };
  const { tenant, project: named } = project.partition;
  const request = await finalizerSpawnRequest(rig, project);
  await rig.harness.query(
    `INSERT INTO execution
       (tenant, project, execution, ticket, task, source_request, account, cluster,
        configuration_revision, configuration_digest, status)
     SELECT $1,$2,$3,$4,$5,$6,a.account,a.cluster,$7,$8,'Running'
       FROM capacity_account a WHERE a.account = ${accountIdentityFunction}($1,$2)`,
    [
      tenant,
      named,
      work.execution,
      project.ticket,
      request.task,
      request.request,
      project.configurationRevision,
      project.configurationDigest,
    ],
  );
  await rig.harness.query(
    `INSERT INTO execution_attempt
       (tenant, project, execution, attempt, attempt_number, recovery_epoch, state, ended_at)
     VALUES ($1,$2,$3,$4,1,$5,'Reported',now())`,
    [tenant, named, work.execution, work.attempt, project.epoch],
  );
  await rig.harness.query(
    `INSERT INTO execution_result
       (tenant, project, manifest, execution, attempt, manifest_ordinal,
        schema_version, digest, verdict)
     VALUES ($1,$2,$3,$4,$5,$6,1,$7,'Pass')`,
    [
      tenant,
      named,
      work.manifest,
      work.execution,
      work.attempt,
      request.ordinal,
      finalizerDigest(),
    ],
  );
  await rig.harness.query(
    `UPDATE execution
        SET status='Terminal', outcome='Passed', result_manifest=$4,
            completion_operation=$5, terminal_at=now()
      WHERE tenant=$1 AND project=$2 AND execution=$3`,
    [
      tenant,
      named,
      work.execution,
      work.manifest,
      await finalizerCompletion(rig, project, label),
    ],
  );
  await finalizerDeclareHandoffs(rig, project, work, handoffs);
  return work;
}

/** Puts one claim's lease in the past, which is what a crashed holder leaves behind. */
export async function finalizerExpireClaim(
  rig: FinalizerRig,
  project: FinalizerProject,
): Promise<void> {
  await rig.as(
    `UPDATE finalization_request SET claim_expires_at = now() - interval '1 hour'
      WHERE tenant=$1 AND project=$2 AND request=$3`,
    [project.partition.tenant, project.partition.project, project.request],
  );
}

/** Grants the one permit that authorizes the one irreversible act, as the finalizer. */
export async function finalizerGrantPermit(
  rig: FinalizerRig,
  project: FinalizerProject,
  attempt: string,
  label: string,
): Promise<string> {
  const permit = finalizerIdentity(`permit-${label}`);
  await rig.as(
    `INSERT INTO commit_permit
       (tenant, project, permit, attempt, recovery_epoch, lifecycle_generation)
     VALUES ($1,$2,$3,$4,$5,1)`,
    [
      project.partition.tenant,
      project.partition.project,
      permit,
      attempt,
      project.epoch,
    ],
  );
  return permit;
}
