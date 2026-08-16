/**
 * The effect vocabulary, and the claim that matters about it: NOT ONE STORED
 * BYTE MOVES.
 *
 * THE ROUND TRIP IS RUN AGAINST THE MODEL'S OWN BYTES, not against this file's.
 * A round-trip case written over `effectVocabulary` proves the codec
 * self-consistent and nothing else — rename a constructor and its literal
 * together and it still passes, while every journal ever written becomes
 * unreadable. So the corpus is the fixture: every effect string in every
 * committed ITF trace is parsed and printed back, and the result must be
 * byte-identical to the string quint wrote. The two directions are then pinned
 * against each other — the strings the corpus contains ARE the vocabulary, so
 * neither can grow a member the other lacks.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";

import { decideArrive, decideRevoke, type Config } from "../domain/domain.ts";
import type { Core, Stage, WrapUp } from "../domain/measure.ts";
// THE ONE FIXTURE IMPORT IN THIS TREE THAT RUNS UPWARD, and it is deliberate:
// `src/effects/` sits below `src/spine/`, and depcruise's `.test.ts` exemption
// means no rule governs the direction. What is imported is the refinement
// instance's own consts, which the case below spreads rather than re-mints —
// re-minting them here would make this file an independent statement of an
// instance every suite that walks the refinement machine reads, and a
// `wrapUpPricing` that moved upstream would
// leave it testing a machine nothing else runs. The direction is safe because
// of what a `.test.ts` file is: `no-shipped-test-fixtures` stops anything that
// ships from importing either file, so nothing but a suite ever takes this
// edge. If a second upward import appears, the fixtures move down instead —
// one is a considered exception, two is a layer inverting.
import {
  cfgRefinement,
  progFlat,
  wx1,
} from "../spine/refinement-fixtures.test.ts";
import {
  effectVocabulary,
  effectsOf,
  parseEffect,
  printEffect,
  type Effect,
} from "./effect.ts";

// === The corpus, read as bytes =============================================

/**
 * Every effect string in every committed fixture, with its file, in file order.
 *
 * The walk is over the raw JSON rather than through `itf.ts`'s decoder, and
 * deliberately: the claim is about the bytes on disk, so anything that
 * normalized them on the way in would be a layer this case has to trust. An
 * `effects` array of strings is the ITF spelling of `StepRecord.effects` and
 * nothing else in the trace carries that key.
 */
function corpusEffectStrings(): readonly { file: string; text: string }[] {
  const found: { file: string; text: string }[] = [];
  for (const dir of ["corpus/tier1", "corpus/tier2"]) {
    for (const name of readdirSync(dir).sort()) {
      const file = `${dir}/${name}`;
      walk(JSON.parse(readFileSync(file, "utf8")), (text) => {
        found.push({ file, text });
      });
    }
  }
  return found;
}

/** Hand every string of every `effects` array to `visit`, at any depth. */
function walk(node: unknown, visit: (text: string) => void): void {
  walkRecords(node, (rec) => {
    for (const item of rec.effects) {
      visit(item);
    }
  });
}

/** A step record as ITF spells it: a label beside a list of effect strings. */
type CorpusRecord = { readonly label: string; readonly effects: string[] };

/** Hand every step record in the trace to `visit`, at any depth. */
function walkRecords(node: unknown, visit: (rec: CorpusRecord) => void): void {
  if (Array.isArray(node)) {
    for (const item of node as unknown[]) {
      walkRecords(item, visit);
    }
    return;
  }
  if (typeof node !== "object" || node === null) {
    return;
  }
  const row = node as Record<string, unknown>;
  const effects = row["effects"];
  if (Array.isArray(effects) && typeof row["label"] === "string") {
    for (const item of effects as unknown[]) {
      assert.equal(typeof item, "string", "an effects list holds a non-string");
    }
    visit({ label: row["label"], effects: effects as string[] });
    return;
  }
  for (const value of Object.values(row)) {
    walkRecords(value, visit);
  }
}

const corpus = corpusEffectStrings();

/** Every step record the committed fixtures carry, with its file. */
function corpusRecords(): readonly { file: string; rec: CorpusRecord }[] {
  const found: { file: string; rec: CorpusRecord }[] = [];
  for (const dir of ["corpus/tier1", "corpus/tier2"]) {
    for (const name of readdirSync(dir).sort()) {
      const file = `${dir}/${name}`;
      walkRecords(JSON.parse(readFileSync(file, "utf8")), (rec) => {
        found.push({ file, rec });
      });
    }
  }
  return found;
}

// === The vocabulary ========================================================

test("the vocabulary is the model's eight effect strings, in the model's order", () => {
  assert.deepEqual(effectVocabulary, [
    "CreateDraft",
    "Revoke",
    "OpenHumanTask",
    "SpawnWorkTasks",
    "SpawnEvalTasks",
    "EnqueueWrapUp",
    "OpenGate",
    "Complete",
  ]);
});

// === The round trip, byte for byte =========================================

test("every effect string the corpus carries parses and prints back unchanged", () => {
  assert.ok(
    corpus.length > 0,
    "the corpus walk found no effect strings at all",
  );
  for (const { file, text } of corpus) {
    const effect = parseEffect(text);
    assert.ok(
      effect !== undefined,
      `${file}: the model emitted ${JSON.stringify(text)} and this build cannot parse it`,
    );
    assert.equal(
      printEffect(effect),
      text,
      `${file}: ${JSON.stringify(text)} did not survive the round trip`,
    );
  }
});

