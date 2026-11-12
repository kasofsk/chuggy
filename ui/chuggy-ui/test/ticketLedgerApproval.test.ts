/**
 * An approval evaluator's run in the ledger, the Runs tab's reading of it and
 * the Overview's card: it reads as awaiting a person while open, as
 * approved or rejected once answered and as withdrawn once no longer owed,
 * never as queued or running, a stage
 * beside a running evaluator still reads as running, and a rejection's next
 * cycle reads as any rework does.
 */

import { expect, test } from "vitest";

import type {
  ExecutionSummary,
  ExecutionsResponse,
  NativeActionResponse,
} from "../../../src/contract/responses.ts";
import { copyTextEn } from "../app/copy/catalog.ts";
import {
  approvalHappened,
  approvalStandingOf,
} from "../app/core/evaluationApprovals.ts";
import { ticketLedger } from "../app/core/ticketLedger.ts";
import type { RanStage } from "../app/core/ticketLedger.ts";
import {
  ticketRunLive,
  ticketRunsOf,
  ticketRunVerdictLabel,
  ticketRunViewsOffered,
} from "../app/core/ticketRuns.ts";
import type { TicketRunStep, TicketRunsCycle } from "../app/core/ticketRuns.ts";
import { ticketSlot } from "../app/core/ticketSituation.ts";
import { ticketInstants } from "./ticketInstants.ts";
import {
  evalIdentity,
  ledgerExecution,
  workIdentity,
} from "./ticketLedgerFixture.ts";
import type { ExecutionShape } from "./ticketLedgerFixture.ts";

/** An approval's row: no requirement, which is what names it one, and no runner's figures. */
function approvalExecution(shape: ExecutionShape): ExecutionSummary {
  const row: Partial<ExecutionSummary> = { ...ledgerExecution(shape) };
  delete row.requirement;
  delete row.requirementDigest;
  delete row.requirementSource;
  delete row.platformDefaultVersion;
  delete row.takenAt;
  return row as ExecutionSummary;
}

const workPassed = ledgerExecution({
  execution: "w1",
  task: 1,
  identity: workIdentity(1),
  outcome: "Passed",
});

const awaiting = approvalExecution({
  execution: "a1",
  task: 2,
  identity: evalIdentity(1, 1, 1),
  status: "Awaiting",
});

const program = [{ key: 1, evaluators: [{ key: 1 }, { key: 2 }] }];

function pageOf(executions: readonly ExecutionSummary[]): ExecutionsResponse {
  return { executions: [...executions] };
}

/** The Runs tab's cycles over a page, newest first, landing nothing. */
function cyclesOf(
  executions: readonly ExecutionSummary[],
): readonly TicketRunsCycle[] {
  return ticketRunsOf(
    ticketLedger(pageOf(executions), program),
    { byCycle: new Map(), unheld: [] },
    { names: ["Review"], lands: false },
    copyTextEn,
  );
}

function runsOf(
  executions: readonly ExecutionSummary[],
): readonly TicketRunStep[] {
  return cyclesOf(executions)
    .flatMap((cycle) => cycle.rows)
    .filter((row): row is TicketRunStep => row.kind === "Run");
}

function stageOf(executions: readonly ExecutionSummary[]): RanStage {
  const stage = ticketLedger(pageOf(executions), program).cycles[0]?.stages[0];
  if (stage?.kind !== "Ran") throw new Error("no stage ran");
  return stage;
}

function stepOf(
  executions: readonly ExecutionSummary[],
  execution: string,
): TicketRunStep {
  const step = runsOf(executions).find(
    (row) => row.execution.execution === execution,
  );
  if (step === undefined) throw new Error(`no row for ${execution}`);
  return step;
}

test("an approval waiting on a person reads as awaiting it, and never as starting or running", () => {
  const step = stepOf([workPassed, awaiting], "a1");
  expect(step.approval).toBe(true);
  expect(step.verdict).toBe("Awaiting");
  expect(copyTextEn(ticketRunVerdictLabel(step.verdict, true))).toBe(
    "Awaiting approval",
  );
  expect(ticketRunLive(step.verdict)).toBe(false);
  expect(stageOf([workPassed, awaiting]).verdict).toBe("Awaiting");
  const cycle = cyclesOf([workPassed, awaiting])[0];
  expect(cycle?.outcome).toBe("Awaiting approval at Review");
});

test("an answered approval reads as approved or rejected, and a run a worker judged as its verdict", () => {
  const approved = approvalExecution({
    execution: "a1",
    task: 2,
    identity: evalIdentity(1, 1, 1),
    outcome: "Passed",
  });
  const rejected = { ...approved, outcome: "Failed" as const };
  for (const [row, word] of [
    [approved, "Approved"],
    [rejected, "Rejected"],
  ] as const) {
    const step = stepOf([workPassed, row], "a1");
    expect(copyTextEn(ticketRunVerdictLabel(step.verdict, step.approval))).toBe(
      word,
    );
  }
  const judged = stepOf(
    [
      workPassed,
      ledgerExecution({
        execution: "j1",
        task: 2,
        identity: evalIdentity(1, 1, 1),
        outcome: "Passed",
      }),
    ],
    "j1",
  );
  expect(judged.approval).toBe(false);
  expect(
    copyTextEn(ticketRunVerdictLabel(judged.verdict, judged.approval)),
  ).toBe("Passed");
});

