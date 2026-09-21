/**
 * The console's copy of the machine's resume points, held against the machine.
 *
 * `ui/chuggy-ui/app/core/resumePoint.ts` restates where each wall said a resume
 * would rejoin the pipeline, because a browser reaches only `src/contract/` and
 * no read carries that rule. This drives the deciders that stamp one and the
 * console derivation over the same states, and requires them to name the same
 * point; the deciders are the oracle and the table is the claim.
 *
 * THE CONSOLE'S INPUT IS DERIVED, NOT ASSERTED. What it sees of a state is its
 * phase, its reason and the last fan-out set the page holds, and each of those
 * is read off the same ticket the decider was handed, so a rule that only
 * happens to agree on hand-picked facts does not pass.
 *
 * NEITHER TREE HOLDS AN ACCOUNT. A failed evaluation is taken the way its
 * caller's `onFailure` says, which is an argument to the decider rather than a
 * budget the ticket carries, and a failed finalization always reworks — there
 * is no finalization wall left to agree on.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { ticketAt } from "../../src/domain/core.ts";
import {
  decideExecutionBlocked,
  decideEvalStageReduce,
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
import { resumePoints } from "../../src/contract/rosters.ts";
import type { ResumePoint } from "../../src/contract/rosters.ts";
import type { ResumeSituation } from "../../ui/chuggy-ui/app/core/resumePoint.ts";
import {
  resumeReenters,
  ticketResumePoint,
} from "../../ui/chuggy-ui/app/core/resumePoint.ts";
import type { ClosedSet } from "../../ui/chuggy-ui/app/core/ticketLedger.ts";

const id = asTicketId(7);
const stage = { fanout: 1, combinator: "UnanimousPass" } as const;

/** The revoke walks the fleet a bounded number of rounds, and the bound is the fleet. */
const fleetOfTwo: Config = { nTickets: 2, nTasks: 2, maxStages: 2 };

function ticketIn(over: Partial<Ticket> = {}): Ticket {
  return {
    phase: "Working",
    deps: new Set<number>(),
    finalizer: "ManagedFinalizer",
    artifact: "NoArtifact",
    workFanout: 1,
    program: [stage, stage],
    tasks: new Set<Task>(),
    record: [],
    spawned: 0,
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
    phase: "Escalated",
    reason: after.reason === "NoReason" ? undefined : after.reason,
    lastSet: lastSetOf(before),
    stageCount: before.program.length,
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

/**
 * A failed evaluation is taken the way its caller's `onFailure` says: reworked
 * with no wall at all, or escalated at the rework wall — the choice is an
 * argument to the decider, not a budget the ticket carries.
 */
test("an evaluation failure reworks or parks by the disposition it is given", () => {
  const before = ticketIn({
    phase: "Evaluating",
    record: taskSet("Work", [1], "Passed"),
    tasks: new Set(taskSet({ type: "Evaluation", value: 0 }, [2], "Failed")),
  });
  const reworked = ticketAt(
    decideEvalStageReduce(coreWith(before), id, "ReworkEvaluationFailure").post,
    id,
  );
  assert.equal(reworked.phase, "Working");
  assert.equal(reworked.reason, "NoReason");

  const escalated = ticketAt(
    decideEvalStageReduce(coreWith(before), id, "EscalateEvaluationFailure")
      .post,
    id,
  );
  assert.equal(escalated.reason, "ReworkBudgetExhausted");
  agrees(before, escalated, "an evaluation wall taken by disposition");
});

test("a program of one stage parks where the machine says it parks", () => {
  const evaluating = ticketIn({
    phase: "Evaluating",
    program: [stage],
    record: taskSet("Work", [1], "Passed"),
    tasks: new Set(taskSet({ type: "Evaluation", value: 0 }, [2], "Failed")),
  });
  agrees(
    evaluating,
    ticketAt(
      decideEvalStageReduce(
        coreWith(evaluating),
        id,
        "EscalateEvaluationFailure",
      ).post,
      id,
    ),
    "a one-stage evaluation wall",
  );
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

test("each point re-enters the phase the console names", () => {
  for (const point of resumePoints) {
    const before = ticketIn({
      phase: "Escalated",
      resumeAt: point,
      record: taskSet("Work", [1], "Passed"),
    });
    const after = ticketAt(decideResumeTicket(coreWith(before), id).post, id);
    assert.equal(after.phase, resumeReenters(point), `phase at ${point}`);
  }
});
