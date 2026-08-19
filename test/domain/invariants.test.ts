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
 * TWO OF THEM CANNOT BE MADE RED BY A STATE, and saying so is the honest
 * report rather than substituting a weaker check. `completionExclusive` and
 * `revokedNeverCompletes` are stated over a completion count that this record
 * derives from the phase rather than storing, so no `Ticket` can carry the
 * disagreement — the defect exists only in the derivation, and the per-ticket
 * predicate is fed one directly here. The model warns by name that an
 * invariant which cannot fail is a defect written on purpose; what carries the
 * property instead is the conformance replay's per-step record equality and
 * the randomized walk's completion-emission accumulator.
 *
 * `stuckSubsetCovered` IS THE OTHER SHAPE OF HARD. It is a tautology over its
 * two walks and the model says so at length, so the defect it names is an edit
 * to a definition rather than a state: the demonstrations below mutate one
 * walk through the same sweep operator the real one is built from, which is
 * the only thing that could catch what it exists to catch.
 */

import type {
  Core,
  StepRecord,
  Task,
} from "../../src/domain/generated/modelTypes.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

import { boundsOf } from "../../src/domain/config.ts";
import { liveTickets, ticketAt } from "../../src/domain/core.ts";
import {
  decideOpRetry,
  decideRelease,
  decideRevoke,
} from "../../src/domain/deciders.ts";
import {
  coveredSet,
  stuckSet,
  subsetOf,
  sweep,
  visEdges,
} from "../../src/domain/derived.ts";
import { asProjectId, asTicketId } from "../../src/domain/ids.ts";
import {
  accountsBounded,
  artifactWellFormed,
  cascadeSafety,
  completionExclusive,
  completionExclusiveFor,
  depsAcyclic,
  deskConsistent,
  idsAccounted,
  idsDense,
  leaseExclusive,
  measureNonNegative,
  noLeaseWithoutAKind,
  noStructuralDeadlock,
  programsWellFormed,
  projectsWellFormed,
  quietProjectLandsCleanly,
  recordMonotone,
  recordWellFormed,
  revokedNeverCompletes,
  revokedNeverCompletesFor,
  stepDescends,
  stuckSubsetCovered,
  tasksWellFormed,
  terminalsAbsorbing,
  wrapUpIsolation,
  wrapUpWallNamed,
  wrapUpWellFormed,
  type StepView,
} from "../../src/domain/invariants.ts";
import { sysMeasure } from "../../src/domain/measure.ts";
import { reworkBudget } from "../../src/domain/pricing.ts";

