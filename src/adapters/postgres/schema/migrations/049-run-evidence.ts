/**
 * The durable home for what one agent run left behind: the configuration it
 * started under, its transcript in batches, its per-turn usage and what it
 * spent, each keyed by the attempt that produced it.
 *
 * EVERY ROW IS WRITTEN ONCE. Evidence a worker could rewrite is not evidence,
 * so the four child relations take the same append-only trigger the result
 * relations do. `execution_run` takes its own, because a run's configuration
 * arrives once and may arrive after the first batch: that fill is the single
 * update this schema admits, and the trigger names it rather than leaving the
 * relation writable.
 *
 * BYTES LIVE IN THE ARTIFACT STORE AND THE ROW POINTS AT THEM. The paths are
 * derived by the server from the attempt and the batch number, so no worker
 * names one, and a run's bytes are bounded by the bounds here rather than by
 * the manifest's own reservation quota.
 *
 * A RE-POSTED TOTAL IS THE SAME TOTAL OR IT IS A CONFLICT, and the per-model
 * breakdown is part of what was offered. It is compared as a whole beside the
 * scalars, ordered by the model that keys it, so a run cannot replace what it
 * said it spent per model while leaving the sums alone.
 *
 * WHAT THE CHANGE LOG HEARS. A run opening and a batch landing append an
 * `Execution` row, which is the resource a console re-reads to learn the
 * transcript's high-water mark. The totals append a `Ticket` row as well,
 * because the ticket rollup is the one figure that moves when a run ends. Turns
 * append nothing: they are posted before the batch that covers them, so that
 * batch's own append carries them, and they are the noisiest rows here.
 */

import {
  nativeHttpPageItemsMax,
  runConfigurationBytesMax,
  runCountMax,
  runModelCharsMax,
  runOutcomeLabelCharsMax,
  runTranscriptBatchBytesMax,
  runTranscriptBatchesMax,
  runTurnSeriesMax,
} from "../../../../contract/http.ts";
import { runCostBases } from "../../../../contract/rosters.ts";
import {
  artifactDigestChars,
  artifactPathCharsMax,
} from "../../../../interpreter/resultManifest.ts";
import {
  apiRole,
  boundaryOwnerRole,
  projectChangeAppendFunction,
  projectChangeExecutionFunction,
  projectChangeRunFunction,
  runConfigurationImmutableFunction,
  runEvidenceImmutableFunction,
  schemaTextSet,
  workerPlaneRole,
  workerRunBindingFunction,
  workerRunConfigurationFunction,
  workerRunTotalFunction,
  workerRunTranscriptFunction,
  workerRunTurnsFunction,
  type Migration,
} from "../shared.ts";

const runKey = "tenant,project,execution,attempt";

const runBound = `tenant=bound.tenant AND project=bound.project
              AND execution=bound.execution AND attempt=bound.attempt`;

/** The normalized relative path a stored object stands at, as 028 states it. */
const pathIsNormalized = (column: string) =>
  `length(${column}) BETWEEN 1 AND ${artifactPathCharsMax}
     AND ${column} !~ '^/' AND ${column} !~ '//' AND ${column} !~ '[\\\\]'
     AND ${column} !~ '(^|/)[.][.]?(/|$)' AND ${column} !~ '[[:cntrl:]]'
     AND ${column} !~ '(^|/)[[:space:]]' AND ${column} !~ '[[:space:]](/|$)'`;

const digestPattern = `^[0-9a-f]{${artifactDigestChars}}$`;

const countIsBounded = (columns: readonly string[]) =>
  columns
    .map((column) => `${column} BETWEEN 0 AND ${runCountMax}`)
    .join("\n     AND ");

const labelIsBounded = (column: string) =>
  `${column} IS NULL OR (length(${column}) BETWEEN 1 AND ${runOutcomeLabelCharsMax}
     AND ${column} !~ '[[:cntrl:]]')`;

const tokenColumns = [
  "tokens_input",
  "tokens_output",
  "tokens_cache_creation",
  "tokens_cache_read",
];

