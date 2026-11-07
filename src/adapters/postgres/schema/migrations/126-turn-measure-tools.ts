/**
 * A turn's measurement may name more tools, so the epic tools fit beside the
 * rest of the roster.
 *
 * `session_turn_measure_is_bounded` IS REPLACED with the tool count and the
 * joined names' length it held, raised together: a name may weigh as much as
 * it did and the count it is multiplied by is larger, so no stored row is
 * refused by the new constraint. Every other bound in it is as it was.
 */

import type { Migration } from "../shared.ts";

/** The tool count the baseline's constraint held, raised. */
const toolsMax = 80;

/** The length of the names joined by commas, raised in proportion. */
const joinedCharsMax = 10_320;

export const migration126: Migration = {
  version: 126,
  name: "a turn's measurement may name more tools",
  statements: [
    `ALTER TABLE public.session_turn
       DROP CONSTRAINT session_turn_measure_is_bounded,
       ADD CONSTRAINT session_turn_measure_is_bounded CHECK (((COALESCE(tokens, (0)::bigint) >= 0) AND (COALESCE(cost_micros, (0)::bigint) >= 0) AND (COALESCE(duration_ms, (0)::bigint) >= 0) AND ((COALESCE(length(model), 1) >= 1) AND (COALESCE(length(model), 1) <= 256)) AND (COALESCE(cardinality(tools), 0) <= ${String(toolsMax)}) AND (COALESCE(length(array_to_string(tools, ','::text)), 0) <= ${String(joinedCharsMax)})))`,
  ],
};
