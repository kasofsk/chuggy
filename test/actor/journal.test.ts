/**
 * The journal machinery on hand-built histories, mirroring the model's
 * refinement unit suite: replay, legality, the tampered-journal refusals, and
 * the world-count arithmetic on concrete data.
 *
 * The history is built by the deciders themselves — release, dispatch, records
 * taken from the decisions — so it is the journal an honest actor would write,
 * and every refusal case below is that history with exactly one thing forged.
 *
 * `decisionEventEnabled` AND `execDecisionEvent` GET A CASE PER ARM, from the
 * two tables at the foot. The refusal table carries a row per conjunct rather
 * than per constructor, because a row refused on a guard's first conjunct says
 * nothing about its second; the drive table takes the arms no walk in
 * `test/actor/` reaches, each answered against the domain decider called
 * directly rather than against `execDecisionEvent`'s own answer, so a mis-wired
 * dispatch arm disagrees with something.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decisionEventEnabled,
  decisionEventTags,
  dispatchEvent,
  evalReduceEvent,
  execDecisionEvent,
  executionBlockedEvent,
  finalizationResultEvent,
  releaseTicketEvent,
  resumeTicketEvent,
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
  decideExecutionBlocked,
  decideFinalizationResult,
  decideResumeTicket,
  decideRevoke,
} from "../../src/domain/deciders.ts";
import { asTaskId, asTicketId } from "../../src/domain/ids.ts";
import { budgeted, reworkBudgetOf } from "../../src/domain/pricing.ts";
import { id } from "../domain/fixtures.ts";
import {
  flatProgram,
  plainAuthoring,
  plainResult,
  refinementInstance,
} from "./harness.ts";
import type { Core } from "../../src/domain/generated/modelTypes.ts";

const config = refinementInstance;

const event1 = releaseTicketEvent(id(1), plainAuthoring);
const d1 = execDecisionEvent(config, genesis, event1);
const e1: Entry = { seq: 1, event: event1, rec: d1.rec };
const event2 = dispatchEvent(id(1));
const d2 = execDecisionEvent(config, d1.post, event2);
const e2: Entry = { seq: 2, event: event2, rec: d2.rec };
const goodJournal: readonly Entry[] = [e1, e2];

test("the empty journal is legal and replays to genesis", () => {
  assert.ok(journalLegalOn(config, []));
  assert.ok(coreEquals(replayCore(config, []), genesis));
});

test("an honest history is legal, and replay reconstructs what the deciders built", () => {
  assert.ok(journalLegalOn(config, goodJournal));
  const replayed = replayCore(config, goodJournal);
  assert.ok(coreEquals(replayed, d2.post));
  assert.deepEqual([...replayed.tickets.keys()], [1]);
  assert.equal(ticketAt(replayed, id(1)).phase, "Working");
  assert.equal(ticketAt(replayed, id(1)).gasLeft, 2);
});

test("replaying one more entry equals stepping the shorter replay once", () => {
  assert.ok(
    coreEquals(
      replayCore(config, goodJournal),
      execDecisionEvent(config, replayCore(config, [e1]), event2).post,
    ),
  );
  assert.ok(coreEquals(replayCore(config, [e1]), d1.post));
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
      taskDoneEvent(id(1), asTaskId(1), "Pass", plainResult),
    ),
  );
  assert.ok(
    !decisionEventEnabled(
      config,
      genesis,
      executionBlockedEvent(id(1), "TicketConfigIncompatible"),
    ),
  );
  assert.ok(
    !decisionEventEnabled(
      config,
      genesis,
      finalizationResultEvent(id(1), "FinalizationSucceeded"),
    ),
  );
  assert.ok(!decisionEventEnabled(config, genesis, resumeTicketEvent(id(1))));
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
      { ...e2, rec: { ...e2.rec, effects: ["RunFinalizer"] } },
    ]),
  );
});

test("an out-of-universe payload is refused by draw-set membership", () => {
  const phantom = releaseTicketEvent(asTicketId(99), plainAuthoring);
  const phantomEntry: Entry = {
    seq: 1,
    event: phantom,
    rec: execDecisionEvent(config, genesis, phantom).rec,
  };
  assert.ok(!decisionEventEnabled(config, genesis, phantom));
  assert.ok(!journalLegalOn(config, [phantomEntry]));
});

test("the world arithmetic: emission closes the gap to the book, an orphan pushes past it", () => {
  assert.equal(journalSpawnsOn(goodJournal, id(1)), 1);
  assert.equal(worldSpawnsOn(goodJournal, new Set(), [], id(1)), 0);
  assert.equal(worldSpawnsOn(goodJournal, new Set([1, 2]), [], id(1)), 1);
  assert.equal(worldSpawnsOn(goodJournal, new Set([1, 2]), [d2.rec], id(1)), 2);
  assert.ok(
    worldSpawnsOn(goodJournal, new Set([1, 2]), [d2.rec], id(1)) >
      journalSpawnsOn(goodJournal, id(1)),
  );
  assert.equal(journalCompletionsOn(goodJournal, id(1)), 0);
});

test("the task result reference is journal data: it names no part of the decision", () => {
  const real = taskDoneEvent(id(1), asTaskId(1), "Pass", plainResult);
  const other = taskDoneEvent(id(1), asTaskId(1), "Pass", {
    manifest: 2,
    digest: 2,
    schema: 1,
  });
  assert.notDeepEqual(real, other);
  const taken = execDecisionEvent(config, d2.post, real);
  assert.deepEqual(taken.rec, execDecisionEvent(config, d2.post, other).rec);
  assert.ok(
    coreEquals(taken.post, execDecisionEvent(config, d2.post, other).post),
  );
  assert.equal(taken.rec.label, "task-done");
});

test("a task already resolved is no longer outstanding, so a second report never journals", () => {
  const first = taskDoneEvent(id(1), asTaskId(1), "Pass", plainResult);
  assert.ok(decisionEventEnabled(config, d2.post, first));
  const resolved = execDecisionEvent(config, d2.post, first).post;
  assert.ok(
    !decisionEventEnabled(
      config,
      resolved,
      taskDoneEvent(id(1), asTaskId(1), "Fail", plainResult),
    ),
  );
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

const toPending: readonly DecisionEvent[] = [event1];
const toWorking: readonly DecisionEvent[] = [...toPending, event2];
const toEvaluating: readonly DecisionEvent[] = [
  ...toWorking,
  taskDoneEvent(id(1), asTaskId(1), "Pass", plainResult),
  workReduceEvent(id(1)),
];
const toFinalizing: readonly DecisionEvent[] = [
  ...toEvaluating,
  taskDoneEvent(id(1), asTaskId(2), "Pass", plainResult),
  evalReduceEvent(id(1)),
];
const toDone: readonly DecisionEvent[] = [
  ...toFinalizing,
  finalizationResultEvent(id(1), "FinalizationSucceeded"),
];
const toEscalated: readonly DecisionEvent[] = [
  ...toWorking,
  executionBlockedEvent(id(1), "TicketConfigIncompatible"),
];
const toDependent: readonly DecisionEvent[] = [
  ...toPending,
  releaseTicketEvent(id(2), { ...plainAuthoring, deps: new Set([1]) }),
];

const pending = coreAfter(toPending);
const working = coreAfter(toWorking);
const evaluating = coreAfter(toEvaluating);
const finalizing = coreAfter(toFinalizing);
const done = coreAfter(toDone);
const escalated = coreAfter(toEscalated);
const dependent = coreAfter(toDependent);
const full = coreAfter([
  ...toPending,
  releaseTicketEvent(id(2), plainAuthoring),
]);

/**
 * A Ready ticket out of gas, which the machine cannot reach: gas is spent only
 * by entering Working and nothing returns from there to Pending. Only a forged
 * prefix state refuses on the dispatch's second conjunct, and a replayed
 * journal is exactly where an unreachable prefix can turn up.
 */
