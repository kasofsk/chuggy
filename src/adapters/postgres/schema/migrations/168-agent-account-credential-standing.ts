/**
 * A person reads each credential of their agent accounts: its readings and the
 * pause that holds it.
 *
 * `agent_account_credential_standing` ANSWERS ONE ROW PER CREDENTIAL an agent
 * of the account holds a reading or a limit of, in roster order and then by
 * name: each window's reading of that credential, and
 * `agent_account_named_pause` of that one name, so a press reads as it lets
 * one claim through that credential's limit. The rows are those
 * `agent_account_credential_kept` bounds. `agent_account_standing` keeps its
 * answer. The API is its only caller.
 */

import {
  agentAccountCredentialStandingFunction,
  agentAccountNamedPauseFunction,
  apiRole,
  boundaryOwnerRole,
  type Migration,
} from "../shared.ts";

const standing = `public.${agentAccountCredentialStandingFunction}(in_principal text)`;

export const migration168: Migration = {
  version: 168,
  name: "a person reads each credential of their agent accounts, its readings and its own pause",
  statements: [
    `CREATE FUNCTION ${standing}
       RETURNS TABLE(agent text, credential text,
         five_hour_utilization double precision, five_hour_resets_at timestamp with time zone,
         five_hour_observed_at timestamp with time zone,
         seven_day_utilization double precision, seven_day_resets_at timestamp with time zone,
         seven_day_observed_at timestamp with time zone,
         paused_until timestamp with time zone, reasons text[], admitted_by_press boolean)
       LANGUAGE sql STABLE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       WITH held AS (
         SELECT u.agent, u.credential FROM agent_account_usage u
          WHERE u.principal = in_principal
         UNION
         SELECT l.agent, l.credential FROM agent_account_limit l
          WHERE l.principal = in_principal)
       SELECT h.agent, h.credential,
              f.utilization, f.resets_at, f.observed_at,
              w.utilization, w.resets_at, w.observed_at,
              p.paused_until, p.reasons, p.admitted_by_press
         FROM held h
         JOIN (VALUES (1, 'Claude'), (2, 'Codex')) k(position, agent) ON k.agent = h.agent
        CROSS JOIN LATERAL ${agentAccountNamedPauseFunction}(in_principal, h.agent, ARRAY[h.credential]) p
         LEFT JOIN agent_account_usage f
           ON f.principal = in_principal AND f.agent = h.agent
          AND f.credential = h.credential AND f.usage_window = 'five_hour'
         LEFT JOIN agent_account_usage w
           ON w.principal = in_principal AND w.agent = h.agent
          AND w.credential = h.credential AND w.usage_window = 'seven_day'
        ORDER BY k.position, h.credential COLLATE "C"
     $$`,
    `ALTER FUNCTION ${standing} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${standing} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${standing} TO ${apiRole}`,
  ],
};
