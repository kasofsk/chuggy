/**
 * The journal machinery on hand-built histories, mirroring the model's
 * refinement unit suite: replay, legality, the tampered-journal refusals, and
 * the world-count arithmetic on concrete data.
 *
 * The three-decision history is built by the deciders themselves — arrive,
 * release, dispatch, records taken from the decisions — so it is the journal
 * an honest actor would write, and every refusal case below is that history
 * with exactly one thing forged.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  cmdEnabled,
  execCmd,
  jArrive,
  jDispatch,
  jGateResolve,
  jOpRetry,
  jRelease,
  jTaskDone,
} from "../../src/actor/command.ts";
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
import { ticketAt } from "../../src/domain/core.ts";
import { asProjectId, asTaskId } from "../../src/domain/ids.ts";
import { wExclusive } from "../../src/domain/wrapUp.ts";
import { id } from "../domain/fixtures.ts";
import { flatProgram, refinementInstance } from "./harness.ts";

const config = refinementInstance;

const cmd1 = jArrive([], flatProgram, asProjectId(1), wExclusive(1));
const d1 = execCmd(config, genesis, cmd1);
const e1: Entry = { seq: 1, cmd: cmd1, rec: d1.rec };
const cmd2 = jRelease(id(1));
const d2 = execCmd(config, d1.post, cmd2);
const e2: Entry = { seq: 2, cmd: cmd2, rec: d2.rec };
const cmd3 = jDispatch(id(1));
const d3 = execCmd(config, d2.post, cmd3);
const e3: Entry = { seq: 3, cmd: cmd3, rec: d3.rec };
const goodJournal: readonly Entry[] = [e1, e2, e3];

test("the empty journal is legal and replays to genesis", () => {
  assert.ok(journalLegalOn(config, []));
  assert.ok(coreEquals(replayCore(config, []), genesis));
});

test("an honest history is legal, and replay reconstructs what the deciders built", () => {
  assert.ok(journalLegalOn(config, goodJournal));
  const replayed = replayCore(config, goodJournal);
  assert.ok(coreEquals(replayed, d3.post));
  assert.equal(ticketAt(replayed, id(1)).phase, "PWorking");
  assert.equal(ticketAt(replayed, id(1)).gasLeft, 2);
});

test("replaying one more entry equals stepping the shorter replay once", () => {
  assert.ok(
    coreEquals(
      replayCore(config, goodJournal),
      execCmd(config, replayCore(config, [e1, e2]), cmd3).post,
    ),
  );
  assert.ok(
    coreEquals(
      replayCore(config, [e1, e2]),
      execCmd(config, replayCore(config, [e1]), cmd2).post,
    ),
  );
});

test("a sequence gap or a duplicate seq is refused", () => {
  assert.ok(!journalLegalOn(config, [{ ...e1, seq: 2 }]));
  assert.ok(!journalLegalOn(config, [e1, { ...e2, seq: 3 }]));
  assert.ok(!journalLegalOn(config, [e1, { ...e2, seq: 1 }]));
});

test("a decision that was never enabled is refused, cleanly, at any tampered payload", () => {
  assert.ok(!cmdEnabled(config, genesis, cmd2));
  assert.ok(!journalLegalOn(config, [{ ...e2, seq: 1 }]));
  assert.ok(
    !cmdEnabled(config, genesis, jTaskDone(id(1), asTaskId(1), "VPass")),
  );
  assert.ok(!cmdEnabled(config, genesis, jDispatch(id(1))));
  assert.ok(!cmdEnabled(config, genesis, jGateResolve(id(1), "WOk")));
  assert.ok(!cmdEnabled(config, genesis, jOpRetry(id(1))));
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
  const phantom = jArrive([], flatProgram, asProjectId(1), wExclusive(99));
  const phantomEntry: Entry = {
    seq: 1,
    cmd: phantom,
    rec: execCmd(config, genesis, phantom).rec,
  };
  assert.ok(!cmdEnabled(config, genesis, phantom));
  assert.ok(!journalLegalOn(config, [phantomEntry]));
  assert.ok(
    !cmdEnabled(
      config,
      genesis,
      jArrive([], flatProgram, asProjectId(1), wExclusive(2)),
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
  const real = execCmd(config, d3.post, jTaskDone(id(1), asTaskId(1), "VPass"));
  const duplicate = execCmd(
    config,
    real.post,
    jTaskDone(id(1), asTaskId(1), "VFail"),
  );
  const e4: Entry = {
    seq: 4,
    cmd: jTaskDone(id(1), asTaskId(1), "VPass"),
    rec: real.rec,
  };
  const e5: Entry = {
    seq: 5,
    cmd: jTaskDone(id(1), asTaskId(1), "VFail"),
    rec: duplicate.rec,
  };
  assert.equal(duplicate.rec.label, "task-done-duplicate");
  assert.ok(coreEquals(duplicate.post, real.post));
  assert.ok(journalLegalOn(config, [e1, e2, e3, e4, e5]));
  assert.ok(coreEquals(replayCore(config, [e1, e2, e3, e4, e5]), real.post));
});
