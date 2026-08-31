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
  finalizationResultEvent,
  releaseTicketEvent,
  resumeTicketEvent,
  taskDoneEvent,
  workReduceEvent,
  type DecisionEvent,
} from "../../src/actor/decisionEvent.ts";
import { genesis, replayCore, type Entry } from "../../src/actor/journal.ts";
import { actorInit, journalStep } from "../../src/actor/state.ts";
import { ticketAt } from "../../src/domain/core.ts";
import type { Core, Ticket } from "../../src/domain/generated/modelTypes.ts";
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
        gasLeft: refinementInstance.gas - 1,
        reworkLeft: 1,
        finalizationLeft: 1,
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
        gasLeft: refinementInstance.gas - 1,
        reworkLeft: 1,
        finalizationLeft: 1,
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
      gasLeft: refinementInstance.gas,
      reworkLeft: 1,
      finalizationLeft: 1,
    },
  ]);
});

test("dependency eligibility distinguishes the two escalated reasons", () => {
  const released = execDecisionEvent(
    refinementInstance,
    genesis,
    releaseTicketEvent(id(1), plainAuthoring),
  ).post;
  const ticket = released.tickets.get(id(1));
  assert.ok(ticket !== undefined);
  const escalated = (reason: "DependencyRevoked" | "GasExhausted"): Core => ({
    tickets: new Map([
      [id(1), { ...ticket, phase: "Escalated" as const, reason }],
    ]),
  });
  assert.equal(
    projectionOf(escalated("DependencyRevoked"))[0]?.dependable,
    false,
  );
  assert.equal(projectionOf(escalated("GasExhausted"))[0]?.dependable, true);
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
 * A ticket driven to the rework wall and resumed off it: the two states whose
 * resume point and accounts the projection exists to carry, and the only ones
 * where `resumeAt` is anything but the absent value.
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
    step(evalReduceEvent(id(1)));
    if (cycle === 1) step(resumeTicketEvent(id(1)));
  }
  return events;
}

/** Every account and the resume point, read off the ticket the row claims to project. */
function ticketFacts(ticket: Ticket) {
  return {
    phase: ticket.phase,
    reason: ticket.reason,
    resumeAt: ticket.resumeAt,
    gasLeft: ticket.gasLeft,
    reworkLeft: ticket.reworkLeft,
    finalizationLeft: ticket.finalizationLeft,
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
      gasLeft: row.gasLeft,
      reworkLeft: row.reworkLeft,
      finalizationLeft: row.finalizationLeft,
    });
    seen.push(`${row.phase}/${row.resumeAt}`);
  }
  assert.ok(seen.includes("Escalated/ResumeReworking"));
  assert.equal(seen.at(-1), "Working/NoResume");
});

/**
 * The account the `finalizationLeft` rule turns on: a budgeted one spent to
 * nothing. The figure is what says the budget ran out, so it stays on the row,
 * and only the pricing decides whether a row carries one at all.
 */
test("a budgeted finalization account spent to zero is still projected", () => {
  let core: Core = genesis;
  const step = (event: DecisionEvent) => {
    core = execDecisionEvent(refinementInstance, core, event).post;
  };
  step(releaseTicketEvent(id(1), plainAuthoring));
  step(dispatchEvent(id(1)));
  step(
    taskDoneEvent(id(1), asTaskId(outstandingTask(core)), "Pass", plainResult),
  );
  step(workReduceEvent(id(1)));
  step(
    taskDoneEvent(id(1), asTaskId(outstandingTask(core)), "Pass", plainResult),
  );
  step(evalReduceEvent(id(1)));
  assert.equal(ticketAt(core, id(1)).phase, "Finalizing");
  step(finalizationResultEvent(id(1), "FinalizationFailed"));
  const spent = ticketAt(core, id(1));
  assert.equal(spent.finalizationLeft, 0);
  assert.notEqual(spent.finalizationPricing, "DeadlineOnly");
  assert.equal(
    projectionOf(core).find((row) => row.ticket === id(1))?.finalizationLeft,
    0,
  );
});

/** A pricing that budgets no finalization account projects no figure for one. */
test("a deadline-priced ticket projects no finalization account", () => {
  const priced = execDecisionEvent(
    refinementInstance,
    genesis,
    releaseTicketEvent(id(1), {
      ...plainAuthoring,
      finalizationPricing: "DeadlineOnly",
    }),
  ).post;
  const row = projectionOf(priced)[0];
  assert.equal(row?.finalizationLeft, undefined);
  assert.equal(ticketAt(priced, id(1)).finalizationLeft, 0);
});
