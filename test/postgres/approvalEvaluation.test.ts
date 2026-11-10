/**
 * An approval evaluator against a real server: its execution is registered
 * and never placed, an `EvaluationApproval` action is open for it while it is
 * owed, and the native action reads, the inbox and the executions read answer
 * it, while a stage's other evaluators and a ticket with no approval run as
 * they always did.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type pg from "pg";

import { reportTaskTerminalCommand } from "../../src/actor/command.ts";
import { postgresOperationalReads } from "../../src/adapters/postgres/operationalReads.ts";
import {
  postgresInboxReads,
  postgresNativeReads,
} from "../../src/adapters/postgres/nativeReads.ts";
import {
  executionsResponseSchema,
  ticketNativeActionsResponseSchema,
} from "../../src/contract/responses.ts";
import type { Config } from "../../src/domain/config.ts";
import { evaluationTaskOf, workTaskIdentity } from "../../src/domain/task.ts";
import type { TaskIdentity } from "../../src/domain/generated/modelTypes.ts";
import {
  canonicalConfigurationOf,
  type ReleaseAuthoring,
} from "../../src/interpreter/authoring.ts";
import { executionSchedulerDefaults } from "../../src/interpreter/executionScheduler.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import type { ProjectMemory } from "../../src/interpreter/projectWriter.ts";
import { plainAuthoring, refinementInstance } from "../actor/harness.ts";
import { id, stoppedReport } from "../domain/fixtures.ts";
import {
  postgresHarnessCompletion,
  postgresHarnessDrain,
  postgresHarnessReport,
  postgresHarnessResume,
  postgresHarnessSubmission,
} from "./harness.ts";
import {
  schedulerClaimFor,
  schedulerInCluster,
  schedulerIngressPool,
  schedulerOwner,
  schedulerProject,
  schedulerRevoke,
  schedulerRigOpen,
  type SchedulerProject,
  type SchedulerRig,
} from "./schedulerHarness.ts";

let rig: SchedulerRig;
let ingress: pg.Pool;

before(async () => {
  rig = await schedulerRigOpen();
  ingress = schedulerIngressPool();
});

after(async () => {
  await ingress.end();
  await rig.close();
});

const reader = asPrincipal("approval-reader");
const instructions = "Read the change and say whether it may land.";

/** A catalog evaluating by `plan`: an approval alone, a command beside it, or a command alone. */
function catalogOf(plan: "signOff" | "mixed" | "ungated") {
  return canonicalConfigurationOf({
    version: 2,
    image: "worker:v2",
    workloads: {
      build: {
        runner: "Agent",
        prompt: { text: "Build it." },
        worker: {
          mode: { type: "SingleAgent", agent: "Claude", arguments: [] },
          setup: [],
          files: [],
        },
      },
      tests: { runner: "Commands", commands: ["npm test"] },
      approval: { runner: "Approval", instructions, approvers: "Admin" },
    },
    plans: {
      signOff: [{ name: "sign-off", evaluators: ["approval"] }],
      mixed: [{ name: "checks", evaluators: ["tests", "approval"] }],
      ungated: [{ name: "checks", evaluators: ["tests"] }],
    },
    defaults: { work: "build", evaluation: plan },
  });
}

/** A stage of two evaluators, and the bounds a writer must hold to take a release of one. */
const mixed = {
  authoring: {
    deps: new Set<number>(),
    prog: [{ key: 1, evaluators: [{ key: 1 }, { key: 2 }] }],
  },
  config: { ...refinementInstance, nTasks: 2 },
} satisfies { authoring: ReleaseAuthoring; config: Config };

/** A case's project, the memory its last decision left, and the bounds its writer decides under. */
interface Evaluating {
  readonly project: SchedulerProject;
  readonly memory: ProjectMemory;
  readonly config: Config;
}

/** One completion reported for the ticket and every input it leaves decided. */
async function reported(
  at: Evaluating,
  report: (memory: ProjectMemory) => ReturnType<typeof postgresHarnessReport>,
): Promise<Evaluating> {
  await postgresHarnessCompletion(
    rig.harness,
    at.project.partition,
    `operation-approval-${randomUUID()}`,
    reportTaskTerminalCommand(report(at.memory)),
  );
  const drained = await postgresHarnessDrain(
    rig.harness,
    at.project.partition,
    at.memory,
    at.config,
  );
  return { ...at, memory: drained.memory };
}

