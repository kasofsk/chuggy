/**
 * A run's turn may name the subagent call it was made under, and a run keeps
 * the readings of its context window.
 *
 * `execution_run_turn.parent_tool_use_id` IS THE TOOL-USE ID a turn's stream
 * event carried, null for a turn of the main conversation and for every turn a
 * worker of an earlier release offered. `record_worker_run_turns` is replaced
 * in place, its arguments and answer as the baseline made them, so its owner
 * and its one grant stand: it takes the id where a turn names one, a turn
 * offered again is the same turn only where it names the same id or none, and
 * a figure is refused unless it is written as a number.
 *
 * `execution_run_context` IS ONE ROW PER READING, keyed as a turn is by its
 * attempt and its ordinal, the ordinals contiguous from the first as a
 * transcript's batches are. The scalars a reading is found by are columns; the
 * window it read is one `jsonb` object the plane has already held to the
 * wire's bounds, bounded here by its size so the relation holds no reading the
 * wire could not send. A compaction's facts are kept only beside a compaction.
 * The row is written once, through `record_worker_run_context` alone, which
 * answers a page `Stored` where it kept a reading, `AlreadyStored` where every
 * reading was already kept as offered, `Conflict` where one contradicts a kept
 * reading or the page is malformed, `OutOfOrder` where a new ordinal skips one,
 * and `Fenced` for a bearer that may not write.
 *
 * The API reads both. Every bound and roster here is written as a literal,
 * because a migration that read a live roster would install a different
 * relation once the roster moved.
 */

import {
  apiRole,
  boundaryOwnerRole,
  workerPlaneRole,
  workerRunContextFunction,
  workerRunTurnsFunction,
  type Migration,
} from "../shared.ts";

/** The largest count a run figure carries, which is what a browser holds exactly. */
const countMax = "9007199254740991";

/** Whether `field` of `object` is a whole count no larger than `max`, written as a number. */
function countOf(object: string, field: string, max: string): string {
  return `(jsonb_typeof(${object}->'${field}') IS NOT DISTINCT FROM 'number'
     AND coalesce(${object}->>'${field}','') ~ '^[0-9]+$'
     AND (CASE WHEN coalesce(${object}->>'${field}','') ~ '^[0-9]+$'
               THEN (${object}->>'${field}')::numeric ELSE ${max} + 1 END)
         <= ${max})`;
}

const turns = `public.${workerRunTurnsFunction}(in_secret_digest text, in_generation bigint, in_turns jsonb)`;

const context = `public.${workerRunContextFunction}(in_secret_digest text, in_generation bigint, in_readings jsonb)`;

const tokenFields = [
  "tokensInput",
  "tokensOutput",
  "tokensCacheCreation",
  "tokensCacheRead",
];

/** The baseline's turn page, taking and comparing the id a turn names its subagent call by. */
const turnsReplaced = `CREATE OR REPLACE FUNCTION ${turns} RETURNS TABLE(recorded text, turns bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record;
     BEGIN
       SELECT * INTO bound FROM worker_run_binding(in_secret_digest,in_generation);
       IF NOT FOUND THEN
         RETURN QUERY SELECT 'Fenced'::text,0::bigint; RETURN;
       END IF;
       IF jsonb_typeof(in_turns) IS DISTINCT FROM 'array'
          OR jsonb_array_length(in_turns) NOT BETWEEN 1 AND 100
          OR (SELECT count(DISTINCT offered->>'ordinal')
                FROM jsonb_array_elements(in_turns) x(offered))
             <> jsonb_array_length(in_turns)
          OR EXISTS(SELECT 1 FROM jsonb_array_elements(in_turns) x(offered)
               WHERE jsonb_typeof(offered) IS DISTINCT FROM 'object'
                  OR NOT ${countOf("offered", "ordinal", "1000")}
                  OR offered->>'ordinal' ~ '^0+$'
                  OR length(coalesce(offered->>'model','')) NOT BETWEEN 1 AND 128
                  OR coalesce(offered->>'model','') ~ '[[:cntrl:]]'
                  OR (offered ? 'parentToolUseId'
                      AND (jsonb_typeof(offered->'parentToolUseId') IS DISTINCT FROM 'string'
                           OR length(offered->>'parentToolUseId') NOT BETWEEN 1 AND 128))
                  OR NOT (${tokenFields.map((field) => countOf("offered", field, countMax)).join("\n     AND ")})) THEN
         RETURN QUERY SELECT 'Conflict'::text,0::bigint; RETURN;
       END IF;
       INSERT INTO execution_run (tenant,project,execution,attempt)
         VALUES(bound.tenant,bound.project,bound.execution,bound.attempt)
         ON CONFLICT DO NOTHING;
       IF EXISTS(SELECT 1 FROM jsonb_array_elements(in_turns) x(offered)
                 JOIN execution_run_turn t
                   ON t.tenant=bound.tenant AND t.project=bound.project
                  AND t.execution=bound.execution AND t.attempt=bound.attempt
                  AND t.ordinal=(offered->>'ordinal')::bigint
                 WHERE (t.model,t.tokens_input,t.tokens_output,t.tokens_cache_creation,t.tokens_cache_read,t.parent_tool_use_id)
                    IS DISTINCT FROM
                       (offered->>'model',(offered->>'tokensInput')::bigint,(offered->>'tokensOutput')::bigint,(offered->>'tokensCacheCreation')::bigint,(offered->>'tokensCacheRead')::bigint,offered->>'parentToolUseId')) THEN
         RETURN QUERY SELECT 'Conflict'::text,0::bigint; RETURN;
       END IF;
       INSERT INTO execution_run_turn
           (tenant,project,execution,attempt,ordinal,model,tokens_input,tokens_output,tokens_cache_creation,tokens_cache_read,parent_tool_use_id)
         SELECT bound.tenant,bound.project,bound.execution,bound.attempt,
                (offered->>'ordinal')::bigint,offered->>'model',
                (offered->>'tokensInput')::bigint,
                (offered->>'tokensOutput')::bigint,
                (offered->>'tokensCacheCreation')::bigint,
                (offered->>'tokensCacheRead')::bigint,
                offered->>'parentToolUseId'
           FROM jsonb_array_elements(in_turns) x(offered)
         ON CONFLICT DO NOTHING;
       RETURN QUERY SELECT 'Recorded'::text,coalesce(max(ordinal),0)::bigint
         FROM execution_run_turn WHERE tenant=bound.tenant AND project=bound.project
              AND execution=bound.execution AND attempt=bound.attempt;
     END $$`;

