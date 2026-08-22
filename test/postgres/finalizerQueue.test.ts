/**
 * The queue the finalizer consumes, the one door a result reaches the mailbox
 * by, and the fence the project writer applies to a submission before it builds
 * a semantic decision input.
 *
 * THE MOVES ARE MADE THROUGH THE ADAPTER AND THE VERDICT IS READ FROM THE ROWS.
 * A claim that reported success and left the row `Open` reads exactly like a
 * claim that worked, so every case here asks the database what the statement
 * left behind rather than trusting what the call returned.
 *
 * A REFUSED SUBMISSION IS PROVED BY THE JOURNAL AND NOT BY THE ERROR. Stale,
 * duplicate and mismatched results must write no entry at all, so the cases
 * about them count `journal_entry` either side of the decision; a call that
 * returned a refusal and journaled anyway would satisfy any weaker assertion.
 *
 * CLAIMING IS INSTALLATION-WIDE AND THE SUITES SHARE ONE DATABASE, so a case
 * draws with a generous bound and looks for its own request among what came
 * back. A request identity repeats across projects, so a case that looks for
 * its own matches the partition as well. The one case that is about the order
 * and the bound empties the queue first and says so.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { postgresFinalizer } from "../../src/adapters/postgres/finalizer.ts";
import {
  asFinalizationAttemptId,
  asFinalizerOwnerId,
  finalizationNext,
  finalizerDefaults,
  type FinalizationClaim,
  type FinalizerStore,
} from "../../src/interpreter/finalizer.ts";
import {
  asRecoveryEpoch,
  type RecoveryEpoch,
} from "../../src/interpreter/projectStore.ts";
import {
  finalizerCommit,
  finalizerDrain,
  finalizerGrantPermit,
  finalizerIdentity,
  finalizerPrepare,
  finalizerProject,
  finalizerPromote,
  finalizerRigOpen,
  finalizerRolePool,
  type FinalizerProject,
  type FinalizerRig,
} from "./finalizerHarness.ts";
import { postgresHarnessNewEpoch } from "./harness.ts";
import { schedulerBlockade } from "./schedulerHarness.ts";

let rig: FinalizerRig;
let store: FinalizerStore;
let rivalPool: ReturnType<typeof finalizerRolePool>;
let rival: FinalizerStore;
let epoch: RecoveryEpoch;

before(async () => {
  rig = await finalizerRigOpen();
  store = postgresFinalizer(rig.pool);
  rivalPool = finalizerRolePool();
  rival = postgresFinalizer(rivalPool);
  epoch = await rig.harness.store.currentRecoveryEpoch();
});
after(async () => {
  await rivalPool.end();
  await rig.close();
});

/** How many requests a case draws when it is not a case about the bound. */
const requestsPerDrawMax = 64;

/** How long a claim a case takes runs for, which is longer than any case runs. */
const claimLeaseSecs = 60;

/** How many rows a recovery sweep takes, which is what bounds the work it picks up. */
const reclaimRowsMax = 64;

/** An epoch this database has never issued authority under, which is what a superseded holder has. */
const supersededEpoch = asRecoveryEpoch("epoch-no-database-issued-this");

/** The claim on this project's own request, drawn for real from the queue. */
async function drawn(
  project: FinalizerProject,
  label: string,
): Promise<FinalizationClaim> {
  const claims = await store.claimRequests(
    asFinalizerOwnerId(finalizerIdentity(`owner-${label}`)),
    asRecoveryEpoch(project.epoch),
    requestsPerDrawMax,
    claimLeaseSecs,
  );
  const mine = claims.find(
    (claim) =>
      claim.partition.project === project.partition.project &&
      claim.request === project.request,
  );
  assert.ok(mine !== undefined, "the project's own request was not drawn");
  return mine;
}

/** What one request row currently says about its claim. */
async function requestRow(
  project: FinalizerProject,
): Promise<Record<string, unknown>> {
  const rows = await rig.harness.query(
    `SELECT state, claim_owner, claim_generation::text AS claim_generation,
            recovery_epoch
       FROM finalization_request WHERE tenant=$1 AND project=$2 AND request=$3`,
    [project.partition.tenant, project.partition.project, project.request],
  );
  const row = rows[0];
  assert.ok(row !== undefined, "the request row went missing");
  return row;
}

/** How many entries this project's journal holds, which a refusal must not change. */
async function entries(project: FinalizerProject): Promise<number> {
  const rows = (await rig.harness.query(
    `SELECT count(*)::text AS held FROM journal_entry WHERE tenant=$1 AND project=$2`,
    [project.partition.tenant, project.partition.project],
  )) as readonly { held: string }[];
  return Number(rows[0]?.held ?? "-1");
}