import { completionsOf, hasOpenHumanTask } from "../../src/domain/ticket.ts";
import {
  aNone,
  aSome,
  wExclusive,
  wNone,
  woAttempt,
} from "../../src/domain/wrapUp.ts";
import {
  budgetedInstance,
  deadlineOnlyInstance,
  retryFreeInstance,
} from "./configs.ts";
import {
  coreOf,
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

const config = budgetedInstance;
const fleet = healthyFleet(config);
const healthy = initialView(coreOf(fleet));

/** A view of one state, for the invariants that read only the state. */
const stateView = (post: Core): StepView => initialView(post);

/** The mid-flight fleet under a record of the caller's, for the invariants that read one. */
const stepView = (rec: StepRecord): StepView => ({ ...healthy, rec });

/** A record naming a step, with the transitions and attribution the caller is demonstrating. */
const recordOf = (rec: Partial<StepRecord>): StepRecord => ({
  ...healthy.rec,
  ...rec,
});

test("completionExclusive rejects a count that disagrees with the phase", () => {
  assert.ok(completionExclusiveFor(1, "Done"));
  assert.ok(completionExclusiveFor(0, "Working"));
  assert.ok(!completionExclusiveFor(2, "Done"), "nothing completes twice");
  assert.ok(
    !completionExclusiveFor(0, "Done"),
    "Done means the completion was emitted",
  );
  assert.ok(
    !completionExclusiveFor(1, "Working"),
    "a completion means the ticket is Done",
  );
  assert.deepEqual(
    liveTickets(healthy.post).map((each) =>
      completionsOf(ticketAt(healthy.post, each)),
    ),
    [1, 0, 0],
    "the count is derived from the phase, which is why no state can carry the defect above",
  );
  assert.ok(completionExclusive(config, healthy));
});

test("revokedNeverCompletes rejects a revoked ticket that completed", () => {
  assert.ok(revokedNeverCompletesFor(0, "Revoked"));
  assert.ok(revokedNeverCompletesFor(1, "Done"));
  assert.ok(
    !revokedNeverCompletesFor(1, "Revoked"),
    "a revoke settles the ticket before any completion effect fires",
  );
  const revoked = coreOf([ticketOn(config, 1, { phase: "Revoked" })]);
  assert.equal(completionsOf(ticketAt(revoked, id(1))), 0);
  assert.ok(revokedNeverCompletes(config, stateView(revoked)));
});

test("wrapUpIsolation rejects a wrap-up resolved off the record or attributed elsewhere", () => {
  for (const label of [
    "rework-started wrapup_failure",
    "ticket-escalated wrapup_budget_exhausted",
  ]) {
    assert.ok(
      !wrapUpIsolation(config, stepView(recordOf({ label }))),
      `${label} is unique to the wrap-up side, so carrying no attempt resolves one off-record`,
    );
  }
  assert.ok(
    !wrapUpIsolation(
      config,
      stepView(
        recordOf({
          label: "ticket-done",
          transitions: [{ ticket: id(3), from: "PWrapUpHolding", to: "Done" }],
        }),
      ),
    ),
    "a ticket with a lease kind completed with no attempt recorded",
  );
  assert.ok(
    !wrapUpIsolation(
      config,
      stepView(
        recordOf({
          label: "ticket-done",
          transitions: [{ ticket: id(3), from: "PWrapUpHolding", to: "Done" }],
          attempt: woAttempt(asProjectId(1), true),
        }),
      ),
    ),
    "the attempt names a project that is not the stepped ticket's own",
  );
  assert.ok(
    wrapUpIsolation(
      config,
      stepView(
        recordOf({
          label: "ticket-done",
          transitions: [{ ticket: id(3), from: "PWrapUpHolding", to: "Done" }],
          attempt: woAttempt(asProjectId(2), true),
        }),
      ),
    ),
  );
});

test("wrapUpIsolation rejects a failure on a valid artifact and a path that did not happen", () => {
  const failed = recordOf({
    label: "rework-started wrapup_failure",
    transitions: [{ ticket: id(3), from: "PWrapUpHolding", to: "Working" }],
    attempt: woAttempt(asProjectId(2), false),
  });
  assert.ok(
    !wrapUpIsolation(config, stepView(failed)),
    "a wrap-up can fail only via its own project's branch moving",
  );
  const wrongPath = recordOf({
    label: "ticket-done",
    transitions: [{ ticket: id(3), from: "PWrapUp", to: "Done" }],
    attempt: woAttempt(asProjectId(2), true),
  });
  assert.ok(
    !wrapUpIsolation(config, stepView(wrongPath)),
    "a moved attempt resolves out of the gate, never straight off the queue",
  );
  const quiet = recordOf({
    label: "ticket-done",
    transitions: [{ ticket: id(3), from: "PWrapUp", to: "Done" }],
    attempt: woAttempt(asProjectId(2), false),
  });
  assert.ok(wrapUpIsolation(config, stepView(quiet)));
  const fannedOut = recordOf({
    ...quiet,
    transitions: [
      { ticket: id(3), from: "PWrapUp", to: "Done" },
      { ticket: id(2), from: "Working", to: "Done" },
    ],
  });
  assert.ok(
    !wrapUpIsolation(config, stepView(fannedOut)),
    "one wrap-up attempt moves exactly one ticket",
  );
});

test("wrapUpIsolation rejects a label that resolves no wrap-up and an attribution off the universe", () => {
  const offRoster = recordOf({
    label: "rework-started eval_failure",
    transitions: [{ ticket: id(3), from: "PWrapUpHolding", to: "Working" }],
    attempt: woAttempt(asProjectId(2), true),
  });
  assert.ok(
    !wrapUpIsolation(config, stepView(offRoster)),
    "the eval side's rework resolves no wrap-up, so no step carrying an attempt may wear its label",
  );
  const outside = config.nProjects + 1;
  const offUniverse = coreOf([
    ticketOn(config, outside, { phase: "PWrapUpHolding" }),
  ]);
  const attributed = recordOf({
    label: "ticket-done",
    transitions: [{ ticket: id(1), from: "PWrapUpHolding", to: "Done" }],
    attempt: woAttempt(asProjectId(outside), true),
  });
  assert.ok(
    !wrapUpIsolation(config, {
      ...healthy,
      post: offUniverse,
      rec: attributed,
    }),
    "the stepped ticket carries that project too, so the own-project conjunct agrees and the universe is what refuses it",
  );
});

test("quietProjectLandsCleanly rejects a quiet attempt that did not land", () => {
  const reworked = recordOf({
    label: "rework-started wrapup_failure",
    transitions: [{ ticket: id(3), from: "PWrapUp", to: "Working" }],
    attempt: woAttempt(asProjectId(2), false),
  });
  assert.ok(!quietProjectLandsCleanly(config, stepView(reworked)));
  const landed = recordOf({ ...reworked, label: "ticket-done" });
  assert.ok(quietProjectLandsCleanly(config, stepView(landed)));
  assert.ok(
    quietProjectLandsCleanly(config, healthy),
    "a step resolving no attempt says nothing either way",
  );
});

test("leaseExclusive rejects two tickets holding one resource", () => {
  const contended = coreOf([
    ticketOn(config, 2, { phase: "PWrapUpHolding" }),
    ticketOn(config, 2, { phase: "PWrapUpHolding" }),
  ]);
  assert.ok(!leaseExclusive(config, stateView(contended)));
  const queued = coreOf([
    ticketOn(config, 2, { phase: "PWrapUpHolding" }),
    ticketOn(config, 2, { phase: "PWrapUp" }),
  ]);
  assert.ok(leaseExclusive(config, stateView(queued)));
  const apart = coreOf([
    ticketOn(config, 1, { phase: "PWrapUpHolding" }),
    ticketOn(config, 2, { phase: "PWrapUpHolding" }),
  ]);
  assert.ok(
    leaseExclusive(config, stateView(apart)),
    "different resources are independent by design",
  );
});

test("noLeaseWithoutAKind rejects a ticket queueing for a lease it does not need", () => {
  assert.ok(
    !noLeaseWithoutAKind(
      config,
      stateView(fleetBut(fleet, 2, { wrapUp: wNone })),
    ),
  );
  const enqueued = coreOf([
    ticketOn(config, 1, { phase: "PWrapUp", wrapUp: wNone }),
  ]);
  assert.ok(!noLeaseWithoutAKind(config, stateView(enqueued)));
  assert.ok(noLeaseWithoutAKind(config, healthy));
});

test("artifactWellFormed rejects a completed ticket that produced nothing", () => {
  assert.ok(
    !artifactWellFormed(
      config,
      stateView(fleetBut(fleet, 0, { artifact: aNone })),
    ),
  );
  const revoked = coreOf([ticketOn(config, 1, { phase: "Revoked" })]);
  assert.ok(
    artifactWellFormed(config, stateView(revoked)),
    "a revoked ticket may never have run",
  );
});

test("projectsWellFormed rejects a target outside the bounded universe", () => {
  const outside = asProjectId(config.nProjects + 1);
  assert.ok(
    !projectsWellFormed(
      config,
      stateView(fleetBut(fleet, 0, { project: outside })),
    ),
  );
  assert.ok(projectsWellFormed(config, healthy));
});

test("wrapUpWellFormed rejects the lease leaseExclusive cannot see", () => {
  const outside = config.nProjects + 1;
  const offUniverse = coreOf([
    ticketOn(config, 1, {
      phase: "PWrapUpHolding",
      wrapUp: wExclusive(outside),
    }),
    ticketOn(config, 1, {
      phase: "PWrapUpHolding",
      wrapUp: wExclusive(outside),
    }),
  ]);
  assert.ok(
    leaseExclusive(config, stateView(offUniverse)),
    "two tickets hold the resource and the depth-one claim stays green: that is the hole this closes",
  );
  assert.ok(!wrapUpWellFormed(config, stateView(offUniverse)));
  assert.ok(
    wrapUpWellFormed(
      config,
      stateView(coreOf([ticketOn(config, 1, { wrapUp: wNone })])),
    ),
    "the kind that needs no lease is authorable too",
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
          transitions: [{ ticket: id(3), from: "PWrapUpHolding", to: "Done" }],
        }),
      ),
    ),
  );
});

