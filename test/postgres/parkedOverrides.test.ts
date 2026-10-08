/**
 * An escalated ticket's overrides changed through the operation door and the
 * deciding transaction, against a real server: what the door admits, the
 * order the transaction holds a change to — the escalation it names, a ready
 * configuration, a definition that does not move — and that what it stores is
 * the overrides alone.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import type { ConfigurationOverrides } from "../../src/contract/configurationOverrides.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import { asPlacementId } from "../../src/interpreter/executionScheduler.ts";
import type { ProjectMemory } from "../../src/interpreter/projectWriter.ts";
import { executionSchedulerDefaults } from "../../src/interpreter/executionScheduler.ts";
import { postgresHarnessDrain, postgresHarnessSubmission } from "./harness.ts";
import {
  schedulerClaimFor,
  schedulerInCluster,
  schedulerOwner,
  schedulerProject,
  schedulerRigOpen,
  type SchedulerProject,
  type SchedulerRig,
} from "./schedulerHarness.ts";

let rig: SchedulerRig;

before(async () => {
  rig = await schedulerRigOpen();
});

after(async () => {
  await rig.close();
});

/** A ticket parked at its work wall, and the escalation that parked it. */
interface Parked {
  readonly project: SchedulerProject;
  readonly memory: ProjectMemory;
  readonly action: string;
  readonly authorizingSeq: number;
}

/** A released, dispatched ticket whose one execution is blocked, which parks it. */
async function parkedTicket(
  label: string,
  overrides?: ConfigurationOverrides,
): Promise<Parked> {
  const project = await schedulerProject(
    rig,
    label,
    { tasks: 1 },
    undefined,
    undefined,
    overrides,
  );
  await rig.store.registerSpawn(
    await schedulerClaimFor(
      rig,
      project.partition,
      project.request,
      schedulerOwner(label),
    ),
    executionSchedulerDefaults.nTasks,
    schedulerInCluster,
  );
  const admitted = await rig.store.admit(project.cluster);
  assert.ok(admitted.admitted === "Admitted");
  const opened = await rig.store.openAttempt({
    partition: project.partition,
    execution: admitted.execution,
    epoch: project.epoch,
    leaseSecs: 300,
    retriesMax: 3,
    placementBackoffSecs: 1,
  });
  assert.ok(opened.opened === "Opened");
  await rig.store.attemptPlaced(
    opened.attempt,
    asPlacementId(`placement-${label}`),
  );
  await rig.store.attemptEnded(opened.attempt, "Withdrawn", "PlacementDenied");
  const blocked = await rig.store.blockExecution(
    project.partition,
    opened.attempt.execution,
    "ExecutionPolicyDenied",
  );
  assert.ok(blocked.blocked === "Blocked");
  const drained = await postgresHarnessDrain(
    rig.harness,
    project.partition,
    project.memory,
  );
  assert.deepEqual(drained.decided, ["Committed"]);
  const [action] = (await rig.harness.query(
    `SELECT action, authorizing_seq::text AS authorizing_seq FROM native_action
      WHERE tenant=$1 AND project=$2 AND ticket=$3 AND state='Open'`,
    [project.partition.tenant, project.partition.project, project.ticket],
  )) as readonly { action: string; authorizing_seq: string }[];
  assert.ok(action !== undefined);
  return {
    project,
    memory: drained.memory,
    action: action.action,
    authorizingSeq: Number(action.authorizing_seq),
  };
}

/** Offers one change at the door, answering what acceptance said. */
async function offered(
  parked: Parked,
  label: string,
  overrides: ConfigurationOverrides,
  fence: Pick<Parked, "action" | "authorizingSeq"> = parked,
  ticket: number = parked.project.ticket,
): Promise<string> {
  const accepted = await rig.harness.inbox.accept({
    ...postgresHarnessSubmission(parked.project.partition, label),
    command: {
      version: 1,
      command: "ChangeTicketOverrides",
      ticket: asTicketId(ticket),
      action: fence.action,
      authorizingSeq: fence.authorizingSeq,
      overrides,
    },
  });
  return accepted.accepted;
}

