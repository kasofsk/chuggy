/**
 * The selector reads which credential slot its project's lead was opened on,
 * so a lead whose slot is not the one a decision opens with is replaced.
 *
 * `lead_session` IS DROPPED AND RECREATED, because a result type cannot change
 * in place: its body is 133's, answering `credential_slot` beside the rest,
 * under 133's owner and grants.
 */

import {
  boundaryOwnerRole,
  leadSessionFunction,
  selectorServiceRole,
  type Migration,
} from "../shared.ts";

const lead = `public.${leadSessionFunction}(in_tenant text, in_project text)`;

const leadRead = `CREATE FUNCTION ${lead} RETURNS TABLE(session text, state text, agent_reference text, system_prompt text, auto_compact_window bigint, model text, effort text, credential_slot text, tokens bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT s.session,s.state,s.agent_reference,s.system_prompt,
              s.auto_compact_window,s.model,s.effort,s.credential_slot,
              (SELECT t.tokens FROM session_turn t
                WHERE t.tenant=s.tenant AND t.project=s.project
                  AND t.session=s.session AND t.state='Answered'
                  AND t.input_kind='Observation'
                ORDER BY t.ordinal DESC LIMIT 1)
         FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.session=(SELECT candidate.session FROM agent_session candidate
        WHERE candidate.tenant=in_tenant AND candidate.project=in_project
          AND candidate.kind='Lead'
        ORDER BY (candidate.state='Open') DESC,candidate.opened_at DESC,
                 candidate.session DESC
        LIMIT 1)
     $$`;

export const migration143: Migration = {
  version: 143,
  name: "the selector reads the credential slot its lead was opened on",
  statements: [
    `DROP FUNCTION ${lead}`,
    leadRead,
    `ALTER FUNCTION ${lead} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${lead} FROM PUBLIC`,
    `GRANT ALL ON FUNCTION ${lead} TO ${selectorServiceRole}`,
  ],
};
