import assert from "node:assert/strict";
import test from "node:test";

import * as task from "../../src/domain/chuggernaut/task.js";
import type { TicketContentStore } from "../../src/interpreter/ticketCatalog.ts";
import {
  ticketExecutionOutcomeReport,
  ticketExecutionVerdict,
  type TicketExecutionOutcomeView,
} from "../../src/interpreter/ticketExecutionOutcome.ts";

const definition = new task.TaskDefinition(
  task.ContentRef(1),
  task.ContentRef(2),
  new task.ExecutionRequirements(),
  task.ContentRef(4),
);
const work = new task.TaskObligation(
  new task.WorkTaskId(task.TicketId(1), task.CycleNumber(1)),
  definition,
  task.ContextRef(1),
);
const review = new task.TaskObligation(
  new task.EvaluationTaskId(
    task.TicketId(1),
    task.CycleNumber(1),
    task.StageKey(1),
    task.Generation(1),
    task.EvaluatorKey(1),
  ),
  definition,
  task.ContextRef(1),
);
const view: TicketExecutionOutcomeView = {
  resultContract: { type: "object" },
  repository: "https://git.invalid/owner/repository.git",
  source: task.ContentRef(3),
  access: "ReadRepository",
};

/** Every put a derivation makes, in order, so evidence can be read back by content. */
function stored(): {
  readonly content: TicketContentStore;
  readonly puts: { readonly mediaType: string; readonly content: string }[];
} {
  const puts: { readonly mediaType: string; readonly content: string }[] = [];
  return {
    puts,
    content: {
      put: (mediaType, content) => {
        puts.push({ mediaType, content });
        return Promise.resolve(task.ContentRef(puts.length + 100));
      },
      read: () => Promise.resolve(undefined),
    },
  };
}

test("a manifest is read for a verdict and for findings a rework can cite", () => {
  assert.throws(
    () => ticketExecutionVerdict({ verdict: "PASS" }),
    /verdict is invalid/u,
  );
  assert.throws(
    () =>
      ticketExecutionVerdict({
        verdict: "pass",
        findings: [{ description: "unexpected" }],
      }),
    /passing evaluator manifest/u,
  );
  assert.throws(
    () =>
      ticketExecutionVerdict({
        verdict: "fail",
        findings: [
          { id: 1, description: "first" },
          { id: 1, description: "second" },
        ],
      }),
    /finding identity is repeated/u,
  );
  assert.equal(ticketExecutionVerdict({}).kind, "EvaluatorPass");
  assert.equal(
    ticketExecutionVerdict({
      verdict: "failed",
      findings: [{ id: 1.5, description: "fractional falls back" }],
    }).kind,
    "EvaluatorFail",
  );
});

test("a read-only work result is accepted on the source it never moved off", async () => {
  const held = stored();
  const report = await ticketExecutionOutcomeReport(held.content, work, view, {
    type: "result",
    manifest: { note: "done" },
    outputs: [],
  });
  assert.equal(report.kind, "WorkResultReport");
  if (report.kind !== "WorkResultReport")
    throw new Error("work produced another report");
  assert.equal(report.accepted_source_ref, view.source);
  assert.deepEqual(held.puts, [
    { mediaType: "application/json", content: '{"note":"done"}' },
  ]);
});

test("a publishing work result is accepted on the one commit it named", async () => {
  const held = stored();
  const report = await ticketExecutionOutcomeReport(
    held.content,
    work,
    { ...view, access: "PublishRepositoryResult" },
    {
      type: "result",
      manifest: {},
      outputs: [
        {
          repository: view.repository,
          commit: "ABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD",
        },
      ],
    },
  );
  assert.equal(report.kind, "WorkResultReport");
  assert.equal(
    held.puts.at(-1)?.content,
    JSON.stringify({
      commit: "abcdefabcdefabcdefabcdefabcdefabcdefabcd",
      repository: view.repository,
    }),
  );
});

test("an evaluator's terminal carries the verdict its manifest declared", async () => {
  const held = stored();
  const report = await ticketExecutionOutcomeReport(
    held.content,
    review,
    view,
    {
      type: "result",
      manifest: {
        verdict: "failed",
        findings: [{ id: 1.5, description: "fractional falls back" }],
      },
      outputs: [],
    },
  );
  assert.equal(report.kind, "EvaluationResultReport");
  if (report.kind !== "EvaluationResultReport")
    throw new Error("an evaluator produced a work report");
  assert.equal(report.verdict.kind, "EvaluatorFail");
});

for (const [why, obligation, offered, expected] of [
  ["worker outcome must be an object", work, null, undefined],
  [
    "ticket execution output repository is invalid",
    work,
    {
      type: "result",
      manifest: {},
      outputs: [{ repository: "wrong", commit: "not-a-commit" }],
    },
    "PublishRepositoryResult",
  ],
  [
    "read-only ticket execution produced an output",
    work,
    { type: "result", manifest: {}, outputs: [{}] },
    undefined,
  ],
  [
    "ticket execution result must be an object",
    work,
    { type: "result", manifest: [], outputs: [] },
    undefined,
  ],
  [
    "a passing evaluator manifest cannot contain findings",
    review,
    {
      type: "result",
      manifest: { verdict: "pass", findings: [{ description: "unexpected" }] },
      outputs: [],
    },
    undefined,
  ],
] as const)
  test(`an outcome the protocol cannot read is a process failure: ${why}`, async () => {
    const held = stored();
    const report = await ticketExecutionOutcomeReport(
      held.content,
      obligation,
      expected === undefined ? view : { ...view, access: expected },
      offered,
    );
    assert.equal(report.kind, "TerminalFailureReport");
    if (report.kind !== "TerminalFailureReport")
      throw new Error("a malformed outcome produced a result");
    assert.equal(report.kind_of_failure.kind, "ProcessFailure");
    assert.equal(held.puts.at(-1)?.mediaType, "text/plain");
    assert.match(held.puts.at(-1)?.content ?? "", new RegExp(why, "u"));
  });

test("a manifest the ticket's own contract refuses is a process failure", async () => {
  const held = stored();
  const report = await ticketExecutionOutcomeReport(
    held.content,
    work,
    { ...view, resultContract: { type: "object", required: ["verdict"] } },
    { type: "result", manifest: { note: "done" }, outputs: [] },
  );
  assert.equal(report.kind, "TerminalFailureReport");
  assert.match(held.puts.at(-1)?.content ?? "", /result contract violation/u);
});

test("a harness that could not run at all is unavailable rather than failed", async () => {
  const held = stored();
  const report = await ticketExecutionOutcomeReport(held.content, work, view, {
    type: "execution_unavailable",
    evidence: "workload exceeded its operational bound",
  });
  assert.equal(report.kind, "TerminalFailureReport");
  if (report.kind !== "TerminalFailureReport")
    throw new Error("an unavailable attempt produced a result");
  assert.equal(report.kind_of_failure.kind, "ExecutionUnavailableFailure");
  assert.deepEqual(held.puts, [
    {
      mediaType: "text/plain",
      content: "workload exceeded its operational bound",
    },
  ]);
});

test("a failure a harness could not describe still reaches the ticket", async () => {
  const held = stored();
  const report = await ticketExecutionOutcomeReport(held.content, work, view, {
    type: "process_failed",
    evidence: 17,
  });
  assert.equal(report.kind, "TerminalFailureReport");
  assert.equal(
    held.puts.at(-1)?.content,
    "ticket worker returned an invalid outcome",
  );
});