const runEvidenceRelations = [
  `CREATE TABLE execution_run (
     tenant text NOT NULL, project text NOT NULL,
     execution text NOT NULL, attempt text NOT NULL,
     started_at timestamptz NOT NULL DEFAULT now(),
     configuration_path text, configuration_digest text,
     configuration_bytes bigint, configuration_recorded_at timestamptz,
     PRIMARY KEY (${runKey}),
     FOREIGN KEY (${runKey}) REFERENCES execution_attempt (${runKey}),
     CONSTRAINT execution_run_configuration_is_whole CHECK (
       (configuration_path IS NULL) = (configuration_digest IS NULL)
       AND (configuration_path IS NULL) = (configuration_bytes IS NULL)
       AND (configuration_path IS NULL) = (configuration_recorded_at IS NULL)),
     CONSTRAINT execution_run_configuration_is_bounded CHECK (
       configuration_path IS NULL
       OR (${pathIsNormalized("configuration_path")}
           AND configuration_digest ~ '${digestPattern}'
           AND configuration_bytes BETWEEN 0 AND ${runConfigurationBytesMax})))`,
  `CREATE TABLE execution_run_transcript_batch (
     tenant text NOT NULL, project text NOT NULL,
     execution text NOT NULL, attempt text NOT NULL, batch bigint NOT NULL,
     path text NOT NULL, digest text NOT NULL, bytes bigint NOT NULL,
     events bigint NOT NULL,
     recorded_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (${runKey},batch),
     FOREIGN KEY (${runKey}) REFERENCES execution_run (${runKey}),
     CONSTRAINT execution_run_batch_is_bounded CHECK (
       batch BETWEEN 1 AND ${runTranscriptBatchesMax}
       AND bytes BETWEEN 0 AND ${runTranscriptBatchBytesMax}
       AND events BETWEEN 0 AND ${runTranscriptBatchBytesMax}),
     CONSTRAINT execution_run_batch_object_is_bounded CHECK (
       ${pathIsNormalized("path")} AND digest ~ '${digestPattern}'))`,
  `CREATE TABLE execution_run_turn (
     tenant text NOT NULL, project text NOT NULL,
     execution text NOT NULL, attempt text NOT NULL, ordinal bigint NOT NULL,
     model text NOT NULL,
     tokens_input bigint NOT NULL, tokens_output bigint NOT NULL,
     tokens_cache_creation bigint NOT NULL, tokens_cache_read bigint NOT NULL,
     recorded_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (${runKey},ordinal),
     FOREIGN KEY (${runKey}) REFERENCES execution_run (${runKey}),
     CONSTRAINT execution_run_turn_ordinal_is_bounded CHECK (
       ordinal BETWEEN 1 AND ${runTurnSeriesMax}),
     CONSTRAINT execution_run_turn_model_is_bounded CHECK (
       length(model) BETWEEN 1 AND ${runModelCharsMax}
       AND model !~ '[[:cntrl:]]'),
     CONSTRAINT execution_run_turn_tokens_are_bounded CHECK (
       ${countIsBounded(tokenColumns)}))`,
  `CREATE TABLE execution_run_total (
     tenant text NOT NULL, project text NOT NULL,
     execution text NOT NULL, attempt text NOT NULL,
     turns bigint NOT NULL, duration_ms bigint NOT NULL,
     duration_api_ms bigint NOT NULL,
     tokens_input bigint NOT NULL, tokens_output bigint NOT NULL,
     tokens_cache_creation bigint NOT NULL, tokens_cache_read bigint NOT NULL,
     cost_usd_micros bigint NOT NULL, cost_basis text NOT NULL,
     permission_denials bigint NOT NULL,
     result_subtype text, stop_reason text,
     recorded_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (${runKey}),
     FOREIGN KEY (${runKey}) REFERENCES execution_run (${runKey}),
     CONSTRAINT execution_run_total_basis_is_known CHECK (
       cost_basis IN (${schemaTextSet([...runCostBases])})),
     CONSTRAINT execution_run_total_counts_are_bounded CHECK (
       ${countIsBounded([
         ...tokenColumns,
         "turns",
         "duration_ms",
         "duration_api_ms",
         "cost_usd_micros",
         "permission_denials",
       ])}),
     CONSTRAINT execution_run_total_labels_are_bounded CHECK (
       (${labelIsBounded("result_subtype")})
       AND (${labelIsBounded("stop_reason")})))`,
  `CREATE TABLE execution_run_model_usage (
     tenant text NOT NULL, project text NOT NULL,
     execution text NOT NULL, attempt text NOT NULL, model text NOT NULL,
     tokens_input bigint NOT NULL, tokens_output bigint NOT NULL,
     tokens_cache_creation bigint NOT NULL, tokens_cache_read bigint NOT NULL,
     cost_usd_micros bigint NOT NULL,
     PRIMARY KEY (${runKey},model),
     FOREIGN KEY (${runKey}) REFERENCES execution_run_total (${runKey}),
     CONSTRAINT execution_run_model_is_bounded CHECK (
       length(model) BETWEEN 1 AND ${runModelCharsMax}
       AND model !~ '[[:cntrl:]]'),
     CONSTRAINT execution_run_model_counts_are_bounded CHECK (
       ${countIsBounded([...tokenColumns, "cost_usd_micros"])}))`,
];

