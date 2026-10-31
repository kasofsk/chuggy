/**
 * The three functions a ticket read joins laterally per ticket are declared to
 * answer one row, which each does at most: every body ends `LIMIT 1`.
 *
 * `ticket_updated_dependencies`, `ticket_runner_loss` AND
 * `ticket_run_step_failure` WERE PLANNED AT THE DEFAULT ESTIMATE, and the
 * project and ticket reads join all three, so the planner multiplied those
 * estimates into a cost that passed `jit_above_cost` on every call. `ALTER`
 * leaves each body, owner and grant as it stands; a later `CREATE OR REPLACE`
 * of any of them restores the default unless it declares `ROWS 1` again.
 */

import {
  ticketRunStepFailureFunction,
  ticketRunnerLossFunction,
  ticketUpdatedDependenciesFunction,
  type Migration,
} from "../shared.ts";

/** Each function's signature, which `ALTER FUNCTION` names it by. */
export const ticketReadFunctionsAt103 = [
  ticketUpdatedDependenciesFunction,
  ticketRunnerLossFunction,
  ticketRunStepFailureFunction,
].map((name) => `public.${name}(text, text, bigint)`);

export const migration103: Migration = {
  version: 103,
  name: "the functions a ticket read joins per ticket are estimated at one row",
  statements: ticketReadFunctionsAt103.map(
    (signature) => `ALTER FUNCTION ${signature} ROWS 1`,
  ),
};
