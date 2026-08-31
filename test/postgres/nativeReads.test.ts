import assert from "node:assert/strict";
import { test } from "node:test";

import {
  postgresNativeReads,
  publicOperation,
} from "../../src/adapters/postgres/nativeReads.ts";
import {
  postgresHarnessProject,
  postgresHarnessSubmission,
} from "./harness.ts";
import { seedOpenAction } from "./nativeActionFixture.ts";
import { postgresReadHarness } from "./readHarness.ts";
import type { TicketResource } from "../../src/interpreter/nativeWeb.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import { id } from "../domain/fixtures.ts";

const subject = postgresReadHarness();

async function filterProject() {
  return postgresHarnessProject(subject.harness.store, "native-filter");
}

async function currentEpoch(): Promise<string> {
  const found = await subject.harness.query(
    "SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1",
  );
  const epoch = found[0]?.["epoch"];
  if (typeof epoch !== "string")
    throw new Error("native read case: the harness established no epoch");
  return epoch;
}

/**
 * When the entry seeded at `seq` committed. A hand-written journal dates itself
 * rather than taking `now()`, so a case can say what the read will answer
 * without depending on how the server renders a time.
 */
function seededEntryAt(seq: number): number {
  return Date.UTC(2026, 0, 1, 0, 0, seq);
}

/** One ticket with its instant as a moment, which is what a case compares. */
function dated(ticket: TicketResource): Record<string, unknown> {
  return { ...ticket, changedAt: Date.parse(ticket.changedAt) };
}

/**
 * One journal entry at `seq`, seeded through the real chain: an entry decides
 * an accepted operation, so nothing standing on one here holds because a
 * constraint was skipped. Every case needs them, because a projection row is
 * written beside an entry and the read dates the row from it.
 */
async function seedEntry(
  partition: Partition,
  label: string,
  seq: number,
  entry = "{}",
): Promise<void> {
  const submission = postgresHarnessSubmission(partition, label);
  await subject.harness.inbox.accept(submission);
  const epoch = await currentEpoch();
  const seeding = await subject.harness.begin();
  await seeding.query(
    `UPDATE decision_input SET state='Journaled', decided_seq=$3, terminal_at=now()
      WHERE tenant=$1 AND project=$2 AND input_kind='Operation' AND input_id=$4`,
    [partition.tenant, partition.project, seq, submission.operation],
  );
  await seeding.query(
    `INSERT INTO journal_entry
       (tenant,project,seq,entry,entry_digest,prev_digest,owner,fencing_epoch,
        recovery_epoch,cause_kind,cause_id,committed_at)
     VALUES ($1,$2,$3,$8,$4,'genesis','owner',1,$5,'Operation',$6,$7)`,
    [
      partition.tenant,
      partition.project,
      seq,
      `digest-${label}`,
      epoch,
      submission.operation,
      new Date(seededEntryAt(seq)).toISOString(),
      entry,
    ],
  );
  await seeding.commit();
}

/** One entry of `type` naming `ticket`, as the encoder writes an event that has one. */
function seededEvent(type: string, ticket: number): string {
  return JSON.stringify({
    seq: ticket,
    event: { type, value: { ticket } },
    rec: {},
  });
}

/** One ticket of each terminal shape, and one parked with the wall it hit. */
async function seedFilterProjection(partition: Partition) {
  await subject.harness.query(
    "UPDATE project SET head=4 WHERE tenant=$1 AND project=$2",
    [partition.tenant, partition.project],
  );
  for (const [ticket, phase, reason] of [
    [1, "Done", "NoReason"],
    [2, "Pending", "NoReason"],
    [3, "Revoked", "NoReason"],
    [4, "Escalated", "GasExhausted"],
  ] as const) {
    await seedEntry(partition, `native-filter-${String(ticket)}`, ticket);
    await subject.harness.query(
      `INSERT INTO ticket_projection (tenant,project,ticket,phase,seq,reason)
       VALUES ($1,$2,$3,$4,$3,$5)`,
      [partition.tenant, partition.project, ticket, phase, reason],
    );
  }
}

test("public operations omit commands, authority, and storage coordination", () => {
  const resource = publicOperation({
    operation: "operation",
    accepted_at: "2026-01-01 00:00:00.123456+00",
    state: "Journaled",
    decided_seq: "7",
    outcome_code: null,
    refused_head: null,
    refused_lifecycle_generation: null,
  });
  assert.deepEqual(resource, {
    operation: "operation",
    acceptedAt: "2026-01-01T00:00:00.123456+00:00",
    state: "Succeeded",
    decidedSequence: 7,
  });
  assert.equal("command" in resource, false);
  assert.equal("authority" in resource, false);
  assert.equal("fencingEpoch" in resource, false);
});