const configurationColumns = [
  "configuration_path",
  "configuration_digest",
  "configuration_bytes",
  "configuration_recorded_at",
];

const runEvidenceImmutability = [
  `CREATE FUNCTION ${runEvidenceImmutableFunction}() RETURNS trigger
     LANGUAGE plpgsql AS $$
     BEGIN
       RAISE EXCEPTION
         'run evidence for attempt % is written once, and evidence that could be edited is not evidence',
         OLD.attempt USING ERRCODE = 'integrity_constraint_violation';
     END $$`,
  `REVOKE EXECUTE ON FUNCTION ${runEvidenceImmutableFunction}() FROM PUBLIC`,
  `CREATE FUNCTION ${runConfigurationImmutableFunction}() RETURNS trigger
     LANGUAGE plpgsql AS $$
     BEGIN
       IF TG_OP = 'UPDATE' AND OLD.configuration_path IS NULL
          AND NEW.configuration_path IS NOT NULL
          AND (to_jsonb(NEW) ${configurationColumns.map((column) => `- '${column}'`).join(" ")})
              IS NOT DISTINCT FROM
              (to_jsonb(OLD) ${configurationColumns.map((column) => `- '${column}'`).join(" ")}) THEN
         RETURN NEW;
       END IF;
       RAISE EXCEPTION
         'run % records its configuration once and is written once otherwise',
         OLD.attempt USING ERRCODE = 'integrity_constraint_violation';
     END $$`,
  `REVOKE EXECUTE ON FUNCTION ${runConfigurationImmutableFunction}() FROM PUBLIC`,
  `CREATE TRIGGER execution_run_is_written_once
     BEFORE UPDATE OR DELETE ON execution_run
     FOR EACH ROW EXECUTE FUNCTION ${runConfigurationImmutableFunction}()`,
  ...[
    "execution_run_transcript_batch",
    "execution_run_turn",
    "execution_run_total",
    "execution_run_model_usage",
  ].map(
    (relation) => `CREATE TRIGGER ${relation}_is_written_once
     BEFORE UPDATE OR DELETE ON ${relation}
     FOR EACH ROW EXECUTE FUNCTION ${runEvidenceImmutableFunction}()`,
  ),
];

const bindingSignature = `${workerRunBindingFunction}(text,bigint)`;
const configurationSignature = `${workerRunConfigurationFunction}(text,bigint,text,text,bigint)`;
const transcriptSignature = `${workerRunTranscriptFunction}(text,bigint,bigint,text,text,bigint,bigint)`;
const turnsSignature = `${workerRunTurnsFunction}(text,bigint,jsonb)`;
const totalSignature = `${workerRunTotalFunction}(text,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,text,bigint,text,text,jsonb)`;

/** The four boundary functions and the one binding they all open with. */
const workerRunBinding = [
  `CREATE FUNCTION ${workerRunBindingFunction}(
     in_secret_digest text,in_generation bigint)
     RETURNS TABLE(tenant text,project text,execution text,attempt text,ticket bigint)
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE bound record;
     BEGIN
       SELECT a.tenant,a.project,a.execution,a.attempt,a.generation,a.state,
              a.recovery_epoch,e.status,e.ticket INTO bound
         FROM execution_attempt a
         JOIN execution e ON e.tenant=a.tenant AND e.project=a.project
                         AND e.execution=a.execution
        WHERE a.capability_secret_digest=in_secret_digest FOR UPDATE OF a;
       IF NOT FOUND OR bound.state NOT IN ('Placing','Running')
          OR bound.status NOT IN ('Launching','Running')
          OR bound.generation<>in_generation
          OR bound.recovery_epoch<>(SELECT epoch FROM recovery_epoch
                                     ORDER BY ordinal DESC LIMIT 1) THEN
         RETURN;
       END IF;
       RETURN QUERY SELECT bound.tenant,bound.project,bound.execution,
                           bound.attempt,bound.ticket;
     END $$`,
  `ALTER FUNCTION ${bindingSignature} OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${bindingSignature} FROM PUBLIC`,
];

