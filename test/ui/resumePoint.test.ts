/**
 * The console's copy of the machine's resume points, held against the machine.
 *
 * `ui/chuggy-ui/app/core/resumePoint.ts` restates `resumeOf`
 * (`src/domain/ticket.ts`), because a browser reaches only `src/contract/` and
 * no read carries that rule. `resumeOf` is total and a pure function of the
 * escalation kind alone — the sum's every variant resumes somewhere, and no
 * fact of the ticket's own history is left to read — so the restatement is
 * held against it directly for every kind, and against the deciders that
 * stamp each kind, to prove both that the kind a scenario stamps is the one
 * it names and that the console's point for it is the machine's.
 *
 * THE WIRE ITSELF NEEDS NO DERIVATION. `escalation.resumeAt` is the answer a
 * ticket read already carries; what this suite pins is that the console's own
 * copy of the rule, kept as the standing proof below, would have given it the
 * same answer.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { ticketAt } from "../../src/domain/ticketGraph.ts";
import {
  decideEvalStageReduce,
  decideExecutionBlocked,
  decideResumeTicket,
  decideWorkReduce,
} from "../../src/domain/deciders.ts";
import { resumeOf } from "../../src/domain/ticket.ts";
import { escalationTags } from "../../src/domain/generated/modelTypes.ts";
import type {
  Escalation,
  Task,
  TaskKind,
  TaskOutcome,
  Ticket,
  TicketGraph,
} from "../../src/domain/generated/modelTypes.ts";
import { asTaskId, asTicketId } from "../../src/domain/ids.ts";
import { resumePoints } from "../../src/contract/rosters.ts";
import type { ResumePoint } from "../../src/contract/rosters.ts";
import type { ResumeSituation } from "../../ui/chuggy-ui/app/core/resumePoint.ts";
import {
  resumeReenters,
  ticketResumePoint,
} from "../../ui/chuggy-ui/app/core/resumePoint.ts";

const id = asTicketId(7);
const stage = { fanout: 1 } as const;

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
    escalation: "NoEscalation",
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

/** The console's whole view of a ticket a decision has just parked. */
function situationOf(before: Ticket, after: Ticket): ResumeSituation {
  return {
    phase: after.phase,
    kind: after.escalation === "NoEscalation" ? undefined : after.escalation,
    stageCount: before.program.length,
  };
}

function agrees(before: Ticket, after: Ticket, what: string): void {
  assert.equal(
    ticketResumePoint(situationOf(before, after)),
    resumeOf(after.escalation),
    `the console and the machine disagreed at ${what}`,
  );
}

test("every kind the sum admits resumes where the machine says it resumes", () => {
  for (const kind of escalationTags) {
    if (kind === "NoEscalation") continue;
    assert.equal(
      ticketResumePoint({ phase: "Escalated", kind, stageCount: 2 }),
      resumeOf(kind),
      `the console and the machine disagreed at ${kind}`,
    );
  }
});

test("a park with no phase to read has nothing to resume", () => {
  assert.equal(
    ticketResumePoint({ phase: "Work", kind: undefined, stageCount: 2 }),
    undefined,
  );
});

test("a failed work set parks where the machine says it parks", () => {
  const before = ticketIn({
    tasks: new Set(taskSet("WorkTask", [1], "Failed")),
  });
  const after = ticketAt(decideWorkReduce(graphWith(before), id).post, id);
  assert.equal(after.escalation, "WorkFailureEscalated");
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
  assert.equal(reworked.escalation, "NoEscalation");

  const escalated = ticketAt(
    decideEvalStageReduce(graphWith(before), id, "EscalateEvaluationFailure")
      .post,
    id,
  );
  assert.equal(escalated.escalation, "EvaluationFailureEscalated");
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

/**
 * The same interruption names two different walls by the phase it caught: a
 * work park buys a new artifact, an evaluation park still has an intact
 * judgement to make.
 */
test("a blocked execution parks where the machine says it parks, in both phases", () => {
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
      decideExecutionBlocked(graphWith(before), id).post,
      id,
    );
    agrees(before, after, `a blocked execution in ${held.phase}`);
  }
});

/** The one kind that resumes at a given point, for building a park the resume
 * decider will actually re-enter. */
function kindResumingAt(point: ResumePoint): Escalation {
  const found = escalationTags.find((kind) => resumeOf(kind) === point);
  if (found === undefined)
    throw new Error(`no escalation the sum admits resumes at ${point}`);
  return found;
}

test("each point re-enters the phase the console names", () => {
  for (const point of resumePoints) {
    const before = ticketIn({
      phase: "Escalated",
      escalation: kindResumingAt(point),
      record: taskSet("WorkTask", [1], "Passed"),
    });
    const after = ticketAt(decideResumeTicket(graphWith(before), id).post, id);
    assert.equal(after.phase, resumeReenters(point), `phase at ${point}`);
  }
});
