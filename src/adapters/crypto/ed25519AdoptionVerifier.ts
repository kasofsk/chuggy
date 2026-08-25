import { createPublicKey, verify } from "node:crypto";

import type {
  AdoptionCryptographicVerdict,
  AdoptionSignatureVerificationPort,
} from "../../interpreter/adoptionTrust.ts";

function base64urlBytes(value: string): Buffer | undefined {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return undefined;
  const bytes = Buffer.from(value, "base64url");
  return bytes.toString("base64url") === value ? bytes : undefined;
}

export function ed25519AdoptionVerifier(): AdoptionSignatureVerificationPort {
  return {
    verify(input): AdoptionCryptographicVerdict {
      const publicKey = base64urlBytes(input.publicKey);
      const signature = base64urlBytes(input.signature);
      if (publicKey === undefined || signature === undefined)
        return "Malformed";
      try {
        const key = createPublicKey({
          key: publicKey,
          format: "der",
          type: "spki",
        });
        if (key.asymmetricKeyType !== "ed25519" || signature.length !== 64)
          return "Malformed";
        return verify(null, Buffer.from(input.payload), key, signature)
          ? "Valid"
          : "Invalid";
      } catch {
        return "Malformed";
      }
    },
  };
}
