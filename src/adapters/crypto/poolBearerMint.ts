/**
 * Where a worker pool's assignment bearer is drawn.
 *
 * HEX, SO THE SESSION PREFIX IS UNREACHABLE. A session bearer starts
 * `chgs_`, and hex has no `g`, `s` or `_`: no draw from this alphabet can
 * ever match `sessionBearerPattern`, so the two languages are disjoint by
 * construction rather than by chance.
 */

import { randomBytes } from "node:crypto";

/** One pool assignment bearer, 64 lowercase hex characters. */
export function poolBearerMint(): string {
  return randomBytes(32).toString("hex");
}
