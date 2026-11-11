/**
 * A person's answer to an evaluation approval becomes that evaluator's
 * verdict: `Approve` a pass, `Reject` a failure.
 *
 * THE ANSWER IS RECORDED ON ITS ACTION. `native_action` gains `answered_by`,
 * `answered_at` and `feedback`, which an evaluation approval carries exactly
 * when it is resolved, and which no other kind carries. A `Reject` carries
 * feedback; an `Approve` may.
 *
 * ITS RESULT IS A RESULT OF THE EXECUTION, BOUND TO THE ANSWER RATHER THAN TO
 * AN ATTEMPT. `execution_result.attempt` is no longer required, and a result
 * names its attempt or the action whose answer wrote it, never both and never
 * neither; the action it names stands for that result's own execution. Its
 * digest is taken over its own label, its binding to the action, its verdict
 * and its report, so it is no worker manifest's and binds no attempt. The
 * report is the feedback behind the name of who gave it, which is what every
 * reader of a failed evaluator's report already reads.
 *
 * `answer_evaluation_approval` IS THE ONE DOOR, AND THE DECIDING TRANSACTION
 * CALLS IT. The writer's transaction already holds the project; the door locks
 * the execution, answers `Withdrawn` and writes nothing where the action is no
 * longer open at the fence the stored answer names, because a cancellation
 * that settled its execution first withdrew it, and otherwise resolves it,
 * writes the result and its report, and submits the completion through
 * `submit_task_completion` under the scheduler's authority, so the answer, the
 * execution's terminal outcome, the result and the completion commit together
 * or not at all. A `ReportTaskTerminal` is still only ever the scheduler's.
 * Everything it writes it reads from durable rows: the stored answer and its
 * authority, the action and the execution. The request the execution was
 * registered under is fulfilled only where no scheduler transaction holds it:
 * the scheduler takes a request before the project this transaction already
 * holds, so waiting on one could deadlock, and a held request is left
 * `Registered`, the state its registration left it in.
 *
 * `execution_awaiting_is_never_admitted` IS 148's WITH AN ANSWERED ROW
 * ADMITTED: an execution naming no requirement may be terminal too, passed or
 * failed and never blocked. `public_ticket_command_is_valid` IS 148's with a
 * resolution's optional feedback held to the text a report carries.
 */

import {
  apiRole,
  boundaryOwnerRole,
  ticketServiceRole,
  type Migration,
} from "../shared.ts";
import { migration148 } from "./148-evaluation-approval.ts";

const resolutionValidBefore =
  "AND command->>'resolution' IN ('Resume', 'Revoke', 'Approve', 'Decline', 'Reject');";

/** 148's command validity, with a resolution's feedback held to what an answer may carry. */
function migration154CommandValidity(): string {
  const stood = migration148.statements.find((statement) =>
    statement.startsWith(
      "CREATE OR REPLACE FUNCTION public.public_ticket_command_is_valid(",
    ),
  );
  if (stood === undefined || !stood.includes(resolutionValidBefore))
    throw new Error(
      "migration 154: 148 no longer installs the command validity this widens",
    );
  return stood.replace(
    resolutionValidBefore,
    `AND command->>'resolution' IN ('Resume', 'Revoke', 'Approve', 'Decline', 'Reject')
         AND (command->'feedback' IS NULL
              OR (jsonb_typeof(command->'feedback') = 'string'
                  AND length(command->>'feedback') BETWEEN 1 AND 7922
                  AND command->>'feedback' ~ '\\S'
                  AND command->>'feedback' !~ '[[:cntrl:]]'));`,
  );
}

const answerFunction =
  "public.answer_evaluation_approval(in_tenant text, in_project text, in_operation text, in_manifest text, in_completion text, in_authority_subject text)";