test("public operations expose an authoring-fence refusal", () => {
  assert.deepEqual(
    publicOperation({
      operation: "release-race",
      accepted_at: "2026-01-01 00:00:00+00",
      state: "Refused",
      decided_seq: null,
      outcome_code: "AuthoringChanged",
      refused_head: "3",
      refused_lifecycle_generation: "2",
    }),
    {
      operation: "release-race",
      acceptedAt: "2026-01-01T00:00:00+00:00",
      state: "Refused",
      code: "AuthoringChanged",
      refusedHead: 3,
      refusedLifecycleGeneration: 2,
    },
  );
});

test("operation polling reads the durable public state", async () => {
  const partition = await postgresHarnessProject(
    subject.harness.store,
    "native-poll",
  );
  const submission = postgresHarnessSubmission(partition, "native-poll");
  await subject.harness.inbox.accept(submission);
  const resource = await postgresNativeReads(subject.pool).operation(
    partition,
    submission.operation,
  );
  assert.equal(resource?.operation, submission.operation);
  assert.equal(resource?.state, "Pending");
  assert.match(resource?.acceptedAt ?? "", /^\d{4}-\d{2}-\d{2}/);
});

test("project reads page by ticket identity and enforce a minimum sequence", async () => {
  const partition = await postgresHarnessProject(
    subject.harness.store,
    "native-page",
  );
  await subject.harness.query(
    "UPDATE project SET head=3 WHERE tenant=$1 AND project=$2",
    [partition.tenant, partition.project],
  );
  for (const [index, ticket] of [1, 3, 8].entries()) {
    await seedEntry(partition, `native-page-${String(ticket)}`, index + 1);
    await subject.harness.query(
      `INSERT INTO ticket_projection (tenant,project,ticket,phase,seq)
       VALUES ($1,$2,$3,'Pending',$4)`,
      [partition.tenant, partition.project, ticket, index + 1],
    );
  }
  const reads = postgresNativeReads(subject.pool);
  assert.deepEqual(
    await reads.project(partition, { limit: 2, minimumSequence: 4 }),
    {
      result: "Behind",
      observedSequence: 3,
    },
  );
  const first = await reads.project(partition, { limit: 2 });
  assert.equal(first.result, "Found");
  if (first.result !== "Found") return;
  assert.deepEqual(
    first.project.tickets.map(({ ticket }) => ticket),
    [1, 3],
  );
  const cursor = first.project.nextAfter;
  assert.equal(cursor, 3);
  assert.ok(cursor !== undefined);
  const last = await reads.project(partition, { after: cursor, limit: 2 });
  assert.equal(last.result, "Found");
  if (last.result !== "Found") return;
  assert.equal(last.project.sequence, 3);
  assert.deepEqual(last.project.tickets.map(dated), [
    {
      ticket: 8,
      phase: "Pending",
      sequence: 3,
      changedAt: seededEntryAt(3),
    },
  ]);
});

test("project reads page newest activity with a stable identity tie-breaker", async () => {
  const partition = await postgresHarnessProject(
    subject.harness.store,
    "native-recent",
  );
  await subject.harness.query(
    "UPDATE project SET head=9 WHERE tenant=$1 AND project=$2",
    [partition.tenant, partition.project],
  );
  for (const sequence of [2, 4, 9])
    await seedEntry(partition, `native-recent-${String(sequence)}`, sequence);
  for (const [ticket, sequence] of [
    [1, 4],
    [2, 9],
    [3, 9],
    [4, 2],
  ] as const) {
    await subject.harness.query(
      `INSERT INTO ticket_projection (tenant,project,ticket,phase,seq)
       VALUES ($1,$2,$3,'Pending',$4)`,
      [partition.tenant, partition.project, ticket, sequence],
    );
  }
  const reads = postgresNativeReads(subject.pool);
  const first = await reads.project(partition, {
    limit: 2,
    order: "RecentActivity",
  });
  assert.equal(first.result, "Found");
  if (first.result !== "Found") return;
  assert.deepEqual(
    first.project.tickets.map(({ ticket }) => ticket),
    [3, 2],
  );
  assert.deepEqual(first.project.nextRecentActivityAfter, {
    sequence: 9,
    ticket: 2,
  });
  const second = await reads.project(partition, {
    limit: 2,
    order: "RecentActivity",
    recentActivityAfter: first.project.nextRecentActivityAfter,
  });
  assert.equal(second.result, "Found");
  if (second.result !== "Found") return;
  assert.deepEqual(
    second.project.tickets.map(({ ticket }) => ticket),
    [1, 4],
  );
});

