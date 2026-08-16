/**
 * The journaled actor's ACTIONS, one at a time: what each moves, what each
 * leaves exactly where it was, and what each refuses.
 *
 * THE CRASH-SEAM SUITE IS NEXT DOOR AND ASKS A DIFFERENT QUESTION. That file
 * walks the model's runs and asserts the theorems across whole traces; this one
 * pins the actions themselves, because a trace can stay green while an action
 * moves something it had no business moving — the ghosts across an emission are
 * the standing example, and a suite that only ever looked at fleets would never
 * see it.
 *
 * WHAT IS PINNED HERE THAT THE MODEL GETS FROM ITS EVALUATOR. Quint requires
 * every action to assign every var, so "this action does not move that var" is
 * written down in the model and unmissable. TypeScript's spread says the same
 * thing by omission, which is exactly as easy to get wrong as it is to read —
 * so each action's untouched vars are asserted rather than trusted.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { AssertionError } from "../domain/assert.ts";

import { createInMemoryJournalStore } from "../adapters/in-memory-journal-store.ts";
import {
  actorInit,
  commit,
  crashRecoverTo,
  effectCrash,
  emitNext,
  journalStep,
  recoverFrom,
  type ActorState,
  type DurableState,
} from "./actor.ts";
import type { Cmd } from "./cmd.ts";
import type { JournalStore } from "./journal-store.ts";
import { replayCore } from "./journal.ts";
import { recoveryComplete } from "./refinement-invariants.ts";
import { initStepRecord, initialState } from "./machine.ts";
import type { Entry } from "./entry.ts";
import {
  cfgRefinement,
  arrive,
  e1,
  expectSteady,
  dispatch,
  must,
  memTicket,
  release,
} from "./refinement-fixtures.test.ts";

const cfg = cfgRefinement;

/** The empty world every fresh recovery inherits. */
const noWorld = { worldEffects: new Set<number>(), orphans: [] };

/**
 * Commit these decisions in order, then emit `emitted` of the rows.
 *
 * It goes through `commit` rather than `journalStep` because everything past
 * the journal takes a `DurableState`, which is the point of the type: a helper
 * that wanted to emit from a decided-but-unstored state could not be written.
 * The store it opens is the one the durability tests below read back.
 */
function drive(
  cmds: readonly Cmd[],
  emitted: number,
): { store: JournalStore; s: DurableState } {
  const store = createInMemoryJournalStore();
  let s = actorInit(cfg);
  for (const cmd of cmds) {
    s = must(commit(cfg, store, s, cmd), `commit ${cmd.tag}`);
  }
  for (let i = 0; i < emitted; i += 1) {
    s = must(emitNext(s), "emitNext");
  }
  return { store, s };
}

/** Arrive, release, dispatch — three rows, `emitted` of them emitted. */
function walked(emitted: number): DurableState {
  return drive([arrive, release, dispatch], emitted).s;
}

/** Arrive and release only, so the dispatch is still the next decision. */
function released(emitted: number): DurableState {
  return drive([arrive, release], emitted).s;
}

test("actorInit: the model's rinit, var for var", () => {
  const s = actorInit(cfg);
  assert.deepEqual(s.mem, initialState(cfg));
  assert.deepEqual(s.journal, []);
  assert.equal(s.applied, 0);
  assert.deepEqual(s.worldEffects, new Set());
  assert.deepEqual(s.orphans, []);
  assert.equal(s.rlabel, "init");
  assert.deepEqual(s.mem.lastStep, initStepRecord);
});

test("journalStep: appends with the next dense seq and takes a real domain step", () => {
  const s = must(journalStep(cfg, actorInit(cfg), arrive), "arrive");
  assert.equal(s.journal.length, 1);
  const row = s.journal[0];
  assert.ok(row !== undefined);
  assert.equal(row.seq, 1);
  assert.deepEqual(row.cmd, arrive);
  assert.deepEqual(row.rec, s.mem.lastStep);
  assert.equal(s.rlabel, "actor-step");
  // A REAL domain step: the ghosts snapshot the state being left.
  assert.equal(s.mem.prevMeasure, 0);
  assert.deepEqual(s.mem.prevRecords, new Map());
  assert.equal(memTicket(s, 1).phase, "PDraft");

  const two = must(journalStep(cfg, s, release), "release");
  assert.equal(two.journal[1]?.seq, 2);
  assert.notEqual(two.mem.prevMeasure, 0);
});

test("journalStep: nothing reaches the world — the cursor and the ledger do not move", () => {
  const before = released(1);
  const after = must(journalStep(cfg, before, dispatch), "dispatch");
  assert.equal(after.applied, before.applied);
  assert.deepEqual(after.worldEffects, before.worldEffects);
  assert.deepEqual(after.orphans, before.orphans);
  // The row is journaled and unemitted, which is the whole of
  // journal-before-effect: there is no path from this function to the world.
  assert.ok(after.applied < after.journal.length);
});

