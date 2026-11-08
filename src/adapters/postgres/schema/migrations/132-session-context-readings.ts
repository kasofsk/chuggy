/**
 * A session's turn keeps the readings of its context window its answer carried,
 * and the API reads them beside what the session was opened under.
 *
 * `session_turn_context` IS ONE ROW PER READING, keyed by the turn's own key
 * and the reading's place in the answer, numbered from one in the order the
 * turn took them. A reading's window is the `jsonb` object a run's reading
 * holds, bounded here by the same size, and a compaction's facts are kept only
 * beside a compaction. The rows are written once, by `answer_session_turn` in
 * the transaction that answers the turn, so a turn that failed, was stopped or
 * was answered already keeps none from the answer that reached it.
 *
 * `answer_session_turn` TAKES ONE MORE ARGUMENT, the readings as one array or
 * null, so the baseline's signature is dropped and the function is created
 * again with the body 035 gave it, its owner and its one grant restored. A
 * malformed page of readings is a `Conflict`, as a malformed batch range is.
 * An answer offered again is judged as before, by its result and its batches.
 *
 * `read_session_context` answers the readings of a page of a session's turns,
 * by turn ascending, and `read_session_opening` the session's appended prompt
 * and its compaction window. Both are keyed by the session the API resolved,
 * as the store reads are, and the API holds `EXECUTE` on them and no grant on
 * either relation. Every bound and roster here is written as a literal,
 * because a migration that read a live roster would install a different
 * relation once the roster moved.
 */

import {
  apiRole,
  boundaryOwnerRole,
  sessionContextImmutableFunction,
  sessionContextReadFunction,
  sessionOpeningReadFunction,
  sessionTurnAnswerFunction,
  workerPlaneRole,
  type Migration,
} from "../shared.ts";

/** The largest count a reading's figure carries, which is what a browser holds exactly. */
const countMax = "9007199254740991";

/** The most readings one turn's answer carries. */
const readingsMax = 8;

/** The most turns one page of the context read answers. */
const pageTurnsMax = 4;

/** The most a stored window weighs as text, which is a run's reading's bound. */
const windowBytesMax = 4_194_304;

/** Whether `field` of `object` is a whole count no larger than `max`, written as a number. */
function countOf(object: string, field: string, max: string): string {
  return `(jsonb_typeof(${object}->'${field}') IS NOT DISTINCT FROM 'number'
     AND coalesce(${object}->>'${field}','') ~ '^[0-9]+$'
     AND (CASE WHEN coalesce(${object}->>'${field}','') ~ '^[0-9]+$'
               THEN (${object}->>'${field}')::numeric ELSE ${max} + 1 END)
         <= ${max})`;
}

const answerBefore = `public.${sessionTurnAnswerFunction}(in_secret_digest text, in_generation bigint, in_turn text, in_result text, in_batch_first bigint, in_batch_last bigint, in_model text, in_tokens bigint, in_cost_micros bigint, in_duration_ms bigint, in_tools text[])`;

const answer = `public.${sessionTurnAnswerFunction}(in_secret_digest text, in_generation bigint, in_turn text, in_result text, in_batch_first bigint, in_batch_last bigint, in_model text, in_tokens bigint, in_cost_micros bigint, in_duration_ms bigint, in_tools text[], in_readings jsonb)`;

const context = `public.${sessionContextReadFunction}(in_tenant text, in_project text, in_session text, in_after bigint, in_max bigint)`;

const opening = `public.${sessionOpeningReadFunction}(in_tenant text, in_project text, in_session text)`;

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

/** What a settlement of a stopped turn does in place of settling it, as 035 wrote it. */
const stoppedSettlement = `IF stored.state='Abandoned' AND stored.failure='TurnStopped' THEN
         UPDATE session_attempt a SET idle_since=now()
          WHERE a.attempt=bound.attempt AND a.idle_since IS NULL
            AND NOT EXISTS(SELECT 1 FROM session_turn h
                            WHERE h.tenant=bound.tenant AND h.project=bound.project
                              AND h.session=bound.session AND h.state='Claimed');
         RETURN 'Stopped';
       END IF;`;

