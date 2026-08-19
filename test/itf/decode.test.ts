/**
 * The decoder's obligations: every ITF shape decodes, every decoded shape
 * re-encodes to what it came from, and an encoding it does not recognise
 * throws rather than being guessed at.
 *
 * The round-trip cases run over the committed corpus as well as over hand
 * fixtures, because the corpus is the only place the real shapes appear
 * together and a fixture proves only what its author already thought of.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  decodeValue,
  encodeValue,
  decodeTrace,
  field,
  stateValue,
  describe,
} from "./decode.ts";

const GOLDEN_DIR = join(import.meta.dirname, "..", "golden");

function roundTrips(raw: unknown): void {
  assert.deepEqual(encodeValue(decodeValue(raw)), raw);
}

test("an integer decodes to a bigint and re-encodes to its literal", () => {
  assert.equal(decodeValue({ "#bigint": "731" }), 731n);
  roundTrips({ "#bigint": "731" });
});

test("a negative integer survives the round trip", () => {
  assert.equal(decodeValue({ "#bigint": "-1" }), -1n);
  roundTrips({ "#bigint": "-1" });
});

test("a set decodes to its elements and re-encodes in order", () => {
  const decoded = decodeValue({
    "#set": [{ "#bigint": "1" }, { "#bigint": "2" }],
  });
  assert.deepEqual(decoded, { kind: "set", elements: [1n, 2n] });
  roundTrips({ "#set": [{ "#bigint": "1" }, { "#bigint": "2" }] });
});

test("the empty tuple a nullary variant carries is not lost", () => {
  roundTrips({ tag: "Done", value: { "#tup": [] } });
  const decoded = decodeValue({ tag: "Done", value: { "#tup": [] } });
  assert.deepEqual(decoded, {
    kind: "variant",
    tag: "Done",
    value: { kind: "tuple", elements: [] },
  });
});

test("a variant carrying a payload keeps it", () => {
  roundTrips({ tag: "WExclusive", value: { "#bigint": "2" } });
});

test("a nested variant keeps both tags", () => {
  roundTrips({
    tag: "TSResolved",
    value: { tag: "Cancelled", value: { "#tup": [] } },
  });
});

test("a map keeps its key order and its pairing", () => {
  const raw = {
    "#map": [
      [{ "#bigint": "1" }, "a"],
      [{ "#bigint": "2" }, "b"],
    ],
  };
  roundTrips(raw);
  const decoded = decodeValue(raw);
  assert.equal(
    typeof decoded === "object" && !Array.isArray(decoded) && decoded.kind,
    "map",
  );
});

test("a record keeps every field", () => {
  const raw = {
    fanout: { "#bigint": "2" },
    combinator: { tag: "AnyPass", value: { "#tup": [] } },
  };
  roundTrips(raw);
  assert.equal(field(decodeValue(raw), "fanout"), 2n);
});

test("a list of records round-trips", () => {
  roundTrips([{ id: { "#bigint": "1" } }, { id: { "#bigint": "2" } }]);
});

test("a bare number is refused rather than guessed at", () => {
  assert.throws(() => decodeValue(3), /unrecognised encoding/);
});

test("a null is refused", () => {
  assert.throws(() => decodeValue(null), /unrecognised encoding/);
});

test("a malformed bigint is refused", () => {
  assert.throws(() => decodeValue({ "#bigint": 3 }), /unrecognised encoding/);
});

test("the error names where in the value the trouble was", () => {
  assert.throws(() => decodeValue({ outer: { inner: 3 } }), /\$\.outer\.inner/);
});

test("reading a missing field names the fields that are there", () => {
  const record = decodeValue({ a: "x" });
  assert.throws(() => field(record, "b"), /has no field b; it has a/);
});

test("reading a field off a non-record says what it got instead", () => {
  assert.throws(() => field(7n, "b"), /expected a record.*int\(7\)/);
});

test("describe names each shape", () => {
  assert.equal(describe(1n), "int(1)");
  assert.equal(describe("x"), "string(x)");
  assert.equal(describe(true), "bool(true)");
  assert.equal(describe([1n]), "list[1]");
  assert.equal(describe({ kind: "set", elements: [] }), "set");
  assert.equal(
    describe({ kind: "variant", tag: "Done", value: [] }),
    "variant(Done)",
  );
});

test("every committed golden round-trips byte for byte", () => {
  const files = readdirSync(GOLDEN_DIR).filter((f) => f.endsWith(".itf.json"));
  assert.ok(
    files.length > 0,
    "the corpus is empty, so this case proves nothing",
  );
  for (const file of files) {
    const raw: unknown = JSON.parse(
      readFileSync(join(GOLDEN_DIR, file), "utf8"),
    );
    const doc = raw as Record<string, unknown>;
    for (const [i, state] of (doc["states"] as unknown[]).entries()) {
      const fields = state as Record<string, unknown>;
      for (const [name, value] of Object.entries(fields)) {
        if (name === "#meta") continue;
        assert.deepEqual(
          encodeValue(decodeValue(value)),
          value,
          `${file} state ${String(i)} variable ${name} did not survive the round trip`,
        );
      }
    }
  }
});

test("a golden decodes into states whose variables are readable by name", () => {
  const files = readdirSync(GOLDEN_DIR).filter((f) => f.endsWith(".itf.json"));
  const firstFile = files[0];
  assert.ok(firstFile, "the corpus is empty, so this case proves nothing");
  const raw: unknown = JSON.parse(
    readFileSync(join(GOLDEN_DIR, firstFile), "utf8"),
  );
  const trace = decodeTrace(raw);
  assert.ok(trace.states.length > 1, "a trace of one state exercises no step");
  const first = trace.states[0];
  assert.ok(first, "a trace with no states decodes to nothing to read");
  assert.equal(first.index, 0);
  const lastStep = trace.vars.find((v) => v.endsWith("::lastStep"));
  assert.ok(
    lastStep,
    "a trace with no lastStep variable is not this machine's",
  );
  assert.equal(field(stateValue(first, lastStep), "label"), "init");
});

test("a trace missing its vars array is refused", () => {
  assert.throws(() => decodeTrace({ states: [] }), /\$\.vars/);
});

test("reading an absent variable names the ones present", () => {
  const trace = decodeTrace({ vars: ["a"], states: [{ a: "x" }] });
  const only = trace.states[0];
  assert.ok(only, "the fixture declares one state");
  assert.throws(() => stateValue(only, "b"), /has no variable b; it has a/);
});
