/**
 * A person reads and sets how their own agent accounts pause, presses to try
 * one again, and sees what holds their work; the metrics plane reads every
 * account's pause.
 *
 * EACH DOOR IS HANDED ONE PRINCIPAL AND READS OR WRITES THAT ACCOUNT ALONE.
 * `agent_account_standing` answers each agent of it: the settings as
 * `agent_account_settings` answers them, each window's newest reading, the
 * newest limit, and the pause `agent_account_pause` answers. A write replaces
 * the settings of one agent whole. A press is recorded only while a limit is
 * among the reasons the agent is paused, and pressing again before it is spent
 * moves it to now.
 *
 * AN ESCALATION THE SCHEDULER WILL RESUME ONCE ITS PAUSES END IS READ AS 111
 * READS ONE, with the pause left out of what it asks: every task it waits on
 * lost under 061's bound or stopped by a limit under 111's, and one stopped so.
 * `ticket_usage_resume` answers when the latest pause still holding one of
 * those tasks ends, an hour after its end for a task that spent no account,
 * and nothing where none holds any longer. A place's count is built by 111's
 * own helper. It is estimated at one row, as 103 estimates the reads beside it.
 *
 * THE API CALLS THE RULE ITSELF for a waiting attempt's agent, so it is granted
 * that column of the attempt and the rule; the metrics plane is granted the
 * rule and the key of each relation an account appears in, as 108 grants it
 * columns alone.
 */

import {
  agentAccountFunction,
  agentAccountPauseFunction,
  agentAccountPressFunction,
  agentAccountSettingWriteFunction,
  agentAccountSettingsFunction,
  agentAccountStandingFunction,
  apiRole,
  boundaryOwnerRole,
  metricsPlaneRole,
  ticketUsageResumeFunction,
  type Migration,
} from "../shared.ts";
import { placeCount } from "./111-rate-limit-resume.ts";

const standing = `public.${agentAccountStandingFunction}(in_principal text)`;

const settingWrite = `public.${agentAccountSettingWriteFunction}(in_principal text, in_agent text, in_five_hour_percent smallint, in_seven_day_percent smallint, in_pauses_threads boolean, in_pauses_lead boolean)`;

const press = `public.${agentAccountPressFunction}(in_principal text, in_agent text)`;

const usageResume = `public.${ticketUsageResumeFunction}(in_tenant text, in_project text, in_ticket bigint, in_losses_max bigint, in_rate_limits_max bigint)`;

const pause = `public.${agentAccountPauseFunction}(in_principal text, in_agent text)`;

