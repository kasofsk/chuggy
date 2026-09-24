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
 * THE DELTA IS THE TICKETS WHOSE STATE MOVED, and a release is why. It
 * creates a ticket that had no prior phase to leave, so a projection driven off
 * phase changes would never file the row it created.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createTicketCommand,
  dispatchTicketCommand,
  reportFinalizationResultCommand,
  reportTaskTerminalCommand,
  resumeTicketCommand,
  type TicketCommand,
} from "../../src/actor/command.ts";
import {
  alwaysPolicy,
  decide,
  type EvaluationFailurePolicy,
} from "../../src/domain/deciders.ts";
import { evolve } from "../../src/domain/evolve.ts";
import { genesis, replayGraph, type Entry } from "../../src/actor/journal.ts";
import { actorInit, journalStep } from "../../src/actor/state.ts";
import { ticketAt } from "../../src/domain/ticketGraph.ts";
import type {
  TicketGraph,
  Ticket,
} from "../../src/domain/generated/modelTypes.ts";
import { evaluationTaskOf, workTaskOf } from "../../src/domain/task.ts";
import type { TaskIdentity } from "../../src/domain/generated/modelTypes.ts";
import { currentTaskObligations } from "../../src/domain/evaluation.ts";
import { currentInstance, resumeOf } from "../../src/domain/ticket.ts";
import {
  IntegrityContradiction,
  projectionChanges,
  projectionOf,
} from "../../src/interpreter/projectWriter.ts";
import type { TicketProjection } from "../../src/interpreter/projectDecision.ts";
import {
  plainDefinitionOf,
  plainPolicy,
  refinementInstance,
} from "../actor/harness.ts";
import { aDispatchSource } from "../../src/domain/config.ts";
import {
  acceptedOf,
  id,
  judgedReport,
  producedReport,
} from "../domain/fixtures.ts";

/** One ticket released, dispatched, and carried through Work and Evaluation to Done. */
const history: readonly TicketCommand[] = [
  createTicketCommand(plainDefinitionOf(1)),
  dispatchTicketCommand(id(1), aDispatchSource),
  reportTaskTerminalCommand(producedReport(workTaskOf(1, 1))),
  reportTaskTerminalCommand(
    judgedReport(evaluationTaskOf(1, 1, 1, 1, 1), "EvaluatorPass"),
  ),
  reportFinalizationResultCommand(id(1), 1, 1, {
    type: "FinalizationSucceeded",
    value: 1,
  }),
];

/** The graph one command leaves, decided under `policy` and evolved by what it decided. */
function decidedOn(
  graph: TicketGraph,
  command: TicketCommand,
  policy: EvaluationFailurePolicy = plainPolicy,
): TicketGraph {
  return evolve(graph, acceptedOf(decide(graph, command, policy)).event);
}

/** The journal that history writes, which is what a rebuild reads. */
function journalOf(): readonly Entry[] {
  return history.reduce(
    (state, event) =>
      journalStep(refinementInstance, state, event, plainPolicy),
    actorInit(),
  ).journal;
}

/** The table the per-decision changes build, applied one decision at a time. */
function folded(): ReadonlyMap<number, TicketProjection> {
  const table = new Map<number, TicketProjection>();
  let graph: TicketGraph = genesis;
  for (const event of history) {
    const post = decidedOn(graph, event);
    for (const row of projectionChanges(graph, post)) {
      table.set(row.ticket, row);
    }
    graph = post;
  }
  return table;
}

test("folding what each decision changed reaches the table a rebuild reads", () => {
  const rebuilt = new Map(
    projectionOf(replayGraph(journalOf())).map((row) => [row.ticket, row]),
  );
  assert.deepEqual(folded(), rebuilt);
  assert.equal(rebuilt.get(id(1))?.phase, "Done");
});