test("deskConsistent rejects a wall without a park, a park without a wall and a resume that does not exist", () => {
  assert.ok(
    !deskConsistent(
      config,
      stateView(fleetBut(fleet, 1, { reason: "WorkFailed" })),
    ),
    "a named wall on a ticket that is not parked",
  );
  const nameless = coreOf([ticketOn(config, 1, { phase: "Escalated" })]);
  assert.ok(
    !deskConsistent(config, stateView(nameless)),
    "a park with no wall",
  );
  const cascadeWall = {
    phase: "Escalated" as const,
    reason: "DependencyRevoked" as const,
  };
  assert.ok(
    !deskConsistent(
      config,
      stateView(
        coreOf([ticketOn(config, 1, { ...cascadeWall, resumeAt: "RPending" })]),
      ),
    ),
    "the cascade wall has no modeled resume, so it may stamp no resume point",
  );
  assert.ok(
    deskConsistent(
      config,
      stateView(coreOf([ticketOn(config, 1, cascadeWall)])),
    ),
  );
});

test("wrapUpWallNamed rejects the gate-budget wall under pricing that grants no gate account", () => {
  const parked = coreOf([
    ticketOn(deadlineOnlyInstance, 1, {
      phase: "Escalated",
      reason: "FinalizationBudgetExhausted",
      resumeAt: "ResumeFinalizing",
    }),
  ]);
  assert.ok(!wrapUpWallNamed(deadlineOnlyInstance, stateView(parked)));
  assert.ok(
    wrapUpWallNamed(config, stateView(parked)),
    "under budgeted pricing the wall exists and the vocabulary is carried",
  );
});

