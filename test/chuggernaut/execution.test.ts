import assert from "node:assert/strict";
import test from "node:test";

import * as task from "../../src/domain/chuggernaut/task.js";
import * as ticket from "../../src/domain/chuggernaut/ticket.js";
import {
  ticketExecutionEffects,
  ticketExecutionPrepareRun,
  ticketExecutionResultRef,
  ticketExecutionRun,
  ticketExecutionSettlementRun,
  ticketExecutionUnclaimableRun,
  ticketExecutionUnreportedRun,
  ticketExecutionMaterial,
  ticketExecutionView,
  type TicketExecutionClaim,
  type TicketExecutionStore,
  type TicketExecutionView,
} from "../../src/interpreter/ticketExecution.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import type { TicketMachineInput } from "../../src/interpreter/ticketMachine.ts";
import { asRecoveryEpoch } from "../../src/interpreter/projectStore.ts";
import type { TicketContentStore } from "../../src/interpreter/ticketCatalog.ts";
import * as evaluation from "../../src/domain/chuggernaut/evaluation.js";
import {
  Driver,
  PLAN,
  evaluator_result_command,
  work_obligation,
  work_result_command,
} from "./domain/testing.js";

const partition = { tenant: "tenant", project: "project" } as Partition;

const WORKSPACE =
  '{"commit":"0123456789012345678901234567890123456789","repository":"repository"}';

const WORKLOAD = task.ContentRef(1);
const BINDINGS = task.ContentRef(2);
const SOURCE = task.ContentRef(3);
const CONTRACT = task.ContentRef(4);
const AUTHORED = task.ContentRef(10);

const definition = new ticket.ReleasedTicket(
  task.TicketId(7),
  AUTHORED,
  BINDINGS,
  new Set<task.TicketId>(),
  new task.TaskDefinition(
    WORKLOAD,
    BINDINGS,
    new task.ExecutionRequirements(["linux"]),
    CONTRACT,
  ),
  PLAN,
  task.ContentRef(1),
);

/** Drives ticket 7 into its first work cycle, the only state a work obligation is claimed in. */
function dispatched(): Driver {
  const driver = new Driver();
  driver.submit(new ticket.CreateTicket(definition));
  driver.submit(new ticket.DispatchTicket(task.TicketId(7), SOURCE));
  return driver;
}

function obligation(): task.TaskObligation {
  return work_obligation(dispatched().graph, 7);
}

test("execution view resolves immutable references without rewriting workload options", async () => {
  const values = new Map<number, string>([
    [
      1,
      '{"runner":"script","command":["just","check"],"network_access":false}',
    ],
    [2, '{"answer":42}'],
    [
      3,
      '{"commit":"0123456789012345678901234567890123456789","repository":"git@example.invalid:owner/repository.git"}',
    ],
    [4, '{"type":"object"}'],
    [10, '{"summary":"prior work"}'],
  ]);
  const content: TicketContentStore = {
    put: () => Promise.resolve(task.ContentRef(99)),
    read: (reference) => {
      const found = values.get(reference);
      return Promise.resolve(
        found === undefined
          ? undefined
          : { mediaType: "application/json", content: found },
      );
    },
  };
  const driver = dispatched();
  const view = await ticketExecutionView(
    content,
    driver.graph,
    work_obligation(driver.graph, 7),
  );
  assert.deepEqual(view.workload, {
    runner: "script",
    command: ["just", "check"],
    network_access: false,
  });
  assert.equal(view.access, "PublishRepositoryResult");
  assert.equal(view.repository, "git@example.invalid:owner/repository.git");
  assert.equal(view.commit, "0123456789012345678901234567890123456789");
  assert.equal(view.source, SOURCE);
  assert.deepEqual(view.requiredCapabilities, ["linux"]);
  assert.deepEqual(view.context, [
    { reference: AUTHORED, value: { summary: "prior work" } },
    { reference: BINDINGS, value: { answer: 42 } },
  ]);
});

test("execution effects keep the delivery identity and cancel only the exact task", async () => {
  const calls: unknown[] = [];
  const store = {
    execute: (...input: unknown[]) =>
      Promise.resolve((calls.push(["execute", ...input]), true)),
    cancel: (...input: unknown[]) =>
      Promise.resolve((calls.push(["cancel", ...input]), true)),
  } as unknown as TicketExecutionStore;
  const effects = ticketExecutionEffects(store);
  const held = obligation();
  await effects.execute(
    partition,
    "12:0",
    new ticket.ExecuteTask(task.TicketId(7), held),
  );
  await effects.cancel(
    partition,
    "13:0",
    new ticket.CancelTask(task.TicketId(7), held.task),
  );
  assert.equal((calls[0] as unknown[])[2], "12:0");
  assert.equal((calls[0] as unknown[])[3], "work:7:1");
  assert.equal((calls[1] as unknown[])[3], "work:7:1");
});

