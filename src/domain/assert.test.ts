import assert from "node:assert/strict";
import { test } from "node:test";

import { AssertionError, assertNever, invariant, messageOf } from "./assert.ts";

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

test("assertNever renders a symbol through the string coercion", () => {
  // JSON.stringify DECLINES a symbol (returns undefined) rather than throwing;
  // `String` renders it. Both halves matter, because the docblock used to
  // claim `String` throws here and it does not.
  assert.throws(
    () => assertNever(Symbol("tag") as unknown as never, "unhandled"),
    { name: "AssertionError", message: "unhandled: Symbol(tag)" },
  );
});

// Rendering that THROWS rather than declines. Each of these would otherwise
// replace the caller's message with a TypeError about rendering — reporting a
// defect in assertNever instead of the defect that reached it.

test("assertNever survives a bare bigint", () => {
  assert.throws(() => assertNever(42n as unknown as never, "unhandled tag"), {
    name: "AssertionError",
    message: 'unhandled tag: "42n"',
  });
});

test("assertNever keeps the tag of a record carrying bigint fields", () => {
  // The shape s3 will actually decode: ITF serializes integers as bigints, so
  // the unhandled value is a RECORD with bigint fields. Without the replacer
  // JSON.stringify throws on the whole record and the string coercion renders
  // it `[object Object]` — losing the one field that names the unhandled case.
  const decoded = { tag: "operator-retry", seq: 7n } as unknown as never;
  assert.throws(() => assertNever(decoded, "unhandled step"), {
    name: "AssertionError",
    message: 'unhandled step: {"tag":"operator-retry","seq":"7n"}',
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

test("assertNever survives a value neither renderer can touch", () => {
  // The last branch takes a value that defeats both: a null-prototype object
  // (no `toString`, so `String` throws) inside a cycle (so JSON throws too).
  const opaque: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  opaque["self"] = opaque;
  assert.throws(() => assertNever(opaque as unknown as never, "unhandled"), {
    name: "AssertionError",
    message: "unhandled: <unrenderable>",
  });
});

test("messageOf reads an Error's own message, and anything else as itself", () => {
  // The three callers all catch `unknown`, so the three shapes a `catch` can
  // actually bind are what this covers: the tree's own assertion, a plain
  // Error, and a thrown value that is neither.
  assert.equal(
    messageOf(new AssertionError("seq must be non-negative")),
    "seq must be non-negative",
  );
  assert.equal(messageOf(new TypeError("not a function")), "not a function");
  assert.equal(messageOf("a bare string"), "a bare string");
  assert.equal(messageOf(undefined), "undefined");
});
