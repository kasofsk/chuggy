/**
 * The derived sets the invariants are stated over, and the two properties of
 * them that a reader cannot get from the answers alone: that each fixpoint is
 * a bounded sweep rather than a fold, and that every pass reads the fleet in
 * id order rather than in whatever order a map was built in.
 *
 * BOTH ARE LOAD-BEARING AND BOTH ARE INVISIBLE ON TODAY'S RELATION. The
 * dependency edges point strictly downward, so one ascending pass already
 * reaches the closure and a fold would agree with the sweep on every state
 * this machine can reach — which is exactly why the sweep is exercised below
 * against a relation pointing the other way, the case `model/domain.qnt` says
 * it keeps the shape for. Insertion order is stable in JavaScript for the same
 * reason: relying on it would pass every test until a ticket map was rebuilt
 * from a different source, so the descending-order case is what says the folds
 * sort.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { liveTickets, ticketAt } from "../../src/domain/core.ts";
import {
  coveredSet,
  revokedDependencies,
  stuckSet,
  subsetOf,
  sweep,
  visEdges,
} from "../../src/domain/derived.ts";
import type { TicketId } from "../../src/domain/ids.ts";

import { modelInstance } from "./configs.ts";
import { coreOf, depsOf, id, ticketOn } from "./fixtures.ts";
import type { Core, Ticket } from "../../src/domain/generated/modelTypes.ts";

const config = modelInstance;

/** The same fleet under descending insertion order, which is what an id-ordered fold must not inherit. */
function builtBackwards(tickets: readonly Ticket[]): Core {
  const map = new Map<TicketId, Ticket>();
  [...tickets]
    .reverse()
    .forEach((ticket, offset) => map.set(id(tickets.length - offset), ticket));
  return { tickets: map };
}

/** Ascending, so a set can be compared without either side's iteration order mattering. */
const ordered = (set: ReadonlySet<TicketId>): readonly number[] =>
  [...set].sort((a, b) => a - b);

/** A revoked ticket with a chain of dependents hanging off it, the shape the closure walks. */
const chain: readonly Ticket[] = [
  ticketOn(config, { phase: "Revoked" }),
  ticketOn(config, { phase: "Pending", deps: depsOf(1) }),
  ticketOn(config, { phase: "Pending", deps: depsOf(2) }),
];

test("a sweep repeats once per live ticket, which is the whole of the termination argument", () => {
  const fleet = coreOf([ticketOn(config), ticketOn(config), ticketOn(config)]);
  let calls = 0;
  const admitted = sweep(fleet, () => {
    calls += 1;
    return false;
  });
  assert.equal(
    calls,
    liveTickets(fleet).length * liveTickets(fleet).length,
    "one pass over the whole fleet per ticket, which is the explicit bound",
  );
  assert.equal(admitted.size, 0);
  let passes = 0;
  sweep(coreOf([]), () => {
    passes += 1;
    return true;
  });
  assert.equal(passes, 0, "an empty fleet needs no pass at all");
});

test("a sweep reaches a closure an ascending fold would not, which is why the shape is kept", () => {
  const fleet = coreOf([
    ticketOn(config, { phase: "Pending" }),
    ticketOn(config, { phase: "Pending", deps: depsOf(1) }),
    ticketOn(config, {
      phase: "Escalated",
      reason: "WorkFailed",
      resumeAt: "ResumeWorking",
      deps: depsOf(2),
    }),
  ]);
  /** An edge kind pointing upward: a ticket is admitted when one of its dependents is. */
  const upward = (
    core: Core,
    each: TicketId,
    admitted: ReadonlySet<TicketId>,
  ) =>
    ticketAt(core, each).phase === "Escalated" ||
    liveTickets(core).some(
      (other) => visEdges(core, other).includes(each) && admitted.has(other),
    );
  assert.deepEqual(ordered(sweep(fleet, upward)), [1, 2, 3]);
  const onePass = new Set<TicketId>();
  for (const each of liveTickets(fleet)) {
    if (upward(fleet, each, onePass)) onePass.add(each);
  }
  assert.deepEqual(
    ordered(onePass),
    [3],
    "the single ascending fold reaches only the base case, and the sweep is what closes it",
  );
});

test("the walk's edges are the dependency edges and only those", () => {
  const fleet = coreOf(chain);
  assert.deepEqual(visEdges(fleet, id(1)), []);
  assert.deepEqual(visEdges(fleet, id(3)), [id(2)]);
});

test("stuckness grows from the desk and coverage grows from the same edges", () => {
  const fleet = coreOf([
    ticketOn(config, {
      phase: "Escalated",
      reason: "WorkFailed",
      resumeAt: "ResumeWorking",
    }),
    ticketOn(config, { phase: "Pending", deps: depsOf(1) }),
    ticketOn(config, { phase: "Pending", deps: depsOf(2) }),
    ticketOn(config, { phase: "Working", deps: depsOf(1) }),
  ]);
  assert.deepEqual(ordered(stuckSet(fleet)), [1, 2, 3]);
  assert.deepEqual(
    ordered(coveredSet(fleet)),
    [1, 2, 3, 4],
    "coverage propagates through every phase, where stuckness needs the ticket released and waiting",
  );
  assert.ok(subsetOf(stuckSet(fleet), coveredSet(fleet)));
  const healthyBlocked = coreOf([
    ticketOn(config, { phase: "Working" }),
    ticketOn(config, { phase: "Pending", deps: depsOf(1) }),
  ]);
  assert.deepEqual(
    ordered(stuckSet(healthyBlocked)),
    [],
    "a ticket waiting on a running dep progresses vicariously",
  );
});

test("the revoked dependencies of a ticket are its own edges, in id order", () => {
  const fleet = coreOf([
    ticketOn(config, { phase: "Revoked" }),
    ticketOn(config, { phase: "Done" }),
    ticketOn(config, { phase: "Revoked" }),
    ticketOn(config, { phase: "Pending", deps: new Set([3, 1, 2]) }),
  ]);
  assert.deepEqual(revokedDependencies(fleet, id(4)), [id(1), id(3)]);
  assert.deepEqual(
    revokedDependencies(fleet, id(2)),
    [],
    "a ticket with no dependencies is blocked by none of them",
  );
  const grandchild = coreOf(chain);
  assert.deepEqual(revokedDependencies(grandchild, id(2)), [id(1)]);
  assert.deepEqual(
    revokedDependencies(grandchild, id(3)),
    [],
    "the read is over the direct edges: a transitive revoke is its own parent's answer",
  );
});

test("every sweep agrees with itself whatever order the map was built in", () => {
  const fleet: readonly Ticket[] = [
    ticketOn(config, {
      phase: "Escalated",
      reason: "WorkFailed",
      resumeAt: "ResumeWorking",
    }),
    ticketOn(config, { phase: "Pending", deps: depsOf(1) }),
    ticketOn(config, { phase: "Done", deps: depsOf(1) }),
  ];
  const ascending = coreOf(fleet);
  const descending = builtBackwards(fleet);
  for (const walk of [stuckSet, coveredSet]) {
    assert.deepEqual(ordered(walk(ascending)), ordered(walk(descending)));
  }
});
