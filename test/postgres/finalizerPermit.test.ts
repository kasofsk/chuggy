/**
 * The one irreversible act and everything that serializes it: the permit granted
 * and committed before the ref update is attempted, the fences that refuse one,
 * the reconciliation of every answer the update can give, and the hold that is a
 * durable state rather than an absent row.
 *
 * THE RACES ARE PROVED AND NOT HOPED FOR. A third connection holds the lock the
 * transaction under test must queue on, and the case waits until `pg_locks` says
 * that backend is actually waiting for that lock on that object before it lets
 * anything through. Without the position guard a case that never entered the
 * window it is named for passes exactly like one that did.
 *
 * THE PASS IS DRIVEN AND NOT IMITATED. Every durable move is the real adapter
 * against the real server through the real pure decision; only the remote is a
 * fake, because a refused update and an ambiguous one are the answers a real
 * remote will not produce on demand.
 *
 * AN OLD-EPOCH EXECUTOR IS FENCED WHILE IT IS STILL ALIVE. The case that proves
 * it holds the permit row in an open transaction and says so — a third
 * connection is refused that row with `NOWAIT` — before the takeover advances
 * the epoch, so it is a claim about an executor mid-flight rather than about one
 * that had already stopped. What that executor may then do is asserted by the
 * journal it did not write, not by the tags its calls returned.
 *
 * EVERY CASE QUIESCES THE DATABASE IT SHARES. The suites in this directory run
 * against one database and a pass draws work installation-wide, so a case that
 * left a live request would be advanced by the next case's pass and counted in
 * its report.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import type pg from "pg";

import { postgresFinalizer } from "../../src/adapters/postgres/finalizer.ts";
import {
  asFinalizationAttemptId,
  asFinalizerOwnerId,
  asGitObjectId,
  asGitRefName,
  finalizationNext,
  finalizerDefaults,
  type FinalizerStore,
  type ObservedTarget,
  type PermitGranted,
  type Reconciled,
  type ReconciliationRecord,
} from "../../src/interpreter/finalizer.ts";
import {
  finalizerPass,
  type FinalizerPassReport,
} from "../../src/interpreter/finalizerRun.ts";
import { asRecoveryEpoch } from "../../src/interpreter/projectStore.ts";
import {
  finalizerClaim,
  finalizerCommit,
  finalizerDrain,
  finalizerExpireClaim,
  finalizerGit,
  finalizerGrantPermit,
  finalizerPrepare,
  finalizerProject,
  finalizerPromote,
  finalizerRigOpen,
  finalizerRolePool,
  finalizerService,
  type FinalizerGitFake,
  type FinalizerProject,
  type FinalizerRig,
} from "./finalizerHarness.ts";
import { schedulerBlockade, schedulerOutcome } from "./schedulerHarness.ts";

let rig: FinalizerRig;
before(async () => {
  rig = await finalizerRigOpen();
});
after(async () => {
  await rig.close();
});

/** The ref every case in this suite promotes into. */
const targetRef = "refs/heads/main";

/** The namespace `src/adapters/postgres/finalizerPermit.ts` takes its permit lock in. */
const permitLockNamespace = 0x63687537;

/** How long a case waits for a backend to reach the lock it must queue on. */
const queueWaitSecsMax = 10;

/** How often the wait asks the server where that backend is. */
const queuePollMillis = 25;

/** How many rows a successor's recovery sweep and redraw take at a time. */
const recoveryRowsMax = 64;

/** How long the successor's own claim runs for, which is longer than any case runs. */
const successorLeaseSecs = 60;

/** One permit row as a case reads it back. */
type PermitState = {
  readonly permit: string;
  readonly attempt: string;
  readonly state: string;
  readonly lifecycle_generation: string;
};

/** One reconciliation row as a case reads it back. */
type ReadingState = {
  readonly verdict: string;
  readonly observed_commit: string | null;
  readonly candidate_commit: string;
};

