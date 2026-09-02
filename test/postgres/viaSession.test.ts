/**
 * The session an accepted operation came through: written onto the row, and
 * outside the idempotency scope.
 *
 * TWO THREADS OF ONE MEMBER OFFERING ONE KEY ARE THAT MEMBER RETRYING. The
 * scope stays the tenant, the project, the authority kind and the key digest,
 * so a second submission through a different session finds the original rather
 * than accepting a second operation — which is what makes `via_session` an
 * audit column and not an identity axis.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import {
  acceptanceFunction,
  dispatchAcceptanceFunction,
} from "../../src/adapters/postgres/schema.ts";
import {
  postgresHarnessProject,
  postgresHarnessSubmission,
  type PostgresHarness,
} from "./harness.ts";
import { id } from "../domain/fixtures.ts";
import {
  sessionRigOpen,
  sessionRigProject,
  sessionRigSession,
  type SessionRig,
} from "./sessionHarness.ts";

let rig: SessionRig;
let harness: PostgresHarness;
before(async () => {
  rig = await sessionRigOpen();
  harness = rig.harness;
});
after(async () => {
  await rig.close();
});

/** The session an operation was submitted through, as the row holds it. */
async function storedSession(
  partition: { readonly tenant: string; readonly project: string },
  operation: string,
): Promise<string | null> {
  const rows = (await harness.query(
    `SELECT via_session FROM operation
      WHERE tenant=$1 AND project=$2 AND operation=$3`,
    [partition.tenant, partition.project, operation],
  )) as readonly { via_session: string | null }[];
  const row = rows[0];
  if (row === undefined)
    throw new Error(`via session: no operation ${operation}`);
  return row.via_session;
}

test("an operation submitted through a session records the session it came through", async () => {
  const partition = await sessionRigProject(rig, "carried");
  const session = await sessionRigSession(rig, partition, "carried", {
    kind: "Thread",
    principal: "member-carried",
  });
  const submission = postgresHarnessSubmission(partition, "carried");
  assert.equal(
    (await harness.inbox.accept({ ...submission, viaSession: session }))
      .accepted,
    "Accepted",
  );
  assert.equal(await storedSession(partition, submission.operation), session);
});

test("an operation submitted by a person alone records no session", async () => {
  const partition = await postgresHarnessProject(harness.store, "via-none");
  const submission = postgresHarnessSubmission(partition, "unsessioned");
  assert.equal((await harness.inbox.accept(submission)).accepted, "Accepted");
  assert.equal(await storedSession(partition, submission.operation), null);
});

test("the same key through two different sessions is one operation, and it is the first", async () => {
  const partition = await sessionRigProject(rig, "idempotent");
  const first = await sessionRigSession(rig, partition, "idempotent-first", {
    kind: "Lead",
  });
  const second = await sessionRigSession(rig, partition, "idempotent-second", {
    kind: "Thread",
    principal: "member-idempotent",
  });
  const submission = postgresHarnessSubmission(partition, "idempotent");
  const accepted = await harness.inbox.accept({
    ...submission,
    viaSession: first,
  });
  assert.equal(accepted.accepted, "Accepted");
  const retried = await harness.inbox.accept({
    ...submission,
    viaSession: second,
  });
  assert.equal(retried.accepted, "Original");
  assert.equal(await storedSession(partition, submission.operation), first);
});

test("an operation may not name a session of another project", async () => {
  const partition = await sessionRigProject(rig, "foreign");
  const elsewhere = await sessionRigProject(rig, "foreign-elsewhere");
  const session = await sessionRigSession(rig, elsewhere, "foreign");
  await assert.rejects(
    harness.inbox.accept({
      ...postgresHarnessSubmission(partition, "foreign"),
      viaSession: session,
    }),
    /operation_via_session_is_a_session/u,
  );
});

test("a dispatch submitted through a session records it too, by the other door", async () => {
  const partition = await sessionRigProject(rig, "dispatched");
  const session = await sessionRigSession(rig, partition, "dispatched", {
    kind: "Thread",
    principal: "member-dispatched",
  });
  const submission = postgresHarnessSubmission(partition, "dispatched");
  const dispatch = {
    ...submission,
    command: {
      version: 1,
      command: "ManualDispatch",
      ticket: id(1),
      expectedTicketVersion: 1,
    } as const,
    viaSession: session,
  };
  assert.equal((await harness.inbox.accept(dispatch)).accepted, "Accepted");
  assert.equal(await storedSession(partition, submission.operation), session);
  assert.deepEqual(
    await harness.query(
      `SELECT command_tag FROM operation
        WHERE tenant=$1 AND project=$2 AND operation=$3`,
      [partition.tenant, partition.project, submission.operation],
    ),
    [{ command_tag: "ManualDispatch" }],
  );
});

test("each acceptance door is declared once, and the signature without a session is gone", async () => {
  for (const door of [acceptanceFunction, dispatchAcceptanceFunction]) {
    const declared = (await harness.query(
      `SELECT p.pronargs AS arguments FROM pg_proc p
         JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname=$1`,
      [door],
    )) as readonly { arguments: number }[];
    assert.deepEqual(declared, [{ arguments: 14 }], door);
  }
});
