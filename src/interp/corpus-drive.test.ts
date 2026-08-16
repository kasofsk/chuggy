/**
 * THE WHOLE STACK, DRIVEN BY THE MODEL'S OWN DECISIONS: every committed golden
 * trace's decision events journaled through the actor, drained through the
 * interpreter into the recording world, crashed, rebuilt from the store alone,
 * and drained again — with the world's ledger required to come out identical.
 *
 * WHY THIS SUITE AND NOT ANOTHER WALK. Every layer here is already covered
 * ALONE. `check-conformance.sh` replays the corpus through the deciders;
 * `crash-seam.test.ts` crashes the actor at every seam of hand-written walks;
 * `execute.test.ts` and `end-to-end.test.ts` drive the interpreter over the
 * refinement instance. What none of them does is compose the two ends: the
 * decisions the MODEL took, at the MODEL's own consts, carried all the way to a
 * world. The gap that leaves is exactly the one the sweep measured — the
 * interpreter and the ports had never been driven by the deep half of the
 * machine, so the effects only a wrap-up, a cascade or a rework produces
 * reached no port in any suite, and the routing table's arms for them were
 * exercised by hand-built records alone.
 *
 * THE CONSTS ARE THE FIXTURE'S, NOT THIS SLICE'S, and that is the whole reason
 * the suite reaches what it reaches. `harness.test.ts`'s `cfgInterp` is the
 * refinement instance widened by one ticket — small on purpose, and its own
 * header says what it cannot reach. Here each walk runs at the consts the
 * manifest records for the trace it is driving: an mc instance's for a tier-1
 * fixture, the witness module's own for a tier-2 one, and `staleConsts` is what
 * keeps either honest against the model. Either way the fleet, the fan-out and
 * both pricings are the machine's rather than this slice's.
 *
 * WHAT IS ASSERTED, AND IN WHICH DIRECTION.
 *
 *   - THE LEDGER IS THE EFFECT-BEARING PREFIX. Every row the actor emitted that
 *     asks the world for something appears in the ledger, once per element of
 *     its effect list, and nothing else does. A row whose decision emitted no
 *     effect still advances the cursor and still joins `worldEffects`; it must
 *     NOT reach a port, and the projection is where that is checked.
 *   - THE CRASH CHANGES NOTHING THE WORLD CAN SEE. Recovery takes the harshest
 *     cursor there is — total loss — so the re-drain re-emits every row the
 *     walk ever emitted. The ledger after it must be byte-identical to the
 *     ledger before it, which is the ports' idempotence promise composed with
 *     the executor's re-emission, over decisions this tree did not invent.
 *   - BOTH BUNDLES AT EVERY OBSERVABLE POINT, so a walk that reached the world
 *     correctly out of a broken machine is not a pass.
 *   - THE ROSTERS, ACROSS THE CORPUS, AS EXACT SETS. All eight effects and all
 *     seven port calls, each reached by some fixture. Stated as an exact set
 *     rather than a floor: an effect no committed trace can produce is either a
 *     hole in the corpus or a vocabulary entry the machine has stopped emitting,
 *     and both are worth a red gate.
 *
 * IT READS THE COMMITTED CORPUS OFF THE FILESYSTEM, which `decode.test.ts`
 * already does for its own cross-validation and which the module-graph rules
 * permit a test file to do. Nothing that ships imports this file.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { WorldRecord } from "../adapters/recording-world.ts";
import type { Config } from "../domain/domain.ts";
import { effectVocabulary, effectsOf } from "../effects/effect.ts";
import {
  actorInit,
  commit,
  recoverFrom,
  type DurableState,
} from "../spine/actor.ts";
import type { Cmd } from "../spine/cmd.ts";
import { decodeSteps } from "../spine/decode.ts";
import { decodeTrace } from "../spine/itf.ts";
import { invariantsHold } from "../spine/machine.ts";
import { refinementInvariants } from "../spine/refinement-invariants.ts";
import { fixturePath, loadManifest, readJson } from "../tools/corpus.ts";
import { interpret } from "./execute.ts";
import { createRig, must, type Rig } from "./harness.test.ts";
import type { PortCall } from "./ports.ts";

// === The rosters this suite is held to =====================================

/**
 * The seven port methods, as data.
 *
 * A `satisfies` clause over `PortCall`, which is itself DERIVED from `Ports` —
 * so a method added to a port, a method removed, or a fifth port added is a
 * compile error here rather than a roster this suite quietly stops owing.
 * `ports.ts` makes the same argument for `PortCall` itself.
 */
const portCallNames = {
  spawn: "spawn",
  cancel: "cancel",
  openTask: "openTask",
  createDraft: "createDraft",
  enqueue: "enqueue",
  openGate: "openGate",
  land: "land",
} as const satisfies { readonly [P in PortCall]: P };

