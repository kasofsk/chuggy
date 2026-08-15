import assert from "node:assert/strict";
import { test } from "node:test";

import { AssertionError, assertNever, invariant } from "./assert.ts";

test("invariant is silent when the condition holds", () => {
  assert.doesNotThrow(() => {
    invariant(true, "unreachable");
  });
});

test("invariant throws an AssertionError carrying its message", () => {
  assert.throws(
    () => {
      invariant(false, "seq must be non-negative");
    },
    (error: unknown) => {
      assert.ok(error instanceof AssertionError);
      assert.equal(error.name, "AssertionError");
      assert.equal(error.message, "seq must be non-negative");
      return true;
    },
  );
});

test("invariant narrows for the compiler", () => {
  const lookup = new Map([["ticket", "present"]]);
  const value = lookup.get("ticket");
  invariant(value !== undefined, "the ticket is present");
  // This line only typechecks because `invariant` narrowed `value` above; if
  // the `asserts` signature is lost, `tsc` fails here rather than the test.
  assert.equal(value.length, 7);
});

test("assertNever names the value that reached the default arm", () => {
  // The cast is the whole point: `assertNever` exists for the value TypeScript
  // proved could not arrive, arriving anyway from a decoded trace.
  const rogue = { tag: "not-a-member" } as unknown as never;
  assert.throws(() => assertNever(rogue, "unhandled effect"), {
    name: "AssertionError",
    message: 'unhandled effect: {"tag":"not-a-member"}',
  });
});

test("assertNever survives a value JSON cannot render", () => {
  const unrenderable = (() => undefined) as unknown as never;
  assert.throws(() => assertNever(unrenderable, "unhandled"), {
    message: "unhandled: undefined",
  });
});
