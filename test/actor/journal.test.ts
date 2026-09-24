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
 * EVERY COMMAND GETS A CASE PER ANSWER, from the two tables at the foot. The
 * answer table carries a row per check rather than per constructor — the
 * shape rule a command must meet to be taken at all, then each refusal by the
 * name `decide` gives it — because a row answered on a first check says
 * nothing about a second; the drive table takes the arms no walk in
 * `test/actor/` reaches, each answered against the domain decider called
 * directly rather than against `decide`'s own answer, so a mis-wired arm
 * disagrees with something.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createTicketCommand,
  dispatchTicketCommand,
  reportFinalizationResultCommand,
  reportTaskTerminalCommand,
  resumeTicketCommand,
  revokeTicketCommand,
  ticketCommandTags,
  type TicketCommand,
} from "../../src/actor/command.ts";
import { graphEquals } from "../../src/domain/equality.ts";
import { evolve } from "../../src/domain/evolve.ts";
import {
  eventReportTicketAgrees,
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
  commandValid,
  decide,
  decideFinalizationResult,
  decideResume,
  decideRevoke,
  decideTaskTerminal,
} from "../../src/domain/deciders.ts";
import {
  aDispatchSource,
  aFinalizationEvidence,
  anAcceptedSource,
} from "../../src/domain/config.ts";
import { artifactOf } from "../../src/domain/ticket.ts";
import { evaluationTaskOf, workTaskOf } from "../../src/domain/task.ts";
import {
  acceptedOf,
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
  FinalizationResult,
  SuccessfulTicketDecision,
  TaskTerminalReport,
  TicketDecision,
  TicketEvent,
  TicketGraph,
  TicketRefusal,
} from "../../src/domain/generated/modelTypes.ts";

const config = refinementInstance;

/** The actor's decide step, under the policy the suite is not steering. */
function decisionAt(
  graph: TicketGraph,
  command: TicketCommand,
): TicketDecision {
  return decide(graph, command, plainPolicy);
}

/** The same step where the suite knows the command is accepted. */
function decideAt(
  graph: TicketGraph,
  command: TicketCommand,
): SuccessfulTicketDecision {
  return acceptedOf(decisionAt(graph, command));
}

/**
 * How the machine answers a command at a state: not taken at all when it is
 * outside `commandValid`, else refused by name, else accepted.
 */
function answerAt(
  graph: TicketGraph,
  command: TicketCommand,
): "NotTaken" | "Accepted" | TicketRefusal["type"] {
  if (!commandValid(config, command)) return "NotTaken";
  const decision = decisionAt(graph, command);
  return decision.type === "TicketRefused" ? decision.value.type : "Accepted";
}

/** The finalizer's result for ticket one's attempt (`workCycle`, `generation`). */
function finalization(
  workCycle: number,
  generation: number,
  type: FinalizationResult["type"],
  evidence: number = aFinalizationEvidence,
): TicketCommand {
  return reportFinalizationResultCommand(id(1), workCycle, generation, {
    type,
    value: evidence,
  });
}

const event1 = createTicketCommand(plainDefinitionOf(1));
const d1 = decideAt(genesis, event1);
const g1 = evolve(genesis, d1.event);
const e1: Entry = { seq: 1, event: d1.event };
const event2 = dispatchTicketCommand(id(1), aDispatchSource);
const d2 = decideAt(g1, event2);
const g2 = evolve(g1, d2.event);
const e2: Entry = { seq: 2, event: d2.event };
const goodJournal: readonly Entry[] = [e1, e2];

const work = workTaskOf(1, 1);
const judge = evaluationTaskOf(1, 1, 1, 1, 1);

/** A completion carrying `report`. */
function completion(report: TaskTerminalReport): TicketCommand {
  return reportTaskTerminalCommand(report);
}

const d3 = decideAt(g2, completion(producedReport(work)));
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
      ticket: 1,
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

