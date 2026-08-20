/**
 * The idempotency keying: what a stored digest is taken over, and what it
 * separates.
 *
 * THE ASSERTIONS ARE ABOUT SEPARATION, NOT ABOUT VALUES. A pinned digest would
 * fix the construction, and the construction is allowed to change with a key
 * version; what may never change is that two different scopes, purposes or
 * keys produce two different digests. The length-prefixed encoding exists for
 * exactly one of those, and the case for it pairs two partitions whose
 * concatenations are identical.
 *
 * THE CAPS ARE TESTED HERE TOO because they are what makes an opaque client
 * string a bounded row, and the column constraint that repeats them is only
 * reachable through a value this side has already refused.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  idempotencyKeyDigestCurrent,
  idempotencyKeyDigests,
  idempotencyPayloadDigest,
  type IdempotencyScope,
} from "../../src/adapters/postgres/keying.ts";
import {
  asAuthorityKind,
  asIdempotencyKey,
  asOperationCommand,
  idempotencyKeyCharsMax,
  operationCommandCharsMax,
} from "../../src/interpreter/operationInbox.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  postgresHarnessKeyVersionFirst,
  postgresHarnessKeyVersionLater,
  postgresHarnessKeying,
} from "./harness.ts";

/** A scope over the tenant and project named, under one authority kind. */
function scopeOf(tenant: string, project: string): IdempotencyScope {
  return {
    partition: { tenant: asTenantId(tenant), project: asProjectId(project) },
    authorityKind: asAuthorityKind("UserMutation"),
  };
}

const keying = postgresHarnessKeying();
const key = asIdempotencyKey("a client's key");
const scope = scopeOf("tenant", "project");

test("one key in one scope has one digest, and no plaintext survives in it", () => {
  const digest = idempotencyKeyDigestCurrent(keying, scope, key);
  assert.equal(digest, idempotencyKeyDigestCurrent(keying, scope, key));
  assert.doesNotMatch(digest, /client/);
  assert.match(digest, /^[0-9a-f]{64}$/);
});

test("a digest separates the project, the authority kind and the key", () => {
  const digest = idempotencyKeyDigestCurrent(keying, scope, key);
  assert.notEqual(
    digest,
    idempotencyKeyDigestCurrent(keying, scopeOf("tenant", "other"), key),
  );
  assert.notEqual(
    digest,
    idempotencyKeyDigestCurrent(keying, scopeOf("other", "project"), key),
  );
  assert.notEqual(
    digest,
    idempotencyKeyDigestCurrent(
      keying,
      { ...scope, authorityKind: asAuthorityKind("Scheduler") },
      key,
    ),
  );
  assert.notEqual(
    digest,
    idempotencyKeyDigestCurrent(keying, scope, asIdempotencyKey("another key")),
  );
});

test("two partitions whose names concatenate the same are still two scopes", () => {
  assert.notEqual(
    idempotencyKeyDigestCurrent(keying, scopeOf("a", "bc"), key),
    idempotencyKeyDigestCurrent(keying, scopeOf("ab", "c"), key),
  );
});

test("the payload digest of a text is not the key digest of the same text", () => {
  const shared = "the very same characters";
  assert.notEqual(
    idempotencyKeyDigestCurrent(keying, scope, asIdempotencyKey(shared)),
    idempotencyPayloadDigest(
      keying,
      keying.current,
      scope,
      asOperationCommand(shared),
    ),
  );
});

test("a rotation moves the digest written and keeps every retained one computable", () => {
  const rotated = postgresHarnessKeying(postgresHarnessKeyVersionLater);
  const first = idempotencyKeyDigestCurrent(keying, scope, key);
  const later = idempotencyKeyDigestCurrent(rotated, scope, key);
  assert.notEqual(first, later);
  assert.deepEqual(idempotencyKeyDigests(rotated, scope, key), [first, later]);
});

test("a version this process holds no secret for is refused rather than guessed", () => {
  assert.throws(
    () =>
      idempotencyPayloadDigest(
        keying,
        "a version nobody deployed",
        scope,
        asOperationCommand("{}"),
      ),
    /holds a secret for/,
  );
  assert.notEqual(
    postgresHarnessKeyVersionFirst,
    postgresHarnessKeyVersionLater,
  );
});

test("a key is normalized to one spelling before it is digested", () => {
  const precomposed = "caf\u00e9";
  const decomposed = "cafe\u0301";
  assert.notEqual(precomposed, decomposed);
  assert.equal(asIdempotencyKey(precomposed), asIdempotencyKey(decomposed));
  assert.equal(
    idempotencyKeyDigestCurrent(keying, scope, asIdempotencyKey(precomposed)),
    idempotencyKeyDigestCurrent(keying, scope, asIdempotencyKey(decomposed)),
  );
});

test("two lone surrogates are refused rather than folded onto one digest", () => {
  const first = "\uD800";
  const second = "\uD801";
  assert.notEqual(first, second);
  assert.equal(
    Buffer.from(first, "utf8").toString("hex"),
    Buffer.from(second, "utf8").toString("hex"),
  );
  assert.throws(() => asIdempotencyKey(first), /unpaired surrogate/);
  assert.throws(() => asIdempotencyKey(second), /unpaired surrogate/);
  assert.throws(() => asOperationCommand(first), /unpaired surrogate/);
});

test("an unbounded client string never becomes an unbounded row", () => {
  assert.throws(() => asIdempotencyKey(""), /is empty/);
  assert.throws(
    () => asIdempotencyKey("k".repeat(idempotencyKeyCharsMax + 1)),
    /is past the/,
  );
  assert.throws(
    () => asOperationCommand("c".repeat(operationCommandCharsMax + 1)),
    /is past the/,
  );
  assert.equal(
    asIdempotencyKey("k".repeat(idempotencyKeyCharsMax)).length,
    idempotencyKeyCharsMax,
  );
});
