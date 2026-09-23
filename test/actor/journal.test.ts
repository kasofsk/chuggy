/**
 * The journal machinery on hand-built histories, mirroring the model's
 * refinement unit suite: replay as a fold of `evolve`, legality, the
 * tampered-journal refusals, and the world-count arithmetic on concrete data.
 *
 * The history is built by the deciders themselves — release, dispatch, each
 * row the event the decision took — so it is the journal an honest actor would
 * write, and every refusal case below is that history with exactly one thing
 * forged.
 *
 * `decisionEventEnabled` AND `decide` GET A CASE PER ARM, from the two tables
 * at the foot. The refusal table carries a row per conjunct rather than per
 * constructor, because a row refused on a guard's first conjunct says nothing
 * about its second; the drive table takes the arms no walk in `test/actor/`
 * reaches, each answered against the domain decider called directly rather
 * than against `decide`'s own answer, so a mis-wired dispatch arm disagrees
 * with something.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decide,
  decisionEventEnabled,
  decisionEventTags,
  dispatchEvent,
  finalizationResultEvent,
  releaseTicketEvent,
  resumeTicketEvent,
  revokeEvent,
  taskDoneEvent,
  type DecisionEvent,
} from "../../src/actor/decisionEvent.ts";
import { graphEquals } from "../../src/domain/equality.ts";
import { evolve } from "../../src/domain/evolve.ts";
import {
  genesis,
  journalLegalOn,
  replayGraph,
  type Entry,
} from "../../src/actor/journal.ts";
import {
  journalCompletionsOn,
  journalSpawnsOn,
  worldSpawnsOn,
} from "../../src/actor/world.ts";
import { ticketAt } from "../../src/domain/ticketGraph.ts";
import {
  decideFinalizationResult,
  decideResumeTicket,
  decideRevoke,
  decideTaskDone,
} from "../../src/domain/deciders.ts";
import {
  aDispatchSource,
  aFinalizationEvidence,
  anAcceptedSource,
} from "../../src/domain/config.ts";
import { artifactOf } from "../../src/domain/ticket.ts";
import { evaluationTaskOf, workTaskOf } from "../../src/domain/task.ts";
import {
  id,
  judgedReport,
  producedReport,
  resultFor,
  stoppedReport,
} from "../domain/fixtures.ts";
import {
  flatPlan,
  plainDefinitionOf,
  plainPolicy,
  refinementInstance,
} from "./harness.ts";
import type {
  SuccessfulTicketDecision,
  TaskTerminalReport,
  TicketGraph,
} from "../../src/domain/generated/modelTypes.ts";

const config = refinementInstance;

/** The actor's decide step, under the policy the suite is not steering. */
function decideAt(
  graph: TicketGraph,
  command: DecisionEvent,
): SuccessfulTicketDecision {
  return decide(graph, command, plainPolicy);
}

const event1 = releaseTicketEvent(plainDefinitionOf(1));
const d1 = decideAt(genesis, event1);
const g1 = evolve(genesis, d1.event);
const e1: Entry = { seq: 1, event: d1.event };
const event2 = dispatchEvent(id(1), aDispatchSource);
const d2 = decideAt(g1, event2);
const g2 = evolve(g1, d2.event);
const e2: Entry = { seq: 2, event: d2.event };
const goodJournal: readonly Entry[] = [e1, e2];

const work = workTaskOf(1, 1);
const judge = evaluationTaskOf(1, 1, 1, 1, 1);

/** A completion of `task` carrying `report`. */
function completion(
  task: typeof work,
  report: TaskTerminalReport,
): DecisionEvent {
  return taskDoneEvent(id(1), task, report);
}

const d3 = decideAt(g2, completion(work, producedReport(work)));
const e3: Entry = { seq: 3, event: d3.event };

/**
 * The work report the live task owes, with one reference shifted. Each caller
 * zeroes exactly one, which is how a suite red-proofs the well-formedness rule
 * a conjunct at a time rather than at a shape nothing names.
 */
function workReport(
  shift: {
    readonly workload?: number;
    readonly contextRef?: number;
    readonly resultRef?: number;
    readonly acceptedSourceRef?: number;
  } = {},
): TaskTerminalReport {
  const result = resultFor(work);
  return {
    type: "WorkResultReport",
    value: {
      result: {
        obligation: {
          ...result.obligation,
          definition: {
            ...result.obligation.definition,
            ...(shift.workload === undefined
              ? {}
              : { workload: shift.workload }),
          },
          ...(shift.contextRef === undefined
            ? {}
            : { contextRef: shift.contextRef }),
        },
        resultRef: shift.resultRef ?? result.resultRef,
      },
      acceptedSourceRef: shift.acceptedSourceRef ?? anAcceptedSource,
    },
  };
}