/** The ticket's newest evaluation spawn, registered through the real store. */
async function evaluationRegistered(at: Evaluating, label: string) {
  const [spawn] = (await rig.harness.query(
    `SELECT request FROM execution_request
      WHERE tenant=$1 AND project=$2 AND kind='SpawnEvaluation'
      ORDER BY effect_position DESC, authorizing_seq DESC LIMIT 1`,
    [at.project.partition.tenant, at.project.partition.project],
  )) as readonly { request: string }[];
  assert.ok(spawn !== undefined, "the work pass spawned no evaluation");
  const registered = await rig.store.registerSpawn(
    await schedulerClaimFor(
      rig,
      at.project.partition,
      spawn.request,
      schedulerOwner(label),
    ),
    executionSchedulerDefaults.nTasks,
    schedulerInCluster,
  );
  assert.equal(registered.registered, "Registered");
}

/** A released ticket whose work cycle 1 passed, its first evaluation registered. */
async function evaluating(
  label: string,
  plan: "signOff" | "mixed" | "ungated",
  release: { authoring: ReleaseAuthoring; config: Config } = {
    authoring: plainAuthoring,
    config: refinementInstance,
  },
): Promise<Evaluating> {
  const project = await schedulerProject(
    rig,
    label,
    { tasks: 1 },
    catalogOf(plan),
    undefined,
    undefined,
    release,
  );
  const passed = await reported(
    { project, memory: project.memory, config: release.config },
    (memory) =>
      postgresHarnessReport(memory.graph, workTaskIdentity(1, 1), "Pass"),
  );
  await evaluationRegistered(passed, label);
  return passed;
}

/** The ticket's evaluation executions, by the task each registers. */
async function evaluations(at: Evaluating) {
  return (await rig.harness.query(
    `SELECT e.execution, e.status, e.requirement_value IS NULL AS awaiting,
            t.cycle::int AS cycle, t.evaluator::int AS evaluator,
            (SELECT count(*)::int FROM execution_attempt a
              WHERE a.tenant=e.tenant AND a.project=e.project
                AND a.execution=e.execution) AS attempts
       FROM execution e
       JOIN execution_request_task t
         ON t.tenant=e.tenant AND t.project=e.project
        AND t.request=e.source_request AND t.task=e.task
      WHERE e.tenant=$1 AND e.project=$2 AND t.kind='Evaluation'
      ORDER BY e.task`,
    [at.project.partition.tenant, at.project.partition.project],
  )) as readonly {
    execution: string;
    status: string;
    awaiting: boolean;
    cycle: number;
    evaluator: number;
    attempts: number;
  }[];
}

/** Every native action the ticket holds, open or not. */
async function actions(at: Evaluating) {
  return (await rig.harness.query(
    `SELECT action, kind, execution, state, authorizing_seq::int AS seq
       FROM native_action WHERE tenant=$1 AND project=$2 ORDER BY action`,
    [at.project.partition.tenant, at.project.partition.project],
  )) as readonly {
    action: string;
    kind: string;
    execution: string | null;
    state: string;
    seq: number;
  }[];
}

const awaitingOf = async (at: Evaluating) => {
  const awaiting = (await evaluations(at)).filter((row) => row.awaiting);
  assert.equal(awaiting.length, 1);
  const [only] = awaiting;
  assert.ok(only !== undefined);
  return only;
};

const openOf = async (at: Evaluating) =>
  (await actions(at)).filter((row) => row.state === "Open");

test("an approval is registered on no runner and is asked of a person by one action", async () => {
  const at = await evaluating("approval-alone", "signOff");
  const awaiting = await awaitingOf(at);
  assert.equal(awaiting.status, "Queued");
  for (let pass = 0; pass < 3; pass++)
    assert.notEqual(
      (await rig.store.admit(at.project.cluster)).admitted,
      "Admitted",
    );
  assert.equal((await awaitingOf(at)).attempts, 0);
  const [open, ...more] = await openOf(at);
  assert.deepEqual(more, []);
  assert.equal(open?.kind, "EvaluationApproval");
  assert.equal(open.execution, awaiting.execution);
});

