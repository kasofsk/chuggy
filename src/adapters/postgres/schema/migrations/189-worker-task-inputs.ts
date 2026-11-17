/**
 * A job attempt's task read answers its input bundle's references, as its
 * authority read does, so a route that finds its caller by the task read alone
 * knows the repository the bundle pins.
 *
 * `read_worker_task` IS REPLACED, answering every column 18 gave it and
 * `inputs` after them, under the same owner and grant.
 */

import {
  boundaryOwnerRole,
  workerPlaneRole,
  workerTaskReadFunction,
  type Migration,
} from "../shared.ts";

const signature = `public.${workerTaskReadFunction}(in_secret_digest text)`;

export const migration189: Migration = {
  version: 189,
  name: "a job attempt's task read answers its input references",
  statements: [
    `DROP FUNCTION ${signature}`,
    `CREATE FUNCTION ${signature}
       RETURNS TABLE(tenant text, project text, execution text, attempt text,
         generation bigint, ticket bigint, task bigint, task_kind text,
         stage bigint, source_request text, input_bundle text,
         input_bundle_digest text, configuration_revision text,
         configuration_digest text, requirement_identity text,
         requirement_digest text, live boolean, invocation jsonb, inputs jsonb)
       LANGUAGE sql STABLE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         SELECT a.tenant,a.project,a.execution,a.attempt,a.generation,
                e.ticket,e.task,t.kind,t.stage,e.source_request,
                q.input_bundle,q.input_bundle_digest,
                e.configuration_revision,e.configuration_digest,
                e.requirement_identity,e.requirement_digest,
                (a.state IN ('Placing','Running') AND e.status IN ('Launching','Running')),
                a.invocation,
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
           JOIN execution_request_task t ON t.tenant=e.tenant AND t.project=e.project
                                        AND t.request=e.source_request AND t.task=e.task
          WHERE a.capability_secret_digest=in_secret_digest
            AND ((a.state IN ('Placing','Running') AND e.status IN ('Launching','Running'))
              OR (a.state='Reported' AND e.status='Terminal'))
            AND a.recovery_epoch=(SELECT epoch FROM recovery_epoch
                                   ORDER BY ordinal DESC LIMIT 1)
       $$`,
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT ALL ON FUNCTION ${signature} TO ${workerPlaneRole}`,
  ],
};