test("the empty journal is legal and replays to genesis", () => {
  assert.ok(journalLegalOn([]));
  assert.ok(graphEquals(replayGraph([]), genesis));
});

test("an honest history is legal, and replay reconstructs what the decisions evolved", () => {
  assert.ok(journalLegalOn(goodJournal));
  const replayed = replayGraph(goodJournal);
  assert.ok(graphEquals(replayed, g2));
  assert.deepEqual([...replayed.tickets.keys()], [1]);
  assert.equal(ticketAt(replayed, id(1)).phase, "Work");
});

test("replay is a fold of evolve: one more row is the shorter replay evolved once", () => {
  assert.ok(
    graphEquals(replayGraph(goodJournal), evolve(replayGraph([e1]), e2.event)),
  );
  assert.ok(graphEquals(replayGraph([e1]), g1));
});

test("a sequence gap or a duplicate seq is refused", () => {
  assert.ok(!journalLegalOn([{ ...e1, seq: 2 }]));
  assert.ok(!journalLegalOn([e1, { ...e2, seq: 3 }]));
  assert.ok(!journalLegalOn([e1, { ...e2, seq: 1 }]));
});

test("an event whose ticket does not stand is refused: a release of one that exists, anything about one that does not", () => {
  assert.ok(!journalLegalOn([{ ...e2, seq: 1 }]));
  assert.ok(!journalLegalOn([e1, { ...e1, seq: 2 }]));
});

test("an event that does not move its prefix is refused: a replayed row, or one a later row made stale", () => {
  assert.ok(!journalLegalOn([e1, e2, { ...e2, seq: 3 }]));
  assert.ok(journalLegalOn([e1, e2, e3]));
  assert.ok(!journalLegalOn([e1, e2, e3, { ...e3, seq: 4 }]));
  assert.ok(
    !journalLegalOn([
      e1,
      e2,
      e3,
      {
        seq: 4,
        event: {
          type: "TicketWorkProcessFailed",
          value: { ticket: 1, task: work, evidence: 1 },
        },
      },
    ]),
  );
});

test("a decision that was never enabled is refused at the door", () => {
  assert.ok(!decisionEventEnabled(config, genesis, event2));
  assert.ok(
    !decisionEventEnabled(
      config,
      genesis,
      completion(work, producedReport(work)),
    ),
  );
  assert.ok(
    !decisionEventEnabled(
      config,
      genesis,
      finalizationResultEvent(
        id(1),
        "FinalizationSucceeded",
        aFinalizationEvidence,
      ),
    ),
  );
  assert.ok(!decisionEventEnabled(config, genesis, resumeTicketEvent(id(1))));
});

test("an out-of-universe release is refused by draw-set membership", () => {
  assert.ok(
    !decisionEventEnabled(
      config,
      genesis,
      releaseTicketEvent(plainDefinitionOf(99)),
    ),
  );
});

test("the world arithmetic: emission closes the gap to the book, an orphan pushes past it", () => {
  assert.equal(journalSpawnsOn(goodJournal, id(1)), 1);
  assert.equal(worldSpawnsOn(goodJournal, new Set(), [], id(1)), 0);
  assert.equal(worldSpawnsOn(goodJournal, new Set([1, 2]), [], id(1)), 1);
  assert.equal(
    worldSpawnsOn(goodJournal, new Set([1, 2]), [d2.event], id(1)),
    2,
  );
  assert.ok(
    worldSpawnsOn(goodJournal, new Set([1, 2]), [d2.event], id(1)) >
      journalSpawnsOn(goodJournal, id(1)),
  );
  assert.equal(journalCompletionsOn(goodJournal, id(1)), 0);
  assert.equal(
    journalSpawnsOn([e1, e2, e3], id(1)),
    1,
    "an acceptance owes evaluators, not a work cycle, so it spends no work",
  );
});

