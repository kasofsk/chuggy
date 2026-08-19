/**
 * The journal machinery on hand-built histories, mirroring the model's
 * refinement unit suite: replay, legality, the tampered-journal refusals, and
 * the world-count arithmetic on concrete data.
 *
 * The three-decision history is built by the deciders themselves — arrive,
 * release, dispatch, records taken from the decisions — so it is the journal
 * an honest actor would write, and every refusal case below is that history
 * with exactly one thing forged.
 *
 * `decisionEventEnabled` AND `execDecisionEvent` GET A CASE PER ARM, from the two tables at the
 * foot. The refusal table carries a row per conjunct rather than per
 * constructor, because a row refused on a guard's first conjunct says nothing
 * about its second; the drive table takes the arms no walk in `test/actor/`
 * reaches, each answered against the domain decider called directly rather
 * than against `execDecisionEvent`'s own answer, so a mis-wired dispatch arm disagrees
 * with something.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decisionEventEnabled,
  decisionEventTags,
  execDecisionEvent,
  arriveEvent,
  completeDuplicateEvent,
  dequeueEvent,
  dispatchEvent,
  evalReduceEvent,
  gateResolveEvent,
  opRetryEvent,
  releaseEvent,
  revalFailEvent,
  revokeEvent,
  taskDoneEvent,
  workReduceEvent,
  type DecisionEvent,
} from "../../src/actor/decisionEvent.ts";
import { coreEquals } from "../../src/actor/equality.ts";
import {
  genesis,
  journalLegalOn,
  replayCore,
  type Entry,
} from "../../src/actor/journal.ts";
import {
  journalCompletionsOn,
  journalSpawnsOn,
  worldSpawnsOn,
} from "../../src/actor/world.ts";
import { ticketAt, withTicket, type Decision } from "../../src/domain/core.ts";
import {
  decideOpRetry,
  decideRevalFail,
  decideRevoke,
  decideWrapUpResolve,
} from "../../src/domain/deciders.ts";
import { asProjectId, asTaskId } from "../../src/domain/ids.ts";
import { wExclusive } from "../../src/domain/wrapUp.ts";
import { depsOf, id } from "../domain/fixtures.ts";
import { flatProgram, refinementInstance } from "./harness.ts";
import type { Core } from "../../src/domain/generated/modelTypes.ts";

const config = refinementInstance;

const event1 = arriveEvent(
  depsOf(),
  flatProgram,
  asProjectId(1),
  wExclusive(1),
);
const d1 = execDecisionEvent(config, genesis, event1);
const e1: Entry = { seq: 1, event: event1, rec: d1.rec };
const event2 = releaseEvent(id(1));
const d2 = execDecisionEvent(config, d1.post, event2);
const e2: Entry = { seq: 2, event: event2, rec: d2.rec };
const event3 = dispatchEvent(id(1));
const d3 = execDecisionEvent(config, d2.post, event3);
const e3: Entry = { seq: 3, event: event3, rec: d3.rec };
const goodJournal: readonly Entry[] = [e1, e2, e3];

test("the empty journal is legal and replays to genesis", () => {
  assert.ok(journalLegalOn(config, []));
  assert.ok(coreEquals(replayCore(config, []), genesis));
});

test("an honest history is legal, and replay reconstructs what the deciders built", () => {
  assert.ok(journalLegalOn(config, goodJournal));
  const replayed = replayCore(config, goodJournal);
  assert.ok(coreEquals(replayed, d3.post));
  assert.equal(ticketAt(replayed, id(1)).phase, "Working");
  assert.equal(ticketAt(replayed, id(1)).gasLeft, 2);
});

test("replaying one more entry equals stepping the shorter replay once", () => {
  assert.ok(
    coreEquals(
      replayCore(config, goodJournal),
      execDecisionEvent(config, replayCore(config, [e1, e2]), event3).post,
    ),
  );
  assert.ok(
    coreEquals(
      replayCore(config, [e1, e2]),
      execDecisionEvent(config, replayCore(config, [e1]), event2).post,
    ),
  );
});

test("a sequence gap or a duplicate seq is refused", () => {
  assert.ok(!journalLegalOn(config, [{ ...e1, seq: 2 }]));
  assert.ok(!journalLegalOn(config, [e1, { ...e2, seq: 3 }]));
  assert.ok(!journalLegalOn(config, [e1, { ...e2, seq: 1 }]));
});

test("a decision that was never enabled is refused, cleanly, at any tampered payload", () => {
  assert.ok(!decisionEventEnabled(config, genesis, event2));
  assert.ok(!journalLegalOn(config, [{ ...e2, seq: 1 }]));
  assert.ok(
    !decisionEventEnabled(
      config,
      genesis,
      taskDoneEvent(id(1), asTaskId(1), "Pass"),
    ),
  );
  assert.ok(!decisionEventEnabled(config, genesis, dispatchEvent(id(1))));
  assert.ok(
    !decisionEventEnabled(config, genesis, gateResolveEvent(id(1), "WOk")),
  );
  assert.ok(!decisionEventEnabled(config, genesis, opRetryEvent(id(1))));
});

test("a forged record is refused: the entry's rec must be exactly the decider's", () => {
  assert.ok(
    !journalLegalOn(config, [
      e1,
      { ...e2, rec: { ...e2.rec, label: "ticket-done" } },
    ]),
  );
  assert.ok(
    !journalLegalOn(config, [
      e1,
      { ...e2, rec: { ...e2.rec, effects: ["Complete"] } },
    ]),
  );
});

test("an out-of-universe payload is refused by draw-set membership", () => {
  const phantom = arriveEvent(
    depsOf(),
    flatProgram,
    asProjectId(1),
    wExclusive(99),
  );
  const phantomEntry: Entry = {
    seq: 1,
    event: phantom,
    rec: execDecisionEvent(config, genesis, phantom).rec,
  };
  assert.ok(!decisionEventEnabled(config, genesis, phantom));
  assert.ok(!journalLegalOn(config, [phantomEntry]));
  assert.ok(
    !decisionEventEnabled(
      config,
      genesis,
      arriveEvent(depsOf(), flatProgram, asProjectId(1), wExclusive(2)),
    ),
  );
});

test("the world arithmetic: emission closes the gap to the book, an orphan pushes past it", () => {
  assert.equal(journalSpawnsOn(goodJournal, id(1)), 1);
  assert.equal(worldSpawnsOn(goodJournal, new Set(), [], id(1)), 0);
  assert.equal(worldSpawnsOn(goodJournal, new Set([1, 2, 3]), [], id(1)), 1);
  assert.equal(
    worldSpawnsOn(goodJournal, new Set([1, 2, 3]), [d3.rec], id(1)),
    2,
  );
  assert.ok(
    worldSpawnsOn(goodJournal, new Set([1, 2, 3]), [d3.rec], id(1)) >
      journalSpawnsOn(goodJournal, id(1)),
  );
  assert.equal(journalCompletionsOn(goodJournal, id(1)), 0);
});

test("no-op decisions journal like any others and replay through", () => {
  const real = execDecisionEvent(
    config,
    d3.post,
    taskDoneEvent(id(1), asTaskId(1), "Pass"),
  );
  const duplicate = execDecisionEvent(
    config,
    real.post,
    taskDoneEvent(id(1), asTaskId(1), "Fail"),
  );
  const e4: Entry = {
    seq: 4,
    event: taskDoneEvent(id(1), asTaskId(1), "Pass"),
    rec: real.rec,
  };
  const e5: Entry = {
    seq: 5,
    event: taskDoneEvent(id(1), asTaskId(1), "Fail"),
    rec: duplicate.rec,
  };
  assert.equal(duplicate.rec.label, "task-done-duplicate");
  assert.ok(coreEquals(duplicate.post, real.post));
  assert.ok(journalLegalOn(config, [e1, e2, e3, e4, e5]));
  assert.ok(coreEquals(replayCore(config, [e1, e2, e3, e4, e5]), real.post));
});

/** The journal an honest actor writes for this run of decisions, each record taken from the decider. */
function journalOf(events: readonly DecisionEvent[]): readonly Entry[] {
  const entries: Entry[] = [];
  let core = genesis;
  for (const event of events) {
    const decision = execDecisionEvent(config, core, event);
    entries.push({ seq: entries.length + 1, event, rec: decision.rec });
    core = decision.post;
  }
  return entries;
}