/** What the writer did with the finalization submission it consumed. */
async function submissionInput(
  project: FinalizerProject,
): Promise<Record<string, unknown>> {
  const rows = await rig.harness.query(
    `SELECT d.state, d.outcome_code FROM decision_input d
       JOIN operation o ON o.tenant=d.tenant AND o.project=d.project
            AND o.operation=d.input_id
      WHERE d.tenant=$1 AND d.project=$2 AND d.input_kind='Operation'
        AND o.authority_kind='Finalizer'`,
    [project.partition.tenant, project.partition.project],
  );
  const row = rows[0];
  assert.ok(
    row !== undefined,
    "no finalization submission reached the mailbox",
  );
  return row;
}

/** A claimed request whose attempt was prepared, promoted and proved, ready to conclude. */
async function proved(label: string): Promise<{
  project: FinalizerProject;
  claim: FinalizationClaim;
  attempt: string;
}> {
  const project = await finalizerProject(rig, label);
  const claim = await drawn(project, label);
  return {
    project,
    claim,
    attempt: await finalizerPromote(rig, project, label),
  };
}

/** Submits the one conclusion the proved rows support, which the door must accept. */
async function concluded(
  claim: FinalizationClaim,
  attempt: string,
): Promise<string> {
  const submitted = await store.submitResult({
    claim,
    attempt: asFinalizationAttemptId(attempt),
    conclusion: { outcome: "FinalizationSucceeded" },
  });
  return submitted.submitted;
}

test("a claim registers one request, stamped with its owner, epoch and generation", async () => {
  const project = await finalizerProject(rig, "claim-one");
  const claim = await drawn(project, "claim-one");
  assert.equal(claim.ticket, project.ticket);
  assert.equal(claim.authorizingSeq, project.authorizingSeq);
  assert.equal(claim.requestGeneration, project.requestGeneration);
  assert.equal(claim.claimGeneration, 1);
  assert.equal(claim.state, "Registered");
  assert.deepEqual(await requestRow(project), {
    state: "Registered",
    claim_owner: claim.owner,
    claim_generation: "1",
    recovery_epoch: project.epoch,
  });
  const again = await rival.claimRequests(
    asFinalizerOwnerId(finalizerIdentity("owner-claim-rival")),
    epoch,
    requestsPerDrawMax,
    claimLeaseSecs,
  );
  assert.equal(
    again.some(
      (each) =>
        each.partition.project === project.partition.project &&
        each.request === project.request,
    ),
    false,
    "a held request was drawn twice",
  );
});

test("the queue is drawn oldest first and one pass takes only what it is bounded to", async () => {
  await store.claimRequests(
    asFinalizerOwnerId(finalizerIdentity("owner-claim-drain")),
    epoch,
    requestsPerDrawMax,
    claimLeaseSecs,
  );
  const project = await finalizerProject(rig, "claim-order");
  const earlier = "1:7:RunFinalizer";
  await rig.harness.query(
    `INSERT INTO finalization_request
       (tenant, project, request, authorizing_seq, effect_position, ticket,
        ticket_version, request_generation)
     VALUES ($1,$2,$3,1,7,$4,1,1)`,
    [
      project.partition.tenant,
      project.partition.project,
      earlier,
      project.ticket + 1,
    ],
  );
  const owner = asFinalizerOwnerId(finalizerIdentity("owner-claim-order"));
  const one = await store.claimRequests(owner, epoch, 1, claimLeaseSecs);
  assert.deepEqual(
    one.map((claim) => claim.request),
    [earlier],
  );
  const next = await store.claimRequests(owner, epoch, 1, claimLeaseSecs);
  assert.deepEqual(
    next.map((claim) => claim.request),
    [project.request],
  );
  assert.deepEqual(
    await store.claimRequests(owner, epoch, 1, claimLeaseSecs),
    [],
  );
});

test("a request another process holds is skipped rather than waited for", async () => {
  const held = await finalizerProject(rig, "skip-held");
  const free = await finalizerProject(rig, "skip-free");
  const blockade = await schedulerBlockade(
    "SELECT request FROM finalization_request WHERE tenant=$1 AND project=$2 FOR UPDATE",
    [held.partition.tenant, held.partition.project],
  );
  try {
    const claims = await store.claimRequests(
      asFinalizerOwnerId(finalizerIdentity("owner-skip")),
      epoch,
      requestsPerDrawMax,
      claimLeaseSecs,
    );
    const projects = claims.map((claim) => claim.partition.project);
    assert.ok(projects.includes(free.partition.project));
    assert.equal(projects.includes(held.partition.project), false);
  } finally {
    await blockade.release();
  }
});

