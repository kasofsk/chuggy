/**
 * The console's copy of the machine's resume points, held against the machine.
 *
 * `ui/chuggy-ui/app/core/resumePoint.ts` restates where each wall said a resume
 * would rejoin the pipeline, because a browser reaches only `src/contract/` and
 * no read carries the point. This drives the deciders that stamp one and the
 * console derivation over the same states, and requires them to name the same
 * point; the deciders are the oracle and the table is the claim.
 *
 * THE CONSOLE'S INPUT IS DERIVED, NOT ASSERTED. What it sees of a state is its
 * phase, its reason and the last fan-out set the page holds, and each of those
 * is read off the same ticket the decider was handed, so a rule that only
 * happens to agree on hand-picked facts does not pass.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { ticketAt } from "../../src/domain/core.ts";
import {
  decideExecutionBlocked,
  decideEvalStageReduce,
  decideFinalizationResult,
  decideResumeTicket,
  decideRevoke,
  decideWorkReduce,
} from "../../src/domain/deciders.ts";
import type { Config } from "../../src/domain/config.ts";
import { executionBlockedReasons } from "../../src/domain/enablement.ts";
import type {
  Core,
  Task,
  TaskKind,
  TaskOutcome,
  Ticket,
} from "../../src/domain/generated/modelTypes.ts";
import { asTaskId, asTicketId } from "../../src/domain/ids.ts";
import { combine } from "../../src/domain/program.ts";
import type {
  ResumePoint,
  ResumeSituation,
} from "../../ui/chuggy-ui/app/core/resumePoint.ts";
import {
  resumeGasCharge,
  resumePoints,
  resumeReenters,
  ticketResumePoint,
} from "../../ui/chuggy-ui/app/core/resumePoint.ts";
import type { ClosedSet } from "../../ui/chuggy-ui/app/core/ticketLedger.ts";

const id = asTicketId(7);
const stage = { fanout: 1, combinator: "UnanimousPass" } as const;

/** The revoke walks the fleet a bounded number of rounds, and the bound is the fleet. */
const fleetOfTwo: Config = {
  nTickets: 2,
  nTasks: 2,
  reworkPolicy: { type: "BudgetedRework", value: 2 },
  gas: 4,
  finalizationPricing: "DeadlineOnly",
  maxStages: 2,
};

function ticketIn(over: Partial<Ticket> = {}): Ticket {
  return {
    phase: "Working",
    deps: new Set<number>(),
    finalizer: "ManagedFinalizer",
    artifact: "NoArtifact",
    workFanout: 1,
    reworkPolicy: { type: "BudgetedRework", value: 2 },
    finalizationPricing: "DeadlineOnly",
    resumePricing: "RetryCharged",
    program: [stage, stage],
    tasks: new Set<Task>(),
    record: [],
    spawned: 0,
    reworkLeft: 2,
    finalizationLeft: 0,
    gasLeft: 4,
    resumeAt: "NoResume",
    reason: "NoReason",
    completions: 0,
    ...over,
  };
}

function coreWith(ticket: Ticket): Core {
  return { tickets: new Map([[id, ticket]]) };
}

/** A settled fan-out of one kind, as the machine holds it before it retires it. */
function taskSet(
  kind: TaskKind,
  ids: readonly number[],
  outcome: TaskOutcome,
): readonly Task[] {
  return ids.map((each) => ({
    id: asTaskId(each),
    kind,
    state: { type: "Resolved", value: outcome },
  }));
}

/** The verdict the console reads off a settled set, by the stage's own combinator. */
function closedVerdict(
  ticket: Ticket,
  tasks: readonly Task[],
): ClosedSet["verdict"] {
  if (
    tasks.every(
      (task) =>
        task.state !== "Outstanding" && task.state.value === "Cancelled",
    )
  )
    return "Cancelled";
  const kind = tasks[0]?.kind;
  const combinator =
    kind === undefined || kind === "Work"
      ? "UnanimousPass"
      : (ticket.program[kind.value]?.combinator ?? "UnanimousPass");
  return combine(combinator, new Set(tasks)) ? "Passed" : "Failed";
}

