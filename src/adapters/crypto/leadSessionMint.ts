/**
 * Where a successor lead's session identity comes from.
 *
 * IT IS A DRAW AND NOT A DERIVATION, for the reason `./threadSessionMint.ts`
 * gives: an identity that encoded the project, the principal or the decision
 * that opened it would put the installation's shape into a value every member's
 * console reads off a page. It is a UUID under one prefix, as an attempt's and
 * a thread's are.
 *
 * A DECISION REFERENCE WOULD HAVE BEEN THE WRONG DRAW. The cycle that opens a
 * successor is over in seconds and the lead it opened is the project's context
 * for as long as the project has one, so naming the row after that cycle would
 * read as a claim the two are the same lifetime.
 */

import { randomUUID } from "node:crypto";

import { asSessionId } from "../../interpreter/agentSession.ts";
import type { LeadSessionMint } from "../../interpreter/leadMailbox.ts";

/** The prefix a lead's session identity carries, so a listing says what it is. */
export const leadSessionPrefix = "lead-";

export function leadSessionMint(): LeadSessionMint {
  return {
    session: () => asSessionId(`${leadSessionPrefix}${randomUUID()}`),
  };
}
