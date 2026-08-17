/**
 * The follow-up agenda at each station of a ticket's cycle: every enablement
 * set maps to its own command and to nothing else, the dequeue is always drawn
 * moved, and the one dispatch on an agenda is the policy's pick.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  jArrive,
  jDequeue,
  jDispatch,
  jEvalReduce,
  jRelease,
  jTaskDone,
  jWorkReduce,
  type Cmd,
} from "../../src/actor/command.ts";
import { actorInit, journalStep, memoryCore } from "../../src/actor/state.ts";
import type { Core } from "../../src/domain/core.ts";
import { asProjectId, asTaskId } from "../../src/domain/ids.ts";
import { wExclusive } from "../../src/domain/wrapUp.ts";
import { followUpsIn } from "../../src/runtime/followUps.ts";
import { flatProgram, refinementInstance } from "../actor/harness.ts";
import { id } from "../domain/fixtures.ts";

const config = refinementInstance;

const arrival: Cmd = jArrive([], flatProgram, asProjectId(1), wExclusive(1));

/** The fleet after journaling the given decisions in order, from the empty state. */
function fleetAfter(cmds: readonly Cmd[]): Core {
  let state = actorInit();
  for (const cmd of cmds) state = journalStep(config, state, cmd);
  return memoryCore(state);
}

/** The whole cycle's decisions up to and including the labelled station. */
const stations: readonly Cmd[] = [
  arrival,
  jRelease(id(1)),
  jDispatch(id(1)),
  jTaskDone(id(1), asTaskId(1), "VPass"),
  jWorkReduce(id(1)),
  jTaskDone(id(1), asTaskId(2), "VPass"),
  jEvalReduce(id(1)),
  jDequeue(id(1), true),
];

test("a draft asks for nothing, and a released ready asks for its dispatch", () => {
  assert.deepEqual(followUpsIn(fleetAfter(stations.slice(0, 1))), []);
  assert.deepEqual(followUpsIn(fleetAfter(stations.slice(0, 2))), [
    jDispatch(id(1)),
  ]);
});

test("a resolved work set asks for its reduce, and a running one for nothing", () => {
  assert.deepEqual(followUpsIn(fleetAfter(stations.slice(0, 3))), []);
  assert.deepEqual(followUpsIn(fleetAfter(stations.slice(0, 4))), [
    jWorkReduce(id(1)),
  ]);
});

test("a resolved eval stage asks for its reduce", () => {
  assert.deepEqual(followUpsIn(fleetAfter(stations.slice(0, 5))), []);
  assert.deepEqual(followUpsIn(fleetAfter(stations.slice(0, 6))), [
    jEvalReduce(id(1)),
  ]);
});

test("an enqueued ticket with a free gate asks for its dequeue, drawn moved", () => {
  const agenda = followUpsIn(fleetAfter(stations.slice(0, 7)));
  assert.deepEqual(agenda, [jDequeue(id(1), true)]);
  const dequeue = agenda.at(0);
  assert.ok(dequeue !== undefined && dequeue.cmd === "JDequeue");
  assert.equal(dequeue.moved, true, "the dequeue must always be drawn moved");
});

test("a holding ticket asks for nothing: the gate's outcome is the environment's", () => {
  assert.deepEqual(followUpsIn(fleetAfter(stations)), []);
});

test("two readies get one dispatch, and it is the policy's pick", () => {
  const second: Cmd = jArrive([], flatProgram, asProjectId(1), wExclusive(1));
  assert.deepEqual(
    followUpsIn(
      fleetAfter([arrival, second, jRelease(id(2)), jRelease(id(1))]),
    ),
    [jDispatch(id(1))],
  );
});
