import assert from "node:assert/strict";
import { test } from "node:test";

import {
  asCanonicalConfiguration,
  encodeDraftAuthoring,
  parseDraftAuthoring,
} from "../../src/interpreter/authoring.ts";
import { plainAuthoring } from "../actor/harness.ts";

test("draft authoring round-trips through the generated domain codec", () => {
  assert.deepEqual(
    parseDraftAuthoring(encodeDraftAuthoring(plainAuthoring)),
    plainAuthoring,
  );
});

test("configuration must be canonical, bounded, and secret-free", () => {
  assert.equal(
    asCanonicalConfiguration('{"image":"worker:v1","limits":{"cpu":2}}'),
    '{"image":"worker:v1","limits":{"cpu":2}}',
  );
  assert.throws(
    () => asCanonicalConfiguration('{"limits":{},"image":"worker:v1"}'),
    /canonically encoded/,
  );
  assert.throws(
    () => asCanonicalConfiguration('{"apiToken":"value"}'),
    /secret-bearing/,
  );
  assert.throws(() => asCanonicalConfiguration("not-json"), SyntaxError);
});
