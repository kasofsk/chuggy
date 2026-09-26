import { schedulerRole, type Migration } from "../shared.ts";

/**
 * The scheduler reads a project's registered pools, to say of an execution
 * routed to them whether any is configured to run it. It reads what
 * `runner.qnt`'s `Runner` is here and no more: the project a pool belongs to,
 * its name, what it declared and the principal its polls are current under.
 * The issuer's client and the instant of registration are not the runner's.
 */
export const migration021: Migration = {
  version: 21,
  name: "the scheduler reads the registered pools",
  statements: [
    `GRANT SELECT(tenant,project,pool,capabilities,principal) ON TABLE public.worker_pool TO ${schedulerRole}`,
  ],
};