/** The owner a door is installed under, and `role` its only caller. */
function owned(signature: string, role: string): readonly string[] {
  return [
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${signature} TO ${role}`,
  ];
}

export const migration112: Migration = {
  version: 112,
  name: "a person reads and sets their own agent accounts' pauses, and the metrics plane reads every pause",
  statements: [
    `GRANT INSERT,UPDATE ON TABLE public.agent_account_setting TO ${boundaryOwnerRole}`,
    `GRANT INSERT,UPDATE ON TABLE public.agent_account_press TO ${boundaryOwnerRole}`,
    `CREATE FUNCTION ${standing}
       RETURNS TABLE(agent text, five_hour_percent smallint, seven_day_percent smallint,
         pauses_threads boolean, pauses_lead boolean,
         five_hour_utilization double precision, five_hour_resets_at timestamp with time zone,
         five_hour_observed_at timestamp with time zone,
         seven_day_utilization double precision, seven_day_resets_at timestamp with time zone,
         seven_day_observed_at timestamp with time zone,
         limit_window text, limit_resets_at timestamp with time zone,
         limit_observed_at timestamp with time zone,
         paused_until timestamp with time zone, reasons text[], admitted_by_press boolean)
       LANGUAGE sql STABLE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       SELECT k.agent, t.five_hour_percent, t.seven_day_percent,
              t.pauses_threads, t.pauses_lead,
              f.utilization, f.resets_at, f.observed_at,
              w.utilization, w.resets_at, w.observed_at,
              l.usage_window, l.resets_at, l.observed_at,
              h.paused_until, h.reasons, h.admitted_by_press
         FROM (VALUES (1, 'Claude'), (2, 'Codex')) k(position, agent)
        CROSS JOIN LATERAL ${agentAccountSettingsFunction}(in_principal, k.agent) t
        CROSS JOIN LATERAL ${agentAccountPauseFunction}(in_principal, k.agent) h
         LEFT JOIN agent_account_usage f
           ON f.principal = in_principal AND f.agent = k.agent
          AND f.usage_window = 'five_hour'
         LEFT JOIN agent_account_usage w
           ON w.principal = in_principal AND w.agent = k.agent
          AND w.usage_window = 'seven_day'
         LEFT JOIN agent_account_limit l
           ON l.principal = in_principal AND l.agent = k.agent
        ORDER BY k.position
     $$`,
    ...owned(standing, apiRole),
    `CREATE FUNCTION ${settingWrite} RETURNS void
       LANGUAGE sql VOLATILE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       INSERT INTO agent_account_setting AS kept
           (principal, agent, five_hour_percent, seven_day_percent,
            pauses_threads, pauses_lead)
         VALUES (in_principal, in_agent, in_five_hour_percent, in_seven_day_percent,
                 in_pauses_threads, in_pauses_lead)
       ON CONFLICT (principal, agent) DO UPDATE
         SET five_hour_percent = EXCLUDED.five_hour_percent,
             seven_day_percent = EXCLUDED.seven_day_percent,
             pauses_threads = EXCLUDED.pauses_threads,
             pauses_lead = EXCLUDED.pauses_lead
     $$`,
    ...owned(settingWrite, apiRole),
    `CREATE FUNCTION ${press} RETURNS boolean
       LANGUAGE sql VOLATILE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       WITH pressed AS (
         INSERT INTO agent_account_press AS kept (principal, agent, pressed_at)
           SELECT in_principal, in_agent, now()
             FROM ${agentAccountPauseFunction}(in_principal, in_agent) h
            WHERE 'limit' = ANY(h.reasons)
         ON CONFLICT (principal, agent) DO UPDATE
           SET pressed_at = EXCLUDED.pressed_at, spent_at = NULL
         RETURNING 1)
       SELECT EXISTS (SELECT 1 FROM pressed)
     $$`,
    ...owned(press, apiRole),
    `CREATE FUNCTION ${usageResume}
       RETURNS TABLE(paused_until timestamp with time zone)
       LANGUAGE sql STABLE SECURITY DEFINER ROWS 1
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       WITH ran AS (
         SELECT e.execution, e.task, e.source_request, e.outcome,
                t.kind, t.stage, t.evaluator, c.attempt, c.ended_at,
                COALESCE(e.status = 'Terminal' AND c.state = 'Lost'
                  AND c.evidence IN ('RunFailed', 'LeaseExpired', 'Fenced'),
                  false) AS lost,
                COALESCE(e.status = 'Terminal' AND e.outcome = 'ProcessFailed'
                  AND e.retries_spent = 0 AND c.claimed_at IS NOT NULL AND c.state = 'Withdrawn'
                  AND c.evidence = 'RunRateLimited',
                  false) AS limited
           FROM execution e
           JOIN execution_request_task t
             ON t.tenant = e.tenant AND t.project = e.project
            AND t.request = e.source_request AND t.task = e.task
           LEFT JOIN LATERAL (
             SELECT a.attempt, a.claimed_at, a.state, a.evidence, a.ended_at
               FROM execution_attempt a
              WHERE a.tenant = e.tenant AND a.project = e.project
                AND a.execution = e.execution AND a.pool IS NOT NULL
              ORDER BY a.attempt_number DESC
              LIMIT 1) c ON true
          WHERE e.tenant = in_tenant AND e.project = in_project
            AND e.ticket = in_ticket
       ),
       waiting AS (
         SELECT w.* FROM ran w
          WHERE w.outcome IS DISTINCT FROM 'Passed'
            AND w.source_request = (
              SELECT q.request FROM execution_request q
               WHERE q.tenant = in_tenant AND q.project = in_project
                 AND q.ticket = in_ticket
                 AND q.kind IN ('SpawnWork', 'SpawnEvaluation')
               ORDER BY q.authorizing_seq DESC, q.effect_position DESC
               LIMIT 1)
       ),
       counted AS (
         SELECT w.execution, w.attempt, w.ended_at, w.lost, w.limited,
                ${placeCount(
                  "w",
                  (r) => `${r}.lost`,
                  (b) => `NOT ${b}.lost`,
                )} AS losses,
                ${placeCount(
                  "w",
                  (r) => `${r}.limited`,
                  (b) => `NOT ${b}.lost AND NOT ${b}.limited`,
                )} AS limits
           FROM waiting w
       ),
       held AS (
         SELECT c.lost, c.limited, c.losses, c.limits,
                CASE WHEN NOT c.limited THEN NULL
                     WHEN s.principal IS NULL OR s.agent IS NULL
                       THEN c.ended_at + interval '1 hour'
                     WHEN h.admitted_by_press THEN NULL
                     ELSE h.paused_until
                END AS until
           FROM counted c
           LEFT JOIN LATERAL ${agentAccountFunction}(in_tenant, in_project,
                  c.execution, c.attempt) s ON c.limited
           LEFT JOIN LATERAL ${agentAccountPauseFunction}(s.principal, s.agent) h
             ON c.limited
       )
       SELECT max(h.until) FILTER (WHERE h.until > now())
         FROM held h
        WHERE EXISTS (
                SELECT 1 FROM ticket_projection t
                 WHERE t.tenant = in_tenant AND t.project = in_project
                   AND t.ticket = in_ticket
                   AND t.escalation IN ('WorkFailureEscalated', 'EvaluationBlockedEscalated'))
       HAVING bool_or(h.limited)
          AND bool_and((h.lost AND h.losses < in_losses_max)
                       OR (h.limited AND h.limits < in_rate_limits_max))
     $$`,
    ...owned(usageResume, apiRole),
    `GRANT SELECT(agent) ON TABLE public.execution_attempt TO ${apiRole}`,
    `GRANT EXECUTE ON FUNCTION ${pause} TO ${apiRole}`,
    `GRANT EXECUTE ON FUNCTION ${pause} TO ${metricsPlaneRole}`,
    `GRANT SELECT(principal,agent) ON TABLE public.agent_account_usage TO ${metricsPlaneRole}`,
    `GRANT SELECT(principal,agent) ON TABLE public.agent_account_limit TO ${metricsPlaneRole}`,
  ],
};
