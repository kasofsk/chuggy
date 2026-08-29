/**
 * The branded text constructors' refusal of a value that is not text a stored
 * row holds, which are the refusals on this boundary no column constraint
 * repeats.
 *
 * WHY IT IS NOT BESIDE THE CAPS. `test/postgres/keying.test.ts` drives the
 * length caps next to the digests because a bounded column states each one
 * again, and reaching that column needs a server. A lone surrogate reaches no
 * column at all — it is refused before a digest is taken — so the case belongs
 * where it runs, and a pair of them is what says the refusal buys something: a
 * digest cannot separate two keys whose encodings are the same value.
 *
 * A NUL IS THE SAME KIND OF VALUE FOR A DIFFERENT REASON. No PostgreSQL text or
 * `jsonb` value holds one, and what refuses it there is the encoding rather than
 * a constraint — which is a raise from underneath whatever statement carried it,
 * after the act that statement was recording already happened.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  asAuthorityKind,
  asAuthoritySubject,
  asIdempotencyKey,
  asOperationCommand,
  asOperationId,
} from "../../src/interpreter/operationInbox.ts";

/** One unpaired high surrogate, which is a string JavaScript holds and no encoding carries. */
const loneSurrogateFirst = "\uD800";

/** A different one, so a case can be about two values rather than about one being odd. */
const loneSurrogateLater = "\uD801";

/** Well-formed text around a NUL, so the case is about the NUL and not about an empty value. */
const embeddedNul = "a client's\u0000value";

/** Every constructor `asBoundedText` backs, so a refusal is the boundary's and not one door's. */
const boundedConstructors: readonly ((value: string) => string)[] = [
  asAuthorityKind,
  asAuthoritySubject,
  asIdempotencyKey,
  asOperationCommand,
  asOperationId,
];

test("the two surrogates are distinct strings that UTF-8 gives one value", () => {
  assert.notEqual(loneSurrogateFirst, loneSurrogateLater);
  assert.equal(
    Buffer.from(loneSurrogateFirst, "utf8").toString("hex"),
    Buffer.from(loneSurrogateLater, "utf8").toString("hex"),
  );
});

test("every bounded constructor refuses either of them", () => {
  for (const construct of boundedConstructors) {
    assert.throws(() => construct(loneSurrogateFirst), /unpaired surrogate/);
    assert.throws(() => construct(loneSurrogateLater), /unpaired surrogate/);
  }
});

test("every bounded constructor refuses text carrying a NUL", () => {
  for (const construct of boundedConstructors) {
    assert.throws(() => construct(embeddedNul), /NUL/u);
  }
});

test("well-formed text passes, a surrogate pair included", () => {
  for (const construct of boundedConstructors) {
    assert.equal(construct("a client's value"), "a client's value");
    assert.equal(construct("\u{1F600}"), "\u{1F600}");
  }
});
