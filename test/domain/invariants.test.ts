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
 * WHAT A TICKET'S STATE CARRIES IS THE PACKAGE'S, so the defects of a state's
 * own payload — a cycle at no source, an attempt at no generation, a wall
 * disagreeing with what it parked — are demonstrated against `graphWellFormed`,
 * and the ledger's against the members that read it.
 *
 * `stuckSubsetCovered` IS THE SHAPE OF HARD. It is a tautology over its
 * two walks and the model says so at length, so the defect it names is an edit
 * to a definition rather than a state: the demonstrations below mutate one
 * walk through the same sweep operator the real one is built from, which is
 * the only thing that could catch what it exists to catch.
 */

import type {
  EvaluationInstance,
  FinalizationOperation,
  StageDefinition,
  SuccessfulTicketDecision,
  Ticket,
  TicketGraph,
  TicketLedger,
  TicketState,
  WorkInput,
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
import { evaluationTaskOf, workTaskIdentity } from "../../src/domain/task.ts";
import {
  artifactWellFormed,
  completionExclusive,
  decisionsValid,
  depsAcyclic,
  graphWellFormed,
  idsAccounted,
  evaluationsMonotone,
  evaluationsWellFormed,
  definitionsWellFormed,
  revisionsAccounted,
  eventsNeverIdentity,
  revokedNeverCompletes,
  stuckSubsetCovered,
  taskIdentitiesValid,
  terminalsAbsorbing,
  ticketIdsWellFormed,
  type StepView,
} from "../../src/domain/invariants.ts";
import {
  emptyLedger,
  evaluationReworkInput,
  finalizationReworkInput,
  retryWorkInput,
  hasOpenHumanTask,
  initialWorkInput,
  workTaskObligation,
} from "../../src/domain/ticket.ts";
import { resumeBlocked } from "../../src/domain/evaluation.ts";
import type { Ledgers } from "../../src/domain/ledger.ts";
import { phaseOf } from "../../src/domain/phase.ts";
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
  depsOf,
  evaluationState,
  finalizationState,
  fleetBut,
  graphOf,
  healthyFleet,
  id,
  initialView,
  judgedInstance,
  ledgerFor,
  ledgersOf,
  runningInstance,
  rosterOf,
  ticketOn,
  workState,
  worldOf,
  type World,
} from "./fixtures.ts";

const config = modelInstance;
const plan = defaultPlan(config);
const roster = rosterOf(plan);
const fleet = healthyFleet(config);
const world = worldOf(fleet);
const healthy = initialView(world.graph, world.ledgers);

/** A view of one state, for the invariants that read only the state; ledgers are derived, with any overrides by id. */
const stateView = (
  post: TicketGraph,
  ledgers: ReadonlyMap<number, Partial<TicketLedger>> = new Map(),
): StepView => initialView(post, ledgersOf(post, ledgers));

/** A view of one world, graph and ledgers as given. */
const worldView = (state: World): StepView =>
  initialView(state.graph, state.ledgers);

/** A step from `pre` to `post`, for the invariants that read the state the last decision found. */
const stepFrom = (pre: TicketGraph, post: TicketGraph): StepView => ({
  pre,
  preLedgers: ledgersOf(pre),
  last: "NoDecision",
  post,
  postLedgers: ledgersOf(post),
});

/** The view a decision taken at `pre` leaves, with `post` standing in where a defect needs its own. */
const decidedAt = (
  pre: TicketGraph,
  decision: SuccessfulTicketDecision,
  post: TicketGraph = evolve(pre, decision.event),
): StepView => ({
  pre,
  preLedgers: ledgersOf(pre),
  last: { type: "Decided", value: decision },
  post,
  postLedgers: ledgersOf(post),
});

/** What every fixture ticket was released with, which is what a wall's input is held against. */
const released = ticketOn(config).definition;

/** The finalization the healthy fleet's last ticket is running, and the judgement that opened it. */
const finalizing = fleet.closed[2]?.[0];
assert.ok(finalizing);

/** A work wall, resuming with the released input, at the source named. */
const workWall = (source: number = anAcceptedSource): TicketState => ({
  type: "Escalated",
  value: {
    type: "WorkFailureEscalated",
    value: { resumeInput: initialWorkInput(released), source, evidence: 1 },
  },
});

/** The evaluation-failure wall, holding a dissenter's evidence, at the source named. */
const evaluationFailureWall = (
  source: number = anAcceptedSource,
): TicketState => ({
  type: "Escalated",
  value: {
    type: "EvaluationFailureEscalated",
    value: { evidence: [{ evaluator: 1, resultRef: 1 }], source },
  },
});

