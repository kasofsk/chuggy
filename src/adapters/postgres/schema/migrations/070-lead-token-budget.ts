/**
 * What one lead turn may spend, raised from a figure written before a lead turn
 * had been measured to one a lead turn fits in.
 *
 * THE BUDGET REFUSED EVERY ANSWER IT WAS GIVEN. 010 seeded `tokensPerDecision`
 * for a policy that answered in one completion and 059 raised it to
 * `leadTokensPerDecision`, which is still under what every lead turn release 19
 * drove on the rig cost. `enforcePolicyControls` discarded each decision
 * `ControlViolation`, and the project tools those turns had already spent over
 * the API stood — a project tool is a command under the session bearer, not part
 * of the decision — so the record holds a lead that filed a ticket and released
 * it in a turn whose answer was thrown away. A control that refuses every answer
 * to work already done is not a control (kasofsk/chuggy#552).
 *
 * THE FIGURE IS NOT A CONTEXT SIZE, WHICH IS WHY THE SEEDED ONE READ AS PLAUSIBLE.
 * `images/worker/session.mjs` sums a turn's input, output, cache-creation and
 * cache-read counters over every model the runtime reports, so the whole context
 * is counted again at every model step the turn takes. Nothing in the settings
 * bounds those steps: `toolCallsPerDecision` is checked against the DISTINCT tool
 * names the pod reports, and what is left is the clock. So no worst case can be
 * derived from the limits, and the floor is derived from the input instead.
 *
 * THE FLOOR IS ONE WHOLE LEGAL OBSERVATION. `sessionTurnInputCharsMax` is what
 * 059 derived from the widest observation the runtime may compose, and a project
 * may raise `inputBytesPerDecision` to it; a token is never fewer than one
 * character, so a budget under that is one an owner turns into this same defect
 * by widening the input alone, without touching the budget. Every lead turn the
 * rig measured sits an order of magnitude under it, and a decision that spent
 * more than a whole widest observation is the runaway the control is for.
 *
 * A FLOOR AND NOT A VALUE, the shape 059, 061 and 064 wrote before it: an
 * installation already standing above it keeps what it states, the predicate is
 * where the floor lives and the assignment is the bare constant, and the
 * revision the raise mints is recorded like every other.
 */

import { sessionTurnInputCharsMax } from "../../../../contract/http.ts";
import { type Migration } from "../shared.ts";

/**
 * What one lead turn may spend, which is one whole legal observation read once:
 * a token is never fewer than one character, so the widest input the mailbox
 * holds is the token ceiling of reading what the runtime composed.
 */
export const leadObservationTokensPerDecision = sessionTurnInputCharsMax;

/** The installation's token budget, raised to what one observation may weigh. */
const installationTokenBudget = [
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
     SELECT revision,mode,dispatch_mode,base_prompt,controls,'System','lead token budget migration'
       FROM selector_runtime_settings ON CONFLICT (revision) DO NOTHING`,
];

/** What one lead turn may spend, against what one observation may weigh. */
export const migration070: Migration = {
  version: 70,
  name: "a decision's token budget is one whole observation",
  statements: installationTokenBudget,
};
