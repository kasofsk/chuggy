/**
 * What one draw of a member thread's session identity produces.
 *
 * THE DRAW MUST NOT CARRY THE MEMBER. Every other member of the project can
 * read a thread's session identity off `GET …/threads`, so an identity derived
 * from the owner's principal would publish that principal to everyone who can
 * list — which is exactly what `ThreadRecord.principal` is kept off the wire to
 * prevent. The assertion is that a draw for one member is unrelated to that
 * member: not the principal, and not a value any principal produces twice.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  threadSessionMint,
  threadSessionPrefix,
} from "../../src/adapters/crypto/threadSessionMint.ts";
import {
  asSessionId,
  sessionIdentityCharsMax,
} from "../../src/interpreter/agentSession.ts";

test("a drawn thread identity is prefixed, bounded and never reused", () => {
  assert.equal(
    threadSessionPrefix,
    "thread-",
    "the prefix is written twice on purpose: a listing says what a session is",
  );
  const mint = threadSessionMint();
  const drawn = Array.from({ length: 16 }, () => mint.session());
  for (const session of drawn) {
    assert.ok(session.startsWith(threadSessionPrefix));
    assert.equal(asSessionId(session), session);
    assert.ok(session.length <= sessionIdentityCharsMax);
  }
  assert.equal(new Set(drawn).size, drawn.length, "an identity repeated");
});

test("a drawn identity says nothing about the member it is for", () => {
  const owner = "21:https://auth.invalidsubject-one";
  const drawn = Array.from({ length: 16 }, () => threadSessionMint().session());
  for (const session of drawn) {
    const body = session.slice(threadSessionPrefix.length);
    assert.doesNotMatch(session, /subject-one/u);
    assert.ok(!owner.includes(body));
    assert.ok(!body.includes("auth.invalid"));
  }
});
