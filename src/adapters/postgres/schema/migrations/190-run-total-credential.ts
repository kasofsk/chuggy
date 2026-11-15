/**
 * A run's totals keep the name of the credential it ran on, where the run
 * named one, so each attempt's run says which of its agent's credentials it
 * used.
 *
 * `execution_run_total` GAINS `credential`, held to the pattern 163 holds the
 * account rows' to and written out here as 163 writes it. Every row kept
 * before this migration names none, and the API reads it as each other column.
 *
 * `record_worker_run_total` IS DROPPED AND RECREATED taking the name as a last
 * argument defaulting to none, so a caller at its old arity resolves to the
 * same door. Its body is the baseline's with the name written, and a repeat
 * compares it as every other field.
 */

import {
  apiRole,
  boundaryOwnerRole,
  workerPlaneRole,
  workerRunTotalFunction,
  type Migration,
} from "../shared.ts";

const parameters =
  "in_secret_digest text, in_generation bigint, in_turns bigint, in_duration_ms bigint, in_duration_api_ms bigint, in_tokens_input bigint, in_tokens_output bigint, in_tokens_cache_creation bigint, in_tokens_cache_read bigint, in_cost_usd_micros bigint, in_cost_basis text, in_permission_denials bigint, in_result_subtype text, in_stop_reason text, in_models jsonb";

const totalOld = `public.${workerRunTotalFunction}(${parameters})`;
const total = `public.${workerRunTotalFunction}(${parameters}, in_credential text)`;
const totalCreated = `public.${workerRunTotalFunction}(${parameters}, in_credential text DEFAULT NULL)`;