/** Invalidates every live request but this project's, so a pass draws one claim. */
async function quiesce(project: FinalizerProject): Promise<void> {
  await rig.as(
    `UPDATE finalization_request SET state='Invalidated'
      WHERE state IN ('Open','Registered')
        AND NOT (tenant=$1 AND project=$2 AND request=$3)`,
    [project.partition.tenant, project.partition.project, project.request],
  );
  await rig.as(
    `UPDATE commit_permit SET state='Concluded', concluded_at=now()
      WHERE state='Granted'
        AND NOT (tenant=$1 AND project=$2)`,
    [project.partition.tenant, project.partition.project],
  );
}

/** The permits this project holds, newest grant last. */
async function permitsOf(
  project: FinalizerProject,
): Promise<readonly PermitState[]> {
  return (await rig.as(
    `SELECT permit, attempt, state,
            lifecycle_generation::text AS lifecycle_generation
       FROM commit_permit WHERE tenant=$1 AND project=$2
      ORDER BY granted_at, permit`,
    [project.partition.tenant, project.partition.project],
  )) as readonly PermitState[];
}

/** What the target ref proved about this project's one permit, or nothing yet. */
async function readingOf(
  project: FinalizerProject,
): Promise<ReadingState | undefined> {
  const found = (await rig.as(
    `SELECT r.verdict, r.observed_commit, r.candidate_commit
       FROM finalization_reconciliation r
      WHERE r.tenant=$1 AND r.project=$2`,
    [project.partition.tenant, project.partition.project],
  )) as readonly ReadingState[];
  return found[0];
}

/** One pass, under an owner no other case is using. */
async function passOnce(
  project: FinalizerProject,
  git: FinalizerGitFake,
  label: string,
): Promise<FinalizerPassReport> {
  return finalizerPass(
    finalizerService(rig, git),
    asFinalizerOwnerId(`owner-${label}`),
    asRecoveryEpoch(project.epoch),
  );
}

/** The observed target a case's remote reports, which every attempt it writes pins. */
function targetAt(commit: string): ObservedTarget {
  return { ref: asGitRefName(targetRef), commit: asGitObjectId(commit) };
}

/** A project whose ticket is finalizing, with everything but the request quiesced. */
async function subject(label: string): Promise<FinalizerProject> {
  const project = await finalizerProject(rig, label);
  await quiesce(project);
  return project;
}

/** One prepared attempt over the target the remote reports, left for a pass to claim. */
async function prepared(
  project: FinalizerProject,
  label: string,
  target: string,
  candidate: string,
): Promise<string> {
  return finalizerPrepare(rig, project, label, { target, candidate });
}

/**
 * A process with none of the retired one's memory takes the request over under
 * the current epoch and concludes it, which is the positive control that leaves
 * the superseded epoch as the only reason the retired one was refused.
 */
async function permitSuccessorConcludes(
  project: FinalizerProject,
  attempt: string,
): Promise<void> {
  const successorPool = finalizerRolePool();
  try {
    const successor = postgresFinalizer(successorPool);
    const current = await rig.harness.store.currentRecoveryEpoch();
    assert.ok(
      (await successor.reclaimStaleEpoch(current, recoveryRowsMax)) >= 1,
    );
    const redrawn = (
      await successor.claimRequests(
        asFinalizerOwnerId(`owner-successor-${project.partition.project}`),
        current,
        recoveryRowsMax,
        successorLeaseSecs,
      )
    ).find((each) => each.request === project.request);
    assert.ok(redrawn !== undefined, "the successor drew no claim of its own");
    assert.deepEqual(
      await successor.submitResult({
        claim: redrawn,
        attempt: asFinalizationAttemptId(attempt),
        conclusion: { outcome: "FinalizationSucceeded" },
      }),
      {
        submitted: "Submitted",
        operation: await submittedOperationOf(project),
      },
      "the same rows were refused only for the epoch the old executor held",
    );
    assert.equal(await submissionsOf(project), 1);
  } finally {
    await successorPool.end();
  }
}

/** The two halves of the advisory key the permit transaction takes for one project. */
type PermitLockKey = { readonly namespace: number; readonly project: number };

