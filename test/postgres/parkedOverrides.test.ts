/**
 * A parked ticket's overrides changed through the deciding transaction,
 * against a real PostgreSQL: what it admits, what it refuses, and that a
 * refusal stores nothing.
 *
 * THE TICKET IS PARKED BY THE MACHINE. Its work fails through a completion the
 * way the scheduler's boundary writes one, so the escalation a change is
 * fenced to is the one a real park opens. The phases no change may land in are
 * reached by moving the projection under that open escalation, which is the
 * one thing the fence reads that the action does not.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { reportTaskTerminalCommand } from "../../src/actor/command.ts";
import { postgresNativeReads } from "../../src/adapters/postgres/nativeReads.ts";
import { apiRole } from "../../src/adapters/postgres/schema.ts";
import type { ConfigurationOverrides } from "../../src/contract/configurationOverrides.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import type { Phase } from "../../src/domain/phase.ts";
import { workTaskIdentity } from "../../src/domain/task.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import type { ProjectMemory } from "../../src/interpreter/projectWriter.ts";
import {
  postgresHarnessCompletion,
  postgresHarnessDrain,
  postgresHarnessHistory,
  postgresHarnessJournal,
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessReport,
  postgresHarnessRolePool,
  postgresHarnessSubmission,
  type PostgresHarness,
} from "./harness.ts";

let harness: PostgresHarness;
const apiPool = postgresHarnessRolePool(apiRole);
before(async () => {
  harness = await postgresHarnessOpen();
});
after(async () => {
  await apiPool.end();
  await harness.close();
});

/** A parked ticket, with the escalation a change names and the state its writer holds. */
interface Parked {
  readonly partition: Partition;
  readonly memory: ProjectMemory;
  readonly action: string;
  readonly authorizingSeq: number;
}

/** One ticket released, dispatched, and parked at its first work's failure. */
async function parked(label: string): Promise<Parked> {
  const partition = await postgresHarnessProject(harness.store, label);
  const released = await postgresHarnessHistory(
    harness,
    partition,
    label,
    postgresHarnessJournal().length,
  );
  await postgresHarnessCompletion(
    harness,
    partition,
    `operation-${label}-${randomUUID()}`,
    reportTaskTerminalCommand(
      postgresHarnessReport(released.graph, workTaskIdentity(1, 1), "Fail"),
    ),
  );
  const drained = await postgresHarnessDrain(harness, partition, released);
  const [open] = await harness.query(
    `SELECT action,authorizing_seq::text AS seq FROM native_action
      WHERE tenant=$1 AND project=$2 AND state='Open'
        AND escalation='WorkFailureEscalated'`,
    [partition.tenant, partition.project],
  );
  assert.ok(open !== undefined);
  return {
    partition,
    memory: drained.memory,
    action: String(open["action"]),
    authorizingSeq: Number(open["seq"]),
  };
}

/** What a change may move and a refusal must leave: the ticket's rows and its journal. */
async function standing(partition: Partition): Promise<unknown> {
  const parameters = [partition.tenant, partition.project];
  return {
    definition: await harness.query(
      "SELECT definition,digest,overrides FROM ticket_definition WHERE tenant=$1 AND project=$2",
      parameters,
    ),
    projection: await harness.query(
      "SELECT phase,escalation,seq FROM ticket_projection WHERE tenant=$1 AND project=$2",
      parameters,
    ),
    journal: await harness.query(
      "SELECT seq FROM journal_entry WHERE tenant=$1 AND project=$2 ORDER BY seq",
      parameters,
    ),
    actions: await harness.query(
      "SELECT action,state FROM native_action WHERE tenant=$1 AND project=$2 ORDER BY action",
      parameters,
    ),
  };
}

/** Offers one change at a fence and answers how its operation settled. */
async function changed(
  ticket: Parked,
  overrides: ConfigurationOverrides,
  fence: { readonly action: string; readonly authorizingSeq: number } = ticket,
): Promise<{ readonly decided: readonly string[]; readonly code: unknown }> {
  const submission = postgresHarnessSubmission(ticket.partition, "parked");
  const accepted = await harness.inbox.accept({
    ...submission,
    command: {
      version: 1,
      command: "ChangeTicketOverrides",
      ticket: asTicketId(1),
      action: fence.action,
      authorizingSeq: fence.authorizingSeq,
      overrides,
    },
  });
  assert.equal(accepted.accepted, "Accepted");
  const drained = await postgresHarnessDrain(
    harness,
    ticket.partition,
    ticket.memory,
  );
  const [settled] = await harness.query(
    `SELECT state,outcome_code FROM decision_input
      WHERE tenant=$1 AND project=$2 AND input_id=$3`,
    [ticket.partition.tenant, ticket.partition.project, submission.operation],
  );
  return { decided: drained.decided, code: settled?.["outcome_code"] };
}

const anotherModel: ConfigurationOverrides = {
  worker: {
    mode: {
      type: "SingleAgent",
      agent: "Claude",
      arguments: ["--model=another-model"],
    },
  },
};

