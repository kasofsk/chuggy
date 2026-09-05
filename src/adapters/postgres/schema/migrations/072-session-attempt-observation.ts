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
 * THE FAILURE IS A SECOND READ BECAUSE THE FIRST ONE IS TOO EARLY. A batch of
 * attempts is answered before any of their pods is asked anything, and the
 * pass then asks the backend once per row; a turn written inside that window is
 * invisible to a failure carried on the batch. So the batch says only which
 * attempts have a pod, and `session_attempt_turn_failure` says why, asked for
 * one attempt whose pod has already been seen to have terminated — at which
 * point every container of it has stopped and the row cannot move again.
 *
 * THAT SECOND READ IS UNFENCED, AND `end_session_attempt` IS WHY. A read of a
 * globally unique attempt identity decides nothing; the generation, the live
 * state and the epoch are all conditions of the move that follows, so a read
 * that repeated them would be a fence nothing rests on.
 *
 * THE FAILURE CANNOT BE READ FROM A COLUMN. A turn that
 * ends releases its attempt — `fail_session_turn` writes `attempt=NULL` — so
 * there is no column joining a failed turn to the attempt that failed it. What
 * stands in its place is the turn's own end state and the session's order: at
 * most one attempt of a session is live at a time, and every writer of
 * `Answered` or `Failed` is either the claiming attempt, fenced on its bearer
 * and generation, or `release_session_attempt_turns` at that attempt's own
 * ending. So a turn in one of those two states that ended at or after this
 * attempt opened is a turn this attempt ended, and no column recording which
 * attempt ended a turn would say anything the pair does not.
 *
 * `Abandoned` IS THE THIRD END AND IT IS NOT THE ATTEMPT'S. `withdraw_lead_turn`
 * and `close_agent_session` abandon every live turn of a session by identity
 * alone — queued ones the attempt never held, and the claimed one it has not
 * finished — so a turn withdrawn while the attempt worked a lower ordinal both
 * ends without the attempt and wins an ordering by ordinal. Reading it as this
 * attempt's failure turns a pod that answered everything it held into
 * `TurnFailed`, and masks a `StoreRefused` behind a later withdrawal. It is the
 * platform ending a turn the pod was never told about, so it is not the pod's
 * reason and the state bound is what excludes it. An attempt whose OWN claimed
 * turn is abandoned therefore reads no failure, which is right for the same
 * reason: the pod finds nothing to claim and exits having reported nothing.
 *
 * THE ORDER IS THE END AND THE ORDINAL BEHIND IT. One attempt claims one turn
 * at a time in ordinal order, so for the turns it ended the two agree; the end
 * is what the row is about and the ordinal is what makes the answer total.
 *
 * IT IS A READ AND NOT AN ENDING. Which evidence the failure becomes is the
 * pass's, and `end_session_attempt` is still the one body that ends an attempt
 * and returns its turns; a second ending here would be a second mailbox rule.
 */

import {
  boundaryOwnerRole,
  schedulerRole,
  sessionAttemptObservationFunction,
  sessionAttemptTurnFailureFunction,
  type Migration,
} from "../shared.ts";

const observationSignature = "text,bigint";
const turnFailureSignature = "text";

/** The epoch a live authority must have been issued under, as every fence reads it. */
const currentEpoch = `(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1)`;

/** The two end states an attempt writes, which no platform withdrawal reaches. */
const attemptEndedStates = "('Answered','Failed')";

/**
 * The failure of the last turn this attempt ended: the last turn of its session
 * to reach one of the attempt's own end states at or after the attempt opened.
 */
const lastTurnFailure = `(SELECT t.failure FROM session_turn t
     WHERE t.tenant=a.tenant AND t.project=a.project AND t.session=a.session
       AND t.state IN ${attemptEndedStates} AND t.ended_at>=a.opened_at
     ORDER BY t.ended_at DESC,t.ordinal DESC LIMIT 1)`;

/** The two boundaries beside their argument types, once. */
const observationSignatures: readonly (readonly [string, string])[] = [
  [sessionAttemptObservationFunction, observationSignature],
  [sessionAttemptTurnFailureFunction, turnFailureSignature],
];

const attemptsAwaitingObservation = [
  `CREATE FUNCTION ${sessionAttemptObservationFunction}(
     in_epoch text,in_max bigint)
     RETURNS TABLE(tenant text,project text,session text,attempt text,
                   generation bigint)
     LANGUAGE sql STABLE SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
       SELECT a.tenant,a.project,a.session,a.attempt,a.generation
         FROM session_attempt a
        WHERE a.state='Running' AND a.placement IS NOT NULL
          AND a.recovery_epoch=in_epoch AND in_epoch=${currentEpoch}
        ORDER BY a.tenant,a.project,a.session,a.attempt
        LIMIT in_max
     $$`,
  `CREATE FUNCTION ${sessionAttemptTurnFailureFunction}(in_attempt text)
     RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
       SELECT ${lastTurnFailure} FROM session_attempt a
        WHERE a.attempt=in_attempt
     $$`,
  ...observationSignatures.map(
    ([name, signature]) =>
      `ALTER FUNCTION ${name}(${signature}) OWNER TO ${boundaryOwnerRole}`,
  ),
  ...observationSignatures.map(
    ([name, signature]) =>
      `REVOKE ALL ON FUNCTION ${name}(${signature}) FROM PUBLIC`,
  ),
  ...observationSignatures.map(
    ([name, signature]) =>
      `GRANT EXECUTE ON FUNCTION ${name}(${signature}) TO ${schedulerRole}`,
  ),
];

/** An attempt whose pod may have ended, and the reason its last turn gave. */
export const migration072: Migration = {
  version: 72,
  name: "the attempts whose pods the scheduler may observe",
  statements: attemptsAwaitingObservation,
};
