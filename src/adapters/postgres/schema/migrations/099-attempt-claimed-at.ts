/**
 * A job attempt records when a runner claimed it.
 *
 * `execution_attempt.claimed_at` is stamped by the claim that sets `pool`, in
 * the same statement, and is NULL on an attempt no runner has claimed. A
 * `Placing` attempt is either still waiting for a runner or claimed by one
 * whose run has not started, and `pool`, which tells them apart, is not the
 * API's to read; this column is. The pool plane writes it; the API and the
 * metrics plane read it.
 *
 * A LIVE ATTEMPT A RUNNER ALREADY HOLDS IS STAMPED WITH ITS OPENING. Before
 * this column an attempt was claimed within the lease it was opened under, so
 * that is the nearest instant the tree has. A finished attempt is written once
 * and keeps NULL, which a reader takes as not knowing when it was claimed.
 */

import {
  apiRole,
  metricsPlaneRole,
  poolPlaneRole,
  type Migration,
} from "../shared.ts";

export const migration099: Migration = {
  version: 99,
  name: "an attempt records when a runner claimed it",
  statements: [
    `ALTER TABLE public.execution_attempt ADD COLUMN claimed_at timestamp with time zone`,
    `UPDATE public.execution_attempt SET claimed_at=opened_at
      WHERE pool IS NOT NULL AND state IN ('Placing','Running')`,
    `GRANT UPDATE(claimed_at) ON TABLE public.execution_attempt TO ${poolPlaneRole}`,
    `GRANT SELECT(claimed_at) ON TABLE public.execution_attempt TO ${apiRole}`,
    `GRANT SELECT(claimed_at) ON TABLE public.execution_attempt TO ${metricsPlaneRole}`,
  ],
};
