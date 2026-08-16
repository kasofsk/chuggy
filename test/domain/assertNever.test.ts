/**
 * The terminator's two obligations: it throws when reached, and the value it
 * was reached with survives into the message a reader will see.
 *
 * Reaching it at all takes a value the type system says cannot exist, so each
 * case casts one in. That cast is the fixture, not a shortcut — a switch
 * written non-exhaustively to reach the default arm would be rejected by the
 * very rule this function exists to serve.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { assertNever } from "../../src/domain/assertNever.ts";

type Handled = { kind: "handled" };

function describeKind(value: Handled): string {
  switch (value.kind) {
    case "handled":
      return "handled";
    default:
      return assertNever(value.kind);
  }
}

const impossible = { kind: "unhandled" } as unknown as Handled;

test("an exhausted switch returns without reaching the terminator", () => {
  assert.equal(describeKind({ kind: "handled" }), "handled");
});

test("a variant the type ruled out throws rather than falling through", () => {
  assert.throws(() => describeKind(impossible), /unhandled variant/);
});

test("the message carries the value, so the missing arm is readable", () => {
  assert.throws(() => describeKind(impossible), /"unhandled"/);
});
