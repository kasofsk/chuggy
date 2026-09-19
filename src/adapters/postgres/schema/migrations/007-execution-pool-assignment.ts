import { schedulerRole, type Migration } from "../shared.ts";

/**
 * What a claim made by something other than this deployment's own scheduler
 * leaves on the row: which pool holds it, the opaque handle that pool cancels
 * and settles it by, and the settled no a pool answered with.
 *
 * AN ASSIGNMENT IS OPAQUE BECAUSE A TASK KEY IS NOT. A pool that could read a
 * task key would learn the tenant's ticket structure, so the handle is drawn
 * per claim and unique across the table, and every call a pool makes is
 * resolved through it alone.
 *
 * A REFUSAL IS NOT AN OUTCOME AND IS NOT WRITTEN AS ONE. It has its own column
 * so that the credential a pool polls with never needs the privilege a harness
 * reports a result under, and the orchestrator turns it into the attempt's
 * terminal where every other terminal is decided.
 */
export const migration007: Migration = {
  version: 7,
  name: "execution-pool-assignment",
  statements: [
    `ALTER TABLE ticket_execution ADD COLUMN pool text`,
    `ALTER TABLE ticket_execution ADD COLUMN assignment text UNIQUE`,
    `ALTER TABLE ticket_execution ADD COLUMN pool_refusal text`,
    `GRANT SELECT(pool,assignment,pool_refusal) ON ticket_execution TO ${schedulerRole}`,
    `GRANT UPDATE(pool,assignment,pool_refusal) ON ticket_execution TO ${schedulerRole}`,
  ],
};
