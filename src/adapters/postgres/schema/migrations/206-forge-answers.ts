/**
 * A proposal row keeps what the forge answered the newest merge and the
 * newest update of its branch, and the landings door answers the merge's.
 *
 * `finalization_change_proposal` GAINS `forge_answers`, an object keyed by the
 * act, each holding when it was asked and, once heard, when it was answered,
 * what it came to, and the forge's status and bounded message or the name of
 * the failure that reached no forge. Every existing row keeps none. The
 * finalizer writes it, so it is granted the update; the boundary owner reads
 * it for the door, as it already reads `merge_attempts`.
 *
 * THE LANDINGS DOOR IS DROPPED AND RECREATED as 192's answering the merges
 * asked and the newest merge's answer as well, because a result type cannot
 * change in place; its owner and grants are given again as 192 gave them.
 */

import {
  apiRole,
  boundaryOwnerRole,
  finalizerRole,
  schedulerRole,
  ticketLandingsReadFunction,
  ticketServiceRole,
  type Migration,
} from "../shared.ts";
import { migration192 } from "./192-target-paths-refused.ts";

const landingsSignature = `public.${ticketLandingsReadFunction}(in_tenant text, in_project text, in_ticket bigint, in_count integer)`;

/** The longest every kept answer of one row may be written as, together. */
const forgeAnswersCharsMaxAt206 = 8192;

/** One piece of 192's landings door and the piece that replaces it, each found exactly once. */
const landingsWidenings: readonly (readonly [string, string])[] = [
  [
    "hold_paths text[], hold_paths_truncated boolean)",
    "hold_paths text[], hold_paths_truncated boolean,\n                  merges_asked integer, merge_answer jsonb)",
  ],
  [
    "s.hold_paths_truncated\n",
    "s.hold_paths_truncated, c.merge_attempts, c.forge_answers->'merge'\n",
  ],
];

/** 192's landings door, answering the merges asked and the newest merge's answer as well. */
function migration206Landings(): string {
  const stood = migration192.statements.find((statement) =>
    statement.startsWith(`CREATE FUNCTION ${landingsSignature}`),
  );
  if (stood === undefined)
    throw new Error("migration 206: 192 no longer installs the landings door");
  return landingsWidenings.reduce((door, [from, to]) => {
    if (door.split(from).length !== 2)
      throw new Error(
        `migration 206: 192's landings door does not hold ${JSON.stringify(from)} exactly once`,
      );
    return door.replace(from, to);
  }, stood);
}

export const migration206: Migration = {
  version: 206,
  name: "a proposal row keeps what the forge answered its newest merge and update",
  statements: [
    `ALTER TABLE public.finalization_change_proposal
       ADD COLUMN forge_answers jsonb DEFAULT '{}'::jsonb NOT NULL,
       ADD CONSTRAINT finalization_change_proposal_forge_answers_are_bounded
         CHECK (((jsonb_typeof(forge_answers) = 'object'::text)
                 AND (length((forge_answers)::text) <= ${String(forgeAnswersCharsMaxAt206)})))`,
    `GRANT UPDATE (forge_answers)
       ON TABLE public.finalization_change_proposal TO ${finalizerRole}`,
    `GRANT SELECT (forge_answers)
       ON TABLE public.finalization_change_proposal TO ${boundaryOwnerRole}`,
    `DROP FUNCTION ${landingsSignature}`,
    migration206Landings(),
    `ALTER FUNCTION ${landingsSignature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${landingsSignature} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${landingsSignature} TO ${apiRole}`,
    `GRANT EXECUTE ON FUNCTION ${landingsSignature} TO ${ticketServiceRole}`,
    `GRANT EXECUTE ON FUNCTION ${landingsSignature} TO ${schedulerRole}`,
  ],
};
