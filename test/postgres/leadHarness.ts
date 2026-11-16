/**
 * The session rig the session suites stand on, with a pool under the API's
 * role, so a door granted to `chuggy_api` is driven as that role and not as
 * the migration owner, which would be green over a grant never made.
 */

import type pg from "pg";

import { apiRole } from "../../src/adapters/postgres/schema.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import { postgresHarnessProject, postgresHarnessRolePool } from "./harness.ts";
import { sessionRigOpen, type SessionRig } from "./sessionHarness.ts";

/** One opened subject: the session rig and the API's role pool. */
export interface LeadRig {
  readonly sessions: SessionRig;
  readonly apiPool: pg.Pool;
  readonly close: () => Promise<void>;
}

export async function leadRigOpen(): Promise<LeadRig> {
  const sessions = await sessionRigOpen();
  const apiPool = postgresHarnessRolePool(apiRole);
  return {
    sessions,
    apiPool,
    close: async () => {
      await apiPool.end();
      await sessions.close();
    },
  };
}

/** A provisioned project no other case is holding. */
export function leadRigProject(
  rig: LeadRig,
  label: string,
): Promise<Partition> {
  return postgresHarnessProject(rig.sessions.harness.store, `lead-${label}`);
}