/**
 * What the console's ledger would hold as this ticket's last set: the live
 * fan-out where one is running, and the tail of the record otherwise.
 */
function lastSetOf(ticket: Ticket): ClosedSet | undefined {
  const held = ticket.tasks.size > 0 ? [...ticket.tasks] : [...ticket.record];
  const last = held.at(-1);
  if (last === undefined) return undefined;
  const tail = held.filter((task) => sameKind(task.kind, last.kind));
  return {
    taskKind: last.kind === "Work" ? "Work" : "Evaluation",
    stage: last.kind === "Work" ? undefined : last.kind.value,
    verdict: closedVerdict(ticket, tail),
  };
}

function sameKind(left: TaskKind, right: TaskKind): boolean {
  if (left === "Work") return right === "Work";
  return right !== "Work" && right.value === left.value;
}

/** The console's whole view of a ticket a decision has just parked. */
function situationOf(before: Ticket, after: Ticket): ResumeSituation {
  return {
    phase: after.phase === "HandoffBlocked" ? "HandoffBlocked" : "Escalated",
    reason: after.reason === "NoReason" ? undefined : after.reason,
    lastSet: lastSetOf(before),
    stageCount: before.program.length,
    resumePricing: before.resumePricing,
    resumeAt: undefined,
  };
}

/** What the decider stamped, in the console's own vocabulary for it. */
function stampedPoint(after: Ticket): ResumePoint | undefined {
  return after.resumeAt === "NoResume" ? undefined : after.resumeAt;
}

function agrees(before: Ticket, after: Ticket, what: string): void {
  assert.equal(
    ticketResumePoint(situationOf(before, after)),
    stampedPoint(after),
    `the console and the machine disagreed at ${what}`,
  );
}

test("a failed work set parks where the machine says it parks", () => {
  const before = ticketIn({
    tasks: new Set(taskSet("Work", [1], "Failed")),
  });
  const after = ticketAt(decideWorkReduce(coreWith(before), id).post, id);
  assert.equal(after.reason, "WorkFailed");
  agrees(before, after, "a failed work set");
});

test("the two evaluation walls park where the machine says they park", () => {
  for (const spent of [
    { reworkLeft: 0, gasLeft: 4, reason: "ReworkBudgetExhausted" },
    { reworkLeft: 1, gasLeft: 0, reason: "GasExhausted" },
  ]) {
    const before = ticketIn({
      phase: "Evaluating",
      reworkLeft: spent.reworkLeft,
      gasLeft: spent.gasLeft,
      record: taskSet("Work", [1], "Passed"),
      tasks: new Set(taskSet({ type: "Evaluation", value: 0 }, [2], "Failed")),
    });
    const after = ticketAt(
      decideEvalStageReduce(coreWith(before), id).post,
      id,
    );
    assert.equal(after.reason, spent.reason);
    agrees(before, after, `an evaluation wall at ${spent.reason}`);
  }
});

test("the two finalization walls park where the machine says they park", () => {
  for (const priced of [
    {
      finalizationPricing: "DeadlineOnly" as const,
      finalizationLeft: 0,
      gasLeft: 0,
    },
    {
      finalizationPricing: { type: "Budgeted", value: 1 } as const,
      finalizationLeft: 0,
      gasLeft: 4,
    },
  ]) {
    const before = ticketIn({
      phase: "Finalizing",
      ...priced,
      record: [
        ...taskSet("Work", [1], "Passed"),
        ...taskSet({ type: "Evaluation", value: 0 }, [2], "Passed"),
        ...taskSet({ type: "Evaluation", value: 1 }, [3], "Passed"),
      ],
    });
    const after = ticketAt(
      decideFinalizationResult(coreWith(before), id, "FinalizationFailed").post,
      id,
    );
    assert.equal(after.phase, "Escalated");
    agrees(before, after, `a finalization wall under ${String(after.reason)}`);
  }
});

