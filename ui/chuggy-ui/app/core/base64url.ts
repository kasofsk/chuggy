/**
 * base64url over bytes, in the one direction this console needs.
 *
 * PKCE encodes a drawn verifier and the digest of it, and nothing here
 * decodes: the API is the authority on who a caller is, so no token is read
 * for its claims.
 */

/** @param bytes the octets to encode, unpadded and in the URL alphabet. */
export function base64urlFromBytes(bytes: Uint8Array): string {
  let latin1 = "";
  for (const byte of bytes) latin1 += String.fromCharCode(byte);
  return btoa(latin1)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");
}
