/**
 * Where one session attempt's identity and its bearer come from.
 *
 * THE SECRET IS DRAWN HERE AND STORED NOWHERE. A session attempt's row holds
 * the SHA-256 of the bearer, never the bearer; the value itself goes to the
 * launcher, into a pod-owned immutable Secret, and out of this process. Minting
 * it beside the digest is what makes that pair atomic — a digest stored for a
 * secret nobody holds is a session no pod can ever authenticate as.
 *
 * TWO INDEPENDENT DRAWS, AND THE SUITE ASSERTS THEY DIFFER. A bearer that
 * authenticates a session for the life of an attempt is offered to a public
 * endpoint, so it is two UUIDs concatenated with their hyphens kept, which is
 * the language `sessionBearerPattern` admits. Drawing one and repeating it
 * would still be long enough to resist guessing and would still match the
 * pattern, and it would mean any disclosure past the halfway point disclosed
 * the whole secret — a truncated log line, a slice in a diagnostic, a scrub
 * that redacts a suffix. No prefix of a bearer may be the rest of it.
 */

import { createHash, randomUUID } from "node:crypto";

import {
  asSessionAttemptId,
  asSessionBearerId,
  asSessionBearerSecret,
  sessionBearerPrefix,
} from "../../interpreter/agentSession.ts";
import type {
  SessionAttemptMint,
  SessionAttemptMinted,
} from "../../interpreter/sessionSchedulerRun.ts";

/** The digest the durable side keeps of a bearer, which is what it is looked up by. */
export function sessionBearerSecretDigest(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** Draws one attempt identity, one bearer and that bearer's digest, together. */
export function sessionAttemptMint(): SessionAttemptMint {
  return {
    mint: (): SessionAttemptMinted => {
      const secret = `${sessionBearerPrefix}${randomUUID()}${randomUUID()}`;
      return {
        attempt: asSessionAttemptId(`session-attempt-${randomUUID()}`),
        bearer: {
          id: asSessionBearerId(`session-bearer-${randomUUID()}`),
          secret: asSessionBearerSecret(secret),
        },
        bearerSecretDigest: sessionBearerSecretDigest(secret),
      };
    },
  };
}