export const migration154: Migration = {
  version: 154,
  name: "a person's answer to an evaluation approval is its evaluator's verdict",
  statements: [
    `ALTER TABLE public.native_action
       ADD COLUMN answered_by text,
       ADD COLUMN answered_at timestamp with time zone,
       ADD COLUMN feedback text,
       ADD CONSTRAINT native_action_answer_names_its_person CHECK ((answered_by IS NULL) = (answered_at IS NULL) AND (answered_by IS NOT NULL) = (kind = 'EvaluationApproval' AND state = 'Resolved') AND (feedback IS NULL OR answered_by IS NOT NULL) AND (resolution IS DISTINCT FROM 'Reject' OR feedback IS NOT NULL)),
       ADD CONSTRAINT native_action_feedback_is_text CHECK (feedback IS NULL OR (length(feedback) BETWEEN 1 AND 7922 AND feedback ~ '\\S' AND feedback !~ '[[:cntrl:]]')),
       ADD CONSTRAINT native_action_names_its_execution UNIQUE (tenant, project, action, execution)`,
    `ALTER TABLE public.execution_result
       ALTER COLUMN attempt DROP NOT NULL,
       ADD COLUMN action text,
       ADD CONSTRAINT execution_result_answers_its_own_action FOREIGN KEY (tenant, project, action, execution) REFERENCES public.native_action(tenant, project, action, execution),
       ADD CONSTRAINT execution_result_is_reported_or_answered CHECK ((attempt IS NULL) <> (action IS NULL)),
       ADD CONSTRAINT execution_result_is_one_per_answer UNIQUE (tenant, project, action)`,
    `ALTER TABLE public.execution
       DROP CONSTRAINT execution_awaiting_is_never_admitted,
       ADD CONSTRAINT execution_awaiting_is_never_admitted CHECK (requirement_value IS NOT NULL OR status IN ('Queued', 'Cancelled') OR (status = 'Terminal' AND outcome IS NOT NULL AND outcome IN ('Passed', 'Failed')))`,
    `GRANT SELECT (resolution, answered_by, answered_at, feedback) ON TABLE public.native_action TO ${apiRole}`,
    `GRANT SELECT (action) ON TABLE public.execution_result TO ${apiRole}`,
    `GRANT SELECT (answered_by, answered_at, feedback), UPDATE (resolution, answered_by, answered_at, feedback) ON TABLE public.native_action TO ${boundaryOwnerRole}`,
    `GRANT INSERT (action) ON TABLE public.execution_result TO ${boundaryOwnerRole}`,
    migration154CommandValidity(),
    `CREATE FUNCTION ${answerFunction} RETURNS text
     LANGUAGE plpgsql SECURITY DEFINER
     SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       DECLARE answer jsonb; person text; asked record; verdict text;
         report text; result_digest text; ordinal bigint; submitted text;
       BEGIN
         SELECT o.command::jsonb, o.authority_subject INTO answer, person
           FROM operation o
          WHERE o.tenant = in_tenant AND o.project = in_project
            AND o.operation = in_operation
            AND o.command_tag = 'ResolveNativeAction';
         IF NOT FOUND OR answer->>'resolution' NOT IN ('Approve', 'Reject') THEN
           RAISE EXCEPTION 'operation % is no answer to an evaluation approval', in_operation
             USING ERRCODE = 'integrity_constraint_violation';
         END IF;
         SELECT e.execution, e.ticket, e.task, e.status, e.requirement_value,
                q.effect_position, q.request INTO asked
           FROM native_action a
           JOIN execution e
             ON e.tenant = a.tenant AND e.project = a.project AND e.execution = a.execution
           JOIN execution_request q
             ON q.tenant = e.tenant AND q.project = e.project AND q.request = e.source_request
          WHERE a.tenant = in_tenant AND a.project = in_project
            AND a.action = answer->>'action' AND a.kind = 'EvaluationApproval'
          FOR UPDATE OF e;
         IF NOT FOUND THEN
           RAISE EXCEPTION 'approval % stands for no execution', answer->>'action'
             USING ERRCODE = 'integrity_constraint_violation';
         END IF;
         UPDATE native_action
            SET state = 'Resolved', resolution = answer->>'resolution',
                answered_by = person, answered_at = now(),
                feedback = answer->>'feedback'
          WHERE tenant = in_tenant AND project = in_project
            AND action = answer->>'action' AND state = 'Open'
            AND authorizing_seq = (answer->>'authorizingSeq')::bigint;
         IF NOT FOUND THEN
           RETURN 'Withdrawn';
         END IF;
         IF asked.status <> 'Queued' OR asked.requirement_value IS NOT NULL THEN
           RAISE EXCEPTION 'approval % was open for an execution no longer awaiting it', answer->>'action'
             USING ERRCODE = 'integrity_constraint_violation';
         END IF;
         verdict := CASE WHEN answer->>'resolution' = 'Approve' THEN 'Pass' ELSE 'Fail' END;
         report := CASE WHEN verdict = 'Pass' THEN 'Approved by ' ELSE 'Rejected by ' END
           || person || coalesce(': ' || (answer->>'feedback'), '.');
         result_digest := encode(sha256(convert_to(
           concat_ws(':', 'chuggy:approval-result:v1',
             length(in_tenant), in_tenant, length(in_project), in_project,
             length(asked.execution), asked.execution,
             length(answer->>'action'), answer->>'action',
             length(in_manifest), in_manifest, verdict,
             length(report), report), 'UTF8')), 'hex');
         UPDATE project p SET manifest_next = p.manifest_next + 1
          WHERE p.tenant = in_tenant AND p.project = in_project
          RETURNING p.manifest_next - 1 INTO ordinal;
         INSERT INTO execution_result
           (tenant, project, manifest, execution, attempt, action, manifest_ordinal,
            schema_version, digest, verdict)
         VALUES (in_tenant, in_project, in_manifest, asked.execution, NULL,
            answer->>'action', ordinal, 3, result_digest, verdict);
         INSERT INTO execution_result_report (tenant, project, manifest, report)
         VALUES (in_tenant, in_project, in_manifest, report);
         SELECT s.result INTO submitted FROM submit_task_completion(
           in_tenant, in_project, asked.execution, asked.ticket, asked.task,
           asked.effect_position,
           CASE WHEN verdict = 'Pass' THEN 'Passed' ELSE 'Failed' END,
           in_manifest, result_digest, NULL, in_completion,
           in_authority_subject) s;
         IF submitted IS DISTINCT FROM 'Submitted' THEN
           RAISE EXCEPTION 'the completion boundary answered an approval''s verdict %', submitted
             USING ERRCODE = 'integrity_constraint_violation';
         END IF;
         PERFORM 1 FROM execution_request q
          WHERE q.tenant = in_tenant AND q.project = in_project
            AND q.request = asked.request
          FOR UPDATE SKIP LOCKED;
         IF FOUND THEN
           UPDATE execution_request q SET state = 'Fulfilled'
            WHERE q.tenant = in_tenant AND q.project = in_project
              AND q.request = asked.request AND q.state = 'Registered'
              AND NOT EXISTS (SELECT 1 FROM execution e
                               WHERE e.tenant = q.tenant AND e.project = q.project
                                 AND e.source_request = q.request
                                 AND e.status NOT IN ('Terminal', 'Cancelled'));
         END IF;
         RETURN 'Answered';
       END $$`,
    `ALTER FUNCTION ${answerFunction} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${answerFunction} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${answerFunction} TO ${ticketServiceRole}`,
  ],
};