test("the ticket's and the project's action reads and the inbox say what the approval asks", async () => {
  const at = await evaluating("approval-read", "signOff");
  const awaiting = await awaitingOf(at);
  const [open] = await openOf(at);
  assert.ok(open !== undefined);
  const asked = {
    action: open.action,
    kind: "EvaluationApproval",
    authorizingSequence: open.seq,
    admits: ["Approve", "Reject"],
    approval: {
      execution: awaiting.execution,
      workCycle: 1,
      stage: 1,
      generation: 1,
      evaluator: 1,
      instructions,
      approvers: "Admin",
    },
  };
  const native = postgresNativeReads(ingress);
  const ticketActions = await native.ticketNativeActions(
    at.project.partition,
    id(at.project.ticket),
  );
  assert.deepEqual(ticketActions, [asked]);
  ticketNativeActionsResponseSchema.parse({ actions: ticketActions });
  const listed = { ticket: id(at.project.ticket), ...asked };
  assert.deepEqual(
    (await native.nativeActions(at.project.partition, { limit: 10 })).actions,
    [listed],
  );
  const inbox = await postgresInboxReads(ingress).inbox(at.project.partition, {
    phases: [],
    named: [],
    limit: 10,
  });
  assert.deepEqual(
    inbox.tickets.map((ticket) => ticket.ticket),
    [id(at.project.ticket)],
  );
  assert.deepEqual(inbox.actions, [listed]);
});

test("the executions read says the approval awaits, and it is no queued work", async () => {
  const at = await evaluating("approval-standing", "signOff");
  const awaiting = await awaitingOf(at);
  const operational = postgresOperationalReads(ingress);
  const page = await operational.executions(
    at.project.partition,
    {
      limit: 10,
      ticket: id(at.project.ticket),
      selection: { selection: "Selected", states: ["Awaiting"] },
    },
    reader,
  );
  assert.deepEqual(
    page.executions.map((execution) => execution.execution),
    [awaiting.execution],
  );
  assert.equal(page.executions[0]?.status, "Awaiting");
  assert.equal(page.executions[0].requirement, undefined);
  executionsResponseSchema.parse({ executions: page.executions });
  const status = await operational.status(at.project.partition);
  assert.equal(status.queued, 0);
  assert.equal(status.accountActive, 0);
});

test("an answer to an evaluation approval is refused by name and leaves it open", async () => {
  const at = await evaluating("approval-answered", "signOff");
  const [open] = await openOf(at);
  assert.ok(open !== undefined);
  for (const resolution of ["Approve", "Reject"] as const) {
    const label = `approval-answer-${resolution}`;
    const submission = postgresHarnessSubmission(at.project.partition, label);
    const accepted = await rig.harness.inbox.accept({
      ...submission,
      command: {
        version: 1,
        command: "ResolveNativeAction",
        action: open.action,
        authorizingSeq: open.seq,
        resolution,
      },
    });
    assert.equal(accepted.accepted, "Accepted", resolution);
    await postgresHarnessDrain(rig.harness, at.project.partition, at.memory);
    assert.deepEqual(
      await rig.harness.query(
        `SELECT d.outcome_code FROM decision_input d
          WHERE d.tenant=$1 AND d.project=$2 AND d.input_kind='Operation'
            AND d.input_id=$3`,
        [
          at.project.partition.tenant,
          at.project.partition.project,
          submission.operation,
        ],
      ),
      [{ outcome_code: "ApprovalNotAnswerable" }],
      resolution,
    );
  }
  assert.deepEqual(
    (await openOf(at)).map((row) => row.action),
    [open.action],
  );
});