/**
 * A journal whose earliest entry naming this ticket is not the one that released
 * it. The machine cannot currently write that order — a release is the first
 * entry a ticket has — so nothing else in these suites separates "the earliest
 * entry naming the ticket" from "the entry that released it", and the read is
 * specified to be the second.
 */
test("an earlier entry naming the ticket is not mistaken for its release", async () => {
  const partition = await postgresHarnessProject(
    subject.harness.store,
    "native-release-kind",
  );
  await subject.harness.query(
    "UPDATE project SET head=2 WHERE tenant=$1 AND project=$2",
    [partition.tenant, partition.project],
  );
  await seedEntry(
    partition,
    "native-release-kind-done",
    1,
    seededEvent("TaskDone", 5),
  );
  await seedEntry(
    partition,
    "native-release-kind-release",
    2,
    seededEvent("ReleaseTicket", 5),
  );
  await subject.harness.query(
    `INSERT INTO ticket_projection (tenant,project,ticket,phase,seq)
     VALUES ($1,$2,5,'Pending',2)`,
    [partition.tenant, partition.project],
  );
  const released = await postgresNativeReads(subject.pool).ticket(
    partition,
    id(5),
  );
  assert.equal(
    Date.parse(released?.releasedAt ?? ""),
    seededEntryAt(2),
    "the release instant is the release entry's, not the earlier entry's",
  );
});

test("project reads filter before paging and expose one ticket detail", async () => {
  const partition = await filterProject();
  await seedFilterProjection(partition);
  const reads = postgresNativeReads(subject.pool);
  const nonTerminal = await reads.project(partition, {
    limit: 1,
    phaseFilter: { selection: "NonTerminal" },
  });
  assert.equal(nonTerminal.result, "Found");
  if (nonTerminal.result !== "Found") return;
  assert.deepEqual(nonTerminal.project.tickets.map(dated), [
    { ticket: 2, phase: "Pending", sequence: 2, changedAt: seededEntryAt(2) },
  ]);
  assert.equal(nonTerminal.project.nextAfter, 2);
  const parked = await reads.project(partition, {
    after: nonTerminal.project.nextAfter,
    limit: 2,
    phaseFilter: { selection: "NonTerminal" },
  });
  assert.equal(parked.result, "Found");
  if (parked.result !== "Found") return;
  assert.equal(parked.project.sequence, 4);
  assert.deepEqual(parked.project.tickets.map(dated), [
    {
      ticket: 4,
      phase: "Escalated",
      sequence: 4,
      reason: "GasExhausted",
      changedAt: seededEntryAt(4),
    },
  ]);
  const terminal = await reads.project(partition, {
    limit: 10,
    phaseFilter: { selection: "Selected", phases: ["Done", "Revoked"] },
  });
  assert.equal(terminal.result, "Found");
  if (terminal.result !== "Found") return;
  assert.deepEqual(terminal.project.tickets.map(dated), [
    { ticket: 1, phase: "Done", sequence: 1, changedAt: seededEntryAt(1) },
    { ticket: 3, phase: "Revoked", sequence: 3, changedAt: seededEntryAt(3) },
  ]);
  const own = await reads.ticket(partition, id(4));
  assert.ok(own !== undefined);
  assert.deepEqual(dated(own), {
    ticket: 4,
    phase: "Escalated",
    sequence: 4,
    reason: "GasExhausted",
    changedAt: seededEntryAt(4),
  });
  assert.equal(await reads.ticket(partition, id(9)), undefined);
});

