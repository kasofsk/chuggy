/**
 * A session's turn may be answered with the readings of its context window,
 * and the API reads them back with what the session was opened under.
 *
 * `session_turn_context` IS ONE ROW PER READING, keyed by its session, the
 * ordinal of the turn it was taken in and its place among that turn's
 * readings, numbered from one in the order the pod offered them. Its columns
 * are a run's reading's: a cause, a compaction's facts kept only beside a
 * compaction, and the window as one `jsonb` object the plane has already held
 * to the wire's bounds, bounded here by its size as `execution_run_context`
 * bounds its own. The boundary's owner may only insert and read a row, and no
 * runtime role may touch one but through the functions below.
 *
 * `answer_session_turn` IS DROPPED AND RECREATED, because it gains the
 * readings as its last argument; the body is 035's with them added, written
 * out so this file goes on saying what it installed. It writes the
 * readings in the transaction that answers the turn, so only the attempt that
 * holds the turn claimed keeps any, and it refuses a page past the wire's
 * bounds as `Conflict`, as it refuses every other malformed answer. A turn
 * answered again is the same answer by its result and its batches, as before:
 * its readings, like its measurement, are the first answer's.
 *
 * `read_session_context` pages one session's readings by turn, answering one
 * turn past the page so a reader can tell a full page from a last one, and
 * `read_session_opening` answers the prompt and the compaction window the
 * session was opened under. Both are keyed on the session rather than on a
 * kind, as `read_session_store_batches` is, and the API holds `EXECUTE` on
 * them and no grant on the relations behind them.
 *
 * Every bound and roster here is written as a literal, because a migration
 * that read a live roster would install a different relation once the roster
 * moved.
 */

import {
  apiRole,
  boundaryOwnerRole,
  sessionContextReadFunction,
  sessionOpeningReadFunction,
  sessionTurnAnswerFunction,
  workerPlaneRole,
  type Migration,
} from "../shared.ts";

/** The largest count a reading's figure carries, which is what a browser holds exactly. */
const countMax = "9007199254740991";

/** The most a stored window weighs as text, as `execution_run_context` bounds it. */
const windowBytesMax = 4_194_304;

/** Whether `field` of `object` is a whole count no larger than `max`, written as a number. */
function countOf(object: string, field: string, max: string): string {
  return `(jsonb_typeof(${object}->'${field}') IS NOT DISTINCT FROM 'number'
     AND coalesce(${object}->>'${field}','') ~ '^[0-9]+$'
     AND (CASE WHEN coalesce(${object}->>'${field}','') ~ '^[0-9]+$'
               THEN (${object}->>'${field}')::numeric ELSE ${max} + 1 END)
         <= ${max})`;
}

const answerArguments = `in_secret_digest text, in_generation bigint, in_turn text, in_result text, in_batch_first bigint, in_batch_last bigint, in_model text, in_tokens bigint, in_cost_micros bigint, in_duration_ms bigint, in_tools text[]`;

const answerWithout = `public.${sessionTurnAnswerFunction}(${answerArguments})`;

const answerWith = `public.${sessionTurnAnswerFunction}(${answerArguments}, in_readings jsonb)`;

const contextRead = `public.${sessionContextReadFunction}(in_tenant text, in_project text, in_session text, in_after bigint, in_max bigint)`;

const openingRead = `public.${sessionOpeningReadFunction}(in_tenant text, in_project text, in_session text)`;

/** Whether one offered reading is malformed, which the plane's own schema already refuses. */
const readingMalformed = `jsonb_typeof(offered) IS DISTINCT FROM 'object'
                  OR coalesce(offered->>'cause','') NOT IN ('Compaction','End')
                  OR (offered ? 'compaction'
                      AND (offered->>'cause' <> 'Compaction'
                           OR jsonb_typeof(offered->'compaction') IS DISTINCT FROM 'object'
                           OR coalesce(offered->'compaction'->>'trigger','') NOT IN ('Auto','Manual')
                           OR NOT ${countOf("offered->'compaction'", "tokensBefore", countMax)}
                           OR (offered->'compaction' ? 'tokensAfter'
                               AND NOT ${countOf("offered->'compaction'", "tokensAfter", countMax)})))
                  OR (offered ? 'window'
                      AND (jsonb_typeof(offered->'window') IS DISTINCT FROM 'object'
                           OR octet_length((offered->'window')::text) > ${String(windowBytesMax)}))`;

