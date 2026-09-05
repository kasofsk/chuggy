/**
 * What one lead turn's input may hold, widened to the refusals the observation
 * now carries, and the token budget re-floored against it.
 *
 * A REFUSAL IS SHOWN FOR EVERY CANDIDATE THE PAGE HELD. The observation's
 * refusals were one page of the project's standing and are now the standing
 * among the page's own tickets, so an observation may show one refusal per
 * candidate rather than the page a read of the project answered
 * (kasofsk/chuggy#574). `sessionTurnInputCharsMax` is derived from those parts
 * at their own ceilings, so it moved, and the generated check written at 058 and
 * replaced at 059 holds a migrated installation to the narrower figure for ever.
 * Replacing it here is what makes a migrated database and a fresh one end with
 * the same schema.
 *
 * THE FLOOR MOVES WITH IT FOR 070's OWN REASON. A budget under one whole legal
 * observation is one an owner turns into kasofsk/chuggy#552 by widening the
 * input alone, and widening the input is exactly what this migration does. It is
 * a floor and not a value, in 070's shape: an installation already standing
 * above it keeps what it states, the predicate is where the floor lives, and the
 * revision the raise mints is recorded like every other.
 */

import {
  sessionTurnInputCharsMax,
  sessionTurnResultCharsMax,
} from "../../../../contract/http.ts";
import { leadObservationTokensPerDecision } from "./070-lead-token-budget.ts";
import { type Migration } from "../shared.ts";

const widerObservation = [
  `ALTER TABLE session_turn
     DROP CONSTRAINT session_turn_text_is_bounded,
     ADD CONSTRAINT session_turn_text_is_bounded CHECK (
       length(input) BETWEEN 1 AND ${sessionTurnInputCharsMax}
       AND coalesce(length(result), 0) <= ${sessionTurnResultCharsMax})`,
  `UPDATE selector_runtime_settings
      SET controls=jsonb_set(controls::jsonb,'{limits,tokensPerDecision}',
            to_jsonb(${leadObservationTokensPerDecision}::bigint))::text,
          revision=revision+1,updated_at=now()
    WHERE singleton=1
      AND coalesce((controls::jsonb->'limits'->>'tokensPerDecision')::bigint,0)
            < ${leadObservationTokensPerDecision}`,
  `INSERT INTO selector_runtime_settings_history
     (revision,mode,dispatch_mode,base_prompt,controls,
      administrator_kind,administrator_subject)
     SELECT revision,mode,dispatch_mode,base_prompt,controls,'System','observed refusals migration'
       FROM selector_runtime_settings ON CONFLICT (revision) DO NOTHING`,
];

/** One refusal per candidate, in the mailbox row and in the budget over it. */
export const migration074: Migration = {
  version: 74,
  name: "an observation shows a refusal for every candidate its page held",
  statements: widerObservation,
};
