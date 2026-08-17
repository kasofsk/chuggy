/**
 * The acceptance walk: one scripted ticket driven from arrival to done
 * through the real loop — boot, then the drive over the SQLite journal and
 * the stub world — with the environment's draws the only submissions and
 * every internal step arising as a follow-up.
 *
 * The evidence is read where a deployment would read it: the store's own
 * journal, replayed clean, and the boards holding what doc-per-effect routing
 * says. The wake capability throws, so a drain failure the walk should never
 * see cannot book a silent retry and pass.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { journalLegalOn, replayCore } from "../../src/actor/journal.ts";
import { deskStub } from "../../src/adapters/deskStub.ts";
import { fabricStub } from "../../src/adapters/fabricStub.ts";
import { sqliteJournal } from "../../src/adapters/sqliteJournal.ts";
import { wrapUpStub } from "../../src/adapters/wrapUpStub.ts";
import { ticketAt } from "../../src/domain/core.ts";
import { asProjectId, asTaskId } from "../../src/domain/ids.ts";
import { wExclusive } from "../../src/domain/wrapUp.ts";
import type { Executor } from "../../src/interpreter/executor.ts";
import { boot } from "../../src/runtime/boot.ts";
import { drive, type WakeAfter } from "../../src/runtime/drive.ts";
import { flatProgram, refinementInstance } from "../actor/harness.ts";
import { id } from "../domain/fixtures.ts";

const config = refinementInstance;

const wakeRefused: WakeAfter = () => {
  throw new Error("the walk booked a retry, so a drain failed under it");
};

test("one ticket reaches done through the inbound face, every internal step a follow-up", async () => {
  const dir = mkdtempSync(join(tmpdir(), "chuggy-runtime-"));
  try {
    const desk = deskStub();
    const fabric = fabricStub();
    const wrapUp = wrapUpStub();
    const store = sqliteJournal(new DatabaseSync(join(dir, "journal.sqlite")));
    const executor: Executor = {
      config,
      store,
      ports: { fabric, desk, wrapUp },
    };
    const inbound = drive(executor, wakeRefused, await boot(executor));

    const answers = [
      await inbound.arrive([], flatProgram, asProjectId(1), wExclusive(1)),
      await inbound.release(id(1)),
      await inbound.taskDone(id(1), asTaskId(1), "VPass"),
      await inbound.taskDone(id(1), asTaskId(2), "VPass"),
      await inbound.gateOutcome(id(1), "WOk"),
    ];
    assert.deepEqual(
      answers,
      [1, 2, 4, 6, 9].map((seq) => ({ submitted: "Accepted", seq })),
    );

    const loaded = await store.load();
    assert.ok(loaded.parsed === "Ok", "the stored journal did not parse back");
    assert.ok(
      journalLegalOn(config, loaded.value),
      "the stored journal does not replay clean",
    );
    assert.deepEqual(
      loaded.value.map((entry) => entry.rec.label),
      [
        "ticket-arrived",
        "ticket-released",
        "dispatch",
        "task-done",
        "work-passed",
        "task-done",
        "eval-passed",
        "wrapup-started",
        "ticket-done",
      ],
    );
    assert.equal(
      ticketAt(replayCore(config, loaded.value), id(1)).phase,
      "PDone",
    );
    assert.equal(await store.loadCursor(), loaded.value.length);

    assert.deepEqual(
      [...desk.board.values()].map((row) => row.effect),
      ["CreateDraft", "Complete"],
    );
    assert.deepEqual(
      [...wrapUp.held.values()].map((note) => note.effect),
      ["EnqueueWrapUp", "OpenGate"],
    );
    assert.deepEqual(
      [...fabric.running.values()].map((launch) => launch.set),
      ["Work", "Eval"],
    );
    assert.equal(fabric.withdrawn.size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