test("a command about a ticket the fleet does not hold is refused, naming it", () => {
  assert.equal(answerAt(genesis, event2), "TicketNotFound");
  assert.equal(
    answerAt(genesis, completion(producedReport(work))),
    "TicketNotFound",
  );
  assert.equal(
    answerAt(genesis, finalization(1, 1, "FinalizationSucceeded")),
    "TicketNotFound",
  );
  assert.equal(answerAt(genesis, resumeTicketCommand(id(1))), "TicketNotFound");
});

test("the actor takes a release outside the id universe, because the release room is the writer's to refuse", () => {
  assert.equal(
    answerAt(genesis, createTicketCommand(plainDefinitionOf(99))),
    "Accepted",
  );
});

/** A report about ticket one's judge, retold as about another ticket. */
const judgedElsewhere = ((): TaskTerminalReport => {
  const report = judgedReport(judge, "EvaluatorPass");
  assert.ok(report.type === "EvaluationResultReport");
  return { type: report.type, value: { ...report.value, ticket: 7 } };
})();

test("a row whose report is about another ticket is refused, in every arm that carries one", () => {
  const g3 = evolve(g2, d3.event);
  const passed = decideAt(g3, completion(judgedReport(judge, "EvaluatorPass")));
  assert.equal(passed.event.type, "TicketEvaluationPassed");
  const e4: Entry = { seq: 4, event: passed.event };
  assert.ok(journalLegalOn([e1, e2, e3, e4]));
  const forged: Entry = {
    seq: 4,
    event: {
      type: "TicketEvaluationPassed",
      value: { ticket: 1, report: judgedElsewhere },
    },
  };
  assert.ok(!journalLegalOn([e1, e2, e3, forged]));
  const fact = { ticket: 1, report: judgedElsewhere };
  const rework = { ...fact, evidence: [] };
  const arms: readonly TicketEvent[] = [
    { type: "TicketEvaluationProgressed", value: fact },
    { type: "TicketEvaluationPassed", value: fact },
    { type: "TicketEvaluationBlocked", value: fact },
    { type: "TicketEvaluationReworkStarted", value: rework },
    { type: "TicketEvaluationFailureEscalated", value: rework },
  ];
  for (const event of arms)
    assert.ok(!eventReportTicketAgrees(event), event.type);
  assert.ok(eventReportTicketAgrees(passed.event));
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
  const real = completion(producedReport(work));
  const other = completion(workReport({ resultRef: 2 }));
  assert.notDeepEqual(real, other);
  assert.equal(
    answerAt(g2, other),
    "Accepted",
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

test("a task already accepted is no longer owed, so a second report is refused", () => {
  const first = completion(producedReport(work));
  assert.equal(answerAt(g2, first), "Accepted");
  const accepted = evolve(g2, decideAt(g2, first).event);
  assert.deepEqual(
    decisionAt(accepted, completion(stoppedReport(work, "ProcessFailure"))),
    {
      type: "TicketRefused",
      value: { type: "TaskNotCurrent", value: { ticket: 1, task: work } },
    },
  );
});

/** The journal an honest actor writes for this run of decisions, each row the event the decider took. */
function journalOf(commands: readonly TicketCommand[]): readonly Entry[] {
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
function graphAfter(commands: readonly TicketCommand[]): TicketGraph {
  return replayGraph(journalOf(commands));
}

const toPending: readonly TicketCommand[] = [event1];
const toWorking: readonly TicketCommand[] = [...toPending, event2];
const toEvaluating: readonly TicketCommand[] = [
  ...toWorking,
  completion(producedReport(work)),
];
const toFinalizing: readonly TicketCommand[] = [
  ...toEvaluating,
  completion(judgedReport(judge, "EvaluatorPass")),
];
const toDone: readonly TicketCommand[] = [
  ...toFinalizing,
  finalization(1, 1, "FinalizationSucceeded"),
];
const toEscalated: readonly TicketCommand[] = [
  ...toWorking,
  completion(stoppedReport(work, "ExecutionUnavailableFailure")),
];
const toDependent: readonly TicketCommand[] = [
  ...toPending,
  createTicketCommand(plainDefinitionOf(2, new Set([1]))),
];

const pending = graphAfter(toPending);
const working = graphAfter(toWorking);
const finalizing = graphAfter(toFinalizing);
const done = graphAfter(toDone);
const escalated = graphAfter(toEscalated);
const dependent = graphAfter(toDependent);

interface Answer {
  readonly check: string;
  readonly at: TicketGraph;
  readonly command: TicketCommand;
  readonly answer: ReturnType<typeof answerAt>;
}

const answers: readonly Answer[] = [
  {
    check: "CreateTicket/commandValid/plan",
    at: genesis,
    command: createTicketCommand({
      ...plainDefinitionOf(1),
      evaluationPlan: { stages: [...flatPlan, ...flatPlan] },
    }),
    answer: "NotTaken",
  },
  {
    check: "CreateTicket/exists",
    at: pending,
    command: createTicketCommand(plainDefinitionOf(1)),
    answer: "TicketAlreadyExists",
  },
  {
    check: "CreateTicket/self",
    at: pending,
    command: createTicketCommand(plainDefinitionOf(2, new Set([2]))),
    answer: "SelfDependency",
  },
  {
    check: "CreateTicket/dependencies",
    at: pending,
    command: createTicketCommand(plainDefinitionOf(2, new Set([3]))),
    answer: "DependenciesNotFound",
  },
  {
    check: "RevokeTicket/found",
    at: pending,
    command: revokeTicketCommand(id(2)),
    answer: "TicketNotFound",
  },
  {
    check: "RevokeTicket/revocable",
    at: done,
    command: revokeTicketCommand(id(1)),
    answer: "TicketNotRevocable",
  },
  {
    check: "DispatchTicket/commandValid/source",
    at: pending,
    command: dispatchTicketCommand(id(1), 0),
    answer: "NotTaken",
  },
  {
    check: "DispatchTicket/pending",
    at: working,
    command: dispatchTicketCommand(id(1), aDispatchSource),
    answer: "TicketNotPending",
  },
  {
    check: "DispatchTicket/dependencies",
    at: dependent,
    command: dispatchTicketCommand(id(2), aDispatchSource),
    answer: "DependenciesIncomplete",
  },
  {
    check: "ReportTaskTerminal/commandValid/definition",
    at: working,
    command: completion(workReport({ workload: 0 })),
    answer: "NotTaken",
  },
  {
    check: "ReportTaskTerminal/commandValid/contextRef",
    at: working,
    command: completion(workReport({ contextRef: 0 })),
    answer: "NotTaken",
  },
  {
    check: "ReportTaskTerminal/commandValid/resultRef",
    at: working,
    command: completion(workReport({ resultRef: 0 })),
    answer: "NotTaken",
  },
  {
    check: "ReportTaskTerminal/commandValid/acceptedSourceRef",
    at: working,
    command: completion(workReport({ acceptedSourceRef: 0 })),
    answer: "NotTaken",
  },
  {
    check: "ReportTaskTerminal/commandValid/evidence",
    at: working,
    command: completion({
      type: "TerminalFailureReport",
      value: {
        ticket: 1,
        failure: { task: work, evidence: 0 },
        kind: "ProcessFailure",
      },
    }),
    answer: "NotTaken",
  },
  {
    check: "ReportTaskTerminal/phase",
    at: pending,
    command: completion(producedReport(work)),
    answer: "TaskNotCurrent",
  },
  {
    check: "ReportTaskTerminal/kind",
    at: working,
    command: completion(judgedReport(judge, "EvaluatorPass")),
    answer: "TaskNotCurrent",
  },
  {
    check: "ReportTaskTerminal/owed",
    at: working,
    command: completion(producedReport(workTaskOf(1, 9))),
    answer: "TaskNotCurrent",
  },
  {
    check: "ReportTaskTerminal/cycle",
    at: working,
    command: completion(stoppedReport(workTaskOf(1, 2), "ProcessFailure")),
    answer: "TaskNotCurrent",
  },
  {
    check: "ReportFinalizationResult/commandValid/evidence",
    at: finalizing,
    command: finalization(1, 1, "FinalizationSucceeded", 0),
    answer: "NotTaken",
  },
  {
    check: "ReportFinalizationResult/phase",
    at: working,
    command: finalization(1, 1, "FinalizationSucceeded"),
    answer: "FinalizationNotCurrent",
  },
  {
    check: "ReportFinalizationResult/generation",
    at: finalizing,
    command: finalization(1, 2, "FinalizationSucceeded"),
    answer: "FinalizationNotCurrent",
  },
  {
    check: "ReportFinalizationResult/cycle",
    at: finalizing,
    command: finalization(2, 1, "FinalizationSucceeded"),
    answer: "FinalizationNotCurrent",
  },
  {
    check: "ResumeTicket/resumable",
    at: pending,
    command: resumeTicketCommand(id(1)),
    answer: "TicketNotResumable",
  },
];

/**
 * A release's `finalizer` and a finalization result's arm have no row: each
 * is a closed type whose every value the configuration offers. The release
 * repeating a dep has no row either — the payload is the model's set — so that
 * case lives in `test/interpreter/wire.test.ts`, on the array a stored journal
 * carries.
 */
test("every check of every command answers on a state that fails it alone", () => {
  for (const { check, at, command, answer } of answers) {
    assert.equal(answerAt(at, command), answer, check);
  }
});

/** The arm's positive half, which a table of refusals cannot carry. */
test("a release naming a dependency that exists is accepted", () => {
  assert.equal(
    answerAt(pending, createTicketCommand(plainDefinitionOf(2, new Set([1])))),
    "Accepted",
  );
});

test("the answer table names every constructor the model declares", () => {
  assert.deepEqual(
    [...new Set(answers.map((row) => row.command.type))].sort(),
    [...ticketCommandTags].sort(),
  );
});

/** `decided` is the domain decider called directly, so a mis-wired dispatch arm has somewhere to disagree. */
interface Drive {
  readonly arm: string;
  readonly before: readonly TicketCommand[];
  readonly command: TicketCommand;
  readonly at: TicketGraph;
  readonly decided: TicketDecision;
}

const drives: readonly Drive[] = [
  {
    arm: "RevokeTicket",
    before: toPending,
    command: revokeTicketCommand(id(1)),
    at: pending,
    decided: decideRevoke(pending, 1),
  },
  {
    arm: "RevokeTicket/with a dependent",
    before: toDependent,
    command: revokeTicketCommand(id(1)),
    at: dependent,
    decided: decideRevoke(dependent, 1),
  },
  {
    arm: "ReportTaskTerminal/a work task walled",
    before: toWorking,
    command: completion(stoppedReport(work, "ExecutionUnavailableFailure")),
    at: working,
    decided: decideTaskTerminal(
      working,
      stoppedReport(work, "ExecutionUnavailableFailure"),
      plainPolicy,
    ),
  },
  {
    arm: "ResumeTicket",
    before: toEscalated,
    command: resumeTicketCommand(id(1)),
    at: escalated,
    decided: decideResume(escalated, 1),
  },
  {
    arm: "ReportFinalizationResult/FinalizationNeedsWork",
    before: toFinalizing,
    command: finalization(1, 1, "FinalizationNeedsWork"),
    at: finalizing,
    decided: decideFinalizationResult(finalizing, {
      ticket: 1,
      workCycle: 1,
      generation: 1,
      result: { type: "FinalizationNeedsWork", value: aFinalizationEvidence },
    }),
  },
];

test("each otherwise-undriven arm journals legally and decides what the domain decides", () => {
  for (const { arm, before, command, at, decided } of drives) {
    assert.equal(
      answerAt(at, command),
      "Accepted",
      `${arm}: refused at its own state`,
    );
    assert.deepEqual(
      decisionAt(at, command),
      decided,
      `${arm}: a different decision`,
    );
    const journal = journalOf([...before, command]);
    assert.equal(journal.length, before.length + 1);
    assert.ok(journalLegalOn(journal), `${arm}: the journal is illegal`);
    assert.ok(
      graphEquals(replayGraph(journal), evolve(at, acceptedOf(decided).event)),
      `${arm}: replay does not reach the decided state`,
    );
  }
});
