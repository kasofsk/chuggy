/**
 * An execution keeps the CPUs and memory its task was released with, which a
 * pool that claims it is asked to give it, and a pool's refusal of an attempt
 * is read back by the API.
 *
 * `cpu_millis` AND `memory_mib` ARE WRITTEN WHEN THE EXECUTION IS REGISTERED
 * OR NOT AT ALL. The scheduler names them in the INSERT that registers the
 * execution, under a column grant of its own, and no role is granted an UPDATE
 * of either. NULL is the deployment's own size, which is every row that stood.
 * Each is bounded to what a configuration may ask.
 *
 * The pool plane reads them to fill an assignment, and the API reads them and
 * the refusal to say what a job asked and why it did not run.
 */

import {
  apiRole,
  poolPlaneRole,
  schedulerRole,
  type Migration,
} from "../shared.ts";

export const migration059: Migration = {
  version: 59,
  name: "an execution keeps the size its task was released with",
  statements: [
    `ALTER TABLE public.execution
       ADD COLUMN cpu_millis integer
         CONSTRAINT execution_cpu_millis_is_bounded
         CHECK (cpu_millis IS NULL OR cpu_millis BETWEEN 1000 AND 64000),
       ADD COLUMN memory_mib integer
         CONSTRAINT execution_memory_mib_is_bounded
         CHECK (memory_mib IS NULL OR memory_mib BETWEEN 512 AND 262144)`,
    `GRANT INSERT(cpu_millis,memory_mib) ON TABLE public.execution TO ${schedulerRole}`,
    `GRANT SELECT(cpu_millis,memory_mib) ON TABLE public.execution TO ${poolPlaneRole}`,
    `GRANT SELECT(cpu_millis,memory_mib) ON TABLE public.execution TO ${apiRole}`,
    `GRANT SELECT(pool_refusal) ON TABLE public.execution_attempt TO ${apiRole}`,
  ],
};
