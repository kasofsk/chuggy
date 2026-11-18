/**
 * A device's code as the issuer compares it: upper case, with no spaces or
 * hyphens, and every other character left as typed for the issuer to refuse.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { deviceUserCodeNormalized } from "../../src/contract/deviceApproval.ts";

test("a code is upper-cased and its spaces and hyphens dropped", () => {
  assert.equal(deviceUserCodeNormalized("bcdf-ghjk"), "BCDFGHJK");
  assert.equal(deviceUserCodeNormalized(" Bcdf Ghjk "), "BCDFGHJK");
  assert.equal(deviceUserCodeNormalized("b-c d--f"), "BCDF");
});

test("any other character is left for the issuer", () => {
  assert.equal(deviceUserCodeNormalized("bcdf_gh.jk\t"), "BCDF_GH.JK\t");
  assert.equal(deviceUserCodeNormalized("bcdf–ghjk"), "BCDF–GHJK");
});
