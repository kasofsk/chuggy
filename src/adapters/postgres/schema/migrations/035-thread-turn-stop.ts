/**
 * A member stops one turn of their own thread. The turn ends `Abandoned` with
 * `TurnStopped` in the door's own transaction, queued or claimed, and waits
 * for no runner: a queued one is never claimed, and a claimed one leaves its
 * attempt live, still holding its lease and charged nothing.
 *
 * The door reads the thread and locks only the turn. A close takes the thread
 * and then its turns, so whichever of a close and a stop reaches a turn first
 * ends it and the other finds it ended; a settlement takes its attempt and
 * then the turn, and the door takes no attempt, so the two cannot wait on each
 * other.
 *
 * The door tells the thread's readers the turn's stream ended, on the channel
 * a runner's own live events take. What a runner writes of a turn is published
 * now only while its session holds that turn claimed, and both sides take one
 * advisory lock on the turn, so it is published wholly before the stop or not
 * at all: no reader hears a turn written after its end. A runner's own end of
 * a turn's stream is published whatever the turn's state, because it can only
 * end what is held and a settlement may reach the plane before it.
 *
 * The runner that held a stopped turn is told by `session_turn_stopped`, and
 * its settlement of that turn is answered `Stopped`: the row keeps its ending
 * and takes no result, and the attempt's idle clock starts as a settlement
 * starts it. A settlement of a turn that ended any other way is refused as it
 * was.
 */

import {
  apiRole,
  boundaryOwnerRole,
  sessionLivePublishFunction,
  sessionTurnAnswerFunction,
  sessionTurnFailFunction,
  sessionTurnStoppedFunction,
  threadTurnStopFunction,
  workerPlaneRole,
  type Migration,
} from "../shared.ts";

const stop = `public.${threadTurnStopFunction}(in_tenant text, in_project text, in_principal text, in_session text, in_turn text)`;

const stopped = `public.${sessionTurnStoppedFunction}(in_secret_digest text, in_generation bigint, in_turn text)`;

const publish = `public.${sessionLivePublishFunction}(in_tenant text, in_project text, in_session text, in_turn text, in_payloads text[])`;

const answer = `public.${sessionTurnAnswerFunction}(in_secret_digest text, in_generation bigint, in_turn text, in_result text, in_batch_first bigint, in_batch_last bigint, in_model text, in_tokens bigint, in_cost_micros bigint, in_duration_ms bigint, in_tools text[])`;

const fail = `public.${sessionTurnFailFunction}(in_secret_digest text, in_generation bigint, in_turn text, in_failure text)`;

/** The lock a stop and a publication of one turn's live events both take. */
const turnLiveLock = `hashtextextended('session-turn-live:'||in_turn,0)`;

/**
 * What a settlement of a stopped turn does in place of settling it: the idle
 * clock of an attempt holding no turn starts, where it has not started.
 */
const stoppedSettlement = `IF stored.state='Abandoned' AND stored.failure='TurnStopped' THEN
         UPDATE session_attempt a SET idle_since=now()
          WHERE a.attempt=bound.attempt AND a.idle_since IS NULL
            AND NOT EXISTS(SELECT 1 FROM session_turn h
                            WHERE h.tenant=bound.tenant AND h.project=bound.project
                              AND h.session=bound.session AND h.state='Claimed');
         RETURN 'Stopped';
       END IF;`;

