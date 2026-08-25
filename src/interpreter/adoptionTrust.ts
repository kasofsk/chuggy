import { assertNever } from "../domain/assertNever.ts";

declare const canonicalAdoptionStatementBrand: unique symbol;

export type CanonicalAdoptionStatement = string & {
  readonly [canonicalAdoptionStatementBrand]: true;
};

export const adoptionStatementFormat = "chuggy:adoption-statement:v1";
export const adoptionPublisherKeysMax = 32;
export const adoptionSignaturesMax = 8;
export const adoptionIdentityCharsMax = 128;
export const adoptionSourceCharsMax = 2_048;
export const adoptionPublicKeyCharsMax = 256;
export const adoptionSignatureCharsMax = 128;

export type AdoptionObject =
  | { readonly object: "Git"; readonly objectId: string }
  | { readonly object: "Artifact"; readonly sha256: string };

export interface AdoptionStatement {
  readonly source: string;
  readonly adopted: AdoptionObject;
  readonly expectedBase?: string;
}

export interface AdoptionPublisherKey {
  readonly publisher: string;
  readonly key: string;
  readonly publicKey: string;
  readonly validFromEpochSecs: number;
  readonly expiresAtEpochSecs?: number;
  readonly revokedAtEpochSecs?: number;
}

export type AdoptionTrustPolicy =
  | { readonly mode: "DigestOnly" }
  | {
      readonly mode: "SignatureRequired" | "SignatureOptional";
      readonly verificationTimeEpochSecs: number;
      readonly publishers: readonly AdoptionPublisherKey[];
    };

export interface AdoptionSignature {
  readonly algorithm: "Ed25519";
  readonly publisher: string;
  readonly key: string;
  readonly signature: string;
}

export type AdoptionCryptographicVerdict = "Valid" | "Invalid" | "Malformed";

export interface AdoptionSignatureVerificationPort {
  verify(input: {
    readonly algorithm: "Ed25519";
    readonly publicKey: string;
    readonly signature: string;
    readonly payload: CanonicalAdoptionStatement;
  }): AdoptionCryptographicVerdict;
}

export type AdoptionSignatureOutcome =
  | "Valid"
  | "Invalid"
  | "Malformed"
  | "UnknownPublisher"
  | "UnknownKey"
  | "NotYetValid"
  | "Expired"
  | "Revoked";

export interface AdoptionSignatureEvidence {
  readonly publisher: string;
  readonly key: string;
  readonly algorithm: "Ed25519";
  readonly outcome: AdoptionSignatureOutcome;
}

export interface AdoptionTrustDecision {
  readonly decision: "Accepted" | "Refused";
  readonly trust: "DigestOnly" | "TrustedPublisher" | "UntrustedProvenance";
  readonly statement: CanonicalAdoptionStatement;
  readonly evidence: readonly AdoptionSignatureEvidence[];
}

function adoptionIdentityWellFormed(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= adoptionIdentityCharsMax &&
    /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u.test(value)
  );
}

function adoptionObjectCanonical(adopted: AdoptionObject): object {
  switch (adopted.object) {
    case "Git":
      return { kind: "git", objectId: adopted.objectId };
    case "Artifact":
      return { kind: "artifact", sha256: adopted.sha256 };
    default:
      return assertNever(adopted);
  }
}

export function canonicalAdoptionStatement(
  value: AdoptionStatement,
): CanonicalAdoptionStatement {
  if (value.source.length === 0 || value.source.length > adoptionSourceCharsMax)
    throw new Error("adoption source is outside its configured bound");
  if (
    (value.adopted.object === "Git" &&
      !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(value.adopted.objectId)) ||
    (value.adopted.object === "Artifact" &&
      !/^[0-9a-f]{64}$/u.test(value.adopted.sha256))
  )
    throw new Error("adopted object identity is malformed");
  if (
    value.expectedBase !== undefined &&
    !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(value.expectedBase)
  )
    throw new Error("expected base is malformed");
  return JSON.stringify({
    format: adoptionStatementFormat,
    source: value.source,
    adopted: adoptionObjectCanonical(value.adopted),
    expectedBase: value.expectedBase ?? null,
  }) as CanonicalAdoptionStatement;
}

