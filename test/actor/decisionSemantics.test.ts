/**
 * The rework wall's history under the machine that decided it, on bytes this
 * tree can no longer produce.
 *
 * THE FIXTURE IS PINNED AND NOT GENERATED. The golden traces are emitted by the
 * same tree that replays them, so a semantics change moves both sides at once
 * and no trace can witness one. `journalAtSemanticsOne.json` was written by the
 * deciders at 919c7b6, driven release → dispatch → work → a failed stage →
 * rework → a second failed stage → the exhausted-rework wall → resume, and it
 * is the only record here of what that machine decided.
 *
 * WHAT THE FIXTURE PINS is the resume the wall stamped: the first semantics
 * parked at the eval resume and resumed into evaluation, and the current one
 * parks at a rework resume and resumes into work. So the wall's own record is
 * the same either way and the resume's record is not, which is why legality
 * turns on the row's declared semantics rather than on its bytes.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  journalLegalOn,
  storedJournalLegalOn,
  storedReplayCore,
  type Entry,
  type StoredEntry,
} from "../../src/actor/journal.ts";
import { decisionSemanticsVersionCurrent } from "../../src/actor/decisionSemantics.ts";
import { ticketAt } from "../../src/domain/core.ts";
import { id } from "../domain/fixtures.ts";
import { parseJournal } from "../../src/interpreter/wire.ts";
import { refinementInstance } from "./harness.ts";

const config = refinementInstance;

/** The pinned history, parsed by the same wire schema a store's load parses it with. */
function journalAtSemanticsOne(): readonly Entry[] {
  const raw: unknown = JSON.parse(
    readFileSync(
      join(import.meta.dirname, "journalAtSemanticsOne.json"),
      "utf8",
    ),
  );
  const parsed = parseJournal(raw);
  assert.ok(parsed.parsed === "Ok", "the pinned history no longer parses");
  return parsed.value;
}

/** The pinned history as a store holding it would present it, every row at one semantics. */
function storedAt(semantics: 1 | 2): readonly StoredEntry[] {
  return journalAtSemanticsOne().map((entry) => ({ entry, semantics }));
}

test("the pinned history walks the rework wall and resumes past it", () => {
  const entries = journalAtSemanticsOne();
  const walls = entries.filter(
    (entry) => entry.rec.label === "ticket-escalated rework_budget_exhausted",
  );
  const resumes = entries.filter(
    (entry) => entry.event.type === "ResumeTicket",
  );
  assert.equal(walls.length, 1);
  assert.equal(resumes.length, 1);
  assert.deepEqual(resumes[0]?.rec.effects, ["SpawnEvalTasks"]);
});

test("the pinned history is legal under the semantics its rows declare", () => {
  assert.ok(storedJournalLegalOn(config, storedAt(1)));
});

test("the same history read as this image's own decisions is not legal", () => {
  assert.ok(!storedJournalLegalOn(config, storedAt(2)));
  assert.ok(!journalLegalOn(config, journalAtSemanticsOne()));
});

test("replay under the first semantics parks the wall at the eval resume", () => {
  const replayed = storedReplayCore(config, storedAt(1));
  assert.equal(ticketAt(replayed, id(1)).phase, "Evaluating");
  assert.equal(ticketAt(replayed, id(1)).resumeAt, "NoResume");
});

test("a row decided under an older machine than the row before it is refused", () => {
  const entries = journalAtSemanticsOne();
  const descending = entries.map((entry, at) => ({
    entry,
    semantics: at === 0 ? decisionSemanticsVersionCurrent : 1,
  }));
  assert.ok(!storedJournalLegalOn(config, descending));
});
