/**
 * The two lifecycle collisions a finalizing ticket can meet: a revocation
 * racing the entry into `Finalizing`, and a project closing while a
 * finalization is in flight.
 *
 * ENTRY IS THE POINT OF NO RETURN AND THE MAILBOX IS WHAT DECIDES THE RACE.
 * `revocableIn` excludes `Finalizing`, so the question is only ever which of
 * the two the writer journals first — and that is not the order they were
 * accepted in. A revocation is `Safety` and the completion that enters the
 * phase is `Completion`, so a revocation accepted second is still decided
 * first, and the cases here accept it second on purpose.
 *
 * THE RACE IS STAGED AND NOT HOPED FOR. Both acceptances take the project row,
 * so a third connection holds that row and the case waits until both backends
 * are queued on it and hold the relation in the mode the acceptance takes,
 * before letting either through. Without that guard a case whose two calls
 * never overlapped would pass exactly like one whose calls did.
 *
 * A CLOSURE IS PROVED BY WHAT WAS NOT DONE. The abort's whole claim is that it
 * is reversible, so its cases read the remote's ref and the permit table after
 * it rather than trusting the report — a pass that had promoted anything, or
 * taken a permit it never gave back, would satisfy any weaker assertion.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { revokeEvent } from "../../src/actor/decisionEvent.ts";
import { id } from "../domain/fixtures.ts";
import {
  asGitObjectId,
  asGitRefName,
} from "../../src/interpreter/finalizer.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  finalizerAccept,
  finalizerCommit,
  finalizerDrain,
  finalizerEntering,
  finalizerEntries,
  finalizerExpireClaim,
  finalizerGit,
  finalizerGitVerb,
  finalizerLifecycle,
  finalizerPassOnce,
  finalizerPhase,
  finalizerPrepare,
  finalizerProject,
  finalizerQuiesce,
  finalizerRemotePort,
  finalizerRigOpen,
  finalizerSubject,
  finalizerTaskDone,
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

/** The ticket every fixture history releases, which is the one a revocation names. */
const subjectTicket = id(1);

/** The lock mode the acceptance door takes on the project row it orders against. */
const acceptanceRowMode = "RowShareLock";

/** The requests this project's decisions authorized a finalizer to run. */
async function requestsOf(
  partition: Partition,
): Promise<readonly Record<string, unknown>[]> {
  return rig.harness.query(
    `SELECT request, state, request_generation::text AS generation
       FROM finalization_request WHERE tenant=$1 AND project=$2`,
    [partition.tenant, partition.project],
  );
}

/** Where the two commands this project holds sit in its own mailbox order. */
async function ordinalsOf(
  partition: Partition,
): Promise<Record<string, number>> {
  const rows = (await rig.harness.query(
    `SELECT o.command_tag, d.ordinal::text AS ordinal
       FROM decision_input d
       JOIN operation o ON o.tenant=d.tenant AND o.project=d.project
            AND o.operation=d.input_id
      WHERE d.tenant=$1 AND d.project=$2 AND o.command_tag IN ('Revoke','TaskDone')
      ORDER BY d.ordinal`,
    [partition.tenant, partition.project],
  )) as readonly { command_tag: string; ordinal: string }[];
  return Object.fromEntries(
    rows.map((row) => [row.command_tag, Number(row.ordinal)]),
  );
}

/** The permits this project has ever been granted, which an abort must leave empty. */
async function permitsOf(
  project: FinalizerProject,
): Promise<readonly Record<string, unknown>[]> {
  return rig.as(
    `SELECT permit, state FROM commit_permit WHERE tenant=$1 AND project=$2`,
    [project.partition.tenant, project.partition.project],
  );
}

/**
 * What a closure writer must find empty before it may erase repository
 * evidence: permits this project granted whose reading has not concluded.
 */
async function unquiescedOf(
  project: FinalizerProject,
): Promise<readonly string[]> {
  const rows = (await rig.as(
    `SELECT p.permit AS held FROM commit_permit p
       LEFT JOIN finalization_reconciliation r
         ON r.tenant=p.tenant AND r.project=p.project AND r.permit=p.permit
      WHERE p.tenant=$1 AND p.project=$2
        AND (p.state <> 'Concluded' OR r.verdict IS NULL OR r.verdict='Unreadable')
      ORDER BY p.permit`,
    [project.partition.tenant, project.partition.project],
  )) as readonly { held: string }[];
  return rows.map((row) => row.held);
}