/** The answer 035 installed, taking the readings and writing them beside the turn it answers. */
const answered = `CREATE FUNCTION ${answerWith} RETURNS text
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
                           AND 128)
          OR (in_readings IS NOT NULL
              AND (jsonb_typeof(in_readings) IS DISTINCT FROM 'array'
                   OR jsonb_array_length(in_readings) > 8
                   OR EXISTS(SELECT 1 FROM jsonb_array_elements(in_readings) x(offered)
                              WHERE ${readingMalformed}))) THEN
         RETURN 'Conflict';
       END IF;
       SELECT t.state,t.attempt,t.claim_generation,t.result,t.batch_first,
              t.batch_last,t.failure,t.ordinal
         INTO stored FROM session_turn t
        WHERE t.tenant=bound.tenant AND t.project=bound.project
          AND t.session=bound.session AND t.turn=in_turn FOR UPDATE;
       IF NOT FOUND THEN RETURN 'Conflict'; END IF;
       IF stored.state='Abandoned' AND stored.failure='TurnStopped' THEN
         UPDATE session_attempt a SET idle_since=now()
          WHERE a.attempt=bound.attempt AND a.idle_since IS NULL
            AND NOT EXISTS(SELECT 1 FROM session_turn h
                            WHERE h.tenant=bound.tenant AND h.project=bound.project
                              AND h.session=bound.session AND h.state='Claimed');
         RETURN 'Stopped';
       END IF;
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
       INSERT INTO session_turn_context
           (tenant,project,session,turn_ordinal,ordinal,cause,
            compaction_trigger,compaction_tokens_before,compaction_tokens_after,context_window)
         SELECT bound.tenant,bound.project,bound.session,stored.ordinal,x.place,
                offered->>'cause',offered->'compaction'->>'trigger',
                (offered->'compaction'->>'tokensBefore')::bigint,
                (offered->'compaction'->>'tokensAfter')::bigint,
                offered->'window'
           FROM jsonb_array_elements(coalesce(in_readings,'[]'::jsonb))
                WITH ORDINALITY x(offered,place);
       UPDATE session_attempt a SET idle_since=now() WHERE a.attempt=bound.attempt;
       RETURN 'Answered';
     END $$`;

/** One session's readings, the turns after `in_after` that hold any and one turn past the page. */
const contextReadBody = `CREATE FUNCTION ${contextRead} RETURNS TABLE(turn text, turn_ordinal bigint, ordinal bigint, cause text, compaction_trigger text, compaction_tokens_before bigint, compaction_tokens_after bigint, context_window jsonb, recorded_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       WITH paged AS (
         SELECT DISTINCT c.turn_ordinal FROM session_turn_context c
          WHERE c.tenant=in_tenant AND c.project=in_project
            AND c.session=in_session AND c.turn_ordinal>coalesce(in_after,0)
          ORDER BY c.turn_ordinal
          LIMIT least(coalesce(in_max,4),4)+1)
       SELECT t.turn,c.turn_ordinal,c.ordinal,c.cause,c.compaction_trigger,
              c.compaction_tokens_before,c.compaction_tokens_after,
              c.context_window,c.recorded_at
         FROM session_turn_context c
         JOIN paged p ON p.turn_ordinal=c.turn_ordinal
         JOIN session_turn t
           ON t.tenant=c.tenant AND t.project=c.project
          AND t.session=c.session AND t.ordinal=c.turn_ordinal
        WHERE c.tenant=in_tenant AND c.project=in_project AND c.session=in_session
        ORDER BY c.turn_ordinal,c.ordinal
     $$`;

/** What one session was opened under: its appended prompt, and the window its runtime compacts at. */
const openingReadBody = `CREATE FUNCTION ${openingRead} RETURNS TABLE(system_prompt text, auto_compact_window bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT s.system_prompt,s.auto_compact_window
         FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project AND s.session=in_session
     $$`;

/** The owner a function is installed under, callable by `role` and by nobody else but its owner. */
function owned(signature: string, role: string): readonly string[] {
  return [
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT ALL ON FUNCTION ${signature} TO ${role}`,
  ];
}

export const migration132: Migration = {
  version: 132,
  name: "a session's turn keeps the readings of its context window",
  statements: [
    `CREATE TABLE public.session_turn_context (
       tenant text NOT NULL,
       project text NOT NULL,
       session text NOT NULL,
       turn_ordinal bigint NOT NULL,
       ordinal bigint NOT NULL
         CONSTRAINT session_turn_context_ordinal_is_bounded
         CHECK (ordinal BETWEEN 1 AND 8),
       cause text NOT NULL
         CONSTRAINT session_turn_context_cause_is_known
         CHECK (cause IN ('Compaction','End')),
       compaction_trigger text
         CONSTRAINT session_turn_context_trigger_is_known
         CHECK (compaction_trigger IS NULL OR compaction_trigger IN ('Auto','Manual')),
       compaction_tokens_before bigint,
       compaction_tokens_after bigint,
       context_window jsonb
         CONSTRAINT session_turn_context_window_is_bounded
         CHECK (context_window IS NULL
                OR (jsonb_typeof(context_window) = 'object'
                    AND octet_length(context_window::text) <= ${String(windowBytesMax)})),
       recorded_at timestamp with time zone DEFAULT now() NOT NULL,
       CONSTRAINT session_turn_context_compaction_is_whole
         CHECK ((compaction_trigger IS NULL) = (compaction_tokens_before IS NULL)
                AND (compaction_tokens_after IS NULL OR compaction_trigger IS NOT NULL)),
       CONSTRAINT session_turn_context_compaction_is_a_compactions
         CHECK (compaction_trigger IS NULL OR cause = 'Compaction'),
       CONSTRAINT session_turn_context_tokens_are_bounded
         CHECK (coalesce(compaction_tokens_before,0) BETWEEN 0 AND ${countMax}
                AND coalesce(compaction_tokens_after,0) BETWEEN 0 AND ${countMax}),
       PRIMARY KEY (tenant,project,session,turn_ordinal,ordinal),
       FOREIGN KEY (tenant,project,session,turn_ordinal)
         REFERENCES public.session_turn(tenant,project,session,ordinal))`,
    `GRANT SELECT,INSERT ON TABLE public.session_turn_context TO ${boundaryOwnerRole}`,
    `DROP FUNCTION ${answerWithout}`,
    answered,
    ...owned(answerWith, workerPlaneRole),
    contextReadBody,
    ...owned(contextRead, apiRole),
    openingReadBody,
    ...owned(openingRead, apiRole),
  ],
};
