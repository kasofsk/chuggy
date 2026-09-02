/**
 * What one draw of a session attempt's identity and bearer produces.
 *
 * THE DIGEST IS RECOMPUTED RATHER THAN COMPARED TO A CONSTANT. A stored digest
 * that does not hash the secret handed to the launcher is a session no pod can
 * ever authenticate as, and the only assertion that catches it is hashing the
 * secret this draw returned and requiring the digest to be that.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { sessionAttemptMint } from "../../src/adapters/crypto/sessionAttemptMint.ts";
import {
  asSessionBearerSecret,
  sessionBearerPattern,
  sessionBearerPrefix,
} from "../../src/interpreter/agentSession.ts";

test("a drawn bearer is in the language the API routes on, and is never reused", () => {
  const mint = sessionAttemptMint();
  const drawn = Array.from({ length: 8 }, () => mint.mint());
  for (const { attempt, bearer } of drawn) {
    assert.match(bearer.secret, sessionBearerPattern);
    assert.equal(asSessionBearerSecret(bearer.secret), bearer.secret);
    assert.ok(attempt.startsWith("session-attempt-"));
    assert.ok(bearer.id.startsWith("session-bearer-"));
  }
  for (const drawnValue of ["attempt", "id", "secret"] as const) {
    const values = drawn.map(({ attempt, bearer }) =>
      drawnValue === "attempt" ? attempt : bearer[drawnValue],
    );
    assert.equal(new Set(values).size, values.length, `${drawnValue} repeated`);
  }
});

test("the two halves of a drawn bearer are two draws, so no prefix of it is the rest", () => {
  const mint = sessionAttemptMint();
  for (let drawn = 0; drawn < 32; drawn += 1) {
    const body = mint.mint().bearer.secret.slice(sessionBearerPrefix.length);
    const half = body.length / 2;
    assert.equal(body.length % 2, 0);
    assert.notEqual(
      body.slice(0, half),
      body.slice(half),
      "a bearer whose second half repeats its first is disclosed by any part of it past the middle",
    );
  }
});

test("the stored digest is the digest of the secret the launcher is handed", () => {
  const { bearer, bearerSecretDigest } = sessionAttemptMint().mint();
  assert.equal(
    bearerSecretDigest,
    createHash("sha256").update(bearer.secret).digest("hex"),
  );
  assert.match(bearerSecretDigest, /^[0-9a-f]{64}$/u);
});
