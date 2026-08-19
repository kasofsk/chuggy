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
 * ONE OF THEM CANNOT BE MADE RED BY A STATE, and saying so is the honest
 * report rather than substituting a weaker check. `finalizerWellFormed` asks
 * that a ticket's finish kind is one a release could have drawn, and the finish
 * kinds are a closed sum: the universe it checks against is the type, so no
 * `Ticket` this tree can build carries the defect. What is checkable is that
 * the universe stays the model's own roster, which is the only edit that could
 * make the predicate fail, and that is what its case pins.
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

import { boundsOf, finalizerChoices } from "../../src/domain/config.ts";
import { liveTickets, ticketAt } from "../../src/domain/core.ts";
import {
  decideReleaseTicket,
  decideResumeTicket,
  decideRevoke,
} from "../../src/domain/deciders.ts";
import {
  coveredSet,
  stuckSet,
  subsetOf,
  sweep,
  visEdges,
} from "../../src/domain/derived.ts";
import { finalizerTags } from "../../src/domain/generated/modelTypes.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import {
  accountsBounded,
  artifactWellFormed,
  cascadeSafety,
  completionExclusive,
  depsAcyclic,
  deskConsistent,
  finalizerWallNamed,
  finalizerWellFormed,
  idsAccounted,
  measureNonNegative,
  noFinalizationWithoutAKind,
  noStructuralDeadlock,
  programsWellFormed,
  recordMonotone,
  recordWellFormed,
  revokedNeverCompletes,
  stepDescends,
  stuckSubsetCovered,
  tasksWellFormed,
  terminalsAbsorbing,
  ticketIdsWellFormed,
  type StepView,
} from "../../src/domain/invariants.ts";
import { sysMeasure } from "../../src/domain/measure.ts";
import { deadlineOnly, reworkBudget } from "../../src/domain/pricing.ts";

import { hasOpenHumanTask } from "../../src/domain/ticket.ts";
import { budgetedInstance } from "./configs.ts";
import {
  coreOf,
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

const config = budgetedInstance;
const fleet = healthyFleet(config);
const healthy = initialView(coreOf(fleet));

/** An artifact mark, as a ticket that ran carries one. */
const produced = (value: number) =>
  ({ type: "ProducedArtifact", value }) as const;

/** A view of one state, for the invariants that read only the state. */
const stateView = (post: Core): StepView => initialView(post);

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
  const spent = coreOf([
    ticketOn(config, "ManagedFinalizer", { phase: "Revoked", completions: 1 }),
  ]);
  assert.ok(!revokedNeverCompletes(config, stateView(spent)));
  const revoked = coreOf([
    ticketOn(config, "ManagedFinalizer", { phase: "Revoked" }),
  ]);
  assert.ok(
    revokedNeverCompletes(config, stateView(revoked)),
    "a revoke settles the ticket before any completion is recorded",
  );
  assert.ok(revokedNeverCompletes(config, healthy));
});

test("noFinalizationWithoutAKind rejects a ticket running a finalizer it never carried", () => {
  assert.ok(
    !noFinalizationWithoutAKind(
      config,
      stateView(fleetBut(fleet, 2, { finalizer: "NoFinalizer" })),
    ),
    "the finalizing ticket has no finish kind to run",
  );
  assert.ok(
    noFinalizationWithoutAKind(
      config,
      stateView(fleetBut(fleet, 1, { finalizer: "NoFinalizer" })),
    ),
    "a ticket with no finish kind is fine anywhere but the phase that runs one",
  );
  assert.ok(noFinalizationWithoutAKind(config, healthy));
});

test("artifactWellFormed rejects a completed ticket that produced nothing", () => {
  assert.ok(
    !artifactWellFormed(
      config,
      stateView(fleetBut(fleet, 0, { artifact: "NoArtifact" })),
    ),
  );
  const revoked = coreOf([
    ticketOn(config, "ManagedFinalizer", { phase: "Revoked" }),
  ]);
  assert.ok(
    artifactWellFormed(config, stateView(revoked)),
    "a revoked ticket may never have run",
  );
});