const portCalls: readonly PortCall[] = Object.values(portCallNames);

// === One fixture's whole walk ==============================================

/**
 * The decisions a trace carries, in trace order, as commands the actor can
 * journal.
 *
 * TWO KINDS OF STEP CONTRIBUTE NOTHING. A `settled` step drives no decider —
 * the model has none for it and `Cmd` has no constructor — so there is nothing
 * to journal. A tier-2 stutter's pick is structurally absent from any state
 * pair, which is why `replay.ts` drives the absorbing class instead; where tier
 * 1 DID record the pick it rides along here, because a duplicate delivery is a
 * real decision the actor journals and its row is the effect-free row the
 * projection below is about.
 */
function decisionsOf(
  fixture: {
    readonly name: string;
    readonly consts: Config;
  },
  tier: 1 | 2,
): readonly Cmd[] {
  const trace = decodeTrace(readJson(fixturePath(fixture, tier)), fixture.name);
  const commands: Cmd[] = [];
  for (const plan of decodeSteps(trace, fixture.name)) {
    if (plan.kind === "decided") {
      commands.push(plan.cmd);
    } else if (plan.kind === "stutter" && plan.recorded !== undefined) {
      commands.push(plan.recorded);
    }
  }
  return commands;
}

/** Everything one fixture's walk leaves behind, for the assertions below. */
type Walked = {
  readonly rig: Rig;
  readonly journaled: DurableState;
  readonly drained: DurableState;
  readonly beforeCrash: readonly WorldRecord[];
  readonly afterRecovery: readonly WorldRecord[];
  readonly redrained: DurableState;
};

/**
 * Journal every decision, draining as it goes; then crash into total cursor
 * loss, rebuild from the store, and drain again into the SAME world.
 *
 * THE DRAIN IS INTERLEAVED rather than saved for the end, because that is what
 * a running actor does and because it is the only way this walk visits the
 * post-journal pre-emission seam more than once. Draining after every decision
 * would also work and would visit it every time; draining after every SECOND
 * decision leaves half the rows to be emitted in a batch, which is the shape
 * `deliverOnce`'s issue-order check is about.
 */
function walk(cfg: Config, commands: readonly Cmd[]): Walked {
  const rig = createRig();
  let state = actorInit(cfg);
  commands.forEach((cmd, i) => {
    state = must(commit(cfg, rig.store, state, cmd), `commit ${cmd.tag}`);
    expectSound(cfg, state, `after committing ${cmd.tag}`);
    if (i % 2 === 1) {
      state = interpret(cfg, state, rig.ports);
      expectSound(cfg, state, `after draining through ${cmd.tag}`);
    }
  });
  const journaled = state;
  const drained = interpret(cfg, journaled, rig.ports);
  expectSound(cfg, drained, "at rest");
  const beforeCrash = rig.world.ledger();

  // THE HARSHEST CRASH THERE IS: the cursor checkpoint never made it, so
  // recovery starts at zero and the re-drain re-emits the whole journal. The
  // ledger is carried through because it was never the actor's to lose.
  const rebuilt = must(
    recoverFrom(cfg, rig.store.readAll(), 0, {
      worldEffects: drained.worldEffects,
      orphans: drained.orphans,
    }),
    "the durable rebuild",
  );
  expectSound(cfg, rebuilt, "after the rebuild");
  const redrained = interpret(cfg, rebuilt, rig.ports);
  expectSound(cfg, redrained, "after the re-drain");
  return {
    rig,
    journaled,
    drained,
    beforeCrash,
    afterRecovery: rig.world.ledger(),
    redrained,
  };
}

/** Both bundles, at one state, named so a failure says which machine broke. */
function expectSound(cfg: Config, state: DurableState, where: string): void {
  assert.ok(invariantsHold(cfg, state.mem), `${where}: the domain bundle`);
  assert.ok(
    refinementInvariants(cfg, state),
    `${where}: the refinement bundle`,
  );
}

/** Every (seq, ordinal) the journal's effect-bearing rows account for. */
function expectedLedgerKeys(state: DurableState): readonly string[] {
  const keys: string[] = [];
  for (const entry of state.journal) {
    effectsOf(entry.rec).forEach((_effect, ordinal) => {
      keys.push(`${String(entry.seq)}:${String(ordinal)}`);
    });
  }
  return keys;
}

/** The ledger's own keys, in the order the world accepted them. */
function ledgerKeys(records: readonly WorldRecord[]): readonly string[] {
  return records.map(
    (record) => `${String(record.seq)}:${String(record.ordinal)}`,
  );
}

// === The corpus, walked ====================================================

const manifest = loadManifest();

