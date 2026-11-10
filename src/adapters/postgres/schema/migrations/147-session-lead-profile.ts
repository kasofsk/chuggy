/**
 * One project's settings read carries the subsidized lead its lead runs as.
 *
 * `session_lead_profile` ANSWERS THE PROFILE ONLY WHERE THE OFFERING IS
 * `Subsidized`, as `session_lead_offering` resolves it, and no row otherwise.
 * It is one door rather than a grant of `read_subsidized_lead` beside the
 * offering, so the selector and the API resolve a project's lead from the one
 * answer: whatever a settings read joins it to, the profile it carries and the
 * offering it stands for cannot come apart.
 */

import {
  apiRole,
  boundaryOwnerRole,
  selectorServiceRole,
  sessionLeadOfferingFunction,
  sessionLeadProfileFunction,
  type Migration,
} from "../shared.ts";

const signature = `public.${sessionLeadProfileFunction}(in_tenant text, in_project text)`;

export const migration147: Migration = {
  version: 147,
  name: "one project's settings read carries the subsidized lead its lead runs as",
  statements: [
    `CREATE FUNCTION ${signature}
       RETURNS TABLE(credential_slot text, model text, effort text,
                     auto_compact_window bigint,
                     input_bytes_per_decision bigint, turn_tokens_max bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT l.credential_slot,l.model,l.effort,l.auto_compact_window,
              l.input_bytes_per_decision,l.turn_tokens_max
         FROM subsidized_lead l
        WHERE ${sessionLeadOfferingFunction}(in_tenant,in_project)='Subsidized'
     $$`,
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${signature} TO ${apiRole}`,
    `GRANT EXECUTE ON FUNCTION ${signature} TO ${selectorServiceRole}`,
  ],
};