/** The most a stored window weighs as text: every list full, every name at its bound, and every character written as an escape. */
const windowBytesMax = 4_194_304;

/** Whether one offered reading is malformed, which the plane's own schema already refuses. */
const readingMalformed = `jsonb_typeof(offered) IS DISTINCT FROM 'object'
                  OR NOT ${countOf("offered", "ordinal", "64")}
                  OR offered->>'ordinal' ~ '^0+$'
                  OR NOT ${countOf("offered", "afterTurn", "1000")}
                  OR coalesce(offered->>'cause','') NOT IN ('Start','Compaction','End')
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

const contextRecorded = `CREATE FUNCTION ${context} RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record; highest bigint; fresh bigint; furthest bigint;
     BEGIN
       SELECT * INTO bound FROM worker_run_binding(in_secret_digest,in_generation);
       IF NOT FOUND THEN RETURN 'Fenced'; END IF;
       IF jsonb_typeof(in_readings) IS DISTINCT FROM 'array'
          OR jsonb_array_length(in_readings) NOT BETWEEN 1 AND 4
          OR (SELECT count(DISTINCT offered->>'ordinal')
                FROM jsonb_array_elements(in_readings) x(offered))
             <> jsonb_array_length(in_readings)
          OR EXISTS(SELECT 1 FROM jsonb_array_elements(in_readings) x(offered)
               WHERE ${readingMalformed}) THEN
         RETURN 'Conflict';
       END IF;
       INSERT INTO execution_run (tenant,project,execution,attempt)
         VALUES(bound.tenant,bound.project,bound.execution,bound.attempt)
         ON CONFLICT DO NOTHING;
       IF EXISTS(SELECT 1 FROM jsonb_array_elements(in_readings) x(offered)
                 JOIN execution_run_context c
                   ON c.tenant=bound.tenant AND c.project=bound.project
                  AND c.execution=bound.execution AND c.attempt=bound.attempt
                  AND c.ordinal=(offered->>'ordinal')::bigint
                 WHERE (c.after_turn,c.cause,c.compaction_trigger,
                        c.compaction_tokens_before,c.compaction_tokens_after,c.context_window)
                    IS DISTINCT FROM
                       ((offered->>'afterTurn')::bigint,offered->>'cause',
                        offered->'compaction'->>'trigger',
                        (offered->'compaction'->>'tokensBefore')::bigint,
                        (offered->'compaction'->>'tokensAfter')::bigint,
                        offered->'window')) THEN
         RETURN 'Conflict';
       END IF;
       SELECT coalesce(max(ordinal),0) INTO highest FROM execution_run_context
        WHERE tenant=bound.tenant AND project=bound.project
          AND execution=bound.execution AND attempt=bound.attempt;
       SELECT count(*),max((offered->>'ordinal')::bigint) INTO fresh,furthest
         FROM jsonb_array_elements(in_readings) x(offered)
        WHERE (offered->>'ordinal')::bigint > highest;
       IF fresh = 0 THEN RETURN 'AlreadyStored'; END IF;
       IF furthest <> highest + fresh THEN RETURN 'OutOfOrder'; END IF;
       INSERT INTO execution_run_context
           (tenant,project,execution,attempt,ordinal,after_turn,cause,
            compaction_trigger,compaction_tokens_before,compaction_tokens_after,context_window)
         SELECT bound.tenant,bound.project,bound.execution,bound.attempt,
                (offered->>'ordinal')::bigint,(offered->>'afterTurn')::bigint,
                offered->>'cause',offered->'compaction'->>'trigger',
                (offered->'compaction'->>'tokensBefore')::bigint,
                (offered->'compaction'->>'tokensAfter')::bigint,
                offered->'window'
           FROM jsonb_array_elements(in_readings) x(offered)
          WHERE (offered->>'ordinal')::bigint > highest;
       RETURN 'Stored';
     END $$`;

/** The columns of a reading the API reads back. */
const contextColumns = [
  "tenant",
  "project",
  "execution",
  "attempt",
  "ordinal",
  "after_turn",
  "cause",
  "compaction_trigger",
  "compaction_tokens_before",
  "compaction_tokens_after",
  "context_window",
  "recorded_at",
];

export const migration131: Migration = {
  version: 131,
  name: "a turn names its subagent call, and a run keeps its context readings",
  statements: [
    `ALTER TABLE public.execution_run_turn
       ADD COLUMN parent_tool_use_id text
         CONSTRAINT execution_run_turn_parent_is_bounded
         CHECK (parent_tool_use_id IS NULL OR length(parent_tool_use_id) BETWEEN 1 AND 128)`,
    `GRANT SELECT(parent_tool_use_id) ON TABLE public.execution_run_turn TO ${apiRole}`,
    turnsReplaced,
    `CREATE TABLE public.execution_run_context (
       tenant text NOT NULL,
       project text NOT NULL,
       execution text NOT NULL,
       attempt text NOT NULL,
       ordinal bigint NOT NULL
         CONSTRAINT execution_run_context_ordinal_is_bounded
         CHECK (ordinal BETWEEN 1 AND 64),
       after_turn bigint NOT NULL
         CONSTRAINT execution_run_context_after_turn_is_bounded
         CHECK (after_turn BETWEEN 0 AND 1000),
       cause text NOT NULL
         CONSTRAINT execution_run_context_cause_is_known
         CHECK (cause IN ('Start','Compaction','End')),
       compaction_trigger text
         CONSTRAINT execution_run_context_trigger_is_known
         CHECK (compaction_trigger IS NULL OR compaction_trigger IN ('Auto','Manual')),
       compaction_tokens_before bigint,
       compaction_tokens_after bigint,
       context_window jsonb
         CONSTRAINT execution_run_context_window_is_bounded
         CHECK (context_window IS NULL
                OR (jsonb_typeof(context_window) = 'object'
                    AND octet_length(context_window::text) <= ${String(windowBytesMax)})),
       recorded_at timestamp with time zone DEFAULT now() NOT NULL,
       CONSTRAINT execution_run_context_compaction_is_whole
         CHECK ((compaction_trigger IS NULL) = (compaction_tokens_before IS NULL)
                AND (compaction_tokens_after IS NULL OR compaction_trigger IS NOT NULL)),
       CONSTRAINT execution_run_context_compaction_is_a_compactions
         CHECK (compaction_trigger IS NULL OR cause = 'Compaction'),
       CONSTRAINT execution_run_context_tokens_are_bounded
         CHECK (coalesce(compaction_tokens_before,0) BETWEEN 0 AND ${countMax}
                AND coalesce(compaction_tokens_after,0) BETWEEN 0 AND ${countMax}),
       PRIMARY KEY (tenant,project,execution,attempt,ordinal),
       FOREIGN KEY (tenant,project,execution,attempt)
         REFERENCES public.execution_run(tenant,project,execution,attempt))`,
    `CREATE TRIGGER execution_run_context_is_written_once BEFORE DELETE OR UPDATE ON public.execution_run_context FOR EACH ROW EXECUTE FUNCTION public.execution_run_evidence_is_immutable()`,
    `GRANT SELECT,INSERT ON TABLE public.execution_run_context TO ${boundaryOwnerRole}`,
    ...contextColumns.map(
      (column) =>
        `GRANT SELECT(${column}) ON TABLE public.execution_run_context TO ${apiRole}`,
    ),
    contextRecorded,
    `ALTER FUNCTION ${context} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${context} FROM PUBLIC`,
    `GRANT ALL ON FUNCTION ${context} TO ${workerPlaneRole}`,
  ],
};
