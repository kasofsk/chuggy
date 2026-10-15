/**
 * A job attempt keeps the runtime image the scheduler opened it under, which a
 * pool that claims it is offered to start its workload from.
 *
 * `runtime` IS WRITTEN WHEN THE ATTEMPT IS OPENED OR NOT AT ALL. The scheduler
 * names it in the INSERT that opens the attempt, under the table-level INSERT
 * the baseline gave it, and no role is granted an UPDATE of it. Every row that
 * stood has none, and a pool that claims one is offered no runtime for it.
 *
 * The pool plane reads it under a column grant of its own, to offer it and to
 * let a pool holding the attempt pull it.
 */

import { poolPlaneRole, type Migration } from "../shared.ts";

export const migration057: Migration = {
  version: 57,
  name: "an attempt keeps the runtime it was opened under",
  statements: [
    `ALTER TABLE public.execution_attempt ADD COLUMN runtime text
       CONSTRAINT execution_attempt_runtime_is_bounded
       CHECK ((runtime IS NULL OR length(runtime) BETWEEN 1 AND 512))`,
    `GRANT SELECT(runtime) ON TABLE public.execution_attempt TO ${poolPlaneRole}`,
  ],
};