const workerRunConfigurationWrite = [
  `CREATE FUNCTION ${workerRunConfigurationFunction}(
     in_secret_digest text,in_generation bigint,in_path text,
     in_digest text,in_bytes bigint) RETURNS text
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE bound record; existing record;
     BEGIN
       SELECT * INTO bound FROM ${workerRunBindingFunction}(in_secret_digest,in_generation);
       IF NOT FOUND THEN RETURN 'Fenced'; END IF;
       IF NOT (${pathIsNormalized("in_path")})
          OR in_digest !~ '${digestPattern}' THEN
         RETURN 'Conflict';
       END IF;
       IF in_bytes NOT BETWEEN 0 AND ${runConfigurationBytesMax} THEN
         RETURN 'QuotaExceeded';
       END IF;
       SELECT configuration_path,configuration_digest,configuration_bytes
         INTO existing FROM execution_run WHERE ${runBound};
       IF NOT FOUND THEN
         INSERT INTO execution_run (${runKey},configuration_path,
             configuration_digest,configuration_bytes,configuration_recorded_at)
           VALUES(bound.tenant,bound.project,bound.execution,bound.attempt,
                  in_path,in_digest,in_bytes,now());
         RETURN 'Stored';
       END IF;
       IF existing.configuration_path IS NULL THEN
         UPDATE execution_run SET configuration_path=in_path,
                configuration_digest=in_digest,configuration_bytes=in_bytes,
                configuration_recorded_at=now() WHERE ${runBound};
         RETURN 'Stored';
       END IF;
       RETURN CASE WHEN existing.configuration_digest=in_digest
                    AND existing.configuration_bytes=in_bytes
                   THEN 'AlreadyStored' ELSE 'Conflict' END;
     END $$`,
  `ALTER FUNCTION ${configurationSignature} OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${configurationSignature} FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${configurationSignature} TO ${workerPlaneRole}`,
];

const workerRunTranscriptWrite = [
  `CREATE FUNCTION ${workerRunTranscriptFunction}(
     in_secret_digest text,in_generation bigint,in_batch bigint,in_path text,
     in_digest text,in_bytes bigint,in_events bigint) RETURNS text
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE bound record; existing record; highest bigint;
     BEGIN
       SELECT * INTO bound FROM ${workerRunBindingFunction}(in_secret_digest,in_generation);
       IF NOT FOUND THEN RETURN 'Fenced'; END IF;
       IF NOT (${pathIsNormalized("in_path")})
          OR in_digest !~ '${digestPattern}' THEN
         RETURN 'Conflict';
       END IF;
       IF in_batch NOT BETWEEN 1 AND ${runTranscriptBatchesMax}
          OR in_bytes NOT BETWEEN 0 AND ${runTranscriptBatchBytesMax}
          OR in_events NOT BETWEEN 0 AND ${runTranscriptBatchBytesMax} THEN
         RETURN 'QuotaExceeded';
       END IF;
       INSERT INTO execution_run (${runKey})
         VALUES(bound.tenant,bound.project,bound.execution,bound.attempt)
         ON CONFLICT DO NOTHING;
       SELECT digest,bytes INTO existing FROM execution_run_transcript_batch
        WHERE ${runBound} AND batch=in_batch;
       IF FOUND THEN
         RETURN CASE WHEN existing.digest=in_digest AND existing.bytes=in_bytes
                     THEN 'AlreadyStored' ELSE 'Conflict' END;
       END IF;
       SELECT coalesce(max(batch),0) INTO highest
         FROM execution_run_transcript_batch WHERE ${runBound};
       IF in_batch<>highest+1 THEN RETURN 'OutOfOrder'; END IF;
       INSERT INTO execution_run_transcript_batch
           (${runKey},batch,path,digest,bytes,events)
         VALUES(bound.tenant,bound.project,bound.execution,bound.attempt,
                in_batch,in_path,in_digest,in_bytes,in_events);
       RETURN 'Stored';
     END $$`,
  `ALTER FUNCTION ${transcriptSignature} OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${transcriptSignature} FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${transcriptSignature} TO ${workerPlaneRole}`,
];

