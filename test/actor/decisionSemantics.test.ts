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
 * is one budgeted ticket, walled and resumed, where the first semantics resumed
 * into evaluation and the current one resumes into work — a record divergence.
 * `journalAtSemanticsOneWalls.json` carries a ticket that bought no rework at
 * all, whose wall the current machine leaves with no resume so the journaled
 * resume is not even enabled, and a ticket that bought a free resume, which the
 * first semantics charged nothing for and the current one charges a gas.
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
import { decisionSemanticsVersionCurrent } from "../../src/actor/decisionSemantics.ts";
import { ticketAt } from "../../src/domain/core.ts";
import { modeledResumeExists } from "../../src/domain/ticket.ts";
import { id } from "../domain/fixtures.ts";
import { parseJournal } from "../../src/interpreter/wire.ts";
import { refinementInstance } from "./harness.ts";

const config = refinementInstance;

/** One pinned history, parsed by the same wire schema a store's load parses it with. */
function pinned(file: string): readonly Entry[] {
  const raw: unknown = JSON.parse(
    readFileSync(join(import.meta.dirname, file), "utf8"),
  );
  const parsed = parseJournal(raw);
  assert.ok(parsed.parsed === "Ok", `${file} no longer parses`);
  return parsed.value;
}

/** A pinned history as a store holding it would present it, every row at one semantics. */
function storedAt(
  entries: readonly Entry[],
  semantics: 1 | 2,
): readonly StoredEntry[] {
  return entries.map((entry) => ({ entry, semantics }));
}

const budgetedWall = pinned("journalAtSemanticsOne.json");
const walls = pinned("journalAtSemanticsOneWalls.json");

test("the budgeted history walks the rework wall and resumes past it", () => {
  const walled = budgetedWall.filter(
    (entry) => entry.rec.label === "ticket-escalated rework_budget_exhausted",
  );
  const resumes = budgetedWall.filter(
    (entry) => entry.event.type === "ResumeTicket",
  );
  assert.equal(walled.length, 1);
  assert.equal(resumes.length, 1);
  assert.deepEqual(resumes[0]?.rec.effects, ["SpawnEvalTasks"]);
});

test("the budgeted history is legal under the semantics its rows declare", () => {
  assert.ok(storedJournalLegalOn(config, storedAt(budgetedWall, 1)));
});

test("the same history read as this image's own decisions is not legal", () => {
  assert.ok(!storedJournalLegalOn(config, storedAt(budgetedWall, 2)));
  assert.ok(!journalLegalOn(config, budgetedWall));
});

test("replay under the first semantics parks the wall at the eval resume", () => {
  const replayed = storedReplayCore(config, storedAt(budgetedWall, 1));
  assert.equal(ticketAt(replayed, id(1)).phase, "Evaluating");
  assert.equal(ticketAt(replayed, id(1)).resumeAt, "NoResume");
});

test("a row decided under an older machine than the row before it is refused", () => {
  const descending = budgetedWall.map((entry, at) => ({
    entry,
    semantics: at === 0 ? decisionSemanticsVersionCurrent : 1,
  }));
  assert.ok(!storedJournalLegalOn(config, descending));
});

test("the two-wall history authors a ticket with no rework and a ticket resuming free", () => {
  const released = walls.filter(
    (entry) => entry.event.type === "ReleaseTicket",
  );
  assert.deepEqual(
    released.map((entry) =>
      entry.event.type === "ReleaseTicket"
        ? [
            entry.event.value.reworkPolicy.value,
            entry.event.value.resumePricing,
          ]
        : undefined,
    ),
    [
      [0, "RetryCharged"],
      [1, "RetryFree"],
    ],
  );
});

test("both walls are legal under the semantics their rows declare, and neither under this image's", () => {
  assert.ok(storedJournalLegalOn(config, storedAt(walls, 1)));
  assert.ok(!storedJournalLegalOn(config, storedAt(walls, 2)));
});

test("the wall of a ticket that bought no rework leaves this image no resume to enable", () => {
  const resume = resumeTicketEvent(id(1));
  const toTheWall = walls.slice(0, 6);
  assert.equal(toTheWall.at(-1)?.event.type, "EvalReduce");

  const atOne = storedReplayCore(config, storedAt(toTheWall, 1));
  assert.equal(ticketAt(atOne, id(1)).resumeAt, "ResumeEvaluating");
  assert.ok(decisionEventEnabled(config, atOne, resume));

  const atCurrent = storedReplayCore(config, storedAt(toTheWall, 2));
  assert.equal(ticketAt(atCurrent, id(1)).resumeAt, "NoResume");
  assert.ok(!decisionEventEnabled(config, atCurrent, resume));
});

test("a free resume the first semantics charged nothing for stays uncharged on replay", () => {
  const replayed = storedReplayCore(config, storedAt(walls, 1));
  const two = ticketAt(replayed, id(2));
  assert.equal(two.phase, "Evaluating");
  assert.equal(two.gasLeft, 1);
  assert.equal(two.resumePricing, "RetryFree");
});

test("the resume the older machine granted is one this machine's desk would not model", () => {
  const one = ticketAt(
    storedReplayCore(config, storedAt(walls.slice(0, 6), 1)),
    id(1),
  );
  assert.equal(one.resumeAt, "ResumeEvaluating");
  assert.equal(modeledResumeExists(one), false);
});
