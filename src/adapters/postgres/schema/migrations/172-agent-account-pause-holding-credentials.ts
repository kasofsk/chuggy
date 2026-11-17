/**
 * A person reads which credentials hold their agent's pause.
 *
 * `agent_account_pause_holding` IS 170'S RULE, moved whole, answering beside
 * its columns the names of the credentials it counted that hold the pause, in
 * the order `agent_account_credential_standing` lists them: every name the
 * account's live runners give where they give any, each paused while the agent
 * is, or every paused credential where they give none. It answers none while
 * the agent is not paused. No role is granted it: only the two functions
 * below, installed under its owner, call it.
 *
 * `agent_account_pause` ANSWERS EVERY COLUMN OF IT BUT THE NAMES, its
 * signature, its answer's shape, its owner and its grants kept, so every
 * caller goes on reading the one rule.
 *
 * `agent_account_standing` GAINS `pause_credentials`, those names, and is
 * dropped and created again for the column, its owner and its grant restored.
 * The API is its only caller.
 */

import {
  agentAccountCredentialPauseFunction,
  agentAccountNamedPauseFunction,
  agentAccountPauseFunction,
  agentAccountPauseHoldingFunction,
  agentAccountSettingsFunction,
  agentAccountStandingFunction,
  apiRole,
  boundaryOwnerRole,
  type Migration,
} from "../shared.ts";
import { agentAccountRunnerPolledSecsMaxAt170 } from "./170-agent-account-pause-live-credentials.ts";

const holding = `public.${agentAccountPauseHoldingFunction}(in_principal text, in_agent text)`;

const pause = `public.${agentAccountPauseFunction}(in_principal text, in_agent text)`;

const standing = `public.${agentAccountStandingFunction}(in_principal text)`;

const polledSince = `now()-make_interval(secs=>${String(agentAccountRunnerPolledSecsMaxAt170)})`;

