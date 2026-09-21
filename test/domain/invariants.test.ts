/**
 * One make-it-red demonstration per safety invariant: a state, or a step
 * record, carrying the defect that invariant names, and the invariant
 * rejecting it.
 *
 * AN UNVERIFIED CONTROL IS WORSE THAN NONE, because a control that reports
 * success is believed and then never checked again. A predicate that returns
 * true on every state this tree can build is indistinguishable from one that
 * works, so each case below is red-side evidence; the green side is
 * `test/domain/bundle.test.ts`, where the whole bundle passes a fleet in
 * mid-flight, which is what stops a leaf that always fails from reading as a
 * demonstration.
 *
 * THE BAR IS THE CONJUNCT, NOT THE PREDICATE, because a case that goes red
 * when a whole invariant is mutated to constant `true` says nothing about the
 * named sub-control it appears to target: several here fail on a conjunct
 * beside the one their fixture was built for, and a conjunct nobody has fed a
 * defect can sit inside a predicate having never once performed the refusal it
 * exists for. So a case is proved against the deletion of the single conjunct
 * it names — with that conjunct gone the invariant returns true on the fixture
 * and the case fails, which is what says the two are about the same thing.
 *
 * `stuckSubsetCovered` IS THE SHAPE OF HARD. It is a tautology over its
 * two walks and the model says so at length, so the defect it names is an edit
 * to a definition rather than a state: the demonstrations below mutate one
 * walk through the same sweep operator the real one is built from, which is
 * the only thing that could catch what it exists to catch.
 */

import type {
  TicketGraph,
  StepRecord,
  Task,
} from "../../src/domain/generated/modelTypes.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

import { liveTickets, ticketAt } from "../../src/domain/ticketGraph.ts";
import { decideRevoke } from "../../src/domain/deciders.ts";
import {
  coveredSet,
  stuckSet,
  subsetOf,
  sweep,
  visEdges,
} from "../../src/domain/derived.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import {
  artifactWellFormed,
  completionExclusive,
  depsAcyclic,
  deskConsistent,
  idsAccounted,
  programsWellFormed,
  recordMonotone,
  recordWellFormed,
  revokedNeverCompletes,
  stuckSubsetCovered,
  tasksWellFormed,
  terminalsAbsorbing,
  ticketIdsWellFormed,
  type StepView,
} from "../../src/domain/invariants.ts";
import { hasOpenHumanTask } from "../../src/domain/ticket.ts";
import { modelInstance } from "./configs.ts";
import {
  graphOf,
  depsOf,
  evalOutstanding,
  evalTask,
  fleetBut,
  healthyFleet,
  id,
  initialView,
  ticketOn,
  workOutstanding,
  workTask,
} from "./fixtures.ts";

const config = modelInstance;
const fleet = healthyFleet(config);
const healthy = initialView(graphOf(fleet));

/** An artifact mark, as a ticket that ran carries one. */
const produced = (value: number) =>
  ({ type: "ProducedArtifact", value }) as const;

/** A view of one state, for the invariants that read only the state. */
const stateView = (post: TicketGraph): StepView => initialView(post);

/** The mid-flight fleet under a record of the caller's, for the invariants that read one. */
const stepView = (rec: StepRecord): StepView => ({ ...healthy, rec });

/** A record naming a step, with the transitions the caller is demonstrating. */
const recordOf = (rec: Partial<StepRecord>): StepRecord => ({
  ...healthy.rec,
  ...rec,
});

test("completionExclusive rejects a ledger that disagrees with the phase", () => {
  assert.ok(
    !completionExclusive(
      config,
      stateView(fleetBut(fleet, 0, { completions: 2 })),
    ),
    "nothing completes twice",
  );
  assert.ok(
    !completionExclusive(
      config,
      stateView(fleetBut(fleet, 0, { completions: 0 })),
    ),
    "Done means the completion was recorded",
  );
  assert.ok(
    !completionExclusive(
      config,
      stateView(fleetBut(fleet, 1, { completions: 1 })),
    ),
    "a completion means the ticket is Done",
  );
  assert.ok(completionExclusive(config, healthy));
});

test("revokedNeverCompletes rejects a revoked ticket that completed", () => {
  const spent = graphOf([
    ticketOn(config, { phase: "Revoked", completions: 1 }),
  ]);
  assert.ok(!revokedNeverCompletes(config, stateView(spent)));
  const revoked = graphOf([ticketOn(config, { phase: "Revoked" })]);
  assert.ok(
    revokedNeverCompletes(config, stateView(revoked)),
    "a revoke settles the ticket before any completion is recorded",
  );
  assert.ok(revokedNeverCompletes(config, healthy));
});