test("a ticket's open action carries its kind, its fence, and what it offered", async () => {
  const partition = await postgresHarnessProject(
    subject.harness.store,
    "native-actions",
  );
  await seedOpenAction(
    subject.harness,
    partition,
    "native-actions-escalation",
    {
      ticket: 1,
      sequence: 1,
      kind: "TicketEscalation",
      reason: "WorkFailed",
      offers: ["Resume", "Revoke"],
    },
  );
  await seedOpenAction(subject.harness, partition, "native-actions-handoff", {
    ticket: 2,
    sequence: 2,
    kind: "HandoffBlock",
    reason: "NoReason",
    offers: ["RetryHandoff", "AbandonHandoff"],
  });
  const reads = postgresNativeReads(subject.pool);
  assert.deepEqual(await reads.ticketNativeActions(partition, id(1)), [
    {
      action: "native-actions-escalation",
      kind: "TicketEscalation",
      authorizingSequence: 1,
      admits: ["Resume", "Revoke"],
    },
  ]);
  assert.deepEqual(await reads.ticketNativeActions(partition, id(2)), [
    {
      action: "native-actions-handoff",
      kind: "HandoffBlock",
      authorizingSequence: 2,
      admits: ["RetryHandoff", "AbandonHandoff"],
    },
  ]);
});

test("an escalation offers what it recorded, not what its kind may ask for", async () => {
  const partition = await postgresHarnessProject(
    subject.harness.store,
    "native-actions-revoke-only",
  );
  await seedOpenAction(
    subject.harness,
    partition,
    "native-actions-unresumable",
    {
      ticket: 1,
      sequence: 1,
      kind: "TicketEscalation",
      reason: "DependencyRevoked",
      offers: ["Revoke"],
    },
  );
  assert.deepEqual(
    await postgresNativeReads(subject.pool).ticketNativeActions(
      partition,
      id(1),
    ),
    [
      {
        action: "native-actions-unresumable",
        kind: "TicketEscalation",
        authorizingSequence: 1,
        admits: ["Revoke"],
      },
    ],
  );
});

test("a handoff hold offers what it recorded, not what its kind may ask for", async () => {
  const partition = await postgresHarnessProject(
    subject.harness.store,
    "native-actions-abandon-only",
  );
  await seedOpenAction(
    subject.harness,
    partition,
    "native-actions-unrepublishable",
    {
      ticket: 1,
      sequence: 1,
      kind: "HandoffBlock",
      reason: "NoReason",
      offers: ["AbandonHandoff"],
    },
  );
  assert.deepEqual(
    await postgresNativeReads(subject.pool).ticketNativeActions(
      partition,
      id(1),
    ),
    [
      {
        action: "native-actions-unrepublishable",
        kind: "HandoffBlock",
        authorizingSequence: 1,
        admits: ["AbandonHandoff"],
      },
    ],
  );
});

test("a resolved action stops listing, and an unknown ticket is not found", async () => {
  const partition = await postgresHarnessProject(
    subject.harness.store,
    "native-actions-settled",
  );
  const action = await seedOpenAction(
    subject.harness,
    partition,
    "native-actions-answered",
    {
      ticket: 1,
      sequence: 1,
      kind: "TicketEscalation",
      reason: "WorkFailed",
      offers: ["Resume", "Revoke"],
    },
  );
  await subject.harness.query(
    `INSERT INTO ticket_projection (tenant,project,ticket,phase,seq)
     VALUES ($1,$2,2,'Working',1)`,
    [partition.tenant, partition.project],
  );
  const reads = postgresNativeReads(subject.pool);
  assert.deepEqual(await reads.ticketNativeActions(partition, id(2)), []);
  assert.equal(await reads.ticketNativeActions(partition, id(9)), undefined);
  await subject.harness.query(
    `UPDATE native_action SET state='Resolved', resolution='Resume'
      WHERE tenant=$1 AND project=$2 AND action=$3`,
    [partition.tenant, partition.project, action],
  );
  assert.deepEqual(await reads.ticketNativeActions(partition, id(1)), []);
});

