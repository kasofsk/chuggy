/**
 * The enablement predicates, which the golden replay does not reach and cannot.
 *
 * A replayer routes on the action the trace recorded and hands the decider its
 * picks; it never asks whether the action was enabled, because the golden's
 * existence is that guarantee. So every one of these predicates is unexercised
 * by the corpus, and the mutant they exist to catch — a guard that drifted from
 * the one the machine consults — is invisible to it. This suite is the whole of
 * their evidence.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  canReleaseIn,
  dependableIn,
  depArtifacts,
  depsDoneIn,
  doneIn,
  finalizableIn,
  finalizationOutcomes,
  finalizingIn,
  isBlockedIn,
  isReadyIn,
  outstandingTaskIdsIn,
  outstandingTaskIn,
  quietIn,
  readiesIn,
  releasableAuthoring,
  releasableIdsIn,
  reducibleEvalIn,
  reducibleWorkIn,
  retryableIn,
  retryablesIn,
  revocableIn,
  revocablesIn,
  taskPhaseIn,
  waitsOn,
} from "../../src/domain/enablement.ts";
import { defaultProgram } from "../../src/domain/config.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import type {
  TicketGraph,
  Ticket,
} from "../../src/domain/generated/modelTypes.ts";
import { modelInstance } from "./configs.ts";
import {
  graphOf,
  depsOf,
  evalOutstanding,
  evalTask,
  id,
  ticketOn,
  workOutstanding,
  workTask,
} from "./fixtures.ts";

const config = modelInstance;

/** An artifact mark, as a ticket that ran carries one. */
const produced = (value: number) =>
  ({ type: "ProducedArtifact", value }) as const;

/** A fleet under the sparse ids a release actually draws, which dense fixtures never build. */
function sparseGraph(entries: readonly [number, Ticket][]): TicketGraph {
  return { tickets: new Map(entries.map(([at, t]) => [id(at), t])) };
}

test("room for one more release runs out exactly at the fleet bound", () => {
  const fleet = Array.from({ length: config.nTickets }, () => ticketOn(config));
  assert.ok(canReleaseIn(config, graphOf([]), id(1)));
  assert.ok(canReleaseIn(config, graphOf(fleet.slice(0, -1)), id(3)));
  assert.ok(!canReleaseIn(config, graphOf(fleet), id(4)));
});

test("an id is claimable once: not outside the universe, and never again after", () => {
  const held = sparseGraph([
    [2, ticketOn(config)],
    [5, ticketOn(config, { phase: "Done" })],
  ]);
  assert.ok(canReleaseIn(config, held, id(4)));
  assert.ok(
    !canReleaseIn(config, held, asTicketId(config.nTickets * 2 + 1)),
    "the universe is finite, and a release draws from it",
  );
  assert.ok(!canReleaseIn(config, held, id(2)));
  assert.ok(
    !canReleaseIn(config, held, id(5)),
    "an id is never reused, so a settled ticket still holds its own",
  );
  assert.deepEqual(releasableIdsIn(config, held), [1, 3, 4, 6].map(id));
  assert.deepEqual(
    releasableIdsIn(
      config,
      graphOf([ticketOn(config), ticketOn(config), ticketOn(config)]),
    ),
    [],
    "a fleet at its bound offers nothing, whatever the universe still holds",
  );
});

test("a release may depend on anything but a tombstone", () => {
  const graph = graphOf([
    ticketOn(config, { phase: "Pending" }),
    ticketOn(config, { phase: "Revoked" }),
    ticketOn(config, {
      phase: "Escalated",
      escalation: "WorkFailureEscalated",
    }),
  ]);
  assert.deepEqual(dependableIn(graph), [id(1), id(3)]);
});

test("the absorbing terminals and the point of no return are the unrevocable phases", () => {
  const graph = graphOf([
    ticketOn(config, { phase: "Pending" }),
    ticketOn(config, {
      phase: "Escalated",
      escalation: "WorkFailureEscalated",
    }),
    ticketOn(config, { phase: "Work" }),
    ticketOn(config, { phase: "Done" }),
    ticketOn(config, { phase: "Revoked" }),
    ticketOn(config, { phase: "Finalization" }),
  ]);
  assert.deepEqual(revocablesIn(graph), [id(1), id(2), id(3)]);
  assert.ok(!revocableIn(graph, id(4)));
  assert.ok(!revocableIn(graph, id(5)));
  assert.ok(
    !revocableIn(graph, id(6)),
    "the finalizer is running, and nothing recalls it",
  );
});

test("a dependency that is not Done blocks, whatever else it is doing", () => {
  const blocked = graphOf([
    ticketOn(config, { phase: "Work" }),
    ticketOn(config, { phase: "Pending", deps: depsOf(1) }),
  ]);
  assert.ok(isBlockedIn(blocked, id(2)));
  assert.ok(!isReadyIn(blocked, id(2)));
  assert.deepEqual(readiesIn(blocked), []);

  const landed = graphOf([
    ticketOn(config, {
      phase: "Done",
      artifact: produced(2),
    }),
    ticketOn(config, { phase: "Pending", deps: depsOf(1) }),
  ]);
  assert.ok(isReadyIn(landed, id(2)));
  assert.ok(!isBlockedIn(landed, id(2)));
  assert.ok(depsDoneIn(landed, id(2)));
  assert.deepEqual(readiesIn(landed), [id(2)]);
});

