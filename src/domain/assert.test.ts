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

test("assertNever survives a value JSON declines to render", () => {
  const declined = (() => undefined) as unknown as never;
  assert.throws(() => assertNever(declined, "unhandled"), {
    message: /^unhandled: \(\) => undefined$/,
  });
});

// The three ways rendering can THROW rather than decline. Each would otherwise
// replace the caller's message with a TypeError about rendering — reporting a
// defect in assertNever instead of the defect that reached it.

test("assertNever survives a bigint, which a decoded ITF trace produces", () => {
  assert.throws(() => assertNever(42n as unknown as never, "unhandled tag"), {
    name: "AssertionError",
    message: "unhandled tag: 42",
  });
});

test("assertNever survives a circular structure", () => {
  const loop: Record<string, unknown> = {};
  loop["self"] = loop;
  assert.throws(() => assertNever(loop as unknown as never, "unhandled"), {
    name: "AssertionError",
    message: "unhandled: [object Object]",
  });
});

test("assertNever survives a symbol, which neither renderer accepts", () => {
  assert.throws(
    () => assertNever(Symbol("tag") as unknown as never, "unhandled"),
    { name: "AssertionError", message: "unhandled: Symbol(tag)" },
  );
});