/**
 * Waits until one backend is queued for that key. `pg_locks` reports both halves
 * as object identifiers, which are unsigned where the key that was taken is not.
 */
async function waitForAdvisoryQueue(key: PermitLockKey): Promise<void> {
  const deadline = Date.now() + queueWaitSecsMax * 1000;
  for (;;) {
    const waiting = await rig.harness.query(
      `SELECT l.pid FROM pg_locks l
         JOIN pg_stat_activity a ON a.pid = l.pid
        WHERE a.datname = current_database()
          AND l.locktype='advisory' AND NOT l.granted
          AND l.classid = $1::oid AND l.objid = $2::oid`,
      [key.namespace, key.project],
    );
    if (waiting.length > 0) return;
    if (Date.now() > deadline) {
      throw new Error(
        "finalizer permit: no backend ever queued for the project's own lock",
      );
    }
    await new Promise((wake) => setTimeout(wake, queuePollMillis));
  }
}

/** The advisory key the permit transaction takes for one project. */
async function permitLockKey(
  project: FinalizerProject,
): Promise<PermitLockKey> {
  const found = (await rig.harness.query(
    `SELECT ('x' || substr(md5($1 || ':' || $2), 1, 8))::bit(32)::integer AS keyed`,
    [project.partition.tenant, project.partition.project],
  )) as readonly { keyed: number }[];
  const row = found[0];
  if (row === undefined) throw new Error("finalizer permit: no lock key");
  return { namespace: permitLockNamespace, project: row.keyed };
}

/** How many entries one project's journal holds, which a fenced move may not change. */
async function entriesOf(project: FinalizerProject): Promise<number> {
  const counted = (await rig.harness.query(
    `SELECT count(*)::text AS held FROM journal_entry WHERE tenant=$1 AND project=$2`,
    [project.partition.tenant, project.partition.project],
  )) as readonly { held: string }[];
  return Number(counted[0]?.held ?? "-1");
}

/** How many conclusions reached this project's mailbox through the one door. */
async function submissionsOf(project: FinalizerProject): Promise<number> {
  const counted = (await rig.harness.query(
    `SELECT count(*)::text AS made FROM operation
      WHERE tenant=$1 AND project=$2 AND authority_kind='Finalizer'`,
    [project.partition.tenant, project.partition.project],
  )) as readonly { made: string }[];
  return Number(counted[0]?.made ?? "-1");
}

/** The operation the one door minted for this project's conclusion. */
async function submittedOperationOf(
  project: FinalizerProject,
): Promise<string | undefined> {
  const found = (await rig.harness.query(
    `SELECT operation FROM operation
      WHERE tenant=$1 AND project=$2 AND authority_kind='Finalizer'`,
    [project.partition.tenant, project.partition.project],
  )) as readonly { operation: string }[];
  return found[0]?.operation;
}

/**
 * Whether some other transaction is holding that permit row right now, which is
 * how a case says where the executor it is fencing had actually reached.
 */
async function permitRowIsHeld(
  project: FinalizerProject,
  permit: string,
): Promise<boolean> {
  const asking = await rig.ownerRefusal(
    `SELECT state FROM commit_permit
      WHERE tenant=$1 AND project=$2 AND permit=$3 FOR UPDATE NOWAIT`,
    [project.partition.tenant, project.partition.project, permit],
  );
  return /could not obtain lock/u.test(asking);
}

/** Takes the project's own advisory key on a connection the case holds open. */
async function holdPermitLock(
  blocker: pg.PoolClient,
  key: PermitLockKey,
): Promise<void> {
  await blocker.query("BEGIN");
  await blocker.query(
    "SELECT pg_advisory_xact_lock($1::integer, $2::integer)",
    [key.namespace, key.project],
  );
}