test("an executor under a superseded epoch claims, extends, settles and reopens nothing", async () => {
  const project = await finalizerProject(rig, "epoch-fenced");
  assert.deepEqual(
    await store.claimRequests(
      asFinalizerOwnerId(finalizerIdentity("owner-epoch-fenced")),
      supersededEpoch,
      requestsPerDrawMax,
      claimLeaseSecs,
    ),
    [],
  );
  assert.equal((await requestRow(project))["state"], "Open");
  const claim = await drawn(project, "epoch-fenced");
  const superseded = { ...claim, recoveryEpoch: supersededEpoch };
  assert.equal(await store.extendClaim(superseded, claimLeaseSecs), false);
  assert.equal(await store.settleClaim(superseded), false);
  assert.equal(await store.reclaimLapsed(supersededEpoch, reclaimRowsMax), 0);
  assert.equal(
    await store.reclaimStaleEpoch(supersededEpoch, reclaimRowsMax),
    0,
  );
  assert.deepEqual(await requestRow(project), {
    state: "Registered",
    claim_owner: claim.owner,
    claim_generation: "1",
    recovery_epoch: project.epoch,
  });
});

test("a claim is extended only by the holder, at the generation it was taken at", async () => {
  const project = await finalizerProject(rig, "extend");
  const claim = await drawn(project, "extend");
  assert.equal(await store.extendClaim(claim, claimLeaseSecs), true);
  assert.equal(
    await store.extendClaim(
      { ...claim, claimGeneration: claim.claimGeneration + 1 },
      claimLeaseSecs,
    ),
    false,
  );
  assert.equal(
    await store.extendClaim(
      { ...claim, owner: asFinalizerOwnerId("owner-extend-other") },
      claimLeaseSecs,
    ),
    false,
  );
  assert.equal((await requestRow(project))["claim_generation"], "1");
});

test("a lapsed claim is reopened at a later generation and redrawn by another owner", async () => {
  const project = await finalizerProject(rig, "lapse");
  const first = await drawn(project, "lapse");
  await rig.harness.query(
    `UPDATE finalization_request SET claim_expires_at = now() - interval '1 second'
      WHERE tenant=$1 AND project=$2 AND request=$3`,
    [project.partition.tenant, project.partition.project, project.request],
  );
  assert.ok((await store.reclaimLapsed(epoch, reclaimRowsMax)) >= 1);
  assert.deepEqual(await requestRow(project), {
    state: "Open",
    claim_owner: null,
    claim_generation: "2",
    recovery_epoch: null,
  });
  const second = await drawn(project, "lapse-second");
  assert.equal(second.claimGeneration, first.claimGeneration + 2);
  assert.notEqual(second.owner, first.owner);
});

test("a settled request gives its claim back and an unsettled one does not", async () => {
  const project = await finalizerProject(rig, "settle");
  const claim = await drawn(project, "settle");
  assert.equal(await store.settleClaim(claim), false);
  await rig.harness.query(
    `UPDATE finalization_request SET state='Fulfilled'
      WHERE tenant=$1 AND project=$2 AND request=$3`,
    [project.partition.tenant, project.partition.project, project.request],
  );
  assert.equal(await store.settleClaim(claim), true);
  assert.deepEqual(await requestRow(project), {
    state: "Fulfilled",
    claim_owner: null,
    claim_generation: "2",
    recovery_epoch: null,
  });
});

test("the view is gathered from the rows, and a finalization needing git holds", async () => {
  const project = await finalizerProject(rig, "view");
  const claim = await drawn(project, "view");
  const bare = await store.durableView(claim);
  assert.ok(bare?.stage === "Unattempted");
  assert.equal(bare.repository.repository, project.repository);
  assert.equal(bare.attemptsMade, 0);
  assert.deepEqual(finalizationNext(finalizerDefaults, bare), {
    decide: "Hold",
    hold: "TargetUnreadable",
  });
  const candidate = finalizerCommit();
  const attempt = await finalizerPrepare(rig, project, "view", { candidate });
  const permit = await finalizerGrantPermit(rig, project, attempt, "view");
  const carried = await store.durableView(claim);
  assert.ok(carried?.stage === "PermitGranted");
  assert.equal(carried.attempt.attempt, attempt);
  assert.equal(carried.attempt.candidate, candidate);
  assert.equal(carried.attempt.strategy, "Merge");
  assert.equal(carried.attemptsMade, 1);
  assert.equal(carried.permit.permit, permit);
  assert.equal(carried.permit.state, "Granted");
  assert.equal(carried.reconciliation, undefined);
  assert.deepEqual(finalizationNext(finalizerDefaults, carried), {
    decide: "Reconcile",
    permit,
  });
});