/** Offers the escalation's own answer, as the card's Resume and Revoke do. */
async function answered(
  parked: Parked,
  label: string,
  resolution: "Resume" | "Revoke",
): Promise<void> {
  const accepted = await rig.harness.inbox.accept({
    ...postgresHarnessSubmission(parked.project.partition, label),
    command: {
      version: 1,
      command: "ResolveNativeAction",
      action: parked.action,
      authorizingSeq: parked.authorizingSeq,
      resolution,
    },
  });
  assert.equal(accepted.accepted, "Accepted");
}

/** What the ticket holds and how every input of its project settled, which a refusal leaves alone. */
async function standing(parked: Parked) {
  const { tenant, project } = parked.project.partition;
  const [ticket] = await rig.harness.query(
    `SELECT t.phase, d.overrides, d.definition, d.digest,
            (SELECT count(*)::int FROM journal_entry j
              WHERE j.tenant=t.tenant AND j.project=t.project) AS entries,
            (SELECT count(*)::int FROM native_action a
              WHERE a.tenant=t.tenant AND a.project=t.project AND a.state='Open')
              AS open_actions
       FROM ticket_projection t
       JOIN ticket_definition d USING (tenant, project, ticket)
      WHERE t.tenant=$1 AND t.project=$2 AND t.ticket=$3`,
    [tenant, project, parked.project.ticket],
  );
  return ticket;
}

/** The settled state and code of every operation the project took, in acceptance order. */
async function settled(parked: Parked) {
  const { tenant, project } = parked.project.partition;
  return rig.harness.query(
    `SELECT o.command_tag, d.state, d.outcome_code FROM operation o
       JOIN decision_input d
         ON d.tenant=o.tenant AND d.project=o.project
        AND d.input_kind='Operation' AND d.input_id=o.operation
      WHERE o.tenant=$1 AND o.project=$2 AND o.command_tag IN ('ChangeTicketOverrides','ResolveNativeAction')
      ORDER BY d.ordinal`,
    [tenant, project],
  );
}

const sonnet: ConfigurationOverrides = {
  worker: {
    mode: {
      type: "SingleAgent",
      agent: "Claude",
      arguments: ["--model=sonnet"],
    },
  },
};

test("a change of how the worker starts is stored beside the definition, which stays as it was", async () => {
  const parked = await parkedTicket("parked-admitted");
  const before = await standing(parked);
  assert.equal(await offered(parked, "admitted", sonnet), "Accepted");
  const drained = await postgresHarnessDrain(
    rig.harness,
    parked.project.partition,
    parked.memory,
  );
  assert.deepEqual(drained.decided, ["Answered"]);
  assert.equal(drained.memory.lease.head, parked.memory.lease.head);
  assert.deepEqual(await standing(parked), { ...before, overrides: sonnet });
  assert.deepEqual(await settled(parked), [
    {
      command_tag: "ChangeTicketOverrides",
      state: "Answered",
      outcome_code: null,
    },
  ]);
});

test("a change that moves the work stage's instructions is refused and stores nothing", async () => {
  const parked = await parkedTicket("parked-instructions", sonnet);
  const before = await standing(parked);
  assert.equal(
    await offered(parked, "instructions", {
      ...sonnet,
      work: { instructions: ["Do something else."] },
    }),
    "Accepted",
  );
  const drained = await postgresHarnessDrain(
    rig.harness,
    parked.project.partition,
    parked.memory,
  );
  assert.deepEqual(drained.decided, ["Refused"]);
  assert.deepEqual(await standing(parked), before);
  assert.equal(before?.["phase"], "Escalated");
  assert.deepEqual(before?.["overrides"], sonnet);
  assert.deepEqual(await settled(parked), [
    {
      command_tag: "ChangeTicketOverrides",
      state: "Refused",
      outcome_code: "OverridesMoveDefinition",
    },
  ]);
});

test("a change whose configuration is not ready is refused ConfigurationInvalid", async () => {
  const parked = await parkedTicket("parked-unready");
  const before = await standing(parked);
  assert.equal(
    await offered(parked, "unready", { practices: ["NoSuchPractice"] }),
    "Accepted",
  );
  const drained = await postgresHarnessDrain(
    rig.harness,
    parked.project.partition,
    parked.memory,
  );
  assert.deepEqual(drained.decided, ["Refused"]);
  assert.deepEqual(await standing(parked), before);
  assert.deepEqual(await settled(parked), [
    {
      command_tag: "ChangeTicketOverrides",
      state: "Refused",
      outcome_code: "ConfigurationInvalid",
    },
  ]);
});

