/**
 * A job a usage limit stopped on the runner that claimed it is resumed by the
 * execution scheduler, as a person would resume it, once its account's agent
 * is no longer paused, until it has been stopped so as many times at its place
 * as the scheduler's own bound allows.
 *
 * A RATE LIMIT IS READ OFF THE ROWS, NEVER STORED. A task was stopped so where
 * its execution concluded `ProcessFailed` on a last attempt a runner claimed
 * that was withdrawn `RunRateLimited`, having spent no retry. Its account and
 * agent are the ones `execution_attempt_agent_account` derives from that
 * attempt, and it may run again where `agent_account_pause` answers them
 * unpaused, or a press lets one claim through. An attempt that spent no account
 * left no limit to ask about, so it may run again an hour after it ended, as a
 * limit whose reset is unknown pauses for that hour.
 *
 * AN ESCALATION IS ONE WHERE EVERY TASK IT WAITS ON MAY RUN AGAIN, AND ONE WAS
 * STOPPED SO. Each task it waits on, found as 061 finds them, was either lost
 * on its runner under 061's rule and bound, or stopped by a limit under this
 * one. One whose tasks were all lost is 061's alone, so the two doors never
 * answer one desk. A Fail, a block and a task still running each make it a
 * person's.
 *
 * THE COUNT IS PER PLACE IN THE TICKET, BACK TO THE LAST TASK THERE THAT WAS
 * NEITHER. It counts the tasks a limit stopped at 061's place, back to the
 * newest there that was neither stopped so nor lost on its runner, so a resume
 * by a person does not start it again and a pass or a Fail does. Passing over
 * the losses, where 061's count stops at a rate-limited task, bounds work that
 * alternates between the two: this count only grows across it.
 *
 * THE SCHEDULER REACHES THE MAILBOX THROUGH ACCEPTANCE ITSELF, as at 061's
 * door, under a key of its own per desk. The door asks the rule again under
 * the project lock, so a pause that began after the ticket was read refuses
 * the answer rather than sending one computed before it.
 */

import {
  agentAccountFunction,
  agentAccountPauseFunction,
  boundaryOwnerRole,
  rateLimitResumeFunction,
  rateLimitedTicketsFunction,
  schedulerRole,
  ticketRateLimitResumableFunction,
  type Migration,
} from "../shared.ts";

const resumable = `public.${ticketRateLimitResumableFunction}(in_tenant text, in_project text, in_ticket bigint, in_losses_max bigint, in_rate_limits_max bigint)`;

const limitedTickets = `public.${rateLimitedTicketsFunction}(in_losses_max bigint, in_rate_limits_max bigint, in_tickets_max integer)`;

const resume = `public.${rateLimitResumeFunction}(in_tenant text, in_project text, in_ticket bigint, in_losses_max bigint, in_rate_limits_max bigint, in_operation text, in_authority_subject text, in_ordinary_soft_limit bigint, in_hard_limit bigint)`;

/** The key the scheduler answers one desk under, so a desk is answered once. */
function deskKey(action: string): string {
  return `encode(sha256(convert_to('rate-limit:' || ${action}, 'UTF8')), 'hex')`;
}

/** Whether task `other` stands at the same place in the ticket as `task`. */
function samePlace(other: string, task: string): string {
  return `${other}.kind = ${task}.kind
            AND ${other}.stage IS NOT DISTINCT FROM ${task}.stage
            AND ${other}.evaluator IS NOT DISTINCT FROM ${task}.evaluator`;
}

/** How many tasks at `task`'s place up to it match `counted`, back to the newest before it matching `stops`. */
export function placeCount(
  task: string,
  counted: (other: string) => string,
  stops: (other: string) => string,
): string {
  return `(SELECT count(*) FROM ran r
            WHERE ${samePlace("r", task)} AND ${counted("r")}
              AND r.task <= ${task}.task
              AND r.task > COALESCE((
                SELECT max(b.task) FROM ran b
                 WHERE ${samePlace("b", task)}
                   AND b.task < ${task}.task AND ${stops("b")}), 0))`;
}

/** The owner a function is installed under, callable by `role` or by nobody but its owner. */
function owned(signature: string, role?: string): readonly string[] {
  return [
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    ...(role === undefined
      ? []
      : [`GRANT EXECUTE ON FUNCTION ${signature} TO ${role}`]),
  ];
}

