/**
 * The runtime role's grants: what a dispatcher connection may do to these
 * relations, and what the server refuses it.
 *
 * WHY THIS IS A TEST AND NOT A README LINE. 006 requires that ordinary runtime
 * database roles cannot update or delete historical entries, and the
 * implementor contract requires that no caller can bypass a durable boundary
 * with a direct table write. Both are claims about grants, and a grant that
 * was never exercised reads exactly like a grant that was never made.
 *
 * EACH ATTEMPT IS ROLLED BACK, so a case that proves a permitted statement
 * leaves no row for the next case to find.
 *
 * TWO ROLES MEET AT THESE RELATIONS AND NEITHER MAY DO THE OTHER'S WORK. The
 * API accepts and cancels and decides nothing; the dispatcher decides and
 * accepts nothing. A column-level grant is the only thing separating them, and
 * a column-level grant nobody tested is a whole-row grant nobody noticed.
 *
 * THE ONE THING NO GRANT CAN SEPARATE IS CANCELLING FROM DECIDING, because
 * both write `state` on the same row. So the API role holds no `UPDATE` on
 * `operation` at all and cancellation is a `SECURITY DEFINER` function, and
 * the cases below drive both halves of that: the direct writes the role must
 * be refused, and the one call it must be able to make.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import {
  apiRole,
  cancellationFunction,
  dispatcherRole,
} from "../../src/adapters/postgres/schema.ts";
import type { Submission } from "../../src/interpreter/operationInbox.ts";
import {
  postgresHarnessHeld,
  postgresHarnessOpen,
  postgresHarnessOwner,
  postgresHarnessProject,
  postgresHarnessSubmission,
  type PostgresHarness,
} from "./harness.ts";

let harness: PostgresHarness;

before(async () => {
  harness = await postgresHarnessOpen();
});

after(async () => {
  await harness.close();
});

test("the dispatcher role cannot rewrite a journal entry", async () => {
  const refusal = await harness.attemptAs(
    dispatcherRole,
    "UPDATE journal_entry SET entry = '{}'",
  );
  assert.match(String(refusal), /permission denied/);
});

test("the dispatcher role cannot delete a journal entry", async () => {
  const refusal = await harness.attemptAs(
    dispatcherRole,
    "DELETE FROM journal_entry",
  );
  assert.match(String(refusal), /permission denied/);
});

test("the dispatcher role cannot provision a project, because provisioning is not a decision", async () => {
  const refusal = await harness.attemptAs(
    dispatcherRole,
    "INSERT INTO project (tenant, project, lifecycle) VALUES ('t', 'p', 'Active')",
  );
  assert.match(String(refusal), /permission denied/);
});

test("the dispatcher role cannot mint a recovery epoch, because a runtime that could would unfence itself", async () => {
  const refusal = await harness.attemptAs(
    dispatcherRole,
    "INSERT INTO recovery_epoch (epoch) VALUES ('forged')",
  );
  assert.match(String(refusal), /permission denied/);
});

test("the dispatcher role cannot lift a suspension it is fenced by", async () => {
  const partition = await postgresHarnessProject(harness.store, "unfence");
  await harness.store.fence(partition, "IntegrityBlocked");
  const refusal = await harness.attemptAs(
    dispatcherRole,
    `UPDATE project SET lifecycle = 'Active' WHERE tenant = '${partition.tenant}'`,
  );
  assert.match(String(refusal), /permission denied/);
});

test("the dispatcher role cannot move a project across the composite key", async () => {
  const partition = await postgresHarnessProject(harness.store, "rekey");
  const refusal = await harness.attemptAs(
    dispatcherRole,
    `UPDATE project SET tenant = 'elsewhere' WHERE tenant = '${partition.tenant}'`,
  );
  assert.match(String(refusal), /permission denied/);
});

test("the dispatcher role may append an entry and move the head it counts", async () => {
  const submission = await acceptedFor("grants");
  const partition = submission.partition;
  const epoch = await harness.store.currentRecoveryEpoch();
  assert.equal(
    await harness.attemptAs(
      dispatcherRole,
      `INSERT INTO journal_entry
         (tenant, project, seq, entry, entry_digest, prev_digest, owner, fencing_epoch,
          recovery_epoch, cause_operation)
       VALUES ('${partition.tenant}', '${partition.project}', 1, '{}', 'd', 'p', 'o', 1,
               '${epoch}', '${submission.operation}')`,
    ),
    undefined,
  );
  assert.equal(
    await harness.attemptAs(
      dispatcherRole,
      `UPDATE project SET head = 1 WHERE tenant = '${partition.tenant}'`,
    ),
    undefined,
  );
  assert.equal(
    await harness.attemptAs(dispatcherRole, "SELECT * FROM journal_entry"),
    undefined,
  );
  assert.equal(
    await harness.attemptAs(dispatcherRole, "SELECT epoch FROM recovery_epoch"),
    undefined,
  );
});

/** An accepted operation whose rows the role cases attempt statements against. */
async function acceptedFor(label: string): Promise<Submission> {
  const partition = await postgresHarnessProject(harness.store, label);
  const submission = postgresHarnessSubmission(partition, label);
  const outcome = await harness.inbox.accept(submission);
  assert.ok(outcome.accepted === "Accepted");
  return submission;
}

