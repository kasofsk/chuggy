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
import { postgresReadHarness } from "./readHarness.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import type { NativeActionResolution } from "../../src/interpreter/ticketCommand.ts";
import { id } from "../domain/fixtures.ts";

const subject = postgresReadHarness();

async function filterProject() {
  return postgresHarnessProject(subject.harness.store, "native-filter");
}

/** One desk task to seed, at the journal sequence its answer has to name. */
interface SeededAction {
  readonly ticket: number;
  readonly sequence: number;
  readonly kind: "TicketEscalation" | "HandoffBlock";
  readonly reason: string;
  readonly offers: readonly NativeActionResolution[];
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
 * A desk task and the journal entry that authorized it, seeded through the real
 * chain: the action's fence is an entry, and that entry decided an accepted
 * operation, so nothing here holds because a constraint was skipped.
 */
async function seedOpenAction(
  partition: Partition,
  label: string,
  action: SeededAction,
): Promise<string> {
  const submission = postgresHarnessSubmission(partition, label);
  await subject.harness.inbox.accept(submission);
  const epoch = await currentEpoch();
  const seeding = await subject.harness.begin();
  await seeding.query(
    `UPDATE decision_input SET state='Journaled', decided_seq=$3, terminal_at=now()
      WHERE tenant=$1 AND project=$2 AND input_kind='Operation' AND input_id=$4`,
    [
      partition.tenant,
      partition.project,
      action.sequence,
      submission.operation,
    ],
  );
  await seeding.query(
    `INSERT INTO journal_entry
       (tenant,project,seq,entry,entry_digest,prev_digest,owner,fencing_epoch,
        recovery_epoch,cause_kind,cause_id)
     VALUES ($1,$2,$3,'{}',$4,'genesis','owner',1,$5,'Operation',$6)`,
    [
      partition.tenant,
      partition.project,
      action.sequence,
      `digest-${label}`,
      epoch,
      submission.operation,
    ],
  );
  await seeding.query(
    `INSERT INTO ticket_projection (tenant,project,ticket,phase,seq,reason)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      partition.tenant,
      partition.project,
      action.ticket,
      action.kind === "HandoffBlock" ? "HandoffBlocked" : "Escalated",
      action.sequence,
      action.reason,
    ],
  );
  await seeding.query(
    `INSERT INTO native_action
       (tenant,project,action,authorizing_seq,effect_position,ticket,
        action_version,kind,reason,required_capability)
     VALUES ($1,$2,$3,$4,0,$5,$4,$6,$7,'ResolveTicket')`,
    [
      partition.tenant,
      partition.project,
      label,
      action.sequence,
      action.ticket,
      action.kind,
      action.reason,
    ],
  );
  for (const offered of action.offers)
    await seeding.query(
      `INSERT INTO native_action_resolution (tenant,project,action,resolution)
       VALUES ($1,$2,$3,$4)`,
      [partition.tenant, partition.project, label, offered],
    );
  await seeding.commit();
  return label;
}

/** One ticket of each terminal shape, and one parked with the wall it hit. */
async function seedFilterProjection(partition: {
  tenant: string;
  project: string;
}) {
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
  assert.deepEqual(
    await reads.project(partition, { after: cursor, limit: 2 }),
    {
      result: "Found",
      project: {
        partition,
        sequence: 3,
        tickets: [{ ticket: 8, phase: "Pending", sequence: 3 }],
      },
    },
  );
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
  assert.deepEqual(nonTerminal.project.tickets, [
    { ticket: 2, phase: "Pending", sequence: 2 },
  ]);
  assert.equal(nonTerminal.project.nextAfter, 2);
  assert.deepEqual(
    await reads.project(partition, {
      after: nonTerminal.project.nextAfter,
      limit: 2,
      phaseFilter: { selection: "NonTerminal" },
    }),
    {
      result: "Found",
      project: {
        partition,
        sequence: 4,
        tickets: [
          {
            ticket: 4,
            phase: "Escalated",
            sequence: 4,
            reason: "GasExhausted",
          },
        ],
      },
    },
  );
  assert.deepEqual(
    await reads.project(partition, {
      limit: 10,
      phaseFilter: { selection: "Selected", phases: ["Done", "Revoked"] },
    }),
    {
      result: "Found",
      project: {
        partition,
        sequence: 4,
        tickets: [
          { ticket: 1, phase: "Done", sequence: 1 },
          { ticket: 3, phase: "Revoked", sequence: 3 },
        ],
      },
    },
  );
  assert.deepEqual(await reads.ticket(partition, id(4)), {
    ticket: 4,
    phase: "Escalated",
    sequence: 4,
    reason: "GasExhausted",
  });
  assert.equal(await reads.ticket(partition, id(9)), undefined);
});

/** A ticket's brief the way a raw insert reaches it: past the draft the
 * authoring writer would have opened, straight to the row a project listing
 * joins against. */
async function seedTicketBrief(
  partition: Partition,
  ticket: number,
  intent: string,
  links: readonly string[],
): Promise<void> {
  await subject.harness.query(
    `INSERT INTO configuration_revision (tenant,project,revision,canonical,digest,authority_kind,authority_subject)
     VALUES ($1,$2,$3,'{}','digest','User','author')`,
    [partition.tenant, partition.project, `revision-${String(ticket)}`],
  );
  await subject.harness.query(
    `INSERT INTO draft (tenant,project,ticket,authoring_version,state,configuration_revision)
     VALUES ($1,$2,$3,1,'Released',$4)`,
    [partition.tenant, partition.project, ticket, `revision-${String(ticket)}`],
  );
  await subject.harness.query(
    `INSERT INTO draft_brief (tenant,project,ticket,intent) VALUES ($1,$2,$3,$4)`,
    [partition.tenant, partition.project, ticket, intent],
  );
  for (const [index, url] of links.entries())
    await subject.harness.query(
      `INSERT INTO draft_brief_link (tenant,project,ticket,ordinal,url) VALUES ($1,$2,$3,$4,$5)`,
      [partition.tenant, partition.project, ticket, index + 1, url],
    );
}

test("a project listing carries each ticket's own brief, not only its single-ticket read", async () => {
  const partition = await postgresHarnessProject(
    subject.harness.store,
    "native-brief",
  );
  await subject.harness.query(
    "UPDATE project SET head=2 WHERE tenant=$1 AND project=$2",
    [partition.tenant, partition.project],
  );
  await seedTicketBrief(partition, 1, "Show a title on the project table.", [
    "https://example.test/one",
  ]);
  await subject.harness.query(
    `INSERT INTO ticket_projection (tenant,project,ticket,phase,seq) VALUES ($1,$2,1,'Pending',1)`,
    [partition.tenant, partition.project],
  );
  await subject.harness.query(
    `INSERT INTO ticket_projection (tenant,project,ticket,phase,seq) VALUES ($1,$2,2,'Pending',2)`,
    [partition.tenant, partition.project],
  );
  const reads = postgresNativeReads(subject.pool);
  const listed = await reads.project(partition, { limit: 10 });
  assert.equal(listed.result, "Found");
  if (listed.result !== "Found") return;
  assert.deepEqual(listed.project.tickets, [
    {
      ticket: 1,
      phase: "Pending",
      sequence: 1,
      brief: {
        intent: "Show a title on the project table.",
        links: ["https://example.test/one"],
      },
    },
    { ticket: 2, phase: "Pending", sequence: 2 },
  ]);
});

test("a ticket's open action carries its kind, its fence, and what it offered", async () => {
  const partition = await postgresHarnessProject(
    subject.harness.store,
    "native-actions",
  );
  await seedOpenAction(partition, "native-actions-escalation", {
    ticket: 1,
    sequence: 1,
    kind: "TicketEscalation",
    reason: "WorkFailed",
    offers: ["Resume", "Revoke"],
  });
  await seedOpenAction(partition, "native-actions-handoff", {
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
  await seedOpenAction(partition, "native-actions-unresumable", {
    ticket: 1,
    sequence: 1,
    kind: "TicketEscalation",
    reason: "DependencyRevoked",
    offers: ["Revoke"],
  });
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

test("a resolved action stops listing, and an unknown ticket is not found", async () => {
  const partition = await postgresHarnessProject(
    subject.harness.store,
    "native-actions-settled",
  );
  const action = await seedOpenAction(partition, "native-actions-answered", {
    ticket: 1,
    sequence: 1,
    kind: "TicketEscalation",
    reason: "WorkFailed",
    offers: ["Resume", "Revoke"],
  });
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
    await seedOpenAction(partition, `native-actions-project-${ticket}`, {
      ticket,
      sequence: ticket,
      kind: ticket === 2 ? "HandoffBlock" : "TicketEscalation",
      reason: ticket === 2 ? "NoReason" : "WorkFailed",
      offers:
        ticket === 2
          ? ["RetryHandoff", "AbandonHandoff"]
          : ["Resume", "Revoke"],
    });
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
  await seedOpenAction(mine, "native-actions-mine-one", {
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
  const action = await seedOpenAction(partition, "native-actions-paired", {
    ticket: 1,
    sequence: 1,
    kind: "TicketEscalation",
    reason: "WorkFailed",
    offers: ["Resume", "Revoke"],
  });
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
  await seedOpenAction(partition, "native-actions-fenced", {
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