test("a stage's other evaluator is admitted while its approval waits", async () => {
  const at = await evaluating("approval-mixed", "mixed", mixed);
  const rows = await evaluations(at);
  assert.deepEqual(
    rows.map((row) => [row.evaluator, row.awaiting]),
    [
      [1, false],
      [2, true],
    ],
  );
  const admitted = await rig.store.admit(at.project.cluster);
  assert.ok(admitted.admitted === "Admitted");
  assert.equal(admitted.execution, rows[0]?.execution);
  assert.notEqual(
    (await rig.store.admit(at.project.cluster)).admitted,
    "Admitted",
  );
  const status = await postgresOperationalReads(ingress).status(
    at.project.partition,
  );
  assert.equal(status.queued, 0);
  assert.equal(status.admitted, 1);
  assert.deepEqual(
    (await openOf(at)).map((row) => row.execution),
    [rows[1]?.execution],
  );
});

test("a revoke closes the approval and cancels the execution it stood for", async () => {
  const at = await evaluating("approval-revoked", "signOff");
  const awaiting = await awaitingOf(at);
  const cancellation = await schedulerRevoke(
    rig,
    { ...at.project, memory: at.memory },
    "approval-revoked",
  );
  assert.deepEqual(await openOf(at), []);
  await rig.store.registerCancellation(
    await schedulerClaimFor(
      rig,
      at.project.partition,
      cancellation,
      schedulerOwner("approval-revoked-cancel"),
    ),
  );
  assert.equal(
    (await evaluations(at)).find((row) => row.execution === awaiting.execution)
      ?.status,
    "Cancelled",
  );
  assert.deepEqual(
    (await actions(at)).map((row) => row.state),
    ["Withdrawn"],
  );
});

/** The approval evaluator of work cycle `cycle`'s first run, as the ticket owes it. */
function approvalTask(cycle: number): TaskIdentity {
  return evaluationTaskOf(1, cycle, 1, 1, 1);
}

test("a blocked approval resumed is asked again by exactly one new action", async () => {
  const first = await evaluating("approval-blocked", "signOff");
  const [before] = await openOf(first);
  const blocked = await reported(first, () =>
    stoppedReport(approvalTask(1), "ExecutionUnavailableFailure"),
  );
  assert.deepEqual(
    (await openOf(blocked)).map((row) => row.kind),
    ["TicketEscalation"],
  );
  assert.equal(
    await postgresHarnessResume(
      rig.harness,
      blocked.project.partition,
      blocked.project.ticket,
      "approval-blocked-resume",
    ),
    "Accepted",
  );
  const resumed = {
    ...blocked,
    memory: (
      await postgresHarnessDrain(
        rig.harness,
        blocked.project.partition,
        blocked.memory,
      )
    ).memory,
  };
  await evaluationRegistered(resumed, "approval-blocked-again");
  const open = await openOf(resumed);
  assert.equal(open.length, 1);
  assert.equal(open[0]?.kind, "EvaluationApproval");
  assert.notEqual(open[0]?.action, before?.action);
  const asked = (await evaluations(resumed)).at(-1);
  assert.equal(open[0]?.execution, asked?.execution);
  assert.equal(asked?.awaiting, true);
});

test("a rework's next evaluation asks its approval by exactly one new action", async () => {
  const first = await evaluating("approval-rework", "signOff");
  const failed = await reported(first, (memory) =>
    postgresHarnessReport(memory.graph, approvalTask(1), "Fail"),
  );
  assert.deepEqual(await openOf(failed), []);
  const reworked = await reported(failed, (memory) =>
    postgresHarnessReport(memory.graph, workTaskIdentity(1, 2), "Pass"),
  );
  await evaluationRegistered(reworked, "approval-rework-again");
  const open = await openOf(reworked);
  assert.equal(open.length, 1);
  const asked = (await evaluations(reworked)).at(-1);
  assert.equal(asked?.cycle, 2);
  assert.equal(open[0]?.execution, asked?.execution);
});

test("a ticket with no approval evaluator is placed as before and asks nobody", async () => {
  const at = await evaluating("approval-none", "ungated");
  const [row, ...more] = await evaluations(at);
  assert.deepEqual(more, []);
  assert.equal(row?.awaiting, false);
  const admitted = await rig.store.admit(at.project.cluster);
  assert.ok(admitted.admitted === "Admitted");
  assert.equal(admitted.execution, row.execution);
  assert.deepEqual(await actions(at), []);
});