test("the strings the corpus carries are exactly the vocabulary, both ways", () => {
  // One direction catches a constructor this build knows that the machine never
  // emits; the other catches an emitted string this build would refuse. A
  // fixture dropped from the corpus fails this case, and should: the corpus is
  // what witnesses the vocabulary, and a vocabulary member with no witness is a
  // member nothing checks.
  const observed = new Set(corpus.map(({ text }) => text));
  assert.deepEqual([...observed].sort(), [...effectVocabulary].sort());
});

test("printing then parsing returns the same constructor", () => {
  for (const effect of effectVocabulary) {
    assert.equal(parseEffect(printEffect(effect)), effect);
  }
});

test("the only record the machine emits with a list longer than one is a cascade", () => {
  // THE STRUCTURAL FACT the whole `(seq, ordinal)` key turns on, checked
  // against the model's own emitted traces rather than argued in a header.
  // Every other effect-bearing decision goes through `move`, `escalate` or
  // `completeTicket` and emits exactly one effect; only `decideRevoke` builds a
  // list, one `OpenHumanTask` per parked dependent. If this ever finds a second
  // shape, `ports.ts`'s bound on how much of the machine the ordinal is about
  // has gone stale, and the interpreter's fleet ceiling with it.
  const wide = corpusRecords().filter(({ rec }) => rec.effects.length > 1);
  assert.ok(wide.length > 0, "the corpus witnesses no multi-effect record");
  for (const { file, rec } of wide) {
    assert.equal(
      rec.label,
      "ticket-revoked",
      `${file}: ${rec.label} emitted ${String(rec.effects.length)} effects`,
    );
    assert.deepEqual(
      [...new Set(rec.effects.slice(1))],
      ["OpenHumanTask"],
      `${file}: a cascade's tail is desk tasks and nothing else`,
    );
    assert.equal(rec.effects[0], "Revoke");
  }
});

// === The refusals ==========================================================

test("parseEffect refuses a string outside the vocabulary", () => {
  const outside: readonly string[] = [
    "",
    "complete",
    "Complete ",
    " Complete",
    "Completed",
    "CreateDrafts",
    "SpawnTasks",
    "toString",
    "__proto__",
  ];
  for (const text of outside) {
    assert.equal(
      parseEffect(text),
      undefined,
      `${JSON.stringify(text)} is not an effect`,
    );
  }
});

// === A record's whole list ==================================================

/**
 * The refinement instance with room for the cascade, by spread — `s6`'s own
 * rule, which `harness.test.ts` states at `cfgInterp` and applies the same way:
 * the delta is the whole of what this case needs, and it is visible as one
 * line. Re-minting the instance's fields here made the fixture one more
 * independent statement of one instance, and a `wrapUpPricing` that moved
 * upstream would have left this file testing a machine no other suite runs.
 */
const cfg: Config = { ...cfgRefinement, nTickets: 3 };
const prog: readonly Stage[] = progFlat;
const wrapUp: WrapUp = wx1;

/** A fleet where two Drafts depend on ticket 1 — the cascade's shape. */
function twoDependentsOnOne(): Core {
  let c: Core = { tickets: new Map() };
  c = decideArrive(cfg, c, new Set(), prog, 1, wrapUp).post;
  c = decideArrive(cfg, c, new Set([1]), prog, 1, wrapUp).post;
  c = decideArrive(cfg, c, new Set([1]), prog, 1, wrapUp).post;
  return c;
}

test("effectsOf keeps the order and the multiplicity of a cascade's list", () => {
  // Through the real decider, not a record literal: the claim is that this
  // vocabulary types what `decideRevoke` actually emits. Two identical
  // `OpenHumanTask`s, one per parked dependent — the shape
  // `corpus/tier2/witness-cascade-park.itf.json` freezes, and the shape a list
  // that deduplicated would collapse into one desk task for two tickets.
  const cascade = decideRevoke(twoDependentsOnOne(), 1);
  assert.deepEqual(effectsOf(cascade.rec), [
    "Revoke",
    "OpenHumanTask",
    "OpenHumanTask",
  ]);
});

test("effectsOf answers the empty list for a record that asks nothing of the world", () => {
  assert.deepEqual(
    effectsOf({
      label: "task-done-duplicate",
      transitions: [],
      effects: [],
      attempt: { tag: "WONone" },
    }),
    [],
  );
});

test("effectsOf refuses a record carrying an effect this build does not know", () => {
  assert.throws(
    () =>
      effectsOf({
        label: "ticket-arrived",
        transitions: [],
        effects: ["CreateDraft", "RunTheJob"],
        attempt: { tag: "WONone" },
      }),
    {
      name: "AssertionError",
      message:
        /"RunTheJob" is not an effect this build knows.*"ticket-arrived"/,
    },
  );
});

test("every effect the vocabulary holds types a record of its own", () => {
  // The list is the identity map through `effectsOf`, which is what "the ADT is
  // the typed view of the strings" means at the record level.
  const every: readonly Effect[] = effectVocabulary;
  assert.deepEqual(
    effectsOf({
      label: "not a real record",
      transitions: [],
      effects: every.map(printEffect),
      attempt: { tag: "WONone" },
    }),
    every,
  );
});
