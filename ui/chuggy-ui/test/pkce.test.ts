/**
 * The proof key, held to the published test vector.
 *
 * The vector is what makes this a check rather than a restatement: an
 * implementation that encodes or digests wrongly and is only compared with
 * itself agrees with itself.
 */

import { expect, test } from "vitest";

import {
  pkceChallengeFromVerifier,
  pkceVerifierBytesCount,
  pkceVerifierFromBytes,
} from "../app/core/pkce.ts";

const vectorBytes = Uint8Array.from([
  116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186,
  22, 212, 37, 77, 105, 214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121,
]);
const vectorVerifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const vectorChallenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

async function sha256(message: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", message));
}

test("a verifier is the drawn bytes in base64url, unpadded", () => {
  expect(pkceVerifierFromBytes(vectorBytes)).toBe(vectorVerifier);
});

test("a verifier is drawn from the fixed byte count and no other", () => {
  expect(() =>
    pkceVerifierFromBytes(new Uint8Array(pkceVerifierBytesCount - 1)),
  ).toThrow(RangeError);
});

test("the challenge is the S256 digest of the verifier", async () => {
  expect(await pkceChallengeFromVerifier(sha256, vectorVerifier)).toBe(
    vectorChallenge,
  );
});
