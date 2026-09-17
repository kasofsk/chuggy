import type pg from "pg";

import { postgresThreads } from "../../src/adapters/postgres/thread.ts";
import { apiRole } from "../../src/adapters/postgres/schema.ts";
import { sessionStoreStreamsAnswered } from "../../src/contract/http.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import type { ThreadStore } from "../../src/interpreter/threadRead.ts";
import { postgresHarnessProject, postgresHarnessRolePool } from "./harness.ts";
import { sessionRigOpen, type SessionRig } from "./sessionHarness.ts";

export interface LeadRig {
  readonly sessions: SessionRig;
  readonly apiPool: pg.Pool;
  readonly threads: ThreadStore;
  readonly close: () => Promise<void>;
}

export async function leadRigOpen(): Promise<LeadRig> {
  const sessions = await sessionRigOpen();
  const apiPool = postgresHarnessRolePool(apiRole);
  return {
    sessions,
    apiPool,
    threads: postgresThreads(apiPool, {
      streamsMax: sessionStoreStreamsAnswered,
    }),
    close: async () => {
      await apiPool.end();
      await sessions.close();
    },
  };
}

export function leadRigProject(
  rig: LeadRig,
  label: string,
): Promise<Partition> {
  return postgresHarnessProject(rig.sessions.harness.store, `lead-${label}`);
}
