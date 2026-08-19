/**
 * The vocabulary's contract against the specification's own output: every
 * ticket map in every committed golden decodes into `Ticket` and re-encodes to
 * the bytes it came from.
 *
 * That is the check a spot check cannot replace. A field dropped from the
 * record type, a variant decoded to the wrong arm, a set whose order was
 * inherited rather than imposed — each survives an assertion about the field
 * somebody remembered to write, and none survives exact equality against the
 * whole map for every state of every trace.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  decodeTrace,
  encodeValue,
  stateValue,
  type ItfTrace,
} from "../itf/decode.ts";
import {
  decodeCore,
  decodeStepRecord,
  encodeCore,
  encodeStepRecord,
} from "../itf/vocabulary.ts";

const GOLDEN_DIR = join(import.meta.dirname, "..", "golden");

function goldens(): { name: string; trace: ItfTrace }[] {
  return readdirSync(GOLDEN_DIR)
    .filter((f) => f.endsWith(".itf.json"))
    .map((name) => ({
      name,
      trace: decodeTrace(
        JSON.parse(readFileSync(join(GOLDEN_DIR, name), "utf8")) as unknown,
      ),
    }));
}

function varNamed(trace: ItfTrace, suffix: string): string {
  const found = trace.vars.find((v) => v.endsWith(suffix));
  assert.ok(found, `no ${suffix} variable in this trace`);
  return found;
}

test("every golden ticket map decodes into Ticket and re-encodes identically", () => {
  const files = goldens();
  assert.ok(
    files.length > 0,
    "the corpus is empty, so this case proves nothing",
  );
  let states = 0;
  for (const { name, trace } of files) {
    const ticketsVar = varNamed(trace, "::tickets");
    for (const state of trace.states) {
      const raw = JSON.parse(readFileSync(join(GOLDEN_DIR, name), "utf8")) as {
        states: Record<string, unknown>[];
      };
      const original = raw.states[state.index]?.[ticketsVar];
      const core = decodeCore(stateValue(state, ticketsVar));
      assert.deepEqual(
        encodeValue(encodeCore(core)),
        original,
        `${name} state ${String(state.index)}: the ticket map did not survive the round trip`,
      );
      states++;
    }
  }
  assert.ok(
    states > 100,
    `only ${String(states)} states exercised; the corpus should carry more`,
  );
});

test("every golden step record decodes and re-encodes identically", () => {
  for (const { name, trace } of goldens()) {
    const stepVar = varNamed(trace, "::lastStep");
    const raw = JSON.parse(readFileSync(join(GOLDEN_DIR, name), "utf8")) as {
      states: Record<string, unknown>[];
    };
    for (const state of trace.states) {
      const original = raw.states[state.index]?.[stepVar];
      const record = decodeStepRecord(stateValue(state, stepVar));
      assert.deepEqual(
        encodeValue(encodeStepRecord(record)),
        original,
        `${name} state ${String(state.index)}: the step record did not survive the round trip`,
      );
    }
  }
});

test("the completions ghost the record does not store matches what the trace stores", () => {
  /** decodeTicket refuses a mismatch, so reaching the corpus's end without throwing is the assertion. */
  for (const { trace } of goldens()) {
    const ticketsVar = varNamed(trace, "::tickets");
    for (const state of trace.states) {
      assert.doesNotThrow(() => decodeCore(stateValue(state, ticketsVar)));
    }
  }
});
