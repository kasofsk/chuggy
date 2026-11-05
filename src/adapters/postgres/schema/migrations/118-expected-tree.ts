/**
 * An evaluation is held to the tree it was spawned to evaluate: a report naming
 * another, or none, is not a verdict.
 *
 * `input_bundle_reference_kind_is_known` IS REPLACED, admitting `ExpectedTree`
 * beside every kind 116 admitted, the git tree a bundle's task must be
 * evaluated at. `execution_blocked_reason_is_known` IS REPLACED, admitting
 * `EvaluatedTreeNotExpected` beside the six reasons 087 admitted, and
 * `submit_task_completion` IS REPLACED, its body 087's with that reason added
 * to the ones it accepts, so a block can name it.
 *
 * `submit_worker_result` GAINS AN OVERLOAD TAKING THE TREE THE REPORT NAMES,
 * WHICH THE WORKER PLANE CALLS. Where the task's bundle pins a tree the report
 * does not name, and the attempt is still entitled to report, it ends the
 * attempt and blocks the execution as `EvaluatedTreeNotExpected` without
 * retaining the manifest, which is the settlement a runner that could not run
 * the work gets. Every other report is the nine-argument function's to answer,
 * a fenced, retired, settled or contradictory one included, and none of those
 * settles a verdict either. The nine-argument function keeps its grant, and a
 * caller of it names no tree and is held to none.
 */

import {
  boundaryOwnerRole,
  workerPlaneRole,
  type Migration,
} from "../shared.ts";
import { migration087 } from "./087-memory-ceiling.ts";

const blockedReasons = [
  "ExecutionPolicyDenied",
  "TicketConfigIncompatible",
  "ExecutionProfileUnavailable",
  "RuntimeVersionUnsupported",
  "RequiredCapabilityUnavailable",
  "RequiredMemoryUnavailable",
  "EvaluatedTreeNotExpected",
];

/** Every kind 116 admitted, and the one this adds. */
const inputBundleReferenceKinds = [
  "ResultManifest",
  "ConfigurationRevision",
  "Repository",
  "FinalizationAttempt",
  "ConflictManifest",
  "TargetCommit",
  "ProjectArtifact",
  "ChangeBase",
  "DependencyResult",
  "DependencyAncestor",
  "DependencyNotAncestor",
  "Recheck",
  "ExpectedTree",
];

/** The array a CHECK names its members in, written as the server reads it back. */
function textArray(values: readonly string[]): string {
  return `ARRAY[${values.map((value) => `'${value}'::text`).join(", ")}]`;
}

const reasonsBefore =
  "'ExecutionPolicyDenied', 'TicketConfigIncompatible', 'ExecutionProfileUnavailable', 'RuntimeVersionUnsupported', 'RequiredCapabilityUnavailable', 'RequiredMemoryUnavailable'";
const reasonsAfter = `${reasonsBefore}, 'EvaluatedTreeNotExpected'`;

/** 087's `submit_task_completion`, accepting the reason this adds. */
function submitTaskCompletion(): string {
  const stood = migration087.statements.find((statement) =>
    statement.startsWith(
      "CREATE OR REPLACE FUNCTION public.submit_task_completion(",
    ),
  );
  if (stood === undefined || !stood.includes(`NOT IN (${reasonsBefore})`))
    throw new Error(
      "migration 118: 087 no longer installs the completion door this widens",
    );
  return stood.replace(`NOT IN (${reasonsBefore})`, `NOT IN (${reasonsAfter})`);
}

const submitTen =
  "public.submit_worker_result(in_secret_digest text, in_generation bigint, in_manifest text, in_schema integer, in_digest text, in_verdict text, in_artifacts jsonb, in_source jsonb, in_operation text, in_evaluated_tree text)";