/** The blocked wall, holding the instance it parked. */
const blockedWall = (instance: EvaluationInstance): TicketState => ({
  type: "Escalated",
  value: { type: "EvaluationBlockedEscalated", value: instance },
});

/** The finalization wall, holding the attempt its resume follows. */
const finalizationWall = (
  finalization: FinalizationOperation,
): TicketState => ({
  type: "Escalated",
  value: {
    type: "FinalizationUnavailableEscalated",
    value: { finalization, evidence: 1 },
  },
});

/** The attempt a finalization state runs. */
function attemptOf(state: TicketState): FinalizationOperation {
  if (typeof state === "string" || state.type !== "Finalization")
    throw new Error("attemptOf: not a finalization state");
  return state.value;
}

/** The healthy fleet's attempt, which each finalization defect below edits one field of. */
const attempt = attemptOf(finalizationState(finalizing));

/** A cycle's input over content the ticket did not release. */
const otherContent: WorkInput = {
  ...initialWorkInput(released),
  released: released.content + 1,
};

/** One defect per term `workInputValid` and `workInputMatchesTicket` hold an input to. */
const workInputDefects: readonly (readonly [string, WorkInput])[] = [
  ["it runs over the content the ticket released", otherContent],
  [
    "each retry names the evidence it retries on",
    retryWorkInput(initialWorkInput(released), 0),
  ],
  [
    "a rework names at least one dissenter",
    evaluationReworkInput(released, []),
  ],
  [
    "a dissenter is an evaluator",
    evaluationReworkInput(released, [{ evaluator: 0, resultRef: 1 }]),
  ],
  [
    "a dissenter's result is a reference",
    evaluationReworkInput(released, [{ evaluator: 1, resultRef: 0 }]),
  ],
  [
    "a finalizer's rework names its evidence",
    finalizationReworkInput(released, 0),
  ],
];

/** The same judgement, of no produced result. */
const withoutResult = (instance: EvaluationInstance): EvaluationInstance => ({
  ...instance,
  input: { ...instance.input, workResult: 0 },
});