test("artifactWellFormed rejects a completed ticket that produced nothing", () => {
  assert.ok(
    !artifactWellFormed(
      config,
      stateView(fleetBut(fleet, 0, { artifact: "NoArtifact" })),
    ),
  );
  const revoked = graphOf([ticketOn(config, { phase: "Revoked" })]);
  assert.ok(
    artifactWellFormed(config, stateView(revoked)),
    "a revoked ticket may never have run",
  );
});

test("terminalsAbsorbing rejects a transition out of a terminal", () => {
  for (const from of ["Done", "Revoked"] as const) {
    assert.ok(
      !terminalsAbsorbing(
        config,
        stepView(
          recordOf({
            label: "ticket-resumed",
            transitions: [{ ticket: id(1), from, to: "Pending" }],
          }),
        ),
      ),
      `${from} is absorbing, so no decider moves a ticket out of it`,
    );
  }
  assert.ok(
    terminalsAbsorbing(
      config,
      stepView(
        recordOf({
          label: "ticket-done",
          transitions: [{ ticket: id(3), from: "Finalization", to: "Done" }],
        }),
      ),
    ),
  );
});

test("deskConsistent rejects a wall without a park and a park without a wall", () => {
  assert.ok(
    !deskConsistent(
      config,
      stateView(fleetBut(fleet, 1, { escalation: "WorkFailureEscalated" })),
    ),
    "a named wall on a ticket that is not parked",
  );
  const nameless = graphOf([ticketOn(config, { phase: "Escalated" })]);
  assert.ok(
    !deskConsistent(config, stateView(nameless)),
    "a park with no wall",
  );
  assert.ok(
    deskConsistent(
      config,
      stateView(
        graphOf([
          ticketOn(config, {
            phase: "Escalated",
            escalation: "WorkFailureEscalated",
          }),
        ]),
      ),
    ),
  );
});

test("tasksWellFormed rejects a work set that is not the phase's anatomy", () => {
  assert.ok(
    !tasksWellFormed(
      config,
      stateView(
        fleetBut(fleet, 1, {
          tasks: new Set([workOutstanding(1), workOutstanding(2)]),
        }),
      ),
    ),
    "a work cycle is one task, and the live set is exactly that task",
  );
  assert.ok(
    !tasksWellFormed(
      config,
      stateView(
        fleetBut(fleet, 1, {
          tasks: new Set([evalOutstanding(1, 0)]),
        }),
      ),
    ),
    "a work phase carries work tasks and nothing else",
  );
  assert.ok(
    !tasksWellFormed(
      config,
      stateView(
        fleetBut(fleet, 1, {
          tasks: new Set([workTask(1, "Cancelled")]),
        }),
      ),
    ),
    "cancelled is a retirement mark, not an outcome an event can deliver live",
  );
  assert.ok(
    !tasksWellFormed(
      config,
      stateView(fleetBut(fleet, 0, { tasks: new Set([workOutstanding(5)]) })),
    ),
    "a settled ticket carries no live task state",
  );
});

test("tasksWellFormed rejects an eval stage the program is not running", () => {
  const evaluating = (tasks: ReadonlySet<Task>): TicketGraph =>
    graphOf([
      ticketOn(config, {
        phase: "Evaluation",
        record: [workTask(1, "Passed")],
        tasks,
        spawned: 3,
      }),
    ]);
  assert.ok(
    tasksWellFormed(
      config,
      stateView(
        evaluating(new Set([evalOutstanding(2, 0), evalOutstanding(3, 0)])),
      ),
    ),
  );
  assert.ok(
    !tasksWellFormed(
      config,
      stateView(
        evaluating(new Set([evalOutstanding(7, 0), evalOutstanding(8, 0)])),
      ),
    ),
    "the live ids are the contiguous run directly above the retired record",
  );
  assert.ok(
    !tasksWellFormed(
      config,
      stateView(
        evaluating(new Set([evalOutstanding(2, 5), evalOutstanding(3, 5)])),
      ),
    ),
    "the stage index has to index into the ticket's own program",
  );
  assert.ok(
    !tasksWellFormed(
      config,
      stateView(evaluating(new Set([evalOutstanding(2, 0)]))),
    ),
    "the set is exactly the stage's declared width",
  );
  assert.ok(
    !tasksWellFormed(
      config,
      stateView(
        evaluating(
          new Set([evalTask(2, 0, "Cancelled"), evalOutstanding(3, 0)]),
        ),
      ),
    ),
    "cancelled is a retirement mark on the eval side too, and this branch has its own conjunct saying so",
  );
});

