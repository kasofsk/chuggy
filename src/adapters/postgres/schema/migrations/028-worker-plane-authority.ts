import {
  boundaryOwnerRole,
  completionFunction,
  roleStatement,
  workerPlaneRole,
  workerAttemptReadFunction,
  type Migration,
} from "../shared.ts";

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
       ADD COLUMN manifest text`,
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
    `CREATE FUNCTION ${workerAttemptReadFunction}(in_secret_digest text)
       RETURNS TABLE(tenant text,project text,execution text,attempt text,generation bigint,
                     manifest text,input_bundle text,input_bundle_digest text,inputs jsonb)
       LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
         SELECT a.tenant,a.project,a.execution,a.attempt,a.generation,a.manifest,
                q.input_bundle,q.input_bundle_digest,
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
            AND a.state IN ('Placing','Running')
            AND e.status IN ('Launching','Running')
            AND a.recovery_epoch=(SELECT epoch FROM recovery_epoch)
       $$`,
    `ALTER FUNCTION ${workerAttemptReadFunction}(text) OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${workerAttemptReadFunction}(text) FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${workerAttemptReadFunction}(text) TO ${workerPlaneRole}`,
    `GRANT EXECUTE ON FUNCTION ${completionFunction}(text,text,text,bigint,bigint,integer,text,text,text,text,text,text)
       TO ${workerPlaneRole}`,
  ],
};