/** One payload defect per conjunct the package holds a state to, each named by the rule it breaks. */
const payloadDefects: readonly (readonly [string, World])[] = [
  [
    "a work cycle runs at the source its dispatch pinned",
    fleetBut(fleet, 1, { state: workState(ticketOn(config), 0) }),
  ],
  [
    "a ticket working has started the cycle it is on",
    fleetBut(fleet, 1, { workCyclesStarted: 0 }),
  ],
  [
    "a work wall holds the source the cycle it stopped ran at",
    fleetBut(fleet, 1, { state: workWall(0) }),
  ],
  [
    "the evaluation-failure wall holds the source the judged result was accepted at",
    fleetBut(fleet, 1, { state: evaluationFailureWall(0) }),
  ],
  [
    "a ticket finalizing is on some attempt",
    fleetBut(fleet, 2, { state: finalizationState(finalizing, 0) }),
  ],
  [
    "an attempt finalizes at the source the judged result was accepted at",
    fleetBut(fleet, 2, {
      state: { type: "Finalization", value: { ...attempt, source: 0 } },
    }),
  ],
  [
    "the finalization wall holds the attempt its resume follows",
    fleetBut(fleet, 2, {
      state: finalizationWall({ ...attempt, generation: 0 }),
    }),
  ],
  [
    "the finalization wall holds the source its attempt ran at",
    fleetBut(fleet, 2, {
      state: finalizationWall({ ...attempt, source: 0 }),
    }),
  ],
  [
    "a judgement judges a result accepted at a source",
    fleetBut(fleet, 1, {
      state: evaluationState({
        ...runningInstance(2, 1, plan, new Set()),
        input: {
          ...runningInstance(2, 1, plan, new Set()).input,
          acceptedSourceRef: 0,
        },
      }),
    }),
  ],
  [
    "the content the release froze is a reference, and zero is no reference",
    worldOf({
      ...fleet,
      tickets: fleet.tickets.map((ticket, at) =>
        at === 1
          ? { ...ticket, definition: { ...ticket.definition, content: 0 } }
          : ticket,
      ),
    }),
  ],
  [
    "a release lands the first revision, and nothing counts down from it",
    fleetBut(fleet, 1, { revision: 0 }),
  ],
  [
    "a settled ticket still holds a release the package could have carried",
    worldOf({
      ...fleet,
      tickets: fleet.tickets.map((ticket, at) =>
        at === 0
          ? {
              ...ticket,
              definition: {
                ...ticket.definition,
                finalizationConfiguration: 0,
              },
            }
          : ticket,
      ),
    }),
  ],
  [
    "no ticket has started fewer than no cycles",
    fleetBut(fleet, 0, { workCyclesStarted: -1 }),
  ],
  [
    "a pending ticket has started no cycle",
    fleetBut(fleet, 1, { state: "Pending" }),
  ],
  ...workInputDefects.map(
    ([defect, input]) =>
      [
        `a cycle's input: ${defect}`,
        fleetBut(fleet, 1, {
          state: { type: "Work", value: { input, source: anAcceptedSource } },
        }),
      ] as const,
  ),
  [
    "a work wall resumes over the content the ticket released",
    fleetBut(fleet, 1, {
      state: {
        type: "Escalated",
        value: {
          type: "WorkFailureEscalated",
          value: {
            resumeInput: otherContent,
            source: anAcceptedSource,
            evidence: 1,
          },
        },
      },
    }),
  ],
  [
    "a work wall holds the evidence that parked it",
    fleetBut(fleet, 1, {
      state: {
        type: "Escalated",
        value: {
          type: "WorkExecutionUnavailableEscalated",
          value: {
            resumeInput: initialWorkInput(released),
            source: anAcceptedSource,
            evidence: 0,
          },
        },
      },
    }),
  ],
  [
    "the evaluation-failure wall holds a dissenter's evidence",
    fleetBut(fleet, 1, {
      state: {
        type: "Escalated",
        value: {
          type: "EvaluationFailureEscalated",
          value: { evidence: [], source: anAcceptedSource },
        },
      },
    }),
  ],
  [
    "a judgement judges a produced result",
    fleetBut(fleet, 1, {
      state: evaluationState(
        withoutResult(runningInstance(2, 1, plan, new Set())),
      ),
    }),
  ],
  [
    "a judgement is of the ticket that holds it",
    fleetBut(fleet, 1, {
      state: evaluationState(runningInstance(3, 1, plan, new Set())),
    }),
  ],
  [
    "the blocked wall holds a judgement of a produced result",
    fleetBut(fleet, 1, {
      state: blockedWall(
        withoutResult(blockedInstance(2, 1, plan, new Set([1]))),
      ),
    }),
  ],
  [
    "the blocked wall holds a judgement of the ticket parked at it",
    fleetBut(fleet, 1, {
      state: blockedWall(blockedInstance(3, 1, plan, new Set([1]))),
    }),
  ],
  [
    "the blocked wall holds a judgement of the cycle the ticket is on",
    fleetBut(fleet, 1, {
      state: blockedWall(blockedInstance(2, 2, plan, new Set([1]))),
    }),
  ],
  [
    "an attempt finalizes the cycle the ticket is on",
    fleetBut(fleet, 2, {
      state: { type: "Finalization", value: { ...attempt, workCycle: 2 } },
    }),
  ],
  [
    "an attempt finalizes a produced result",
    fleetBut(fleet, 2, {
      state: { type: "Finalization", value: { ...attempt, input: 0 } },
    }),
  ],
  [
    "the finalization wall holds an attempt of the cycle the ticket is on",
    fleetBut(fleet, 2, {
      state: finalizationWall({ ...attempt, workCycle: 2 }),
    }),
  ],
  [
    "the finalization wall holds an attempt of a produced result",
    fleetBut(fleet, 2, { state: finalizationWall({ ...attempt, input: 0 }) }),
  ],
  [
    "the finalization wall holds the evidence that parked it",
    fleetBut(fleet, 2, {
      state: {
        type: "Escalated",
        value: {
          type: "FinalizationUnavailableEscalated",
          value: { finalization: attempt, evidence: 0 },
        },
      },
    }),
  ],
];

test("graphWellFormed rejects a state whose payload the package's ticketInvariant refuses", () => {
  assert.ok(graphWellFormed(config, healthy));
  assert.deepEqual(
    payloadDefects
      .filter(([, state]) => graphWellFormed(config, worldView(state)))
      .map(([defect]) => defect),
    [],
  );
  assert.ok(
    graphWellFormed(
      config,
      worldView(fleetBut(fleet, 2, { state: finalizationWall(attempt) })),
    ),
    "the same wall, holding the attempt it stopped, is well-formed",
  );
});