test("the permit transaction queues on the project's own lock before it grants", async () => {
  const project = await subject("queued");
  const target = finalizerCommit();
  await prepared(project, "queued", target, finalizerCommit());
  const key = await permitLockKey(project);
  const blocker = await rig.pool.connect();
  let granted: FinalizerPassReport | string;
  try {
    await holdPermitLock(blocker, key);
    const git = finalizerGit(targetAt(target));
    const running = schedulerOutcome(passOnce(project, git, "queued"));
    await waitForAdvisoryQueue(key);
    assert.deepEqual(git.acts, ["observe"]);
    await blocker.query("COMMIT");
    granted = await running;
  } finally {
    blocker.release();
  }
  if (typeof granted === "string") assert.fail(granted);
  assert.equal(granted.promotions, 1);
  const permits = await permitsOf(project);
  assert.equal(permits.length, 1);
  assert.equal(permits[0]?.state, "Concluded");
});

test("two grants racing for one project leave one permit and one refusal", async () => {
  const project = await subject("racing");
  const target = finalizerCommit();
  const claim = await finalizerClaim(rig, project, "owner-racing");
  const first = await finalizerPrepare(rig, project, "racing-a", {
    target,
    candidate: finalizerCommit(),
  });
  const second = await finalizerPrepare(rig, project, "racing-b", {
    target,
    candidate: finalizerCommit(),
  });
  const key = await permitLockKey(project);
  const store = finalizerService(rig, finalizerGit(targetAt(target))).store;
  const blockade = await schedulerBlockade(
    "SELECT pg_advisory_xact_lock($1::integer, $2::integer)",
    [key.namespace, key.project],
  );
  let answers: readonly PermitGranted[] | string;
  try {
    const racing = schedulerOutcome(
      Promise.all([
        store.grantPermit({ claim, attempt: asFinalizationAttemptId(first) }),
        store.grantPermit({ claim, attempt: asFinalizationAttemptId(second) }),
      ]),
    );
    await blockade.stalled(2);
    await waitForAdvisoryQueue(key);
    assert.equal(
      await blockade.stalledHolds("finalization_request", "RowShareLock"),
      true,
      "a stalled grant had not reached the request row",
    );
    await blockade.release();
    answers = await racing;
  } finally {
    await blockade.release();
  }
  if (typeof answers === "string") assert.fail(answers);
  const outcomes = answers.map((answer) =>
    answer.granted === "Permit" ? "Permit" : answer.refusal,
  );
  assert.equal(outcomes.filter((each) => each === "Permit").length, 1);
  assert.equal(outcomes.filter((each) => each === "PermitLive").length, 1);
  const permits = await permitsOf(project);
  assert.equal(permits.length, 1);
  assert.equal(permits[0]?.state, "Granted");
});

test("a grant is refused under a lapsed claim and under a closed project", async () => {
  const project = await subject("fenced");
  const target = finalizerCommit();
  const claim = await finalizerClaim(rig, project, "owner-fenced");
  const attempt = await finalizerPrepare(rig, project, "fenced", {
    target,
    candidate: finalizerCommit(),
  });
  const store = finalizerService(rig, finalizerGit(targetAt(target))).store;
  const stale = await store.grantPermit({
    claim: { ...claim, recoveryEpoch: asRecoveryEpoch("epoch-that-was") },
    attempt: asFinalizationAttemptId(attempt),
  });
  assert.deepEqual(stale, { granted: "Refused", refusal: "Fenced" });
  const lapsed = await store.grantPermit({
    claim: { ...claim, claimGeneration: claim.claimGeneration + 1 },
    attempt: asFinalizationAttemptId(attempt),
  });
  assert.deepEqual(lapsed, { granted: "Refused", refusal: "Fenced" });
  await rig.harness.query(
    `UPDATE project SET lifecycle='Suspended' WHERE tenant=$1 AND project=$2`,
    [project.partition.tenant, project.partition.project],
  );
  const closed = await store.grantPermit({
    claim,
    attempt: asFinalizationAttemptId(attempt),
  });
  assert.deepEqual(closed, { granted: "Refused", refusal: "ProjectClosed" });
  await rig.harness.query(
    `UPDATE project SET lifecycle='Active', lifecycle_generation=lifecycle_generation+1
      WHERE tenant=$1 AND project=$2`,
    [project.partition.tenant, project.partition.project],
  );
  const reopened = await store.grantPermit({
    claim,
    attempt: asFinalizationAttemptId(attempt),
  });
  assert.equal(reopened.granted, "Permit");
  assert.equal((await permitsOf(project))[0]?.lifecycle_generation, "2");
  assert.equal(await readingOf(project), undefined);
});

