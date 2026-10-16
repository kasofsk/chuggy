/**
 * A job lost on the runner that claimed it is resumed by the execution
 * scheduler, as a person would resume it, until it has been lost as many times
 * as an attempt in the cluster may be.
 *
 * A RUNNER LOSS IS READ OFF THE ROWS, NEVER STORED. An execution was lost on
 * its runner where it concluded on an attempt a runner claimed that ended
 * `Lost` on its run failing, its lease lapsing or its fence. Every other end of
 * a claimed attempt is the run's own outcome or a hold, and is not one. The
 * evidences, the walls and the error file's path are written out rather than
 * read from their rosters, so this file goes on saying what it installed when
 * a roster grows.
 *
 * AN ESCALATION IS ONE WHERE EVERY TASK IT WAITS ON WAS. The escalation is a
 * work failure or a blocked evaluation, the two walls a lost run reaches, and
 * the function answers nothing for any other ticket, so a page of tickets
 * reads no loss for those. Its tasks are the ticket's newest spawn's that did
 * not pass: an escalated ticket spawns nothing, so its newest spawn is the work
 * or the stage it stopped at, and a resume of a blocked stage spawns only what
 * it asks again. A Fail, a block and a task still running each make it a
 * person's.
 *
 * THE COUNT IS PER PLACE IN THE TICKET, BACK TO THE LAST TASK NOT LOST THERE.
 * A resume runs the work, or the one evaluator, as a new task, so a count per
 * task would never pass one. The place is the work, or a stage's evaluator,
 * and the count runs back through the tasks lost there to the newest that was
 * not, so a resume by a person does not start it again and a pass or a Fail
 * does. `resumed` is how many of those the scheduler's own resume spawned,
 * found by the operation it keyed on the escalation it answered.
 *
 * THE SCHEDULER REACHES THE MAILBOX THROUGH ACCEPTANCE ITSELF. Its door builds
 * the person's own answer to the escalation's desk from rows it read under the
 * project lock, and hands it to `accept_operation` under its own authority, a
 * key per desk and the mailbox's bounds, so the answer is fenced, admitted
 * and kept as an answer typed in the console is. The writer decides it at its
 * serialized position like any other, and refuses it as `TicketChanged` where
 * the desk closed first. The door refuses a desk that is not a runner loss
 * under the bound it is handed, which is the scheduler's own retry budget.
 *
 * THE API READS THE LOSS THROUGH THE SAME FUNCTION, to name the runner, the
 * attempt and the size of the error text its worker kept. Neither role is
 * granted a column it did not already read.
 */

import {
  apiRole,
  boundaryOwnerRole,
  runnerLossResumeFunction,
  runnerLostTicketsFunction,
  schedulerRole,
  ticketRunnerLossFunction,
  type Migration,
} from "../shared.ts";

const loss = `public.${ticketRunnerLossFunction}(in_tenant text, in_project text, in_ticket bigint)`;

const lostTickets = `public.${runnerLostTicketsFunction}(in_losses_max bigint, in_tickets_max integer)`;

const resume = `public.${runnerLossResumeFunction}(in_tenant text, in_project text, in_ticket bigint, in_losses_max bigint, in_operation text, in_authority_subject text, in_ordinary_soft_limit bigint, in_hard_limit bigint)`;

/** The key the scheduler answers one desk under, so a desk is answered once. */
function deskKey(action: string): string {
  return `encode(sha256(convert_to('runner-loss:' || ${action}, 'UTF8')), 'hex')`;
}