function adoptionTimestampValid(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function adoptionPublisherKeyValid(key: AdoptionPublisherKey): boolean {
  return (
    adoptionIdentityWellFormed(key.publisher) &&
    adoptionIdentityWellFormed(key.key) &&
    key.publicKey.length > 0 &&
    key.publicKey.length <= adoptionPublicKeyCharsMax &&
    adoptionTimestampValid(key.validFromEpochSecs) &&
    (key.expiresAtEpochSecs === undefined ||
      (adoptionTimestampValid(key.expiresAtEpochSecs) &&
        key.expiresAtEpochSecs > key.validFromEpochSecs)) &&
    (key.revokedAtEpochSecs === undefined ||
      adoptionTimestampValid(key.revokedAtEpochSecs))
  );
}

function adoptionKeyOutcome(
  key: AdoptionPublisherKey,
  verificationTimeEpochSecs: number,
): AdoptionSignatureOutcome | undefined {
  if (!adoptionTimestampValid(key.validFromEpochSecs))
    throw new Error("adoption key validity time is malformed");
  if (verificationTimeEpochSecs < key.validFromEpochSecs) return "NotYetValid";
  if (
    key.revokedAtEpochSecs !== undefined &&
    verificationTimeEpochSecs >= key.revokedAtEpochSecs
  )
    return "Revoked";
  if (
    key.expiresAtEpochSecs !== undefined &&
    verificationTimeEpochSecs >= key.expiresAtEpochSecs
  )
    return "Expired";
  return undefined;
}

function adoptionSignatureEvidence(
  signature: AdoptionSignature,
  policy: Extract<
    AdoptionTrustPolicy,
    { readonly verificationTimeEpochSecs: number }
  >,
  payload: CanonicalAdoptionStatement,
  verifier: AdoptionSignatureVerificationPort,
): AdoptionSignatureEvidence {
  const publisherKeys = policy.publishers.filter(
    (candidate) => candidate.publisher === signature.publisher,
  );
  const selected = publisherKeys.find(
    (candidate) => candidate.key === signature.key,
  );
  let outcome: AdoptionSignatureOutcome;
  if (publisherKeys.length === 0) outcome = "UnknownPublisher";
  else if (selected === undefined) outcome = "UnknownKey";
  else {
    outcome =
      adoptionKeyOutcome(selected, policy.verificationTimeEpochSecs) ??
      verifier.verify({ ...signature, publicKey: selected.publicKey, payload });
  }
  return {
    publisher: signature.publisher,
    key: signature.key,
    algorithm: signature.algorithm,
    outcome,
  };
}

export function decideAdoptionTrust(
  statement: AdoptionStatement,
  policy: AdoptionTrustPolicy,
  signatures: readonly AdoptionSignature[],
  verifier: AdoptionSignatureVerificationPort,
): AdoptionTrustDecision {
  const canonical = canonicalAdoptionStatement(statement);
  if (signatures.length > adoptionSignaturesMax)
    throw new Error("adoption signatures exceed their configured bound");
  if (policy.mode === "DigestOnly")
    return {
      decision: "Accepted",
      trust: "DigestOnly",
      statement: canonical,
      evidence: [],
    };
  if (policy.publishers.length > adoptionPublisherKeysMax)
    throw new Error("adoption publisher keys exceed their configured bound");
  if (!adoptionTimestampValid(policy.verificationTimeEpochSecs))
    throw new Error("adoption verification time is malformed");
  for (const publisher of policy.publishers) {
    if (!adoptionPublisherKeyValid(publisher))
      throw new Error("adoption publisher key is malformed");
  }
  const keyIdentities = policy.publishers.map(
    (publisher) => `${publisher.publisher}\u0000${publisher.key}`,
  );
  if (new Set(keyIdentities).size !== keyIdentities.length)
    throw new Error("adoption publisher key identities must be unique");
  for (const signature of signatures) {
    if (
      !adoptionIdentityWellFormed(signature.publisher) ||
      !adoptionIdentityWellFormed(signature.key) ||
      signature.signature.length === 0 ||
      signature.signature.length > adoptionSignatureCharsMax
    )
      throw new Error("adoption signature is malformed");
  }
  const evidence = signatures.map((signature) =>
    adoptionSignatureEvidence(signature, policy, canonical, verifier),
  );
  const trusted = evidence.some((item) => item.outcome === "Valid");
  return {
    decision:
      policy.mode === "SignatureRequired" && !trusted ? "Refused" : "Accepted",
    trust: trusted ? "TrustedPublisher" : "UntrustedProvenance",
    statement: canonical,
    evidence,
  };
}
