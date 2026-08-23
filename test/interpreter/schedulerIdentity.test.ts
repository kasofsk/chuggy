/**
 * The two shapes a bounded opaque column cannot hold, and the boundary between
 * them and everything it can.
 *
 * THESE REFUSALS THROW WHERE A MANIFEST'S RETURN A VALUE, and the difference is
 * who composed the text. An identity is minted by the control plane, so text
 * past the bound or carrying an unpaired surrogate is a programmer error; a
 * report is the worker's, so `../../src/interpreter/resultManifest.ts` refuses
 * one as a value instead.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  asAttemptId,
  asCapacityAccountId,
  asClusterId,
  asExecutionId,
  asSchedulerOwnerId,
  asSchedulerText,
  asPlacementId,
  schedulerIdentityCharsMax,
} from "../../src/interpreter/schedulerIdentity.ts";

/** Every brander, beside the subject its refusal has to name. */
const branders: readonly {
  readonly what: string;
  readonly brand: (value: string) => string;
}[] = [
  { what: "execution id", brand: asExecutionId },
  { what: "attempt id", brand: asAttemptId },
  { what: "capacity account", brand: asCapacityAccountId },
  { what: "cluster id", brand: asClusterId },
  { what: "placement id", brand: asPlacementId },
  { what: "scheduler owner", brand: asSchedulerOwnerId },
];

/** One unpaired surrogate, which every UTF-8 encoding folds to one replacement. */
const unpaired = `lead${String.fromCharCode(0xd800)}`;

test("an identity the column can hold is returned unchanged", () => {
  for (const { brand } of branders) {
    assert.equal(brand("identity-one"), "identity-one");
  }
});

test("the longest identity a row holds is accepted and one past it is not", () => {
  const longest = "a".repeat(schedulerIdentityCharsMax);
  assert.equal(asExecutionId(longest), longest);
  assert.throws(() => asExecutionId(`${longest}a`), RangeError);
});

test("an empty identity is refused by every brander, naming its own subject", () => {
  for (const { what, brand } of branders) {
    assert.throws(
      () => brand(""),
      (error: unknown) => {
        assert.ok(error instanceof RangeError);
        assert.match(error.message, new RegExp(`^${what}: `, "u"));
        return true;
      },
    );
  }
});

test("an unpaired surrogate is refused by every brander", () => {
  for (const { what, brand } of branders) {
    assert.throws(
      () => brand(unpaired),
      (error: unknown) => {
        assert.ok(error instanceof RangeError);
        assert.match(error.message, new RegExp(`^${what}: `, "u"));
        return true;
      },
    );
  }
});

test("an over-length identity is refused by every brander", () => {
  const past = "a".repeat(schedulerIdentityCharsMax + 1);
  for (const { what, brand } of branders) {
    assert.throws(
      () => brand(past),
      (error: unknown) => {
        assert.ok(error instanceof RangeError);
        assert.match(error.message, new RegExp(`^${what}: `, "u"));
        return true;
      },
    );
  }
});

test("an unpaired surrogate is refused before its length is measured", () => {
  const long = `${"a".repeat(schedulerIdentityCharsMax)}${String.fromCharCode(0xdc00)}`;
  assert.throws(
    () => asSchedulerText(long, "subject"),
    /unpaired surrogate/u,
    "a surrogate reported as over-length hides why two identities collide",
  );
});
