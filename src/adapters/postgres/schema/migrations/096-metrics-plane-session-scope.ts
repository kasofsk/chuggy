/**
 * The metrics plane reads a session's scope, which is what tells it a member's
 * own session from a project's. It is granted that column alone, as 091
 * granted the rest.
 */

import { metricsPlaneRole, type Migration } from "../shared.ts";

export const migration096: Migration = {
  version: 96,
  name: "the metrics plane reads a session's scope",
  statements: [
    `GRANT SELECT(scope) ON TABLE public.agent_session TO ${metricsPlaneRole}`,
  ],
};