test("the permit is durably granted before the ref update is attempted", async () => {
  const project = await subject("ordered");
  const target = finalizerCommit();
  const attempt = await prepared(project, "ordered", target, finalizerCommit());
  const git = finalizerGit(targetAt(target));
  let seen: readonly PermitState[] = [];
  git.beforePromotion = async (promotion) => {
    seen = await permitsOf(project);
    assert.equal(promotion.permit, seen[0]?.permit);
  };
  const report = await passOnce(project, git, "ordered");
  assert.equal(report.promotions, 1);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.state, "Granted");
  assert.equal(seen[0]?.attempt, attempt);
});

test("a crash after the grant leaves a permit recovery reconciles by ancestry", async () => {
  const project = await subject("crashed");
  const target = finalizerCommit();
  const candidate = finalizerCommit();
  await prepared(project, "crashed", target, candidate);
  const git = finalizerGit(targetAt(target));
  git.beforePromotion = () =>
    Promise.reject(new Error("the finalizer died mid-update"));
  await assert.rejects(passOnce(project, git, "crashed"));
  const granted = await permitsOf(project);
  assert.equal(granted.length, 1);
  assert.equal(granted[0]?.state, "Granted");
  assert.equal(await readingOf(project), undefined);

  await finalizerExpireClaim(rig, project);
  const recovering = finalizerGit(targetAt(target));
  recovering.ancestry = {
    proved: "Ancestor",
    observed: asGitObjectId(candidate),
  };
  const recovered = await passOnce(project, recovering, "crashed-again");
  assert.equal(recovered.reopened, 1);
  assert.equal(recovered.reconciliations, 1);
  assert.deepEqual(recovering.acts, ["observe", "prove"]);
  assert.equal((await permitsOf(project))[0]?.state, "Concluded");
  const reading = await readingOf(project);
  assert.equal(reading?.verdict, "Promoted");
  assert.equal(reading?.observed_commit, candidate);
});

test("an ambiguous update that the ref denies restarts preparation instead", async () => {
  const project = await subject("denied");
  const target = finalizerCommit();
  const candidate = finalizerCommit();
  await prepared(project, "denied", target, candidate);
  const git = finalizerGit(targetAt(target));
  git.promotion = { promoted: "Ambiguous", evidence: "PromotionTimedOut" };
  git.ancestry = { proved: "NotAncestor", observed: asGitObjectId(target) };
  const report = await passOnce(project, git, "denied");
  assert.equal(report.promotions, 1);
  assert.deepEqual(git.acts, ["observe", "promote", "prove"]);
  const reading = await readingOf(project);
  assert.equal(reading?.verdict, "NotPromoted");
  assert.equal(reading?.observed_commit, target);
  assert.equal((await permitsOf(project))[0]?.state, "Concluded");

  await finalizerExpireClaim(rig, project);
  const again = await passOnce(project, git, "denied-again");
  assert.equal(again.preparations, 1);
  assert.equal(again.holds, 1);
  assert.equal(again.conclusions, 0);
});

test("an unreadable ref is a durable hold the next pass re-reads and settles", async () => {
  const project = await subject("held");
  const target = finalizerCommit();
  const candidate = finalizerCommit();
  await prepared(project, "held", target, candidate);
  const git = finalizerGit(targetAt(target));
  git.promotion = { promoted: "Ambiguous", evidence: "RemoteUnreachable" };
  git.ancestry = { proved: "Unreadable", evidence: "RefUnreadable" };
  const held = await passOnce(project, git, "held");
  assert.equal(held.holds, 1);
  const reading = await readingOf(project);
  assert.equal(reading?.verdict, "Unreadable");
  assert.equal(reading?.observed_commit, null);
  assert.equal((await permitsOf(project))[0]?.state, "Granted");

  const settling = finalizerGit(targetAt(candidate));
  settling.ancestry = {
    proved: "Ancestor",
    observed: asGitObjectId(candidate),
  };
  const settled = await passOnce(project, settling, "held-again");
  assert.equal(settled.rereadings, 1);
  assert.equal(settled.holds, 0);
  const concluded = await readingOf(project);
  assert.equal(concluded?.verdict, "Promoted");
  assert.equal(concluded?.observed_commit, candidate);
  assert.equal((await permitsOf(project))[0]?.state, "Concluded");
});

