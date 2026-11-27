/**
 * Whether a person has agreed to every one of the deployment's current
 * policies, asked of whatever keeps the record, and the fault that leaves it
 * undecided.
 *
 * NOTHING IS KEPT OF THE ANSWER. Each ask reads the standing whole, so a
 * person who has just agreed, or a policy re-pinned since the last ask, is
 * answered by the next one.
 *
 * AN OUTAGE IS THROWN AND NEVER RETURNED. A standing is what was read; a
 * record that could not be reached or read is `AgreementStandingUnavailable`,
 * so a caller cannot answer it as a person who has not agreed.
 */

import type { AgreementStanding } from "../contract/agreementPlane.ts";
import type { Principal } from "./principal.ts";

/** A fault that left a person's standing unread. */
export class AgreementStandingUnavailable extends Error {
  constructor(why: string) {
    super(`agreement standing: ${why}`);
    this.name = "AgreementStandingUnavailable";
  }
}

/** Where a person's standing against the current policies is read. */
export interface AgreementStandings {
  standing(principal: Principal): Promise<AgreementStanding>;
}

/** Whether every current policy in `standing` carries an agreement, which a standing naming none does. */
export function agreementStandingAgreed(standing: AgreementStanding): boolean {
  return standing.policies.every((entry) => entry.agreedAt !== undefined);
}