/** The state that run reaches. */
function coreAfter(events: readonly DecisionEvent[]): Core {
  return events.reduce(
    (core, event) => execDecisionEvent(config, core, event).post,
    genesis,
  );
}

const toDrafted: readonly DecisionEvent[] = [event1];
const toReady: readonly DecisionEvent[] = [...toDrafted, releaseEvent(id(1))];
const toWorking: readonly DecisionEvent[] = [...toReady, dispatchEvent(id(1))];
const toEvaluating: readonly DecisionEvent[] = [
  ...toWorking,
  taskDoneEvent(id(1), asTaskId(1), "Pass"),
  workReduceEvent(id(1)),
];
const toEnqueued: readonly DecisionEvent[] = [
  ...toEvaluating,
  taskDoneEvent(id(1), asTaskId(2), "Pass"),
  evalReduceEvent(id(1)),
];
const toHolding: readonly DecisionEvent[] = [
  ...toEnqueued,
  dequeueEvent(id(1), true),
];
const toDone: readonly DecisionEvent[] = [
  ...toHolding,
  gateResolveEvent(id(1), "WOk"),
];
const toEscalated: readonly DecisionEvent[] = [
  ...toReady,
  revalFailEvent(id(1)),
];

const drafted = coreAfter(toDrafted);
const ready = coreAfter(toReady);
const working = coreAfter(toWorking);
const evaluating = coreAfter(toEvaluating);
const enqueued = coreAfter(toEnqueued);
const holding = coreAfter(toHolding);
const done = coreAfter(toDone);
const escalated = coreAfter(toEscalated);
const full = coreAfter([...toDrafted, event1]);