const readyNoGas = withTicket(pending, id(1), {
  ...ticketAt(pending, id(1)),
  gasLeft: 0,
});

interface Refusal {
  readonly conjunct: string;
  readonly at: Core;
  readonly event: DecisionEvent;
}

const refusals: readonly Refusal[] = [
  {
    conjunct: "ReleaseTicket/canReleaseIn",
    at: full,
    event: releaseTicketEvent(id(3), plainAuthoring),
  },
  {
    conjunct: "ReleaseTicket/dependableIn",
    at: pending,
    event: releaseTicketEvent(id(2), {
      ...plainAuthoring,
      deps: new Set([2]),
    }),
  },
  {
    conjunct: "ReleaseTicket/isValidProgram",
    at: genesis,
    event: releaseTicketEvent(id(1), {
      ...plainAuthoring,
      prog: [...flatProgram, ...flatProgram],
    }),
  },
  {
    conjunct: "ReleaseTicket/workFanoutChoices",
    at: genesis,
    event: releaseTicketEvent(id(1), { ...plainAuthoring, workFanout: 2 }),
  },
  {
    conjunct: "ReleaseTicket/reworkPolicyChoices",
    at: genesis,
    event: releaseTicketEvent(id(1), {
      ...plainAuthoring,
      reworkPolicy: reworkBudgetOf(2),
    }),
  },
  {
    conjunct: "ReleaseTicket/finalizationPricingChoices",
    at: genesis,
    event: releaseTicketEvent(id(1), {
      ...plainAuthoring,
      finalizationPricing: budgeted(2),
    }),
  },
  { conjunct: "Revoke/revocablesIn", at: done, event: revokeEvent(id(1)) },
  { conjunct: "Dispatch/readiesIn", at: working, event: dispatchEvent(id(1)) },
  {
    conjunct: "Dispatch/dispatchableIn",
    at: readyNoGas,
    event: dispatchEvent(id(1)),
  },
  {
    conjunct: "TaskDone/taskPhaseIn",
    at: pending,
    event: taskDoneEvent(id(1), asTaskId(1), "Pass", plainResult),
  },
  {
    conjunct: "TaskDone/manifest",
    at: working,
    event: taskDoneEvent(id(1), asTaskId(1), "Pass", {
      ...plainResult,
      manifest: 0,
    }),
  },
  {
    conjunct: "TaskDone/digest",
    at: working,
    event: taskDoneEvent(id(1), asTaskId(1), "Pass", {
      ...plainResult,
      digest: 0,
    }),
  },
  {
    conjunct: "TaskDone/schema",
    at: working,
    event: taskDoneEvent(id(1), asTaskId(1), "Pass", {
      ...plainResult,
      schema: 0,
    }),
  },
  {
    conjunct: "TaskDone/outstandingTaskIn",
    at: working,
    event: taskDoneEvent(id(1), asTaskId(9), "Pass", plainResult),
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
    conjunct: "FinalizationResult/finalizableIn",
    at: working,
    event: finalizationResultEvent(id(1), "FinalizationSucceeded"),
  },
  {
    conjunct: "AbandonHandoff/HandoffBlocked",
    at: pending,
    event: { type: "AbandonHandoff", value: id(1) },
  },
  {
    conjunct: "ExecutionBlocked/taskPhaseIn",
    at: pending,
    event: executionBlockedEvent(id(1), "TicketConfigIncompatible"),
  },
  {
    conjunct: "ExecutionBlocked/executionBlockedReasons",
    at: working,
    event: executionBlockedEvent(id(1), "WorkFailed"),
  },
  {
    conjunct: "ResumeTicket/retryablesIn",
    at: pending,
    event: resumeTicketEvent(id(1)),
  },
];

