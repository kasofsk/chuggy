import {
  boundaryOwnerRole,
  poolPlaneRole,
  schedulerRole,
  workerPlaneRole,
  workerTaskReadFunction,
  type Migration,
} from "../shared.ts";

/** The longest invocation the column admits, in bytes of its text: the carrier a pod's task travels in. */
export const attemptInvocationBytesMax = 131_072;

/** A finished attempt's fence passes over `invoked` as it does the column cleanup sets, because a BEFORE trigger reads a generated column as null. */
const finishedAttemptFence = `CREATE OR REPLACE FUNCTION public.execution_attempt_is_fenced() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
       BEGIN
         IF OLD.state NOT IN ('Placing', 'Running') THEN
           IF OLD.cleanup_completed_at IS NULL AND NEW.cleanup_completed_at IS NOT NULL
              AND (to_jsonb(NEW) - 'cleanup_completed_at' - 'invoked')
                  IS NOT DISTINCT FROM (to_jsonb(OLD) - 'cleanup_completed_at' - 'invoked') THEN
             RETURN NEW;
           END IF;
           RAISE EXCEPTION 'attempt % is already %, and a finished attempt is written once',
             OLD.attempt, OLD.state USING ERRCODE = 'integrity_constraint_violation';
         END IF;
         IF (NEW.tenant, NEW.project, NEW.execution, NEW.attempt, NEW.attempt_number,
             NEW.recovery_epoch)
            IS DISTINCT FROM
            (OLD.tenant, OLD.project, OLD.execution, OLD.attempt, OLD.attempt_number,
             OLD.recovery_epoch) THEN
           RAISE EXCEPTION 'attempt % would change the identity or epoch it was issued under',
             OLD.attempt USING ERRCODE = 'integrity_constraint_violation';
         END IF;
         IF NEW.generation < OLD.generation THEN
           RAISE EXCEPTION 'attempt % would move its generation backwards', OLD.attempt
             USING ERRCODE = 'integrity_constraint_violation';
         END IF;
         IF OLD.state = 'Running' AND NEW.state = 'Placing' THEN
           RAISE EXCEPTION 'attempt % would return to placement after running', OLD.attempt
             USING ERRCODE = 'integrity_constraint_violation';
         END IF;
         RETURN NEW;
       END $$`;

/**
 * A job attempt keeps what it was invoked with, written once before it is
 * placed, so its worker can fetch the task a pod is otherwise launched with.
 * The worker plane reads it only through `read_worker_task`, and the pool plane
 * sees only whether it is there.
 */
export const migration018: Migration = {
  version: 18,
  name: "an attempt records its invocation",
  statements: [
    `ALTER TABLE public.execution_attempt
       ADD COLUMN invocation jsonb
         CONSTRAINT execution_attempt_invocation_is_bounded
         CHECK (invocation IS NULL OR octet_length(invocation::text) <= ${String(attemptInvocationBytesMax)}),
       ADD COLUMN invoked boolean GENERATED ALWAYS AS (invocation IS NOT NULL) STORED`,
    finishedAttemptFence,
    `GRANT UPDATE(invocation) ON TABLE public.execution_attempt TO ${schedulerRole}`,
    `GRANT SELECT(invoked) ON TABLE public.execution_attempt TO ${poolPlaneRole}`,
    `CREATE FUNCTION public.${workerTaskReadFunction}(in_secret_digest text)
       RETURNS TABLE(tenant text, project text, execution text, attempt text,
         generation bigint, ticket bigint, task bigint, task_kind text,
         stage bigint, source_request text, input_bundle text,
         input_bundle_digest text, configuration_revision text,
         configuration_digest text, requirement_identity text,
         requirement_digest text, live boolean, invocation jsonb)
       LANGUAGE sql STABLE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         SELECT a.tenant,a.project,a.execution,a.attempt,a.generation,
                e.ticket,e.task,t.kind,t.stage,e.source_request,
                q.input_bundle,q.input_bundle_digest,
                e.configuration_revision,e.configuration_digest,
                e.requirement_identity,e.requirement_digest,
                (a.state IN ('Placing','Running') AND e.status IN ('Launching','Running')),
                a.invocation
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
    `ALTER FUNCTION public.${workerTaskReadFunction}(in_secret_digest text) OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION public.${workerTaskReadFunction}(in_secret_digest text) FROM PUBLIC`,
    `GRANT ALL ON FUNCTION public.${workerTaskReadFunction}(in_secret_digest text) TO ${workerPlaneRole}`,
  ],
};