test("a project's open actions list newest first and page behind their bound", async () => {
  const partition = await postgresHarnessProject(
    subject.harness.store,
    "native-actions-project",
  );
  for (const ticket of [1, 2, 3])
    await seedOpenAction(
      subject.harness,
      partition,
      `native-actions-project-${ticket}`,
      {
        ticket,
        sequence: ticket,
        kind: ticket === 2 ? "HandoffBlock" : "TicketEscalation",
        reason: ticket === 2 ? "NoReason" : "WorkFailed",
        offers:
          ticket === 2
            ? ["RetryHandoff", "AbandonHandoff"]
            : ["Resume", "Revoke"],
      },
    );
  const reads = postgresNativeReads(subject.pool);
  const first = await reads.nativeActions(partition, { limit: 2 });
  assert.deepEqual(
    first.actions.map(({ ticket, kind }) => [ticket, kind]),
    [
      [3, "TicketEscalation"],
      [2, "HandoffBlock"],
    ],
  );
  assert.deepEqual(first.nextAfter, {
    authorizingSequence: 2,
    action: "native-actions-project-2",
  });
  const next = await reads.nativeActions(partition, {
    after: first.nextAfter,
    limit: 2,
  });
  assert.deepEqual(next.actions, [
    {
      ticket: 1,
      action: "native-actions-project-1",
      kind: "TicketEscalation",
      authorizingSequence: 1,
      admits: ["Resume", "Revoke"],
    },
  ]);
  assert.equal(next.nextAfter, undefined);
  await subject.harness.query(
    `UPDATE native_action SET state='Resolved', resolution='Revoke'
      WHERE tenant=$1 AND project=$2 AND action=$3`,
    [partition.tenant, partition.project, "native-actions-project-3"],
  );
  assert.deepEqual(
    (await reads.nativeActions(partition, { limit: 10 })).actions.map(
      ({ ticket }) => ticket,
    ),
    [2, 1],
  );
});

test("a project's open actions are its own, and an empty project lists none", async () => {
  const mine = await postgresHarnessProject(
    subject.harness.store,
    "native-actions-mine",
  );
  const other = await postgresHarnessProject(
    subject.harness.store,
    "native-actions-other",
  );
  await seedOpenAction(subject.harness, mine, "native-actions-mine-one", {
    ticket: 1,
    sequence: 1,
    kind: "TicketEscalation",
    reason: "WorkFailed",
    offers: ["Resume", "Revoke"],
  });
  const reads = postgresNativeReads(subject.pool);
  assert.deepEqual(
    (await reads.nativeActions(mine, { limit: 10 })).actions.map(
      ({ action }) => action,
    ),
    ["native-actions-mine-one"],
  );
  assert.deepEqual(await reads.nativeActions(other, { limit: 10 }), {
    actions: [],
  });
});

test("a stored answer the kind cannot ask for stops both reads", async () => {
  const partition = await postgresHarnessProject(
    subject.harness.store,
    "native-actions-pairing",
  );
  const action = await seedOpenAction(
    subject.harness,
    partition,
    "native-actions-paired",
    {
      ticket: 1,
      sequence: 1,
      kind: "TicketEscalation",
      reason: "WorkFailed",
      offers: ["Resume", "Revoke"],
    },
  );
  /**
   * Migration 013's trigger is what makes an escalation offering `Approve`
   * unwritable, so planting one means standing it down for the insert. The
   * read's own raise is what this case is about.
   */
  await subject.harness.query(
    "ALTER TABLE native_action_resolution DISABLE TRIGGER USER",
  );
  await subject.harness.query(
    `INSERT INTO native_action_resolution (tenant,project,action,resolution)
     VALUES ($1,$2,$3,'Approve')`,
    [partition.tenant, partition.project, action],
  );
  await subject.harness.query(
    "ALTER TABLE native_action_resolution ENABLE TRIGGER USER",
  );
  const reads = postgresNativeReads(subject.pool);
  await assert.rejects(
    () => reads.ticketNativeActions(partition, id(1)),
    /cannot ask for/u,
  );
  await assert.rejects(
    () => reads.nativeActions(partition, { limit: 10 }),
    /cannot ask for/u,
  );
});

test("the fence the read publishes is the one acceptance admits", async () => {
  const partition = await postgresHarnessProject(
    subject.harness.store,
    "native-actions-fence",
  );
  await seedOpenAction(subject.harness, partition, "native-actions-fenced", {
    ticket: 1,
    sequence: 1,
    kind: "TicketEscalation",
    reason: "WorkFailed",
    offers: ["Resume", "Revoke"],
  });
  const listed = (
    await postgresNativeReads(subject.pool).ticketNativeActions(
      partition,
      id(1),
    )
  )?.[0];
  assert.ok(listed !== undefined);
  const resolution = listed.admits[0];
  assert.ok(resolution !== undefined);
  const offer = async (label: string, authorizingSeq: number) =>
    (
      await subject.harness.inbox.accept({
        ...postgresHarnessSubmission(partition, label),
        command: {
          version: 1,
          command: "ResolveNativeAction",
          action: listed.action,
          authorizingSeq,
          resolution,
        },
      })
    ).accepted;
  assert.equal(
    await offer("fence-stale", listed.authorizingSequence + 1),
    "InvalidCommand",
  );
  assert.equal(
    await offer("fence-current", listed.authorizingSequence),
    "Accepted",
  );
});
