import { poolPlaneRole, schedulerRole, type Migration } from "../shared.ts";

/**
 * A pool's last poll keeps the memory room it named, NULL where it named none,
 * which the pool plane writes and a run's wait reads to say the pools it
 * waits on are short of memory.
 */
export const migration203: Migration = {
  version: 203,
  name: "a pool keeps the memory room its poll named",
  statements: [
    `ALTER TABLE public.worker_pool
       ADD COLUMN memory_room_mib bigint,
       ADD CONSTRAINT worker_pool_memory_room_is_a_count CHECK ((memory_room_mib >= 0))`,
    `GRANT SELECT(memory_room_mib),UPDATE(memory_room_mib)
       ON TABLE public.worker_pool TO ${poolPlaneRole}`,
    `GRANT SELECT(memory_room_mib) ON TABLE public.worker_pool TO ${schedulerRole}`,
  ],
};
