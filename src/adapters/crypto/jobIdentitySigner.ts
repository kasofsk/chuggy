/**
 * The job identity token's signer: an ordered list of RSA keys, the first of
 * which signs and all of which are published.
 *
 * A KEY IS ROTATED BY PUBLISHING IT BEFORE IT SIGNS: add the next key last,
 * later move it first, later drop the old one. Each `kid` is the key's RFC
 * 7638 thumbprint, so every replica and every restart names a key alike.
 */

import { createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";

import { calculateJwkThumbprint, SignJWT } from "jose";

import type {
  JobIdentityClaims,
  JobIdentityPublicKey,
  JobIdentitySigner,
} from "../../interpreter/jobIdentityToken.ts";

/** The shortest RSA modulus a key may have. */
export const jobIdentityKeyBitsMin = 2048;

/** Why no signer could be built; `key` is the refused key's place in the list. */
export type JobIdentitySignerRefusal =
  | { readonly reason: "KeysEmpty" }
  | { readonly reason: "KeyUnreadable"; readonly key: number }
  | { readonly reason: "KeyNotRsa"; readonly key: number }
  | { readonly reason: "KeyTooShort"; readonly key: number }
  | { readonly reason: "KeyDuplicated"; readonly key: number };

export type JobIdentitySignerBuilt =
  | { readonly result: "Built"; readonly signer: JobIdentitySigner }
  | { readonly result: "Refused"; readonly refusal: JobIdentitySignerRefusal };

type JobIdentitySignerKeyRead =
  | { readonly privateKey: KeyObject }
  | { readonly refusal: JobIdentitySignerRefusal };

function jobIdentitySignerKeyRead(
  privateKeyPem: string,
  key: number,
): JobIdentitySignerKeyRead {
  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey({ key: privateKeyPem, format: "pem" });
  } catch {
    return { refusal: { reason: "KeyUnreadable", key } };
  }
  if (privateKey.asymmetricKeyType !== "rsa")
    return { refusal: { reason: "KeyNotRsa", key } };
  const bits = privateKey.asymmetricKeyDetails?.modulusLength;
  if (bits === undefined || bits < jobIdentityKeyBitsMin)
    return { refusal: { reason: "KeyTooShort", key } };
  return { privateKey };
}

async function jobIdentitySignerPublicKey(
  privateKey: KeyObject,
): Promise<JobIdentityPublicKey> {
  const { n, e } = createPublicKey(privateKey).export({ format: "jwk" });
  if (n === undefined || e === undefined)
    throw new Error(
      "job identity signer: an RSA public key exported no modulus",
    );
  const kid = await calculateJwkThumbprint({ kty: "RSA", n, e }, "sha256");
  return Object.freeze({ kty: "RSA", n, e, kid, alg: "RS256", use: "sig" });
}

/** Builds the signer from PEM private keys, the signing key first. */
export async function jobIdentitySigner(
  privateKeysPem: readonly string[],
): Promise<JobIdentitySignerBuilt> {
  if (privateKeysPem.length === 0)
    return { result: "Refused", refusal: { reason: "KeysEmpty" } };
  const privateKeys: KeyObject[] = [];
  const published: JobIdentityPublicKey[] = [];
  for (const [key, privateKeyPem] of privateKeysPem.entries()) {
    const read = jobIdentitySignerKeyRead(privateKeyPem, key);
    if ("refusal" in read) return { result: "Refused", refusal: read.refusal };
    const publicKey = await jobIdentitySignerPublicKey(read.privateKey);
    if (published.some((held) => held.kid === publicKey.kid))
      return { result: "Refused", refusal: { reason: "KeyDuplicated", key } };
    privateKeys.push(read.privateKey);
    published.push(publicKey);
  }
  const [signingKey] = privateKeys;
  const [signingPublic] = published;
  if (signingKey === undefined || signingPublic === undefined)
    throw new Error(
      "job identity signer: a non-empty list read no signing key",
    );
  const keySet = Object.freeze({ keys: Object.freeze(published) });
  return {
    result: "Built",
    signer: {
      sign: (claims: JobIdentityClaims): Promise<string> =>
        new SignJWT({ ...claims })
          .setProtectedHeader({
            alg: "RS256",
            typ: "JWT",
            kid: signingPublic.kid,
          })
          .sign(signingKey),
      keySet: () => keySet,
    },
  };
}