test("graphWellFormed rejects a state that disagrees with the instance it holds open", () => {
  const judging = (
    instance: EvaluationInstance,
    workCyclesStarted = 1,
  ): TicketGraph =>
    graphOf([
      ticketOn(config, {
        state: evaluationState(instance),
        workCyclesStarted,
      }),
    ]);
  assert.ok(
    graphWellFormed(
      config,
      stateView(judging(runningInstance(1, 1, plan, new Set()))),
    ),
  );
  assert.ok(
    !graphWellFormed(config, stateView(judging(judgedInstance(1, 1, plan)))),
    "a ticket in Evaluation is running a stage, not holding a settled judgement",
  );
  assert.ok(
    !graphWellFormed(
      config,
      stateView(judging(runningInstance(1, 2, plan, new Set()), 3)),
    ),
    "the open instance judges the cycle the ticket is on",
  );
  const parked = (instance: EvaluationInstance): TicketGraph =>
    graphOf([
      ticketOn(config, { state: blockedWall(instance), workCyclesStarted: 1 }),
    ]);
  assert.ok(
    !graphWellFormed(config, stateView(parked(judgedInstance(1, 1, plan)))),
    "the desk's blocked wall and the instance's blocked state are one fact",
  );
  assert.ok(
    graphWellFormed(
      config,
      stateView(parked(blockedInstance(1, 1, plan, new Set([1])))),
    ),
  );
});

test("completionExclusive rejects a ledger that disagrees with the state", () => {
  assert.ok(
    !completionExclusive(
      config,
      worldView(fleetBut(fleet, 1, {}, { completions: 2 })),
    ),
    "nothing completes twice, wherever the count stands",
  );
  assert.ok(
    !completionExclusive(
      config,
      worldView(fleetBut(fleet, 0, {}, { completions: 0 })),
    ),
    "Done means the completion was recorded",
  );
  assert.ok(
    !completionExclusive(
      config,
      worldView(fleetBut(fleet, 1, {}, { completions: 1 })),
    ),
    "a completion means the ticket is Done",
  );
  assert.ok(completionExclusive(config, healthy));
});

test("revokedNeverCompletes rejects a revoked ticket that completed", () => {
  const revoked = graphOf([ticketOn(config, { state: "Revoked" })]);
  assert.ok(
    !revokedNeverCompletes(
      config,
      stateView(revoked, new Map([[1, { completions: 1 }]])),
    ),
  );
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
      worldView(fleetBut(fleet, 0, {}, { closedEvaluations: [] })),
    ),
  );
  const revoked = graphOf([ticketOn(config, { state: "Revoked" })]);
  assert.ok(
    artifactWellFormed(config, stateView(revoked)),
    "a revoked ticket may never have run",
  );
});

test("terminalsAbsorbing rejects a ticket that left a terminal", () => {
  for (const state of ["Done", "Revoked"] as const) {
    assert.ok(
      !terminalsAbsorbing(
        config,
        stepFrom(
          graphOf([ticketOn(config, { state })]),
          graphOf([ticketOn(config)]),
        ),
      ),
      `${state} is absorbing, so no event moves a ticket out of it`,
    );
  }
  assert.ok(
    !terminalsAbsorbing(
      config,
      stepFrom(graphOf([ticketOn(config, { state: "Done" })]), graphOf([])),
    ),
    "a terminal ticket is never dropped",
  );
  assert.ok(
    terminalsAbsorbing(
      config,
      stepFrom(
        graphOf([
          ticketOn(config, {
            workCyclesStarted: 1,
            state: finalizationState(judgedInstance(1, 1, plan)),
          }),
        ]),
        graphOf([ticketOn(config, { workCyclesStarted: 1, state: "Done" })]),
      ),
    ),
  );
});

/** A Done ticket that closed `closed`, having started as many cycles as `workCyclesStarted` says. */
const settled = (
  closed: readonly EvaluationInstance[],
  workCyclesStarted = closed.length,
): StepView =>
  stateView(
    graphOf([ticketOn(config, { state: "Done", workCyclesStarted })]),
    new Map([[1, { closedEvaluations: closed }]]),
  );

test("evaluationsWellFormed rejects a judgement that is not this ticket's", () => {
  assert.ok(
    !evaluationsWellFormed(config, settled([judgedInstance(2, 1, plan)])),
    "an instance names the ticket it judges, and a ticket carries no other's",
  );
  assert.ok(
    !evaluationsWellFormed(
      config,
      settled([
        judgedInstance(1, 1, [{ key: 1, evaluators: [evaluatorOf(1)] }]),
      ]),
    ),
    "the plan is the one the release froze",
  );
  assert.ok(
    !evaluationsWellFormed(config, settled([judgedInstance(1, 2, plan)], 1)),
    "a judgement judges a work cycle the ticket has actually started",
  );
  assert.ok(
    !evaluationsWellFormed(
      config,
      settled([judgedInstance(1, 2, plan), judgedInstance(1, 1, plan)]),
    ),
    "the instances stand in the order their cycles ran",
  );
  assert.ok(
    !evaluationsWellFormed(
      config,
      settled([judgedInstance(1, 1, plan), judgedInstance(1, 1, plan)], 1),
    ),
    "no cycle is judged twice",
  );
  assert.ok(
    evaluationsWellFormed(
      config,
      settled([judgedInstance(1, 1, plan), judgedInstance(1, 2, plan)]),
    ),
  );
  assert.ok(evaluationsWellFormed(config, healthy));
});