/**
 * Three conjuncts have no row, because nothing outside their draw set can be
 * constructed: a release's `resumePricing` and `finalizer` and a finalization
 * result's outcome are each a closed type whose every value the configuration
 * offers. The release repeating a dep has no row and no conjunct either — the
 * payload is the model's set — so that refusal lives in
 * `test/interpreter/wire.test.ts`, on the array a stored journal carries.
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
test("a release naming a dependable dep is enabled", () => {
  assert.ok(
    decisionEventEnabled(
      config,
      pending,
      releaseTicketEvent(id(2), { ...plainAuthoring, deps: new Set([1]) }),
    ),
  );
});

test("the refusal table names every constructor the model declares", () => {
  assert.deepEqual(
    [...new Set(refusals.map((row) => row.event.type))].sort(),
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
    before: toPending,
    event: revokeEvent(id(1)),
    at: pending,
    decided: decideRevoke(config, pending, id(1)),
  },
  {
    arm: "Revoke/cascade",
    before: toDependent,
    event: revokeEvent(id(1)),
    at: dependent,
    decided: decideRevoke(config, dependent, id(1)),
  },
  {
    arm: "ExecutionBlocked",
    before: toWorking,
    event: executionBlockedEvent(id(1), "TicketConfigIncompatible"),
    at: working,
    decided: decideExecutionBlocked(working, id(1), "TicketConfigIncompatible"),
  },
  {
    arm: "ResumeTicket",
    before: toEscalated,
    event: resumeTicketEvent(id(1)),
    at: escalated,
    decided: decideResumeTicket(escalated, id(1)),
  },
  {
    arm: "FinalizationResult/FinalizationFailed",
    before: toFinalizing,
    event: finalizationResultEvent(id(1), "FinalizationFailed"),
    at: finalizing,
    decided: decideFinalizationResult(finalizing, id(1), "FinalizationFailed"),
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
    assert.ok(
      coreEquals(taken.post, decided.post),
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
