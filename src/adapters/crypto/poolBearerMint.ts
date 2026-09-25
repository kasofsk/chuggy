/**
 * Hex, so no draw can begin with the session-bearer prefix `chgs_` and the
 * worker plane never routes a pool bearer as a session bearer.
 */

import { randomBytes } from "node:crypto";

/** Draws an assignment's identity or its bearer: 64 lowercase hex characters. */
export function poolBearerMint(): string {
  return randomBytes(32).toString("hex");
}
