/**
 * A job attempt's bearer reads what its task's workload is derived from: the
 * task's kind, stage and evaluator key, the canonical document of the
 * configuration revision the execution pins, and its ticket's overrides and
 * selection. It finds the attempts `read_worker_task` finds, under the same
 * owner and grant.
 */

import {
  boundaryOwnerRole,
  workerPlaneRole,
  workerTaskWorkloadReadFunction,
  type Migration,
} from "../shared.ts";

const signature = `public.${workerTaskWorkloadReadFunction}(in_secret_digest text)`;

export const migration214: Migration = {
  version: 214,
  name: "a job attempt's bearer reads what its workload is derived from",
  statements: [
    `CREATE FUNCTION ${signature}
       RETURNS TABLE(task_kind text, stage bigint, evaluator bigint,
         canonical text, overrides text, selection text)
       LANGUAGE sql STABLE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         SELECT t.kind,t.stage,t.evaluator,c.canonical,
                d.overrides::text,d.selection::text
           FROM execution_attempt a
           JOIN execution e ON e.tenant=a.tenant AND e.project=a.project
                           AND e.execution=a.execution
           JOIN execution_request_task t ON t.tenant=e.tenant AND t.project=e.project
                                        AND t.request=e.source_request AND t.task=e.task
           JOIN configuration_revision c ON c.tenant=e.tenant AND c.project=e.project
                                        AND c.revision=e.configuration_revision
           LEFT JOIN ticket_definition d ON d.tenant=e.tenant AND d.project=e.project
                                        AND d.ticket=e.ticket
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