test("finalizerWellFormed holds against the model's own roster, which is what could still shrink", () => {
  for (const finalizer of finalizerTags) {
    assert.ok(
      finalizerWellFormed(
        config,
        stateView(coreOf([ticketOn(config, finalizer)])),
      ),
      `${finalizer} is a kind a release draws, so no state carrying it may be refused`,
    );
  }
  assert.deepEqual(
    [...finalizerChoices].sort(),
    [...finalizerTags].sort(),
    "the universe this checks against is the model's whole roster; a shorter one would refuse a released ticket",
  );
  assert.ok(finalizerWellFormed(config, healthy));
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
          transitions: [{ ticket: id(3), from: "Finalizing", to: "Done" }],
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
  const nameless = coreOf([
    ticketOn(config, "ManagedFinalizer", { phase: "Escalated" }),
  ]);
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
        coreOf([
          ticketOn(config, "ManagedFinalizer", {
            ...cascadeWall,
            resumeAt: "ResumeWorking",
          }),
        ]),
      ),
    ),
    "the cascade wall has no modeled resume, so it may stamp no resume point",
  );
  assert.ok(
    !deskConsistent(
      config,
      stateView(
        coreOf([
          ticketOn(config, "ManagedFinalizer", {
            phase: "Escalated",
            reason: "WorkFailed",
          }),
        ]),
      ),
    ),
    "every retryable wall stamps the point its resume re-enters at",
  );
  assert.ok(
    deskConsistent(
      config,
      stateView(coreOf([ticketOn(config, "ManagedFinalizer", cascadeWall)])),
    ),
  );
});

test("finalizerWallNamed rejects the finalization-budget wall on a ticket granted no such account", () => {
  const wall = {
    phase: "Escalated" as const,
    reason: "FinalizationBudgetExhausted" as const,
    resumeAt: "ResumeFinalizing" as const,
  };
  const unbudgeted = coreOf([
    ticketOn(config, "ManagedFinalizer", {
      ...wall,
      finalizationPricing: deadlineOnly,
      finalizationLeft: 0,
    }),
  ]);
  assert.ok(!finalizerWallNamed(config, stateView(unbudgeted)));
  const budgetedTicket = coreOf([ticketOn(config, "ManagedFinalizer", wall)]);
  assert.ok(
    finalizerWallNamed(config, stateView(budgetedTicket)),
    "under budgeted pricing the wall exists and the vocabulary is carried",
  );
  assert.ok(finalizerWallNamed(config, healthy));
});

test("accountsBounded rejects an overdraw and a refund", () => {
  for (const overrides of [
    { gasLeft: -1 },
    { gasLeft: config.gas + 1 },
    { reworkLeft: -1 },
    { reworkLeft: reworkBudget(config.reworkPolicy) + 1 },
    { finalizationLeft: -1 },
    { finalizationLeft: 2 },
  ]) {
    assert.ok(
      !accountsBounded(config, stateView(fleetBut(fleet, 1, overrides))),
      `${JSON.stringify(overrides)} is outside the grant`,
    );
  }
  assert.ok(accountsBounded(config, healthy));
});

test("accountsBounded reads the ticket's own grant, not the fleet's", () => {
  const poor = fleetBut(fleet, 1, {
    finalizationPricing: deadlineOnly,
    finalizationLeft: 1,
  });
  assert.ok(
    !accountsBounded(config, stateView(poor)),
    "an account the ticket's own pricing never granted is a refund",
  );
});