/** The columns an inserted operation must carry, as one values list a case can vary the row of. */
function operationValues(submission: Submission, operation: string): string {
  return `'${submission.partition.tenant}', '${submission.partition.project}', '${operation}',
          '${submission.authority.kind}', '${submission.authority.subject}', 'Ordinary',
          'v', 'digest-${operation}', 'payload', '{}', 1`;
}

/** The column list those values fill. */
const operationColumns = `
  tenant, project, operation, authority_kind, authority_subject, admission,
  key_version, key_digest, payload_digest, command, lifecycle_generation
`;

test("the api role cannot append a journal entry, because it accepts work and decides none", async () => {
  const refusal = await harness.attemptAs(
    apiRole,
    `INSERT INTO journal_entry
       (tenant, project, seq, entry, entry_digest, prev_digest, owner, fencing_epoch,
        recovery_epoch, cause_operation)
     VALUES ('t', 'p', 1, '{}', 'd', 'p', 'o', 1, 'e', 'c')`,
  );
  assert.match(String(refusal), /permission denied/);
});

test("the api role cannot move the head, the ownership or the lifecycle it accepts under", async () => {
  const submission = await acceptedFor("apifence");
  const where = `WHERE tenant = '${submission.partition.tenant}'`;
  for (const column of [
    "head = 1",
    "owner = 'someone'",
    "lifecycle = 'Retention'",
    "fencing_epoch = 99",
  ]) {
    const refusal = await harness.attemptAs(
      apiRole,
      `UPDATE project SET ${column} ${where}`,
    );
    assert.match(String(refusal), /permission denied/);
  }
});

test("the api role cannot provision a project or mint a recovery epoch", async () => {
  for (const statement of [
    "INSERT INTO project (tenant, project, lifecycle) VALUES ('t', 'p', 'Active')",
    "INSERT INTO recovery_epoch (epoch) VALUES ('forged')",
  ]) {
    const refusal = await harness.attemptAs(apiRole, statement);
    assert.match(String(refusal), /permission denied/);
  }
});

test("no role may drop an accepted operation or the inbox item that carries it", async () => {
  const submission = await acceptedFor("apidelete");
  const where = `WHERE operation = '${submission.operation}'`;
  for (const role of [apiRole, dispatcherRole]) {
    for (const relation of ["operation", "inbox_item"]) {
      const refusal = await harness.attemptAs(
        role,
        `DELETE FROM ${relation} ${where}`,
      );
      assert.match(String(refusal), /permission denied/);
    }
  }
});

test("the api role may accept: allocate an ordinal, write the operation and its item, and raise readiness", async () => {
  const submission = await acceptedFor("apiaccept");
  const partition = submission.partition;
  const fresh = `${submission.operation}-again`;
  const permitted = [
    `UPDATE project SET ingress_next = ingress_next + 1 WHERE tenant = '${partition.tenant}' AND project = '${partition.project}'`,
    `INSERT INTO operation (${operationColumns}) VALUES (${operationValues(submission, fresh)})`,
    `UPDATE project_readiness SET ready = true, generation = generation + 1 WHERE tenant = '${partition.tenant}'`,
  ];
  for (const statement of permitted) {
    assert.equal(await harness.attemptAs(apiRole, statement), undefined);
  }
});

test("the api role cannot accept an operation that is already decided", async () => {
  const submission = await acceptedFor("apibornsettled");
  const partition = submission.partition;
  const fresh = `${submission.operation}-born`;
  const refused = [
    `INSERT INTO operation (${operationColumns}, state, settled_at)
       VALUES (${operationValues(submission, fresh)}, 'Succeeded', now())`,
    `INSERT INTO operation (${operationColumns}, state, settled_at)
       VALUES (${operationValues(submission, fresh)}, 'Refused', now())`,
    `INSERT INTO operation (${operationColumns}, settled_authority_subject)
       VALUES (${operationValues(submission, fresh)}, 'someone')`,
  ];
  for (const statement of refused) {
    const refusal = await harness.attemptAs(apiRole, statement);
    assert.match(String(refusal), /permission denied/);
  }
  assert.equal(
    await harness.attemptAs(
      apiRole,
      `INSERT INTO operation (${operationColumns}) VALUES (${operationValues(submission, fresh)})`,
    ),
    undefined,
  );
  const standing = await harness.inbox.operation(
    partition,
    submission.operation,
  );
  assert.ok(standing !== undefined);
  assert.equal(standing.state, "Pending");
});

