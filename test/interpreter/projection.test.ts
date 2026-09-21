/**
 * The projection as a derivation: that folding what each decision changed
 * reaches the same table as reading the whole replayed state.
 *
 * THIS IS THE CLAIM THAT MAKES IT A PROJECTION. 006 says the projections are
 * rebuildable from the journal and are not a second semantic authority, and
 * the two halves of that are one function here: a decision writes only the
 * rows it moved, and a rebuild writes them all. If the two ever disagree the
 * stored table is a second authority, whatever it is called.
 *
 * IT IS PURE, SO IT IS TESTED HERE. PostgreSQL transaction tests assert the
 * stored sequence; whether the delta is right needs no server at all.
 *
 * THE DELTA IS NOT THE RECORD'S TRANSITIONS, and the last case is why. A
 * release transitions nothing — it creates a ticket that had no prior phase to
 * leave — so a projection driven off `StepRecord` would never file the row it
 * created.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  dispatchEvent,
  evalReduceEvent,
  execDecisionEvent,
  releaseTicketEvent,
  resumeTicketEvent,
  taskDoneEvent,
  workReduceEvent,
  type DecisionEvent,
} from "../../src/actor/decisionEvent.ts";
import { genesis, replayCore, type Entry } from "../../src/actor/journal.ts";
import { actorInit, journalStep } from "../../src/actor/state.ts";
import { ticketAt } from "../../src/domain/core.ts";
import type {
  Core,
  Reason,
  Ticket,
} from "../../src/domain/generated/modelTypes.ts";
import { asTaskId } from "../../src/domain/ids.ts";
import {
  projectionChanges,
  projectionOf,
} from "../../src/interpreter/projectWriter.ts";
import type { TicketProjection } from "../../src/interpreter/projectDecision.ts";
import {
  plainAuthoring,
  plainResult,
  refinementInstance,
} from "../actor/harness.ts";
import { id } from "../domain/fixtures.ts";

/** A history long enough to release a ticket, move it, and then change its task ledger. */
const history: readonly DecisionEvent[] = [
  releaseTicketEvent(id(1), plainAuthoring),
  dispatchEvent(id(1)),
  taskDoneEvent(id(1), asTaskId(1), "Pass", plainResult),
];

/** The journal that history writes, which is what a rebuild reads. */
function journalOf(): readonly Entry[] {
  return history.reduce(
    (state, event) => journalStep(refinementInstance, state, event),
    actorInit(),
  ).journal;
}

/** The table the per-decision changes build, applied one decision at a time. */
function folded(): ReadonlyMap<number, TicketProjection> {
  const table = new Map<number, TicketProjection>();
  let core: Core = genesis;
  for (const event of history) {
    const post = execDecisionEvent(refinementInstance, core, event).post;
    for (const row of projectionChanges(core, post)) {
      table.set(row.ticket, row);
    }
    core = post;
  }
  return table;
}

test("folding what each decision changed reaches the table a rebuild reads", () => {
  const rebuilt = new Map(
    projectionOf(replayCore(refinementInstance, journalOf())).map((row) => [
      row.ticket,
      row,
    ]),
  );
  assert.deepEqual(folded(), rebuilt);
  assert.equal(rebuilt.get(id(1))?.phase, "Working");
});

test("a decision reports exactly the tickets whose complete state changed", () => {
  const released = journalStep(
    refinementInstance,
    actorInit(),
    releaseTicketEvent(id(1), plainAuthoring),
  );
  const dispatched = journalStep(
    refinementInstance,
    released,
    dispatchEvent(id(1)),
  );
  assert.deepEqual(
    projectionChanges(released.view.post, dispatched.view.post),
    [
      {
        ticket: id(1),
        phase: "Working",
        dependable: true,
        reason: "NoReason",
        resumeAt: "NoResume",
      },
    ],
  );
  assert.deepEqual(
    projectionChanges(dispatched.view.post, dispatched.view.post),
    [],
  );
  const completed = journalStep(
    refinementInstance,
    dispatched,
    taskDoneEvent(id(1), asTaskId(1), "Pass", plainResult),
  );
  assert.deepEqual(
    projectionChanges(dispatched.view.post, completed.view.post),
    [
      {
        ticket: id(1),
        phase: "Working",
        dependable: true,
        reason: "NoReason",
        resumeAt: "NoResume",
      },
    ],
  );
});