test("the task result reference is part of the event: the acceptance carries it and replay reads it", () => {
  const real = completion(work, producedReport(work));
  const other = completion(work, workReport({ resultRef: 2 }));
  assert.notDeepEqual(real, other);
  assert.ok(
    decisionEventEnabled(config, g2, other),
    "the admission weighs the obligation, so a shifted reference is admitted alike",
  );
  const taken = decideAt(g2, real);
  const shifted = decideAt(g2, other);
  assert.equal(taken.event.type, "TicketWorkResultAccepted");
  assert.equal(shifted.event.type, "TicketWorkResultAccepted");
  const takenPost = evolve(g2, taken.event);
  const shiftedPost = evolve(g2, shifted.event);
  assert.ok(
    !graphEquals(takenPost, shiftedPost),
    "a machine deriving the reference would replay both to the same state",
  );
  assert.deepEqual(artifactOf(ticketAt(takenPost, id(1))), {
    type: "ProducedArtifact",
    value: resultFor(work).resultRef,
  });
  assert.deepEqual(artifactOf(ticketAt(shiftedPost, id(1))), {
    type: "ProducedArtifact",
    value: 2,
  });
});

test("a task already accepted is no longer owed, so a second report never journals", () => {
  const first = completion(work, producedReport(work));
  assert.ok(decisionEventEnabled(config, g2, first));
  const accepted = evolve(g2, decideAt(g2, first).event);
  assert.ok(
    !decisionEventEnabled(
      config,
      accepted,
      completion(work, stoppedReport(work, "ProcessFailure")),
    ),
  );
});

/** The journal an honest actor writes for this run of decisions, each row the event the decider took. */
function journalOf(commands: readonly DecisionEvent[]): readonly Entry[] {
  const entries: Entry[] = [];
  let graph = genesis;
  for (const command of commands) {
    const decision = decideAt(graph, command);
    entries.push({ seq: entries.length + 1, event: decision.event });
    graph = evolve(graph, decision.event);
  }
  return entries;
}

/** The state that run reaches. */
function graphAfter(commands: readonly DecisionEvent[]): TicketGraph {
  return replayGraph(journalOf(commands));
}

const toPending: readonly DecisionEvent[] = [event1];
const toWorking: readonly DecisionEvent[] = [...toPending, event2];
const toEvaluating: readonly DecisionEvent[] = [
  ...toWorking,
  completion(work, producedReport(work)),
];
const toFinalizing: readonly DecisionEvent[] = [
  ...toEvaluating,
  completion(judge, judgedReport(judge, "EvaluatorPass")),
];
const toDone: readonly DecisionEvent[] = [
  ...toFinalizing,
  finalizationResultEvent(
    id(1),
    "FinalizationSucceeded",
    aFinalizationEvidence,
  ),
];
const toEscalated: readonly DecisionEvent[] = [
  ...toWorking,
  completion(work, stoppedReport(work, "ExecutionUnavailableFailure")),
];
const toDependent: readonly DecisionEvent[] = [
  ...toPending,
  releaseTicketEvent(plainDefinitionOf(2, new Set([1]))),
];

const pending = graphAfter(toPending);
const working = graphAfter(toWorking);
const finalizing = graphAfter(toFinalizing);
const done = graphAfter(toDone);
const escalated = graphAfter(toEscalated);
const dependent = graphAfter(toDependent);
const full = graphAfter([
  ...toPending,
  releaseTicketEvent(plainDefinitionOf(2)),
]);

interface Refusal {
  readonly conjunct: string;
  readonly at: TicketGraph;
  readonly event: DecisionEvent;
}