test("journalStep: a decision the machine refuses is ANSWERED, never thrown at", () => {
  const s = actorInit(cfg);
  // Release at genesis: no ticket exists. The deciders assume their guards, so
  // this is precisely the call that would throw if enablement were checked
  // second.
  assert.equal(journalStep(cfg, s, release), undefined);
  assert.equal(journalStep(cfg, s, { tag: "JDispatch", ticket: 1 }), undefined);
  assert.equal(journalStep(cfg, s, { tag: "JOpRetry", ticket: 9 }), undefined);
});

test("the durability token: emitting from a decided-but-unstored state does not compile", () => {
  const decided = must(
    journalStep(cfg, actorInit(cfg), arrive),
    "the decision",
  );

  // @ts-expect-error emitNext takes a DurableState and journalStep does not
  // return one, so journal-before-effect is a property of the type rather than
  // of a sentence. THIS DIRECTIVE IS THE RED PROOF: if the token ever stopped
  // discriminating, tsc reports the directive as unused and the types stage
  // goes red — the check runs on every gate rather than in a mutation script.
  const emitted = emitNext(decided);

  // And the runtime cannot tell, which is why the compiler has to: the brand is
  // a phantom, so the call the type refuses would have emitted quite happily.
  assert.ok(emitted !== undefined);
  assert.equal(emitted.applied, 1);
});

test("emitNext: advances the cursor, and is refused once the cursor has caught up", () => {
  assert.equal(emitNext(actorInit(cfg)), undefined, "an empty journal");
  const caughtUp = walked(3);
  assert.equal(caughtUp.applied, 3);
  assert.equal(emitNext(caughtUp), undefined, "a cursor at the journal's end");

  const one = must(emitNext(walked(0)), "the first emission");
  assert.equal(one.applied, 1);
  assert.deepEqual(one.worldEffects, new Set([1]));
  assert.equal(one.rlabel, "emit");
});

test("emitNext: NOT a domain step — the fleet, the record and both ghosts stay put", () => {
  const before = walked(0);
  const after = must(emitNext(before), "emitNext");
  // installCore is identity here, and that identity IS the claim. A seam that
  // re-snapshotted the ghosts would present an emission as a flat domain step,
  // which `stepDescends` could then never falsify.
  assert.deepEqual(after.mem, before.mem);
  assert.deepEqual(after.mem.lastStep, before.mem.lastStep);
  assert.equal(after.mem.prevMeasure, before.mem.prevMeasure);
  assert.deepEqual(after.mem.prevRecords, before.mem.prevRecords);
  assert.deepEqual(after.journal, before.journal);
});

test("emitNext: a re-emission is absorbed — the same seq, the same decision", () => {
  const emitted = walked(3);
  assert.equal(emitted.worldEffects.size, 3);
  const crashed = must(crashRecoverTo(cfg, emitted, 0), "total cursor loss");
  const again = must(emitNext(crashed), "the re-emission");
  assert.equal(again.applied, 1);
  // The set did not grow: the world cannot be made to act twice on one
  // decision, only once each on distinct ones.
  assert.equal(again.worldEffects.size, 3);
  assert.deepEqual(again.worldEffects, emitted.worldEffects);
});

test("crashRecoverTo: installs the replay, keeps the journal, and refuses an incoherent cursor", () => {
  const before = walked(2);
  const after = must(crashRecoverTo(cfg, before, 1), "crash");
  assert.deepEqual(after.mem.core, replayCore(cfg, before.journal));
  assert.deepEqual(after.journal, before.journal);
  assert.equal(after.applied, 1);
  assert.deepEqual(after.worldEffects, before.worldEffects);
  assert.equal(after.rlabel, "crash-recover");
  // NOT a domain step either: the ghosts and the last record stay stale.
  assert.equal(after.mem.prevMeasure, before.mem.prevMeasure);
  assert.deepEqual(after.mem.lastStep, before.mem.lastStep);

  // Both ends, and the ends are the interesting values: a cursor at zero is
  // "the checkpoint was never written" and a cursor at `applied` is "the
  // checkpoint was current". Past either is not a crash, it is a caller error.
  assert.ok(crashRecoverTo(cfg, before, 0) !== undefined);
  assert.ok(crashRecoverTo(cfg, before, 2) !== undefined);
  assert.equal(crashRecoverTo(cfg, before, 3), undefined);
  assert.equal(crashRecoverTo(cfg, before, -1), undefined);
  assert.equal(crashRecoverTo(cfg, before, 1.5), undefined);
});