test("accountsBounded rejects an overdraw and a refund", () => {
  for (const overrides of [
    { gasLeft: -1 },
    { gasLeft: config.gas + 1 },
    { reworkLeft: -1 },
    { reworkLeft: reworkBudget(config.reworkPolicy) + 1 },
    { wrapUpLeft: -1 },
    { wrapUpLeft: config.wrapUpPricing.pricing === "Budgeted" ? 99 : 1 },
  ]) {
    assert.ok(
      !accountsBounded(config, stateView(fleetBut(fleet, 1, overrides))),
      `${JSON.stringify(overrides)} is outside the grant`,
    );
  }
  assert.ok(accountsBounded(config, healthy));
});

test("tasksWellFormed rejects a work set that is not the phase's anatomy", () => {
  assert.ok(
    !tasksWellFormed(
      config,
      stateView(fleetBut(fleet, 1, { tasks: [workOutstanding(1)] })),
    ),
    "the work set is one task-set phase at full width",
  );
  assert.ok(
    !tasksWellFormed(
      config,
      stateView(
        fleetBut(fleet, 1, {
          tasks: [workOutstanding(1), evalOutstanding(2, 0)],
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
          tasks: [workTask(1, "Cancelled"), workOutstanding(2)],
        }),
      ),
    ),
    "cancelled is a retirement mark, not an outcome an event can deliver live",
  );
  assert.ok(
    !tasksWellFormed(
      config,
      stateView(fleetBut(fleet, 0, { tasks: [workOutstanding(5)] })),
    ),
    "a settled ticket carries no live task state",
  );
});

