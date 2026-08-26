/**
 * Every legal move migration thirteen's grants admit, made as the role that is
 * supposed to make it, and every recovery query the decision record names,
 * asked of a database holding the state it is supposed to find and the state it
 * must not.
 *
 * THE MOVES ARE MADE AND NOT INSPECTED. A grant nobody exercised reads exactly
 * like a grant that works, and the defect that hides there is a column-level
 * grant omitting a column a legal move must write — which refuses the move
 * entirely and is invisible to any test that reads `information_schema` instead
 * of running the statement.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import {
  finalizerClaim,
  finalizerCommit,
  finalizerGrantPermit,
  finalizerIdentity,
  finalizerPrepare,
  finalizerProject,
  finalizerRigOpen,
  type FinalizerProject,
  type FinalizerRig,
} from "./finalizerHarness.ts";
import { postgresFinalizer } from "../../src/adapters/postgres/finalizer.ts";
import { repositoryActivationFunction } from "../../src/adapters/postgres/schema.ts";

let rig: FinalizerRig;
before(async () => {
  rig = await finalizerRigOpen();
});
after(async () => {
  await rig.close();
});

/** How many rows a recovery query takes, which is what bounds the work a fresh process picks up. */
const recoveryRowsMax = 64;

/** Records what one permit's promotion proved, which is the finalizer's own move. */
async function reconcile(
  project: FinalizerProject,
  permit: string,
  candidate: string,
  verdict: string,
): Promise<void> {
  await rig.as(
    `INSERT INTO finalization_reconciliation
       (tenant, project, permit, candidate_commit, target_ref, verdict, observed_commit)
     VALUES ($1,$2,$3,$4,'refs/heads/main',$5,$6)`,
    [
      project.partition.tenant,
      project.partition.project,
      permit,
      candidate,
      verdict,
      verdict === "Unreadable" ? null : candidate,
    ],
  );
}

/** What one recovery query answered for one project, as a plain list of identities. */
async function found(
  project: FinalizerProject,
  sql: string,
  extra: readonly unknown[] = [],
): Promise<readonly string[]> {
  const rows = (await rig.as(sql, [
    project.partition.tenant,
    project.partition.project,
    recoveryRowsMax,
    ...extra,
  ])) as readonly { found: string }[];
  return rows.map((row) => row.found);
}

test("the finalizer claims a request, holds it, and releases a lapsed claim", async () => {
  const project = await finalizerProject(rig, "claim");
  const owner = finalizerIdentity("owner-claim");
  await finalizerClaim(rig, project, owner);
  assert.deepEqual(
    await rig.as(
      `SELECT state, claim_owner, claim_generation::text AS generation, recovery_epoch
         FROM finalization_request WHERE tenant=$1 AND project=$2 AND request=$3`,
      [project.partition.tenant, project.partition.project, project.request],
    ),
    [
      {
        state: "Registered",
        claim_owner: owner,
        generation: "1",
        recovery_epoch: project.epoch,
      },
    ],
  );
  const released = await rig.as(
    `UPDATE finalization_request
        SET state='Open', claim_owner=NULL, claim_expires_at=NULL,
            recovery_epoch=NULL, claim_generation=claim_generation+1
      WHERE tenant=$1 AND project=$2 AND request=$3 RETURNING state`,
    [project.partition.tenant, project.partition.project, project.request],
  );
  assert.deepEqual(released, [{ state: "Open" }]);
});