test("a release is a change although it transitions nothing", () => {
  const released = journalStep(
    refinementInstance,
    actorInit(),
    releaseTicketEvent(id(1), plainAuthoring),
  );
  assert.deepEqual(released.journal.at(-1)?.rec.transitions, []);
  assert.deepEqual(projectionChanges(genesis, released.view.post), [
    {
      ticket: id(1),
      phase: "Pending",
      dependable: true,
      reason: "NoReason",
      resumeAt: "NoResume",
    },
  ]);
});

test("dependency eligibility distinguishes the escalated reasons", () => {
  const released = execDecisionEvent(
    refinementInstance,
    genesis,
    releaseTicketEvent(id(1), plainAuthoring),
  ).post;
  const ticket = released.tickets.get(id(1));
  assert.ok(ticket !== undefined);
  const escalated = (reason: Reason): Core => ({
    tickets: new Map([
      [id(1), { ...ticket, phase: "Escalated" as const, reason }],
    ]),
  });
  assert.equal(
    projectionOf(escalated("DependencyRevoked"))[0]?.dependable,
    false,
  );
  assert.equal(
    projectionOf(escalated("ReworkBudgetExhausted"))[0]?.dependable,
    true,
  );
});

/** The one outstanding task of a single-width ticket, which is what a completion names. */
function outstandingTask(core: Core): number {
  const task = [...ticketAt(core, id(1)).tasks].find(
    (candidate) => candidate.state === "Outstanding",
  );
  if (task === undefined)
    throw new Error("projection case: the ticket has no outstanding task");
  return task.id;
}

/**
 * A ticket reworked once, walled by the next evaluation failure and resumed off
 * that wall: the states whose resume point the projection exists to carry, and
 * the only ones where `resumeAt` is anything but the absent value.
 */
function walledHistory(): readonly DecisionEvent[] {
  const events: DecisionEvent[] = [
    releaseTicketEvent(id(1), plainAuthoring),
    dispatchEvent(id(1)),
  ];
  let core = events.reduce(
    (state, event) => execDecisionEvent(refinementInstance, state, event).post,
    genesis,
  );
  const step = (event: DecisionEvent) => {
    events.push(event);
    core = execDecisionEvent(refinementInstance, core, event).post;
  };
  for (const cycle of [0, 1]) {
    step(
      taskDoneEvent(
        id(1),
        asTaskId(outstandingTask(core)),
        "Pass",
        plainResult,
      ),
    );
    step(workReduceEvent(id(1)));
    step(
      taskDoneEvent(
        id(1),
        asTaskId(outstandingTask(core)),
        "Fail",
        plainResult,
      ),
    );
    step(
      evalReduceEvent(
        id(1),
        cycle === 1 ? "EscalateEvaluationFailure" : "ReworkEvaluationFailure",
      ),
    );
    if (cycle === 1) step(resumeTicketEvent(id(1)));
  }
  return events;
}

/** What the row claims about the ticket, read off the ticket itself. */
function ticketFacts(ticket: Ticket) {
  return {
    phase: ticket.phase,
    reason: ticket.reason,
    resumeAt: ticket.resumeAt,
  };
}

test("every projected row is the core the step it names left behind", () => {
  let core: Core = genesis;
  const seen: string[] = [];
  for (const event of walledHistory()) {
    core = execDecisionEvent(refinementInstance, core, event).post;
    const row = projectionOf(core).find((each) => each.ticket === id(1));
    assert.ok(row !== undefined);
    assert.deepEqual(ticketFacts(ticketAt(core, id(1))), {
      phase: row.phase,
      reason: row.reason,
      resumeAt: row.resumeAt,
    });
    seen.push(`${row.phase}/${row.resumeAt}`);
  }
  assert.ok(seen.includes("Escalated/ResumeReworking"));
  assert.equal(seen.at(-1), "Working/NoResume");
});