test("a program of one stage parks where the machine says it parks", () => {
  const evaluating = ticketIn({
    phase: "Evaluating",
    program: [stage],
    reworkLeft: 1,
    gasLeft: 0,
    record: taskSet("Work", [1], "Passed"),
    tasks: new Set(taskSet({ type: "Evaluation", value: 0 }, [2], "Failed")),
  });
  agrees(
    evaluating,
    ticketAt(decideEvalStageReduce(coreWith(evaluating), id).post, id),
    "a one-stage evaluation wall",
  );
  for (const priced of [
    { finalizationPricing: "DeadlineOnly" as const, gasLeft: 0 },
    {
      finalizationPricing: { type: "Budgeted", value: 1 } as const,
      gasLeft: 4,
    },
  ]) {
    const before = ticketIn({
      phase: "Finalizing",
      program: [stage],
      finalizationLeft: 0,
      ...priced,
      record: [
        ...taskSet("Work", [1], "Passed"),
        ...taskSet({ type: "Evaluation", value: 0 }, [2], "Passed"),
      ],
    });
    const after = ticketAt(
      decideFinalizationResult(coreWith(before), id, "FinalizationFailed").post,
      id,
    );
    assert.equal(after.phase, "Escalated");
    agrees(
      before,
      after,
      `a one-stage finalization wall at ${String(after.reason)}`,
    );
  }
});

test("a blocked execution parks where the machine says it parks, in both phases", () => {
  for (const reason of executionBlockedReasons) {
    for (const held of [
      {
        phase: "Working" as const,
        tasks: new Set(taskSet("Work", [1], "Cancelled")),
      },
      {
        phase: "Evaluating" as const,
        record: taskSet("Work", [1], "Passed"),
        tasks: new Set(
          taskSet({ type: "Evaluation", value: 0 }, [2], "Cancelled"),
        ),
      },
    ]) {
      const before = ticketIn(held);
      const after = ticketAt(
        decideExecutionBlocked(coreWith(before), id, reason).post,
        id,
      );
      agrees(before, after, `${reason} in ${held.phase}`);
    }
  }
});

test("a ticket parked by a revoked dependency is offered no resume", () => {
  const dependent = asTicketId(8);
  const core: Core = {
    tickets: new Map([
      [id, ticketIn({ phase: "Pending", tasks: new Set<Task>() })],
      [
        dependent,
        ticketIn({
          phase: "Pending",
          deps: new Set([id]),
          tasks: new Set<Task>(),
        }),
      ],
    ]),
  };
  const after = ticketAt(decideRevoke(fleetOfTwo, core, id).post, dependent);
  assert.equal(after.reason, "DependencyRevoked");
  agrees(ticketAt(core, dependent), after, "a revoked dependency");
});

test("a handoff nothing could prove parks at its own publication", () => {
  const before = ticketIn({ phase: "PublishingHandoff" });
  const after = ticketAt(
    decideFinalizationResult(coreWith(before), id, "HandoffPublicationUnproven")
      .post,
    id,
  );
  assert.equal(after.phase, "HandoffBlocked");
  agrees(before, after, "an unproven handoff");
});

test("each point re-enters the phase the console names, at the charge it names", () => {
  for (const point of resumePoints) {
    for (const pricing of ["RetryCharged", "RetryFree"] as const) {
      const before = ticketIn({
        phase: "Escalated",
        resumeAt: point,
        resumePricing: pricing,
        reason: "GasExhausted",
        record: taskSet("Work", [1], "Passed"),
      });
      const after = ticketAt(decideResumeTicket(coreWith(before), id).post, id);
      assert.equal(after.phase, resumeReenters(point), `phase at ${point}`);
      assert.equal(
        before.gasLeft - after.gasLeft,
        resumeGasCharge(point, pricing),
        `charge at ${point} under ${pricing}`,
      );
    }
  }
});
