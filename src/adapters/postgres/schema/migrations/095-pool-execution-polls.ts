/**
 * A project's pool records its newest poll that could take an execution, as a
 * personal runner does in `050`.
 *
 * `worker_pool.executions_polled_at` is stamped by a pool's poll with room for
 * an execution, holding one, or naming a memory room above nothing, beside the
 * `last_polled_at` a poll that could take a session stamps, so neither kind of
 * work reads the pool live by the other's poll. NULL until such a poll. The
 * pool plane writes it; the API reads it under the table's SELECT it holds.
 */

import { poolPlaneRole, type Migration } from "../shared.ts";

export const migration095: Migration = {
  version: 95,
  name: "a pool records its newest poll that could take an execution",
  statements: [
    `ALTER TABLE public.worker_pool ADD COLUMN executions_polled_at timestamp with time zone`,
    `GRANT UPDATE(executions_polled_at) ON TABLE public.worker_pool TO ${poolPlaneRole}`,
  ],
};
