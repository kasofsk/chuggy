/**
 * The seven refinement invariants, each shown GREEN on a state the actor can
 * reach and RED on a state carrying the defect it names.
 *
 * A GREEN SUITE IS EVIDENCE ONLY ONCE IT HAS BEEN MADE RED. Every invariant
 * below gets a state built to break exactly the conjunct it claims to guard —
 * built by hand, because the actor's actions cannot produce most of them, which
 * is the whole reason to check by state predicate rather than by construction
 * argument. A defect that the machine cannot currently reach is exactly the
 * defect a mutant actor would reach first.
 *
 * AND THE BUNDLES ARE CHECKED AS SETS, not sampled. Each defective state is run
 * through the full bundle, so "the bundle catches this" is asserted for every
 * conjunct rather than for the ones that happened to be tried — and the split
 * between the two bundles is asserted in both directions, because the hazard
 * runs stand on `refinementCore` staying GREEN while the world-facing half
 * falls. A `refinementCore` that quietly included `journalCoversWorld` would
 * make every hazard run's argument unfalsifiable.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { StepRecord } from "../domain/measure.ts";
import type { ActorState } from "./actor.ts";
import type { Entry } from "./entry.ts";
import { genesis } from "./journal.ts";
import {
  executorSound,
  journalCompletionsMatchLedger,
  journalCoversWorld,
  journalLegal,
  noDoubleSpentBudget,
  noDuplicateCycle,
  recoveryComplete,
  refinementCore,
  refinementInvariants,
} from "./refinement-invariants.ts";
import {
  arrive,
  cfgRefinement,
  dispatch,
  driveEmitted,
  landingWalk,
  release,
} from "./refinement-fixtures.test.ts";

const cfg = cfgRefinement;

/** Arrive, release, dispatch — all three emitted. The world is level with the book. */
const honest: ActorState = driveEmitted([arrive, release, dispatch]);

/** The same ticket walked all the way to a landing, and a stale confirmation absorbed. */
const settled: ActorState = driveEmitted(landingWalk);

/** The dispatch's record: a paid task fan-out, attributable to ticket 1. */
const spawnRec: StepRecord = recordLabelled(honest, "dispatch");

/** The landing's record: the emission that merges the diff. */
const completionRec: StepRecord = recordLabelled(settled, "ticket-done");

function recordLabelled(s: ActorState, label: string): StepRecord {
  const row = s.journal.find((entry) => entry.rec.label === label);
  assert.ok(row !== undefined, `no ${label} row in the walk`);
  return row.rec;
}

/**
 * Every defective state, and the one invariant each is built to break. The
 * roster is the file's subject: each row is a red proof, and the sweep at the
 * bottom runs all of them through the whole bundle.
 */
const defects: readonly (readonly [
  string,
  ActorState,
  (s: ActorState) => boolean,
])[] = [
  [
    // A row whose record is not what the decider at that prefix produces. The
    // journal claims a completion the machine never decided.
    "journalLegal: a forged record",
    withJournal(honest, (rows) =>
      rows.map((row, i) =>
        i === 2 ? { ...row, rec: { ...row.rec, label: "ticket-done" } } : row,
      ),
    ),
    (s) => journalLegal(cfg, s),
  ],
  [
    // The seqs stop being dense: no replay can index this log.
    "journalLegal: a sequence gap",
    withJournal(honest, (rows) =>
      rows.map((row, i) => (i === 2 ? { ...row, seq: 9 } : row)),
    ),
    (s) => journalLegal(cfg, s),
  ],
  [
    // Memory that the journal cannot account for: recovery would land somewhere
    // else, which is the one thing a journaled actor may not survive.
    "recoveryComplete: memory the replay does not reproduce",
    { ...honest, mem: { ...honest.mem, core: genesis } },
    (s) => recoveryComplete(cfg, s),
  ],
  [
    "executorSound: a cursor past the journal's end",
    { ...honest, applied: honest.journal.length + 1 },
    executorSound,
  ],
  [
    // The world holds seq 3 but not seq 2: emission skipped a row rather than
    // lagging behind one.
    "executorSound: a hole in the emitted prefix",
    { ...honest, worldEffects: new Set([1, 3]) },
    executorSound,
  ],
  [
    "executorSound: the world holds a seq the journal never had",
    { ...honest, worldEffects: new Set([1, 2, 3, 4]) },
    executorSound,
  ],
  [
    "journalCoversWorld: an un-keyed effect reached the world",
    { ...honest, orphans: [spawnRec] },
    journalCoversWorld,
  ],
  [
    // The same paid fan-out, run once from the journal and once from an orphan:
    // two Jobs, one charge.
    "noDoubleSpentBudget: a spawn the book never charged",
    { ...honest, orphans: [spawnRec] },
    noDoubleSpentBudget,
  ],
  [
    "noDuplicateCycle: the same diff merged twice",
    { ...settled, orphans: [completionRec] },
    noDuplicateCycle,
  ],
  [
    // The ledger says the ticket landed; the journal has no completion row for
    // it. One of the two is lying, and the bridge is what notices.
    "journalCompletionsMatchLedger: a completion the journal never recorded",
    withTicketCompletions(honest, 1),
    journalCompletionsMatchLedger,
  ],
  [
    "journalCompletionsMatchLedger: a landed ticket whose journal row was cut",
    withJournal(settled, (rows) =>
      rows.filter((row) => row.rec.label !== "ticket-done"),
    ),
    journalCompletionsMatchLedger,
  ],
];