test("a model change is stored, settles answered, and leaves the escalation open and the journal as it was", async () => {
  const ticket = await parked("parked-admitted");
  const before = (await standing(ticket.partition)) as {
    readonly journal: unknown;
    readonly actions: unknown;
    readonly projection: unknown;
  };
  assert.deepEqual(await changed(ticket, anotherModel), {
    decided: ["Answered"],
    code: null,
  });
  const after = (await standing(ticket.partition)) as typeof before & {
    readonly definition: readonly Record<string, unknown>[];
  };
  assert.deepEqual(after.journal, before.journal);
  assert.deepEqual(after.actions, before.actions);
  assert.deepEqual(after.projection, before.projection);
  assert.deepEqual(after.definition[0]?.["overrides"], anotherModel);
  const read = await postgresNativeReads(apiPool).ticket(
    ticket.partition,
    asTicketId(1),
  );
  assert.deepEqual(read?.overrides, anotherModel);
});

test("a change of the work instructions is refused, and the ticket stays parked holding what it held", async () => {
  const ticket = await parked("parked-instructions");
  const before = await standing(ticket.partition);
  assert.deepEqual(
    await changed(ticket, { work: { instructions: ["Do other work."] } }),
    { decided: ["Refused"], code: "DefinitionLocked" },
  );
  assert.deepEqual(await standing(ticket.partition), before);
});

test("a change whose effective configuration is not ready is refused as a release refuses it", async () => {
  const ticket = await parked("parked-unready");
  const before = await standing(ticket.partition);
  assert.deepEqual(await changed(ticket, { practices: ["NotAPractice"] }), {
    decided: ["Refused"],
    code: "ConfigurationInvalid",
  });
  assert.deepEqual(await standing(ticket.partition), before);
});

test("a change is refused, and stores nothing, for a ticket in any phase but parked", async () => {
  const phases: readonly Phase[] = [
    "Pending",
    "Work",
    "Evaluation",
    "Finalization",
    "Done",
    "Revoked",
  ];
  for (const phase of phases) {
    const ticket = await parked(`parked-${phase.toLowerCase()}`);
    await harness.query(
      `UPDATE ticket_projection SET phase=$3, escalation='NoEscalation'
        WHERE tenant=$1 AND project=$2`,
      [ticket.partition.tenant, ticket.partition.project, phase],
    );
    const before = await standing(ticket.partition);
    assert.deepEqual(
      await changed(ticket, anotherModel),
      { decided: ["Refused"], code: "TicketChanged" },
      phase,
    );
    assert.deepEqual(await standing(ticket.partition), before, phase);
  }
});

test("a change typed against an escalation since answered is refused, and stores nothing", async () => {
  const ticket = await parked("parked-answered");
  const accepted = await harness.inbox.accept({
    ...postgresHarnessSubmission(ticket.partition, "parked-resume"),
    command: {
      version: 1,
      command: "ResolveNativeAction",
      action: ticket.action,
      authorizingSeq: ticket.authorizingSeq,
      resolution: "Resume",
    },
  });
  assert.equal(accepted.accepted, "Accepted");
  const resumed = await postgresHarnessDrain(
    harness,
    ticket.partition,
    ticket.memory,
  );
  assert.deepEqual(resumed.decided, ["Committed"]);
  const before = await standing(ticket.partition);
  assert.deepEqual(
    await changed({ ...ticket, memory: resumed.memory }, anotherModel),
    { decided: ["Refused"], code: "TicketChanged" },
  );
  assert.deepEqual(await standing(ticket.partition), before);
});

test("a change naming another escalation than the open one is refused", async () => {
  const ticket = await parked("parked-fence");
  assert.deepEqual(
    await changed(ticket, anotherModel, {
      action: ticket.action,
      authorizingSeq: ticket.authorizingSeq + 1,
    }),
    { decided: ["Refused"], code: "TicketChanged" },
  );
});

test("a model change is admitted on a ticket whose stored digest the running code would not reproduce", async () => {
  const ticket = await parked("parked-stale-digest");
  await harness.query(
    `UPDATE ticket_definition
        SET digest=$3, definition=definition || '{"resolvedBy":"an older release"}'::jsonb
      WHERE tenant=$1 AND project=$2`,
    [ticket.partition.tenant, ticket.partition.project, "f".repeat(64)],
  );
  assert.deepEqual(await changed(ticket, anotherModel), {
    decided: ["Answered"],
    code: null,
  });
});

test("acceptance takes a change whose overrides are not an object as no command it knows", async () => {
  const ticket = await parked("parked-shape");
  const accepted = await harness.inbox.accept({
    ...postgresHarnessSubmission(ticket.partition, "parked-shape"),
    command: {
      version: 1,
      command: "ChangeTicketOverrides",
      ticket: asTicketId(1),
      action: ticket.action,
      authorizingSeq: ticket.authorizingSeq,
      overrides: [] as unknown as ConfigurationOverrides,
    },
  });
  assert.equal(accepted.accepted, "InvalidCommand");
});
