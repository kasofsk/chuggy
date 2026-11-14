/**
 * The session plane tells a thread's pod whether its shell is handed its
 * credential, which holds only where a chat host whose poll named a set
 * placed the attempt.
 *
 * `read_session_attempt` answers `shell_credential_handed`, true where the
 * attempt is a chat host's of a thread and records the host's set, 180's
 * `session_attempt.host_capabilities`, and false on every other. The column
 * changes its return type, so it is dropped and created with 180's body and
 * the column added, under 154's owner and grant.
 */

import {
  boundaryOwnerRole,
  sessionAttemptReadFunction,
  workerPlaneRole,
  type Migration,
} from "../shared.ts";

const attempt = `public.${sessionAttemptReadFunction}(in_secret_digest text)`;

/** `roster` less what `named` leaves out, in `roster`'s order, and `roster` whole where `named` is NULL. */
function capabilitiesHeld(roster: string, named: string): string {
  return `CASE WHEN ${named} IS NULL THEN ${roster}
               ELSE ARRAY(SELECT c FROM unnest(${roster}) WITH ORDINALITY r(c,o)
                           WHERE c=ANY(${named}) ORDER BY o) END`;
}

const attemptRead = `CREATE FUNCTION ${attempt} RETURNS TABLE(tenant text, project text, session text, attempt text, generation bigint, kind text, principal text, capabilities text[], credential_slot text, agent_reference text, system_prompt text, auto_compact_window bigint, model text, effort text, fork_from text, system_prompt_own boolean, shell_credential_handed boolean, live boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT a.tenant,a.project,a.session,a.attempt,a.generation,s.kind,s.principal,
              ${capabilitiesHeld("s.capabilities", "a.host_capabilities")},
              s.credential_slot,s.agent_reference,s.system_prompt,
              s.auto_compact_window,
              CASE WHEN s.kind='Inquiry' THEN p.model ELSE s.model END,
              CASE WHEN s.kind='Inquiry' THEN p.effort ELSE s.effort END,
              p.agent_reference,
              CASE WHEN s.kind='Inquiry' THEN coalesce(p.system_prompt_own,false)
                   ELSE s.system_prompt_own END,
              (s.kind='Thread' AND a.holder_kind='ChatHost'
               AND a.host_capabilities IS NOT NULL),
              (a.state IN ('Placing','Running') AND s.state='Open'
               AND a.recovery_epoch=(SELECT epoch FROM recovery_epoch
                                      ORDER BY ordinal DESC LIMIT 1))
         FROM session_attempt a
         JOIN agent_session s ON s.tenant=a.tenant AND s.project=a.project
                             AND s.session=a.session
         LEFT JOIN agent_session p ON p.tenant=s.tenant AND p.project=s.project
                                  AND p.session=s.parent_session
        WHERE a.bearer_secret_digest=in_secret_digest
     $$`;

export const migration182: Migration = {
  version: 182,
  name: "a thread's pod is told whether its shell is handed its credential",
  statements: [
    `DROP FUNCTION ${attempt}`,
    attemptRead,
    `ALTER FUNCTION ${attempt} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${attempt} FROM PUBLIC`,
    `GRANT ALL ON FUNCTION ${attempt} TO ${workerPlaneRole}`,
  ],
};