/**
 * A Ready ticket out of gas, which the machine cannot reach: gas is spent only
 * by entering Working and nothing returns from there to Pending. Only a forged
 * prefix state refuses on the dispatch's second conjunct, and a replayed
 * journal is exactly where an unreachable prefix can turn up.
 */
const readyNoGas = withTicket(ready, id(1), {
  ...ticketAt(ready, id(1)),
  gasLeft: 0,
});

interface Refusal {
  readonly conjunct: string;
  readonly at: Core;
  readonly event: DecisionEvent;
}

const refusals: readonly Refusal[] = [
  { conjunct: "Arrive/canArriveIn", at: full, event: event1 },
  {
    conjunct: "Arrive/dependableIn",
    at: drafted,
    event: arriveEvent(depsOf(2), flatProgram, asProjectId(1), wExclusive(1)),
  },
  {
    conjunct: "Arrive/isValidProgram",
    at: genesis,
    event: arriveEvent(
      depsOf(),
      [...flatProgram, ...flatProgram],
      asProjectId(1),
      wExclusive(1),
    ),
  },
  {
    conjunct: "Arrive/projects",
    at: genesis,
    event: arriveEvent(depsOf(), flatProgram, asProjectId(2), wExclusive(1)),
  },
  {
    conjunct: "Arrive/wrapUpChoices",
    at: genesis,
    event: arriveEvent(depsOf(), flatProgram, asProjectId(1), wExclusive(99)),
  },
  { conjunct: "Release/draftsIn", at: ready, event: releaseEvent(id(1)) },
  { conjunct: "Revoke/revocablesIn", at: done, event: revokeEvent(id(1)) },
  { conjunct: "Dispatch/readiesIn", at: drafted, event: dispatchEvent(id(1)) },
  {
    conjunct: "Dispatch/dispatchableIn",
    at: readyNoGas,
    event: dispatchEvent(id(1)),
  },
  {
    conjunct: "TaskDone/taskPhaseIn",
    at: ready,
    event: taskDoneEvent(id(1), asTaskId(1), "Pass"),
  },
  {
    conjunct: "TaskDone/deliverableTaskIds",
    at: working,
    event: taskDoneEvent(id(1), asTaskId(9), "Pass"),
  },
  {
    conjunct: "WorkReduce/reducibleWorkIn",
    at: working,
    event: workReduceEvent(id(1)),
  },
  {
    conjunct: "EvalReduce/reducibleEvalIn",
    at: evaluating,
    event: evalReduceEvent(id(1)),
  },
  {
    conjunct: "Dequeue/wrapUpStartablesIn",
    at: holding,
    event: dequeueEvent(id(1), true),
  },
  {
    conjunct: "GateResolve/holdingIn",
    at: enqueued,
    event: gateResolveEvent(id(1), "WOk"),
  },
  {
    conjunct: "CompleteDuplicate/doneIn",
    at: ready,
    event: completeDuplicateEvent(id(1)),
  },
  { conjunct: "RevalFail/readiesIn", at: done, event: revalFailEvent(id(1)) },
  { conjunct: "OpRetry/retryablesIn", at: ready, event: opRetryEvent(id(1)) },
];

