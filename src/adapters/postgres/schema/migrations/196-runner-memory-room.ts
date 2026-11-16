import { poolPlaneRole, schedulerRole, type Migration } from "../shared.ts";

/**
 * A personal runner's last poll keeps the memory room it named, NULL where it
 * named none, which the pool plane writes beside `executions_polled_at` and a
 * member's wait reads to say a runner waited on is short of memory.
 */
export const migration196: Migration = {
  version: 196,
  name: "a personal runner keeps the memory room its poll named",
  statements: [
    `ALTER TABLE public.personal_runner
       ADD COLUMN memory_room_mib bigint,
       ADD CONSTRAINT personal_runner_memory_room_is_a_count CHECK ((memory_room_mib >= 0))`,
    `GRANT SELECT(memory_room_mib),UPDATE(memory_room_mib)
       ON TABLE public.personal_runner TO ${poolPlaneRole}`,
    `GRANT SELECT(memory_room_mib) ON TABLE public.personal_runner TO ${schedulerRole}`,
  ],
};