/** The same state with its journal rewritten — a tampered durable log. */
function withJournal(
  s: ActorState,
  edit: (rows: readonly Entry[]) => readonly Entry[],
): ActorState {
  return { ...s, journal: edit(s.journal) };
}

/** The same state with ticket 1's completions ghost set to `n`. */
function withTicketCompletions(s: ActorState, n: number): ActorState {
  const jb = s.mem.core.tickets.get(1);
  assert.ok(jb !== undefined, "no ticket 1");
  return {
    ...s,
    mem: {
      ...s.mem,
      core: { tickets: new Map([[1, { ...jb, completions: n }]]) },
    },
  };
}

test("all seven hold on states the actor actually reaches", () => {
  for (const s of [honest, settled]) {
    assert.ok(journalLegal(cfg, s));
    assert.ok(recoveryComplete(cfg, s));
    assert.ok(executorSound(s));
    assert.ok(journalCoversWorld(s));
    assert.ok(noDoubleSpentBudget(s));
    assert.ok(noDuplicateCycle(s));
    assert.ok(journalCompletionsMatchLedger(s));
    assert.ok(refinementCore(cfg, s));
    assert.ok(refinementInvariants(cfg, s));
  }
  // The empty journal is a reachable state too, and the base case of every
  // prefix argument: an actor that has decided nothing is sound.
  const fresh = driveEmitted([]);
  assert.ok(refinementInvariants(cfg, fresh));
  assert.ok(executorSound(fresh));
});

test("each invariant is RED against a state carrying the defect it names", () => {
  for (const [what, state, invariant] of defects) {
    assert.equal(invariant(state), false, `${what}: stayed green`);
    // ...and the full bundle catches every one of them, which is what makes
    // the bundle the thing a suite may assert instead of the seven.
    assert.equal(
      refinementInvariants(cfg, state),
      false,
      `${what}: the bundle`,
    );
  }
});

test("the two bundles split where the model splits them", () => {
  // The world-facing three fall under the hazard and the core does not: that
  // asymmetry is what every hazard run asserts, so it is pinned here directly
  // rather than only observed there.
  const orphaned: ActorState = { ...honest, orphans: [spawnRec] };
  assert.equal(journalCoversWorld(orphaned), false);
  assert.equal(noDoubleSpentBudget(orphaned), false);
  assert.ok(refinementCore(cfg, orphaned), "the journal and replay are intact");
  assert.equal(refinementInvariants(cfg, orphaned), false);

  // ...and a core failure fails both bundles, so the core is not a weaker
  // bundle that a defect could hide in.
  const lost: ActorState = { ...honest, mem: { ...honest.mem, core: genesis } };
  assert.equal(refinementCore(cfg, lost), false);
  assert.equal(refinementInvariants(cfg, lost), false);
});

test("the quantifier is over the whole fleet, not over the first ticket", () => {
  // Two tickets, and the defect on the SECOND. A conjunct that stopped at the
  // first live id would report this state clean.
  const twoTickets = driveEmitted([arrive, release, dispatch, arrive]);
  assert.ok(refinementInvariants(cfg, twoTickets));
  const jb2 = twoTickets.mem.core.tickets.get(2);
  assert.ok(jb2 !== undefined);
  const broken: ActorState = {
    ...twoTickets,
    mem: {
      ...twoTickets.mem,
      core: {
        tickets: new Map(twoTickets.mem.core.tickets).set(2, {
          ...jb2,
          completions: 1,
        }),
      },
    },
  };
  assert.equal(journalCompletionsMatchLedger(broken), false);
  assert.equal(refinementInvariants(cfg, broken), false);
});