test("a refused update is information and never a promotion", async () => {
  const project = await subject("refused");
  const target = finalizerCommit();
  const moved = finalizerCommit();
  await prepared(project, "refused", target, finalizerCommit());
  const git = finalizerGit(targetAt(target));
  git.promotion = { promoted: "Rejected", observed: asGitObjectId(moved) };
  const report = await passOnce(project, git, "refused");
  assert.equal(report.promotions, 1);
  assert.deepEqual(git.acts, ["observe", "promote"]);
  const reading = await readingOf(project);
  assert.equal(reading?.verdict, "NotPromoted");
  assert.equal(reading?.observed_commit, moved);
  assert.equal((await permitsOf(project))[0]?.state, "Concluded");
});

test("an advanced ref concludes the finalization through the one door", async () => {
  const project = await subject("advanced");
  const target = finalizerCommit();
  const candidate = finalizerCommit();
  await prepared(project, "advanced", target, candidate);
  const git = finalizerGit(targetAt(target));
  const promoted = await passOnce(project, git, "advanced");
  assert.equal(promoted.promotions, 1);
  assert.equal((await permitsOf(project))[0]?.state, "Concluded");
  assert.equal((await readingOf(project))?.verdict, "Promoted");

  await finalizerExpireClaim(rig, project);
  const concluding = await passOnce(project, git, "advanced-again");
  assert.equal(concluding.conclusions, 1);
  const submitted = (await rig.harness.query(
    `SELECT command_tag, authority_kind FROM operation
      WHERE tenant=$1 AND project=$2 AND authority_kind='Finalizer'`,
    [project.partition.tenant, project.partition.project],
  )) as readonly { command_tag: string }[];
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0]?.command_tag, "FinalizationResult");

  await finalizerDrain(rig.harness, project.partition, project.memory);
  await finalizerExpireClaim(rig, project);
  const settling = await passOnce(project, git, "advanced-settled");
  assert.equal(settling.conclusions, 0);
  const request = (await rig.as(
    `SELECT state, claim_owner FROM finalization_request
      WHERE tenant=$1 AND project=$2 AND request=$3`,
    [project.partition.tenant, project.partition.project, project.request],
  )) as readonly { state: string; claim_owner: string | null }[];
  assert.equal(request[0]?.state, "Fulfilled");
  assert.equal(request[0]?.claim_owner, null);
});

test("a spent permit is never re-granted and an unprepared attempt never gets one", async () => {
  const project = await subject("spent");
  const target = finalizerCommit();
  const claim = await finalizerClaim(rig, project, "owner-spent");
  const failed = await finalizerPrepare(rig, project, "spent-failed", {
    outcome: "Failed",
  });
  const prepared = await finalizerPrepare(rig, project, "spent-ok", {
    target,
    candidate: finalizerCommit(),
  });
  const store = finalizerService(rig, finalizerGit(targetAt(target))).store;
  assert.deepEqual(
    await store.grantPermit({
      claim,
      attempt: asFinalizationAttemptId(failed),
    }),
    { granted: "Refused", refusal: "AttemptUnprepared" },
  );
  const permit = await finalizerGrantPermit(rig, project, prepared, "spent");
  await rig.as(
    `UPDATE commit_permit SET state='Concluded', concluded_at=now()
      WHERE tenant=$1 AND project=$2 AND permit=$3`,
    [project.partition.tenant, project.partition.project, permit],
  );
  assert.deepEqual(
    await store.grantPermit({
      claim,
      attempt: asFinalizationAttemptId(prepared),
    }),
    { granted: "Refused", refusal: "PermitSpent" },
  );
});