/** Every attempt this project's request has, oldest first. */
async function attemptsOf(
  project: FinalizerProject,
): Promise<readonly Record<string, unknown>[]> {
  return rig.as(
    `SELECT attempt, outcome, failure_kind FROM finalization_attempt
      WHERE tenant=$1 AND project=$2 ORDER BY prepared_at, attempt`,
    [project.partition.tenant, project.partition.project],
  );
}

/** What the finalizer submitted through its one door, and the outcome the envelope carries. */
async function submittedOf(
  project: FinalizerProject,
): Promise<Record<string, unknown> | undefined> {
  const rows = await rig.harness.query(
    `SELECT command_tag, command::jsonb->>'outcome' AS outcome
       FROM operation WHERE tenant=$1 AND project=$2 AND authority_kind='Finalizer'`,
    [project.partition.tenant, project.partition.project],
  );
  return rows[0];
}

test("a revocation in the mailbox wins the entry, whichever of the two was accepted first", async () => {
  const { partition, memory } = await finalizerEntering(rig, "revoke-first");
  assert.equal(
    await finalizerAccept(rig.harness, partition, "done", finalizerTaskDone(2)),
    "Accepted",
  );
  assert.equal(
    await finalizerAccept(
      rig.harness,
      partition,
      "revoke",
      revokeEvent(subjectTicket),
    ),
    "Accepted",
  );
  const ordinals = await ordinalsOf(partition);
  assert.ok(
    (ordinals["Revoke"] ?? 0) > (ordinals["TaskDone"] ?? 0),
    "the revocation was accepted second",
  );
  const drained = await finalizerDrain(rig.harness, partition, memory);
  assert.deepEqual(drained.decided, ["Committed", "Refused"]);
  assert.equal(await finalizerPhase(rig, partition), "Revoked");
  assert.deepEqual(await requestsOf(partition), []);
});

test("a revocation offered after entry is refused and the finalizer's request stands", async () => {
  const project = await finalizerProject(rig, "revoke-late");
  const partition = project.partition;
  const entries = await finalizerEntries(rig, partition);
  const standing = await requestsOf(partition);
  assert.equal(standing.length, 1);
  assert.equal(
    await finalizerAccept(
      rig.harness,
      partition,
      "revoke-late",
      revokeEvent(subjectTicket),
    ),
    "Accepted",
  );
  const drained = await finalizerDrain(rig.harness, partition, project.memory);
  assert.deepEqual(drained.decided, ["Refused"]);
  assert.equal(await finalizerEntries(rig, partition), entries);
  assert.equal(await finalizerPhase(rig, partition), "Finalizing");
  assert.deepEqual(await requestsOf(partition), standing);
});

test("a boundary write and an acceptance racing on the project row are still resolved by mailbox order", async () => {
  const { partition, memory } = await finalizerEntering(rig, "revoke-race");
  const blockade = await schedulerBlockade(
    "SELECT lifecycle FROM project WHERE tenant=$1 AND project=$2 FOR UPDATE",
    [partition.tenant, partition.project],
  );
  let accepted: readonly string[] | string;
  try {
    const racing = schedulerOutcome(
      Promise.all([
        finalizerAccept(
          rig.harness,
          partition,
          "race-done",
          finalizerTaskDone(2),
        ),
        finalizerAccept(
          rig.harness,
          partition,
          "race-revoke",
          revokeEvent(subjectTicket),
        ),
      ]),
    );
    await blockade.stalled(2);
    /**
     * Only the revoke is an acceptance now: a completion is no command a
     * principal may offer, so its half of this race is the boundary write that
     * takes the same project row under a mode of its own.
     */
    assert.equal(
      await blockade.stalledHolds("project", acceptanceRowMode),
      true,
      "a stalled acceptance had not reached the project row",
    );
    await blockade.release();
    accepted = await racing;
  } finally {
    await blockade.release();
  }
  if (typeof accepted === "string") assert.fail(accepted);
  assert.deepEqual([...accepted], ["Accepted", "Accepted"]);
  const ordinals = await ordinalsOf(partition);
  const raced = `revoke at ${String(ordinals["Revoke"])}, done at ${String(ordinals["TaskDone"])}`;
  assert.equal(Object.keys(ordinals).length, 2, raced);
  assert.notEqual(ordinals["Revoke"], ordinals["TaskDone"], raced);
  const drained = await finalizerDrain(rig.harness, partition, memory);
  assert.deepEqual(drained.decided, ["Committed", "Refused"], raced);
  assert.equal(await finalizerPhase(rig, partition), "Revoked", raced);
  assert.deepEqual(await requestsOf(partition), []);
});

