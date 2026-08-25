import {
  boundaryOwnerRole,
  completionFunction,
  roleStatement,
  schedulerRole,
  workerPlaneRole,
  workerAttemptReadFunction,
  workerAttemptLostFunction,
  workerArtifactReserveFunction,
  workerResultSubmitFunction,
  type Migration,
} from "../shared.ts";
import {
  artifactBytesMax,
  artifactDigestChars,
  artifactPathCharsMax,
  manifestArtifactsMax,
  manifestBytesMax,
} from "../../../../interpreter/resultManifest.ts";

/** Durable attempt-scoped authority for the private worker ingress. */
export const migration028: Migration = {
  version: 28,
  name: "attempt-scoped worker plane authority",
  statements: [
    roleStatement(workerPlaneRole),
    `ALTER ROLE ${workerPlaneRole} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${workerPlaneRole}`,
    `REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM ${workerPlaneRole}`,
    `GRANT USAGE ON SCHEMA public TO ${workerPlaneRole}`,
    `ALTER TABLE execution_attempt
       ADD COLUMN capability text,
       ADD COLUMN capability_secret_digest text,
       ADD COLUMN manifest text,
       ADD COLUMN cleanup_completed_at timestamptz`,
    `UPDATE execution_attempt SET
       capability = 'capability-' || gen_random_uuid()::text,
       capability_secret_digest = encode(sha256(convert_to(gen_random_uuid()::text, 'UTF8')), 'hex'),
       manifest = 'manifest-' || gen_random_uuid()::text`,
    `ALTER TABLE execution_attempt
       ALTER COLUMN capability SET NOT NULL,
       ALTER COLUMN capability_secret_digest SET NOT NULL,
       ALTER COLUMN manifest SET NOT NULL,
       ADD CONSTRAINT execution_attempt_capability_is_unique UNIQUE (capability),
       ADD CONSTRAINT execution_attempt_manifest_is_unique UNIQUE (manifest),
       ADD CONSTRAINT execution_attempt_capability_digest_is_sha256 CHECK (
         capability_secret_digest ~ '^[0-9a-f]{64}$')`,
    `CREATE TABLE worker_artifact_reservation (
       tenant text NOT NULL, project text NOT NULL, execution text NOT NULL,
       attempt text NOT NULL, path text NOT NULL, digest text NOT NULL, bytes bigint NOT NULL,
       PRIMARY KEY (tenant,project,execution,attempt,path),
       FOREIGN KEY (tenant,project,execution,attempt)
         REFERENCES execution_attempt (tenant,project,execution,attempt),
       CHECK (length(path) BETWEEN 1 AND ${artifactPathCharsMax}
         AND path !~ '^/' AND path !~ '//' AND path !~ '[\\\\]'
         AND path !~ '(^|/)[.][.]?(/|$)' AND path !~ '[[:cntrl:]]'
         AND path !~ '(^|/)[[:space:]]' AND path !~ '[[:space:]](/|$)'),
       CHECK (digest ~ '^[0-9a-f]{${artifactDigestChars}}$'),
       CHECK (bytes BETWEEN 0 AND ${artifactBytesMax}))`,
    `CREATE FUNCTION ${workerArtifactReserveFunction}(
       in_secret_digest text,in_path text,in_digest text,in_bytes bigint)
       RETURNS text LANGUAGE plpgsql SECURITY DEFINER
       SET search_path=pg_catalog,public,pg_temp AS $$
       DECLARE bound record; existing record; used record;
       BEGIN
         SELECT a.tenant,a.project,a.execution,a.attempt,a.state,a.recovery_epoch,e.status
           INTO bound FROM execution_attempt a
           JOIN execution e ON e.tenant=a.tenant AND e.project=a.project
                           AND e.execution=a.execution
          WHERE a.capability_secret_digest=in_secret_digest FOR UPDATE OF a;
         IF NOT FOUND OR bound.state NOT IN ('Placing','Running')
            OR bound.status NOT IN ('Launching','Running')
            OR bound.recovery_epoch<>(SELECT epoch FROM recovery_epoch
                                      ORDER BY ordinal DESC LIMIT 1) THEN
           RETURN 'Fenced';
         END IF;
         IF length(in_path) NOT BETWEEN 1 AND ${artifactPathCharsMax}
            OR in_path ~ '^/' OR in_path ~ '//' OR in_path ~ '[\\\\]'
            OR in_path ~ '(^|/)[.][.]?(/|$)' OR in_path ~ '[[:cntrl:]]'
            OR in_path ~ '(^|/)[[:space:]]' OR in_path ~ '[[:space:]](/|$)'
            OR in_digest !~ '^[0-9a-f]{${artifactDigestChars}}$'
            OR in_bytes NOT BETWEEN 0 AND ${artifactBytesMax} THEN
           RETURN 'Conflict';
         END IF;
         SELECT digest,bytes INTO existing FROM worker_artifact_reservation
          WHERE tenant=bound.tenant AND project=bound.project
            AND execution=bound.execution AND attempt=bound.attempt AND path=in_path;
         IF FOUND THEN
           RETURN CASE WHEN existing.digest=in_digest AND existing.bytes=in_bytes
                       THEN 'Reserved' ELSE 'Conflict' END;
         END IF;
         SELECT count(*)::bigint AS artifacts,coalesce(sum(bytes),0)::bigint AS bytes
           INTO used FROM worker_artifact_reservation
          WHERE tenant=bound.tenant AND project=bound.project
            AND execution=bound.execution AND attempt=bound.attempt;
         IF used.artifacts+1>${manifestArtifactsMax}
            OR used.bytes+in_bytes>${manifestBytesMax} THEN
           RETURN 'QuotaExceeded';
         END IF;
         INSERT INTO worker_artifact_reservation
           (tenant,project,execution,attempt,path,digest,bytes)
         VALUES(bound.tenant,bound.project,bound.execution,bound.attempt,
                in_path,in_digest,in_bytes);
         RETURN 'Reserved';
       END $$`,
    `ALTER FUNCTION ${workerArtifactReserveFunction}(text,text,text,bigint)
       OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${workerArtifactReserveFunction}(text,text,text,bigint) FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${workerArtifactReserveFunction}(text,text,text,bigint)
       TO ${workerPlaneRole}`,
    `CREATE FUNCTION ${workerAttemptReadFunction}(in_secret_digest text)
       RETURNS TABLE(tenant text,project text,execution text,attempt text,generation bigint,
                     manifest text,input_bundle text,input_bundle_digest text,live boolean,inputs jsonb)
       LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
         SELECT a.tenant,a.project,a.execution,a.attempt,a.generation,a.manifest,
                q.input_bundle,q.input_bundle_digest,
                (a.state IN ('Placing','Running') AND e.status IN ('Launching','Running')),
                coalesce((SELECT jsonb_agg(jsonb_build_object(
                  'ordinal',r.ordinal,'kind',r.reference_kind,'reference',r.reference_id,
                  'digest',r.reference_digest) ORDER BY r.ordinal)
                  FROM input_bundle_reference r
                 WHERE r.tenant=a.tenant AND r.project=a.project
                   AND r.bundle=q.input_bundle),'[]'::jsonb)
           FROM execution_attempt a
           JOIN execution e ON e.tenant=a.tenant AND e.project=a.project
                           AND e.execution=a.execution
           JOIN execution_request q ON q.tenant=e.tenant AND q.project=e.project
                                   AND q.request=e.source_request
          WHERE a.capability_secret_digest=in_secret_digest
            AND ((a.state IN ('Placing','Running') AND e.status IN ('Launching','Running'))
              OR (a.state='Reported' AND e.status='Terminal'))
            AND a.recovery_epoch=(SELECT epoch FROM recovery_epoch
                                   ORDER BY ordinal DESC LIMIT 1)
       $$`,
    `ALTER FUNCTION ${workerAttemptReadFunction}(text) OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${workerAttemptReadFunction}(text) FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${workerAttemptReadFunction}(text) TO ${workerPlaneRole}`,
    `CREATE FUNCTION ${workerAttemptLostFunction}(
       in_secret_digest text,in_generation bigint,in_evidence text)
       RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
       SET search_path=pg_catalog,public,pg_temp AS $$
       DECLARE bound record;
       BEGIN
         SELECT a.tenant,a.project,a.execution INTO bound
           FROM execution_attempt a
          WHERE a.capability_secret_digest=in_secret_digest;
         IF NOT FOUND THEN RETURN false; END IF;
         PERFORM 1 FROM execution e
          WHERE e.tenant=bound.tenant AND e.project=bound.project
            AND e.execution=bound.execution FOR UPDATE;
         UPDATE execution_attempt a
            SET state='Lost',evidence=in_evidence,ended_at=now(),
                lease_owner=NULL,lease_expires_at=NULL
          WHERE a.capability_secret_digest=in_secret_digest
            AND a.generation=in_generation AND a.state IN ('Placing','Running')
            AND a.recovery_epoch=(SELECT epoch FROM recovery_epoch
                                   ORDER BY ordinal DESC LIMIT 1);
         IF NOT FOUND THEN RETURN false; END IF;
         UPDATE execution e SET retries_spent=e.retries_spent+1,
                                placement_backoff_from=now()
          WHERE e.tenant=bound.tenant AND e.project=bound.project
            AND e.execution=bound.execution
            AND e.status NOT IN ('Terminal','Cancelled');
         RETURN FOUND;
       END $$`,
    `ALTER FUNCTION ${workerAttemptLostFunction}(text,bigint,text) OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${workerAttemptLostFunction}(text,bigint,text) FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${workerAttemptLostFunction}(text,bigint,text) TO ${workerPlaneRole}`,
    `CREATE FUNCTION ${workerResultSubmitFunction}(
       in_secret_digest text,in_generation bigint,in_manifest text,in_schema integer,
       in_digest text,in_verdict text,in_artifacts jsonb,in_operation text)
       RETURNS TABLE(terminalized text,outcome text,operation text,incident text)
       LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
       DECLARE bound record; next_manifest bigint; submitted record; incident_id text;
         settled_outcome text; artifact jsonb; project_lifecycle text;
       BEGIN
         SELECT a.tenant,a.project,a.execution,e.source_request INTO bound
           FROM execution_attempt a
           JOIN execution e ON e.tenant=a.tenant AND e.project=a.project
                           AND e.execution=a.execution
          WHERE a.capability_secret_digest=in_secret_digest;
         IF NOT FOUND THEN
           RETURN QUERY SELECT 'Fenced'::text,NULL::text,NULL::text,NULL::text; RETURN;
         END IF;
         PERFORM 1 FROM execution_request q
          WHERE q.tenant=bound.tenant AND q.project=bound.project
            AND q.request=bound.source_request FOR UPDATE;
         SELECT a.tenant,a.project,a.execution,a.attempt,a.manifest,a.state,a.recovery_epoch,
                e.status,e.outcome,e.result_manifest,e.completion_operation,e.ticket,e.task,
                e.source_request,q.effect_position
           INTO bound FROM execution_attempt a
           JOIN execution e ON e.tenant=a.tenant AND e.project=a.project
                           AND e.execution=a.execution
           JOIN execution_request q ON q.tenant=e.tenant AND q.project=e.project
                                   AND q.request=e.source_request
          WHERE a.capability_secret_digest=in_secret_digest
          FOR UPDATE OF e;
         IF NOT FOUND OR bound.recovery_epoch<>(SELECT epoch FROM recovery_epoch
                                                ORDER BY ordinal DESC LIMIT 1)
            OR bound.state NOT IN ('Placing','Running','Reported') THEN
           RETURN QUERY SELECT 'Fenced'::text,NULL::text,NULL::text,NULL::text; RETURN;
         END IF;
         IF bound.status='Cancelled' THEN
           RETURN QUERY SELECT 'Cancelled'::text,NULL::text,NULL::text,NULL::text; RETURN;
         END IF;
         IF bound.status='Terminal' THEN
           IF bound.result_manifest=in_manifest AND EXISTS(
             SELECT 1 FROM execution_result r WHERE r.tenant=bound.tenant
              AND r.project=bound.project AND r.manifest=in_manifest AND r.digest=in_digest) THEN
             RETURN QUERY SELECT 'AlreadyTerminal'::text,bound.outcome::text,
                                 bound.completion_operation::text,NULL::text; RETURN;
           END IF;
           incident_id='incident-'||gen_random_uuid()::text;
           INSERT INTO scheduler_incident(tenant,project,incident,kind,execution,attempt,evidence)
             VALUES(bound.tenant,bound.project,incident_id,'ConflictingResult',bound.execution,
                    bound.attempt,'ConflictingResult');
           RETURN QUERY SELECT 'Conflicting'::text,NULL::text,NULL::text,incident_id; RETURN;
         END IF;
         IF bound.manifest<>in_manifest OR in_generation IS DISTINCT FROM (
              SELECT generation FROM execution_attempt WHERE capability_secret_digest=in_secret_digest)
            OR in_verdict NOT IN ('Pass','Fail') THEN
           incident_id='incident-'||gen_random_uuid()::text;
           INSERT INTO scheduler_incident(tenant,project,incident,kind,execution,attempt,evidence)
             VALUES(bound.tenant,bound.project,incident_id,'ConflictingResult',bound.execution,
                    bound.attempt,'ForeignManifest');
           RETURN QUERY SELECT 'Conflicting'::text,NULL::text,NULL::text,incident_id; RETURN;
         END IF;
         IF jsonb_typeof(in_artifacts) IS DISTINCT FROM 'array'
            OR jsonb_array_length(in_artifacts)>${manifestArtifactsMax}
            OR EXISTS(SELECT 1 FROM jsonb_array_elements(in_artifacts) x(artifact)
              WHERE jsonb_typeof(artifact) IS DISTINCT FROM 'object'
                 OR artifact->>'role' NOT IN ('Handoff','Diagnostic')
                 OR NOT (coalesce(artifact->>'ordinal','') ~ '^[0-9]+$')
                 OR CASE WHEN coalesce(artifact->>'ordinal','') ~ '^[0-9]+$'
                         THEN (artifact->>'ordinal')::bigint NOT BETWEEN 1 AND ${manifestArtifactsMax}
                         ELSE true END
                 OR length(coalesce(artifact->>'path','')) NOT BETWEEN 1 AND ${artifactPathCharsMax}
                 OR coalesce(artifact->>'path','') ~ '^/'
                 OR coalesce(artifact->>'path','') ~ '//'
                 OR coalesce(artifact->>'path','') ~ '[\\\\]'
                 OR coalesce(artifact->>'path','') ~ '(^|/)[.][.]?(/|$)'
                 OR coalesce(artifact->>'path','') ~ '[[:cntrl:]]'
                 OR coalesce(artifact->>'path','') ~ '(^|/)[[:space:]]'
                 OR coalesce(artifact->>'path','') ~ '[[:space:]](/|$)'
                 OR coalesce(artifact->>'digest','') !~ '^[0-9a-f]{${artifactDigestChars}}$'
                 OR NOT (coalesce(artifact->>'bytes','') ~ '^[0-9]+$')
                 OR CASE WHEN coalesce(artifact->>'bytes','') ~ '^[0-9]+$'
                         THEN (artifact->>'bytes')::numeric NOT BETWEEN 0 AND ${artifactBytesMax}
                         ELSE true END)
            OR (SELECT count(DISTINCT artifact->>'ordinal')
                  FROM jsonb_array_elements(in_artifacts) x(artifact))
               <>jsonb_array_length(in_artifacts)
            OR (SELECT count(DISTINCT artifact->>'path')
                  FROM jsonb_array_elements(in_artifacts) x(artifact))
               <>jsonb_array_length(in_artifacts)
            OR (SELECT coalesce(sum(CASE
                    WHEN coalesce(artifact->>'bytes','') ~ '^[0-9]+$'
                    THEN (artifact->>'bytes')::numeric
                    ELSE ${manifestBytesMax + 1} END),0)
                  FROM jsonb_array_elements(in_artifacts) x(artifact))>${manifestBytesMax} THEN
           incident_id='incident-'||gen_random_uuid()::text;
           INSERT INTO scheduler_incident(tenant,project,incident,kind,execution,attempt,evidence)
             VALUES(bound.tenant,bound.project,incident_id,'ConflictingResult',bound.execution,
                    bound.attempt,'ForeignManifest');
           RETURN QUERY SELECT 'Conflicting'::text,NULL::text,NULL::text,incident_id; RETURN;
         END IF;
         IF EXISTS(SELECT 1 FROM jsonb_array_elements(in_artifacts) x(artifact)
              WHERE NOT EXISTS(SELECT 1 FROM worker_artifact_reservation r
                WHERE r.tenant=bound.tenant AND r.project=bound.project
                  AND r.execution=bound.execution AND r.attempt=bound.attempt
                  AND r.path=artifact->>'path' AND r.digest=artifact->>'digest'
                  AND r.bytes=(artifact->>'bytes')::bigint)) THEN
           incident_id='incident-'||gen_random_uuid()::text;
           INSERT INTO scheduler_incident(tenant,project,incident,kind,execution,attempt,evidence)
             VALUES(bound.tenant,bound.project,incident_id,'ConflictingResult',bound.execution,
                    bound.attempt,'ForeignManifest');
           RETURN QUERY SELECT 'Conflicting'::text,NULL::text,NULL::text,incident_id; RETURN;
         END IF;
         SELECT lifecycle INTO STRICT project_lifecycle FROM project
          WHERE tenant=bound.tenant AND project=bound.project FOR UPDATE;
         IF project_lifecycle='Retention' THEN
           RETURN QUERY SELECT 'NotAdmitted'::text,NULL::text,NULL::text,NULL::text; RETURN;
         END IF;
         UPDATE execution_attempt SET state='Reported',ended_at=now(),lease_owner=NULL,
              lease_expires_at=NULL WHERE capability_secret_digest=in_secret_digest
              AND state IN ('Placing','Running');
         IF NOT FOUND THEN
           RETURN QUERY SELECT 'Fenced'::text,NULL::text,NULL::text,NULL::text; RETURN;
         END IF;
         UPDATE project SET manifest_next=manifest_next+1
          WHERE tenant=bound.tenant AND project=bound.project
          RETURNING manifest_next-1 INTO next_manifest;
         INSERT INTO execution_result(tenant,project,manifest,execution,attempt,manifest_ordinal,
                                      schema_version,digest,verdict)
           VALUES(bound.tenant,bound.project,in_manifest,bound.execution,bound.attempt,next_manifest,
                  in_schema,in_digest,in_verdict);
         FOR artifact IN SELECT value FROM jsonb_array_elements(in_artifacts) LOOP
           INSERT INTO execution_result_artifact(tenant,project,manifest,ordinal,role,path,digest,bytes)
             VALUES(bound.tenant,bound.project,in_manifest,(artifact->>'ordinal')::integer,
                    artifact->>'role',artifact->>'path',artifact->>'digest',(artifact->>'bytes')::bigint);
         END LOOP;
         settled_outcome=CASE in_verdict WHEN 'Pass' THEN 'Passed' ELSE 'Failed' END;
         SELECT result,s.operation INTO submitted FROM ${completionFunction}(
           bound.tenant,bound.project,bound.execution,bound.ticket,bound.task,bound.effect_position,
           settled_outcome,in_manifest,in_digest,NULL,in_operation,'${workerPlaneRole}') s;
         IF submitted.result NOT IN ('Submitted','AlreadySubmitted') THEN
           RAISE EXCEPTION 'worker completion binding was refused: %',submitted.result
             USING ERRCODE='integrity_constraint_violation';
         END IF;
         UPDATE execution_request q SET state='Fulfilled'
          WHERE q.tenant=bound.tenant AND q.project=bound.project AND q.request=bound.source_request
            AND q.state='Registered' AND NOT EXISTS(SELECT 1 FROM execution e
              WHERE e.tenant=q.tenant AND e.project=q.project AND e.source_request=q.request
                AND e.status NOT IN ('Terminal','Cancelled'));
         RETURN QUERY SELECT CASE submitted.result WHEN 'Submitted' THEN 'Terminalized'
                           ELSE 'AlreadyTerminal' END,settled_outcome,submitted.operation,NULL::text;
       END $$`,
    `ALTER FUNCTION ${workerResultSubmitFunction}(text,bigint,text,integer,text,text,jsonb,text)
       OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${workerResultSubmitFunction}(text,bigint,text,integer,text,text,jsonb,text)
       FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${workerResultSubmitFunction}(text,bigint,text,integer,text,text,jsonb,text)
       TO ${workerPlaneRole}`,
    `GRANT SELECT ON recovery_epoch,project,execution_request,execution_request_task,
                     execution,execution_attempt,execution_result,input_bundle,input_bundle_reference,
                     worker_artifact_reservation
       TO ${boundaryOwnerRole}`,
    `GRANT INSERT ON execution_result,execution_result_artifact,scheduler_incident,
                     worker_artifact_reservation
       TO ${boundaryOwnerRole}`,
    `GRANT UPDATE (manifest_next) ON project TO ${boundaryOwnerRole}`,
    `GRANT UPDATE (state) ON execution_request TO ${boundaryOwnerRole}`,
    `GRANT UPDATE (retries_spent,placement_backoff_from) ON execution TO ${boundaryOwnerRole}`,
    `GRANT UPDATE (state,evidence,ended_at,lease_owner,lease_expires_at)
       ON execution_attempt TO ${boundaryOwnerRole}`,
    `GRANT UPDATE (cleanup_completed_at) ON execution_attempt TO ${schedulerRole}`,
  ],
};