const refusals: readonly Refusal[] = [
  {
    conjunct: "CreateTicket/canReleaseIn",
    at: full,
    event: releaseTicketEvent(plainDefinitionOf(3)),
  },
  {
    conjunct: "CreateTicket/dependableIn",
    at: pending,
    event: releaseTicketEvent(plainDefinitionOf(2, new Set([2]))),
  },
  {
    conjunct: "CreateTicket/isValidPlan",
    at: genesis,
    event: releaseTicketEvent({
      ...plainDefinitionOf(1),
      evaluationPlan: { stages: [...flatPlan, ...flatPlan] },
    }),
  },
  { conjunct: "Revoke/revocablesIn", at: done, event: revokeEvent(id(1)) },
  {
    conjunct: "Dispatch/readiesIn",
    at: working,
    event: dispatchEvent(id(1), aDispatchSource),
  },
  { conjunct: "Dispatch/source", at: pending, event: dispatchEvent(id(1), 0) },
  {
    conjunct: "TaskDone/completableIn",
    at: pending,
    event: completion(work, producedReport(work)),
  },
  {
    conjunct: "TaskDone/reportValid/definition",
    at: working,
    event: completion(work, workReport({ workload: 0 })),
  },
  {
    conjunct: "TaskDone/reportValid/contextRef",
    at: working,
    event: completion(work, workReport({ contextRef: 0 })),
  },
  {
    conjunct: "TaskDone/reportValid/resultRef",
    at: working,
    event: completion(work, workReport({ resultRef: 0 })),
  },
  {
    conjunct: "TaskDone/reportValid/acceptedSourceRef",
    at: working,
    event: completion(work, workReport({ acceptedSourceRef: 0 })),
  },
  {
    conjunct: "TaskDone/reportValid/evidence",
    at: working,
    event: completion(work, {
      type: "TerminalFailureReport",
      value: { failure: { task: work, evidence: 0 }, kind: "ProcessFailure" },
    }),
  },
  {
    conjunct: "TaskDone/reportMatchesTask",
    at: working,
    event: completion(work, judgedReport(judge, "EvaluatorPass")),
  },
  {
    conjunct: "TaskDone/outstandingTaskIn",
    at: working,
    event: completion(workTaskOf(1, 9), producedReport(workTaskOf(1, 9))),
  },
  {
    conjunct: "TaskDone/reportMatchesTask/failure",
    at: working,
    event: completion(work, stoppedReport(workTaskOf(1, 2), "ProcessFailure")),
  },
  {
    conjunct: "FinalizationResult/finalizableIn",
    at: working,
    event: finalizationResultEvent(
      id(1),
      "FinalizationSucceeded",
      aFinalizationEvidence,
    ),
  },
  {
    conjunct: "FinalizationResult/evidence",
    at: finalizing,
    event: finalizationResultEvent(id(1), "FinalizationSucceeded", 0),
  },
  {
    conjunct: "ResumeTicket/retryablesIn",
    at: pending,
    event: resumeTicketEvent(id(1)),
  },
];

/**
 * Two conjuncts have no row, because nothing outside their draw set can be
 * constructed: a release's `finalizer` and a finalization result's outcome are
 * each a closed type whose every value the configuration offers. The release
 * repeating a dep has no row and no conjunct either — the payload is the
 * model's set — so that refusal lives in `test/interpreter/wire.test.ts`, on
 * the array a stored journal carries.
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
      releaseTicketEvent(plainDefinitionOf(2, new Set([1]))),
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
  readonly at: TicketGraph;
  readonly decided: SuccessfulTicketDecision;
}

const drives: readonly Drive[] = [
  {
    arm: "Revoke",
    before: toPending,
    event: revokeEvent(id(1)),
    at: pending,
    decided: decideRevoke(pending, id(1)),
  },
  {
    arm: "Revoke/with a dependent",
    before: toDependent,
    event: revokeEvent(id(1)),
    at: dependent,
    decided: decideRevoke(dependent, id(1)),
  },
  {
    arm: "TaskDone/a work task walled",
    before: toWorking,
    event: completion(work, stoppedReport(work, "ExecutionUnavailableFailure")),
    at: working,
    decided: decideTaskDone(
      working,
      id(1),
      work,
      stoppedReport(work, "ExecutionUnavailableFailure"),
      plainPolicy,
    ),
  },
  {
    arm: "ResumeTicket",
    before: toEscalated,
    event: resumeTicketEvent(id(1)),
    at: escalated,
    decided: decideResumeTicket(escalated, id(1)),
  },
  {
    arm: "FinalizationResult/FinalizationNeedsWork",
    before: toFinalizing,
    event: finalizationResultEvent(
      id(1),
      "FinalizationNeedsWork",
      aFinalizationEvidence,
    ),
    at: finalizing,
    decided: decideFinalizationResult(
      finalizing,
      id(1),
      "FinalizationNeedsWork",
      aFinalizationEvidence,
    ),
  },
];

test("each otherwise-undriven arm journals legally and decides what the domain decides", () => {
  for (const { arm, before, event, at, decided } of drives) {
    assert.ok(
      decisionEventEnabled(config, at, event),
      `${arm}: refused at its own state`,
    );
    assert.deepEqual(
      decideAt(at, event),
      decided,
      `${arm}: a different decision`,
    );
    const journal = journalOf([...before, event]);
    assert.equal(journal.length, before.length + 1);
    assert.ok(journalLegalOn(journal), `${arm}: the journal is illegal`);
    assert.ok(
      graphEquals(replayGraph(journal), evolve(at, decided.event)),
      `${arm}: replay does not reach the decided state`,
    );
  }
});
