/**
 * One make-it-red demonstration per safety invariant: a state, or a decision,
 * carrying the defect that invariant names, and the invariant rejecting it.
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
  EvaluationInstance,
  StageDefinition,
  SuccessfulTicketDecision,
  Ticket,
  TicketGraph,
} from "../../src/domain/generated/modelTypes.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

import { liveTickets, ticketAt } from "../../src/domain/ticketGraph.ts";
import {
  decideDispatch,
  decideRevoke,
  decideUpdate,
} from "../../src/domain/deciders.ts";
import { evolve } from "../../src/domain/evolve.ts";
import {
  coveredSet,
  stuckSet,
  subsetOf,
  sweep,
  visEdges,
} from "../../src/domain/derived.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import { evaluationTaskOf } from "../../src/domain/task.ts";
import {
  artifactWellFormed,
  completionExclusive,
  decisionsValid,
  depsAcyclic,
  deskConsistent,
  idsAccounted,
  evaluationsMonotone,
  evaluationsWellFormed,
  definitionsWellFormed,
  revisionsAccounted,
  eventsNeverIdentity,
  finalizationGenerationHeld,
  sourcePinned,
  revokedNeverCompletes,
  stuckSubsetCovered,
  taskIdentitiesValid,
  terminalsAbsorbing,
  ticketIdsWellFormed,
  type StepView,
} from "../../src/domain/invariants.ts";
import {
  currentInstance,
  hasOpenHumanTask,
  workTaskObligation,
} from "../../src/domain/ticket.ts";
import { resumeBlocked } from "../../src/domain/evaluation.ts";
import {
  aDispatchSource,
  anAcceptedSource,
  defaultPlan,
  evaluatorOf,
} from "../../src/domain/config.ts";
import { modelInstance } from "./configs.ts";
import {
  acceptedOf,
  blockedInstance,
  graphOf,
  depsOf,
  fleetBut,
  healthyFleet,
  id,
  initialView,
  judgedInstance,
  runningInstance,
  rosterOf,
  ticketOn,
} from "./fixtures.ts";

const config = modelInstance;
const plan = defaultPlan(config);
const roster = rosterOf(plan);
const fleet = healthyFleet(config);
const healthy = initialView(graphOf(fleet));

/** A view of one state, for the invariants that read only the state. */
const stateView = (post: TicketGraph): StepView => initialView(post);

/** A step from `pre` to `post`, for the invariants that read the state the last decision found. */
const stepFrom = (pre: TicketGraph, post: TicketGraph): StepView => ({
  pre,
  last: "NoDecision",
  post,
});

/** The view a decision taken at `pre` leaves, with `post` standing in where a defect needs its own. */
const decidedAt = (
  pre: TicketGraph,
  decision: SuccessfulTicketDecision,
  post: TicketGraph = evolve(pre, decision.event),
): StepView => ({ pre, last: { type: "Decided", value: decision }, post });

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
      stateView(fleetBut(fleet, 0, { evaluations: [] })),
    ),
  );
  const revoked = graphOf([ticketOn(config, { phase: "Revoked" })]);
  assert.ok(
    artifactWellFormed(config, stateView(revoked)),
    "a revoked ticket may never have run",
  );
});

