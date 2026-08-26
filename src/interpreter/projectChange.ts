/**
 * The durable per-installation change log a live consumer replays from, and
 * the doorbell that tells it there is something to replay.
 *
 * IT IS A SUPERSET OF THE PUBLICATION LOG RATHER THAN A SECOND ONE. Every kind
 * `project_notification` publishes bridges into it unchanged, and `Execution`
 * is the one kind with no publication behind it, because an execution moves
 * without a project ordinal being allocated for it.
 */

import { notificationKinds } from "../contract/rosters.ts";

/** The channel an append rings, carrying the appended sequence as its payload. */
export const projectChangeChannel = "chuggy_project_change";

/** Every kind a change row may carry: each publication's, and the execution's. */
export const allProjectChangeKinds = [
  ...notificationKinds,
  "Execution",
] as const;

export type ProjectChangeKind = (typeof allProjectChangeKinds)[number];

/** How many changes one project retains, which is how far behind a consumer may fall. */
export const projectChangeRetentionMax = 1000;

/** How long a resource identity a change row may name. */
export const projectChangeResourceCharsMax = 256;
