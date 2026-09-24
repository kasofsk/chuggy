/**
 * The ledger mints exactly what the ticket record minted before it, over every
 * golden's journal.
 *
 * THE OLD MINT IS PINNED, NOT RECOMPUTED. `mint-before-ledger.json` holds, for
 * every golden the manifest names and every state of it, each ticket's
 * `spawned` as the image before the ledger recorded it on the ticket. Its
 * counter was folded inside `evolve`; this image folds `slotsClaimed` beside
 * it, from the states either side of a row. The journal each state decided so
 * far is replayed here through `replayJournal`, and the two counters must agree
 * at every state, because a task identity minted twice is two tasks under one
 * name.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { replayJournal } from "../../src/actor/journal.ts";
import type { Entry } from "../../src/domain/generated/modelTypes.ts";
import { decodeTrace, stateValue } from "../itf/decode.ts";
import { decodeLastDecision } from "../itf/vocabulary.ts";

const goldenDir = join(import.meta.dirname, "..", "golden");

/** Each golden's states, each state's tickets as `[id, spawned]` pairs in id order. */
const pinned = JSON.parse(
  readFileSync(join(import.meta.dirname, "mint-before-ledger.json"), "utf8"),
) as Record<string, readonly (readonly (readonly [number, number])[])[]>;

const names = (
  JSON.parse(readFileSync(join(goldenDir, "manifest.json"), "utf8")) as {
    goldens: readonly { name: string }[];
  }
).goldens.map((row) => row.name);

test("the pin covers every golden the manifest names", () => {
  assert.deepEqual(Object.keys(pinned).sort(), [...names].sort());
});

for (const name of names) {
  test(`${name}: the replayed ledger mints what the ticket record minted`, () => {
    const trace = decodeTrace(
      JSON.parse(
        readFileSync(join(goldenDir, `${name}.itf.json`), "utf8"),
      ) as unknown,
    );
    const stepVar = trace.vars.find((v) => v.endsWith("::lastStep"));
    const actionVar = "mbt::actionTaken";
    assert.ok(stepVar, `${name} records no decision`);
    const states = pinned[name];
    assert.ok(states, `${name} has no pin`);
    assert.equal(states.length, trace.states.length);
    const journal: Entry[] = [];
    trace.states.forEach((state, at) => {
      if (at > 0 && stateValue(state, actionVar) !== "settle") {
        const last = decodeLastDecision(stateValue(state, stepVar));
        if (last !== "NoDecision" && last.type === "Decided")
          journal.push({ seq: journal.length + 1, event: last.value.event });
      }
      const ledgers = replayJournal(journal).ledgers;
      assert.deepEqual(
        [...ledgers]
          .map(([id, ledger]) => [id, ledger.spawned])
          .sort((left, right) => (left[0] ?? 0) - (right[0] ?? 0)),
        states[at],
        `${name} state ${String(at)} mints another count`,
      );
    });
  });
}