const workspaceContent = () => ({
  put: () => Promise.resolve(task.ContentRef(99)),
  read: (reference: task.ContentRef) =>
    Promise.resolve({
      mediaType: "application/json",
      content: reference === SOURCE ? WORKSPACE : "{}",
    }),
});

/** The passes a case does not drive, each one a failure if the run reaches it. */
const idlePasses = {
  unreported: () => Promise.reject(new Error("this case sweeps nothing")),
  unprepared: () => Promise.reject(new Error("this case prepares nothing")),
  prepare: () => Promise.reject(new Error("this case prepares nothing")),
  settlements: () => Promise.reject(new Error("this case settles nothing")),
};

test("operational retry exhaustion reports unavailable with stable authorization", async () => {
  const held = obligation();
  const claim: TicketExecutionClaim = {
    partition,
    identity: "12:0",
    taskKey: "work:7:1",
    obligation: held,
    attempt: 2,
    recoveryEpoch: asRecoveryEpoch("epoch-one"),
  };
  let submitted: { input: unknown } | undefined;
  const completed = await ticketExecutionRun(
    {
      ...idlePasses,
      execute: () => Promise.resolve(true),
      cancel: () => Promise.resolve(true),
      claim: (_owner, recoveryEpoch, _leaseSecs, _limit, capabilities) => {
        assert.equal(recoveryEpoch, claim.recoveryEpoch);
        assert.deepEqual(capabilities, ["shell"]);
        return Promise.resolve([claim]);
      },
      unclaimable: () => Promise.resolve([]),
      retry: () => Promise.reject(new Error("exhausted work must not retry")),
      terminal: (_claim, input) => {
        submitted = { input };
        return Promise.resolve(true);
      },
      cancelled: () => Promise.resolve(false),
    },
    workspaceContent,
    () => Promise.resolve(dispatched().graph),
    {
      run: () =>
        Promise.resolve({
          placed: "Retry" as const,
          retryAfterSecs: 1,
          evidence: "the site placed nothing",
        }),
      cancel: () => Promise.resolve(),
    },
    "worker-one",
    claim.recoveryEpoch,
    {
      principal: "worker-one",
      authorizedOperation: "ReportTaskTerminal",
      authorityKind: "ExecutionWorker",
      authoritySubject: "worker-one",
      policyRevision: "test-policy-v1",
    },
    30,
    2,
    1,
    ["shell"],
    3,
  );
  assert.equal(completed, 1);
  const input = submitted?.input as {
    identity: string;
    command: ticket.ReportTaskTerminal;
  };
  assert.equal(input.identity, "execution-terminal:work:7:1");
  assert.equal(input.command.report.kind, "TerminalFailureReport");
  if (input.command.report.kind !== "TerminalFailureReport")
    throw new Error("an exhausted retry did not report a failure");
  assert.equal(
    input.command.report.kind_of_failure.kind,
    "ExecutionUnavailableFailure",
  );
});

test("a placed attempt's wire outcome becomes the terminal the machine takes", async () => {
  const held = obligation();
  const claim: TicketExecutionClaim = {
    partition,
    identity: "12:0",
    taskKey: "work:7:1",
    obligation: held,
    attempt: 1,
    recoveryEpoch: asRecoveryEpoch("epoch-one"),
  };
  let submitted: ticket.ReportTaskTerminal | undefined;
  const completed = await ticketExecutionRun(
    {
      ...idlePasses,
      execute: () => Promise.resolve(true),
      cancel: () => Promise.resolve(true),
      claim: () => Promise.resolve([claim]),
      unclaimable: () => Promise.resolve([]),
      retry: () =>
        Promise.reject(new Error("a reported attempt must not retry")),
      terminal: (_claim, input) => {
        submitted = input.command as ticket.ReportTaskTerminal;
        return Promise.resolve(true);
      },
      cancelled: () => Promise.resolve(false),
    },
    workspaceContent,
    () => Promise.resolve(dispatched().graph),
    {
      run: () =>
        Promise.resolve({
          placed: "Reported" as const,
          outcome: {
            type: "result",
            manifest: {},
            outputs: [
              {
                repository: "repository",
                commit: "0123456789012345678901234567890123456789",
                base: "0123456789012345678901234567890123456789",
              },
            ],
          },
        }),
      cancel: () => Promise.resolve(),
    },
    "worker-one",
    claim.recoveryEpoch,
    {
      principal: "worker-one",
      authorizedOperation: "ReportTaskTerminal",
      authorityKind: "ExecutionWorker",
      authoritySubject: "worker-one",
      policyRevision: "test-policy-v1",
    },
    30,
    2,
    1,
    ["linux"],
    3,
  );
  assert.equal(completed, 1);
  assert.equal(submitted?.report.kind, "WorkResultReport");
});

