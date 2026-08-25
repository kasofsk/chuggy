/**
 * The proof key an authorization code is redeemed with.
 *
 * The verifier is built from bytes the caller draws, so a suite can hold the
 * challenge to a known answer; the challenge is the S256 method and no other,
 * because a public client offering `plain` offers no proof at all.
 */

import { base64urlEncoded } from "./encoding.js";

export const verifierBytesCount = 32;
export const challengeMethod = "S256";

/** @param {Uint8Array} bytes */
export function verifierFromBytes(bytes) {
  if (bytes.length !== verifierBytesCount)
    throw new RangeError("a code verifier is drawn from the fixed byte count");
  return base64urlEncoded(bytes);
}

/** @param {string} verifier */
export async function challengeFromVerifier(verifier) {
  const digested = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64urlEncoded(new Uint8Array(digested));
}
