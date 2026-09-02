import { allSessionAttemptEvidences } from "../../../../interpreter/sessionScheduler.ts";
import {
  boundaryOwnerRole,
  schemaTextSet,
  sessionAttemptWithdrawFunction,
  workerAttemptWithdrawFunction,
  workerPlaneRole,
  type Migration,
} from "../shared.ts";

/**
 * This ledger entry is 60 because 59 is taken by the lead's decisions, which is
 * open rather than merged; the lead's tools take 61. The ledger is append-only,
 * so a number claimed by an open branch is a number this file does not reuse.
 */

/** The states an attempt is still live in, as every fence in 058 reads them. */
const liveStates = "('Placing','Running')";

/**
 * The one condition a pod may end its own attempt on. A pod that could name any
 * of the others could write provenance nobody else witnessed; this one it is the
 * only witness to.
 */
const holdEvidence = "AgentRateLimited";

/**
 * A hold on a work attempt: the attempt ends, the execution keeps its retry
 * budget, and the placement backoff paces the next one.
 *
 * It is a second function rather than a fourth argument to `lose_worker_attempt`
 * because the two differ in what they charge, and a boundary that takes the
 * charge as an argument is a boundary whose caller decides it. The caller here is
 * the worker plane, standing in front of a pod.
 */
const workerHold = [
  `CREATE FUNCTION ${workerAttemptWithdrawFunction}(
     in_secret_digest text,in_generation bigint,in_evidence text)
     RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
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
          SET state='Withdrawn',evidence=in_evidence,ended_at=now(),
              lease_owner=NULL,lease_expires_at=NULL
        WHERE a.capability_secret_digest=in_secret_digest
          AND a.generation=in_generation AND a.state IN ${liveStates}
          AND a.recovery_epoch=(SELECT epoch FROM recovery_epoch
                                 ORDER BY ordinal DESC LIMIT 1);
       IF NOT FOUND THEN RETURN false; END IF;
       UPDATE execution e SET placement_backoff_from=now()
        WHERE e.tenant=bound.tenant AND e.project=bound.project
          AND e.execution=bound.execution
          AND e.status NOT IN ('Terminal','Cancelled');
       RETURN FOUND;
     END $$`,
  `ALTER FUNCTION ${workerAttemptWithdrawFunction}(text,bigint,text)
     OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${workerAttemptWithdrawFunction}(text,bigint,text)
     FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${workerAttemptWithdrawFunction}(text,bigint,text)
     TO ${workerPlaneRole}`,
];

/**
 * A hold on a session attempt, which is the same fact one grain down: the pod's
 * account was refused, so the attempt ends `Withdrawn` and every turn it had
 * claimed goes back to the mailbox with its attempt budget untouched.
 *
 * It does not call `release_session_attempt_turns`. That body spends one of the
 * turn's attempts on every caller, which is the rule for an attempt that ran; a
 * held turn was never tried, so returning it through that body would charge the
 * very budget this function exists not to charge.
 *
 * It names its own evidence rather than taking one. The pod says only that it is
 * held; a pod that could pass a label could write any of the eleven the platform
 * writes for itself.
 */
const sessionHold = [
  `ALTER TABLE session_attempt DROP CONSTRAINT session_attempt_evidence_is_known`,
  `ALTER TABLE session_attempt ADD CONSTRAINT session_attempt_evidence_is_known
     CHECK (evidence IS NULL OR evidence IN (${schemaTextSet([
       ...allSessionAttemptEvidences,
     ])}))`,
  `CREATE FUNCTION ${sessionAttemptWithdrawFunction}(
     in_secret_digest text,in_generation bigint)
     RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE bound record;
     BEGIN
       SELECT a.tenant,a.project,a.session,a.attempt INTO bound
         FROM session_attempt a
        WHERE a.bearer_secret_digest=in_secret_digest FOR UPDATE;
       IF NOT FOUND THEN RETURN false; END IF;
       UPDATE session_attempt a
          SET state='Withdrawn',evidence='${holdEvidence}',ended_at=now(),
              lease_owner=NULL,lease_expires_at=NULL,idle_since=NULL
        WHERE a.attempt=bound.attempt AND a.generation=in_generation
          AND a.state IN ${liveStates}
          AND a.recovery_epoch=(SELECT epoch FROM recovery_epoch
                                 ORDER BY ordinal DESC LIMIT 1);
       IF NOT FOUND THEN RETURN false; END IF;
       UPDATE session_turn t
          SET state='Queued',attempt=NULL,claim_generation=NULL,claimed_at=NULL
        WHERE t.tenant=bound.tenant AND t.project=bound.project
          AND t.session=bound.session AND t.attempt=bound.attempt
          AND t.state='Claimed';
       RETURN true;
     END $$`,
  `ALTER FUNCTION ${sessionAttemptWithdrawFunction}(text,bigint)
     OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${sessionAttemptWithdrawFunction}(text,bigint)
     FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${sessionAttemptWithdrawFunction}(text,bigint)
     TO ${workerPlaneRole}`,
];

/**
 * A provider that refused an account held the attempt; it did not fail the work.
 * `Lost` spends the safe retry budget because the attempt ran, and `Withdrawn`
 * does not — the vocabulary was already there, and until now no boundary a pod
 * reaches could write the second arm.
 */
export const migration060: Migration = {
  version: 60,
  name: "a rate-limited attempt is withdrawn, and charges nothing",
  statements: [...workerHold, ...sessionHold],
};