test("the finalizer prepares, permits, reconciles and concludes without the owner's help", async () => {
  const project = await finalizerProject(rig, "moves");
  await finalizerClaim(rig, project, finalizerIdentity("owner-moves"));
  const candidate = finalizerCommit();
  const attempt = await finalizerPrepare(rig, project, "moves", { candidate });
  const permit = await finalizerGrantPermit(rig, project, attempt, "moves");
  await reconcile(project, permit, candidate, "Unreadable");
  const read = await rig.as(
    `UPDATE finalization_reconciliation
        SET verdict='Promoted', observed_commit=$4, reconciled_at=now()
      WHERE tenant=$1 AND project=$2 AND permit=$3 RETURNING verdict`,
    [project.partition.tenant, project.partition.project, permit, candidate],
  );
  assert.deepEqual(read, [{ verdict: "Promoted" }]);
  const spent = await rig.as(
    `UPDATE commit_permit SET state='Concluded', concluded_at=now()
      WHERE tenant=$1 AND project=$2 AND permit=$3 RETURNING state`,
    [project.partition.tenant, project.partition.project, permit],
  );
  assert.deepEqual(spent, [{ state: "Concluded" }]);
  const fulfilled = await rig.as(
    `UPDATE finalization_request SET state='Fulfilled'
      WHERE tenant=$1 AND project=$2 AND request=$3 RETURNING state`,
    [project.partition.tenant, project.partition.project, project.request],
  );
  assert.deepEqual(fulfilled, [{ state: "Fulfilled" }]);
});

test("an attempt remains bound after the project activates another repository", async () => {
  const project = await finalizerProject(rig, "attempt-binding");
  const claim = await finalizerClaim(
    rig,
    project,
    finalizerIdentity("owner-attempt-binding"),
  );
  const attempt = await finalizerPrepare(rig, project, "attempt-binding");
  await finalizerGrantPermit(rig, project, attempt, "attempt-binding");
  const next = `repository-next-${finalizerIdentity("attempt-binding")}`;
  const activated = await rig.harness.query(
    `SELECT ${repositoryActivationFunction}($1,$2,$3,$4,$5,$6,$7,$8) AS result`,
    [
      project.partition.tenant,
      project.partition.project,
      project.repository,
      next,
      project.epoch,
      finalizerIdentity("operation-attempt-binding"),
      "Administrator",
      "test-operator",
    ],
  );
  assert.deepEqual(activated, [{ result: "Activated" }]);
  const view = await postgresFinalizer(rig.pool).durableView(claim);
  assert.equal(view?.attempt?.attempt, attempt);
  assert.equal(view?.repository?.repository, project.repository);
});

test("a permit is spent once and never re-identified", async () => {
  const project = await finalizerProject(rig, "spend");
  const attempt = await finalizerPrepare(rig, project, "spend");
  const permit = await finalizerGrantPermit(rig, project, attempt, "spend");
  const keys = [project.partition.tenant, project.partition.project, permit];
  await rig.as(
    `UPDATE commit_permit SET state='Concluded', concluded_at=now()
      WHERE tenant=$1 AND project=$2 AND permit=$3`,
    keys,
  );
  assert.match(
    await rig.refusal(
      `UPDATE commit_permit SET state='Concluded', concluded_at=now()
        WHERE tenant=$1 AND project=$2 AND permit=$3`,
      keys,
    ),
    /is already concluded/u,
  );
});

test("a reconciliation reads its verdict once and never against another candidate", async () => {
  const project = await finalizerProject(rig, "reread");
  const candidate = finalizerCommit();
  const attempt = await finalizerPrepare(rig, project, "reread", { candidate });
  const permit = await finalizerGrantPermit(rig, project, attempt, "reread");
  await reconcile(project, permit, candidate, "Promoted");
  const keys = [project.partition.tenant, project.partition.project, permit];
  assert.match(
    await rig.refusal(
      `UPDATE finalization_reconciliation SET verdict='NotPromoted'
        WHERE tenant=$1 AND project=$2 AND permit=$3`,
      keys,
    ),
    /a verdict is read once/u,
  );
});

test("at most one permit is live per project, whatever attempt it names", async () => {
  const project = await finalizerProject(rig, "one-live");
  const first = await finalizerPrepare(rig, project, "one-live-first");
  const second = await finalizerPrepare(rig, project, "one-live-second");
  await finalizerGrantPermit(rig, project, first, "one-live-first");
  assert.match(
    await rig.refusal(
      `INSERT INTO commit_permit
         (tenant, project, permit, attempt, recovery_epoch, lifecycle_generation)
       VALUES ($1,$2,$3,$4,$5,1)`,
      [
        project.partition.tenant,
        project.partition.project,
        finalizerIdentity("permit-one-live-second"),
        second,
        project.epoch,
      ],
    ),
    /commit_permit_one_live/u,
  );
});

