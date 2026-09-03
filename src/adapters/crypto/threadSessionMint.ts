/**
 * Where one member thread's session identity comes from.
 *
 * IT IS A DRAW AND NOT A DERIVATION. A thread identity carries no meaning a
 * reader may act on: it is not the member's principal, not a hash of it, and
 * not a counter, because each of those would put a member's identity or the
 * installation's shape into a value every other member's console can read off
 * a listing. It is a UUID under one prefix, exactly as an attempt's is.
 *
 * IT STANDS BESIDE `sessionAttemptMint` because both are the same kind of
 * decision — what a durable row is named — and neither belongs to the adapter
 * that writes the row. A definer that took no identity would be minting one
 * inside a transaction nobody could replay with the same name.
 */

import { randomUUID } from "node:crypto";

import { asSessionId } from "../../interpreter/agentSession.ts";
import type { ThreadSessionMint } from "../../interpreter/threadRead.ts";

/** The prefix a thread's session identity carries, so a listing says what it is. */
export const threadSessionPrefix = "thread-";

export function threadSessionMint(): ThreadSessionMint {
  return {
    session: () => asSessionId(`${threadSessionPrefix}${randomUUID()}`),
  };
}