/** The token fields every usage row carries, as one offered element states them. */
const offeredTokens = [
  "tokensInput",
  "tokensOutput",
  "tokensCacheCreation",
  "tokensCacheRead",
];

const offeredCount = (field: string) =>
  `coalesce(offered->>'${field}','') ~ '^[0-9]+$'
     AND (CASE WHEN coalesce(offered->>'${field}','') ~ '^[0-9]+$'
               THEN (offered->>'${field}')::numeric ELSE ${runCountMax} + 1 END)
         <= ${runCountMax}`;

const offeredTokensAreWhole = offeredTokens
  .map((field) => `(${offeredCount(field)})`)
  .join("\n     AND ");

const offeredToken = (field: string) => `(offered->>'${field}')::bigint`;

/**
 * The wire name of each model-usage field beside the column holding it, so the
 * two sides of an equality over a breakdown are built from one list rather than
 * from two that could name different fields.
 */
const modelUsageFields: readonly (readonly [string, string])[] = [
  ["model", "model"],
  ...offeredTokens.map(
    (field, index) => [field, tokenColumns[index] ?? ""] as const,
  ),
  ["costUsdMicros", "cost_usd_micros"],
];

const storedModelUsage = modelUsageFields
  .map(([wire, column]) => `'${wire}',${column}`)
  .join(",");

const offeredModelUsage = modelUsageFields
  .map(([wire]) =>
    wire === "model"
      ? `'${wire}',offered->>'model'`
      : `'${wire}',${offeredToken(wire)}`,
  )
  .join(",");

const workerRunTurnsWrite = [
  `CREATE FUNCTION ${workerRunTurnsFunction}(
     in_secret_digest text,in_generation bigint,in_turns jsonb)
     RETURNS TABLE(recorded text,turns bigint)
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE bound record;
     BEGIN
       SELECT * INTO bound FROM ${workerRunBindingFunction}(in_secret_digest,in_generation);
       IF NOT FOUND THEN
         RETURN QUERY SELECT 'Fenced'::text,0::bigint; RETURN;
       END IF;
       IF jsonb_typeof(in_turns) IS DISTINCT FROM 'array'
          OR jsonb_array_length(in_turns) NOT BETWEEN 1 AND ${nativeHttpPageItemsMax}
          OR (SELECT count(DISTINCT offered->>'ordinal')
                FROM jsonb_array_elements(in_turns) x(offered))
             <> jsonb_array_length(in_turns)
          OR EXISTS(SELECT 1 FROM jsonb_array_elements(in_turns) x(offered)
               WHERE jsonb_typeof(offered) IS DISTINCT FROM 'object'
                  OR NOT (coalesce(offered->>'ordinal','') ~ '^[0-9]+$')
                  OR (CASE WHEN coalesce(offered->>'ordinal','') ~ '^[0-9]+$'
                           THEN (offered->>'ordinal')::numeric ELSE 0 END)
                     NOT BETWEEN 1 AND ${runTurnSeriesMax}
                  OR length(coalesce(offered->>'model','')) NOT BETWEEN 1 AND ${runModelCharsMax}
                  OR coalesce(offered->>'model','') ~ '[[:cntrl:]]'
                  OR NOT (${offeredTokensAreWhole})) THEN
         RETURN QUERY SELECT 'Conflict'::text,0::bigint; RETURN;
       END IF;
       INSERT INTO execution_run (${runKey})
         VALUES(bound.tenant,bound.project,bound.execution,bound.attempt)
         ON CONFLICT DO NOTHING;
       IF EXISTS(SELECT 1 FROM jsonb_array_elements(in_turns) x(offered)
                 JOIN execution_run_turn t
                   ON t.tenant=bound.tenant AND t.project=bound.project
                  AND t.execution=bound.execution AND t.attempt=bound.attempt
                  AND t.ordinal=(offered->>'ordinal')::bigint
                 WHERE (t.model,${tokenColumns.map((column) => `t.${column}`).join(",")})
                    IS DISTINCT FROM
                       (offered->>'model',${offeredTokens.map(offeredToken).join(",")})) THEN
         RETURN QUERY SELECT 'Conflict'::text,0::bigint; RETURN;
       END IF;
       INSERT INTO execution_run_turn
           (${runKey},ordinal,model,${tokenColumns.join(",")})
         SELECT bound.tenant,bound.project,bound.execution,bound.attempt,
                (offered->>'ordinal')::bigint,offered->>'model',
                ${offeredTokens.map(offeredToken).join(",\n                ")}
           FROM jsonb_array_elements(in_turns) x(offered)
         ON CONFLICT DO NOTHING;
       RETURN QUERY SELECT 'Recorded'::text,coalesce(max(ordinal),0)::bigint
         FROM execution_run_turn WHERE ${runBound};
     END $$`,
  `ALTER FUNCTION ${turnsSignature} OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${turnsSignature} FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${turnsSignature} TO ${workerPlaneRole}`,
];