test("evaluationsMonotone rejects a history that shrank, was rewritten, or lost its ticket", () => {
  const kept = ticketAt(world.graph, id(3));
  const closedOnThird = (closed: readonly EvaluationInstance[]): Ledgers =>
    new Map([
      ...world.ledgers,
      [3, ledgerFor(kept, { closedEvaluations: closed })],
    ]);
  const from = (postLedgers: Ledgers, post = world.graph): StepView => ({
    pre: world.graph,
    preLedgers: world.ledgers,
    last: "NoDecision",
    post,
    postLedgers,
  });
  assert.ok(
    !evaluationsMonotone(config, from(closedOnThird([]))),
    "a closed judgement is never dropped",
  );
  assert.ok(
    !evaluationsMonotone(
      config,
      from(closedOnThird([judgedInstance(3, 1, plan, () => "EvaluatorFail")])),
    ),
    "a closed judgement is never rewritten",
  );
  const dropped = worldOf({
    tickets: fleet.tickets.slice(0, 2),
    closed: fleet.closed.slice(0, 2),
  });
  assert.ok(
    !evaluationsMonotone(config, from(dropped.ledgers, dropped.graph)),
    "tickets are never deleted",
  );
  assert.ok(
    evaluationsMonotone(
      config,
      from(closedOnThird([finalizing, judgedInstance(3, 2, plan)])),
    ),
  );
});

test("idsAccounted rejects a mint counter the ticket's own history does not imply", () => {
  const short = stateView(
    graphOf([ticketOn(config, { state: workWall(), workCyclesStarted: 1 })]),
    new Map([[1, { spawned: 0 }]]),
  );
  assert.ok(!idsAccounted(config, short));
  assert.ok(
    graphWellFormed(config, short),
    "the surviving state is well-formed, which is why this needs its own invariant",
  );
  assert.ok(evaluationsWellFormed(config, short));
  const judged = judgedInstance(1, 1, plan);
  const unclaimed = stateView(
    graphOf([
      ticketOn(config, {
        state: finalizationState(judged),
        workCyclesStarted: 1,
      }),
    ]),
    new Map([[1, { closedEvaluations: [judged], spawned: 1 }]]),
  );
  assert.ok(
    !idsAccounted(config, unclaimed),
    "a stage claims its whole roster, once per generation it reached",
  );
  const resumed = stateView(
    graphOf([
      ticketOn(config, {
        state: blockedWall(blockedInstance(1, 1, plan, new Set([1]))),
        workCyclesStarted: 1,
      }),
    ]),
    new Map([[1, { spawned: 1 + roster }]]),
  );
  assert.ok(
    idsAccounted(config, resumed),
    "a generation's slots are claimed whether or not the resume used them",
  );
  const reasked = stateView(
    graphOf([
      ticketOn(config, {
        state: evaluationState(
          resumeBlocked(blockedInstance(1, 1, plan, new Set([1]))),
        ),
        workCyclesStarted: 1,
      }),
    ]),
    new Map([[1, { spawned: 1 + 2 * roster }]]),
  );
  assert.ok(
    idsAccounted(config, reasked),
    "a second generation claims the roster a second time",
  );
  const overMinted = stateView(
    graphOf([ticketOn(config, { state: workWall(), workCyclesStarted: 1 })]),
    new Map([[1, { spawned: 2 }]]),
  );
  assert.ok(
    !idsAccounted(config, overMinted),
    "a spawn site that bumped the counter twice is as wrong as one that never did",
  );
  assert.ok(idsAccounted(config, healthy));
});

test("taskIdentitiesValid rejects a live task whose identity counts from zero", () => {
  const zeroth = graphOf([
    ticketOn(config, { state: workState(ticketOn(config)) }),
  ]);
  assert.ok(
    !taskIdentitiesValid(config, stateView(zeroth)),
    "the contract counts cycles, stages and evaluators from one",
  );
  assert.ok(taskIdentitiesValid(config, healthy));
});

test("definitionsWellFormed rejects a plan no release could have carried", () => {
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
      !definitionsWellFormed(config, worldView(fleetBut(fleet, 1, { stages }))),
      `${JSON.stringify(stages)} is not an authorable plan`,
    );
  }
  assert.ok(definitionsWellFormed(config, healthy));
});

