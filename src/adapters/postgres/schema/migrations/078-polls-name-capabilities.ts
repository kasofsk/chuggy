/**
 * A pool's and a member's runner's capabilities are what its newest poll naming
 * a set named, so the plane serving pools writes them as it writes the runner
 * the poll names. A registration still records the set it declares, and a poll
 * naming none leaves the set as it stands.
 */

import { poolPlaneRole, type Migration } from "../shared.ts";

export const migration078: Migration = {
  version: 78,
  name: "a poll names the capabilities its runner has",
  statements: [
    `GRANT UPDATE(capabilities) ON TABLE public.worker_pool TO ${poolPlaneRole}`,
    `GRANT UPDATE(capabilities) ON TABLE public.personal_runner TO ${poolPlaneRole}`,
  ],
};