test("terminalsAbsorbing rejects a ticket that left a terminal", () => {
  for (const phase of ["Done", "Revoked"] as const) {
    assert.ok(
      !terminalsAbsorbing(
        config,
        stepFrom(
          graphOf([ticketOn(config, { phase })]),
          graphOf([ticketOn(config, { phase: "Pending" })]),
        ),
      ),
      `${phase} is absorbing, so no event moves a ticket out of it`,
    );
  }
  assert.ok(
    !terminalsAbsorbing(
      config,
      stepFrom(graphOf([ticketOn(config, { phase: "Done" })]), graphOf([])),
    ),
    "a terminal ticket is never dropped",
  );
  assert.ok(
    terminalsAbsorbing(
      config,
      stepFrom(
        graphOf([ticketOn(config, { phase: "Finalization" })]),
        graphOf([ticketOn(config, { phase: "Done" })]),
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

/** A ticket in Evaluation carrying `evaluations`, with the mint counter its history implies. */
const judging = (
  evaluations: readonly ReturnType<typeof judgedInstance>[],
  overrides: Partial<Ticket> = {},
): TicketGraph =>
  graphOf([
    ticketOn(config, {
      phase: "Evaluation",
      source: anAcceptedSource,
      evaluations,
      workCyclesStarted: evaluations.length,
      spawned: evaluations.length * (1 + roster),
      ...overrides,
    }),
  ]);

test("finalizationGenerationHeld rejects an attempt with no generation and a cycle carrying the last one's", () => {
  assert.ok(finalizationGenerationHeld(config, healthy));
  assert.ok(
    !finalizationGenerationHeld(
      config,
      stateView(fleetBut(fleet, 2, { finalizationGeneration: 0 })),
    ),
    "a ticket finalizing is on some attempt",
  );
  assert.ok(
    !finalizationGenerationHeld(
      config,
      stateView(
        fleetBut(fleet, 2, {
          phase: "Escalated",
          escalation: "FinalizationUnavailableEscalated",
          finalizationGeneration: 0,
        }),
      ),
    ),
    "the finalization wall holds the attempt its resume follows",
  );
  assert.ok(
    !finalizationGenerationHeld(
      config,
      stateView(fleetBut(fleet, 1, { finalizationGeneration: 1 })),
    ),
    "a work cycle has reached no finalization yet",
  );
});

/** The same history on a ticket past Evaluation, where no open instance is expected. */
const settledJudging = (
  evaluations: readonly ReturnType<typeof judgedInstance>[],
  overrides: Partial<Ticket> = {},
): TicketGraph =>
  graphOf([
    ticketOn(config, {
      phase: "Finalization",
      evaluations,
      workCyclesStarted: evaluations.length,
      spawned: evaluations.length * (1 + roster),
      finalizationGeneration: 1,
      ...overrides,
    }),
  ]);

test("evaluationsWellFormed rejects a judgement that is not this ticket's", () => {
  assert.ok(
    !evaluationsWellFormed(
      config,
      stateView(judging([runningInstance(2, 1, plan, new Set())])),
    ),
    "an instance names the ticket it judges, and a ticket carries no other's",
  );
  assert.ok(
    !evaluationsWellFormed(
      config,
      stateView(
        judging([
          runningInstance(
            1,
            1,
            [{ key: 1, evaluators: [evaluatorOf(1)] }],
            new Set(),
          ),
        ]),
      ),
    ),
    "the plan is the one the release froze",
  );
  assert.ok(
    !evaluationsWellFormed(
      config,
      stateView(
        settledJudging([judgedInstance(1, 2, plan)], {
          workCyclesStarted: 1,
        }),
      ),
    ),
    "a judgement judges a work cycle the ticket has actually started",
  );
  assert.ok(
    !evaluationsWellFormed(
      config,
      stateView(
        settledJudging([
          judgedInstance(1, 2, plan),
          judgedInstance(1, 1, plan),
        ]),
      ),
    ),
    "the instances stand in the order their cycles ran",
  );
  assert.ok(
    evaluationsWellFormed(
      config,
      stateView(
        settledJudging([
          judgedInstance(1, 1, plan),
          judgedInstance(1, 2, plan),
        ]),
      ),
    ),
  );
  assert.ok(evaluationsWellFormed(config, healthy));
});

test("evaluationsWellFormed rejects a phase that disagrees with the instance it opened", () => {
  assert.ok(
    !evaluationsWellFormed(
      config,
      stateView(judging([judgedInstance(1, 1, plan)])),
    ),
    "a ticket in Evaluation is running a stage, not holding a settled judgement",
  );
  assert.ok(
    !evaluationsWellFormed(
      config,
      stateView(
        judging(
          [judgedInstance(1, 1, plan), runningInstance(1, 2, plan, new Set())],
          { workCyclesStarted: 3 },
        ),
      ),
    ),
    "the open instance judges the cycle the ticket is on",
  );
  const parked = (instance: ReturnType<typeof judgedInstance>): TicketGraph =>
    graphOf([
      ticketOn(config, {
        phase: "Escalated",
        escalation: "EvaluationBlockedEscalated",
        evaluations: [instance],
        workCyclesStarted: 1,
        spawned: 1 + roster,
      }),
    ]);
  assert.ok(
    !evaluationsWellFormed(
      config,
      stateView(parked(judgedInstance(1, 1, plan))),
    ),
    "the desk's blocked wall and the instance's blocked state are one fact",
  );
  assert.ok(
    evaluationsWellFormed(
      config,
      stateView(parked(blockedInstance(1, 1, plan, new Set([1])))),
    ),
  );
});

test("evaluationsMonotone rejects a history that shrank, was rewritten, or lost its ticket", () => {
  const kept = ticketAt(healthy.post, id(3)).evaluations;
  const shorter = fleetBut(fleet, 2, { evaluations: [] });
  assert.ok(
    !evaluationsMonotone(config, {
      ...healthy,
      pre: healthy.post,
      post: shorter,
    }),
  );
  const dropped = graphOf(fleet.slice(0, 2));
  assert.ok(
    !evaluationsMonotone(config, {
      ...healthy,
      pre: healthy.post,
      post: dropped,
    }),
    "tickets are never deleted",
  );
  const advanced = fleetBut(fleet, 2, {
    evaluations: [runningInstance(3, 1, plan, new Set())],
  });
  assert.ok(
    evaluationsMonotone(config, {
      ...healthy,
      pre: healthy.post,
      post: advanced,
    }),
    "the last instance is the open one and advances",
  );
  const grown = fleetBut(fleet, 2, {
    evaluations: [...kept, judgedInstance(3, 2, plan)],
  });
  assert.ok(
    evaluationsMonotone(config, { ...healthy, pre: healthy.post, post: grown }),
  );
  assert.ok(
    !evaluationsMonotone(config, {
      ...healthy,
      pre: { tickets: new Map(grown.tickets) },
      post: fleetBut(fleet, 2, {
        evaluations: [
          runningInstance(3, 1, plan, new Set()),
          judgedInstance(3, 2, plan),
        ],
      }),
    }),
    "an instance with a newer one behind it is frozen",
  );
  assert.ok(currentInstance(ticketAt(healthy.post, id(3))).workCycle === 1);
});

test("idsAccounted rejects a mint counter the ticket's own history does not imply", () => {
  const short = graphOf([
    ticketOn(config, {
      phase: "Escalated",
      escalation: "WorkFailureEscalated",
      workCyclesStarted: 1,
      spawned: 0,
    }),
  ]);
  assert.ok(!idsAccounted(config, stateView(short)));
  assert.ok(
    deskConsistent(config, stateView(short)),
    "the surviving state is well-formed, which is why this needs its own invariant",
  );
  assert.ok(evaluationsWellFormed(config, stateView(short)));
  const unclaimed = graphOf([
    ticketOn(config, {
      phase: "Finalization",
      evaluations: [judgedInstance(1, 1, plan)],
      workCyclesStarted: 1,
      spawned: 1,
    }),
  ]);
  assert.ok(
    !idsAccounted(config, stateView(unclaimed)),
    "a stage claims its whole roster, once per generation it reached",
  );
  const resumed = graphOf([
    ticketOn(config, {
      phase: "Escalated",
      escalation: "EvaluationBlockedEscalated",
      evaluations: [blockedInstance(1, 1, plan, new Set([1]))],
      workCyclesStarted: 1,
      spawned: 1 + roster,
    }),
  ]);
  assert.ok(
    idsAccounted(config, stateView(resumed)),
    "a generation's slots are claimed whether or not the resume used them",
  );
  const reasked = graphOf([
    ticketOn(config, {
      phase: "Evaluation",
      evaluations: [resumeBlocked(blockedInstance(1, 1, plan, new Set([1])))],
      workCyclesStarted: 1,
      spawned: 1 + 2 * roster,
    }),
  ]);
  assert.ok(
    idsAccounted(config, stateView(reasked)),
    "a second generation claims the roster a second time",
  );
  const overMinted = graphOf([
    ticketOn(config, {
      phase: "Escalated",
      escalation: "WorkFailureEscalated",
      workCyclesStarted: 1,
      spawned: 2,
    }),
  ]);
  assert.ok(
    !idsAccounted(config, stateView(overMinted)),
    "a spawn site that bumped the counter twice is as wrong as one that never did",
  );
  assert.ok(idsAccounted(config, healthy));
});

test("taskIdentitiesValid rejects a live task whose identity counts from zero", () => {
  const zeroth = graphOf([
    ticketOn(config, {
      phase: "Work",
      spawned: 1,
    }),
  ]);
  assert.ok(
    !taskIdentitiesValid(config, stateView(zeroth)),
    "the contract counts cycles, stages and evaluators from one",
  );
  assert.ok(taskIdentitiesValid(config, healthy));
});

test("definitionsWellFormed rejects a definition no release could have carried", () => {
  const stage = { key: 1, evaluators: [evaluatorOf(1)] } as const;
  const overlong = Array.from({ length: config.maxStages + 1 }, (_u, i) => ({
    ...stage,
    key: i + 1,
  }));
  const illFormed: readonly (readonly StageDefinition[])[] = [
    [],
    [{ ...stage, evaluators: [] }],
    [{ ...stage, evaluators: [{ ...evaluatorOf(1), key: 0 }] }],
    [{ ...stage, evaluators: [evaluatorOf(1), evaluatorOf(1)] }],
    [{ ...stage, key: 2 }],
    [{ ...stage, evaluators: [evaluatorOf(config.nTasks + 1)] }],
    overlong,
  ];
  for (const stages of illFormed) {
    assert.ok(
      !definitionsWellFormed(config, stateView(fleetBut(fleet, 1, { stages }))),
      `${JSON.stringify(stages)} is not an authorable plan`,
    );
  }
  const first = fleet[0];
  assert.ok(first);
  assert.ok(
    !definitionsWellFormed(
      config,
      stateView(
        graphOf([
          { ...first, definition: { ...first.definition, content: 0 } },
        ]),
      ),
    ),
    "the content the release froze is a reference, and zero is no reference",
  );
  assert.ok(
    !definitionsWellFormed(
      config,
      stateView(fleetBut(fleet, 1, { revision: 0 })),
    ),
    "a release lands the first revision, and nothing counts down from it",
  );
  assert.ok(definitionsWellFormed(config, healthy));
});

test("revisionsAccounted rejects a definition that moved without its revision", () => {
  const pending = graphOf([ticketOn(config)]);
  const held = ticketAt(pending, id(1));
  const replan: readonly StageDefinition[] = [
    { key: 1, evaluators: [evaluatorOf(2)] },
  ];
  const update = decideUpdate(pending, {
    ticket: id(1),
    expectedRevision: 1,
    definition: { ...held.definition, evaluationPlan: { stages: replan } },
  });
  assert.equal(update.type, "TicketDecided");
  const updated = evolve(pending, update.value.event);
  assert.ok(revisionsAccounted(config, stepFrom(pending, updated)));
  const but = (
    graph: TicketGraph,
    edit: Partial<Ticket>,
    dependencies?: ReadonlySet<number>,
  ): TicketGraph => {
    const ticket = ticketAt(graph, id(1));
    return graphOf([
      {
        ...ticket,
        ...edit,
        definition: {
          ...ticket.definition,
          ...(dependencies === undefined ? {} : { dependencies }),
        },
      },
    ]);
  };
  const defects: readonly (readonly [string, TicketGraph, TicketGraph])[] = [
    [
      "a release lands the first revision",
      { tickets: new Map() },
      but(pending, { revision: 2 }),
    ],
    [
      "a definition replaced under the revision it held",
      pending,
      but(updated, { revision: 1 }),
    ],
    [
      "an update that skipped a revision",
      pending,
      but(updated, { revision: 3 }),
    ],
    [
      "an update landing as the ticket dispatches",
      pending,
      but(updated, { phase: "Work" }),
    ],
    [
      "an update landing on a ticket that had left Pending",
      but(pending, { phase: "Work" }),
      updated,
    ],
    [
      "an update that changed the dependencies",
      pending,
      but(updated, {}, new Set([2])),
    ],
  ];
  for (const [defect, pre, post] of defects) {
    assert.ok(!revisionsAccounted(config, stepFrom(pre, post)), defect);
  }
});

test("sourcePinned holds a source to the dispatch that pinned it", () => {
  assert.ok(sourcePinned(config, healthy));
  assert.ok(
    !sourcePinned(config, stateView(fleetBut(fleet, 1, { source: 0 }))),
    "a ticket that has started a work cycle was dispatched, and a dispatch names a source",
  );
  assert.ok(
    !sourcePinned(
      config,
      stateView(fleetBut(fleet, 0, { workCyclesStarted: 0 })),
    ),
    "and one that has started none was never dispatched, so it carries no source to have been pinned at",
  );
});

test("depsAcyclic rejects a dependency that points at nothing or back at itself", () => {
  assert.ok(
    !depsAcyclic(
      config,
      stateView(fleetBut(fleet, 1, { dependencies: depsOf(9) })),
    ),
    "each dep points at a ticket the fleet holds",
  );
  assert.ok(
    !depsAcyclic(
      config,
      stateView(fleetBut(fleet, 1, { dependencies: depsOf(2) })),
    ),
    "no ticket waits on itself",
  );
  const cyclic = graphOf([
    ticketOn(config, { phase: "Pending", dependencies: depsOf(2) }),
    ticketOn(config, { phase: "Pending", dependencies: depsOf(1) }),
  ]);
  assert.ok(
    !depsAcyclic(config, stateView(cyclic)),
    "the closure is transitive, so a cycle of any length is caught",
  );
  assert.ok(
    depsAcyclic(
      config,
      stateView(fleetBut(fleet, 1, { dependencies: depsOf(3) })),
    ),
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
    ticketOn(config, { phase: "Pending", dependencies: depsOf(1) }),
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
    ticketOn(config, { phase: "Pending", dependencies: depsOf(1) }),
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
      dependencies: depsOf(1),
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
      dependencies: depsOf(1),
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
    ticketOn(config, { phase: "Pending", dependencies: depsOf(1) }),
    ticketOn(config, { phase: "Pending", dependencies: depsOf(2) }),
  ]);
  const revoked = evolve(chain, acceptedOf(decideRevoke(chain, 1)).event);
  assert.deepEqual(
    [1, 2, 3].map((each) => ticketAt(revoked, id(each)).phase),
    ["Revoked", "Pending", "Pending"],
    "one ticket moves, the one the author named",
  );
  for (const invariant of [deskConsistent, stuckSubsetCovered, depsAcyclic]) {
    assert.ok(invariant(config, stateView(revoked)));
  }
  const cyclic = graphOf([
    ticketOn(config, { phase: "Pending", dependencies: depsOf(2) }),
    ticketOn(config, { phase: "Pending", dependencies: depsOf(1) }),
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

test("evaluationsWellFormed holds a sparse stage to the keys it lists, not to a count from one", () => {
  const sparse: readonly StageDefinition[] = [
    { key: 1, evaluators: [evaluatorOf(2)] },
  ];
  const judgingSparse = (instance: EvaluationInstance): TicketGraph =>
    graphOf([
      ticketOn(config, {
        phase: "Evaluation",
        stages: sparse,
        source: anAcceptedSource,
        evaluations: [instance],
        workCyclesStarted: 1,
        spawned: 2,
      }),
    ]);
  const listed = runningInstance(1, 1, sparse, new Set());
  assert.ok(
    evaluationsWellFormed(config, stateView(judgingSparse(listed))),
    "a sparse stage runs exactly the key it lists, and no key one",
  );
  const forged: EvaluationInstance = {
    ...listed,
    state: {
      type: "Running",
      value: {
        completedStages: [],
        stage: {
          stageIndex: 0,
          generation: 1,
          evaluators: new Map([[1, "Awaiting"]]),
        },
      },
    },
  };
  assert.ok(
    !evaluationsWellFormed(config, stateView(judgingSparse(forged))),
    "a stage listing key two alone is not running key one",
  );
});

/** A fleet with one ticket ready to dispatch, which is the smallest state a decision moves. */
const ready = graphOf([ticketOn(config, { phase: "Pending" })]);

/** The dispatch `ready` accepts. */
const dispatchedAt = (): SuccessfulTicketDecision =>
  acceptedOf(decideDispatch(ready, { ticket: 1, source: aDispatchSource }));

test("decisionsValid rejects an obligation the evolved state does not owe", () => {
  const dispatched = dispatchedAt();
  assert.ok(decisionsValid(config, decidedAt(ready, dispatched)));
  assert.ok(
    decisionsValid(config, initialView(ready)),
    "no decision, nothing to hold",
  );
  const [owed] = dispatched.obligations;
  assert.ok(owed);
  assert.ok(
    !decisionsValid(
      config,
      decidedAt(ready, { ...dispatched, obligations: [owed, owed] }),
    ),
    "no obligation is owed twice",
  );
  assert.ok(
    !decisionsValid(
      config,
      decidedAt(ready, {
        ...dispatched,
        obligations: [
          {
            type: "CancelTask",
            value: { ticket: 1, task: evaluationTaskOf(1, 1, 1, 1, 1) },
          },
        ],
      }),
    ),
    "a cancellation names a task the prior state was running",
  );
  assert.ok(
    !decisionsValid(
      config,
      decidedAt(ready, {
        ...dispatched,
        obligations: [
          {
            type: "ExecuteTask",
            value: {
              ticket: 2,
              task: workTaskObligation(ticketAt(ready, id(1)), 1),
            },
          },
        ],
      }),
    ),
    "an obligation names its own ticket",
  );
});

test("decisionsValid holds a refusal to the state it found", () => {
  const refusal = decideDispatch(ready, { ticket: 2, source: aDispatchSource });
  assert.ok(refusal.type === "TicketRefused");
  const refused = (post: TicketGraph): StepView => ({
    pre: ready,
    last: { type: "Refused", value: refusal.value },
    post,
  });
  assert.ok(decisionsValid(config, refused(ready)));
  assert.ok(
    eventsNeverIdentity(config, refused(ready)),
    "a refusal decides no event",
  );
  assert.ok(
    !decisionsValid(config, refused(evolve(ready, dispatchedAt().event))),
    "a refusal that moved the state is not one",
  );
});

test("eventsNeverIdentity rejects a decided event that does not move the state it was taken at", () => {
  const dispatched = dispatchedAt();
  assert.ok(eventsNeverIdentity(config, decidedAt(ready, dispatched)));
  const moved = evolve(ready, dispatched.event);
  assert.ok(
    !eventsNeverIdentity(config, decidedAt(moved, dispatched, moved)),
    "a dispatch of a ticket already working is owed nothing and moves nothing",
  );
  assert.ok(eventsNeverIdentity(config, initialView(ready)));
});