test("recordWellFormed rejects a log that is not the resolved history in identity order", () => {
  const finalizing = (record: readonly Task[]): TicketGraph =>
    graphOf([
      ticketOn(config, {
        phase: "Finalization",
        record,
        spawned: record.length,
      }),
    ]);
  assert.ok(
    !recordWellFormed(
      config,
      stateView(finalizing([workTask(2, "Passed"), workTask(1, "Passed")])),
    ),
    "entry i carries id i plus one: the chronological log is the identity order",
  );
  assert.ok(
    !recordWellFormed(config, stateView(finalizing([workOutstanding(1)]))),
    "nothing retired is still outstanding",
  );
  assert.ok(
    !recordWellFormed(
      config,
      stateView(finalizing([evalTask(1, 5, "Passed")])),
    ),
    "programs are immutable, so a retired stage index never dangles",
  );
  assert.ok(recordWellFormed(config, healthy));
});

test("recordMonotone rejects a record that shrank, was rewritten, or lost its ticket", () => {
  const kept = ticketAt(healthy.post, id(3)).record;
  const shorter = fleetBut(fleet, 2, { record: kept.slice(1) });
  assert.ok(
    !recordMonotone(config, { ...healthy, pre: healthy.post, post: shorter }),
  );
  const rewritten = fleetBut(fleet, 2, {
    record: [workTask(1, "Failed"), ...kept.slice(1)],
  });
  assert.ok(
    !recordMonotone(config, { ...healthy, pre: healthy.post, post: rewritten }),
    "nothing settled is ever rewritten",
  );
  const dropped = graphOf(fleet.slice(0, 2));
  assert.ok(
    !recordMonotone(config, { ...healthy, pre: healthy.post, post: dropped }),
    "tickets are never deleted",
  );
  const grown = fleetBut(fleet, 2, {
    record: [...kept, workTask(5, "Passed")],
  });
  assert.ok(
    recordMonotone(config, { ...healthy, pre: healthy.post, post: grown }),
  );
});

test("idsAccounted rejects the task set a decider dropped instead of retiring", () => {
  const dropped = graphOf([
    ticketOn(config, {
      phase: "Escalated",
      escalation: "WorkFailureEscalated",
      spawned: config.nTasks,
    }),
  ]);
  assert.ok(!idsAccounted(config, stateView(dropped)));
  assert.ok(
    tasksWellFormed(config, stateView(dropped)),
    "the surviving state is well-formed, which is why this needs its own invariant",
  );
  assert.ok(recordWellFormed(config, stateView(dropped)));
  assert.ok(idsAccounted(config, healthy));
});

test("programsWellFormed rejects a program no release could have carried", () => {
  const stage = { fanout: 1 } as const;
  const overlong = Array.from({ length: config.maxStages + 1 }, () => stage);
  for (const program of [[], [{ ...stage, fanout: 0 }], overlong]) {
    assert.ok(
      !programsWellFormed(config, stateView(fleetBut(fleet, 1, { program }))),
      `${JSON.stringify(program)} is not an authorable program`,
    );
  }
  assert.ok(
    !programsWellFormed(
      config,
      stateView(
        fleetBut(fleet, 1, {
          program: [{ ...stage, fanout: config.nTasks + 1 }],
        }),
      ),
    ),
    "a stage may not fan out past the task ceiling",
  );
  assert.ok(programsWellFormed(config, healthy));
});

test("depsAcyclic rejects a dependency that points at nothing or back at itself", () => {
  assert.ok(
    !depsAcyclic(config, stateView(fleetBut(fleet, 1, { deps: depsOf(9) }))),
    "each dep points at a ticket the fleet holds",
  );
  assert.ok(
    !depsAcyclic(config, stateView(fleetBut(fleet, 1, { deps: depsOf(2) }))),
    "no ticket waits on itself",
  );
  const cyclic = graphOf([
    ticketOn(config, { phase: "Pending", deps: depsOf(2) }),
    ticketOn(config, { phase: "Pending", deps: depsOf(1) }),
  ]);
  assert.ok(
    !depsAcyclic(config, stateView(cyclic)),
    "the closure is transitive, so a cycle of any length is caught",
  );
  assert.ok(
    depsAcyclic(config, stateView(fleetBut(fleet, 1, { deps: depsOf(3) }))),
    "ids are sparse, so an edge pointing at a numerically larger ticket is ordinary",
  );
  assert.ok(depsAcyclic(config, healthy));
});