export const migration190: Migration = {
  version: 190,
  name: "a run's totals keep the credential it ran on",
  statements: [
    `ALTER TABLE public.execution_run_total
       ADD COLUMN credential text,
       ADD CONSTRAINT execution_run_total_credential_is_named
         CHECK (credential ~ '^[A-Za-z0-9_-]{1,64}$')`,
    `GRANT SELECT(credential) ON TABLE public.execution_run_total TO ${apiRole}`,
    `DROP FUNCTION ${totalOld}`,
    `CREATE FUNCTION ${totalCreated} RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
     DECLARE bound record; stored record; kept jsonb; offered_usage jsonb;
     BEGIN
       SELECT * INTO bound FROM worker_run_binding(in_secret_digest,in_generation);
       IF NOT FOUND THEN RETURN 'Fenced'; END IF;
       IF jsonb_typeof(in_models) IS DISTINCT FROM 'array'
          OR jsonb_array_length(in_models) > 100
          OR (SELECT count(DISTINCT offered->>'model')
                FROM jsonb_array_elements(in_models) x(offered))
             <> jsonb_array_length(in_models)
          OR EXISTS(SELECT 1 FROM jsonb_array_elements(in_models) x(offered)
               WHERE jsonb_typeof(offered) IS DISTINCT FROM 'object'
                  OR length(coalesce(offered->>'model','')) NOT BETWEEN 1 AND 128
                  OR coalesce(offered->>'model','') ~ '[[:cntrl:]]'
                  OR NOT (coalesce(offered->>'costUsdMicros','') ~ '^[0-9]+$'
     AND (CASE WHEN coalesce(offered->>'costUsdMicros','') ~ '^[0-9]+$'
               THEN (offered->>'costUsdMicros')::numeric ELSE 9007199254740991 + 1 END)
         <= 9007199254740991)
                  OR NOT ((coalesce(offered->>'tokensInput','') ~ '^[0-9]+$'
     AND (CASE WHEN coalesce(offered->>'tokensInput','') ~ '^[0-9]+$'
               THEN (offered->>'tokensInput')::numeric ELSE 9007199254740991 + 1 END)
         <= 9007199254740991)
     AND (coalesce(offered->>'tokensOutput','') ~ '^[0-9]+$'
     AND (CASE WHEN coalesce(offered->>'tokensOutput','') ~ '^[0-9]+$'
               THEN (offered->>'tokensOutput')::numeric ELSE 9007199254740991 + 1 END)
         <= 9007199254740991)
     AND (coalesce(offered->>'tokensCacheCreation','') ~ '^[0-9]+$'
     AND (CASE WHEN coalesce(offered->>'tokensCacheCreation','') ~ '^[0-9]+$'
               THEN (offered->>'tokensCacheCreation')::numeric ELSE 9007199254740991 + 1 END)
         <= 9007199254740991)
     AND (coalesce(offered->>'tokensCacheRead','') ~ '^[0-9]+$'
     AND (CASE WHEN coalesce(offered->>'tokensCacheRead','') ~ '^[0-9]+$'
               THEN (offered->>'tokensCacheRead')::numeric ELSE 9007199254740991 + 1 END)
         <= 9007199254740991))) THEN
         RETURN 'Conflict';
       END IF;
       INSERT INTO execution_run (tenant,project,execution,attempt)
         VALUES(bound.tenant,bound.project,bound.execution,bound.attempt)
         ON CONFLICT DO NOTHING;
       SELECT turns,duration_ms,duration_api_ms,tokens_input,tokens_output,tokens_cache_creation,tokens_cache_read,cost_usd_micros,cost_basis,permission_denials,result_subtype,stop_reason,credential INTO stored FROM execution_run_total WHERE tenant=bound.tenant AND project=bound.project
              AND execution=bound.execution AND attempt=bound.attempt;
       IF FOUND THEN
         SELECT coalesce(jsonb_agg(jsonb_build_object('model',model,'tokensInput',tokens_input,'tokensOutput',tokens_output,'tokensCacheCreation',tokens_cache_creation,'tokensCacheRead',tokens_cache_read,'costUsdMicros',cost_usd_micros)
                                   ORDER BY model),'[]'::jsonb)
           INTO kept FROM execution_run_model_usage WHERE tenant=bound.tenant AND project=bound.project
              AND execution=bound.execution AND attempt=bound.attempt;
         SELECT coalesce(jsonb_agg(jsonb_build_object('model',offered->>'model','tokensInput',(offered->>'tokensInput')::bigint,'tokensOutput',(offered->>'tokensOutput')::bigint,'tokensCacheCreation',(offered->>'tokensCacheCreation')::bigint,'tokensCacheRead',(offered->>'tokensCacheRead')::bigint,'costUsdMicros',(offered->>'costUsdMicros')::bigint)
                                   ORDER BY offered->>'model'),'[]'::jsonb)
           INTO offered_usage FROM jsonb_array_elements(in_models) x(offered);
         RETURN CASE WHEN (stored.turns,stored.duration_ms,stored.duration_api_ms,stored.tokens_input,stored.tokens_output,stored.tokens_cache_creation,stored.tokens_cache_read,stored.cost_usd_micros,stored.cost_basis,stored.permission_denials,stored.result_subtype,stored.stop_reason,stored.credential)
                       IS NOT DISTINCT FROM (in_turns,in_duration_ms,in_duration_api_ms,in_tokens_input,in_tokens_output,in_tokens_cache_creation,in_tokens_cache_read,in_cost_usd_micros,in_cost_basis,in_permission_denials,in_result_subtype,in_stop_reason,in_credential)
                      AND kept IS NOT DISTINCT FROM offered_usage
                     THEN 'AlreadyStored' ELSE 'Conflict' END;
       END IF;
       INSERT INTO execution_run_total (tenant,project,execution,attempt,turns,duration_ms,duration_api_ms,tokens_input,tokens_output,tokens_cache_creation,tokens_cache_read,cost_usd_micros,cost_basis,permission_denials,result_subtype,stop_reason,credential)
         VALUES(bound.tenant,bound.project,bound.execution,bound.attempt,in_turns,in_duration_ms,in_duration_api_ms,in_tokens_input,in_tokens_output,in_tokens_cache_creation,in_tokens_cache_read,in_cost_usd_micros,in_cost_basis,in_permission_denials,in_result_subtype,in_stop_reason,in_credential);
       INSERT INTO execution_run_model_usage
           (tenant,project,execution,attempt,model,tokens_input,tokens_output,tokens_cache_creation,tokens_cache_read,cost_usd_micros)
         SELECT bound.tenant,bound.project,bound.execution,bound.attempt,
                offered->>'model',
                (offered->>'tokensInput')::bigint,
                (offered->>'tokensOutput')::bigint,
                (offered->>'tokensCacheCreation')::bigint,
                (offered->>'tokensCacheRead')::bigint,
                (offered->>'costUsdMicros')::bigint
           FROM jsonb_array_elements(in_models) x(offered);
       RETURN 'Stored';
     END $_$`,
    `ALTER FUNCTION ${total} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${total} FROM PUBLIC`,
    `GRANT ALL ON FUNCTION ${total} TO ${workerPlaneRole}`,
  ],
};