export const migration172: Migration = {
  version: 172,
  name: "a person reads which credentials hold their agent's pause",
  statements: [
    `CREATE FUNCTION ${holding}
       RETURNS TABLE(paused_until timestamp with time zone, reasons text[],
         admitted_by_press boolean, credentials text[])
       LANGUAGE sql STABLE
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         WITH live AS (
           SELECT r.credentials_named->in_agent AS named
             FROM personal_runner r
            WHERE r.owner=in_principal AND r.last_polled_at>${polledSince}
           UNION ALL
           SELECT w.credentials_named->in_agent
             FROM worker_pool w
            WHERE w.registered_by=in_principal
              AND greatest(w.last_polled_at,w.executions_polled_at)>${polledSince}
           UNION ALL
           SELECT h.credentials_named->in_agent
             FROM chat_host h
            WHERE h.owner=in_principal AND h.last_polled_at>${polledSince}),
         given AS (
           SELECT ARRAY(SELECT DISTINCT n.credential
                          FROM live l
                         CROSS JOIN LATERAL jsonb_array_elements_text(l.named) n(credential)
                         WHERE l.named IS NOT NULL) AS credentials),
         held AS (
           SELECT c.credential, c.paused_until, c.reasons
             FROM ${agentAccountCredentialPauseFunction}(in_principal,in_agent) c),
         counted AS (
           SELECT h.credential FROM held h CROSS JOIN given g
            WHERE cardinality(g.credentials)=0 OR h.credential=ANY(g.credentials)),
         holding AS (
           SELECT DISTINCT r.reason FROM held h CROSS JOIN LATERAL unnest(h.reasons) r(reason)),
         limited AS (
           SELECT max(l.observed_at) AS observed_at
             FROM held h
             JOIN agent_account_limit l
               ON l.principal=in_principal AND l.agent=in_agent
              AND l.credential=h.credential
            WHERE 'limit'=ANY(h.reasons)),
         answered AS (
           SELECT n.paused_until, n.reasons, n.admitted_by_press
             FROM given g
            CROSS JOIN LATERAL ${agentAccountNamedPauseFunction}(in_principal,in_agent,g.credentials) n
            WHERE cardinality(g.credentials)>0
           UNION ALL
           SELECT (SELECT max(h.paused_until) FROM held h),
                  (SELECT COALESCE(array_agg(r.reason ORDER BY r.reason),'{}'::text[])
                     FROM holding r),
                  COALESCE((SELECT bool_and(r.reason='limit') FROM holding r),false)
                    AND EXISTS(SELECT 1 FROM agent_account_press p
                                CROSS JOIN limited m
                                WHERE p.principal=in_principal AND p.agent=in_agent
                                  AND p.spent_at IS NULL
                                  AND p.pressed_at>m.observed_at)
             FROM given g
            WHERE cardinality(g.credentials)=0)
         SELECT a.paused_until, a.reasons, a.admitted_by_press,
                CASE WHEN a.paused_until IS NULL THEN '{}'::text[]
                     ELSE ARRAY(SELECT c.credential FROM counted c
                                 ORDER BY c.credential COLLATE "C") END
           FROM answered a
       $$`,
    `ALTER FUNCTION ${holding} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${holding} FROM PUBLIC`,
    `CREATE OR REPLACE FUNCTION ${pause}
       RETURNS TABLE(paused_until timestamp with time zone, reasons text[], admitted_by_press boolean)
       LANGUAGE sql STABLE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         SELECT h.paused_until, h.reasons, h.admitted_by_press
           FROM ${agentAccountPauseHoldingFunction}(in_principal,in_agent) h
       $$`,
    `DROP FUNCTION ${standing}`,
    `CREATE FUNCTION ${standing}
       RETURNS TABLE(agent text, five_hour_percent smallint, seven_day_percent smallint,
         pauses_threads boolean,
         five_hour_utilization double precision, five_hour_resets_at timestamp with time zone,
         five_hour_observed_at timestamp with time zone,
         seven_day_utilization double precision, seven_day_resets_at timestamp with time zone,
         seven_day_observed_at timestamp with time zone,
         limit_window text, limit_resets_at timestamp with time zone,
         limit_observed_at timestamp with time zone,
         paused_until timestamp with time zone, reasons text[], admitted_by_press boolean,
         pause_credentials text[])
       LANGUAGE sql STABLE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       SELECT k.agent, t.five_hour_percent, t.seven_day_percent, t.pauses_threads,
              f.utilization, f.resets_at, f.observed_at,
              w.utilization, w.resets_at, w.observed_at,
              l.usage_window, l.resets_at, l.observed_at,
              h.paused_until, h.reasons, h.admitted_by_press, h.credentials
         FROM (VALUES (1, 'Claude'), (2, 'Codex')) k(position, agent)
        CROSS JOIN LATERAL ${agentAccountSettingsFunction}(in_principal, k.agent) t
        CROSS JOIN LATERAL ${agentAccountPauseHoldingFunction}(in_principal, k.agent) h
         LEFT JOIN LATERAL (
           SELECT u.utilization, u.resets_at, u.observed_at FROM agent_account_usage u
            WHERE u.principal = in_principal AND u.agent = k.agent
              AND u.usage_window = 'five_hour'
            ORDER BY u.observed_at DESC, u.credential
            LIMIT 1) f ON true
         LEFT JOIN LATERAL (
           SELECT u.utilization, u.resets_at, u.observed_at FROM agent_account_usage u
            WHERE u.principal = in_principal AND u.agent = k.agent
              AND u.usage_window = 'seven_day'
            ORDER BY u.observed_at DESC, u.credential
            LIMIT 1) w ON true
         LEFT JOIN LATERAL (
           SELECT n.usage_window, n.resets_at, n.observed_at FROM agent_account_limit n
            WHERE n.principal = in_principal AND n.agent = k.agent
            ORDER BY n.observed_at DESC, n.credential
            LIMIT 1) l ON true
        ORDER BY k.position
     $$`,
    `ALTER FUNCTION ${standing} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${standing} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${standing} TO ${apiRole}`,
  ],
};