const totalColumnNames = [
  "turns",
  "duration_ms",
  "duration_api_ms",
  ...tokenColumns,
  "cost_usd_micros",
  "cost_basis",
  "permission_denials",
  "result_subtype",
  "stop_reason",
];

/** The offered value for each stored column, in the order the columns are named. */
const totalOfferedNames = totalColumnNames.map((column) => `in_${column}`);

const totalColumns = totalColumnNames.join(",");
const totalStored = totalColumnNames
  .map((column) => `stored.${column}`)
  .join(",");
const totalOffered = totalOfferedNames.join(",");

const workerRunTotalWrite = [
  `CREATE FUNCTION ${workerRunTotalFunction}(
     in_secret_digest text,in_generation bigint,in_turns bigint,
     in_duration_ms bigint,in_duration_api_ms bigint,in_tokens_input bigint,
     in_tokens_output bigint,in_tokens_cache_creation bigint,
     in_tokens_cache_read bigint,in_cost_usd_micros bigint,in_cost_basis text,
     in_permission_denials bigint,in_result_subtype text,in_stop_reason text,
     in_models jsonb) RETURNS text
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE bound record; stored record; kept jsonb; offered_usage jsonb;
     BEGIN
       SELECT * INTO bound FROM ${workerRunBindingFunction}(in_secret_digest,in_generation);
       IF NOT FOUND THEN RETURN 'Fenced'; END IF;
       IF jsonb_typeof(in_models) IS DISTINCT FROM 'array'
          OR jsonb_array_length(in_models) > ${nativeHttpPageItemsMax}
          OR (SELECT count(DISTINCT offered->>'model')
                FROM jsonb_array_elements(in_models) x(offered))
             <> jsonb_array_length(in_models)
          OR EXISTS(SELECT 1 FROM jsonb_array_elements(in_models) x(offered)
               WHERE jsonb_typeof(offered) IS DISTINCT FROM 'object'
                  OR length(coalesce(offered->>'model','')) NOT BETWEEN 1 AND ${runModelCharsMax}
                  OR coalesce(offered->>'model','') ~ '[[:cntrl:]]'
                  OR NOT (${offeredCount("costUsdMicros")})
                  OR NOT (${offeredTokensAreWhole})) THEN
         RETURN 'Conflict';
       END IF;
       INSERT INTO execution_run (${runKey})
         VALUES(bound.tenant,bound.project,bound.execution,bound.attempt)
         ON CONFLICT DO NOTHING;
       SELECT ${totalColumns} INTO stored FROM execution_run_total WHERE ${runBound};
       IF FOUND THEN
         SELECT coalesce(jsonb_agg(jsonb_build_object(${storedModelUsage})
                                   ORDER BY model),'[]'::jsonb)
           INTO kept FROM execution_run_model_usage WHERE ${runBound};
         SELECT coalesce(jsonb_agg(jsonb_build_object(${offeredModelUsage})
                                   ORDER BY offered->>'model'),'[]'::jsonb)
           INTO offered_usage FROM jsonb_array_elements(in_models) x(offered);
         RETURN CASE WHEN (${totalStored})
                       IS NOT DISTINCT FROM (${totalOffered})
                      AND kept IS NOT DISTINCT FROM offered_usage
                     THEN 'AlreadyStored' ELSE 'Conflict' END;
       END IF;
       INSERT INTO execution_run_total (${runKey},${totalColumns})
         VALUES(bound.tenant,bound.project,bound.execution,bound.attempt,${totalOffered});
       INSERT INTO execution_run_model_usage
           (${runKey},model,${tokenColumns.join(",")},cost_usd_micros)
         SELECT bound.tenant,bound.project,bound.execution,bound.attempt,
                offered->>'model',
                ${offeredTokens.map(offeredToken).join(",\n                ")},
                ${offeredToken("costUsdMicros")}
           FROM jsonb_array_elements(in_models) x(offered);
       RETURN 'Stored';
     END $$`,
  `ALTER FUNCTION ${totalSignature} OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${totalSignature} FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${totalSignature} TO ${workerPlaneRole}`,
];

