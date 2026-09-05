/**
 * What the scheduler needs to end an attempt on its pod's end rather than on
 * its lease: which attempts have a pod to look at, and why the last turn each
 * one ended did not answer.
 *
 * A LEASE LAPSE IS NOT A REASON. A session pod that fails a turn `StoreRefused`
 * exits, and a pod whose runtime budget is spent stops; either way the attempt
 * row stood `Running` until the lease ran out and then recorded `LeaseExpired`,
 * which is a label for a pod that stopped reporting and not for one that
 * finished (kasofsk/chuggy#509). This read is what lets the pass ask the cluster
 * instead. It offers only `Running` attempts with a placement, because an
 * attempt with no placement has no pod to have ended.
 *
 * THE TURN FAILURE IS READ HERE BECAUSE IT CANNOT BE READ LATER. A turn that
 * ends releases its attempt — `fail_session_turn` writes `attempt=NULL` — so
 * there is no column joining a failed turn to the attempt that failed it. What
 * stands in its place is the session's own order: at most one attempt of a
 * session is live at a time, so the last turn to end at or after this attempt
 * opened is the last turn this attempt ended, and its `failure` is null exactly
 * when that turn was answered.
 *
 * IT IS A READ AND NOT AN ENDING. Which evidence the failure becomes is the
 * pass's, and `end_session_attempt` is still the one body that ends an attempt
 * and returns its turns; a second ending here would be a second mailbox rule.
 */

import {
  boundaryOwnerRole,
  schedulerRole,
  sessionAttemptObservationFunction,
  type Migration,
} from "../shared.ts";

const observationSignature = "text,bigint";

/** The epoch a live authority must have been issued under, as every fence reads it. */
const currentEpoch = `(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1)`;

/**
 * The failure of the last turn this attempt ended, which is the last turn of
 * its session to end at or after the attempt opened.
 */
const lastTurnFailure = `(SELECT t.failure FROM session_turn t
     WHERE t.tenant=a.tenant AND t.project=a.project AND t.session=a.session
       AND t.ended_at IS NOT NULL AND t.ended_at>=a.opened_at
     ORDER BY t.ordinal DESC LIMIT 1)`;

const attemptsAwaitingObservation = [
  `CREATE FUNCTION ${sessionAttemptObservationFunction}(
     in_epoch text,in_max bigint)
     RETURNS TABLE(tenant text,project text,session text,attempt text,
                   generation bigint,turn_failure text)
     LANGUAGE sql STABLE SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
       SELECT a.tenant,a.project,a.session,a.attempt,a.generation,
              ${lastTurnFailure}
         FROM session_attempt a
        WHERE a.state='Running' AND a.placement IS NOT NULL
          AND a.recovery_epoch=in_epoch AND in_epoch=${currentEpoch}
        ORDER BY a.tenant,a.project,a.session,a.attempt
        LIMIT in_max
     $$`,
  `ALTER FUNCTION ${sessionAttemptObservationFunction}(${observationSignature})
     OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION
     ${sessionAttemptObservationFunction}(${observationSignature}) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION
     ${sessionAttemptObservationFunction}(${observationSignature})
     TO ${schedulerRole}`,
];

/** An attempt whose pod may have ended, and the reason its last turn gave. */
export const migration073: Migration = {
  version: 73,
  name: "the attempts whose pods the scheduler may observe",
  statements: attemptsAwaitingObservation,
};
