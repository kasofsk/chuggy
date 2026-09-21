/**
 * The rework wall's histories under the machine that decided them, on bytes
 * this tree can no longer produce.
 *
 * THE FIXTURES ARE PINNED AND NOT GENERATED. The golden traces are emitted by
 * the same tree that replays them, so a semantics change moves both sides at
 * once and no trace can witness one. Both files here were written by the
 * deciders at 919c7b6 and are the only record of what that machine decided.
 *
 * THEY COVER THE TWO SHAPES THE WALL CHANGED IN. `journalAtSemanticsOne.json`
 * is one ticket reworked once, walled and resumed, where the first semantics
 * resumed into evaluation and the current one resumes into work — a record
 * divergence. `journalAtSemanticsOneWalls.json` carries two walled tickets,
 * the second reworked before it walled, so one history holds an EvalReduce row
 * on each disposition edge: the bytes name neither, and the record is what
 * says which was taken.
 *
 * A PRE-3 ROW'S EVALREDUCE NAMED ONLY ITS TICKET, a shape the wire union this
 * image generates does not describe, so the bytes are lifted before they are
 * an event at all. That lift belongs to the seam a store's load reads a row
 * with, so these files are read through `parseStoredEntry` rather than through
 * a second copy of it here.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  decisionEventEnabled,
  resumeTicketEvent,
} from "../../src/actor/decisionEvent.ts";
import {
  journalLegalOn,
  storedJournalLegalOn,
  storedReplayCore,
  type Entry,
  type StoredEntry,
} from "../../src/actor/journal.ts";
import {
  decisionSemanticsVersionCurrent,
  replayableDecision,
} from "../../src/actor/decisionSemantics.ts";
import { parseStoredEntry } from "../../src/interpreter/wire.ts";
import { ticketAt } from "../../src/domain/core.ts";
import { id } from "../domain/fixtures.ts";
import { refinementInstance } from "./harness.ts";

const config = refinementInstance;

/** One pinned history, read exactly as a store's load reads a row of that vintage. */
function pinned(file: string): readonly Entry[] {
  const raw: unknown = JSON.parse(
    readFileSync(join(import.meta.dirname, file), "utf8"),
  );
  assert.ok(Array.isArray(raw), `${file} is not a journal`);
  return raw.map((row: unknown, at: number) => {
    const parsed = parseStoredEntry(row, 1);
    if (parsed.parsed === "Refused")
      throw new Error(`${file} row ${String(at)} is unreadable: ${parsed.why}`);
    return parsed.value;
  });
}

/** A pinned history as a store holding it would present it, every row at one semantics. */
function storedAt(
  entries: readonly Entry[],
  semantics: 1 | 2,
): readonly StoredEntry[] {
  return entries.map((entry) => ({ entry, semantics }));
}

const reworkedWall = pinned("journalAtSemanticsOne.json");
const walls = pinned("journalAtSemanticsOneWalls.json");

test("the reworked history walks the rework wall and resumes past it", () => {
  const walled = reworkedWall.filter(
    (entry) => entry.rec.label === "ticket-escalated rework_budget_exhausted",
  );
  const resumes = reworkedWall.filter(
    (entry) => entry.event.type === "ResumeTicket",
  );
  assert.equal(walled.length, 1);
  assert.equal(resumes.length, 1);
  assert.deepEqual(resumes[0]?.rec.effects, ["SpawnEvalTasks"]);
});

test("the reworked history is legal under the semantics its rows declare", () => {
  assert.ok(storedJournalLegalOn(config, storedAt(reworkedWall, 1)));
});

test("the same history read as this image's own decisions is not legal", () => {
  assert.ok(!storedJournalLegalOn(config, storedAt(reworkedWall, 2)));
  assert.ok(!journalLegalOn(config, reworkedWall));
});

test("replay under the first semantics resumes the walled ticket into evaluation", () => {
  const replayed = storedReplayCore(config, storedAt(reworkedWall, 1));
  assert.equal(ticketAt(replayed, id(1)).phase, "Evaluating");
  assert.equal(ticketAt(replayed, id(1)).resumeAt, "NoResume");
});

test("a row decided under an older machine than the row before it is refused", () => {
  const descending = reworkedWall.map((entry, at) => ({
    entry,
    semantics: at === 0 ? decisionSemanticsVersionCurrent : 1,
  }));
  assert.ok(!storedJournalLegalOn(config, descending));
});

test("the two-wall history holds an EvalReduce row on each disposition edge", () => {
  const reduces = walls.filter((entry) => entry.event.type === "EvalReduce");
  assert.deepEqual(
    reduces.map((entry) => entry.rec.label),
    [
      "ticket-escalated rework_budget_exhausted",
      "rework-started eval_failure",
      "ticket-escalated rework_budget_exhausted",
    ],
  );
  assert.ok(storedJournalLegalOn(config, storedAt(walls, 1)));
  assert.ok(!storedJournalLegalOn(config, storedAt(walls, 2)));
});

test("a second-semantics EvalReduce takes the edge its record records", () => {
  const toTheWall = storedAt(walls.slice(0, 6), 2);
  const walled = ticketAt(storedReplayCore(config, toTheWall), id(1));
  assert.equal(walled.phase, "Escalated");
  assert.equal(walled.reason, "ReworkBudgetExhausted");

  const toTheRework = storedAt(walls.slice(0, 13), 2);
  const reworked = ticketAt(storedReplayCore(config, toTheRework), id(2));
  assert.equal(reworked.phase, "Working");
});

test("the first semantics parks the wall at the eval resume, the second where this machine does", () => {
  const toTheWall = walls.slice(0, 6);
  assert.equal(
    ticketAt(storedReplayCore(config, storedAt(toTheWall, 1)), id(1)).resumeAt,
    "ResumeEvaluating",
  );
  assert.equal(
    ticketAt(storedReplayCore(config, storedAt(toTheWall, 2)), id(1)).resumeAt,
    "ResumeReworking",
  );
});

test("a parked ticket is resumable whichever semantics walled it", () => {
  const resume = resumeTicketEvent(id(1));
  const toTheWall = walls.slice(0, 6);
  for (const semantics of [1, 2] as const) {
    const at = storedReplayCore(config, storedAt(toTheWall, semantics));
    assert.ok(decisionEventEnabled(config, at, resume));
  }
});

test("a row parked on a wall this machine no longer has cannot be replayed", () => {
  const wall = walls[5];
  assert.ok(wall !== undefined);
  assert.ok(replayableDecision(wall));
  assert.ok(
    !replayableDecision({
      event: wall.event,
      rec: { ...wall.rec, label: "ticket-escalated gas_exhausted" },
    }),
  );
  assert.ok(
    !storedJournalLegalOn(config, [
      {
        entry: {
          ...wall,
          rec: { ...wall.rec, label: "ticket-escalated gas_exhausted" },
        },
        semantics: 1,
      },
    ]),
  );
});