export const migration118: Migration = {
  version: 118,
  name: "an evaluation is held to the tree it was spawned to evaluate",
  statements: [
    `ALTER TABLE public.input_bundle_reference
       DROP CONSTRAINT input_bundle_reference_kind_is_known,
       ADD CONSTRAINT input_bundle_reference_kind_is_known CHECK ((reference_kind = ANY (${textArray(inputBundleReferenceKinds)})))`,
    `ALTER TABLE public.execution
       DROP CONSTRAINT execution_blocked_reason_is_known,
       ADD CONSTRAINT execution_blocked_reason_is_known CHECK (((blocked_reason IS NULL) OR (blocked_reason = ANY (${textArray(blockedReasons)}))))`,
    submitTaskCompletion(),
    `CREATE FUNCTION ${submitTen} RETURNS TABLE(terminalized text, outcome text, operation text, incident text)
       LANGUAGE plpgsql SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         DECLARE bound record; expected text; submitted record; project_lifecycle text;
           must_block boolean := false;
         BEGIN
           SELECT e.tenant,e.project,e.source_request INTO bound
             FROM execution_attempt a
             JOIN execution e ON e.tenant=a.tenant AND e.project=a.project
                             AND e.execution=a.execution
            WHERE a.capability_secret_digest=in_secret_digest;
           IF FOUND THEN
             SELECT b.reference_id INTO expected
               FROM execution_request q
               JOIN input_bundle_reference b
                 ON b.tenant=q.tenant AND b.project=q.project AND b.bundle=q.input_bundle
                    AND b.reference_kind='ExpectedTree'
              WHERE q.tenant=bound.tenant AND q.project=bound.project
                AND q.request=bound.source_request;
             must_block := expected IS NOT NULL
               AND expected IS DISTINCT FROM in_evaluated_tree;
           END IF;
           IF must_block THEN
             PERFORM 1 FROM execution_request q
              WHERE q.tenant=bound.tenant AND q.project=bound.project
                AND q.request=bound.source_request FOR UPDATE;
             SELECT a.tenant,a.project,a.execution,a.attempt,a.manifest,a.state,a.generation,
                    a.recovery_epoch,e.status,e.ticket,e.task,e.source_request,
                    q.effect_position
               INTO bound FROM execution_attempt a
               JOIN execution e ON e.tenant=a.tenant AND e.project=a.project
                               AND e.execution=a.execution
               JOIN execution_request q ON q.tenant=e.tenant AND q.project=e.project
                                       AND q.request=e.source_request
              WHERE a.capability_secret_digest=in_secret_digest
              FOR UPDATE OF e;
             IF NOT FOUND THEN
               must_block := false;
             ELSE
               must_block := bound.recovery_epoch=(SELECT epoch FROM recovery_epoch
                                                    ORDER BY ordinal DESC LIMIT 1)
                 AND bound.state IN ('Placing','Running')
                 AND bound.status NOT IN ('Terminal','Cancelled')
                 AND bound.manifest IS NOT DISTINCT FROM in_manifest
                 AND bound.generation IS NOT DISTINCT FROM in_generation;
             END IF;
           END IF;
           IF must_block THEN
             SELECT lifecycle INTO STRICT project_lifecycle FROM project
              WHERE tenant=bound.tenant AND project=bound.project FOR UPDATE;
             must_block := project_lifecycle<>'Retention';
           END IF;
           IF must_block THEN
             UPDATE execution_attempt SET state='Reported',ended_at=now(),lease_owner=NULL,
                  lease_expires_at=NULL WHERE capability_secret_digest=in_secret_digest
                  AND state IN ('Placing','Running');
             must_block := FOUND;
           END IF;
           IF NOT must_block THEN
             RETURN QUERY SELECT * FROM submit_worker_result(
               in_secret_digest,in_generation,in_manifest,in_schema,in_digest,in_verdict,
               in_artifacts,in_source,in_operation);
             RETURN;
           END IF;
           SELECT s.result,s.operation INTO submitted FROM submit_task_completion(
             bound.tenant,bound.project,bound.execution,bound.ticket,bound.task,
             bound.effect_position,'Blocked',NULL,NULL,'EvaluatedTreeNotExpected',
             in_operation,'${workerPlaneRole}') s;
           IF submitted.result NOT IN ('Submitted','AlreadySubmitted') THEN
             RAISE EXCEPTION 'worker completion binding was refused: %',submitted.result
               USING ERRCODE='integrity_constraint_violation';
           END IF;
           UPDATE execution_request q SET state='Fulfilled'
            WHERE q.tenant=bound.tenant AND q.project=bound.project
              AND q.request=bound.source_request
              AND q.state='Registered' AND NOT EXISTS(SELECT 1 FROM execution e
                WHERE e.tenant=q.tenant AND e.project=q.project
                  AND e.source_request=q.request
                  AND e.status NOT IN ('Terminal','Cancelled'));
           RETURN QUERY SELECT CASE submitted.result WHEN 'Submitted' THEN 'Terminalized'
                             ELSE 'AlreadyTerminal' END,'Blocked'::text,
                             submitted.operation,NULL::text;
         END $$`,
    `ALTER FUNCTION ${submitTen} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${submitTen} FROM PUBLIC`,
    `GRANT ALL ON FUNCTION ${submitTen} TO ${workerPlaneRole}`,
  ],
};
