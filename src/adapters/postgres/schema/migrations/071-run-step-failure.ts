/**
 * An escalated ticket's work or evaluation that stopped at a failed step of its
 * run is read off the rows, for the API to name the step, the attempt and the
 * size of the error text its worker kept.
 *
 * A STEP FAILURE IS READ OFF THE ROWS, NEVER STORED. A task stopped at one
 * where it concluded on an attempt that ended `Lost` under the label of its
 * clone, its setup, its commit, its push or its deadline, on any route. The
 * attempt is the newest that was not superseded, which is the one its settled
 * manifest names. The labels and the error file's path are written out rather
 * than read from their rosters, so this file goes on saying what it installed
 * when a roster grows.
 *
 * ITS TASKS ARE THE ONES `061` READS AS WAITING: the ticket's newest spawn's
 * that did not pass, on a ticket escalated as a work failure or a blocked
 * evaluation. The newest such task that stopped at a step is answered, and a
 * ticket with none answers nothing.
 */

import {
  apiRole,
  boundaryOwnerRole,
  ticketRunStepFailureFunction,
  type Migration,
} from "../shared.ts";

const failure = `public.${ticketRunStepFailureFunction}(in_tenant text, in_project text, in_ticket bigint)`;

export const migration071: Migration = {
  version: 71,
  name: "an escalated ticket's failed run step is read",
  statements: [
    `CREATE FUNCTION ${failure}
       RETURNS TABLE(execution text, attempt text, evidence text, error_bytes bigint)
       LANGUAGE sql STABLE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       SELECT e.execution, c.attempt, c.evidence, k.bytes
         FROM execution e
         JOIN LATERAL (
           SELECT a.attempt, a.state, a.evidence
             FROM execution_attempt a
            WHERE a.tenant = e.tenant AND a.project = e.project
              AND a.execution = e.execution AND a.state <> 'Superseded'
            ORDER BY a.attempt_number DESC
            LIMIT 1) c ON true
         LEFT JOIN worker_artifact_reservation k
           ON k.tenant = e.tenant AND k.project = e.project
          AND k.execution = e.execution AND k.attempt = c.attempt
          AND k.path = '.chuggy/worker-error.txt'
        WHERE e.tenant = in_tenant AND e.project = in_project
          AND e.ticket = in_ticket
          AND e.status = 'Terminal'
          AND e.outcome IS DISTINCT FROM 'Passed'
          AND c.state = 'Lost'
          AND c.evidence IN ('RunCloneFailed', 'RunSetupFailed',
            'RunCommitFailed', 'RunPushFailed', 'RunTimedOut')
          AND e.source_request = (
            SELECT q.request FROM execution_request q
             WHERE q.tenant = in_tenant AND q.project = in_project
               AND q.ticket = in_ticket
               AND q.kind IN ('SpawnWork', 'SpawnEvaluation')
             ORDER BY q.authorizing_seq DESC, q.effect_position DESC
             LIMIT 1)
          AND EXISTS (
            SELECT 1 FROM ticket_projection t
             WHERE t.tenant = in_tenant AND t.project = in_project
               AND t.ticket = in_ticket
               AND t.escalation IN ('WorkFailureEscalated', 'EvaluationBlockedEscalated'))
        ORDER BY e.task DESC
        LIMIT 1
     $$`,
    `ALTER FUNCTION ${failure} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${failure} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${failure} TO ${apiRole}`,
  ],
};
