/**
 * The versioned keyed digests a client idempotency key is stored as, and the
 * behavioural payload digest that is a separate value beside it.
 *
 * WHY KEYED AND NOT HASHED. An unkeyed hash of a client key is a lookup table
 * for anyone who reads the column: the key space a caller actually uses is
 * small, so a plain digest reveals the key it was taken from.
 * `docs/design/006-durable-project-dispatch.md` therefore stores versioned
 * keyed digests only, and plaintext keys and unkeyed hashes enter no long-lived
 * storage, log, trace or metric. HMAC-SHA256 under a per-version secret is
 * that, and the secret never leaves the process that was handed it.
 *
 * THE KEYING SET IS A CONSTRUCTOR ARGUMENT, exactly as the pool is. Where the
 * secrets come from is a deployment's, recorded in kasofsk/chuggy#117; an
 * adapter that read them from an environment would be making that choice
 * inside the layer that must not have one.
 *
 * ROTATION IS A LOOKUP OVER EVERY RETAINED VERSION, and that is why the
 * current version is a separate field from the set. A new digest is written
 * under the current version alone, while a retry of a key accepted before the
 * rotation must still find its operation — so a lookup offers every version's
 * digest, and the row it finds says which version it was written under.
 *
 * THE PAYLOAD DIGEST IS KEYED UNDER THE ROW'S OWN VERSION. Comparing a retry's
 * command against a stored digest computed under a version since rotated would
 * disagree with itself and report every retry as a conflict, so the comparison
 * recomputes under the version the row records rather than under the current
 * one.
 *
 * THE ENCODING IS LENGTH-PREFIXED because the fields are opaque client and
 * tenant strings. A delimiter-joined encoding lets a key containing the
 * delimiter impersonate a different scope, which is the same digest for two
 * different submissions.
 */

import { createHmac } from "node:crypto";

import type {
  AuthorityKind,
  IdempotencyKey,
  OperationCommand,
} from "../../interpreter/operationInbox.ts";
import type { Partition } from "../../interpreter/projectStore.ts";

/** One retained key version: the label a stored row records, and the secret its digests are taken under. */
export interface IdempotencyKeyVersion {
  readonly version: string;
  readonly secret: string;
}

/** The versions this process may compute digests under, and the one it writes new rows with. */
export interface IdempotencyKeying {
  readonly current: string;
  readonly versions: readonly IdempotencyKeyVersion[];
}

/** What a digest is scoped to: 006 scopes idempotency by project and authority kind, and by nothing else. */
export interface IdempotencyScope {
  readonly partition: Partition;
  readonly authorityKind: AuthorityKind;
}

/** The label that separates this construction from any other digest this tree computes. */
const idempotencyLabel = "chuggy:idempotency:v1";

/** Length-prefixes each field, so no opaque value can spell out a boundary and impersonate another scope. */
function idempotencyCanonical(parts: readonly string[]): string {
  return parts
    .map((part) => `${String(Buffer.byteLength(part, "utf8"))}:${part}`)
    .join("");
}

/** The secret a version is taken under, refusing a version this process was not given. */
function idempotencySecret(keying: IdempotencyKeying, version: string): string {
  const found = keying.versions.find((each) => each.version === version);
  if (found === undefined) {
    throw new Error(
      `postgres keying: version ${version} is not one this process holds a secret for`,
    );
  }
  return found.secret;
}

/** One keyed digest over the canonical encoding of its purpose, version, scope and value. */
function idempotencyDigest(
  keying: IdempotencyKeying,
  version: string,
  purpose: string,
  scope: IdempotencyScope,
  value: string,
): string {
  return createHmac("sha256", idempotencySecret(keying, version))
    .update(
      idempotencyCanonical([
        idempotencyLabel,
        purpose,
        version,
        scope.partition.tenant,
        scope.partition.project,
        scope.authorityKind,
        value,
      ]),
    )
    .digest("hex");
}

/** The digest a new row is written under, which is always the current version's. */
export function idempotencyKeyDigestCurrent(
  keying: IdempotencyKeying,
  scope: IdempotencyScope,
  key: IdempotencyKey,
): string {
  return idempotencyDigest(keying, keying.current, "key", scope, key);
}

/** Every retained version's digest of one key, which is what a lookup after a rotation offers. */
export function idempotencyKeyDigests(
  keying: IdempotencyKeying,
  scope: IdempotencyScope,
  key: IdempotencyKey,
): readonly string[] {
  return keying.versions.map((each) =>
    idempotencyDigest(keying, each.version, "key", scope, key),
  );
}

/** The behavioural digest of a command under one version, which is what a retry is compared by. */
export function idempotencyPayloadDigest(
  keying: IdempotencyKeying,
  version: string,
  scope: IdempotencyScope,
  command: OperationCommand,
): string {
  return idempotencyDigest(keying, version, "payload", scope, command);
}