test("tasksWellFormed rejects an eval stage the program is not running", () => {
  const evaluating = (tasks: readonly Task[]): Core =>
    coreOf([
      ticketOn(config, 1, {
        phase: "Evaluating",
        record: [workTask(1, "Passed"), workTask(2, "Passed")],
        tasks,
        spawned: 4,
      }),
    ]);
  assert.ok(
    tasksWellFormed(
      config,
      stateView(evaluating([evalOutstanding(3, 0), evalOutstanding(4, 0)])),
    ),
  );
  assert.ok(
    !tasksWellFormed(
      config,
      stateView(evaluating([evalOutstanding(7, 0), evalOutstanding(8, 0)])),
    ),
    "the live ids are the contiguous run directly above the retired record",
  );
  assert.ok(
    !tasksWellFormed(
      config,
      stateView(evaluating([evalOutstanding(3, 5), evalOutstanding(4, 5)])),
    ),
    "the stage index has to index into the ticket's own program",
  );
  assert.ok(
    !tasksWellFormed(config, stateView(evaluating([evalOutstanding(3, 0)]))),
    "the set is exactly the stage's declared width",
  );
  assert.ok(
    !tasksWellFormed(
      config,
      stateView(
        evaluating([evalTask(3, 0, "Cancelled"), evalOutstanding(4, 0)]),
      ),
    ),
    "cancelled is a retirement mark on the eval side too, and this branch has its own conjunct saying so",
  );
});

