/**
 * A ticket a usage limit stopped is free to resume once a runner of the
 * account its task spent would take the job on a credential it names, as
 * that runner's claim would.
 *
 * A LIMITED TASK'S ACCOUNT IS FREE WHERE A CLAIM'S PAUSE RULE WOULD LET ONE
 * THROUGH: `agent_account_pause` answers the agent unpaused or admitted by a
 * press, as 111 asks; or a runner of the account names credentials of the
 * agent, and `agent_account_named_pause` answers those unpaused or admitted.
 * A runner of the account is a pool of the ticket's project its member
 * registered, or a personal runner of that member listing the project, where
 * the task's execution is that member's and names an owner fallback, as the
 * personal claim asks. A runner naming none of the agent adds nothing. That is
 * the pause rule alone: what else decides whether a runner takes the job stays
 * the claim's. A task that spent no account still waits an hour from its end.
 *
 * `ticket_usage_resume` ANSWERS THE TIME THAT RULE WAITS FOR: per limited task
 * the earliest end among those pauses, none where one is free, and across the
 * tasks the latest still ahead, as 112 answers.
 *
 * THE OWNER READS EACH RUNNER'S NAMES, so it is granted that column of each.
 * Both functions keep their signatures, owners and callers, and each restates
 * what `CREATE OR REPLACE` would reset.
 */

import {
  agentAccountFunction,
  agentAccountNamedPauseFunction,
  agentAccountPauseFunction,
  boundaryOwnerRole,
  ticketRateLimitResumableFunction,
  ticketUsageResumeFunction,
  type Migration,
} from "../shared.ts";
import { placeCount } from "./111-rate-limit-resume.ts";

const resumable = `public.${ticketRateLimitResumableFunction}(in_tenant text, in_project text, in_ticket bigint, in_losses_max bigint, in_rate_limits_max bigint)`;

const usageResume = `public.${ticketUsageResumeFunction}(in_tenant text, in_project text, in_ticket bigint, in_losses_max bigint, in_rate_limits_max bigint)`;

/** The credentials each runner of account `spent` names of its agent, for the task of `task`, one row each. */
function heldNamed(task: string, spent: string): string {
  return `SELECT w.credentials_named->${spent}.agent AS named
              FROM worker_pool w
             WHERE w.tenant = in_tenant AND w.project = in_project
               AND w.registered_by = ${spent}.principal
               AND w.credentials_named->${spent}.agent IS NOT NULL
            UNION ALL
            SELECT r.credentials_named->${spent}.agent
              FROM personal_runner r
              JOIN personal_runner_project l
                ON l.tenant = r.tenant AND l.owner = r.owner
               AND l.project = in_project
              JOIN execution x
                ON x.tenant = in_tenant AND x.project = in_project
               AND x.execution = ${task}.execution
             WHERE r.tenant = in_tenant AND r.owner = ${spent}.principal
               AND x.owner = r.owner AND x.owner_fallback IS NOT NULL
               AND r.credentials_named->${spent}.agent IS NOT NULL`;
}

/** Until when the limited task of `task`, whose account is `spent`, waits: none where a pause rule lets a claim through, else the earliest end among its account's pauses. */
function heldUntil(task: string, spent: string): string {
  return `CASE WHEN ${spent}.principal IS NULL OR ${spent}.agent IS NULL
               THEN ${task}.ended_at + interval '1 hour'
             ELSE (SELECT CASE WHEN bool_or(p.paused_until IS NULL OR p.admitted_by_press)
                                 THEN NULL
                               ELSE min(p.paused_until) END
                     FROM (SELECT h.paused_until, h.admitted_by_press
                             FROM ${agentAccountPauseFunction}(${spent}.principal, ${spent}.agent) h
                           UNION ALL
                           SELECT n.paused_until, n.admitted_by_press
                             FROM (${heldNamed(task, spent)}) k
                            CROSS JOIN LATERAL ${agentAccountNamedPauseFunction}(
                                    ${spent}.principal, ${spent}.agent,
                                    ARRAY(SELECT jsonb_array_elements_text(k.named))) n) p)
           END`;
}

/** The tasks the ticket's newest spawn waits on, each counted at its place as 111 counts it, and until when each a limit stopped waits. */
const held = `WITH ran AS (
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
                CASE WHEN c.limited THEN ${heldUntil("c", "s")} END AS until
           FROM counted c
           LEFT JOIN LATERAL ${agentAccountFunction}(in_tenant, in_project,
                  c.execution, c.attempt) s ON c.limited
       )`;

export const migration166: Migration = {
  version: 166,
  name: "a ticket a usage limit stopped resumes once a credential its runner named is free",
  statements: [
    `GRANT SELECT(credentials_named) ON TABLE public.worker_pool TO ${boundaryOwnerRole}`,
    `GRANT SELECT(credentials_named) ON TABLE public.personal_runner TO ${boundaryOwnerRole}`,
    `CREATE OR REPLACE FUNCTION ${resumable} RETURNS boolean
       LANGUAGE sql STABLE
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       ${held}
       SELECT EXISTS (
                SELECT 1 FROM ticket_projection t
                 WHERE t.tenant = in_tenant AND t.project = in_project
                   AND t.ticket = in_ticket
                   AND t.escalation IN ('WorkFailureEscalated', 'EvaluationBlockedEscalated'))
          AND EXISTS (SELECT 1 FROM held h WHERE h.limited)
          AND NOT EXISTS (
                SELECT 1 FROM held h
                 WHERE NOT COALESCE(
                   (h.lost AND h.losses < in_losses_max)
                   OR (h.limited AND h.limits < in_rate_limits_max
                       AND (h.until IS NULL OR h.until <= now())),
                   false))
     $$`,
    `CREATE OR REPLACE FUNCTION ${usageResume}
       RETURNS TABLE(paused_until timestamp with time zone)
       LANGUAGE sql STABLE SECURITY DEFINER ROWS 1
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       ${held}
       SELECT max(h.until) FILTER (WHERE h.until > now())
         FROM held h
        WHERE EXISTS (
                SELECT 1 FROM ticket_projection t
                  JOIN project p ON p.tenant = t.tenant AND p.project = t.project
                 WHERE t.tenant = in_tenant AND t.project = in_project
                   AND t.ticket = in_ticket
                   AND p.lifecycle = 'Active'
                   AND t.escalation IN ('WorkFailureEscalated', 'EvaluationBlockedEscalated'))
       HAVING bool_or(h.limited)
          AND bool_and((h.lost AND h.losses < in_losses_max)
                       OR (h.limited AND h.limits < in_rate_limits_max))
     $$`,
  ],
};