test("the api role cannot enqueue an item no writer will ever discover", async () => {
  const submission = await acceptedFor("apiunconsumable");
  const partition = submission.partition;
  const refusal = await harness.attemptAs(
    apiRole,
    `INSERT INTO inbox_item (tenant, project, ordinal, operation, consumable)
       VALUES ('${partition.tenant}', '${partition.project}', 9999, '${submission.operation}-item', false)`,
  );
  assert.match(String(refusal), /permission denied/);
});

test("the api role may lock the lifecycle row it allocates an ordinal from", async () => {
  const submission = await acceptedFor("apilock");
  const partition = submission.partition;
  assert.equal(
    await harness.attemptAs(
      apiRole,
      `SELECT tenant FROM project WHERE tenant = '${partition.tenant}' AND project = '${partition.project}' FOR UPDATE`,
    ),
    undefined,
  );
});

/** The cancellation call, with the submission's own authority as the settling one. */
function cancelCall(submission: Submission): string {
  return `SELECT ${cancellationFunction}('${submission.partition.tenant}', '${submission.partition.project}',
            '${submission.operation}', '${submission.authority.kind}', '${submission.authority.subject}')`;
}

test("the api role cannot decide a pending operation, by any write that would settle it", async () => {
  const submission = await acceptedFor("apidecide");
  const where = `WHERE operation = '${submission.operation}'`;
  const refused = [
    `UPDATE operation SET state = 'Succeeded', settled_at = now() ${where}`,
    `UPDATE operation SET state = 'Refused', settled_at = now() ${where}`,
    `UPDATE operation SET state = 'Cancelled', settled_at = now() ${where}`,
    `UPDATE operation SET settled_authority_subject = 'someone' ${where}`,
    `UPDATE inbox_item SET consumable = false ${where}`,
  ];
  for (const statement of refused) {
    const refusal = await harness.attemptAs(apiRole, statement);
    assert.match(String(refusal), /permission denied/);
  }
  assert.equal(
    (await harness.inbox.operation(submission.partition, submission.operation))
      ?.state,
    "Pending",
  );
});

test("the api role cancels through the function it is granted, and that is the whole of a cancellation", async () => {
  const submission = await acceptedFor("apicancel");
  const acting = await harness.begin();
  try {
    await acting.query(`SET LOCAL ROLE ${apiRole}`);
    assert.deepEqual(await acting.query(cancelCall(submission)), [
      { [cancellationFunction]: "Pending" },
    ]);
    assert.deepEqual(
      await acting.query(
        `SELECT o.state, i.consumable, o.settled_authority_subject
           FROM operation o JOIN inbox_item i USING (tenant, project, operation)
          WHERE o.operation = $1`,
        [submission.operation],
      ),
      [
        {
          state: "Cancelled",
          consumable: false,
          settled_authority_subject: submission.authority.subject,
        },
      ],
    );
  } finally {
    await acting.rollback();
  }
});

test("the dispatcher role cannot cancel, because the function is granted to the api role alone", async () => {
  const submission = await acceptedFor("dispatchercancel");
  const refusal = await harness.attemptAs(
    dispatcherRole,
    cancelCall(submission),
  );
  assert.match(String(refusal), /permission denied/);
});

test("the dispatcher role cannot accept work: no operation, no ordinal, no inbox item", async () => {
  const submission = await acceptedFor("dispatcheraccept");
  const partition = submission.partition;
  const refused = [
    `INSERT INTO operation (${operationColumns}) VALUES (${operationValues(submission, `${submission.operation}-forged`)})`,
    `UPDATE project SET ingress_next = ingress_next + 1 WHERE tenant = '${partition.tenant}'`,
    `INSERT INTO inbox_item (tenant, project, ordinal, operation) VALUES ('${partition.tenant}', '${partition.project}', 9, '${submission.operation}')`,
  ];
  for (const statement of refused) {
    const refusal = await harness.attemptAs(dispatcherRole, statement);
    assert.match(String(refusal), /permission denied/);
  }
});