test("an attempt is evidence: no update reaches it and no delete removes it", async () => {
  const project = await finalizerProject(rig, "evidence");
  const attempt = await finalizerPrepare(rig, project, "evidence");
  const keys = [project.partition.tenant, project.partition.project, attempt];
  for (const statement of [
    `UPDATE finalization_attempt SET outcome='Failed'
      WHERE tenant=$1 AND project=$2 AND attempt=$3`,
    `DELETE FROM finalization_attempt
      WHERE tenant=$1 AND project=$2 AND attempt=$3`,
  ]) {
    assert.match(
      await rig.refusal(statement, keys),
      /permission denied for table finalization_attempt/u,
      statement,
    );
  }
  assert.match(
    await rig.harness
      .query(
        `UPDATE finalization_attempt SET outcome='Failed'
          WHERE tenant=$1 AND project=$2 AND attempt=$3`,
        keys,
      )
      .then(
        () => "the owner rewrote an attempt",
        (refused: unknown) => String(refused),
      ),
    /is written once/u,
  );
});

test("recovery finds the prepared attempts no permit has concluded, and nothing settled", async () => {
  const project = await finalizerProject(rig, "recover-attempt");
  const unfinished = await finalizerPrepare(rig, project, "recover-open");
  const candidate = finalizerCommit();
  const settled = await finalizerPrepare(rig, project, "recover-settled", {
    candidate,
  });
  const permit = await finalizerGrantPermit(
    rig,
    project,
    settled,
    "recover-settled",
  );
  await reconcile(project, permit, candidate, "Promoted");
  await rig.as(
    `UPDATE commit_permit SET state='Concluded', concluded_at=now()
      WHERE tenant=$1 AND project=$2 AND permit=$3`,
    [project.partition.tenant, project.partition.project, permit],
  );
  assert.deepEqual(
    await found(
      project,
      `SELECT a.attempt AS found FROM finalization_attempt a
         LEFT JOIN commit_permit p
           ON p.tenant=a.tenant AND p.project=a.project AND p.attempt=a.attempt
        WHERE a.tenant=$1 AND a.project=$2 AND a.outcome='Prepared'
          AND (p.permit IS NULL OR p.state <> 'Concluded')
        ORDER BY a.prepared_at LIMIT $3`,
    ),
    [unfinished],
  );
});

test("recovery finds the granted permits with no conclusion, and nothing spent", async () => {
  const project = await finalizerProject(rig, "recover-permit");
  const attempt = await finalizerPrepare(rig, project, "recover-permit");
  const permit = await finalizerGrantPermit(
    rig,
    project,
    attempt,
    "recover-permit",
  );
  const query = `SELECT permit AS found FROM commit_permit
     WHERE tenant=$1 AND project=$2 AND state='Granted'
     ORDER BY granted_at LIMIT $3`;
  assert.deepEqual(await found(project, query), [permit]);
  await rig.as(
    `UPDATE commit_permit SET state='Concluded', concluded_at=now()
      WHERE tenant=$1 AND project=$2 AND permit=$3`,
    [project.partition.tenant, project.partition.project, permit],
  );
  assert.deepEqual(await found(project, query), []);
});

test("recovery finds the holds under attention, and no verdict that concluded", async () => {
  const project = await finalizerProject(rig, "recover-hold");
  const candidate = finalizerCommit();
  const attempt = await finalizerPrepare(rig, project, "recover-hold", {
    candidate,
  });
  const permit = await finalizerGrantPermit(
    rig,
    project,
    attempt,
    "recover-hold",
  );
  await reconcile(project, permit, candidate, "Unreadable");
  const query = `SELECT permit AS found FROM finalization_reconciliation
     WHERE tenant=$1 AND project=$2 AND verdict='Unreadable'
     ORDER BY reconciled_at LIMIT $3`;
  assert.deepEqual(await found(project, query), [permit]);
  await rig.as(
    `UPDATE finalization_reconciliation
        SET verdict='NotPromoted', observed_commit=$4, reconciled_at=now()
      WHERE tenant=$1 AND project=$2 AND permit=$3`,
    [
      project.partition.tenant,
      project.partition.project,
      permit,
      finalizerCommit(),
    ],
  );
  assert.deepEqual(await found(project, query), []);
});

