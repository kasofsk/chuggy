/**
 * Where an access token's identity and secret are drawn, and its digest taken.
 *
 * THE SECRET IS DRAWN HERE AND STORED NOWHERE. Its row holds the SHA-256 of
 * the whole secret, prefix included, as `sessionBearerSecretDigest` takes a
 * session bearer's, and a token is looked up by that digest alone.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { accessTokenPrefix } from "../../contract/accessToken.ts";
import type {
  AccessTokenSecretMinted,
  AccessTokenSecrets,
} from "../../interpreter/accessToken.ts";

/** How many random bytes a secret carries, which `accessTokenPattern` reads as unpadded base64url. */
const accessTokenSecretBytes = 32;

/** The digest the durable side keeps of a secret, which is what it is looked up by. */
export function accessTokenSecretDigest(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** Draws one token's identity and secret, and the secret's digest, together. */
export function accessTokenSecrets(): AccessTokenSecrets {
  return {
    mint: (): AccessTokenSecretMinted => {
      const secret = `${accessTokenPrefix}${randomBytes(accessTokenSecretBytes).toString("base64url")}`;
      return {
        token: randomUUID(),
        secret,
        secretDigest: accessTokenSecretDigest(secret),
      };
    },
  };
}
