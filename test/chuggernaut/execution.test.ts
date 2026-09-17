import assert from "node:assert/strict";
import test from "node:test";

import * as task from "../../src/domain/chuggernaut/task.js";
import * as ticket from "../../src/domain/chuggernaut/ticket.js";
import {
  ticketExecutionEffects,
  ticketExecutionResultRef,
  ticketExecutionRun,
  ticketExecutionView,
  type TicketExecutionClaim,
  type TicketExecutionStore,
} from "../../src/interpreter/ticketExecution.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import { asRecoveryEpoch } from "../../src/interpreter/projectStore.ts";
import type { TicketContentStore } from "../../src/interpreter/ticketCatalog.ts";

const partition = { tenant: "tenant", project: "project" } as Partition;

function obligation(): task.TaskObligation {
  return new task.TaskObligation(
    new task.WorkTaskId(task.TicketId(7), task.CycleNumber(2)),
    new task.TaskDefinition(
      task.ContentRef(1),
      task.ContentRef(2),
      new task.ExecutionRequirements(
        task.ContentRef(3),
        new task.PublishRepositoryResult(),
        ["linux"],
      ),
      task.ContentRef(4),
    ),
    new task.WorkspaceSource(task.ContentRef(3), task.Digest(5)),
    [task.ContentRef(6)],
  );
}

test("execution view resolves immutable references without rewriting workload options", async () => {
  const values = new Map<number, string>([
    [
      1,
      '{"runner":"script","command":["just","check"],"network_access":false}',
    ],
    [2, '{"answer":42}'],
    [3, "git@example.invalid:owner/repository.git"],
    [4, '{"type":"object"}'],
    [5, "0123456789012345678901234567890123456789"],
    [6, '{"summary":"prior work"}'],
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
  const view = await ticketExecutionView(content, obligation());
  assert.deepEqual(view.workload, {
    runner: "script",
    command: ["just", "check"],
    network_access: false,
  });
  assert.equal(view.access, "PublishRepositoryResult");
  assert.deepEqual(view.requiredCapabilities, ["linux"]);
  assert.deepEqual(view.context, [
    { reference: task.ContentRef(6), value: { summary: "prior work" } },
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
  assert.equal((calls[0] as unknown[])[3], "work:7:2");
  assert.equal((calls[1] as unknown[])[3], "work:7:2");
});

test("operational retry exhaustion reports unavailable with stable authorization", async () => {
  const held = obligation();
  const claim: TicketExecutionClaim = {
    partition,
    identity: "12:0",
    taskKey: "work:7:2",
    obligation: held,
    attempt: 2,
    recoveryEpoch: asRecoveryEpoch("epoch-one"),
  };
  let submitted: { input: unknown } | undefined;
  const completed = await ticketExecutionRun(
    {
      execute: () => Promise.resolve(true),
      cancel: () => Promise.resolve(true),
      claim: (_owner, recoveryEpoch) => {
        assert.equal(recoveryEpoch, claim.recoveryEpoch);
        return Promise.resolve([claim]);
      },
      retry: () => Promise.reject(new Error("exhausted work must not retry")),
      terminal: (_claim, input) => {
        submitted = { input };
        return Promise.resolve(true);
      },
      cancelled: () => Promise.resolve(false),
    },
    () => ({
      put: () => Promise.resolve(task.ContentRef(99)),
      read: (reference) =>
        Promise.resolve({
          mediaType: "application/json",
          content:
            reference === task.ContentRef(3)
              ? "repository"
              : reference === task.ContentRef(5)
                ? "0123456789012345678901234567890123456789"
                : "{}",
        }),
    }),
    {
      run: () =>
        Promise.resolve({
          result: "Retry" as const,
          retryAfterSecs: 1,
          evidence: task.ContentRef(8),
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
  );
  assert.equal(completed, 1);
  const input = submitted?.input as {
    identity: string;
    command: ticket.ReportTaskTerminal;
  };
  assert.equal(input.identity, "execution-terminal:work:7:2");
  assert.equal(input.command.report.terminal.kind, "TaskExecutionUnavailable");
});

test("produced commits have one deterministic publication ref", () => {
  assert.equal(
    ticketExecutionResultRef("0123456789012345678901234567890123456789"),
    "refs/chuggy/results/0123456789012345678901234567890123456789",
  );
  assert.throws(() => ticketExecutionResultRef("ABC"), /lowercase SHA-1/u);
});

test("work context preserves authored text alongside JSON inputs and rework", async () => {
  const held = obligation();
  const authored = new task.TaskObligation(
    held.task,
    held.definition,
    held.source,
    [task.ContentRef(6), task.ContentRef(7), task.ContentRef(8)],
  );
  const context = new Map([
    [6, { mediaType: "text/plain", content: "Fix the importer" }],
    [7, { mediaType: "text/markdown", content: "Report every rejected row." }],
    [
      8,
      {
        mediaType: "application/json",
        content: '{"findings":[{"description":"Rows are dropped"}]}',
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
            content: "{}",
          },
        ),
    },
    authored,
  );
  assert.deepEqual(
    view.context.map((entry) => entry.value),
    [
      "Fix the importer",
      "Report every rejected row.",
      { findings: [{ description: "Rows are dropped" }] },
    ],
  );
});