test("tasksWellFormed rejects a work set that is not the phase's anatomy", () => {
  assert.ok(
    !tasksWellFormed(
      config,
      stateView(fleetBut(fleet, 1, { tasks: new Set([workOutstanding(1)]) })),
    ),
    "the work set is one task-set phase at the ticket's authored width",
  );
  assert.ok(
    !tasksWellFormed(
      config,
      stateView(
        fleetBut(fleet, 1, {
          tasks: new Set([workOutstanding(1), evalOutstanding(2, 0)]),
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
          tasks: new Set([workTask(1, "Cancelled"), workOutstanding(2)]),
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
  const evaluating = (tasks: ReadonlySet<Task>): Core =>
    coreOf([
      ticketOn(config, "ManagedFinalizer", {
        phase: "Evaluating",
        record: [workTask(1, "Passed"), workTask(2, "Passed")],
        tasks,
        spawned: 4,
      }),
    ]);
  assert.ok(
    tasksWellFormed(
      config,
      stateView(
        evaluating(new Set([evalOutstanding(3, 0), evalOutstanding(4, 0)])),
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
        evaluating(new Set([evalOutstanding(3, 5), evalOutstanding(4, 5)])),
      ),
    ),
    "the stage index has to index into the ticket's own program",
  );
  assert.ok(
    !tasksWellFormed(
      config,
      stateView(evaluating(new Set([evalOutstanding(3, 0)]))),
    ),
    "the set is exactly the stage's declared width",
  );
  assert.ok(
    !tasksWellFormed(
      config,
      stateView(
        evaluating(
          new Set([evalTask(3, 0, "Cancelled"), evalOutstanding(4, 0)]),
        ),
      ),
    ),
    "cancelled is a retirement mark on the eval side too, and this branch has its own conjunct saying so",
  );
});

test("recordWellFormed rejects a log that is not the resolved history in identity order", () => {
  const finalizing = (record: readonly Task[]): Core =>
    coreOf([
      ticketOn(config, "ManagedFinalizer", {
        phase: "Finalizing",
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
    ticketOn(config, "ManagedFinalizer", {
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

test("programsWellFormed rejects a program no release could have carried", () => {
  const stage = { fanout: 1, combinator: "UnanimousPass" } as const;
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
  const cyclic = coreOf([
    ticketOn(config, "ManagedFinalizer", { phase: "Pending", deps: depsOf(2) }),
    ticketOn(config, "ManagedFinalizer", { phase: "Pending", deps: depsOf(1) }),
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
  const offUniverse: Core = {
    tickets: new Map([[asTicketId(config.nTickets * 2 + 1), first]]),
  };
  assert.ok(
    !ticketIdsWellFormed(config, stateView(offUniverse)),
    "a release draws its id from a finite universe",
  );
  const overfull = coreOf([
    ...fleet,
    ticketOn(config, "ManagedFinalizer", { phase: "Pending" }),
  ]);
  assert.ok(
    !ticketIdsWellFormed(config, stateView(overfull)),
    "releases are bounded by the fleet cap, which the id universe deliberately is not",
  );
  const sparse: Core = {
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
  const running = coreOf([
    ticketOn(config, "ManagedFinalizer", { phase: "Finalizing" }),
    ticketOn(config, "ManagedFinalizer", { phase: "Pending", deps: depsOf(1) }),
  ]);
  assert.ok(stuckSubsetCovered(config, stateView(running)));
  const finalizingIsStuck = sweep(running, (core, each, stuck) => {
    const phase = ticketAt(core, each).phase;
    return (
      phase === "Finalizing" ||
      (phase === "Pending" && visEdges(core, each).some((d) => stuck.has(d)))
    );
  });
  assert.ok(
    !subsetOf(finalizingIsStuck, coveredSet(running)),
    "a base case that is not a desk phase is stuck with nothing covering it",
  );
  const parked = coreOf([
    ticketOn(config, "ManagedFinalizer", {
      phase: "Escalated",
      reason: "WorkFailed",
      resumeAt: "ResumeWorking",
    }),
    ticketOn(config, "ManagedFinalizer", { phase: "Pending", deps: depsOf(1) }),
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
    ticketOn(config, "ManagedFinalizer", { phase: "Pending" }),
    ticketOn(config, "ManagedFinalizer", {
      phase: "Escalated",
      reason: "WorkFailed",
      resumeAt: "ResumeWorking",
      deps: depsOf(1),
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
    ticketOn(config, "ManagedFinalizer", {
      phase: "Escalated",
      reason: "WorkFailed",
      resumeAt: "ResumeWorking",
    }),
    ticketOn(config, "ManagedFinalizer", {
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

test("cascadeSafety rejects a doomed ticket left waiting invisibly", () => {
  const unparked = coreOf([
    ticketOn(config, "ManagedFinalizer", { phase: "Revoked" }),
    ticketOn(config, "ManagedFinalizer", { phase: "Pending", deps: depsOf(1) }),
  ]);
  assert.ok(!cascadeSafety(config, stateView(unparked)));
  const parked = coreOf([
    ticketOn(config, "ManagedFinalizer", { phase: "Revoked" }),
    ticketOn(config, "ManagedFinalizer", {
      phase: "Escalated",
      reason: "DependencyRevoked",
      deps: depsOf(1),
    }),
  ]);
  assert.ok(cascadeSafety(config, stateView(parked)));
  const wrongWall = coreOf([
    ticketOn(config, "ManagedFinalizer", { phase: "Revoked" }),
    ticketOn(config, "ManagedFinalizer", {
      phase: "Escalated",
      reason: "WorkFailed",
      resumeAt: "ResumeWorking",
      deps: depsOf(1),
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
    ticketOn(config, "ManagedFinalizer", { phase: "Revoked" }),
    ticketOn(config, "ManagedFinalizer", {
      phase: "Escalated",
      reason: "DependencyRevoked",
      deps: depsOf(1),
    }),
    ticketOn(config, "ManagedFinalizer", { phase: "Pending", deps: depsOf(2) }),
  ]);
  assert.ok(
    !cascadeSafety(config, stateView(transitive)),
    "the closure is transitive, so the grandchild is doomed too",
  );
});

test("the cascade the revoke performs is what makes cascadeSafety hold in every state", () => {
  const chain = coreOf([
    ticketOn(config, "ManagedFinalizer", { phase: "Pending" }),
    ticketOn(config, "ManagedFinalizer", { phase: "Pending", deps: depsOf(1) }),
    ticketOn(config, "ManagedFinalizer", { phase: "Pending", deps: depsOf(2) }),
  ]);
  const revoked = decideRevoke(config, chain, id(1));
  assert.equal(revoked.rec.transitions.length, 3);
  assert.ok(cascadeSafety(config, stateView(revoked.post)));
  assert.ok(noStructuralDeadlock(config, stateView(revoked.post)));
});

test("noStructuralDeadlock rejects a ticket with no continuation at all", () => {
  const cyclic = coreOf([
    ticketOn(config, "ManagedFinalizer", { phase: "Pending", deps: depsOf(2) }),
    ticketOn(config, "ManagedFinalizer", { phase: "Pending", deps: depsOf(1) }),
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
    "a cycle is what the release's construction refuses",
  );
  const behindRevoked = coreOf([
    ticketOn(config, "ManagedFinalizer", { phase: "Revoked" }),
    ticketOn(config, "ManagedFinalizer", { phase: "Pending", deps: depsOf(1) }),
  ]);
  assert.ok(!noStructuralDeadlock(config, stateView(behindRevoked)));
});

test("measureNonNegative rejects an overdrawn account", () => {
  const overdrawn = coreOf([
    ticketOn(config, "ManagedFinalizer", {
      phase: "Working",
      tasks: new Set([workOutstanding(1), workOutstanding(2)]),
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
});

test("stepDescends exempts exactly the stutter, churn and authoring steps the model names", () => {
  const flatly = (label: string): StepView => ({
    pre: healthy.post,
    rec: recordOf({ label }),
    post: healthy.post,
  });
  for (const label of ["init", "settled", "ticket-released"]) {
    assert.ok(stepDescends(config, flatly(label)), label);
  }
  for (const label of [
    "dispatch",
    "task-done",
    "work-passed",
    "eval-stage-passed",
    "ticket-done",
    "ticket-escalated work_failed",
  ]) {
    assert.ok(!stepDescends(config, flatly(label)), label);
  }
});

test("stepDescends exempts the release, which arrives carrying a whole ticket's measure", () => {
  const empty = coreOf([]);
  const released = decideReleaseTicket(config, empty, asTicketId(4), {
    deps: depsOf(),
    program: [{ fanout: config.nTasks, combinator: "UnanimousPass" }],
    workFanout: config.nTasks,
    reworkPolicy: config.reworkPolicy,
    finalizationPricing: config.finalizationPricing,
    resumePricing: "RetryCharged",
    finalizer: "ManagedFinalizer",
  });
  const view: StepView = {
    pre: empty,
    rec: released.rec,
    post: released.post,
  };
  assert.ok(
    sysMeasure(boundsOf(config), released.post) >
      sysMeasure(boundsOf(config), empty),
    "the climb is real: without the arm this step is red",
  );
  assert.ok(stepDescends(config, view));
});

test("stepDescends exempts the free pipeline resume only where the ticket's retries are free", () => {
  const parked = coreOf([
    ticketOn(config, "ManagedFinalizer", {
      phase: "Escalated",
      reason: "GasExhausted",
      resumeAt: "ResumeFinalizing",
      resumePricing: "RetryFree",
      gasLeft: 0,
    }),
  ]);
  const resumed = decideResumeTicket(parked, id(1));
  const view: StepView = { pre: parked, rec: resumed.rec, post: resumed.post };
  assert.ok(
    sysMeasure(boundsOf(config), resumed.post) >
      sysMeasure(boundsOf(config), parked),
    "the climb is real: without the arm this step is red",
  );
  assert.ok(stepDescends(config, view));
  const charged: StepView = {
    ...view,
    post: fleetBut([ticketAt(resumed.post, id(1))], 0, {
      resumePricing: "RetryCharged",
    }),
  };
  assert.equal(
    sysMeasure(boundsOf(config), charged.post),
    sysMeasure(boundsOf(config), view.post),
    "the pricing is not a digit, so the same climb is being judged either way",
  );
  assert.ok(
    !stepDescends(config, charged),
    "the arm is what exempts it, and under charged retries there is no arm to reach",
  );
});

test("stepDescends exempts the desk-only flat revoke and no other", () => {
  const parked = coreOf([
    ticketOn(config, "ManagedFinalizer", {
      phase: "Escalated",
      reason: "WorkFailed",
      resumeAt: "ResumeWorking",
    }),
  ]);
  const settled = decideRevoke(config, parked, id(1));
  const view: StepView = { pre: parked, rec: settled.rec, post: settled.post };
  assert.equal(
    sysMeasure(boundsOf(config), settled.post),
    sysMeasure(boundsOf(config), parked),
    "settled rank to settled rank is flat, so without the arm this step is red",
  );
  assert.ok(stepDescends(config, view));
  const live = coreOf([
    ticketOn(config, "ManagedFinalizer", { phase: "Pending" }),
  ]);
  const dropped = decideRevoke(config, live, id(1));
  assert.ok(
    stepDescends(config, { pre: live, rec: dropped.rec, post: dropped.post }),
    "a live-rank revoke gets no exemption and descends on its own",
  );
});