test("a decision reports exactly the tickets whose complete state changed", () => {
  const released = journalStep(
    refinementInstance,
    actorInit(),
    createTicketCommand(plainDefinitionOf(1)),
    plainPolicy,
  );
  const dispatched = journalStep(
    refinementInstance,
    released,
    dispatchTicketCommand(id(1), aDispatchSource),
    plainPolicy,
  );
  assert.deepEqual(
    projectionChanges(released.view.post, dispatched.view.post),
    [
      {
        ticket: id(1),
        revision: 1,
        phase: "Work",
        dependable: true,
        escalation: "NoEscalation",
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
    reportTaskTerminalCommand(producedReport(workTaskOf(1, 1))),
    plainPolicy,
  );
  assert.deepEqual(
    projectionChanges(dispatched.view.post, completed.view.post),
    [
      {
        ticket: id(1),
        revision: 1,
        phase: "Evaluation",
        dependable: true,
        escalation: "NoEscalation",
      },
    ],
  );
});

test("a release is a change although it leaves no phase", () => {
  const released = journalStep(
    refinementInstance,
    actorInit(),
    createTicketCommand(plainDefinitionOf(1)),
    plainPolicy,
  );
  assert.equal(released.journal.at(-1)?.event.type, "TicketCreated");
  assert.deepEqual(projectionChanges(genesis, released.view.post), [
    {
      ticket: id(1),
      revision: 1,
      phase: "Pending",
      dependable: true,
      escalation: "NoEscalation",
    },
  ]);
});

/** The one task a single-width ticket owes, which is what a completion names. */
function owedTask(graph: TicketGraph): TaskIdentity {
  const ticket = ticketAt(graph, id(1));
  if (ticket.phase === "Work") return workTaskOf(1, ticket.workCyclesStarted);
  const [obligation] = currentTaskObligations(currentInstance(ticket));
  if (obligation === undefined)
    throw new Error("projection case: the ticket owes no task");
  return obligation.task;
}

/**
 * A ticket reworked once, walled by the next evaluation failure and resumed off
 * that wall: the states whose escalation the projection exists to carry, and
 * the only ones where it is anything but the absent value.
 */
function walledHistory(): readonly (readonly [
  TicketCommand,
  EvaluationFailurePolicy,
])[] {
  const steps: (readonly [TicketCommand, EvaluationFailurePolicy])[] = [];
  let graph: TicketGraph = genesis;
  const step = (event: TicketCommand, policy = plainPolicy) => {
    steps.push([event, policy]);
    graph = decidedOn(graph, event, policy);
  };
  step(createTicketCommand(plainDefinitionOf(1)));
  step(dispatchTicketCommand(id(1), aDispatchSource));
  for (const cycle of [0, 1]) {
    const work = owedTask(graph);
    step(reportTaskTerminalCommand(producedReport(work)));
    const judge = owedTask(graph);
    step(
      reportTaskTerminalCommand(judgedReport(judge, "EvaluatorFail")),
      alwaysPolicy(
        cycle === 1 ? "EscalateEvaluationFailure" : "ReworkEvaluationFailure",
      ),
    );
    if (cycle === 1) step(resumeTicketCommand(id(1)));
  }
  return steps;
}

/** What the row claims about the ticket, read off the ticket itself. */
function ticketFacts(ticket: Ticket) {
  return { phase: ticket.phase, escalation: ticket.escalation };
}

test("every projected row is the graph the step it names left behind", () => {
  let graph: TicketGraph = genesis;
  const seen: string[] = [];
  for (const [event, policy] of walledHistory()) {
    graph = decidedOn(graph, event, policy);
    const row = projectionOf(graph).find((each) => each.ticket === id(1));
    assert.ok(row !== undefined);
    assert.deepEqual(ticketFacts(ticketAt(graph, id(1))), {
      phase: row.phase,
      escalation: row.escalation,
    });
    seen.push(`${row.phase}/${resumeOf(row.escalation)}`);
  }
  assert.ok(seen.includes("Escalated/ResumeRework"));
  assert.equal(seen.at(-1), "Work/NoResume");
});

/**
 * The evidence is the fabric's account of the wall and no ticket holds it, so
 * the row carries what the decision was told and only on the row it is about:
 * a second live ticket in the same graph is projected beside it bare.
 */
test("a decision's evidence lands on the ticket it escalated and no other", () => {
  const graph = [
    [createTicketCommand(plainDefinitionOf(2)), plainPolicy] as const,
    ...walledHistory().slice(0, -1),
  ].reduce(
    (state, [event, policy]) => decidedOn(state, event, policy),
    genesis,
  );
  assert.equal(ticketAt(graph, id(1)).escalation, "EvaluationFailureEscalated");
  assert.deepEqual(
    projectionOf(graph, { ticket: id(1), evidence: "RefUnreadable" }),
    [
      {
        ticket: id(1),
        revision: 1,
        phase: "Escalated",
        dependable: true,
        escalation: "EvaluationFailureEscalated",
        escalationEvidence: "RefUnreadable",
      },
      {
        ticket: id(2),
        revision: 1,
        phase: ticketAt(graph, id(2)).phase,
        dependable: true,
        escalation: "NoEscalation",
      },
    ],
  );
  const resumed = decidedOn(graph, resumeTicketCommand(id(1)));
  assert.throws(
    () => projectionOf(resumed, { ticket: id(1), evidence: "RefUnreadable" }),
    IntegrityContradiction,
  );
});
