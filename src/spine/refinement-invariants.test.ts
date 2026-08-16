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

import type { Config } from "../domain/domain.ts";
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
  refinementBundleConjuncts,
  refinementBundles,
  refinementCore,
  refinementCoreConjuncts,
  refinementInvariants,
} from "./refinement-invariants.ts";
import {
  arrive,
  cfgRefinement,
  dispatch,
  driveEmitted,
  quietWrapUpWalk,
  release,
} from "./refinement-fixtures.test.ts";

const cfg = cfgRefinement;

/** Arrive, release, dispatch — all three emitted. The world is level with the book. */
const honest: ActorState = driveEmitted([arrive, release, dispatch]);

/** The same ticket walked all the way to a completion, and a stale confirmation absorbed. */
const settled: ActorState = driveEmitted(quietWrapUpWalk);

/** The dispatch's record: a paid task fan-out, attributable to ticket 1. */
const spawnRec: StepRecord = recordLabelled(honest, "dispatch");

/** The completion's record: the emission that merges the diff. */
const completionRec: StepRecord = recordLabelled(settled, "ticket-done");

/**
 * The arrival's record: an effect the world received that neither per-ticket
 * counter reads — `CreateDraft` is neither a spawn nor a completion.
 */
const draftRec: StepRecord = recordLabelled(honest, "ticket-arrived");

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
  (cfg: Config, s: ActorState) => boolean,
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
    journalLegal,
  ],
  [
    // The seqs stop being dense: no replay can index this log.
    "journalLegal: a sequence gap",
    withJournal(honest, (rows) =>
      rows.map((row, i) => (i === 2 ? { ...row, seq: 9 } : row)),
    ),
    journalLegal,
  ],
  [
    // Memory that the journal cannot account for: recovery would land somewhere
    // else, which is the one thing a journaled actor may not survive.
    "recoveryComplete: memory the replay does not reproduce",
    { ...honest, mem: { ...honest.mem, core: genesis } },
    recoveryComplete,
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
    // THE COVERAGE HALF, ALONE. Every other orphan in this roster is a spawn or
    // a completion, so it reds an arithmetic conjunct on the way through; an
    // arrival's draft asks the world for something no counter counts, which
    // makes this the one state that isolates the coverage claim itself.
    "journalCoversWorld: an orphan no per-ticket counter reads",
    { ...honest, orphans: [draftRec] },
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
    assert.ok(executorSound(cfg, s));
    assert.ok(journalCoversWorld(cfg, s));
    assert.ok(noDoubleSpentBudget(cfg, s));
    assert.ok(noDuplicateCycle(cfg, s));
    assert.ok(journalCompletionsMatchLedger(cfg, s));
    assert.ok(refinementCore(cfg, s));
    assert.ok(refinementInvariants(cfg, s));
  }
  // The empty journal is a reachable state too, and the base case of every
  // prefix argument: an actor that has decided nothing is sound.
  const fresh = driveEmitted([]);
  assert.ok(refinementInvariants(cfg, fresh));
  assert.ok(executorSound(cfg, fresh));
});

test("each invariant is RED against a state carrying the defect it names", () => {
  for (const [what, state, invariant] of defects) {
    assert.equal(invariant(cfg, state), false, `${what}: stayed green`);
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
  assert.equal(journalCoversWorld(cfg, orphaned), false);
  assert.equal(noDoubleSpentBudget(cfg, orphaned), false);
  assert.ok(refinementCore(cfg, orphaned), "the journal and replay are intact");
  assert.equal(refinementInvariants(cfg, orphaned), false);

  // ...and a core failure fails both bundles, so the core is not a weaker
  // bundle that a defect could hide in.
  const lost: ActorState = { ...honest, mem: { ...honest.mem, core: genesis } };
  assert.equal(refinementCore(cfg, lost), false);
  assert.equal(refinementInvariants(cfg, lost), false);
});

// === The membership guard =================================================

test("each bundle's roster is the members' own names, so a name cannot outlive its call", () => {
  // THE GUARD THE DOMAIN LAYER HAS AND THIS ONE DID NOT. Both bundles were an
  // `&&` chain beside a hand-typed array of names, and nothing tied one to the
  // other: dropping `journalCompletionsMatchLedger` from the chain, and
  // swapping `noDoubleSpentBudget` for a duplicate call, both left the whole
  // tree at exit 0 — the hazard states are over-determined, so the crash-seam
  // asserts stayed false-green over the missing conjunct.
  //
  // The bundle is now the roster: each member takes its name from its own
  // function reference and the exported name lists are projections of the
  // members, so a conjunct the bundle stopped asking is a conjunct the roster
  // stopped naming, and `src/tools/verify.ts` compares that roster against
  // `model/refinement.qnt`'s own `and { … }` as an exact set in both
  // directions on every run of the conformance gate. This case is what holds
  // the projection to the members while that comparison holds the names to the
  // model.
  assert.deepEqual(
    refinementBundles.refinementCore.map(([name]) => name),
    refinementCoreConjuncts,
  );
  assert.deepEqual(
    refinementBundles.refinementInvariants.map(([name]) => name),
    refinementBundleConjuncts,
  );
  for (const [bundle, members] of Object.entries(refinementBundles)) {
    // A member's name IS its function's name, which is what makes a
    // name/call pairing unwritable rather than merely easy to get right.
    for (const [name, holds] of members) {
      assert.equal(holds.name, name, bundle);
    }
    // ...and no bundle names one conjunct twice, which is what a duplicate
    // call leaves behind here before the model comparison ever sees it.
    const names = members.map(([name]) => name);
    assert.equal(new Set(names).size, names.length, bundle);
  }
});

test("every conjunct of both bundles has a defect tree of its own, and the roster says which", () => {
  // THE CORPUS'S COMPLETENESS, asserted as an EQUALITY rather than as
  // containment — which is the half that makes it a guard on the bundles too.
  // Containment would pass more easily for a bundle that had LOST a conjunct;
  // an equality reds, because the defect tree above then names an invariant no
  // bundle conjoins. `refinementCore` is excluded by name for the obvious
  // reason: it is a bundle rather than an invariant, and its own conjuncts are
  // each on the list.
  const proved = new Set(defects.map(([, , invariant]) => invariant.name));
  const conjoined = new Set(
    [...refinementCoreConjuncts, ...refinementBundleConjuncts].filter(
      (name) => name !== "refinementCore",
    ),
  );
  assert.deepEqual(proved, conjoined);
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
  assert.equal(journalCompletionsMatchLedger(cfg, broken), false);
  assert.equal(refinementInvariants(cfg, broken), false);
});