/** A one-ticket graph's ticket with `edit` applied, and its dependencies replaced if given. */
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
  const working = { state: workState(held), workCyclesStarted: 1 };
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
      but(updated, working),
    ],
    [
      "an update landing on a ticket that had left Pending",
      but(pending, working),
      updated,
    ],
    [
      "an update that changed the dependencies",
      pending,
      but(updated, {}, new Set([2])),
    ],
    [
      "a revision that moved under a definition that did not",
      but(pending, working),
      but(pending, { ...working, revision: 2 }),
    ],
  ];
  for (const [defect, pre, post] of defects) {
    assert.ok(!revisionsAccounted(config, stepFrom(pre, post)), defect);
  }
});

test("depsAcyclic rejects a dependency that points at nothing or back at itself", () => {
  assert.ok(
    !depsAcyclic(
      config,
      worldView(fleetBut(fleet, 1, { dependencies: depsOf(9) })),
    ),
    "each dep points at a ticket the fleet holds",
  );
  assert.ok(
    !depsAcyclic(
      config,
      worldView(fleetBut(fleet, 1, { dependencies: depsOf(2) })),
    ),
    "no ticket waits on itself",
  );
  const cyclic = graphOf([
    ticketOn(config, { dependencies: depsOf(2) }),
    ticketOn(config, { dependencies: depsOf(1) }),
  ]);
  assert.ok(
    !depsAcyclic(config, stateView(cyclic)),
    "the closure is transitive, so a cycle of any length is caught",
  );
  const longCycle = graphOf([
    ticketOn(config, { dependencies: depsOf(2) }),
    ticketOn(config, { dependencies: depsOf(3) }),
    ticketOn(config, { dependencies: depsOf(4) }),
    ticketOn(config, { dependencies: depsOf(1) }),
  ]);
  assert.ok(
    !depsAcyclic(config, stateView(longCycle)),
    "a cycle through four tickets is caught as surely as one through two",
  );
  assert.ok(
    depsAcyclic(
      config,
      worldView(fleetBut(fleet, 1, { dependencies: depsOf(3) })),
    ),
    "ids are sparse, so an edge pointing at a numerically larger ticket is ordinary",
  );
  assert.ok(depsAcyclic(config, healthy));
});