test("what a ticket waits on is what its dependencies produced, read in id order", () => {
  const graph = sparseGraph([
    [
      1,
      ticketOn(config, {
        phase: "Done",
        artifact: produced(2),
      }),
    ],
    [
      4,
      ticketOn(config, {
        phase: "Done",
        artifact: produced(5),
      }),
    ],
    [
      6,
      ticketOn(config, {
        phase: "Pending",
        deps: depsOf(4, 1),
      }),
    ],
  ]);
  assert.deepEqual(
    [...waitsOn(graph, id(6))].sort((a, b) => a - b),
    [1, 4],
  );
  assert.deepEqual(
    depArtifacts(graph, id(6)),
    [produced(2), produced(5)],
    "the read is ordered by dependency id, so it does not inherit a set's iteration order",
  );
});

test("only the two task phases can receive a completion, and only a resolved set reduces", () => {
  const graph = graphOf([
    ticketOn(config, {
      phase: "Work",
      tasks: new Set([workOutstanding(1), workTask(2, "Passed")]),
      spawned: 2,
    }),
    ticketOn(config, {
      phase: "Evaluation",
      tasks: new Set([evalTask(1, 0, "Failed")]),
      spawned: 1,
    }),
    ticketOn(config, { phase: "Finalization" }),
    ticketOn(config, {
      phase: "Work",
      tasks: new Set([workTask(1, "Passed")]),
      spawned: 1,
    }),
    ticketOn(config, {
      phase: "Evaluation",
      tasks: new Set([evalOutstanding(1, 0)]),
      spawned: 1,
    }),
  ]);
  assert.deepEqual(taskPhaseIn(graph), [id(1), id(2), id(4), id(5)]);
  assert.deepEqual(reducibleWorkIn(graph), [id(4)]);
  assert.deepEqual(reducibleEvalIn(graph), [id(2)]);
});

test("the phase holding the finalizer obligation is the only one a result resolves from", () => {
  const graph = graphOf([
    ticketOn(config, { phase: "Finalization" }),
    ticketOn(config, { phase: "Evaluation" }),
    ticketOn(config, {
      phase: "Done",
      artifact: produced(2),
      completions: 1,
    }),
  ]);
  assert.deepEqual(finalizingIn(graph), [id(1)]);
  assert.ok(finalizableIn(graph, id(1)));
  assert.ok(!finalizableIn(graph, id(2)));
  assert.ok(
    !finalizableIn(graph, asTicketId(9)),
    "a result for a ticket the fleet never held is refused rather than looked up",
  );
  assert.deepEqual(doneIn(graph), [id(3)]);
});

test("the fabric may still report on exactly the tasks a ticket has outstanding", () => {
  const graph = graphOf([
    ticketOn(config, {
      phase: "Evaluation",
      record: [workTask(1, "Passed"), workTask(2, "Passed")],
      tasks: new Set([evalOutstanding(4, 0), evalTask(3, 0, "Passed")]),
      spawned: 4,
    }),
    ticketOn(config, { phase: "Pending" }),
  ]);
  assert.deepEqual(outstandingTaskIdsIn(graph, id(1)), [4]);
  assert.ok(outstandingTaskIn(graph, id(1), 4));
  assert.ok(
    !outstandingTaskIn(graph, id(1), 3),
    "a duplicate for a resolved task matches nothing outstanding",
  );
  assert.ok(
    !outstandingTaskIn(graph, id(1), 1),
    "a stale delivery names an id already retired into the record",
  );
  assert.deepEqual(outstandingTaskIdsIn(graph, id(2)), []);
});

test("a park is retryable, and only a park is", () => {
  const parked = graphOf([
    ticketOn(config, {
      phase: "Escalated",
      escalation: "WorkExecutionUnavailableEscalated",
    }),
    ticketOn(config, {
      phase: "Escalated",
      escalation: "EvaluationBlockedEscalated",
    }),
    ticketOn(config, { phase: "Work" }),
  ]);
  assert.ok(retryableIn(parked, id(1)));
  assert.ok(retryableIn(parked, id(2)));
  assert.ok(
    !retryableIn(parked, id(3)),
    "a ticket that is not parked has nothing to resume from",
  );
  assert.deepEqual(retryablesIn(parked), [id(1), id(2)]);
});

test("the finalizer reports every lifecycle result", () => {
  assert.deepEqual(finalizationOutcomes, [
    "FinalizationSucceeded",
    "FinalizationNeedsWork",
    "FinalizationResultUnavailable",
  ]);
});

test("a release draws every authored value from a universe, and is refused outside one", () => {
  const authoring = { prog: defaultProgram(config) };
  assert.ok(releasableAuthoring(config, authoring));
  assert.ok(!releasableAuthoring(config, { prog: [] }));
  assert.ok(
    !releasableAuthoring(config, {
      prog: [{ fanout: config.nTasks + 1 }],
    }),
    "a stage may not fan out past the task ceiling",
  );
});

test("the stutter is enabled exactly on a fully-released fleet of terminals", () => {
  const settled = [
    ticketOn(config, {
      phase: "Done",
      artifact: produced(2),
      completions: 1,
    }),
    ticketOn(config, { phase: "Revoked" }),
    ticketOn(config, {
      phase: "Done",
      artifact: produced(2),
      completions: 1,
    }),
  ];
  assert.ok(quietIn(config, graphOf(settled)));
  assert.ok(
    !quietIn(config, graphOf(settled.slice(0, -1))),
    "room for a release means the author can still act",
  );
  assert.ok(
    !quietIn(
      config,
      graphOf([...settled.slice(0, -1), ticketOn(config, { phase: "Work" })]),
    ),
    "a live ticket means some other action is enabled",
  );
  assert.ok(
    !quietIn(
      config,
      graphOf([
        ...settled.slice(0, -1),
        ticketOn(config, {
          phase: "Escalated",
          escalation: "WorkFailureEscalated",
        }),
      ]),
    ),
    "a parked ticket is still revocable, so the desk can act",
  );
});