test("recordWellFormed rejects a log that is not the resolved history in identity order", () => {
  const holding = (record: readonly ReturnType<typeof workTask>[]): Core =>
    coreOf([
      ticketOn(config, 1, {
        phase: "PWrapUpHolding",
        record,
        spawned: record.length,
      }),
    ]);
  assert.ok(
    !recordWellFormed(
      config,
      stateView(holding([workTask(2, "Passed"), workTask(1, "Passed")])),
    ),
    "entry i carries id i plus one: the chronological log is the identity order",
  );
  assert.ok(
    !recordWellFormed(config, stateView(holding([workOutstanding(1)]))),
    "nothing retired is still outstanding",
  );
  assert.ok(
    !recordWellFormed(config, stateView(holding([evalTask(1, 5, "Passed")]))),
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
  const dropped = coreOf(fleet.slice(0, 2));
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
  const dropped = coreOf([
    ticketOn(config, 1, {
      phase: "Escalated",
      reason: "WorkFailed",
      resumeAt: "ResumeWorking",
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

test("programsWellFormed rejects a program no arrival could have carried", () => {
  const stage = { fanout: 1, combinator: "UnanimousPass" } as const;
  const overlong = Array.from({ length: config.maxStages + 1 }, () => stage);
  for (const program of [[], [{ ...stage, fanout: 0 }], overlong]) {
    assert.ok(
      !programsWellFormed(config, stateView(fleetBut(fleet, 0, { program }))),
      `${JSON.stringify(program)} is not an authorable program`,
    );
  }
  assert.ok(
    !programsWellFormed(
      config,
      stateView(
        fleetBut(fleet, 0, {
          program: [{ ...stage, fanout: config.nTasks + 1 }],
        }),
      ),
    ),
    "a stage may not fan out past the task ceiling",
  );
  assert.ok(programsWellFormed(config, healthy));
});

test("depsAcyclic rejects a dependency that points up or at nothing", () => {
  assert.ok(
    !depsAcyclic(config, stateView(fleetBut(fleet, 1, { deps: [id(3)] }))),
    "each dep points at a strictly smaller id",
  );
  assert.ok(
    !depsAcyclic(
      config,
      stateView(fleetBut(fleet, 1, { deps: [asTicketId(9)] })),
    ),
    "each dep points at a ticket the fleet holds",
  );
  assert.ok(depsAcyclic(config, healthy));
});

test("idsDense rejects a gap in the numbering and a fleet past the arrival bound", () => {
  const first = ticketAt(healthy.post, id(1));
  const sparse: Core = {
    tickets: new Map([
      [id(1), first],
      [asTicketId(3), first],
    ]),
  };
  assert.ok(!idsDense(config, stateView(sparse)), "ids are dense from one");
  const overfull = coreOf([...fleet, ticketOn(config, 1, { phase: "PDraft" })]);
  assert.ok(
    !idsDense(config, stateView(overfull)),
    "arrivals are bounded by the arrival cap",
  );
  assert.ok(idsDense(config, healthy));
});

test("stuckSubsetCovered goes red when one walk gets a base case the other lacks", () => {
  const drafted = coreOf([
    ticketOn(config, 1, { phase: "PDraft" }),
    ticketOn(config, 1, { phase: "Pending", deps: [id(1)] }),
  ]);
  assert.ok(stuckSubsetCovered(config, stateView(drafted)));
  const draftIsStuck = sweep(drafted, (core, each, stuck) => {
    const phase = ticketAt(core, each).phase;
    return (
      phase === "PDraft" ||
      (phase === "Pending" && visEdges(core, each).some((d) => stuck.has(d)))
    );
  });
  assert.ok(
    !subsetOf(draftIsStuck, coveredSet(drafted)),
    "a base case that is not a desk phase is stuck with nothing covering it",
  );
  const parked = coreOf([
    ticketOn(config, 1, {
      phase: "Escalated",
      reason: "WorkFailed",
      resumeAt: "ResumeWorking",
    }),
    ticketOn(config, 1, { phase: "Pending", deps: [id(1)] }),
  ]);
  const guardedCoverage = sweep(
    parked,
    (core, each, covered) =>
      hasOpenHumanTask(ticketAt(core, each)) ||
      (ticketAt(core, each).phase === "Working" &&
        visEdges(core, each).some((d) => covered.has(d))),
  );
  assert.ok(stuckSubsetCovered(config, stateView(parked)));
  assert.ok(
    !subsetOf(stuckSet(parked), guardedCoverage),
    "a phase guard on coverage's inductive arm leaves a stuck ticket uncovered",
  );
});

test("stuckSubsetCovered goes red when one walk gets an edge kind the other lacks", () => {
  const upstream = coreOf([
    ticketOn(config, 1, { phase: "PDraft" }),
    ticketOn(config, 1, {
      phase: "Escalated",
      reason: "WorkFailed",
      resumeAt: "ResumeWorking",
      deps: [id(1)],
    }),
  ]);
  assert.ok(stuckSubsetCovered(config, stateView(upstream)));
  const bothWays = sweep(upstream, (core, each, stuck) => {
    const dependents = liveTickets(core).filter((other) =>
      visEdges(core, other).includes(each),
    );
    return (
      ticketAt(core, each).phase === "Escalated" ||
      [...visEdges(core, each), ...dependents].some((d) => stuck.has(d))
    );
  });
  assert.ok(
    !subsetOf(bothWays, coveredSet(upstream)),
    "an edge kind added to one walk and not the other is exactly what this guards",
  );
  const wider = coreOf([
    ticketOn(config, 1, {
      phase: "Escalated",
      reason: "WorkFailed",
      resumeAt: "ResumeWorking",
    }),
    ticketOn(config, 1, { phase: "Done", deps: [id(1)], artifact: aSome(1) }),
  ]);
  assert.ok(stuckSubsetCovered(config, stateView(wider)));
  assert.ok(
    !subsetOf(coveredSet(wider), stuckSet(wider)),
    "the containment has a direction, and a check reading it the other way would go red here",
  );
});

test("cascadeSafety rejects a doomed ticket left waiting invisibly", () => {
  const unparked = coreOf([
    ticketOn(config, 1, { phase: "Revoked" }),
    ticketOn(config, 1, { phase: "Pending", deps: [id(1)] }),
  ]);
  assert.ok(!cascadeSafety(config, stateView(unparked)));
  const parked = coreOf([
    ticketOn(config, 1, { phase: "Revoked" }),
    ticketOn(config, 1, {
      phase: "Escalated",
      reason: "DependencyRevoked",
      deps: [id(1)],
    }),
  ]);
  assert.ok(cascadeSafety(config, stateView(parked)));
  const wrongWall = coreOf([
    ticketOn(config, 1, { phase: "Revoked" }),
    ticketOn(config, 1, {
      phase: "Escalated",
      reason: "WorkFailed",
      resumeAt: "ResumeWorking",
      deps: [id(1)],
    }),
  ]);
  assert.ok(
    !cascadeSafety(config, stateView(wrongWall)),
    "a doomed ticket parked behind a retryable wall is a resume the desk would offer on a ticket that can never run",
  );
  assert.ok(
    noStructuralDeadlock(config, stateView(wrongWall)),
    "the desk task is open either way, so the wall's own name is the only thing that catches this",
  );
  const transitive = coreOf([
    ticketOn(config, 1, { phase: "Revoked" }),
    ticketOn(config, 1, {
      phase: "Escalated",
      reason: "DependencyRevoked",
      deps: [id(1)],
    }),
    ticketOn(config, 1, { phase: "Pending", deps: [id(2)] }),
  ]);
  assert.ok(
    !cascadeSafety(config, stateView(transitive)),
    "the closure is transitive, so the grandchild is doomed too",
  );
});

test("the cascade the revoke performs is what makes cascadeSafety hold in every state", () => {
  const chain = coreOf([
    ticketOn(config, 1, { phase: "Pending" }),
    ticketOn(config, 1, { phase: "Pending", deps: [id(1)] }),
    ticketOn(config, 1, { phase: "PDraft", deps: [id(2)] }),
  ]);
  const revoked = decideRevoke(chain, id(1));
  assert.equal(revoked.rec.transitions.length, 3);
  assert.ok(cascadeSafety(config, stateView(revoked.post)));
  assert.ok(noStructuralDeadlock(config, stateView(revoked.post)));
});

test("noStructuralDeadlock rejects a ticket with no continuation at all", () => {
  const cyclic = coreOf([
    ticketOn(config, 1, { phase: "Pending", deps: [id(2)] }),
    ticketOn(config, 1, { phase: "Pending", deps: [id(1)] }),
  ]);
  assert.ok(!noStructuralDeadlock(config, stateView(cyclic)));
  assert.ok(
    cascadeSafety(config, stateView(cyclic)),
    "nothing is revoked, so the cascade gate has nothing to say",
  );
  assert.ok(
    stuckSubsetCovered(config, stateView(cyclic)),
    "the walks agree here as they do on every state, which is why this one is the machine-checked half",
  );
  assert.ok(
    !depsAcyclic(config, stateView(cyclic)),
    "a cycle is what arrival's construction refuses",
  );
  const behindRevoked = coreOf([
    ticketOn(config, 1, { phase: "Revoked" }),
    ticketOn(config, 1, { phase: "Pending", deps: [id(1)] }),
  ]);
  assert.ok(!noStructuralDeadlock(config, stateView(behindRevoked)));
});

test("measureNonNegative rejects an overdrawn account", () => {
  const overdrawn = coreOf([
    ticketOn(config, 1, {
      phase: "Working",
      tasks: [workOutstanding(1), workOutstanding(2)],
      spawned: 2,
      gasLeft: -1,
    }),
  ]);
  assert.ok(sysMeasure(boundsOf(config), overdrawn) < 0);
  assert.ok(!measureNonNegative(config, stateView(overdrawn)));
  assert.ok(
    !accountsBounded(config, stateView(overdrawn)),
    "it follows from the accounts and is checked directly for the descent argument's own integrity",
  );
  assert.ok(measureNonNegative(config, healthy));
});

test("stepDescends rejects a progress step that did not spend anything", () => {
  const flat: StepView = {
    pre: healthy.post,
    rec: recordOf({
      label: "dispatch",
      transitions: [{ ticket: id(2), from: "Pending", to: "Working" }],
    }),
    post: healthy.post,
  };
  assert.ok(!stepDescends(config, flat));
  const drafted = coreOf([ticketOn(config, 1, { phase: "PDraft" })]);
  const released = decideRelease(drafted, id(1));
  assert.ok(
    stepDescends(config, {
      pre: drafted,
      rec: released.rec,
      post: released.post,
    }),
    "release descends unconditionally",
  );
});

test("stepDescends exempts exactly the stutter, churn and authoring steps the model names", () => {
  const flatly = (label: string): StepView => ({
    pre: healthy.post,
    rec: recordOf({ label }),
    post: healthy.post,
  });
  for (const label of [
    "init",
    "task-done-duplicate",
    "complete-duplicate",
    "settled",
    "ticket-released",
  ]) {
    assert.ok(stepDescends(config, flatly(label)), label);
  }
  for (const label of [
    "dispatch",
    "work-passed",
    "eval-stage-passed",
    "ticket-done",
  ]) {
    assert.ok(!stepDescends(config, flatly(label)), label);
  }
});

test("stepDescends exempts the pre-work resume, which climbs under both meterings", () => {
  const parked = coreOf([
    ticketOn(config, 1, {
      phase: "Escalated",
      reason: "RsRevalidationFailed",
      resumeAt: "RPending",
    }),
  ]);
  const resumed = decideOpRetry(config, parked, id(1));
  const view: StepView = { pre: parked, rec: resumed.rec, post: resumed.post };
  assert.ok(
    sysMeasure(boundsOf(config), resumed.post) >
      sysMeasure(boundsOf(config), parked),
    "the climb is real: without the arm this step is red",
  );
  assert.ok(stepDescends(config, view));
});

test("stepDescends exempts the free pipeline resume only where retries are free", () => {
  const free = retryFreeInstance;
  const parked = coreOf([
    ticketOn(free, 1, {
      phase: "Escalated",
      reason: "GasExhausted",
      resumeAt: "ResumeFinalizing",
      gasLeft: 0,
    }),
  ]);
  const resumed = decideOpRetry(free, parked, id(1));
  const view: StepView = { pre: parked, rec: resumed.rec, post: resumed.post };
  assert.ok(
    sysMeasure(boundsOf(free), resumed.post) >
      sysMeasure(boundsOf(free), parked),
  );
  assert.ok(stepDescends(free, view));
  assert.ok(
    !stepDescends({ ...free, opRetryPricing: "RetryCharged" }, view),
    "the arm is what exempts it, and under charged retries there is no arm to reach",
  );
});

test("stepDescends exempts the desk-only flat revoke and no other", () => {
  const parked = coreOf([
    ticketOn(config, 1, {
      phase: "Escalated",
      reason: "WorkFailed",
      resumeAt: "ResumeWorking",
    }),
  ]);
  const settled = decideRevoke(parked, id(1));
  const view: StepView = { pre: parked, rec: settled.rec, post: settled.post };
  assert.equal(
    sysMeasure(boundsOf(config), settled.post),
    sysMeasure(boundsOf(config), parked),
    "settled rank to settled rank is flat, so without the arm this step is red",
  );
  assert.ok(stepDescends(config, view));
  const live = coreOf([ticketOn(config, 1, { phase: "Pending" })]);
  const dropped = decideRevoke(live, id(1));
  assert.ok(
    stepDescends(config, { pre: live, rec: dropped.rec, post: dropped.post }),
    "a live-rank revoke gets no exemption and descends on its own",
  );
});
