/**
 * The two rosters this installation opens a session with, written once for
 * every suite that needs one.
 *
 * WHY THEY ARE WRITTEN OUT AT ALL. `images/worker/` reaches nothing under
 * `src/`, so a suite that drives the pod cannot import the control plane's
 * value; and `src/` names no lead roster to import even if it could — a lead's
 * capabilities are chosen per session by the provisioning root, so a suite that
 * derived them would be agreeing with whatever a caller last passed.
 *
 * WHAT HOLDS EACH. `threadRoster` is a copy of `threadCapabilitiesDefault`, and
 * `imageTools.test.mjs` asserts it is that value: without that assertion a
 * change to the default would leave every thread suite green against a roster
 * the tree no longer opens a thread with. `leadRoster` is held to nothing,
 * because there is nothing to hold it to; it is one copy rather than three.
 */

import type { SessionCapability } from "../../src/interpreter/agentSession.ts";

/** What a lead is opened with: the reads, the derived authorship, the decisions. */
export const leadRoster: readonly SessionCapability[] = [
  "RepositoryRead",
  "ProjectRead",
  "DraftAuthor",
  "LeadDecision",
];

/** A copy of `threadCapabilitiesDefault`, asserted to be it by the contract suite. */
export const threadRoster: readonly SessionCapability[] = [
  "RepositoryRead",
  "RunCommands",
  "ProjectRead",
  "DraftAuthor",
  "DraftOriginate",
];
