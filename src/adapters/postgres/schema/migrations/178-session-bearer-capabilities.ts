/**
 * A session bearer is answered with its session's capabilities, which the API
 * confines it by among its scope's routes.
 *
 * `authenticate_session_bearer` IS DROPPED AND RECREATED answering
 * `agent_session.capabilities` beside the row 094 answered, read live, so a
 * session whose capabilities are set again is confined by them from its next
 * request. Its return type grows, which `CREATE OR REPLACE` cannot do, so its
 * owner and its grant are given again.
 */

import {
  apiRole,
  boundaryOwnerRole,
  sessionBearerAuthenticateFunction,
  type Migration,
} from "../shared.ts";

const bearer = `public.${sessionBearerAuthenticateFunction}(in_secret_digest text)`;

export const migration178: Migration = {
  version: 178,
  name: "a session bearer is answered with its session's capabilities",
  statements: [
    `DROP FUNCTION ${bearer}`,
    `CREATE FUNCTION ${bearer}
       RETURNS TABLE(tenant text, project text, session text, kind text, principal text, scope text, capabilities text[])
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT a.tenant,a.project,a.session,s.kind,s.principal,s.scope,s.capabilities
         FROM session_attempt a
         JOIN agent_session s ON s.tenant=a.tenant AND s.project=a.project
                             AND s.session=a.session
        WHERE a.bearer_secret_digest=in_secret_digest
          AND a.state IN ('Placing','Running') AND s.state='Open'
          AND a.recovery_epoch=(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1)
     $$`,
    `ALTER FUNCTION ${bearer} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${bearer} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${bearer} TO ${apiRole}`,
  ],
};
