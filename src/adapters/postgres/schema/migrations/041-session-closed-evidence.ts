/**
 * An attempt that ends as a stopped pod on a closed session ends
 * `SessionClosed`, where it ended as the pod's own reason or a reaper's.
 *
 * THE TWO READS ARE DROPPED AND RECREATED, because a result type cannot change
 * in place: each now answers its failure beside whether the attempt's session
 * is closed, read in one statement. The worker plane's calls the scheduler's,
 * and a string-bodied function records no dependency on what it calls, so it is
 * dropped first and recreated after.
 *
 * THE REAPERS ARE REPLACED with the bodies they had and one change: the
 * statement that ends an attempt writes `SessionClosed` in place of its own
 * literal when the session is closed.
 */

import {
  boundaryOwnerRole,
  schedulerRole,
  sessionAttemptReapIdleFunction,
  sessionAttemptReapLapsedFunction,
  sessionAttemptTurnFailureFunction,
  sessionBearerTurnFailureFunction,
  workerPlaneRole,
  type Migration,
} from "../shared.ts";

const attemptRead = `public.${sessionAttemptTurnFailureFunction}(in_attempt text)`;

const bearerRead = `public.${sessionBearerTurnFailureFunction}(in_secret_digest text, in_generation bigint)`;

const idle = `public.${sessionAttemptReapIdleFunction}(in_epoch text, in_idle_secs bigint, in_max bigint)`;

const lapsed = `public.${sessionAttemptReapLapsedFunction}(in_epoch text, in_max bigint)`;

/** The definer boilerplate a recreated function here ends with. */
function owned(signature: string, role: string): readonly string[] {
  return [
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT ALL ON FUNCTION ${signature} TO ${role}`,
  ];
}

/** The evidence a reaper writes for the attempt `row` names, `open` where its session is not closed. */
function reapedEvidence(row: string, open: string): string {
  return `CASE WHEN EXISTS(SELECT 1 FROM agent_session s
                  WHERE s.tenant=${row}.tenant AND s.project=${row}.project
                    AND s.session=${row}.session AND s.state='Closed')
                 THEN 'SessionClosed' ELSE '${open}' END`;
}

export const migration041: Migration = {
  version: 41,
  name: "a closed session's stopped pod ends its attempt as closed",
  statements: [
    `DROP FUNCTION ${bearerRead}`,
    `DROP FUNCTION ${attemptRead}`,
    `CREATE FUNCTION ${attemptRead} RETURNS TABLE(failure text, closed boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT (SELECT t.failure FROM session_turn t
     WHERE t.tenant=a.tenant AND t.project=a.project AND t.session=a.session
       AND t.state IN ('Answered','Failed') AND t.ended_at>=a.opened_at
     ORDER BY t.ended_at DESC,t.ordinal DESC LIMIT 1),
              s.state='Closed'
         FROM session_attempt a
         JOIN agent_session s ON s.tenant=a.tenant AND s.project=a.project
                             AND s.session=a.session
        WHERE a.attempt=in_attempt
     $$`,
    ...owned(attemptRead, schedulerRole),
    `CREATE FUNCTION ${bearerRead} RETURNS TABLE(failure text, closed boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT ending.failure,ending.closed FROM session_attempt a
        CROSS JOIN LATERAL ${sessionAttemptTurnFailureFunction}(a.attempt) ending
        WHERE a.bearer_secret_digest=in_secret_digest
          AND a.generation=in_generation
          AND a.state IN ('Placing','Running')
          AND a.recovery_epoch=(SELECT epoch FROM recovery_epoch
                                 ORDER BY ordinal DESC LIMIT 1)
     $$`,
    ...owned(bearerRead, workerPlaneRole),
    `CREATE OR REPLACE FUNCTION ${idle} RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE idled record; reaped bigint;
     BEGIN
       IF in_epoch<>(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1) THEN RETURN 0; END IF;
       reaped:=0;
       FOR idled IN SELECT a.tenant,a.project,a.session,a.attempt FROM session_attempt a
            WHERE a.state IN ('Placing','Running') AND a.recovery_epoch=in_epoch
              AND a.idle_since IS NOT NULL
              AND a.idle_since < now() - make_interval(
                    secs => in_idle_secs::double precision)
            ORDER BY a.tenant,a.project,a.session,a.attempt
            LIMIT in_max FOR UPDATE LOOP
         UPDATE session_attempt a
            SET state='Lost',evidence=${reapedEvidence("idled", "SessionIdle")},
                ended_at=now(),
                lease_owner=NULL,lease_expires_at=NULL,idle_since=NULL
          WHERE a.attempt=idled.attempt;
         PERFORM release_session_attempt_turns(
           idled.tenant,idled.project,idled.session,idled.attempt);
         reaped:=reaped+1;
       END LOOP;
       RETURN reaped;
     END $$`,
    `CREATE OR REPLACE FUNCTION ${lapsed} RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE lapsed record; reaped bigint;
     BEGIN
       IF in_epoch<>(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1) THEN RETURN 0; END IF;
       reaped:=0;
       FOR lapsed IN SELECT a.tenant,a.project,a.session,a.attempt FROM session_attempt a
            WHERE a.state IN ('Placing','Running') AND a.recovery_epoch=in_epoch
              AND a.lease_expires_at < now()
            ORDER BY a.tenant,a.project,a.session,a.attempt
            LIMIT in_max FOR UPDATE LOOP
         UPDATE session_attempt a
            SET state='Lost',evidence=${reapedEvidence("lapsed", "LeaseExpired")},
                ended_at=now(),
                lease_owner=NULL,lease_expires_at=NULL,idle_since=NULL
          WHERE a.attempt=lapsed.attempt;
         PERFORM release_session_attempt_turns(
           lapsed.tenant,lapsed.project,lapsed.session,lapsed.attempt);
         reaped:=reaped+1;
       END LOOP;
       RETURN reaped;
     END $$`,
  ],
};