test("a change behind the escalation's own answer is refused TicketChanged, resumed or revoked", async () => {
  for (const resolution of ["Resume", "Revoke"] as const) {
    const parked = await parkedTicket(`parked-answered-${resolution}`);
    await answered(parked, `answer-${resolution}`, resolution);
    assert.equal(
      await offered(parked, `behind-${resolution}`, sonnet),
      "Accepted",
    );
    const drained = await postgresHarnessDrain(
      rig.harness,
      parked.project.partition,
      parked.memory,
    );
    assert.deepEqual(drained.decided, ["Committed", "Refused"], resolution);
    const after = await standing(parked);
    assert.equal(after?.["overrides"], null, resolution);
    assert.equal(
      after?.["phase"],
      resolution === "Resume" ? "Work" : "Revoked",
      resolution,
    );
    assert.deepEqual(
      (await settled(parked)).map((row) => row["outcome_code"]),
      [null, "TicketChanged"],
      resolution,
    );
  }
});

test("the door admits a change only against an open escalation of the ticket it names", async () => {
  const parked = await parkedTicket("parked-door");
  assert.equal(
    await offered(parked, "door-stale", sonnet, {
      action: parked.action,
      authorizingSeq: parked.authorizingSeq + 1,
    }),
    "InvalidCommand",
  );
  assert.equal(
    await offered(
      parked,
      "door-other",
      sonnet,
      parked,
      parked.project.ticket + 1,
    ),
    "InvalidCommand",
  );
  await answered(parked, "door-answer", "Resume");
  await postgresHarnessDrain(
    rig.harness,
    parked.project.partition,
    parked.memory,
  );
  assert.equal(
    await offered(parked, "door-answered", sonnet),
    "InvalidCommand",
  );
});

test("a model-only change is admitted though the running code would not reproduce the stored digest", async () => {
  const parked = await parkedTicket("parked-old-digest");
  await rig.harness.query(
    `UPDATE ticket_definition SET digest=$4
      WHERE tenant=$1 AND project=$2 AND ticket=$3`,
    [
      parked.project.partition.tenant,
      parked.project.partition.project,
      parked.project.ticket,
      "0".repeat(64),
    ],
  );
  assert.equal(await offered(parked, "old-digest", sonnet), "Accepted");
  const drained = await postgresHarnessDrain(
    rig.harness,
    parked.project.partition,
    parked.memory,
  );
  assert.deepEqual(drained.decided, ["Answered"]);
  assert.deepEqual((await standing(parked))?.["overrides"], sonnet);
});

test("a resume with no change before it starts the ticket's work again as it did", async () => {
  const parked = await parkedTicket("parked-plain-resume");
  await answered(parked, "plain-resume", "Resume");
  const drained = await postgresHarnessDrain(
    rig.harness,
    parked.project.partition,
    parked.memory,
  );
  assert.deepEqual(drained.decided, ["Committed"]);
  const after = await standing(parked);
  assert.equal(after?.["phase"], "Work");
  assert.equal(after?.["overrides"], null);
});

/**
 * The writer's graph still has the ticket parked, so it is the transaction's
 * own fence that refuses: the action the change names stopped being open
 * between acceptance and decision, as it does when the ticket is parked again
 * at a later wall.
 */
test("a change whose escalation closed behind the writer's graph is refused by the transaction", async () => {
  const parked = await parkedTicket("parked-fence");
  const before = await standing(parked);
  assert.equal(await offered(parked, "fence", sonnet), "Accepted");
  await rig.harness.query(
    `UPDATE native_action SET state='Withdrawn'
      WHERE tenant=$1 AND project=$2 AND action=$3`,
    [
      parked.project.partition.tenant,
      parked.project.partition.project,
      parked.action,
    ],
  );
  const drained = await postgresHarnessDrain(
    rig.harness,
    parked.project.partition,
    parked.memory,
  );
  assert.deepEqual(drained.decided, ["Refused"]);
  assert.deepEqual(await standing(parked), { ...before, open_actions: 0 });
  assert.deepEqual(
    (await settled(parked)).map((row) => row["outcome_code"]),
    ["TicketChanged"],
  );
});
