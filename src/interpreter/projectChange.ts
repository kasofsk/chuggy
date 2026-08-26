/**
 * The durable per-installation change log a live consumer replays from, the
 * doorbell that tells it there is something to replay, and the bound past which
 * a cursor is no longer retained.
 *
 * IT IS A SUPERSET OF THE PUBLICATION LOG RATHER THAN A SECOND ONE. Every kind
 * `project_notification` publishes bridges into it unchanged, and `Execution`
 * is the one kind with no publication behind it, because an execution moves
 * without a project ordinal being allocated for it.
 *
 * THE DOORBELL SAYS ONLY THAT SOMETHING HAPPENED. A payload that differed per
 * append would make the server deliver one notification per row of a
 * transaction that wrote several; a constant one is collapsed into a single
 * delivery, and a consumer reading from its own cursor learns nothing from the
 * payload it would not learn from the read.
 */

import { notificationKinds } from "../contract/rosters.ts";

/** The channel an append rings. */
export const projectChangeChannel = "chuggy_project_change";

/** What an append rings with, held constant so one transaction wakes a consumer once. */
export const projectChangePayload = "";

/** Every kind a change row may carry: each publication's, and the execution's. */
export const allProjectChangeKinds = [
  ...notificationKinds,
  "Execution",
] as const;

export type ProjectChangeKind = (typeof allProjectChangeKinds)[number];

/**
 * How many changes the installation retains, which is how far behind a consumer
 * may fall before it is reset instead of replayed. The publication log bounds
 * one project's; this is one log for every project at once, so it holds that
 * window for as many projects as an installation streams concurrently.
 */
export const projectChangeRetentionMax = 100_000;

/** How long a resource identity a change row may name. */
export const projectChangeResourceCharsMax = 256;