const runEvidenceChanges = [
  `CREATE TRIGGER execution_run_opening_appends_a_change
     AFTER INSERT ON execution_run
     FOR EACH ROW EXECUTE FUNCTION ${projectChangeExecutionFunction}()`,
  `CREATE TRIGGER execution_run_batch_appends_a_change
     AFTER INSERT ON execution_run_transcript_batch
     FOR EACH ROW EXECUTE FUNCTION ${projectChangeExecutionFunction}()`,
  `CREATE FUNCTION ${projectChangeRunFunction}() RETURNS trigger
     LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
     BEGIN
       PERFORM ${projectChangeAppendFunction}(
         NEW.tenant,NEW.project,'Execution',NEW.execution);
       PERFORM ${projectChangeAppendFunction}(NEW.tenant,NEW.project,'Ticket',
         (SELECT named.ticket::text FROM execution AS named
           WHERE named.tenant=NEW.tenant AND named.project=NEW.project
             AND named.execution=NEW.execution));
       RETURN NULL;
     END $$`,
  `ALTER FUNCTION ${projectChangeRunFunction}() OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${projectChangeRunFunction}() FROM PUBLIC`,
  `CREATE TRIGGER execution_run_total_appends_a_change
     AFTER INSERT ON execution_run_total
     FOR EACH ROW EXECUTE FUNCTION ${projectChangeRunFunction}()`,
];

const runEvidenceRelationNames = [
  "execution_run",
  "execution_run_transcript_batch",
  "execution_run_turn",
  "execution_run_total",
  "execution_run_model_usage",
].join(",");

/**
 * What each relation shows the API, named column by column as every other
 * public read is: a relation granted whole is one a later column joins without
 * anybody deciding it should be readable.
 */
const runEvidenceApiColumns: readonly (readonly [string, readonly string[]])[] =
  [
    [
      "execution_run",
      [...runKey.split(","), "started_at", ...configurationColumns],
    ],
    [
      "execution_run_transcript_batch",
      [
        ...runKey.split(","),
        "batch",
        "path",
        "digest",
        "bytes",
        "events",
        "recorded_at",
      ],
    ],
    [
      "execution_run_turn",
      [
        ...runKey.split(","),
        "ordinal",
        "model",
        ...tokenColumns,
        "recorded_at",
      ],
    ],
    [
      "execution_run_total",
      [...runKey.split(","), ...totalColumnNames, "recorded_at"],
    ],
    [
      "execution_run_model_usage",
      [...runKey.split(","), "model", ...tokenColumns, "cost_usd_micros"],
    ],
  ];

const runEvidenceGrants = [
  `GRANT SELECT,INSERT ON ${runEvidenceRelationNames} TO ${boundaryOwnerRole}`,
  `GRANT UPDATE (${configurationColumns.join(",")}) ON execution_run
     TO ${boundaryOwnerRole}`,
  ...runEvidenceApiColumns.map(
    ([relation, columns]) =>
      `GRANT SELECT (${columns.join(",")}) ON ${relation} TO ${apiRole}`,
  ),
  `GRANT SELECT (evidence) ON execution_attempt TO ${apiRole}`,
  `GRANT SELECT (tenant,project,manifest,report) ON execution_result_report
     TO ${apiRole}`,
];

/** Durable run evidence and the attempt-fenced boundary that writes it. */
export const migration049: Migration = {
  version: 49,
  name: "run evidence",
  statements: [
    ...runEvidenceRelations,
    ...runEvidenceImmutability,
    ...workerRunBinding,
    ...workerRunConfigurationWrite,
    ...workerRunTranscriptWrite,
    ...workerRunTurnsWrite,
    ...workerRunTotalWrite,
    ...runEvidenceChanges,
    ...runEvidenceGrants,
  ],
};
