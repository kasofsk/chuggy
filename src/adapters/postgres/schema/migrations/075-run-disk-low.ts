/**
 * A run its runner stopped because its disk ran low is read as a failed step,
 * as 071 reads one that stopped at its clone, its setup, its commit, its push
 * or its deadline.
 *
 * `ticket_run_step_failure` IS REPLACED, its labels 071's and `RunDiskLow`,
 * written out so this file goes on saying what it installed when the roster
 * grows. `CREATE OR REPLACE` keeps the owner and grants 071 gave the function.
 */

import { ticketRunStepFailureFunction, type Migration } from "../shared.ts";

const failure = `public.${ticketRunStepFailureFunction}(in_tenant text, in_project text, in_ticket bigint)`;

export const migration075: Migration = {
  version: 75,
  name: "a run its runner stopped for low disk is read as a failed step",
  statements: [
    `CREATE OR REPLACE FUNCTION ${failure}
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
            'RunCommitFailed', 'RunPushFailed', 'RunTimedOut', 'RunDiskLow')
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
  ],
};
