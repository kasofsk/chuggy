/**
 * Structural, not statistical: the alphabets are disjoint by construction, so
 * this proves it from the two patterns rather than by sampling draws, which
 * would pass while the property failed (the collision rate is about 2^-30).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { poolBearerMint } from "../../src/adapters/crypto/poolBearerMint.ts";
import { sessionBearerPrefix } from "../../src/interpreter/agentSession.ts";

test("a pool bearer is drawn from the hex alphabet", () => {
  assert.match(poolBearerMint(), /^[0-9a-f]{64}$/u);
});

test("the session prefix has a character no hex draw can produce", () => {
  const outsideHex = [...sessionBearerPrefix].filter(
    (char) => !/^[0-9a-f]$/u.test(char),
  );
  assert.ok(
    outsideHex.length > 0,
    "a hex-only mint can never match a prefix drawn entirely from 0-9a-f",
  );
});
