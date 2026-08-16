/**
 * The inbound surfaces: that the translation is total, that it is a
 * translation, and that it has no memory.
 *
 * THE THINNESS IS THE PROPERTY UNDER TEST. A surface that filtered, remembered
 * or reordered would be a second writer deciding against a view it does not
 * have — so what these cases pin is that the same report always produces the
 * same candidate command, whatever the machine's state, and that everything
 * which looks like a decision happens strictly downstream: at `cmdEnabled`,
 * which refuses, or at a decider, which absorbs.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { actorInit, type DurableState } from "../spine/actor.ts";
import { cmdEnabled, type Cmd } from "../spine/cmd.ts";
import { commandFor, submitEvent, type ExternalEvent } from "./events.ts";
import {
  authored,
  cfgInterp,
  createRig,
  decide,
  must,
  progFlat,
  report,
  wx1,
} from "./harness.test.ts";

/** One report of every kind, so a roster can be taken over the whole type. */
const everyEvent: readonly ExternalEvent[] = [
  authored,
  { tag: "TicketReleased", ticket: 1 },
  { tag: "TicketRevoked", ticket: 1 },
  { tag: "OperatorRetried", ticket: 1 },
  { tag: "TaskEnded", ticket: 1, task: 2, verdict: "VFail" },
  { tag: "GateResolved", ticket: 1, outcome: "WFailed" },
  { tag: "LandingConfirmed", ticket: 1 },
];

test("every report translates to the command the machine names for it", () => {
  const expected: readonly Cmd[] = [
    {
      tag: "JArrive",
      deps: new Set(),
      program: progFlat,
      project: 1,
      wrapUp: wx1,
    },
    { tag: "JRelease", ticket: 1 },
    { tag: "JRevoke", ticket: 1 },
    { tag: "JOpRetry", ticket: 1 },
    { tag: "JTaskDone", ticket: 1, tid: 2, verdict: "VFail" },
    { tag: "JGateResolve", ticket: 1, out: "WFailed" },
    { tag: "JCompleteDuplicate", ticket: 1 },
  ];
  assert.deepEqual(everyEvent.map(commandFor), expected);
});

test("the roster covers every constructor the event type has", () => {
  // A constructor added to `ExternalEvent` without a fixture here would leave
  // its arm of `commandFor` untested, and the exhaustiveness check cannot see a
  // test that never called it.
  const tags = everyEvent.map((event) => event.tag);
  assert.equal(new Set(tags).size, tags.length, "a constructor appears twice");
  assert.equal(tags.length, 7, "the event vocabulary changed size");
});

test("the translation is the same whatever the machine's state, and the same twice", () => {
  // The surface holds no memory and reads no state, so a report translated
  // against an empty fleet, against a live one, and again after the machine has
  // already absorbed that very report, is one command each time. That is what
  // makes duplicates and stale reports the machine's problem rather than the
  // surface's — there is nowhere here for a filter to live.
  const onEmpty = everyEvent.map(commandFor);

  const rig = createRig();
  let s: DurableState = actorInit(cfgInterp);
  s = report(rig, s, authored, "the ticket is authored");
  s = report(rig, s, { tag: "TicketReleased", ticket: 1 }, "release it");
  s = decide(rig, s, { tag: "JDispatch", ticket: 1 }, "dispatch it");
  const ended: ExternalEvent = {
    tag: "TaskEnded",
    ticket: 1,
    task: 1,
    verdict: "VPass",
  };
  s = report(rig, s, ended, "the work task ends");
  s = report(rig, s, ended, "and ends again");
  assert.equal(s.mem.lastStep.label, "task-done-duplicate");

  assert.deepEqual(everyEvent.map(commandFor), onEmpty);
  assert.deepEqual(commandFor(ended), {
    tag: "JTaskDone",
    ticket: 1,
    tid: 1,
    verdict: "VPass",
  });
});

test("a report the state does not enable is refused, and writes no row", () => {
  const rig = createRig();
  const s: DurableState = actorInit(cfgInterp);
  // Nothing has arrived, so there is no ticket 1 to release. Enablement refuses
  // it — the journal's dedup by enablement, working on a report that is simply
  // wrong rather than merely late.
  const release: ExternalEvent = { tag: "TicketReleased", ticket: 1 };
  assert.equal(cmdEnabled(cfgInterp, s.mem.core, commandFor(release)), false);
  assert.equal(submitEvent(cfgInterp, rig.store, s, release), undefined);
  assert.equal(rig.store.length(), 0);
  assert.equal(rig.world.ledger().length, 0);
});

test("submitEvent journals exactly the command the translation names", () => {
  const rig = createRig();
  const s = must(
    submitEvent(cfgInterp, rig.store, actorInit(cfgInterp), authored),
    "the ticket is authored",
  );
  assert.equal(s.journal.length, 1);
  const first = s.journal[0];
  assert.ok(first !== undefined);
  assert.deepEqual(first.cmd, commandFor(authored));
  assert.equal(first.seq, 1);
  // Journaled, and not yet emitted: the surface hands the actor a decision, and
  // the executor is a separate step.
  assert.equal(s.applied, 0);
  assert.equal(rig.world.ledger().length, 0);
});