test("ticketIdsWellFormed rejects an id off the universe, a fleet past its bound, and a ticket without its ledger", () => {
  const first = ticketAt(world.graph, id(1));
  const offUniverse: TicketGraph = {
    tickets: new Map([[asTicketId(config.nTickets * 2 + 1), first]]),
  };
  assert.ok(
    !ticketIdsWellFormed(config, stateView(offUniverse)),
    "a release draws its id from a finite universe",
  );
  const overfull = graphOf([...fleet.tickets, ticketOn(config)]);
  assert.ok(
    !ticketIdsWellFormed(config, stateView(overfull)),
    "releases are bounded by the fleet cap, which the id universe deliberately is not",
  );
  assert.ok(
    !ticketIdsWellFormed(
      config,
      initialView(world.graph, new Map([...world.ledgers].slice(0, 2))),
    ),
    "every released ticket holds a ledger",
  );
  assert.ok(
    !ticketIdsWellFormed(
      config,
      initialView(
        world.graph,
        new Map([...world.ledgers, [id(4), emptyLedger]]),
      ),
    ),
    "and no ledger is held for a ticket never released",
  );
  assert.ok(
    !ticketIdsWellFormed(
      config,
      initialView(
        world.graph,
        new Map([...[...world.ledgers].slice(0, 2), [id(4), emptyLedger]]),
      ),
    ),
    "each ledger is the one its ticket's id keys, however many there are",
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

/** A ticket parked at the work wall, which is the smallest desk task there is. */
const parkedTicket = (dependencies?: ReadonlySet<number>): Ticket =>
  ticketOn(config, {
    state: workWall(),
    workCyclesStarted: 1,
    ...(dependencies === undefined ? {} : { dependencies }),
  });

test("stuckSubsetCovered goes red when one walk gets a base case the other lacks", () => {
  const running = graphOf([
    ticketOn(config, {
      state: finalizationState(judgedInstance(1, 1, plan)),
      workCyclesStarted: 1,
    }),
    ticketOn(config, { dependencies: depsOf(1) }),
  ]);
  assert.ok(stuckSubsetCovered(config, stateView(running)));
  const finalizingIsStuck = sweep(running, (graph, each, stuck) => {
    const phase = phaseOf(ticketAt(graph, each).state);
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
    parkedTicket(),
    ticketOn(config, { dependencies: depsOf(1) }),
  ]);
  const guardedCoverage = sweep(
    parked,
    (graph, each, covered) =>
      hasOpenHumanTask(ticketAt(graph, each)) ||
      (phaseOf(ticketAt(graph, each).state) === "Work" &&
        visEdges(graph, each).some((d) => covered.has(d))),
  );
  assert.ok(stuckSubsetCovered(config, stateView(parked)));
  assert.ok(
    !subsetOf(stuckSet(parked), guardedCoverage),
    "a phase guard on coverage's inductive arm leaves a stuck ticket uncovered",
  );
});

test("stuckSubsetCovered goes red when one walk gets an edge kind the other lacks", () => {
  const upstream = graphOf([ticketOn(config), parkedTicket(depsOf(1))]);
  assert.ok(stuckSubsetCovered(config, stateView(upstream)));
  const bothWays = sweep(upstream, (graph, each, stuck) => {
    const dependents = liveTickets(graph).filter((other) =>
      visEdges(graph, other).includes(each),
    );
    return (
      phaseOf(ticketAt(graph, each).state) === "Escalated" ||
      [...visEdges(graph, each), ...dependents].some((d) => stuck.has(d))
    );
  });
  assert.ok(
    !subsetOf(bothWays, coveredSet(upstream)),
    "an edge kind added to one walk and not the other is exactly what this guards",
  );
  const wider = graphOf([
    parkedTicket(),
    ticketOn(config, {
      state: "Done",
      workCyclesStarted: 1,
      dependencies: depsOf(1),
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
    ticketOn(config),
    ticketOn(config, { dependencies: depsOf(1) }),
    ticketOn(config, { dependencies: depsOf(2) }),
  ]);
  const revoked = evolve(chain, acceptedOf(decideRevoke(chain, 1)).event);
  assert.deepEqual(
    [1, 2, 3].map((each) => phaseOf(ticketAt(revoked, id(each)).state)),
    ["Revoked", "Pending", "Pending"],
    "one ticket moves, the one the author named",
  );
  for (const invariant of [graphWellFormed, stuckSubsetCovered, depsAcyclic]) {
    assert.ok(invariant(config, stateView(revoked)));
  }
  const cyclic = graphOf([
    ticketOn(config, { dependencies: depsOf(2) }),
    ticketOn(config, { dependencies: depsOf(1) }),
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
  const judgingSparse = (instance: EvaluationInstance): StepView =>
    stateView(
      graphOf([
        ticketOn(config, {
          stages: sparse,
          state: evaluationState(instance),
          workCyclesStarted: 1,
        }),
      ]),
    );
  const listed = runningInstance(1, 1, sparse, new Set());
  assert.ok(
    evaluationsWellFormed(config, judgingSparse(listed)),
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
    !evaluationsWellFormed(config, judgingSparse(forged)),
    "a stage listing key two alone is not running key one",
  );
});

/** A fleet with one ticket ready to dispatch, which is the smallest state a decision moves. */
const ready = graphOf([ticketOn(config)]);

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
  const held = ticketAt(ready, id(1));
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
              task: workTaskObligation(held, 1),
            },
          },
        ],
      }),
    ),
    "an obligation names its own ticket",
  );
});

/** Ticket 1 finalizing, and ticket 2 ready, so a dispatch of 2 leaves 1's attempt standing. */
const finalizingBeside = graphOf([
  ticketOn(config, {
    state: finalizationState(judgedInstance(1, 1, plan)),
    workCyclesStarted: 1,
  }),
  ticketOn(config),
]);

/** Ticket 1 working its first cycle, and ticket 2 ready. */
const workingBeside = graphOf([
  ticketOn(config, {
    state: workState(ticketOn(config)),
    workCyclesStarted: 1,
  }),
  ticketOn(config),
]);

/** The dispatch of ticket 2 at `pre`, owing what it owes and `extra` beside it. */
const dispatchOfSecond = (
  pre: TicketGraph,
  ...extra: SuccessfulTicketDecision["obligations"]
): SuccessfulTicketDecision => {
  const decided = acceptedOf(
    decideDispatch(pre, { ticket: 2, source: aDispatchSource }),
  );
  return { ...decided, obligations: [...decided.obligations, ...extra] };
};

/** The attempt ticket 1 of `finalizingBeside` is on. */
const standing = attemptOf(ticketAt(finalizingBeside, id(1)).state);

/** A finalization owed for ticket `ticket`, on `finalization`, under `configuration`. */
const finalizeOwed = (
  ticket: number,
  finalization: FinalizationOperation,
  configuration = 1,
): SuccessfulTicketDecision["obligations"][number] => ({
  type: "FinalizeTicket",
  value: { ticket, finalization, configuration },
});