test("produced commits have one deterministic publication ref", () => {
  assert.equal(
    ticketExecutionResultRef("0123456789012345678901234567890123456789"),
    "refs/chuggy/results/0123456789012345678901234567890123456789",
  );
  assert.throws(() => ticketExecutionResultRef("ABC"), /lowercase SHA-1/u);
});

test("work context preserves authored text alongside JSON inputs and rework", async () => {
  const driver = dispatched();
  driver.submit(work_result_command(driver.graph, 7, 400));
  for (const manifest of [601, 602])
    driver.submit(
      evaluator_result_command(
        driver.graph,
        7,
        manifest,
        new evaluation.EvaluatorFail(),
      ),
    );
  const context = new Map([
    [
      10,
      {
        mediaType: "text/markdown",
        content: "# Fix the importer\n\nReport every rejected row.",
      },
    ],
    [2, { mediaType: "application/json", content: '{"threshold":1}' }],
    [
      601,
      {
        mediaType: "application/json",
        content: '{"findings":[{"description":"Rows are dropped"}]}',
      },
    ],
    [
      602,
      {
        mediaType: "application/json",
        content: '{"findings":[{"description":"Totals disagree"}]}',
      },
    ],
  ]);
  const view = await ticketExecutionView(
    {
      put: () => Promise.resolve(task.ContentRef(99)),
      read: (reference) =>
        Promise.resolve(
          context.get(reference) ?? {
            mediaType: "application/json",
            content: WORKSPACE,
          },
        ),
    },
    driver.graph,
    work_obligation(driver.graph, 7),
  );
  assert.deepEqual(
    view.context.map((entry) => entry.value),
    [
      "# Fix the importer\n\nReport every rejected row.",
      { threshold: 1 },
      { findings: [{ description: "Rows are dropped" }] },
      { findings: [{ description: "Totals disagree" }] },
    ],
  );
});

test("an obligation whose ticket has moved on resolves no material", () => {
  const driver = dispatched();
  const held = work_obligation(driver.graph, 7);
  driver.submit(work_result_command(driver.graph, 7, 400));
  assert.throws(
    () => ticketExecutionMaterial(driver.graph, held),
    /work obligation is not current/u,
  );
});

/** The one claim a sweep took, which differs between the sweeps only in what it spent. */
function sweptClaim(attempt: number): TicketExecutionClaim {
  return {
    partition,
    identity: "12:0",
    taskKey: "work:7:1",
    obligation: obligation(),
    attempt,
    recoveryEpoch: asRecoveryEpoch("epoch-one"),
  };
}

/** What a sweep settles through: a store that claims nothing, and what it wrote down. */
function swept() {
  const written: { evidence?: string; input?: unknown } = {};
  return {
    written,
    store: {
      ...idlePasses,
      execute: () => Promise.resolve(true),
      cancel: () => Promise.resolve(true),
      claim: () => Promise.reject(new Error("a sweep never claims")),
      retry: () => Promise.reject(new Error("swept work must not retry")),
      terminal: (_claim: TicketExecutionClaim, input: TicketMachineInput) => {
        written.input = input;
        return Promise.resolve(true);
      },
      cancelled: () => Promise.resolve(false),
    },
    content: () => ({
      put: (_mediaType: string, content: string) => {
        written.evidence = content;
        return Promise.resolve(task.ContentRef(99));
      },
      read: () => Promise.resolve(undefined),
    }),
    authorization: {
      principal: "worker-one",
      authorizedOperation: "ReportTaskTerminal",
      authorityKind: "ExecutionWorker",
      authoritySubject: "worker-one",
      policyRevision: "test-policy-v1",
    } as const,
  };
}

/** The terminal both sweeps submit, which is unavailability against the evidence they wrote. */
function sweptUnavailable(input: unknown): void {
  const submitted = input as {
    identity: string;
    command: ticket.ReportTaskTerminal;
  };
  assert.equal(submitted.identity, "execution-terminal:work:7:1");
  if (submitted.command.report.kind !== "TerminalFailureReport")
    throw new Error("swept work did not report a failure");
  assert.equal(
    submitted.command.report.kind_of_failure.kind,
    "ExecutionUnavailableFailure",
  );
}