const answerWithReadings = `CREATE FUNCTION ${answer} RETURNS text
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
                   OR jsonb_array_length(in_readings) NOT BETWEEN 1 AND ${String(readingsMax)}
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
       INSERT INTO session_turn_context
           (tenant,project,session,turn_ordinal,reading,cause,
            compaction_trigger,compaction_tokens_before,compaction_tokens_after,context_window)
         SELECT bound.tenant,bound.project,bound.session,stored.ordinal,
                x.reading,offered->>'cause',offered->'compaction'->>'trigger',
                (offered->'compaction'->>'tokensBefore')::bigint,
                (offered->'compaction'->>'tokensAfter')::bigint,
                offered->'window'
           FROM jsonb_array_elements(coalesce(in_readings,'[]'::jsonb))
                WITH ORDINALITY x(offered,reading);
       UPDATE session_attempt a SET idle_since=now() WHERE a.attempt=bound.attempt;
       RETURN 'Answered';
     END $$`;

const contextRead = `CREATE FUNCTION ${context} RETURNS TABLE(turn text, turn_ordinal bigint, reading bigint, cause text, compaction_trigger text, compaction_tokens_before bigint, compaction_tokens_after bigint, context_window jsonb, recorded_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       WITH paged AS (
         SELECT f.turn_ordinal FROM session_turn_context f
          WHERE f.tenant=in_tenant AND f.project=in_project AND f.session=in_session
            AND f.reading=1 AND f.turn_ordinal>coalesce(in_after,0)
          ORDER BY f.turn_ordinal
          LIMIT least(coalesce(in_max,${String(pageTurnsMax)}),${String(pageTurnsMax)}))
       SELECT t.turn,c.turn_ordinal,c.reading,c.cause,c.compaction_trigger,
              c.compaction_tokens_before,c.compaction_tokens_after,
              c.context_window,c.recorded_at
         FROM paged p
         JOIN session_turn_context c
           ON c.tenant=in_tenant AND c.project=in_project AND c.session=in_session
          AND c.turn_ordinal=p.turn_ordinal
         JOIN session_turn t
           ON t.tenant=c.tenant AND t.project=c.project AND t.session=c.session
          AND t.ordinal=c.turn_ordinal
        ORDER BY c.turn_ordinal,c.reading
     $$`;

const openingRead = `CREATE FUNCTION ${opening} RETURNS TABLE(system_prompt text, auto_compact_window bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT s.system_prompt,s.auto_compact_window
         FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project AND s.session=in_session
     $$`;

/** The definer boilerplate a function here ends with. */
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
       reading bigint NOT NULL
         CONSTRAINT session_turn_context_reading_is_bounded
         CHECK (reading BETWEEN 1 AND ${String(readingsMax)}),
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
       PRIMARY KEY (tenant,project,session,turn_ordinal,reading),
       CONSTRAINT session_turn_context_has_its_turn FOREIGN KEY (tenant,project,session,turn_ordinal)
         REFERENCES public.session_turn(tenant,project,session,ordinal))`,
    `CREATE FUNCTION public.${sessionContextImmutableFunction}() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     BEGIN
       RAISE EXCEPTION
         'the context readings of session % are written once, with the answer that carried them',
         OLD.session USING ERRCODE = 'integrity_constraint_violation';
     END $$`,
    `REVOKE ALL ON FUNCTION public.${sessionContextImmutableFunction}() FROM PUBLIC`,
    `CREATE TRIGGER session_turn_context_is_written_once BEFORE DELETE OR UPDATE ON public.session_turn_context FOR EACH ROW EXECUTE FUNCTION public.${sessionContextImmutableFunction}()`,
    `GRANT SELECT,INSERT ON TABLE public.session_turn_context TO ${boundaryOwnerRole}`,
    `DROP FUNCTION ${answerBefore}`,
    answerWithReadings,
    ...owned(answer, workerPlaneRole),
    contextRead,
    ...owned(context, apiRole),
    openingRead,
    ...owned(opening, apiRole),
  ],
};