/** The work ticket 2's dispatch owes, with its definition naming no workload. */
const workloadless = ((): SuccessfulTicketDecision["obligations"][number] => {
  const [owed] = dispatchOfSecond(finalizingBeside).obligations;
  assert.ok(owed?.type === "ExecuteTask");
  const { task } = owed.value;
  return {
    type: "ExecuteTask",
    value: {
      ...owed.value,
      task: { ...task, definition: { ...task.definition, workload: 0 } },
    },
  };
})();

/** A ticket working a cycle it never started, which is all a revoke's zeroth task can come from. */
const zeroth = graphOf([
  ticketOn(config, { state: workState(ticketOn(config)) }),
]);

/** Three tickets waiting on each other in a ring, and a fourth ready beside them. */
const ringed = graphOf([
  ticketOn(config, { dependencies: depsOf(2) }),
  ticketOn(config, { dependencies: depsOf(3) }),
  ticketOn(config, { dependencies: depsOf(1) }),
  ticketOn(config),
]);

/** `ready`, with its one ticket held a second time under another id. */
const misKeyed: TicketGraph = {
  tickets: new Map([...ready.tickets, [id(2), ticketAt(ready, id(1))]]),
};

/** One decision per term of `decisionValid`, each named by the rule it breaks and taken at the state beside it. */
const invalidDecisions: readonly (readonly [
  string,
  TicketGraph,
  SuccessfulTicketDecision,
])[] = [
  [
    "a task to run is one the evolved ticket owes",
    finalizingBeside,
    dispatchOfSecond(finalizingBeside, {
      type: "ExecuteTask",
      value: {
        ticket: 1,
        task: workTaskObligation(ticketAt(finalizingBeside, id(1)), 1),
      },
    }),
  ],
  [
    "a task to stop is one the evolved ticket no longer owes",
    workingBeside,
    dispatchOfSecond(workingBeside, {
      type: "CancelTask",
      value: { ticket: 1, task: workTaskIdentity(1, 1) },
    }),
  ],
  [
    "a finalization to attempt is the one the evolved ticket is on",
    finalizingBeside,
    dispatchOfSecond(
      finalizingBeside,
      finalizeOwed(1, { ...standing, generation: standing.generation + 1 }),
    ),
  ],
  [
    "a finalization names a ticket the graph holds",
    finalizingBeside,
    dispatchOfSecond(finalizingBeside, finalizeOwed(9, standing)),
  ],
  [
    "a finalization runs under a configuration",
    finalizingBeside,
    dispatchOfSecond(finalizingBeside, finalizeOwed(1, standing, 0)),
  ],
  [
    "a task runs under a definition naming a workload",
    finalizingBeside,
    { ...dispatchOfSecond(finalizingBeside), obligations: [workloadless] },
  ],
  [
    "a task to stop has an identity counting from one",
    zeroth,
    {
      ...acceptedOf(decideRevoke(zeroth, 1)),
      obligations: [
        {
          type: "CancelTask",
          value: { ticket: 1, task: workTaskIdentity(1, 0) },
        },
      ],
    },
  ],
  [
    "the evolved graph waits on no ticket through a cycle",
    ringed,
    acceptedOf(decideDispatch(ringed, { ticket: 4, source: aDispatchSource })),
  ],
  [
    "the evolved graph keys every ticket by its own id",
    misKeyed,
    acceptedOf(
      decideDispatch(misKeyed, { ticket: 1, source: aDispatchSource }),
    ),
  ],
];

test("decisionsValid refuses each obligation and each evolved graph the writer's guard exists to refuse", () => {
  assert.ok(
    decisionsValid(
      config,
      decidedAt(
        finalizingBeside,
        dispatchOfSecond(finalizingBeside, finalizeOwed(1, standing)),
      ),
    ),
    "the attempt ticket 1 is on, owed where it stands, is valid",
  );
  assert.deepEqual(
    invalidDecisions
      .filter(([, pre, decision]) =>
        decisionsValid(config, decidedAt(pre, decision)),
      )
      .map(([defect]) => defect),
    [],
  );
});

test("decisionsValid holds a refusal to the state it found", () => {
  const refusal = decideDispatch(ready, { ticket: 2, source: aDispatchSource });
  assert.ok(refusal.type === "TicketRefused");
  const refused = (post: TicketGraph): StepView => ({
    pre: ready,
    preLedgers: ledgersOf(ready),
    last: { type: "Refused", value: refusal.value },
    post,
    postLedgers: ledgersOf(post),
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