test("crashRecoverTo: recovery is BY REPLAY, which is only visible when memory and journal disagree", () => {
  // Under the discipline the two are the same state — `recoveryComplete` says
  // so — which means no disciplined trace can tell "replay the journal" from
  // "keep whatever was in memory". A crash that kept memory would pass every
  // run in this slice and lose everything on the day the two differ, so the
  // difference is put on the table here: an actor whose memory has drifted from
  // its journal must come back from the JOURNAL.
  const live = walked(2);
  // The cast is the whole fixture: a state whose memory has drifted from its
  // journal is one the actor cannot produce, and the brand says nothing about
  // memory — only about the log having been stored.
  const memoryLost: ActorState = {
    ...live,
    mem: { ...live.mem, core: { tickets: new Map() } },
  };
  const drifted = memoryLost as DurableState;
  assert.equal(recoveryComplete(cfg, drifted), false, "the premise");

  const recovered = must(crashRecoverTo(cfg, drifted, 0), "crash");
  assert.ok(recoveryComplete(cfg, recovered), "recovery repaired the drift");
  assert.deepEqual(recovered.mem.core, replayCore(cfg, live.journal));
  assert.deepEqual(recovered.mem.core, live.mem.core);
});

test("effectCrash: the world keeps an un-keyed orphan and the journal never learns", () => {
  const before = released(2);
  const after = must(effectCrash(cfg, before, dispatch), "the hazard seam");
  assert.equal(after.orphans.length, 1);
  assert.deepEqual(after.journal, before.journal);
  assert.deepEqual(after.worldEffects, before.worldEffects);
  assert.equal(after.applied, before.applied);
  assert.equal(after.rlabel, "effect-crash-recover");
  // Memory is the replay of a journal that never saw the decision: the
  // pre-decision state, with the charge un-taken.
  assert.deepEqual(after.mem.core, replayCore(cfg, before.journal));
  assert.equal(memTicket(after, 1).phase, "PPending");
  assert.equal(memTicket(after, 1).gasLeft, 3);
  // ...and the orphan is the record of the decision the world DID act on.
  assert.equal(after.orphans[0]?.label, "dispatch");

  // It refuses a decision the machine refuses, exactly as `journalStep` does:
  // the hazard is a crash at a seam, not a licence to decide the impossible.
  assert.equal(effectCrash(cfg, actorInit(cfg), release), undefined);
});

test("commit: the row is durable before the state that can emit it exists", () => {
  const store = createInMemoryJournalStore();
  let s = actorInit(cfg);
  for (const cmd of [arrive, release, dispatch]) {
    s = must(commit(cfg, store, s, cmd), `commit ${cmd.tag}`);
    // Every state `commit` hands back has its whole journal durable — which is
    // what "nothing may be emitted for a decision that is not yet durable"
    // means when the executor can only emit from a state it was handed.
    assert.equal(store.length(), s.journal.length);
  }
  assert.deepEqual(store.readAll(), s.journal);
  assert.equal(s.applied, 0, "committing emits nothing");
});

test("commit: a refused decision never reaches the store", () => {
  const store = createInMemoryJournalStore();
  const s = actorInit(cfg);
  assert.equal(commit(cfg, store, s, release), undefined);
  assert.equal(store.length(), 0);
});

test("commit: an append that fails loses the decision and nothing else", () => {
  const failing: JournalStore = {
    append(): void {
      throw new Error("the medium is unwritable");
    },
    readAll: () => [],
    length: () => 0,
  };
  const before = actorInit(cfg);
  assert.throws(() => commit(cfg, failing, before, arrive), /unwritable/);
  // The caller still holds the state it had: nothing was emitted, no ticket
  // arrived, and the decision may simply be re-decided from a state that never
  // moved. That is what journal-before-effect buys at this seam.
  assert.deepEqual(before, actorInit(cfg));
});

test("commit: a lost acknowledgement leaves the store ahead, and recovery believes the store", () => {
  const { store, s } = drive([arrive, release], 2);

  // The append succeeded and its acknowledgement was lost — the port says this
  // is a way an append may fail, so the actor is entitled to no other story.
  // Simulated exactly: the row the actor would have written IS durable, and the
  // actor still holds the state it had before deciding.
  const decided = must(journalStep(cfg, s, dispatch), "the lost decision");
  const row = decided.journal[decided.journal.length - 1];
  assert.ok(row !== undefined);
  store.append(row);
  assert.equal(s.journal.length, 2);
  assert.equal(store.length(), 3);

  // The actor, believing the decision lost, re-decides it — and the store's
  // fence is what tells it otherwise, on the seq the log already holds.
  assert.throws(() => commit(cfg, store, s, dispatch), AssertionError);

  // Recovery reads the store and BELIEVES IT, which is the promise `actor.ts`
  // makes about this disagreement: the row is in the log, so the decision
  // happened; nothing was emitted for it, so the cursor is where the actor left
  // it and the row goes out for the first time.
  const recovered = must(
    recoverFrom(cfg, store.readAll(), s.applied, {
      worldEffects: s.worldEffects,
      orphans: s.orphans,
    }),
    "recovery from the store the actor fell behind",
  );
  assert.equal(recovered.journal.length, 3);
  assert.equal(recovered.applied, 2);
  assert.equal(memTicket(recovered, 1).phase, "PWorking");
  assert.ok(recoveryComplete(cfg, recovered));
  expectSteady(recovered);
});

