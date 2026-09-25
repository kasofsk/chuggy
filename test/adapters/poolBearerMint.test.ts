/**
 * Structural rather than sampled: the property is that no hex draw can match
 * the session-bearer pattern at all.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { poolBearerMint } from "../../src/adapters/crypto/poolBearerMint.ts";
import {
  sessionBearerPattern,
  sessionBearerPrefix,
} from "../../src/interpreter/agentSession.ts";

test("a pool bearer is drawn from the hex alphabet", () => {
  assert.match(poolBearerMint(), /^[0-9a-f]{64}$/u);
});

test("the session pattern demands the session prefix", () => {
  assert.ok(sessionBearerPattern.source.startsWith(`^${sessionBearerPrefix}`));
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