test("work whose every claim said nothing is reported unavailable", async () => {
  const claim = sweptClaim(4);
  const fixture = swept();
  const settled = await ticketExecutionUnreportedRun(
    {
      ...fixture.store,
      unclaimable: () =>
        Promise.reject(new Error("the silence pass is not the window pass")),
      unreported: (
        _owner,
        _epoch,
        _leaseSecs,
        _limit,
        attemptsUnreportedMax,
      ) => {
        assert.equal(attemptsUnreportedMax, 3);
        return Promise.resolve([claim]);
      },
    },
    fixture.content,
    "worker-one",
    claim.recoveryEpoch,
    fixture.authorization,
    30,
    1,
    3,
  );
  assert.equal(settled, 1);
  assert.deepEqual(JSON.parse(fixture.written.evidence ?? "null"), {
    reason: "every claim of this work expired without reporting an outcome",
    taskKey: "work:7:1",
    requiredCapabilities: ["linux"],
    attempts: 4,
    attemptsUnreportedMax: 3,
  });
  sweptUnavailable(fixture.written.input);
});

test("work no claimant took inside its window is reported unavailable", async () => {
  const claim = sweptClaim(1);
  const fixture = swept();
  const settled = await ticketExecutionUnclaimableRun(
    {
      ...fixture.store,
      unreported: () =>
        Promise.reject(new Error("the window pass is not the silence pass")),
      unclaimable: (_owner, _epoch, _leaseSecs, _limit, windowSecs) => {
        assert.equal(windowSecs, 60);
        return Promise.resolve([claim]);
      },
    },
    fixture.content,
    "worker-one",
    claim.recoveryEpoch,
    fixture.authorization,
    30,
    1,
    60,
  );
  assert.equal(settled, 1);
  assert.deepEqual(JSON.parse(fixture.written.evidence ?? "null"), {
    reason: "no claimant covering the required capabilities appeared in time",
    taskKey: "work:7:1",
    requiredCapabilities: ["linux"],
    windowSecs: 60,
  });
  sweptUnavailable(fixture.written.input);
});

test("queued work is given the view a pool's plane hands out, and stale work is not", async () => {
  const driver = dispatched();
  const held = work_obligation(driver.graph, 7);
  const prepared: Record<string, unknown> = {};
  const settledDriver = dispatched();
  settledDriver.submit(work_result_command(settledDriver.graph, 7, 400));
  for (const [what, graph, count] of [
    ["current", driver.graph, 1],
    ["moved on", settledDriver.graph, 0],
  ] as const) {
    const count_prepared = await ticketExecutionPrepareRun(
      {
        ...idlePasses,
        unprepared: () =>
          Promise.resolve([
            { partition, taskKey: "work:7:1", obligation: held },
          ]),
        prepare: (
          _partition: Partition,
          taskKey: string,
          view: TicketExecutionView,
        ) => {
          prepared[taskKey] = view.requiredCapabilities;
          return Promise.resolve(true);
        },
      } as unknown as TicketExecutionStore,
      workspaceContent,
      () => Promise.resolve(graph),
      4,
    );
    assert.equal(count_prepared, count, what);
  }
  assert.deepEqual(prepared["work:7:1"], ["linux"]);
});

test("a pool-run attempt is settled by the pass, through the one result protocol", async () => {
  const held = obligation();
  const claim: TicketExecutionClaim = {
    partition,
    identity: "12:0",
    taskKey: "work:7:1",
    obligation: held,
    attempt: 1,
    recoveryEpoch: asRecoveryEpoch("epoch-one"),
  };
  const reported: ticket.ReportTaskTerminal[] = [];
  const settled = await ticketExecutionSettlementRun(
    {
      ...idlePasses,
      settlements: () =>
        Promise.resolve([
          {
            claim,
            outcome: {
              type: "result",
              manifest: {},
              outputs: [
                {
                  repository: "repository",
                  commit: "0123456789012345678901234567890123456789",
                  base: "0123456789012345678901234567890123456789",
                },
              ],
            },
          },
          { claim, refusal: "this pool runs no containers" },
        ]),
      terminal: (_claim: TicketExecutionClaim, input: TicketMachineInput) => {
        reported.push(input.command as ticket.ReportTaskTerminal);
        return Promise.resolve(true);
      },
    } as unknown as TicketExecutionStore,
    workspaceContent,
    () => Promise.resolve(dispatched().graph),
    {
      principal: "scheduler-one",
      authorizedOperation: "ReportTaskTerminal",
      authorityKind: "ExecutionScheduler",
      authoritySubject: "scheduler-one",
      policyRevision: "test-policy-v1",
    },
    4,
  );
  assert.equal(settled, 2);
  assert.deepEqual(reported.map((command) => command.report.kind).sort(), [
    "TerminalFailureReport",
    "WorkResultReport",
  ]);
  const refused = reported.find(
    (command) => command.report.kind === "TerminalFailureReport",
  )?.report;
  assert.equal(
    refused?.kind === "TerminalFailureReport"
      ? refused.kind_of_failure.kind
      : undefined,
    "ExecutionUnavailableFailure",
  );
});
