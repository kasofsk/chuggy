/**
 * An execution that names no requirement may move from `Queued` to
 * `Terminal`, as `model/capacity.qnt`'s `legalStatusMove` now permits; one
 * that names a requirement moves exactly as it did.
 *
 * THE RULE READS THE ROW. `execution_status_move_is_legal` takes whether the
 * execution names a requirement as its third argument, and
 * `execution_moves_legally` is the baseline's with that argument read from
 * the row it guards: a requirement is named when `requirement_value` is.
 * `CREATE OR REPLACE` keeps the trigger function's owner and grants, and the
 * two-argument rule is dropped, so one table of moves stands.
 */

import { baselineFunctions } from "./baseline/functions.ts";
import {
  boundaryOwnerRole,
  schedulerRole,
  statusMoveFunction,
  type Migration,
} from "../shared.ts";

const callBefore = `${statusMoveFunction}(OLD.status, NEW.status)`;

/** The baseline's `execution_moves_legally`, calling the rule with the row's requirement. */
function migration152MovesLegally(): string {
  const stood = baselineFunctions.find((statement) =>
    statement.startsWith("CREATE FUNCTION execution_moves_legally()"),
  );
  if (stood === undefined || !stood.includes(callBefore))
    throw new Error(
      "migration 152: the baseline no longer installs the trigger function this rereads",
    );
  return stood
    .replace(
      "CREATE FUNCTION execution_moves_legally()",
      "CREATE OR REPLACE FUNCTION public.execution_moves_legally()",
    )
    .replace(
      callBefore,
      `${statusMoveFunction}(OLD.status, NEW.status, OLD.requirement_value IS NOT NULL)`,
    );
}

const rule = `public.${statusMoveFunction}(before text, after text, requirement_named boolean)`;

export const migration152: Migration = {
  version: 152,
  name: "an execution naming no requirement may go from Queued to Terminal",
  statements: [
    `CREATE FUNCTION ${rule} RETURNS boolean
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
       SELECT CASE before
         WHEN 'Queued'    THEN after IN ('Admitted', 'Cancelled')
                            OR (after = 'Terminal' AND NOT requirement_named)
         WHEN 'Admitted'  THEN after IN ('Launching', 'Terminal', 'Cancelled')
         WHEN 'Launching' THEN after IN ('Running', 'Terminal', 'Cancelled')
         WHEN 'Running'   THEN after IN ('Terminal', 'Cancelled')
         WHEN 'Terminal'  THEN after = 'Terminal'
         WHEN 'Cancelled' THEN after = 'Cancelled'
       END $$`,
    `ALTER FUNCTION ${rule} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${rule} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${rule} TO ${schedulerRole}`,
    migration152MovesLegally(),
    `DROP FUNCTION public.${statusMoveFunction}(before text, after text)`,
  ],
};
