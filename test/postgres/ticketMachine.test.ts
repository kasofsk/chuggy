import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { postgresTicketMachine } from "../../src/adapters/postgres/ticketMachine.ts";
import { postgresTicketContent } from "../../src/adapters/postgres/ticketContent.ts";
import {
  apiRole,
  ticketServiceRole,
} from "../../src/adapters/postgres/schema/shared.ts";
import * as ticket from "../../src/domain/chuggernaut/ticket.js";
import { TicketId } from "../../src/domain/chuggernaut/task.js";
import { ticketMachineRunOnce } from "../../src/interpreter/ticketMachineRun.ts";
import { asOwnerId } from "../../src/interpreter/projectStore.ts";
import { ticketMachineProcess as processMachine } from "../../src/interpreter/ticketMachine.ts";
import {
  postgresTicketMachineInbox,
  postgresTicketMachineQueue,
} from "../../src/adapters/postgres/ticketMachineInbox.ts";
import { dispatch, released } from "../chuggernaut/domain/builders.js";
import {
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessHeld,
  postgresHarnessExpire,
  postgresHarnessRolePool,
  type PostgresHarness,
} from "./harness.ts";

const authorization = {
  principal: "test-author",
  authorizedOperation: "Mutate",
  authorityKind: "Member",
  authoritySubject: "test-author",
  policyRevision: "test-policy-v1",
};

let harness: PostgresHarness;
let writerPool: pg.Pool;
before(async () => {
  harness = await postgresHarnessOpen();
  writerPool = postgresHarnessRolePool(ticketServiceRole);
});
after(async () => {
  await writerPool.end();
  await harness.close();
});

async function held(label: string) {
  const partition = await postgresHarnessProject(harness.store, label);
  return postgresHarnessHeld(harness.store, partition, label);
}

async function ticketMachineProcess(
  ...args: Parameters<typeof processMachine>
) {
  await postgresTicketMachineInbox(writerPool).submit(
    args[1].partition,
    args[2],
  );
  return processMachine(...args);
}

test("accepted order includes refusals and immutable authorization", async () => {
  const lease = await held("ticket-machine-order");
  const store = postgresTicketMachine(writerPool);
  const inbox = postgresTicketMachineInbox(writerPool);
  const first = {
    identity: "missing",
    origin: "Author" as const,
    authorization,
    command: dispatch(1),
  };
  const second = {
    identity: "create",
    origin: "Author" as const,
    authorization,
    command: new ticket.CreateTicket(released(1)),
  };
  assert.equal(
    (await inbox.submit(lease.partition, first)).accepted,
    "Accepted",
  );
  assert.equal(
    (await inbox.submit(lease.partition, second)).accepted,
    "Accepted",
  );
  assert.equal(
    (await processMachine(store, lease, second, ticket.rework_policy))
      .processed,
    "NotNext",
  );
  const refused = await processMachine(
    store,
    lease,
    first,
    ticket.rework_policy,
  );
  assert.equal(refused.processed, "Committed");
  if (refused.processed !== "Committed")
    throw new Error("expected committed refusal");
  assert.equal(refused.outcome.sequence, 1);
  assert.equal(refused.outcome.decision.kind, "TicketRefused");
  assert.equal(
    (await postgresTicketMachineQueue(writerPool).next(lease))?.identity,
    "create",
  );
  const created = await processMachine(
    store,
    lease,
    second,
    ticket.rework_policy,
  );
  if (created.processed !== "Committed") throw new Error("expected creation");
  assert.equal(created.outcome.sequence, 2);
  for (const changed of [
    { ...authorization, principal: "someone-else" },
    { ...authorization, policyRevision: "test-policy-v2" },
  ])
    assert.equal(
      (
        await inbox.submit(lease.partition, {
          ...second,
          authorization: changed,
        })
      ).accepted,
      "InputConflict",
    );
  assert.ok((await store.read(lease.partition)) instanceof ticket.TicketGraph);
});

