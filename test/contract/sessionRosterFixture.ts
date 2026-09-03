/**
 * The two rosters this installation opens a session with, written once for
 * every suite that needs one.
 *
 * WHY THEY ARE WRITTEN OUT AT ALL. `images/worker/` reaches nothing under
 * `src/`, so a suite that drives the pod cannot import the control plane's
 * value. Which roster any one session is opened with is still the provisioning
 * root's, so these are what this installation opens one with and not what any
 * caller must pass.
 *
 * WHAT HOLDS EACH. `threadRoster` is a copy of `threadCapabilitiesDefault` and
 * `leadRoster` of `leadSessionCapabilities`, and `imageTools.test.mjs` asserts
 * each is that value: without those assertions a change to either would leave
 * every suite green against a roster the tree no longer opens a session with.
 * A lead's is a value the control plane names because the installation's seeded
 * `toolAllowlist` is derived from it. Both are written here and in
 * `images/worker/toolProbe.mjs`, which is copied into the image and so cannot
 * read this file; every suite reads this one.
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