/** The owner and the one grant every function here ends with, `role` the only caller. */
function owned(signature: string, role: string): readonly string[] {
  return [
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${signature} TO ${role}`,
  ];
}

export const migration061: Migration = {
  version: 61,
  name: "a job lost on its runner is resumed by the scheduler",
  statements: [
    `CREATE FUNCTION ${loss}
       RETURNS TABLE(execution text, attempt text, runner text, personal boolean,
         evidence text, error_bytes bigint, losses bigint, resumed bigint)
       LANGUAGE sql STABLE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       WITH resumes AS (
         SELECT d.decided_seq AS seq
           FROM native_action a
           JOIN operation o
             ON o.tenant = a.tenant AND o.project = a.project
            AND o.authority_kind = 'ExecutionScheduler'
            AND o.key_digest = ${deskKey("a.action")}
           JOIN decision_input d
             ON d.tenant = o.tenant AND d.project = o.project
            AND d.input_kind = 'Operation' AND d.input_id = o.operation
            AND d.state = 'Journaled'
          WHERE a.tenant = in_tenant AND a.project = in_project
            AND a.ticket = in_ticket AND a.kind = 'TicketEscalation'
       ),
       ran AS (
         SELECT e.execution, e.task, e.source_request, e.outcome,
                t.kind, t.stage, t.evaluator,
                q.authorizing_seq IN (SELECT r.seq FROM resumes r) AS resumed,
                c.attempt, c.pool AS runner, c.personal, c.evidence,
                COALESCE(e.status = 'Terminal' AND c.state = 'Lost'
                  AND c.evidence IN ('RunFailed', 'LeaseExpired', 'Fenced'),
                  false) AS lost
           FROM execution e
           JOIN execution_request q
             ON q.tenant = e.tenant AND q.project = e.project
            AND q.request = e.source_request
           JOIN execution_request_task t
             ON t.tenant = e.tenant AND t.project = e.project
            AND t.request = e.source_request AND t.task = e.task
           LEFT JOIN LATERAL (
             SELECT a.attempt, a.pool, a.personal, a.state, a.evidence
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
       runs AS (
         SELECT w.execution, w.task, w.attempt, w.runner, w.personal, w.evidence,
                count(*) AS losses, count(*) FILTER (WHERE r.resumed) AS resumed
           FROM waiting w
           JOIN ran r
             ON r.kind = w.kind
            AND r.stage IS NOT DISTINCT FROM w.stage
            AND r.evaluator IS NOT DISTINCT FROM w.evaluator
            AND r.task <= w.task
            AND r.task > COALESCE((
              SELECT max(b.task) FROM ran b
               WHERE b.kind = w.kind
                 AND b.stage IS NOT DISTINCT FROM w.stage
                 AND b.evaluator IS NOT DISTINCT FROM w.evaluator
                 AND b.task < w.task AND NOT b.lost), 0)
          WHERE w.lost
          GROUP BY w.execution, w.task, w.attempt, w.runner, w.personal, w.evidence
       )
       SELECT r.execution, r.attempt, r.runner, r.personal, r.evidence, k.bytes,
              max(r.losses) OVER (), max(r.resumed) OVER ()
         FROM runs r
         LEFT JOIN worker_artifact_reservation k
           ON k.tenant = in_tenant AND k.project = in_project
          AND k.execution = r.execution AND k.attempt = r.attempt
          AND k.path = '.chuggy/worker-error.txt'
        WHERE NOT EXISTS (SELECT 1 FROM waiting w WHERE NOT w.lost)
          AND EXISTS (
            SELECT 1 FROM ticket_projection t
             WHERE t.tenant = in_tenant AND t.project = in_project
               AND t.ticket = in_ticket
               AND t.escalation IN ('WorkFailureEscalated', 'EvaluationBlockedEscalated'))
        ORDER BY r.task DESC
        LIMIT 1
     $$`,
    ...owned(loss, apiRole),
    `CREATE FUNCTION ${lostTickets}
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
          AND EXISTS (
            SELECT 1 FROM ${ticketRunnerLossFunction}(a.tenant, a.project, a.ticket) l
             WHERE l.losses < in_losses_max)
        ORDER BY a.tenant, a.project, a.authorizing_seq
        LIMIT in_tickets_max
     $$`,
    ...owned(lostTickets, schedulerRole),
    `CREATE FUNCTION ${resume}
       RETURNS TABLE(result text, operation text, ordinal bigint)
       LANGUAGE plpgsql SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       DECLARE desk record; lost record; command_text text; desk_key text;
         payload text; accepted record;
       BEGIN
         PERFORM 1 FROM project p
          WHERE p.tenant = in_tenant AND p.project = in_project FOR UPDATE;
         SELECT a.action, a.authorizing_seq INTO desk
           FROM native_action a
          WHERE a.tenant = in_tenant AND a.project = in_project
            AND a.ticket = in_ticket AND a.state = 'Open'
            AND a.kind = 'TicketEscalation';
         IF NOT FOUND THEN
           RETURN QUERY SELECT 'NotResumable'::text, NULL::text, NULL::bigint;
           RETURN;
         END IF;
         SELECT * INTO lost
           FROM ${ticketRunnerLossFunction}(in_tenant, in_project, in_ticket);
         IF NOT FOUND OR lost.losses >= in_losses_max THEN
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
