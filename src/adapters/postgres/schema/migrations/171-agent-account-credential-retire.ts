/**
 * A person retires a credential of an agent of their account: its readings
 * and its limit are dropped, so the account reads it no more.
 *
 * `retire_agent_account_credential` DELETES THAT PRINCIPAL'S ROWS of
 * `agent_account_usage` and `agent_account_limit` for the agent and the
 * credential, under the lock per account's agent `agent_account_credential_kept`
 * takes, so a retirement and a first reading of another credential at the
 * bound are ordered. It answers `Retired`, or `NotHeld` where no row named the
 * credential.
 *
 * IT REFUSES WITH `CredentialInUse` while a live runner of the account still
 * names the credential of the agent in `credentials_named`: a personal runner
 * or a chat host it owns by its last poll, and a pool it registered by the
 * later of its two polls, each within `agentAccountRunnerPolledSecsMaxAt171`,
 * as `agent_account_pause` reads them. Such a runner's next run would report
 * it again, undoing the retirement without the person knowing.
 *
 * A CREDENTIAL THAT REPORTS AGAIN AFTER RETIREMENT IS KEPT AGAIN, as any
 * credential not kept is: retiring forgets its rows and refuses nothing a run
 * reports later. The API is its only caller.
 */

import {
  agentAccountCredentialRetireFunction,
  apiRole,
  boundaryOwnerRole,
  type Migration,
} from "../shared.ts";

/** How long after its last poll a runner's names still hold a credential from retirement. */
export const agentAccountRunnerPolledSecsMaxAt171 = 120;

const retire = `public.${agentAccountCredentialRetireFunction}(in_principal text, in_agent text, in_credential text)`;

const polledSince = `now()-make_interval(secs=>${String(agentAccountRunnerPolledSecsMaxAt171)})`;

export const migration171: Migration = {
  version: 171,
  name: "a person retires a credential of their agent account, its readings and its limit dropped",
  statements: [
    `CREATE FUNCTION ${retire} RETURNS text
       LANGUAGE plpgsql VOLATILE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         DECLARE readings integer; limits integer;
         BEGIN
           PERFORM pg_advisory_xact_lock(hashtextextended(
             'agent-account-credential:' || in_principal || '/' || in_agent, 0));
           IF NOT EXISTS(SELECT 1 FROM agent_account_usage u
                          WHERE u.principal=in_principal AND u.agent=in_agent
                            AND u.credential=in_credential)
              AND NOT EXISTS(SELECT 1 FROM agent_account_limit l
                              WHERE l.principal=in_principal AND l.agent=in_agent
                                AND l.credential=in_credential) THEN
             RETURN 'NotHeld';
           END IF;
           IF EXISTS(SELECT 1 FROM personal_runner r
                      WHERE r.owner=in_principal AND r.last_polled_at>${polledSince}
                        AND COALESCE(r.credentials_named->in_agent ? in_credential,false))
              OR EXISTS(SELECT 1 FROM worker_pool w
                         WHERE w.registered_by=in_principal
                           AND greatest(w.last_polled_at,w.executions_polled_at)>${polledSince}
                           AND COALESCE(w.credentials_named->in_agent ? in_credential,false))
              OR EXISTS(SELECT 1 FROM chat_host h
                         WHERE h.owner=in_principal AND h.last_polled_at>${polledSince}
                           AND COALESCE(h.credentials_named->in_agent ? in_credential,false)) THEN
             RETURN 'CredentialInUse';
           END IF;
           DELETE FROM agent_account_usage u
            WHERE u.principal=in_principal AND u.agent=in_agent
              AND u.credential=in_credential;
           GET DIAGNOSTICS readings = ROW_COUNT;
           DELETE FROM agent_account_limit l
            WHERE l.principal=in_principal AND l.agent=in_agent
              AND l.credential=in_credential;
           GET DIAGNOSTICS limits = ROW_COUNT;
           IF readings + limits = 0 THEN
             RAISE EXCEPTION 'retire_agent_account_credential: a held credential deleted no row';
           END IF;
           RETURN 'Retired';
         END $$`,
    `ALTER FUNCTION ${retire} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${retire} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${retire} TO ${apiRole}`,
  ],
};