const walks: readonly { readonly name: string; readonly walked: Walked }[] = [
  ...manifest.tier1.map((fixture) => ({
    name: fixture.name,
    walked: walk(fixture.consts, decisionsOf(fixture, 1)),
  })),
  ...manifest.tier2.map((fixture) => ({
    name: fixture.name,
    walked: walk(fixture.consts, decisionsOf(fixture, 2)),
  })),
];

test("every fixture's decisions journal, drain and reach the world in journal order", () => {
  for (const { name, walked } of walks) {
    // THE PROJECTION, IN BOTH DIRECTIONS AND AS AN ORDERED LIST. Every effect
    // of every journaled row reached the world exactly once, under its own
    // (seq, ordinal) key, in the order the decisions were taken — and nothing
    // the journal does not account for is in the ledger.
    assert.deepEqual(
      ledgerKeys(walked.beforeCrash),
      expectedLedgerKeys(walked.drained),
      `${name}: the world's ledger is not the journal's effect list`,
    );
    // AND THE CURSOR CAUGHT UP. A walk that drained everything ends with the
    // cursor at the journal's end, so the ledger above is a claim about the
    // whole journal rather than about a prefix of it.
    assert.equal(
      walked.drained.applied,
      walked.drained.journal.length,
      `${name}: the drain left rows unemitted`,
    );
  }
});

test("a crash into total cursor loss re-emits everything and the world absorbs all of it", () => {
  for (const { name, walked } of walks) {
    // THE LEDGER IS UNCHANGED — not merely the same size. Every row went out a
    // second time under the key it already had, and the world's absorption is
    // what makes that cost nothing. This is the composition the refinement
    // layer's `worldEffects` union stands for, driven by the model's own
    // decisions rather than by a hand-written walk.
    assert.deepEqual(
      walked.afterRecovery,
      walked.beforeCrash,
      `${name}: the re-drain changed what the world holds`,
    );
    assert.equal(walked.redrained.applied, walked.redrained.journal.length);
    // The rebuild kept nothing but the store's rows and the ledger, and lands
    // on the machine state the live actor held.
    assert.deepEqual(
      walked.redrained.mem,
      walked.drained.mem,
      `${name}: the durable rebuild landed elsewhere`,
    );
  }
});

test("an effect-free decision advances the cursor and reaches no port", () => {
  // THE ROW THAT ASKS THE WORLD FOR NOTHING, which every duplicate delivery
  // produces. It joins `worldEffects` on emission — the model's ledger counts
  // DECISIONS EMITTED — while reaching no port at all, and the two halves of
  // that sentence are what this asserts. A walk that never journaled one would
  // make the case vacuous, so the premise is asserted first.
  let effectFree = 0;
  for (const { name, walked } of walks) {
    for (const entry of walked.drained.journal) {
      if (effectsOf(entry.rec).length > 0) {
        continue;
      }
      effectFree += 1;
      assert.ok(
        walked.drained.worldEffects.has(entry.seq),
        `${name}: seq ${String(entry.seq)} was emitted and is not in the ledger of emitted seqs`,
      );
      assert.deepEqual(
        walked.beforeCrash.filter((record) => record.seq === entry.seq),
        [],
        `${name}: seq ${String(entry.seq)} asks the world for nothing and reached a port`,
      );
    }
  }
  assert.ok(effectFree > 0, "no fixture journaled an effect-free decision");
});

test("the corpus drives every effect of the vocabulary through to a port", () => {
  const reached = new Set<string>();
  for (const { walked } of walks) {
    for (const record of walked.beforeCrash) {
      reached.add(record.effect);
    }
  }
  // AN EXACT SET, both ways. An effect no committed trace produces is a hole in
  // the corpus or a vocabulary entry the machine no longer emits; an effect in
  // the ledger that the vocabulary does not hold is a decider and a codec that
  // have stopped agreeing.
  assert.deepEqual(
    [...reached].sort(),
    [...effectVocabulary].sort(),
    "the effects the corpus drove and the vocabulary disagree",
  );
});

test("the corpus drives every port method the four contracts declare", () => {
  const called = new Set<string>();
  for (const { walked } of walks) {
    for (const record of walked.beforeCrash) {
      called.add(record.call);
    }
  }
  assert.deepEqual(
    [...called].sort(),
    [...portCalls].sort(),
    "the port methods the corpus reached and the contracts declare disagree",
  );
});

// A PER-METHOD CASE WAS TRIED HERE AND DROPPED, which is worth one sentence so
// it is not re-added. `RecordingWorld.recorded(call)` filters the same array
// `ledger()` returns, so "some fixture reaches each method" is implied by the
// exact set above — and the assertion could only fail with an empty fixture
// list, so it had no trace to name either. The accessor itself is pinned in
// `src/adapters/recording-world.test.ts`, where it is the subject.