/** The definer boilerplate a new function here ends with. */
function owned(signature: string, role: string): readonly string[] {
  return [
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT ALL ON FUNCTION ${signature} TO ${role}`,
  ];
}

export const migration035: Migration = {
  version: 35,
  name: "a member stops a turn of their own thread",
  statements: [
    `ALTER TABLE public.session_turn
       DROP CONSTRAINT session_turn_failure_is_known,
       ADD CONSTRAINT session_turn_failure_is_known CHECK (((failure IS NULL) OR (failure = ANY (ARRAY['AgentFailed'::text, 'AgentRateLimited'::text, 'AgentTurnsExhausted'::text, 'AgentBudgetExhausted'::text, 'StoreRefused'::text, 'AttemptLost'::text, 'SessionClosed'::text, 'TurnWithdrawn'::text, 'TurnStopped'::text]))))`,
    `CREATE FUNCTION ${stop} RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE held record; stored record;
     BEGIN
       SELECT s.principal,s.state INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.session=in_session AND s.kind='Thread';
       IF NOT FOUND THEN RETURN 'NoThread'; END IF;
       IF held.principal<>in_principal THEN RETURN 'NotYourThread'; END IF;
       IF held.state<>'Open' THEN RETURN 'Closed'; END IF;
       PERFORM pg_advisory_xact_lock(${turnLiveLock});
       SELECT t.state INTO stored FROM session_turn t
        WHERE t.tenant=in_tenant AND t.project=in_project
          AND t.session=in_session AND t.turn=in_turn FOR UPDATE;
       IF NOT FOUND THEN RETURN 'NoTurn'; END IF;
       IF stored.state NOT IN ('Queued','Claimed') THEN
         RETURN 'AlreadyEnded';
       END IF;
       UPDATE session_turn t
          SET state='Abandoned',failure='TurnStopped',ended_at=now(),
              attempt=NULL,claim_generation=NULL,claimed_at=NULL
        WHERE t.tenant=in_tenant AND t.project=in_project
          AND t.session=in_session AND t.turn=in_turn;
       PERFORM pg_notify('chuggy_session_live',jsonb_build_object(
         'tenant',in_tenant,'project',in_project,'session',in_session,
         'turn',in_turn,'ordinal',0,
         'event',jsonb_build_object('live','End'))::text);
       RETURN 'Stopped';
     END $$`,
    ...owned(stop, apiRole),
    `CREATE FUNCTION ${stopped} RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT CASE WHEN t.state='Abandoned' AND t.failure='TurnStopped'
                   THEN 'Stopped'
                   WHEN t.state='Claimed' THEN 'Held'
                   END
         FROM session_attempt a
         JOIN session_turn t ON t.tenant=a.tenant AND t.project=a.project
                            AND t.session=a.session AND t.turn=in_turn
        WHERE a.bearer_secret_digest=in_secret_digest
          AND a.generation=in_generation
          AND a.state IN ('Placing','Running')
     $$`,
    ...owned(stopped, workerPlaneRole),
    `CREATE FUNCTION ${publish} RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE held boolean;
     BEGIN
       PERFORM pg_advisory_xact_lock_shared(${turnLiveLock});
       held:=EXISTS(SELECT 1 FROM session_turn t
                     WHERE t.tenant=in_tenant AND t.project=in_project
                       AND t.session=in_session AND t.state='Claimed'
                       AND t.turn=in_turn);
       PERFORM pg_notify('chuggy_session_live',listed.payload)
          FROM unnest(in_payloads) WITH ORDINALITY AS listed(payload,place)
         WHERE CASE WHEN held THEN true
                    ELSE listed.payload::jsonb#>>'{event,live}'='End' END
         ORDER BY listed.place;
       RETURN held;
     END $$`,
    ...owned(publish, workerPlaneRole),
    `CREATE OR REPLACE FUNCTION ${answer} RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record; stored record;
     BEGIN
       SELECT * INTO bound FROM session_attempt_binding(
         in_secret_digest,in_generation);
       IF NOT FOUND THEN RETURN 'Fenced'; END IF;
       IF in_result IS NULL OR length(in_result)>65536
          OR (in_batch_first IS NULL)<>(in_batch_last IS NULL)
          OR coalesce(in_batch_first,1)>coalesce(in_batch_last,1)
          OR coalesce(in_batch_first,1) NOT BETWEEN 1 AND 65536
          OR coalesce(in_batch_last,1) NOT BETWEEN 1 AND 65536
          OR array_position(in_tools,NULL) IS NOT NULL
          OR EXISTS(SELECT 1 FROM unnest(coalesce(in_tools,'{}'::text[])) named
                     WHERE length(named) NOT BETWEEN 1
                           AND 128) THEN
         RETURN 'Conflict';
       END IF;
       SELECT t.state,t.attempt,t.claim_generation,t.result,t.batch_first,
              t.batch_last,t.failure
         INTO stored FROM session_turn t
        WHERE t.tenant=bound.tenant AND t.project=bound.project
          AND t.session=bound.session AND t.turn=in_turn FOR UPDATE;
       IF NOT FOUND THEN RETURN 'Conflict'; END IF;
       ${stoppedSettlement}
       IF stored.state='Answered' THEN
         RETURN CASE WHEN stored.result=in_result
                      AND stored.batch_first IS NOT DISTINCT FROM in_batch_first
                      AND stored.batch_last IS NOT DISTINCT FROM in_batch_last
                     THEN 'AlreadyAnswered' ELSE 'Conflict' END;
       END IF;
       IF stored.state<>'Claimed' OR stored.attempt<>bound.attempt
          OR stored.claim_generation<>in_generation THEN
         RETURN 'Conflict';
       END IF;
       UPDATE session_turn t
          SET state='Answered',result=in_result,batch_first=in_batch_first,
              batch_last=in_batch_last,attempt=NULL,claim_generation=NULL,
              claimed_at=NULL,ended_at=now(),
              model=in_model,tokens=in_tokens,cost_micros=in_cost_micros,
              duration_ms=in_duration_ms,tools=in_tools
        WHERE t.tenant=bound.tenant AND t.project=bound.project
          AND t.session=bound.session AND t.turn=in_turn;
       UPDATE session_attempt a SET idle_since=now() WHERE a.attempt=bound.attempt;
       RETURN 'Answered';
     END $$`,
    `CREATE OR REPLACE FUNCTION ${fail} RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record; stored record;
     BEGIN
       SELECT * INTO bound FROM session_attempt_binding(
         in_secret_digest,in_generation);
       IF NOT FOUND THEN RETURN 'Fenced'; END IF;
       IF in_failure IS NULL
          OR in_failure NOT IN ('AgentFailed', 'AgentRateLimited', 'AgentTurnsExhausted', 'AgentBudgetExhausted', 'StoreRefused') THEN
         RETURN 'Conflict';
       END IF;
       SELECT t.state,t.attempt,t.claim_generation,t.failure INTO stored
         FROM session_turn t
        WHERE t.tenant=bound.tenant AND t.project=bound.project
          AND t.session=bound.session AND t.turn=in_turn FOR UPDATE;
       IF NOT FOUND THEN RETURN 'Conflict'; END IF;
       ${stoppedSettlement}
       IF stored.state='Failed' THEN
         RETURN CASE WHEN stored.failure=in_failure THEN 'AlreadyFailed'
                     ELSE 'Conflict' END;
       END IF;
       IF stored.state<>'Claimed' OR stored.attempt<>bound.attempt
          OR stored.claim_generation<>in_generation THEN
         RETURN 'Conflict';
       END IF;
       UPDATE session_turn t
          SET state='Failed',failure=in_failure,attempt=NULL,claim_generation=NULL,
              claimed_at=NULL,ended_at=now()
        WHERE t.tenant=bound.tenant AND t.project=bound.project
          AND t.session=bound.session AND t.turn=in_turn;
       UPDATE session_attempt a SET idle_since=now() WHERE a.attempt=bound.attempt;
       RETURN 'Failed';
     END $$`,
  ],
};