test("a closing project aborts an unpermitted attempt without touching the remote", async () => {
  const { project, remote } = await finalizerSubject(rig, "abort", [
    { path: "one.txt", content: "one\n" },
  ]);
  const port = finalizerRemotePort(rig);
  const prepared = await finalizerPassOnce(rig, project, port, "abort");
  assert.equal(prepared.preparations, 1);
  const ref = finalizerGitVerb(remote.origin, "rev-parse", "refs/heads/main");

  await finalizerLifecycle(rig, project.partition, "Deleting");
  await finalizerExpireClaim(rig, project);
  const aborted = await finalizerPassOnce(rig, project, port, "abort-again");
  assert.equal(aborted.preparations, 1);
  assert.equal(aborted.promotions, 0);
  const attempts = await attemptsOf(project);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[1]?.["outcome"], "Failed");
  assert.equal(attempts[1]?.["failure_kind"], "PreparationFailed");
  assert.deepEqual(await permitsOf(project), []);
  assert.equal(
    finalizerGitVerb(remote.origin, "rev-parse", "refs/heads/main"),
    ref,
    "the abort moved the target ref",
  );

  await finalizerExpireClaim(rig, project);
  const concluded = await finalizerPassOnce(rig, project, port, "abort-third");
  assert.equal(concluded.conclusions, 1);
  assert.deepEqual(await submittedOf(project), {
    command_tag: "FinalizationResult",
    outcome: "FinalizationFailed",
  });
  assert.equal(await finalizerPhase(rig, project.partition), "Finalizing");
  assert.deepEqual(await permitsOf(project), []);
});

test("a project in retention retires the request rather than forging a conclusion", async () => {
  const { project } = await finalizerSubject(rig, "retention", [
    { path: "one.txt", content: "one\n" },
  ]);
  const port = finalizerRemotePort(rig);
  await finalizerPassOnce(rig, project, port, "retention");
  const entries = await finalizerEntries(rig, project.partition);
  await finalizerLifecycle(rig, project.partition, "Retention");
  await finalizerExpireClaim(rig, project);
  await finalizerPassOnce(rig, project, port, "retention-abort");
  await finalizerExpireClaim(rig, project);
  const offered = await finalizerPassOnce(rig, project, port, "retention-end");
  assert.equal(offered.conclusions, 0);
  assert.equal(await submittedOf(project), undefined);
  assert.equal(await finalizerEntries(rig, project.partition), entries);
  assert.deepEqual(
    (await requestsOf(project.partition)).map((row) => row["state"]),
    ["Invalidated"],
  );
});

test("a closure past the permit waits on the reading and never abandons it", async () => {
  const project = await finalizerProject(rig, "erasure");
  await finalizerQuiesce(rig, project);
  const target = finalizerCommit();
  const candidate = finalizerCommit();
  await finalizerPrepare(rig, project, "erasure", { target, candidate });
  const git = finalizerGit({
    ref: asGitRefName("refs/heads/main"),
    commit: asGitObjectId(target),
  });
  git.promotion = { promoted: "Ambiguous", evidence: "RemoteUnreachable" };
  git.ancestry = { proved: "Unreadable", evidence: "RefUnreadable" };
  const held = await finalizerPassOnce(rig, project, git, "erasure");
  assert.equal(held.holds, 1);
  assert.deepEqual(await unquiescedOf(project), [
    String((await permitsOf(project))[0]?.["permit"]),
  ]);

  await finalizerLifecycle(rig, project.partition, "Deleting");
  await finalizerExpireClaim(rig, project);
  const closing = await finalizerPassOnce(rig, project, git, "erasure-closing");
  assert.equal(closing.rereadings, 1);
  assert.equal(closing.preparations, 0, "a permitted attempt was aborted");
  assert.equal((await attemptsOf(project)).length, 1);
  assert.equal((await permitsOf(project))[0]?.["state"], "Granted");
  assert.equal((await unquiescedOf(project)).length, 1);

  git.ancestry = { proved: "Ancestor", observed: asGitObjectId(candidate) };
  await finalizerExpireClaim(rig, project);
  const settled = await finalizerPassOnce(rig, project, git, "erasure-settled");
  assert.equal(settled.rereadings, 1);
  assert.equal((await permitsOf(project))[0]?.["state"], "Concluded");
  assert.deepEqual(await unquiescedOf(project), []);
});
