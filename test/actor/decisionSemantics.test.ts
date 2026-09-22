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
  dispatchEvent,
  execDecisionEvent,
  finalizationResultEvent,
  releaseTicketEvent,
  resumeTicketEvent,
  taskDoneEvent,
  workReduceEvent,
  type DecisionEvent,
} from "../../src/actor/decisionEvent.ts";
import { aDispatchSource } from "../../src/domain/config.ts";
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
import { evaluationTaskOf, workTaskOf } from "../../src/domain/task.ts";
import { ticketAt } from "../../src/domain/ticketGraph.ts";
import {
  id,
  judgedReport,
  producedReport,
  stoppedReport,
} from "../domain/fixtures.ts";
import {
  plainDefinitionOf,
  plainDisposition,
  refinementInstance,
} from "./harness.ts";

const config = refinementInstance;

/** A history the current deciders wrote, which is the only vintage this image holds. */
function decided(events: readonly DecisionEvent[]): readonly Entry[] {
  let graph = genesis;
  return events.map((event, at) => {
    const decision = execDecisionEvent(graph, event);
    graph = decision.post;
    return { seq: at + 1, event, rec: decision.rec };
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
const walled = workTaskOf(1, 1);
const reworked = workTaskOf(1, 2);
const stopped = evaluationTaskOf(1, 2, 1, 1, 1);
const reasked = evaluationTaskOf(1, 2, 1, 2, 1);

const walls = decided([
  releaseTicketEvent(plainDefinitionOf(1)),
  dispatchEvent(id(1), aDispatchSource),
  taskDoneEvent(
    id(1),
    walled,
    stoppedReport(walled, "ExecutionUnavailableFailure"),
    plainDisposition,
  ),
  resumeTicketEvent(id(1)),
  taskDoneEvent(id(1), reworked, producedReport(reworked), plainDisposition),
  workReduceEvent(id(1)),
  taskDoneEvent(
    id(1),
    stopped,
    stoppedReport(stopped, "ExecutionUnavailableFailure"),
    plainDisposition,
  ),
  resumeTicketEvent(id(1)),
  taskDoneEvent(
    id(1),
    reasked,
    judgedReport(reasked, "EvaluatorPass"),
    plainDisposition,
  ),
  finalizationResultEvent(id(1), "FinalizationResultUnavailable"),
  resumeTicketEvent(id(1)),
  finalizationResultEvent(id(1), "FinalizationSucceeded"),
]);

test("this image knows one decision semantics and says which", () => {
  assert.equal(decisionSemanticsVersionCurrent, 6);
  assert.ok(isDecisionSemanticsVersion(6));
  for (const older of [1, 2, 3, 4, 5])
    assert.ok(
      !isDecisionSemanticsVersion(older),
      `${String(older)} names deciders this image does not have`,
    );
  assert.ok(!isDecisionSemanticsVersion(7));
  assert.ok(!isDecisionSemanticsVersion(6.5));
});

test("a row declaring another semantics is refused rather than replayed", () => {
  assert.ok(storedJournalLegalOn(config, storedAt(walls, 6)));
  for (const older of [1, 2, 3, 4, 5])
    assert.ok(
      !storedJournalLegalOn(
        config,
        storedAt(walls, older as DecisionSemanticsVersion),
      ),
      `a history at ${String(older)} is not one this image decided`,
    );
});

test("each wall names itself and its resume re-enters the phase it interrupted", () => {
  const labels = walls.map((entry) => entry.rec.label);
  assert.deepEqual(
    labels.filter((label) => label.startsWith("ticket-escalated")),
    [
      "ticket-escalated work_execution_unavailable_escalated",
      "ticket-escalated evaluation_blocked_escalated",
      "ticket-escalated finalization_unavailable_escalated",
    ],
  );
  const after = (at: number) =>
    ticketAt(storedReplayGraph(storedAt(walls.slice(0, at), 6)), id(1));
  assert.equal(after(3).escalation, "WorkExecutionUnavailableEscalated");
  assert.equal(after(4).phase, "Work");
  assert.equal(after(7).escalation, "EvaluationBlockedEscalated");
  assert.equal(after(8).phase, "Evaluation");
  assert.equal(after(10).escalation, "FinalizationUnavailableEscalated");
  assert.equal(after(11).phase, "Finalization");
});

test("the whole history is legal as decisions this image took, and ends Done", () => {
  assert.ok(journalLegalOn(config, walls));
  const settled = ticketAt(storedReplayGraph(storedAt(walls, 6)), id(1));
  assert.equal(settled.phase, "Done");
  assert.equal(settled.escalation, "NoEscalation");
});