/**
 * `GateResolve`'s outcome membership has no row: `WrapUpOutcome` holds only
 * the two the model draws, so nothing outside the set can be constructed and
 * the `WFailed` drive below is what stands behind that conjunct. The arrival
 * repeating a dep has no row and no conjunct either — the payload is the model's
 * set — so that refusal lives in `test/interpreter/wire.test.ts`, on the array a
 * stored journal carries.
 */
test("every conjunct of every enablement refuses on a state that fails it alone", () => {
  for (const { conjunct, at, event } of refusals) {
    assert.ok(
      !decisionEventEnabled(config, at, event),
      `${conjunct}: enabled anyway`,
    );
  }
});

/** The arm's positive half, which a table of refusals cannot carry. */
test("an arrival naming a dependable dep is enabled", () => {
  assert.ok(
    decisionEventEnabled(
      config,
      drafted,
      arriveEvent(depsOf(1), flatProgram, asProjectId(1), wExclusive(1)),
    ),
  );
});

test("the refusal table names every constructor the model declares", () => {
  assert.deepEqual(
    [...new Set(refusals.map((row) => row.event.event))].sort(),
    [...decisionEventTags].sort(),
  );
});

/** `decided` is the domain decider called directly, so a mis-wired dispatch arm has somewhere to disagree. */
interface Drive {
  readonly arm: string;
  readonly before: readonly DecisionEvent[];
  readonly event: DecisionEvent;
  readonly at: Core;
  readonly decided: Decision;
}

const drives: readonly Drive[] = [
  {
    arm: "Revoke",
    before: toReady,
    event: revokeEvent(id(1)),
    at: ready,
    decided: decideRevoke(ready, id(1)),
  },
  {
    arm: "RevalFail",
    before: toReady,
    event: revalFailEvent(id(1)),
    at: ready,
    decided: decideRevalFail(ready, id(1)),
  },
  {
    arm: "GateResolve/WOk",
    before: toHolding,
    event: gateResolveEvent(id(1), "WOk"),
    at: holding,
    decided: decideWrapUpResolve(config, holding, id(1), "WOk", true),
  },
  {
    arm: "GateResolve/WFailed",
    before: toHolding,
    event: gateResolveEvent(id(1), "WFailed"),
    at: holding,
    decided: decideWrapUpResolve(config, holding, id(1), "WFailed", true),
  },
  {
    arm: "OpRetry",
    before: toEscalated,
    event: opRetryEvent(id(1)),
    at: escalated,
    decided: decideOpRetry(config, escalated, id(1)),
  },
];

test("each otherwise-undriven arm journals legally and decides what the domain decides", () => {
  for (const { arm, before, event, at, decided } of drives) {
    assert.ok(
      decisionEventEnabled(config, at, event),
      `${arm}: refused at its own state`,
    );
    const taken = execDecisionEvent(config, at, event);
    assert.deepEqual(taken.rec, decided.rec, `${arm}: a different record`);
    assert.deepEqual(
      taken.post,
      decided.post,
      `${arm}: a different post-state`,
    );
    const journal = journalOf([...before, event]);
    assert.equal(journal.length, before.length + 1);
    assert.ok(
      journalLegalOn(config, journal),
      `${arm}: the journal is illegal`,
    );
    assert.ok(
      coreEquals(replayCore(config, journal), decided.post),
      `${arm}: replay does not reach the decided state`,
    );
  }
});
