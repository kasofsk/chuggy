/**
 * The proof key an authorization code is redeemed with.
 *
 * The verifier is built from bytes the caller draws and the digest is taken
 * through a port, so a suite can hold both to the published test vector; the
 * challenge method is S256 and no other, because a public client offering
 * `plain` offers no proof at all.
 */

import { base64urlFromBytes } from "./base64url.ts";

export const pkceVerifierBytesCount = 32;
export const pkceChallengeMethod = "S256";

/** SHA-256 over the verifier's octets, which a browser has and a suite fakes. */
export type PkceDigestPort = (
  message: Uint8Array<ArrayBuffer>,
) => Promise<Uint8Array>;

export function pkceVerifierFromBytes(bytes: Uint8Array): string {
  if (bytes.length !== pkceVerifierBytesCount)
    throw new RangeError("a code verifier is drawn from the fixed byte count");
  return base64urlFromBytes(bytes);
}

export async function pkceChallengeFromVerifier(
  digest: PkceDigestPort,
  verifier: string,
): Promise<string> {
  return base64urlFromBytes(await digest(new TextEncoder().encode(verifier)));
}
