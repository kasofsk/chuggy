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

import { ticketAt } from "../../src/domain/ticketGraph.ts";
import {
  decideExecutionBlocked,
  decideEvalStageReduce,
  decideResumeTicket,
  decideWorkReduce,
} from "../../src/domain/deciders.ts";
import { executionBlockedReasons } from "../../src/domain/enablement.ts";
import type {
  Reason,
  Resume,
  Task,
  TaskKind,
  TaskOutcome,
  Ticket,
  TicketGraph,
} from "../../src/domain/generated/modelTypes.ts";
import { asTaskId, asTicketId } from "../../src/domain/ids.ts";
import { combine } from "../../src/domain/program.ts";
import { resumePoints } from "../../src/contract/rosters.ts";
import type {
  EscalationReason,
  ResumePoint,
} from "../../src/contract/rosters.ts";
import type { ResumeSituation } from "../../ui/chuggy-ui/app/core/resumePoint.ts";
import {
  resumeReenters,
  ticketResumePoint,
} from "../../ui/chuggy-ui/app/core/resumePoint.ts";
import type { ClosedSet } from "../../ui/chuggy-ui/app/core/ticketLedger.ts";

const id = asTicketId(7);
const stage = { fanout: 1 } as const;

/**
 * The machine's absent reason, which the wire omits rather than names. The two
 * rosters are otherwise the same words — `test/contract/rosters.test.ts` holds
 * them so — which is why nothing here maps between them.
 */
function statedReason(reason: Reason): EscalationReason | undefined {
  return reason === "NoReason" ? undefined : reason;
}

/** The same for the absent resume. */
function statedPoint(resume: Resume): ResumePoint | undefined {
  return resume === "NoResume" ? undefined : resume;
}

function ticketIn(over: Partial<Ticket> = {}): Ticket {
  return {
    phase: "Work",
    deps: new Set<number>(),
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

function graphWith(ticket: Ticket): TicketGraph {
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

/** The verdict the console reads off a settled set. */
function closedVerdict(tasks: readonly Task[]): ClosedSet["verdict"] {
  if (
    tasks.every(
      (task) =>
        task.state !== "Outstanding" && task.state.value === "Cancelled",
    )
  )
    return "Cancelled";
  return combine(new Set(tasks)) ? "Passed" : "Failed";
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
    taskKind: last.kind === "WorkTask" ? "Work" : "Evaluation",
    stage: last.kind === "WorkTask" ? undefined : last.kind.value,
    verdict: closedVerdict(tail),
  };
}

function sameKind(left: TaskKind, right: TaskKind): boolean {
  if (left === "WorkTask") return right === "WorkTask";
  return right !== "WorkTask" && right.value === left.value;
}

/** The console's whole view of a ticket a decision has just parked. */
function situationOf(before: Ticket, after: Ticket): ResumeSituation {
  return {
    phase: "Escalated",
    reason: statedReason(after.reason),
    lastSet: lastSetOf(before),
    stageCount: before.program.length,
    resumeAt: undefined,
  };
}

/** What the decider stamped, where it stamped anything. */
function stampedPoint(after: Ticket): ResumePoint | undefined {
  return statedPoint(after.resumeAt);
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
    tasks: new Set(taskSet("WorkTask", [1], "Failed")),
  });
  const after = ticketAt(decideWorkReduce(graphWith(before), id).post, id);
  assert.equal(after.reason, "WorkFailureEscalated");
  agrees(before, after, "a failed work set");
});

/**
 * A failed evaluation is taken the way its caller's `onFailure` says: reworked
 * with no wall at all, or escalated at the rework wall — the choice is an
 * argument to the decider, not a budget the ticket carries.
 */
test("an evaluation failure reworks or parks by the disposition it is given", () => {
  const before = ticketIn({
    phase: "Evaluation",
    record: taskSet("WorkTask", [1], "Passed"),
    tasks: new Set(
      taskSet({ type: "EvaluationTask", value: 0 }, [2], "Failed"),
    ),
  });
  const reworked = ticketAt(
    decideEvalStageReduce(graphWith(before), id, "ReworkEvaluationFailure")
      .post,
    id,
  );
  assert.equal(reworked.phase, "Work");
  assert.equal(reworked.reason, "NoReason");

  const escalated = ticketAt(
    decideEvalStageReduce(graphWith(before), id, "EscalateEvaluationFailure")
      .post,
    id,
  );
  assert.equal(escalated.reason, "EvaluationFailureEscalated");
  agrees(before, escalated, "an evaluation wall taken by disposition");
});

test("a program of one stage parks where the machine says it parks", () => {
  const evaluating = ticketIn({
    phase: "Evaluation",
    program: [stage],
    record: taskSet("WorkTask", [1], "Passed"),
    tasks: new Set(
      taskSet({ type: "EvaluationTask", value: 0 }, [2], "Failed"),
    ),
  });
  agrees(
    evaluating,
    ticketAt(
      decideEvalStageReduce(
        graphWith(evaluating),
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
        phase: "Work" as const,
        tasks: new Set(taskSet("WorkTask", [1], "Cancelled")),
      },
      {
        phase: "Evaluation" as const,
        record: taskSet("WorkTask", [1], "Passed"),
        tasks: new Set(
          taskSet({ type: "EvaluationTask", value: 0 }, [2], "Cancelled"),
        ),
      },
    ]) {
      const before = ticketIn(held);
      const after = ticketAt(
        decideExecutionBlocked(graphWith(before), id, reason).post,
        id,
      );
      agrees(before, after, `${reason} in ${held.phase}`);
    }
  }
});

test("each point re-enters the phase the console names", () => {
  for (const point of resumePoints) {
    const before = ticketIn({
      phase: "Escalated",
      resumeAt: point,
      record: taskSet("WorkTask", [1], "Passed"),
    });
    const after = ticketAt(decideResumeTicket(graphWith(before), id).post, id);
    assert.equal(after.phase, resumeReenters(point), `phase at ${point}`);
  }
});