test("recovery finds the claims past their expiry, and no claim still running", async () => {
  const project = await finalizerProject(rig, "recover-lapse");
  await finalizerClaim(rig, project, finalizerIdentity("owner-lapse"));
  const query = `SELECT request AS found FROM finalization_request
     WHERE tenant=$1 AND project=$2 AND claim_owner IS NOT NULL
       AND claim_expires_at < now() ORDER BY claim_expires_at LIMIT $3`;
  assert.deepEqual(await found(project, query), []);
  await rig.as(
    `UPDATE finalization_request SET claim_expires_at=now()-interval '1 second'
      WHERE tenant=$1 AND project=$2 AND request=$3`,
    [project.partition.tenant, project.partition.project, project.request],
  );
  assert.deepEqual(await found(project, query), [project.request]);
});

test("recovery finds the live claims under a stale epoch, and none under the current one", async () => {
  const project = await finalizerProject(rig, "recover-epoch");
  await finalizerClaim(rig, project, finalizerIdentity("owner-epoch"));
  const query = `SELECT request AS found FROM finalization_request
     WHERE tenant=$1 AND project=$2 AND claim_owner IS NOT NULL
       AND recovery_epoch IS DISTINCT FROM $4 LIMIT $3`;
  assert.deepEqual(await found(project, query, [project.epoch]), []);
  assert.deepEqual(await found(project, query, [`${project.epoch}-later`]), [
    project.request,
  ]);
});

test("each relation carries exactly the indexes its recovery and its identities need", async () => {
  const held = (await rig.as(
    `SELECT tablename AS relation, indexname AS held FROM pg_indexes
      WHERE schemaname='public' AND tablename IN
        ('finalization_attempt','commit_permit','finalization_reconciliation',
         'project_repository','input_bundle','input_bundle_reference','native_action')
      ORDER BY tablename, indexname`,
  )) as readonly { relation: string; held: string }[];
  assert.deepEqual(
    held.map((row) => row.held),
    [
      "commit_permit_identity_is_never_reused",
      "commit_permit_is_one_per_attempt",
      "commit_permit_one_live",
      "commit_permit_pkey",
      "commit_permit_unconcluded",
      "finalization_attempt_by_request",
      "finalization_attempt_identity_is_never_reused",
      "finalization_attempt_pkey",
      "finalization_reconciliation_held",
      "finalization_reconciliation_pkey",
      "input_bundle_is_referenceable",
      "input_bundle_pkey",
      "input_bundle_reference_is_declared_once",
      "input_bundle_reference_pkey",
      "native_action_approves_an_attempt_once",
      "native_action_effect_is_materialized_once",
      "native_action_one_open",
      "native_action_pkey",
      "project_repository_is_exclusive",
      "project_repository_is_referenceable",
      "project_repository_pkey",
    ],
  );
  assert.deepEqual(
    await rig.as(
      `SELECT indexname AS held FROM pg_indexes
        WHERE schemaname='public' AND tablename='finalization_request'
          AND indexname IN ('finalization_request_claimable',
            'finalization_request_claim_expiry','finalization_request_epoch',
            'finalization_request_one_live','finalization_request_one_open')
        ORDER BY indexname`,
    ),
    [
      { held: "finalization_request_claim_expiry" },
      { held: "finalization_request_claimable" },
      { held: "finalization_request_epoch" },
      { held: "finalization_request_one_live" },
    ],
  );
});

test("the bindings and bundles hold no column any unfinished work could be found by", async () => {
  assert.deepEqual(
    await rig.as(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema='public'
          AND table_name IN ('project_repository','input_bundle','input_bundle_reference')
          AND column_name IN
            ('state','claim_owner','claim_expires_at','lease_expires_at','verdict',
             'outcome','terminal_at','concluded_at')`,
    ),
    [],
  );
});