test("a takeover leaves an old-epoch executor unable to take or use a permit", async () => {
  const project = await subject("superseded");
  const target = finalizerCommit();
  const candidate = finalizerCommit();
  const claim = await finalizerClaim(rig, project, "owner-superseded");
  const attempt = await finalizerPrepare(rig, project, "superseded", {
    target,
    candidate,
  });
  const store = finalizerService(rig, finalizerGit(targetAt(target))).store;
  const granted = await store.grantPermit({
    claim,
    attempt: asFinalizationAttemptId(attempt),
  });
  if (granted.granted !== "Permit") throw new Error("no permit to fence");
  await rig.harness.store.establishRecoveryEpoch(
    asRecoveryEpoch(`epoch-superseded-${project.partition.project}`),
  );
  assert.deepEqual(
    await store.recordReconciliation({
      partition: project.partition,
      recoveryEpoch: asRecoveryEpoch(project.epoch),
      reconciliation: {
        permit: granted.permit.permit,
        candidate: asGitObjectId(candidate),
        target: asGitRefName(targetRef),
        verdict: "Promoted",
        observed: asGitObjectId(candidate),
      },
    }),
    { recorded: "Refused" },
  );
  const second = await finalizerPrepare(rig, project, "superseded-again", {
    target,
    candidate: finalizerCommit(),
  });
  assert.deepEqual(
    await store.grantPermit({
      claim,
      attempt: asFinalizationAttemptId(second),
    }),
    { granted: "Refused", refusal: "Fenced" },
  );
  assert.equal((await permitsOf(project))[0]?.state, "Granted");
  assert.equal(await readingOf(project), undefined);
});

/**
 * Two readings of one permit, staged so both backends are queued on that row
 * before either is let through. The blockade is what makes it a race the case
 * set up rather than one it hoped for.
 */
async function permitReadingsRacing(
  store: FinalizerStore,
  record: ReconciliationRecord,
): Promise<readonly Reconciled[]> {
  const { partition, reconciliation } = record;
  const blockade = await schedulerBlockade(
    `SELECT state FROM commit_permit
      WHERE tenant=$1 AND project=$2 AND permit=$3 FOR UPDATE`,
    [partition.tenant, partition.project, reconciliation.permit],
  );
  try {
    const racing = schedulerOutcome(
      Promise.all([
        store.recordReconciliation(record),
        store.recordReconciliation(record),
      ]),
    );
    await blockade.stalled(2);
    assert.equal(
      await blockade.stalledHolds("commit_permit", "RowShareLock"),
      true,
      "a stalled reading had not reached the permit row",
    );
    await blockade.release();
    const recorded = await racing;
    if (typeof recorded === "string") assert.fail(recorded);
    return recorded;
  } finally {
    await blockade.release();
  }
}

test("two readings of one permit record one verdict between them", async () => {
  const project = await subject("reconciling");
  const target = finalizerCommit();
  const candidate = finalizerCommit();
  const claim = await finalizerClaim(rig, project, "owner-reconciling");
  const attempt = await finalizerPrepare(rig, project, "reconciling", {
    target,
    candidate,
  });
  const store = finalizerService(rig, finalizerGit(targetAt(target))).store;
  const granted = await store.grantPermit({
    claim,
    attempt: asFinalizationAttemptId(attempt),
  });
  if (granted.granted !== "Permit") throw new Error("no permit to reconcile");
  const record = {
    partition: project.partition,
    recoveryEpoch: asRecoveryEpoch(project.epoch),
    reconciliation: {
      permit: granted.permit.permit,
      candidate: asGitObjectId(candidate),
      target: asGitRefName(targetRef),
      verdict: "Promoted" as const,
      observed: asGitObjectId(candidate),
    },
  };
  const recorded = await permitReadingsRacing(store, record);
  assert.deepEqual([...recorded].map((each) => each.recorded).sort(), [
    "Concluded",
    "Refused",
  ]);
  assert.equal((await permitsOf(project))[0]?.state, "Concluded");
  assert.deepEqual(
    await rig.as(
      `SELECT count(*)::text AS made FROM finalization_reconciliation
        WHERE tenant=$1 AND project=$2 AND permit=$3`,
      [
        project.partition.tenant,
        project.partition.project,
        granted.permit.permit,
      ],
    ),
    [{ made: "1" }],
  );
});

