import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";

import { ed25519AdoptionVerifier } from "../../src/adapters/crypto/ed25519AdoptionVerifier.ts";
import {
  adoptionSignaturesMax,
  canonicalAdoptionStatement,
  decideAdoptionTrust,
  type AdoptionPublisherKey,
  type AdoptionSignature,
  type AdoptionStatement,
  type AdoptionTrustPolicy,
} from "../../src/interpreter/adoptionTrust.ts";

const statement: AdoptionStatement = {
  source: "ssh://git.example.test/team/service.git",
  adopted: { object: "Git", objectId: "a".repeat(40) },
  expectedBase: "b".repeat(40),
};

const pair = generateKeyPairSync("ed25519");
const publicKey = pair.publicKey
  .export({ type: "spki", format: "der" })
  .toString("base64url");
const publisherKey: AdoptionPublisherKey = {
  publisher: "mini.example.test",
  key: "release-2026",
  publicKey,
  validFromEpochSecs: 1_767_225_600,
  expiresAtEpochSecs: 1_798_761_600,
};

function policy(
  mode: "SignatureRequired" | "SignatureOptional" = "SignatureRequired",
  key: AdoptionPublisherKey = publisherKey,
): AdoptionTrustPolicy {
  return {
    mode,
    verificationTimeEpochSecs: 1_777_118_400,
    publishers: [key],
  };
}

function signature(value: AdoptionStatement = statement): AdoptionSignature {
  return {
    algorithm: "Ed25519",
    publisher: publisherKey.publisher,
    key: publisherKey.key,
    signature: sign(
      null,
      Buffer.from(canonicalAdoptionStatement(value)),
      pair.privateKey,
    ).toString("base64url"),
  };
}

function invalidSignature(): AdoptionSignature {
  const candidate = signature();
  const bytes = Buffer.from(candidate.signature, "base64url");
  bytes[0] = (bytes[0] ?? 0) ^ 1;
  return { ...candidate, signature: bytes.toString("base64url") };
}

const verifier = ed25519AdoptionVerifier();

test("the canonical statement binds source, immutable object, and expected base", () => {
  const original = canonicalAdoptionStatement(statement);
  assert.notEqual(
    original,
    canonicalAdoptionStatement({
      ...statement,
      source: `${statement.source}/mirror`,
    }),
  );
  assert.notEqual(
    original,
    canonicalAdoptionStatement({ ...statement, expectedBase: "c".repeat(40) }),
  );
  assert.notEqual(
    original,
    canonicalAdoptionStatement({
      ...statement,
      adopted: { object: "Git", objectId: "d".repeat(40) },
    }),
  );
});

test("a receiver-required valid Ed25519 signature accepts the statement", () => {
  assert.deepEqual(
    decideAdoptionTrust(statement, policy(), [signature()], verifier),
    {
      decision: "Accepted",
      trust: "TrustedPublisher",
      statement: canonicalAdoptionStatement(statement),
      evidence: [
        {
          algorithm: "Ed25519",
          publisher: publisherKey.publisher,
          key: publisherKey.key,
          outcome: "Valid",
        },
      ],
    },
  );
});

test("the signature does not transfer to changed immutable input", () => {
  const changed = { ...statement, expectedBase: "c".repeat(40) };
  assert.equal(
    decideAdoptionTrust(changed, policy(), [signature()], verifier).evidence[0]
      ?.outcome,
    "Invalid",
  );
});

test("required, optional, and digest-only policies make unsigned handling explicit", () => {
  assert.equal(
    decideAdoptionTrust(statement, policy(), [], verifier).decision,
    "Refused",
  );
  assert.deepEqual(
    decideAdoptionTrust(statement, policy("SignatureOptional"), [], verifier),
    {
      decision: "Accepted",
      trust: "UntrustedProvenance",
      statement: canonicalAdoptionStatement(statement),
      evidence: [],
    },
  );
  assert.equal(
    decideAdoptionTrust(statement, { mode: "DigestOnly" }, [], verifier).trust,
    "DigestOnly",
  );
});

test("unknown, malformed, invalid, revoked, expired, and not-yet-valid evidence stay distinct", () => {
  const cases: readonly [AdoptionSignature, AdoptionTrustPolicy, string][] = [
    [{ ...signature(), publisher: "stranger" }, policy(), "UnknownPublisher"],
    [{ ...signature(), key: "stranger-key" }, policy(), "UnknownKey"],
    [{ ...signature(), signature: "***" }, policy(), "Malformed"],
    [invalidSignature(), policy(), "Invalid"],
    [
      signature(),
      policy("SignatureRequired", {
        ...publisherKey,
        revokedAtEpochSecs: 1_770_000_000,
      }),
      "Revoked",
    ],
    [
      signature(),
      policy("SignatureRequired", {
        ...publisherKey,
        expiresAtEpochSecs: 1_770_000_000,
      }),
      "Expired",
    ],
    [
      signature(),
      policy("SignatureRequired", {
        ...publisherKey,
        validFromEpochSecs: 1_778_000_000,
      }),
      "NotYetValid",
    ],
  ];
  for (const [candidate, trustPolicy, outcome] of cases)
    assert.equal(
      decideAdoptionTrust(statement, trustPolicy, [candidate], verifier)
        .evidence[0]?.outcome,
      outcome,
    );
});

test("noncanonical public-key DER with trailing bytes is malformed", () => {
  for (const suffix of [Buffer.of(0), Buffer.of(0, 1, 2)]) {
    const noncanonical = Buffer.concat([
      Buffer.from(publicKey, "base64url"),
      suffix,
    ]).toString("base64url");
    const trustPolicy = policy("SignatureRequired", {
      ...publisherKey,
      publicKey: noncanonical,
    });
    assert.equal(
      decideAdoptionTrust(statement, trustPolicy, [signature()], verifier)
        .evidence[0]?.outcome,
      "Malformed",
    );
  }
});

test("verification time and trust roots are pinned inputs with no discovery path", () => {
  const beforeRevocation = policy("SignatureRequired", {
    ...publisherKey,
    revokedAtEpochSecs: 1_778_000_000,
  });
  const afterRevocation = {
    ...beforeRevocation,
    verificationTimeEpochSecs: 1_778_100_000,
  };
  assert.equal(
    decideAdoptionTrust(statement, beforeRevocation, [signature()], verifier)
      .decision,
    "Accepted",
  );
  assert.equal(
    decideAdoptionTrust(statement, afterRevocation, [signature()], verifier)
      .evidence[0]?.outcome,
    "Revoked",
  );
});

test("signature input is bounded before verification", () => {
  assert.throws(
    () =>
      decideAdoptionTrust(
        statement,
        policy(),
        Array.from({ length: adoptionSignaturesMax + 1 }, () => signature()),
        verifier,
      ),
    /bound/u,
  );
  assert.throws(
    () =>
      decideAdoptionTrust(
        statement,
        policy(),
        [{ ...signature(), signature: "x".repeat(129) }],
        verifier,
      ),
    /malformed/u,
  );
});