test("commit: a store written by somebody else is caught where the fence cannot see it", () => {
  // A store with no fence — every other promise kept. It stands for the case
  // the fence structurally cannot catch: a second writer whose rows were
  // accepted IN ORDER, so no seq ever collided.
  const rows: Entry[] = [];
  const unfenced: JournalStore = {
    append(entry: Entry): void {
      rows.push(entry);
    },
    readAll: () => [...rows],
    length: () => rows.length,
  };
  rows.push({ ...e1, seq: 1 });

  // The actor writes its own first row. Nothing throws inside the store, and
  // one row's worth of somebody else's decisions is now in the log.
  assert.throws(
    () => commit(cfg, unfenced, actorInit(cfg), arrive),
    AssertionError,
  );
});

test("recoverFrom: a process that kept nothing rebuilds all four machine vars", () => {
  const store = createInMemoryJournalStore();
  let live = actorInit(cfg);
  for (const cmd of [arrive, release, dispatch]) {
    live = must(commit(cfg, store, live, cmd), "commit");
  }
  live = must(emitNext(live), "emitNext");
  live = must(emitNext(live), "emitNext");

  const recovered = must(
    recoverFrom(cfg, store.readAll(), live.applied, {
      worldEffects: live.worldEffects,
      orphans: live.orphans,
    }),
    "recovery from the store alone",
  );
  // Every var, not just the fleet: the last record and both ghosts are what a
  // real crash loses and what the model's crash action keeps by fiat.
  assert.deepEqual(recovered.mem, live.mem);
  assert.deepEqual(recovered.journal, live.journal);
  assert.equal(recovered.applied, live.applied);
  assert.deepEqual(recovered.worldEffects, live.worldEffects);
});

test("recoverFrom: an unreadable log is REFUSED, because a recovering process is the wrong place to throw", () => {
  const store = createInMemoryJournalStore();
  let live = actorInit(cfg);
  for (const cmd of [arrive, release, dispatch]) {
    live = must(commit(cfg, store, live, cmd), "commit");
  }
  const rows = store.readAll();
  const [first, second] = live.journal;
  assert.ok(first !== undefined && second !== undefined);

  assert.equal(
    recoverFrom(cfg, [...rows, { seq: 4, cmd: "nonsense" }], 0, noWorld),
    undefined,
    "a row that is not a row",
  );
  assert.equal(
    recoverFrom(cfg, [{ ...second, seq: 1 }], 0, noWorld),
    undefined,
    "a log whose first row was never enabled at genesis",
  );
  assert.equal(
    recoverFrom(cfg, [first, { ...second, seq: 3 }], 0, noWorld),
    undefined,
    "a sequence gap",
  );
  assert.equal(
    recoverFrom(cfg, rows, rows.length + 1, noWorld),
    undefined,
    "a cursor past the log",
  );
  assert.equal(
    recoverFrom(cfg, rows, -1, noWorld),
    undefined,
    "a cursor below zero",
  );
  // ...and the honest log at both ends of the cursor range still recovers, so
  // the refusals above are attributable to the tampering.
  assert.ok(recoverFrom(cfg, rows, 0, noWorld) !== undefined);
  assert.ok(recoverFrom(cfg, rows, rows.length, noWorld) !== undefined);
});

test("recoverFrom: the durable rebuild lands where the model's crash action lands", () => {
  const store = createInMemoryJournalStore();
  let live = actorInit(cfg);
  for (const cmd of [arrive, release, dispatch]) {
    live = must(commit(cfg, store, live, cmd), "commit");
  }
  live = must(emitNext(live), "emitNext");

  const modelWay = must(crashRecoverTo(cfg, live, 0), "crashRecoverTo(0)");
  const durableWay = must(
    recoverFrom(cfg, store.readAll(), 0, {
      worldEffects: live.worldEffects,
      orphans: live.orphans,
    }),
    "recoverFrom(store, 0)",
  );
  // The model's crash keeps `lastStep` and both ghosts because a crash cannot
  // move them; the durable rebuild recomputes them from rows. That the two
  // agree is what makes the model's shortcut sound for a real process.
  assert.deepEqual(durableWay, { ...modelWay, rlabel: "crash-recover" });
});