export const migration111: Migration = {
  version: 111,
  name: "a job a usage limit stopped on its runner is resumed by the scheduler",
  statements: [
    `CREATE FUNCTION ${resumable} RETURNS boolean
       LANGUAGE sql STABLE
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
       )
       SELECT EXISTS (
                SELECT 1 FROM ticket_projection t
                 WHERE t.tenant = in_tenant AND t.project = in_project
                   AND t.ticket = in_ticket
                   AND t.escalation IN ('WorkFailureEscalated', 'EvaluationBlockedEscalated'))
          AND EXISTS (SELECT 1 FROM counted c WHERE c.limited)
          AND NOT EXISTS (
                SELECT 1 FROM counted c
                 WHERE NOT COALESCE(
                   (c.lost AND c.losses < in_losses_max)
                   OR (c.limited AND c.limits < in_rate_limits_max
                       AND (SELECT CASE
                                     WHEN s.principal IS NULL OR s.agent IS NULL
                                       THEN c.ended_at + interval '1 hour' <= now()
                                     ELSE (SELECT h.paused_until IS NULL OR h.admitted_by_press
                                             FROM ${agentAccountPauseFunction}(s.principal, s.agent) h)
                                   END
                              FROM ${agentAccountFunction}(in_tenant, in_project,
                                     c.execution, c.attempt) s)),
                   false))
     $$`,
    ...owned(resumable),
    `CREATE FUNCTION ${limitedTickets}
       RETURNS TABLE(tenant text, project text, ticket bigint)
       LANGUAGE sql STABLE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       SELECT a.tenant, a.project, a.ticket
         FROM native_action a
         JOIN project p ON p.tenant = a.tenant AND p.project = a.project
        WHERE a.state = 'Open' AND a.kind = 'TicketEscalation'
          AND p.lifecycle = 'Active'
          AND NOT EXISTS (
            SELECT 1 FROM operation o
             WHERE o.tenant = a.tenant AND o.project = a.project
               AND o.authority_kind = 'ExecutionScheduler'
               AND o.key_digest = ${deskKey("a.action")})
          AND ${ticketRateLimitResumableFunction}(a.tenant, a.project, a.ticket,
                in_losses_max, in_rate_limits_max)
        ORDER BY a.tenant, a.project, a.authorizing_seq
        LIMIT in_tickets_max
     $$`,
    ...owned(limitedTickets, schedulerRole),
    `CREATE FUNCTION ${resume}
       RETURNS TABLE(result text, operation text, ordinal bigint)
       LANGUAGE plpgsql SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       DECLARE desk record; command_text text; desk_key text; payload text;
         accepted record;
       BEGIN
         PERFORM 1 FROM project p
          WHERE p.tenant = in_tenant AND p.project = in_project FOR UPDATE;
         SELECT a.action, a.authorizing_seq INTO desk
           FROM native_action a
          WHERE a.tenant = in_tenant AND a.project = in_project
            AND a.ticket = in_ticket AND a.state = 'Open'
            AND a.kind = 'TicketEscalation';
         IF NOT FOUND OR NOT ${ticketRateLimitResumableFunction}(in_tenant,
              in_project, in_ticket, in_losses_max, in_rate_limits_max) THEN
           RETURN QUERY SELECT 'NotResumable'::text, NULL::text, NULL::bigint;
           RETURN;
         END IF;
         command_text := jsonb_build_object('version', 1,
           'command', 'ResolveNativeAction', 'action', desk.action,
           'authorizingSeq', desk.authorizing_seq, 'resolution', 'Resume')::text;
         desk_key := ${deskKey("desk.action")};
         payload := encode(sha256(convert_to(command_text, 'UTF8')), 'hex');
         SELECT * INTO accepted FROM accept_operation(
           in_tenant, in_project, in_operation, 'ExecutionScheduler',
           in_authority_subject, 'scheduler-v1', desk_key, payload,
           ARRAY[desk_key], ARRAY[payload], command_text,
           in_ordinary_soft_limit, in_hard_limit, NULL);
         RETURN QUERY SELECT accepted.result::text, accepted.operation::text,
           accepted.ordinal::bigint;
       END
     $$`,
    ...owned(resume, schedulerRole),
  ],
};
