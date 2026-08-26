import {
  boundaryOwnerRole,
  workerPlaneRole,
  workerResultSubmitFunction,
  type Migration,
} from "../shared.ts";
import {
  finalizerIdentityCharsMax,
  gitObjectIdPattern,
  gitRefNameCharsMax,
} from "../../../../interpreter/finalizer.ts";

/** Source reports may carry diagnostics but never authoritative artifact handoffs. */
export const migration035: Migration = {
  version: 35,
  name: "source diagnostics",
  statements: [
    `CREATE OR REPLACE FUNCTION ${workerResultSubmitFunction}(
       in_secret_digest text,in_generation bigint,in_manifest text,in_schema integer,
       in_digest text,in_verdict text,in_artifacts jsonb,in_source jsonb,in_operation text)
       RETURNS TABLE(terminalized text,outcome text,operation text,incident text)
       LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
       DECLARE submitted record; bound record; incident_id text;
       BEGIN
         IF in_source IS NOT NULL AND (
              in_verdict<>'Pass'
              OR CASE WHEN jsonb_typeof(in_artifacts)='array' THEN EXISTS(
                   SELECT 1 FROM jsonb_array_elements(in_artifacts) x(artifact)
                    WHERE artifact->>'role'='Handoff') ELSE true END
              OR jsonb_typeof(in_source) IS DISTINCT FROM 'object'
              OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(in_source) key)
                 IS DISTINCT FROM ARRAY['base','commit','ref','repository']::text[]
              OR length(coalesce(in_source->>'repository','')) NOT BETWEEN 1 AND ${finalizerIdentityCharsMax}
              OR length(coalesce(in_source->>'ref','')) NOT BETWEEN 1 AND ${gitRefNameCharsMax}
              OR coalesce(in_source->>'commit','') !~ '${gitObjectIdPattern()}'
              OR coalesce(in_source->>'base','') !~ '${gitObjectIdPattern()}'
              OR NOT EXISTS (
                SELECT 1 FROM execution_attempt a
                JOIN execution e
                  ON e.tenant=a.tenant AND e.project=a.project AND e.execution=a.execution
                JOIN execution_request q
                  ON q.tenant=e.tenant AND q.project=e.project AND q.request=e.source_request
                JOIN input_bundle_reference b
                  ON b.tenant=q.tenant AND b.project=q.project AND b.bundle=q.input_bundle
                     AND b.reference_kind='TargetCommit'
               WHERE a.capability_secret_digest=in_secret_digest
                 AND b.reference_id=in_source->>'base')) THEN
           SELECT a.tenant,a.project,a.execution,a.attempt INTO bound
             FROM execution_attempt a WHERE a.capability_secret_digest=in_secret_digest;
           IF NOT FOUND THEN
             RETURN QUERY SELECT 'Fenced'::text,NULL::text,NULL::text,NULL::text; RETURN;
           END IF;
           incident_id='incident-'||gen_random_uuid()::text;
           INSERT INTO scheduler_incident(tenant,project,incident,kind,execution,attempt,evidence)
             VALUES(bound.tenant,bound.project,incident_id,'ConflictingResult',bound.execution,
                    bound.attempt,'ForeignManifest');
           RETURN QUERY SELECT 'Conflicting'::text,NULL::text,NULL::text,incident_id; RETURN;
         END IF;
         SELECT * INTO submitted FROM ${workerResultSubmitFunction}(
           in_secret_digest,in_generation,in_manifest,in_schema,in_digest,in_verdict,
           in_artifacts,in_operation);
         IF submitted.terminalized='Terminalized' AND in_source IS NOT NULL THEN
           SELECT a.tenant,a.project,a.execution INTO STRICT bound FROM execution_attempt a
            WHERE a.capability_secret_digest=in_secret_digest;
           INSERT INTO execution_result_source
             (tenant,project,manifest,repository,ref,commit,base,expected_base)
             SELECT bound.tenant,bound.project,in_manifest,in_source->>'repository',
                    in_source->>'ref',in_source->>'commit',in_source->>'base',b.reference_id
               FROM execution e
               JOIN execution_request q
                 ON q.tenant=e.tenant AND q.project=e.project AND q.request=e.source_request
               JOIN input_bundle_reference b
                 ON b.tenant=q.tenant AND b.project=q.project AND b.bundle=q.input_bundle
                    AND b.reference_kind='TargetCommit'
              WHERE e.tenant=bound.tenant AND e.project=bound.project
                AND e.execution=bound.execution;
         END IF;
         RETURN QUERY SELECT submitted.terminalized,submitted.outcome,
                             submitted.operation,submitted.incident;
       END $$`,
    `ALTER FUNCTION ${workerResultSubmitFunction}(text,bigint,text,integer,text,text,jsonb,jsonb,text)
       OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${workerResultSubmitFunction}(text,bigint,text,integer,text,text,jsonb,jsonb,text)
       FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${workerResultSubmitFunction}(text,bigint,text,integer,text,text,jsonb,jsonb,text)
       TO ${workerPlaneRole}`,
  ],
};
