/**
 * A run its worker ended because a credential its job lists was not delivered
 * keeps that credential and why on its attempt, and is read as a failed step,
 * as 075 reads one its runner stopped for low disk.
 *
 * `execution_attempt` GAINS `credential_absent` AND `credential_absent_reason`,
 * both or neither, and both exactly where the attempt ended
 * `RunCredentialAbsent`: the name within the wire's bound on an identity, and
 * the reason one of the contract's `workerHeldCredentialAbsences`, each written
 * out so this file goes on saying what it installed when either moves. A
 * finished attempt is written once, so they are written by the same update
 * that ends it.
 *
 * `lose_worker_attempt` IS DROPPED AND RECREATED taking both as last
 * arguments defaulting to none, so every caller at its old arity resolves to
 * the same door; its body is the baseline's with both written, which its
 * owner is granted.
 *
 * `ticket_run_step_failure` IS DROPPED AND RECREATED answering both beside
 * the row 075 answered, its labels 075's and `RunCredentialAbsent`. Its return
 * type grows, which `CREATE OR REPLACE` cannot do, so its owner, its grant and
 * 103's estimate are given again.
 */

import {
  apiRole,
  boundaryOwnerRole,
  ticketRunStepFailureFunction,
  workerAttemptLostFunction,
  workerPlaneRole,
  type Migration,
} from "../shared.ts";

const lostOld = `public.${workerAttemptLostFunction}(in_secret_digest text, in_generation bigint, in_evidence text)`;
const lost = `public.${workerAttemptLostFunction}(in_secret_digest text, in_generation bigint, in_evidence text, in_credential text, in_reason text)`;
const lostCreated = `public.${workerAttemptLostFunction}(in_secret_digest text, in_generation bigint, in_evidence text, in_credential text DEFAULT NULL, in_reason text DEFAULT NULL)`;

const failure = `public.${ticketRunStepFailureFunction}(in_tenant text, in_project text, in_ticket bigint)`;

export const migration177: Migration = {
  version: 177,
  name: "a run ended for a credential not delivered keeps the credential and why, and is read as a failed step",
  statements: [
    `ALTER TABLE public.execution_attempt
       ADD COLUMN credential_absent text,
       ADD COLUMN credential_absent_reason text,
       ADD CONSTRAINT execution_attempt_credential_absent_is_whole
         CHECK ((credential_absent IS NULL) = (credential_absent_reason IS NULL)
            AND (credential_absent IS NULL)
              = (evidence IS DISTINCT FROM 'RunCredentialAbsent')
            AND (credential_absent IS NULL
              OR length(credential_absent) BETWEEN 1 AND 256)
            AND (credential_absent_reason IS NULL
              OR credential_absent_reason IN ('NotGranted', 'NotHeld',
                'NotEnabled', 'IssuerRefused', 'WorkerTooOld')))`,
    `GRANT UPDATE(credential_absent,credential_absent_reason)
       ON TABLE public.execution_attempt TO ${boundaryOwnerRole}`,
    `DROP FUNCTION ${lostOld}`,
    `CREATE FUNCTION ${lostCreated} RETURNS boolean
       LANGUAGE plpgsql SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         DECLARE bound record;
         BEGIN
           SELECT a.tenant,a.project,a.execution INTO bound
             FROM execution_attempt a
            WHERE a.capability_secret_digest=in_secret_digest;
           IF NOT FOUND THEN RETURN false; END IF;
           PERFORM 1 FROM execution e
            WHERE e.tenant=bound.tenant AND e.project=bound.project
              AND e.execution=bound.execution FOR UPDATE;
           UPDATE execution_attempt a
              SET state='Lost',evidence=in_evidence,ended_at=now(),
                  lease_owner=NULL,lease_expires_at=NULL,
                  credential_absent=in_credential,
                  credential_absent_reason=in_reason
            WHERE a.capability_secret_digest=in_secret_digest
              AND a.generation=in_generation AND a.state IN ('Placing','Running')
              AND a.recovery_epoch=(SELECT epoch FROM recovery_epoch
                                     ORDER BY ordinal DESC LIMIT 1);
           IF NOT FOUND THEN RETURN false; END IF;
           UPDATE execution e SET retries_spent=e.retries_spent+1,
                                  placement_backoff_from=now()
            WHERE e.tenant=bound.tenant AND e.project=bound.project
              AND e.execution=bound.execution
              AND e.status NOT IN ('Terminal','Cancelled');
           RETURN FOUND;
         END $$`,
    `ALTER FUNCTION ${lost} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${lost} FROM PUBLIC`,
    `GRANT ALL ON FUNCTION ${lost} TO ${workerPlaneRole}`,
    `DROP FUNCTION ${failure}`,
    `CREATE FUNCTION ${failure}
       RETURNS TABLE(execution text, attempt text, evidence text, error_bytes bigint,
                     credential_absent text, credential_absent_reason text)
       LANGUAGE sql STABLE SECURITY DEFINER ROWS 1
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       SELECT e.execution, c.attempt, c.evidence, k.bytes,
              c.credential_absent, c.credential_absent_reason
         FROM execution e
         JOIN LATERAL (
           SELECT a.attempt, a.state, a.evidence,
                  a.credential_absent, a.credential_absent_reason
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
            'RunCommitFailed', 'RunPushFailed', 'RunTimedOut', 'RunDiskLow',
            'RunCredentialAbsent')
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
