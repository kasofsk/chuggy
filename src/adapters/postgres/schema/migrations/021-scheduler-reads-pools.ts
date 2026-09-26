import { schedulerRole, type Migration } from "../shared.ts";

/**
 * The scheduler reads a project's registered pools, to say of an execution
 * routed to them whether any is configured to run it: the project a pool
 * belongs to, its name, what it declared, its class, and the principal the
 * project authority is asked about. The grant leaves out the client and the
 * instant of registration because the scheduler reads neither, not to keep
 * the client from it: a principal spells the issuer and the client it was
 * derived from.
 */
export const migration021: Migration = {
  version: 21,
  name: "the scheduler reads the registered pools",
  statements: [
    `GRANT SELECT(tenant,project,pool,capabilities,class,principal) ON TABLE public.worker_pool TO ${schedulerRole}`,
  ],
};