test("racing duplicates append once and survive a new store instance", async () => {
  const lease = await held("ticket-machine-duplicate");
  const store = postgresTicketMachine(writerPool);
  const input = {
    identity: "create",
    origin: "Author" as const,
    authorization,
    command: new ticket.CreateTicket(released(1)),
  };
  const outcomes = await Promise.all([
    ticketMachineProcess(store, lease, input, ticket.rework_policy),
    ticketMachineProcess(store, lease, input, ticket.rework_policy),
  ]);
  assert.deepEqual(outcomes.map((outcome) => outcome.processed).sort(), [
    "AlreadyCommitted",
    "Committed",
  ]);
  const recovered = await postgresTicketMachine(writerPool).read(
    lease.partition,
  );
  assert.ok(recovered instanceof ticket.TicketGraph);
  assert.equal(recovered.tickets.size, 1);
  const conflict = await ticketMachineProcess(
    store,
    lease,
    { ...input, command: new ticket.CreateTicket(released(2)) },
    ticket.rework_policy,
  );
  assert.equal(conflict.processed, "InputConflict");
});

test("dispatch commits its task obligation with its event", async () => {
  const lease = await held("ticket-machine-outbox");
  const store = postgresTicketMachine(writerPool);
  await ticketMachineProcess(
    store,
    lease,
    {
      identity: "create",
      origin: "Author",
      authorization,
      command: new ticket.CreateTicket(released(1)),
    },
    ticket.rework_policy,
  );
  await ticketMachineProcess(
    store,
    lease,
    {
      identity: "dispatch",
      origin: "Author",
      authorization,
      command: dispatch(1),
    },
    ticket.rework_policy,
  );
  const pending = await store.pending(lease.partition, 10);
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.obligation.kind, "ExecuteTask");
  assert.equal(pending[0]?.identity, "2:0");
  await store.delivered(lease.partition, "2:0");
  assert.deepEqual(await store.pending(lease.partition, 10), []);
});

test("superseded owner cannot decide against the new graph", async () => {
  const former = await held("ticket-machine-fence");
  await postgresHarnessExpire(harness, former.partition);
  const current = await postgresHarnessHeld(
    harness.store,
    former.partition,
    "replacement",
  );
  const store = postgresTicketMachine(writerPool);
  const input = {
    identity: "create",
    origin: "Author" as const,
    authorization,
    command: new ticket.CreateTicket(released(1)),
  };
  assert.equal(
    (await ticketMachineProcess(store, former, input, ticket.rework_policy))
      .processed,
    "Fenced",
  );
  assert.equal(
    (await ticketMachineProcess(store, current, input, ticket.rework_policy))
      .processed,
    "Committed",
  );
});

test("legacy projects refuse reads and lifecycle decisions without changing history", async () => {
  const lease = await held("ticket-machine-legacy");
  await harness.query(
    "UPDATE project SET ticket_model='Legacy' WHERE tenant=$1 AND project=$2",
    [lease.partition.tenant, lease.partition.project],
  );
  const store = postgresTicketMachine(writerPool);
  assert.equal(await store.read(lease.partition), "LegacyModelUnsupported");
  const outcome = await ticketMachineProcess(
    store,
    lease,
    {
      identity: "create",
      origin: "Author",
      authorization,
      command: new ticket.CreateTicket(released(1)),
    },
    ticket.rework_policy,
  );
  assert.equal(outcome.processed, "LegacyModelUnsupported");
  assert.deepEqual(await store.pending(lease.partition, 10), []);
});

test("revocation affects only the named ticket", async () => {
  const lease = await held("ticket-machine-revoke");
  const store = postgresTicketMachine(writerPool);
  const commands = [
    new ticket.CreateTicket(released(1)),
    new ticket.CreateTicket(released(2, new Set([TicketId(1)]))),
    new ticket.RevokeTicket(TicketId(1)),
  ];
  for (const [index, command] of commands.entries()) {
    await ticketMachineProcess(
      store,
      lease,
      { identity: String(index), origin: "Author", authorization, command },
      ticket.rework_policy,
    );
  }
  const graph = await store.read(lease.partition);
  assert.ok(graph instanceof ticket.TicketGraph);
  assert.equal(graph.tickets.get(TicketId(1))?.state.kind, "Revoked");
  assert.equal(graph.tickets.get(TicketId(2))?.state.kind, "Pending");
});

test("ticket writer cannot rewrite or delete accepted history", async () => {
  for (const relation of ["ticket_machine_event", "ticket_machine_input"]) {
    const changed = await harness.attemptAs(
      ticketServiceRole,
      `UPDATE ${relation} SET sequence=sequence`,
    );
    const removed = await harness.attemptAs(
      ticketServiceRole,
      `DELETE FROM ${relation}`,
    );
    assert.match(changed ?? "", /permission denied/);
    assert.match(removed ?? "", /permission denied/);
  }
});