test("a submitted result is the request's fulfilment, and the claim is then given back", async () => {
  const { project, claim, attempt } = await proved("fulfil");
  const before = await entries(project);
  assert.equal(await concluded(claim, attempt), "Submitted");
  const drained = await finalizerDrain(
    rig.harness,
    project.partition,
    project.memory,
  );
  assert.deepEqual(drained.decided, ["Committed"]);
  assert.equal(await entries(project), before + 1);
  assert.equal((await submissionInput(project))["state"], "Journaled");
  assert.equal((await requestRow(project))["state"], "Fulfilled");
  assert.equal(await store.settleClaim(claim), true);
  assert.equal((await requestRow(project))["claim_owner"], null);
});

test("a result whose request has moved is refused and writes no journal entry", async () => {
  const moves: readonly (readonly [string, string])[] = [
    [
      "settled",
      `UPDATE finalization_request SET state='Invalidated'
        WHERE tenant=$1 AND project=$2 AND request=$3`,
    ],
    [
      "regenerated",
      `UPDATE finalization_request SET request_generation = request_generation + 1
        WHERE tenant=$1 AND project=$2 AND request=$3`,
    ],
  ];
  for (const [label, move] of moves) {
    const { project, claim, attempt } = await proved(`fenced-${label}`);
    assert.equal(await concluded(claim, attempt), "Submitted", label);
    await rig.harness.query(move, [
      project.partition.tenant,
      project.partition.project,
      project.request,
    ]);
    const before = await entries(project);
    const drained = await finalizerDrain(
      rig.harness,
      project.partition,
      project.memory,
    );
    assert.deepEqual(drained.decided, ["Refused"], label);
    assert.equal(await entries(project), before, label);
    assert.deepEqual(
      await submissionInput(project),
      { state: "Refused", outcome_code: "NotEnabled" },
      label,
    );
  }
});

test("no principal may offer a finalization result as an ordinary command", async () => {
  const forged = JSON.stringify({
    version: 1,
    command: "Decide",
    event: {
      type: "FinalizationResult",
      value: { ticket: 1, out: "FinalizationSucceeded" },
    },
  });
  assert.deepEqual(
    await rig.harness.query(
      `SELECT ticket_command_is_valid($1::jsonb) AS closed,
              public_ticket_command_is_valid($1::jsonb) AS shape`,
      [forged],
    ),
    [{ closed: false, shape: true }],
  );
  const project = await finalizerProject(rig, "forged");
  const before = await entries(project);
  assert.deepEqual(
    await rig.harness.query(
      `SELECT result FROM accept_operation($1,$2,$3,'UserMutation','subject',
         'v1',$4,$5,ARRAY[$4]::text[],ARRAY[$5]::text[],$6,1000,2000)`,
      [
        project.partition.tenant,
        project.partition.project,
        finalizerIdentity("operation-forged"),
        finalizerIdentity("key-forged"),
        finalizerIdentity("payload-forged"),
        forged,
      ],
    ),
    [{ result: "InvalidCommand" }],
  );
  assert.equal(await entries(project), before);
});

test("a claim held under an epoch a restore superseded is reopened by the process that took over", async () => {
  const stale = await rig.harness.store.establishRecoveryEpoch(
    postgresHarnessNewEpoch(),
  );
  const current = await rig.harness.store.establishRecoveryEpoch(
    postgresHarnessNewEpoch(),
  );
  const project = await finalizerProject(rig, "restored");
  const claim = await drawn(project, "restored");
  await rig.harness.query(
    `UPDATE finalization_request SET recovery_epoch=$4
      WHERE tenant=$1 AND project=$2 AND request=$3`,
    [
      project.partition.tenant,
      project.partition.project,
      project.request,
      stale,
    ],
  );
  assert.ok((await store.reclaimStaleEpoch(current, reclaimRowsMax)) >= 1);
  assert.deepEqual(await requestRow(project), {
    state: "Open",
    claim_owner: null,
    claim_generation: "2",
    recovery_epoch: null,
  });
  assert.equal(await store.extendClaim(claim, claimLeaseSecs), false);
});
