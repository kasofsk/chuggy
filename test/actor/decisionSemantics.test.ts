/**
 * The decision semantics this image replays, and what it refuses.
 *
 * THERE IS ONE, AND THE HISTORIES THAT MADE IT MORE ARE GONE. Three pinned
 * fixtures used to stand here, written by earlier images and the only record
 * of what those machines decided. They are deleted: the deployment that
 * collapsed the desk walls into one sum wiped its journal first, so no row
 * older than this semantics exists anywhere, and a fixture whose corrections
 * this image no longer carries proves nothing about a replay nobody performs.
 *
 * WHAT IS LEFT IS THE REFUSAL AND THE ROUND TRIP. A row declaring any other
 * semantics is refused rather than replayed — by `isDecisionSemanticsVersion`
 * where a store reads one, and by `storedJournalLegalOn` at the fold — and a
 * history this image decided, walls and resumes included, replays back to the
 * state that wrote it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createTicketCommand,
  dispatchTicketCommand,
  reportFinalizationResultCommand,
  reportTaskTerminalCommand,
  resumeTicketCommand,
  type TicketCommand,
} from "../../src/actor/command.ts";
import { decide } from "../../src/domain/deciders.ts";
import type { TicketState } from "../../src/domain/generated/modelTypes.ts";
import {
  aDispatchSource,
  aFinalizationEvidence,
} from "../../src/domain/config.ts";
import { evolve } from "../../src/domain/evolve.ts";
import {
  genesis,
  journalLegalOn,
  storedJournalLegalOn,
  storedReplayGraph,
  type Entry,
  type StoredEntry,
} from "../../src/actor/journal.ts";
import {
  decisionSemanticsVersionCurrent,
  isDecisionSemanticsVersion,
  type DecisionSemanticsVersion,
} from "../../src/actor/decisionSemantics.ts";
import { evaluationTaskOf, workTaskIdentity } from "../../src/domain/task.ts";
import { ticketAt } from "../../src/domain/ticketGraph.ts";
import { phaseOf } from "../../src/domain/phase.ts";
import {
  acceptedOf,
  id,
  judgedReport,
  producedReport,
  stoppedReport,
} from "../domain/fixtures.ts";
import { plainDefinitionOf, plainPolicy } from "./harness.ts";

/** The wall a state stands at, by its escalation's tag, or none. */
function wallOf(state: TicketState): string | undefined {
  return typeof state !== "string" && state.type === "Escalated"
    ? state.value.type
    : undefined;
}

/** A history the current deciders wrote, which is the only vintage this image holds. */
function decided(events: readonly TicketCommand[]): readonly Entry[] {
  let graph = genesis;
  return events.map((command, at) => {
    const decision = acceptedOf(decide(graph, command, plainPolicy));
    graph = evolve(graph, decision.event);
    return { seq: at + 1, event: decision.event };
  });
}

/** A history as a store holding it would present it, every row at one semantics. */
function storedAt(
  entries: readonly Entry[],
  semantics: DecisionSemanticsVersion,
): readonly StoredEntry[] {
  return entries.map((entry) => ({ entry, semantics }));
}

/**
 * A history through both infrastructure walls and out the far side: a work set
 * blocked and resumed, then an evaluation set blocked and resumed, then the
 * finalizer reaching no result and resuming into a success.
 */
const walled = workTaskIdentity(1, 1);
const reworked = workTaskIdentity(1, 2);
const stopped = evaluationTaskOf(1, 2, 1, 1, 1);
const reasked = evaluationTaskOf(1, 2, 1, 2, 1);

const walls = decided([
  createTicketCommand(plainDefinitionOf(1)),
  dispatchTicketCommand(id(1), aDispatchSource),
  reportTaskTerminalCommand(
    stoppedReport(walled, "ExecutionUnavailableFailure"),
  ),
  resumeTicketCommand(id(1)),
  reportTaskTerminalCommand(producedReport(reworked)),
  reportTaskTerminalCommand(
    stoppedReport(stopped, "ExecutionUnavailableFailure"),
  ),
  resumeTicketCommand(id(1)),
  reportTaskTerminalCommand(judgedReport(reasked, "EvaluatorPass")),
  reportFinalizationResultCommand(id(1), 2, 1, {
    type: "FinalizationResultUnavailable",
    value: aFinalizationEvidence,
  }),
  resumeTicketCommand(id(1)),
  reportFinalizationResultCommand(id(1), 2, 2, {
    type: "FinalizationSucceeded",
    value: aFinalizationEvidence,
  }),
]);

test("this image knows one decision semantics and says which", () => {
  assert.equal(decisionSemanticsVersionCurrent, 8);
  assert.ok(isDecisionSemanticsVersion(8));
  for (const older of [1, 2, 3, 4, 5, 6, 7])
    assert.ok(
      !isDecisionSemanticsVersion(older),
      `${String(older)} names deciders this image does not have`,
    );
  assert.ok(!isDecisionSemanticsVersion(9));
  assert.ok(!isDecisionSemanticsVersion(7.5));
});

test("a row declaring another semantics is refused rather than replayed", () => {
  assert.ok(storedJournalLegalOn(storedAt(walls, 8)));
  for (const older of [1, 2, 3, 4, 5, 6, 7])
    assert.ok(
      !storedJournalLegalOn(storedAt(walls, older as DecisionSemanticsVersion)),
      `a history at ${String(older)} is not one this image decided`,
    );
});

test("each wall names itself and its resume says which phase it re-enters", () => {
  assert.deepEqual(
    walls.map((entry) => entry.event.type),
    [
      "TicketCreated",
      "TicketDispatched",
      "TicketWorkExecutionUnavailable",
      "TicketWorkResumed",
      "TicketWorkResultAccepted",
      "TicketEvaluationBlocked",
      "TicketEvaluationResumed",
      "TicketEvaluationPassed",
      "TicketFinalizationUnavailable",
      "TicketFinalizationResumed",
      "TicketFinalizationSucceeded",
    ],
  );
  const after = (at: number) =>
    ticketAt(storedReplayGraph(storedAt(walls.slice(0, at), 8)), id(1)).state;
  assert.equal(wallOf(after(3)), "WorkExecutionUnavailableEscalated");
  assert.equal(phaseOf(after(4)), "Work");
  assert.equal(wallOf(after(6)), "EvaluationBlockedEscalated");
  assert.equal(phaseOf(after(7)), "Evaluation");
  assert.equal(wallOf(after(9)), "FinalizationUnavailableEscalated");
  assert.equal(phaseOf(after(10)), "Finalization");
});

test("the whole history is legal as decisions this image took, and ends Done", () => {
  assert.ok(journalLegalOn(walls));
  const settled = ticketAt(storedReplayGraph(storedAt(walls, 8)), id(1));
  assert.equal(settled.state, "Done");
});