test("a withdrawn approval reads as withdrawn when it ended, and never as waiting or answered", () => {
  const withdrawn = approvalExecution({
    execution: "a1",
    task: 2,
    identity: evalIdentity(1, 1, 1),
    status: "Cancelled",
    terminalAt: "2026-08-26T01:00:00Z",
  });
  expect(approvalStandingOf(withdrawn)).toBe("Withdrawn");
  const happened = approvalHappened(withdrawn);
  expect(happened.at).toBe("2026-08-26T01:00:00Z");
  expect(copyTextEn(happened.happened)).toBe("Withdrawn");
  const step = stepOf([workPassed, withdrawn], "a1");
  expect(ticketRunLive(step.verdict)).toBe(false);
  expect(
    copyTextEn(ticketRunVerdictLabel(step.verdict, step.approval)),
  ).not.toMatch(/Awaiting|Approved|Rejected/u);
  expect(approvalStandingOf(awaiting)).toBe("Waiting");
  expect(copyTextEn(approvalHappened(awaiting).happened)).toBe("Asked");
});

test("a stage holding an approval beside a running evaluator runs, and each row reads as its own", () => {
  const running = ledgerExecution({
    execution: "r1",
    task: 3,
    identity: evalIdentity(1, 1, 1, 2),
    status: "Running",
    carrier: "Agent",
    runStartedAt: "2026-08-26T00:30:00Z",
  });
  const executions = [workPassed, awaiting, running];
  expect(stageOf(executions).verdict).toBe("Running");
  expect(stepOf(executions, "a1").verdict).toBe("Awaiting");
  expect(stepOf(executions, "r1").verdict).toBe("Running");
  expect(stepOf(executions, "a1").name).toBe("Review · 1");
  expect(stepOf(executions, "r1").name).toBe("Review · 2");
});

test("an approval's page offers its Summary alone", () => {
  expect(
    ticketRunViewsOffered({
      approval: true,
      commands: false,
      agent: false,
      carried: false,
    }),
  ).toStrictEqual(["Summary"]);
});

test("after a rejection the next cycle reads as any rework does", () => {
  const rejected = approvalExecution({
    execution: "a1",
    task: 2,
    identity: evalIdentity(1, 1, 1),
    outcome: "Failed",
  });
  const rework = ledgerExecution({
    execution: "w2",
    task: 3,
    identity: workIdentity(2),
    status: "Running",
  });
  const cycles = cyclesOf([workPassed, rejected, rework]);
  expect(cycles.map((cycle) => [cycle.ordinal, cycle.outcome])).toStrictEqual([
    [2, "Running work"],
    [1, "Sent back by Review"],
  ]);
});

const asked: NativeActionResponse = {
  action: "action-eval",
  kind: "EvaluationApproval",
  authorizingSequence: 5,
  admits: ["Approve", "Reject"],
  answerable: true,
  approval: {
    execution: "a1",
    workCycle: 1,
    stage: 1,
    generation: 1,
    evaluator: 1,
    approvers: "Admin",
  },
};

function slotOver(open: readonly NativeActionResponse[] | undefined) {
  const executions = [workPassed, awaiting];
  return ticketSlot(
    {
      ticket: {
        ticket: 21,
        phase: "Evaluation",
        sequence: 4,
        program,
        ...ticketInstants,
      },
      landings: [],
      ledger: ticketLedger(pageOf(executions), program),
      names: ["Review"],
      open,
      executions,
      setupOverridable: false,
      nowMs: 0,
    },
    copyTextEn,
  );
}

test("the Overview's card never presents a waiting approval as a run going now", () => {
  expect(slotOver(undefined)).toStrictEqual({ slot: "Nothing" });
  const needs = slotOver([asked]);
  expect(needs.slot).toBe("NeedsYou");
  if (needs.slot !== "NeedsYou") return;
  expect(needs.detail).toBe("Awaiting evaluation approval");
  expect(needs.approvals.map((approval) => approval.step)).toStrictEqual([
    "Review",
  ]);
  expect(needs.approvals[0]?.work).toBe(1);
  expect(needs.approvals[0]?.run).toBe(2);
});

test("a reader the approval does not ask reads the card as awaiting it, from whom it asks", () => {
  const awaited = slotOver([{ ...asked, answerable: false }]);
  expect(awaited.slot).toBe("Awaiting");
  if (awaited.slot !== "Awaiting") return;
  expect(awaited.detail).toBe("Awaiting evaluation approval");
  const approvers = awaited.approvals[0]?.approvers;
  expect(
    approvers?.by === "Role" ? copyTextEn(approvers.role) : undefined,
  ).toBe("Any admin of this project");
  expect(awaited.approvals[0]?.answers).toStrictEqual([]);
});