test("content references deduplicate concurrent writes and cannot cross projects", async () => {
  const first = await held("ticket-content-first");
  const second = await held("ticket-content-second");
  const content = postgresTicketContent(writerPool, first.partition);
  const other = postgresTicketContent(writerPool, second.partition);
  const [one, two] = await Promise.all([
    content.put("application/json", '{"kind":"workload"}'),
    content.put("application/json", '{"kind":"workload"}'),
  ]);
  assert.equal(one, two);
  assert.deepEqual(await content.read(one), {
    mediaType: "application/json",
    content: '{"kind":"workload"}',
  });
  assert.equal(await other.read(one), undefined);
  assert.notEqual(await content.put("text/plain", '{"kind":"workload"}'), one);
  assert.match(
    (await harness.attemptAs(
      ticketServiceRole,
      "UPDATE ticket_machine_content SET content='changed'",
    )) ?? "",
    /permission denied/,
  );
});

test("runtime drains ordered inputs and retries the same durable obligation", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "ticket-machine-runtime",
  );
  const inbox = postgresTicketMachineInbox(writerPool);
  const store = postgresTicketMachine(writerPool);
  for (const [identity, command] of [
    ["create", new ticket.CreateTicket(released(1))],
    ["dispatch", dispatch(1)],
  ] as const) {
    assert.equal(
      (
        await inbox.submit(partition, {
          identity,
          origin: "Author",
          authorization,
          command,
        })
      ).accepted,
      "Accepted",
    );
  }
  const deliveries: string[] = [];
  let available = false;
  const runtime = {
    projects: harness.store,
    store,
    inbox,
    queue: postgresTicketMachineQueue(writerPool),
    owner: asOwnerId("adopted-runtime"),
    effects: {
      execute: (_partition: unknown, identity: string) => {
        deliveries.push(identity);
        return Promise.resolve(available);
      },
      cancel: () => Promise.resolve(true),
      finalize: () => Promise.resolve(true),
    },
  };
  const config = {
    projectsPerPassMax: 1000,
    inputsPerProjectMax: 32,
    obligationsPerProjectMax: 1000,
    leaseSeconds: 30,
  };
  const first = await ticketMachineRunOnce(runtime, config);
  assert.deepEqual(first.failures, []);
  assert.equal((await inbox.outcome(partition, "dispatch"))?.sequence, 2);
  assert.equal((await store.pending(partition, 10)).length, 1);
  const delivery = deliveries.at(-1);
  available = true;
  const second = await ticketMachineRunOnce(runtime, config);
  assert.deepEqual(second.failures, []);
  assert.equal(deliveries.at(-1), delivery);
  assert.equal((await store.pending(partition, 10)).length, 0);
});

test("definition revisions retain the released rework policy", async () => {
  const lease = await held("ticket-machine-release-policy");
  const store = postgresTicketMachine(writerPool);
  const initial = {
    stageNames: [[1, "check"]] as const,
    evaluatorNames: [[1, "test"]] as const,
    reworkLimit: 3,
  };
  await ticketMachineProcess(
    store,
    lease,
    {
      identity: "create",
      origin: "Author",
      authorization,
      command: new ticket.CreateTicket(released(1)),
      metadata: initial,
    },
    ticket.rework_policy,
  );
  const result = await ticketMachineProcess(
    store,
    lease,
    {
      identity: "update",
      origin: "Author",
      authorization,
      command: new ticket.UpdateTicket(
        TicketId(1),
        1,
        released(1, new Set(), true),
      ),
      metadata: { ...initial, reworkLimit: 100, stageNames: [[1, "revised"]] },
    },
    ticket.rework_policy,
  );
  assert.equal(result.processed, "Committed");
  const metadata = await postgresTicketMachineInbox(writerPool).releaseMetadata(
    lease.partition,
    TicketId(1),
  );
  assert.equal(metadata?.reworkLimit, 3);
  assert.deepEqual(metadata?.stageNames, [[1, "revised"]]);
});

test("API credentials can read adopted graphs without writer authority", async () => {
  const lease = await held("ticket-machine-api-read");
  await ticketMachineProcess(
    postgresTicketMachine(writerPool),
    lease,
    {
      identity: "create",
      origin: "Author",
      authorization,
      command: new ticket.CreateTicket(released(1)),
    },
    ticket.rework_policy,
  );
  const api = postgresHarnessRolePool(apiRole);
  try {
    const graph = await postgresTicketMachine(api).read(lease.partition);
    assert.ok(graph instanceof ticket.TicketGraph);
    assert.equal(graph.tickets.size, 1);
  } finally {
    await api.end();
  }
});
