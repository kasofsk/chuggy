import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";

import { postgresTicketFinalizer } from "../../src/adapters/postgres/ticketFinalizer.ts";
import { postgresTicketContent } from "../../src/adapters/postgres/ticketContent.ts";
import {
  finalizerRole,
  ticketServiceRole,
} from "../../src/adapters/postgres/schema/shared.ts";
import * as ticket from "../../src/domain/chuggernaut/ticket.js";
import {
  ContentRef,
  CycleNumber,
  Generation,
  TicketId,
} from "../../src/domain/chuggernaut/task.js";
import { source } from "../chuggernaut/domain/builders.js";
import {
  postgresHarnessOpen,
  postgresHarnessNewEpoch,
  postgresHarnessProject,
  postgresHarnessRolePool,
  type PostgresHarness,
} from "./harness.ts";

let harness: PostgresHarness;
let finalizerPool: pg.Pool;
let ticketServicePool: pg.Pool;

before(async () => {
  harness = await postgresHarnessOpen();
  finalizerPool = postgresHarnessRolePool(finalizerRole);
  ticketServicePool = postgresHarnessRolePool(ticketServiceRole);
});

test("a recovery epoch change fences a live claim", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "ticket-finalizer-epoch",
  );
  const store = postgresTicketFinalizer(finalizerPool);
  const recoveryEpoch = await harness.store.currentRecoveryEpoch();
  const obligation = new ticket.FinalizeTicket(
    TicketId(1),
    new ticket.FinalizationOperation(
      CycleNumber(1),
      Generation(1),
      ContentRef(2),
      source(3),
    ),
    ContentRef(4),
  );
  await postgresTicketFinalizer(ticketServicePool).register(
    partition,
    "delivery",
    obligation,
  );
  assert.equal(
    await store.claim("stale-owner", 30_000, postgresHarnessNewEpoch()),
    undefined,
  );
  const claim = await store.claim("owner-a", 30_000, recoveryEpoch);
  assert.ok(claim);
  await harness.store.establishRecoveryEpoch(postgresHarnessNewEpoch());
  assert.equal(
    await store.publication(claim, { publication: "Idle", creations: 0 }),
    false,
  );
  await store.release(claim);
  await harness.store.fence(partition, "Suspended");
});

after(async () => {
  await finalizerPool.end();
  await ticketServicePool.end();
  await harness.close();
});

test("an unanswered remote mutation survives lease release and is reclaimed for reconciliation", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "ticket-finalizer-reconcile",
  );
  const store = postgresTicketFinalizer(finalizerPool);
  const recoveryEpoch = await harness.store.currentRecoveryEpoch();
  const obligation = new ticket.FinalizeTicket(
    TicketId(1),
    new ticket.FinalizationOperation(
      CycleNumber(1),
      Generation(1),
      ContentRef(2),
      source(3),
    ),
    ContentRef(4),
  );
  const delivery = postgresTicketFinalizer(ticketServicePool);
  assert.equal(
    await delivery.register(partition, "delivery", obligation),
    true,
  );
  assert.equal(
    await delivery.register(partition, "delivery", obligation),
    true,
  );
  const first = await store.claim("owner-a", 30_000, recoveryEpoch);
  assert.ok(first);
  assert.equal(
    await store.publication(first, {
      publication: "Unanswered",
      creations: 1,
      reconciliations: 0,
    }),
    true,
  );
  await store.release(first);
  const recovered = await store.claim("owner-b", 30_000, recoveryEpoch);
  assert.ok(recovered);
  assert.equal(recovered.generation, first.generation + 1);
  assert.deepEqual(recovered.publication, {
    publication: "Unanswered",
    creations: 1,
    reconciliations: 0,
  });
  assert.equal(
    await store.publication(first, { publication: "Idle", creations: 1 }),
    false,
  );
  const evidence = await postgresTicketContent(finalizerPool, partition).put(
    "application/json",
    '{"status":"Open"}',
  );
  assert.equal(await store.complete(recovered, "Succeeded", evidence), true);
  await store.release(recovered);
  const terminal = await store.claim("owner-c", 30_000, recoveryEpoch);
  assert.ok(terminal);
  assert.deepEqual(terminal.completion, { outcome: "Succeeded", evidence });
  await store.release(terminal);
});

test("the finalizer cannot fabricate or rewrite a finalization obligation", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "ticket-finalizer-authority",
  );
  const obligation = new ticket.FinalizeTicket(
    TicketId(1),
    new ticket.FinalizationOperation(
      CycleNumber(1),
      Generation(1),
      ContentRef(2),
      source(3),
    ),
    ContentRef(4),
  );
  await assert.rejects(
    postgresTicketFinalizer(finalizerPool).register(
      partition,
      "fabricated",
      obligation,
    ),
    /permission denied for table ticket_machine_finalization/u,
  );
  assert.equal(
    await postgresTicketFinalizer(ticketServicePool).register(
      partition,
      "delivery",
      obligation,
    ),
    true,
  );
  await assert.rejects(
    finalizerPool.query(
      "UPDATE ticket_machine_finalization SET obligation='forged' WHERE tenant=$1 AND project=$2 AND identity='delivery'",
      [partition.tenant, partition.project],
    ),
    /permission denied for table ticket_machine_finalization/u,
  );
});