test("an executor still alive on its permit row concludes nothing once the epoch moves", async () => {
  const project = await subject("alive");
  const claim = await finalizerClaim(rig, project, "owner-alive");
  const attempt = await finalizerPromote(rig, project, "alive");
  const permit = (await permitsOf(project))[0];
  assert.equal(
    permit?.state,
    "Concluded",
    "the finalization is not concludable",
  );
  const store = finalizerService(
    rig,
    finalizerGit(targetAt(finalizerCommit())),
  ).store;
  const entries = await entriesOf(project);

  const alive = await rig.pool.connect();
  let refusals: readonly unknown[];
  try {
    await alive.query("BEGIN");
    await alive.query(
      `SELECT state FROM commit_permit
        WHERE tenant=$1 AND project=$2 AND permit=$3 FOR UPDATE`,
      [project.partition.tenant, project.partition.project, permit?.permit],
    );
    assert.equal(
      await permitRowIsHeld(project, permit?.permit ?? ""),
      true,
      "the old-epoch executor was not holding its permit row",
    );
    await rig.harness.store.establishRecoveryEpoch(
      asRecoveryEpoch(`epoch-alive-${project.partition.project}`),
    );
    refusals = [
      await store.submitResult({
        claim,
        attempt: asFinalizationAttemptId(attempt),
        conclusion: { outcome: "FinalizationSucceeded" },
      }),
      await store.extendClaim(claim, 60),
      await store.settleClaim(claim),
    ];
  } finally {
    await alive.query("ROLLBACK").catch(() => undefined);
    alive.release();
  }
  assert.deepEqual(refusals, [{ submitted: "BindingMismatch" }, false, false]);
  assert.equal(await entriesOf(project), entries);
  assert.equal(await submissionsOf(project), 0);
  await permitSuccessorConcludes(project, attempt);
});

test("the process that took over reconstructs the correlation from the rows alone", async () => {
  const current = await rig.harness.store.currentRecoveryEpoch();
  const project = await finalizerProject(rig, "takeover");
  await quiesce(project);
  const claim = await finalizerClaim(rig, project, "owner-takeover");
  const candidate = finalizerCommit();
  const attempt = await finalizerPrepare(rig, project, "takeover", {
    candidate,
  });
  const permit = await finalizerGrantPermit(rig, project, attempt, "takeover");
  await rig.as(
    `UPDATE finalization_request SET claim_expires_at = now() - interval '1 hour'
      WHERE tenant=$1 AND project=$2 AND request=$3`,
    [project.partition.tenant, project.partition.project, project.request],
  );

  const successorPool = finalizerRolePool();
  try {
    const successor = postgresFinalizer(successorPool);
    assert.ok((await successor.reclaimLapsed(current, recoveryRowsMax)) >= 1);
    const redrawn = (
      await successor.claimRequests(
        asFinalizerOwnerId("owner-successor"),
        current,
        recoveryRowsMax,
        successorLeaseSecs,
      )
    ).find((each) => each.request === project.request);
    assert.ok(redrawn !== undefined, "the successor drew no claim of its own");
    assert.notEqual(redrawn.claimGeneration, claim.claimGeneration);
    const view = await successor.durableView(redrawn);
    assert.equal(view?.attempt?.attempt, attempt);
    assert.equal(view?.attempt?.candidate, candidate);
    assert.equal(view?.permit?.permit, permit);
    assert.equal(view?.permit?.state, "Granted");
    assert.equal(view?.reconciliation, undefined);
    assert.ok(view !== undefined);
    assert.deepEqual(finalizationNext(finalizerDefaults, view), {
      decide: "Reconcile",
      permit,
    });
  } finally {
    await successorPool.end();
  }
});