test("ticketIdsWellFormed rejects an id off the universe and a fleet past its bound", () => {
  const first = ticketAt(healthy.post, id(1));
  const offUniverse: TicketGraph = {
    tickets: new Map([[asTicketId(config.nTickets * 2 + 1), first]]),
  };
  assert.ok(
    !ticketIdsWellFormed(config, stateView(offUniverse)),
    "a release draws its id from a finite universe",
  );
  const overfull = graphOf([...fleet, ticketOn(config, { phase: "Pending" })]);
  assert.ok(
    !ticketIdsWellFormed(config, stateView(overfull)),
    "releases are bounded by the fleet cap, which the id universe deliberately is not",
  );
  const sparse: TicketGraph = {
    tickets: new Map([
      [id(2), first],
      [id(5), first],
      [id(6), first],
    ]),
  };
  assert.ok(
    ticketIdsWellFormed(config, stateView(sparse)),
    "ids are sparse by construction, so this is a membership claim rather than a density one",
  );
  assert.ok(ticketIdsWellFormed(config, healthy));
});

test("stuckSubsetCovered goes red when one walk gets a base case the other lacks", () => {
  const running = graphOf([
    ticketOn(config, { phase: "Finalization" }),
    ticketOn(config, { phase: "Pending", deps: depsOf(1) }),
  ]);
  assert.ok(stuckSubsetCovered(config, stateView(running)));
  const finalizingIsStuck = sweep(running, (graph, each, stuck) => {
    const phase = ticketAt(graph, each).phase;
    return (
      phase === "Finalization" ||
      (phase === "Pending" && visEdges(graph, each).some((d) => stuck.has(d)))
    );
  });
  assert.ok(
    !subsetOf(finalizingIsStuck, coveredSet(running)),
    "a base case that is not a desk phase is stuck with nothing covering it",
  );
  const parked = graphOf([
    ticketOn(config, {
      phase: "Escalated",
      escalation: "WorkFailureEscalated",
    }),
    ticketOn(config, { phase: "Pending", deps: depsOf(1) }),
  ]);
  const guardedCoverage = sweep(
    parked,
    (graph, each, covered) =>
      hasOpenHumanTask(ticketAt(graph, each)) ||
      (ticketAt(graph, each).phase === "Work" &&
        visEdges(graph, each).some((d) => covered.has(d))),
  );
  assert.ok(stuckSubsetCovered(config, stateView(parked)));
  assert.ok(
    !subsetOf(stuckSet(parked), guardedCoverage),
    "a phase guard on coverage's inductive arm leaves a stuck ticket uncovered",
  );
});

test("stuckSubsetCovered goes red when one walk gets an edge kind the other lacks", () => {
  const upstream = graphOf([
    ticketOn(config, { phase: "Pending" }),
    ticketOn(config, {
      phase: "Escalated",
      escalation: "WorkFailureEscalated",
      deps: depsOf(1),
    }),
  ]);
  assert.ok(stuckSubsetCovered(config, stateView(upstream)));
  const bothWays = sweep(upstream, (graph, each, stuck) => {
    const dependents = liveTickets(graph).filter((other) =>
      visEdges(graph, other).includes(each),
    );
    return (
      ticketAt(graph, each).phase === "Escalated" ||
      [...visEdges(graph, each), ...dependents].some((d) => stuck.has(d))
    );
  });
  assert.ok(
    !subsetOf(bothWays, coveredSet(upstream)),
    "an edge kind added to one walk and not the other is exactly what this guards",
  );
  const wider = graphOf([
    ticketOn(config, {
      phase: "Escalated",
      escalation: "WorkFailureEscalated",
    }),
    ticketOn(config, {
      phase: "Done",
      deps: depsOf(1),
      artifact: produced(1),
      completions: 1,
    }),
  ]);
  assert.ok(stuckSubsetCovered(config, stateView(wider)));
  assert.ok(
    !subsetOf(coveredSet(wider), stuckSet(wider)),
    "the containment has a direction, and a check reading it the other way would go red here",
  );
});

test("a revoke leaves its dependents where they were, and depsAcyclic is what refuses a cycle", () => {
  const chain = graphOf([
    ticketOn(config, { phase: "Pending" }),
    ticketOn(config, { phase: "Pending", deps: depsOf(1) }),
    ticketOn(config, { phase: "Pending", deps: depsOf(2) }),
  ]);
  const revoked = decideRevoke(chain, id(1));
  assert.equal(revoked.rec.transitions.length, 1);
  for (const invariant of [deskConsistent, stuckSubsetCovered, depsAcyclic]) {
    assert.ok(invariant(config, stateView(revoked.post)));
  }
  const cyclic = graphOf([
    ticketOn(config, { phase: "Pending", deps: depsOf(2) }),
    ticketOn(config, { phase: "Pending", deps: depsOf(1) }),
  ]);
  assert.ok(
    !depsAcyclic(config, stateView(cyclic)),
    "a cycle is what the release's construction refuses",
  );
  assert.ok(
    stuckSubsetCovered(config, stateView(cyclic)),
    "the walks agree here as they do on every state, which is why this one is the machine-checked half",
  );
});
