/**
 * A pool keeps the credentials its newest poll named, as a personal runner
 * does, and its claim of an agent it names credentials for waits only while
 * every one of them is paused for the member who registered it.
 *
 * `worker_pool.credentials_named` IS WRITTEN BY EVERY POLL of a pool: an
 * object keyed by agent, each holding the names the poll gave that agent, or
 * NULL where it named none, so a poll naming none clears what an earlier one
 * named. Adding it rewrites no row.
 */

import { poolPlaneRole, type Migration } from "../shared.ts";

export const migration165: Migration = {
  version: 165,
  name: "a pool keeps the credentials its poll named, and its claim waits only while every one is paused",
  statements: [
    `ALTER TABLE public.worker_pool
       ADD COLUMN credentials_named jsonb
         CONSTRAINT worker_pool_credentials_named_is_an_object
         CHECK (jsonb_typeof(credentials_named)='object')`,
    `GRANT SELECT(credentials_named),UPDATE(credentials_named)
       ON TABLE public.worker_pool TO ${poolPlaneRole}`,
  ],
};