test("the dispatcher role may lower readiness and may not advance the generation it reads", async () => {
  const submission = await acceptedFor("dispatcherready");
  const where = `WHERE tenant = '${submission.partition.tenant}'`;
  for (const statement of [
    `SELECT generation FROM project_readiness ${where} FOR UPDATE`,
    `SELECT ordinal FROM inbox_item ${where} AND consumable`,
    `UPDATE project_readiness SET ready = false ${where}`,
  ]) {
    assert.equal(await harness.attemptAs(dispatcherRole, statement), undefined);
  }
  const refusal = await harness.attemptAs(
    dispatcherRole,
    `UPDATE project_readiness SET generation = generation + 1 ${where}`,
  );
  assert.match(String(refusal), /permission denied/);
});

test("the dispatcher role may settle an operation, acknowledge its item and write a projection", async () => {
  const submission = await acceptedFor("dispatcherdecide");
  const partition = submission.partition;
  const where = `WHERE tenant = '${partition.tenant}' AND project = '${partition.project}'`;
  const permitted = [
    `UPDATE operation SET state = 'Succeeded', settled_at = now(), decided_seq = 1,
        settled_authority_kind = 'ProjectWriter', settled_authority_subject = 'owner'
      ${where} AND operation = '${submission.operation}'`,
    `UPDATE inbox_item SET consumable = false ${where}`,
    `INSERT INTO ticket_projection (tenant, project, ticket, phase, seq)
       VALUES ('${partition.tenant}', '${partition.project}', 1, 'Pending', 1)`,
  ];
  for (const statement of permitted) {
    assert.equal(await harness.attemptAs(dispatcherRole, statement), undefined);
  }
});

test("the dispatcher role cannot move a projection row across the key it is filed under", async () => {
  const submission = await acceptedFor("dispatcherreproject");
  const refusal = await harness.attemptAs(
    dispatcherRole,
    `UPDATE ticket_projection SET ticket = 2 WHERE tenant = '${submission.partition.tenant}'`,
  );
  assert.match(String(refusal), /permission denied/);
});

test("no role may move a project's fencing epoch backwards", async () => {
  const partition = await postgresHarnessProject(harness.store, "backwards");
  const held = await postgresHarnessHeld(harness.store, partition, "holder");
  const refusal = await harness.attemptAs(
    dispatcherRole,
    `UPDATE project SET fencing_epoch = ${String(held.fencingEpoch - 1)}
      WHERE tenant = '${partition.tenant}' AND project = '${partition.project}'`,
  );
  assert.match(String(refusal), /fencing epoch backwards/);
});

test("no role may write a fenced tenure back into an active project", async () => {
  const partition = await postgresHarnessProject(harness.store, "reinstate");
  const former = await postgresHarnessHeld(harness.store, partition, "former");
  await harness.query(
    "UPDATE project SET lease_expires_at = now() - interval '1 second' WHERE tenant = $1 AND project = $2",
    [partition.tenant, partition.project],
  );
  const successor = await harness.store.acquire(
    partition,
    postgresHarnessOwner("successor"),
    60,
  );
  assert.ok(successor.acquired === "Granted");

  const where = `WHERE tenant = '${partition.tenant}' AND project = '${partition.project}'`;
  for (const statement of [
    `UPDATE project SET owner = '${former.owner}', fencing_epoch = ${String(former.fencingEpoch)},
        lease_expires_at = now() + interval '1 hour' ${where}`,
    `UPDATE project SET owner = '${former.owner}',
        lease_expires_at = now() + interval '1 hour' ${where}`,
  ]) {
    const refusal = await harness.attemptAs(dispatcherRole, statement);
    assert.match(String(refusal), /fencing epoch/);
  }
});

test("no role may revive an expired tenure without advancing the epoch that ended it", async () => {
  const partition = await postgresHarnessProject(harness.store, "revive");
  const stale = await postgresHarnessHeld(harness.store, partition, "stale");
  await harness.query(
    "UPDATE project SET lease_expires_at = now() - interval '1 second' WHERE tenant = $1 AND project = $2",
    [partition.tenant, partition.project],
  );
  const refusal = await harness.attemptAs(
    dispatcherRole,
    `UPDATE project SET lease_expires_at = now() + interval '1 hour'
      WHERE tenant = '${partition.tenant}' AND project = '${partition.project}'`,
  );
  assert.match(String(refusal), /without advancing its fencing epoch/);

  const renewed = await harness.store.renew(stale, 60);
  assert.equal(renewed.renewed, "Fenced");
});

test("an unbroken tenure renews without advancing its fencing epoch", async () => {
  const partition = await postgresHarnessProject(harness.store, "renewal");
  const held = await postgresHarnessHeld(harness.store, partition, "holder");
  const renewed = await harness.store.renew(held, 60);
  assert.ok(renewed.renewed === "Extended");
  assert.equal(renewed.lease.fencingEpoch, held.fencingEpoch);
});
