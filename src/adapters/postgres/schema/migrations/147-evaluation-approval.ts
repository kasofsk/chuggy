/**
 * An approval evaluator's execution is registered as every evaluator's is and
 * waits on a person, with an `EvaluationApproval` action open for it.
 *
 * IT IS `Queued` AND CARRIES NO REQUIREMENT, AND NOTHING THAT PLACES WORK READS
 * ONE. `model/capacity.qnt` holds a queued execution to no slot and only
 * permits its admission, so the capacity statuses stand as they are: the
 * requirement's value, digest, source and platform default version are absent
 * together, only on a row that is `Queued` or `Cancelled`, and admission, its
 * index and the active work a lead reads all pass over such a row. So an
 * approval holds no slot, is never offered to a runner and is no project's
 * queued demand. Readers name it `Awaiting`.
 *
 * THE ACTION OPENS AND CLOSES WITH ITS EXECUTION. A trigger on `execution`
 * opens it in the statement that registers the row, at the fence of the spawn
 * that authorized it, and withdraws it, unanswered, in the statement that
 * moves the row out of `Queued`. A trigger on `ticket_projection` withdraws it
 * in the statement that moves its ticket out of `Evaluation`, so a revoke, an
 * invalidation or a stage's end closes it in the transaction that decides it
 * rather than when the scheduler cancels the row. The decision's own plan is
 * left as it was, so a stored journal derives what it always did. So no action
 * stands for an execution that is no longer owed.
 *
 * A TICKET MAY HOLD SEVERAL. One stage may list several approval evaluators,
 * so `native_action_one_open` is narrowed to the other kinds and an evaluation
 * approval is held to one per execution instead. The phases its kinds stand in
 * are disjoint, so a ticket's escalation or finalization approval never opens
 * beside one.
 *
 * `public_ticket_command_is_valid` AND `accept_operation` ARE 043's WITH
 * `Reject` ADMITTED, as an ordinary answer, and `project_active_work` is
 * 141's counting only a queued row that names a requirement. The writer
 * refuses an answer to an evaluation approval `ApprovalNotAnswerable`, which
 * `decision_input_outcome_is_known` admits beside every code 146 admitted.
 */

import { apiRole, boundaryOwnerRole, type Migration } from "../shared.ts";
import { migration043 } from "./043-parked-overrides.ts";
import { migration141 } from "./141-active-work-started-runs.ts";
import { textArray } from "./085-dependencies-change.ts";
import {
  boundaryRefusals as boundaryRefusalsAt146,
  domainRefusals,
} from "./146-approval-refusals.ts";

const resolutionsBefore = "'Resume', 'Revoke', 'Approve', 'Decline'";
const answersBefore = "'Resume', 'Approve', 'Decline'";

/** One of 043's two command functions, with `Reject` admitted wherever 043 listed the answers. */
function migration147Admitting(prefix: string): string {
  const stood = migration043.statements.find((statement) =>
    statement.startsWith(prefix),
  );
  if (
    stood === undefined ||
    !stood.includes(`IN (${resolutionsBefore})`) ||
    (prefix.includes("accept_operation") &&
      !stood.includes(`IN (${answersBefore})`))
  )
    throw new Error(
      "migration 147: 043 no longer installs the command function this widens",
    );
  return stood
    .replace(`IN (${resolutionsBefore})`, `IN (${resolutionsBefore}, 'Reject')`)
    .replace(`IN (${answersBefore})`, `IN (${answersBefore}, 'Reject')`);
}

const queuedBefore = "count(*) FILTER (WHERE e.status = 'Queued')";

/** 141's active work, its queued count passing over an execution that names no requirement. */
function migration147ActiveWork(): string {
  const stood = migration141.statements.find((statement) =>
    statement.includes(queuedBefore),
  );
  if (stood === undefined)
    throw new Error(
      "migration 147: 141 no longer installs the active work this narrows",
    );
  return stood.replace(
    queuedBefore,
    "count(*) FILTER (WHERE e.status = 'Queued' AND e.requirement_value IS NOT NULL)",
  );
}

const openFunction = "public.evaluation_approval_opens()";
const closeFunction = "public.evaluation_approval_closes()";
const leaveFunction = "public.evaluation_approval_left()";

export const migration147: Migration = {
  version: 147,
  name: "an approval evaluator's execution awaits a person, with an action open for it",
  statements: [
    `ALTER TABLE public.execution
       ALTER COLUMN requirement_value DROP NOT NULL,
       ALTER COLUMN requirement_digest DROP NOT NULL,
       ALTER COLUMN requirement_source DROP NOT NULL,
       ALTER COLUMN platform_default_version DROP NOT NULL,
       ADD CONSTRAINT execution_requirement_is_whole CHECK ((requirement_value IS NULL) = (requirement_digest IS NULL) AND (requirement_value IS NULL) = (requirement_source IS NULL) AND (requirement_value IS NULL) = (platform_default_version IS NULL)),
       ADD CONSTRAINT execution_awaiting_is_never_admitted CHECK (requirement_value IS NOT NULL OR status IN ('Queued', 'Cancelled'))`,
    `DROP INDEX public.execution_queued`,
    `CREATE INDEX execution_queued ON public.execution USING btree (cluster, registered_at) WHERE status = 'Queued' AND requirement_value IS NOT NULL`,
    migration147ActiveWork(),
    `ALTER TABLE public.native_action
       ADD COLUMN execution text,
       ADD CONSTRAINT native_action_execution_is_its_own FOREIGN KEY (tenant, project, execution) REFERENCES public.execution(tenant, project, execution),
       DROP CONSTRAINT native_action_kind_is_known,
       ADD CONSTRAINT native_action_kind_is_known CHECK (kind = ANY (ARRAY['TicketEscalation'::text, 'FinalizationApproval'::text, 'EvaluationApproval'::text])),
       DROP CONSTRAINT native_action_capability_is_known,
       ADD CONSTRAINT native_action_capability_is_known CHECK (required_capability = ANY (ARRAY['ResolveTicket'::text, 'ApproveFinalization'::text, 'ApproveEvaluation'::text])),
       DROP CONSTRAINT native_action_kind_names_its_capability,
       ADD CONSTRAINT native_action_kind_names_its_capability CHECK ((kind = 'TicketEscalation') = (required_capability = 'ResolveTicket') AND (kind = 'FinalizationApproval') = (required_capability = 'ApproveFinalization') AND (kind = 'FinalizationApproval') = (attempt IS NOT NULL) AND (kind = 'EvaluationApproval') = (required_capability = 'ApproveEvaluation') AND (kind = 'EvaluationApproval') = (execution IS NOT NULL) AND (kind <> 'EvaluationApproval' OR escalation = 'NoEscalation'))`,
    `DROP INDEX public.native_action_one_open`,
    `CREATE UNIQUE INDEX native_action_one_open ON public.native_action USING btree (tenant, project, ticket) WHERE state = 'Open' AND kind <> 'EvaluationApproval'`,
    `CREATE UNIQUE INDEX native_action_asks_for_an_execution_once ON public.native_action USING btree (tenant, project, execution) WHERE execution IS NOT NULL`,
    `DROP INDEX public.native_action_decision_opens_one_desk`,
    `CREATE UNIQUE INDEX native_action_decision_opens_one_desk ON public.native_action USING btree (tenant, project, authorizing_seq) WHERE attempt IS NULL AND execution IS NULL`,
    `GRANT SELECT (execution) ON TABLE public.native_action TO ${apiRole}`,
    `ALTER TABLE public.native_action_resolution
       DROP CONSTRAINT native_action_resolution_is_known,
       ADD CONSTRAINT native_action_resolution_is_known CHECK (resolution = ANY (ARRAY['Resume'::text, 'Revoke'::text, 'Approve'::text, 'Decline'::text, 'Reject'::text]))`,
    `CREATE OR REPLACE FUNCTION public.native_action_resolution_pairs_with_its_kind() RETURNS trigger
     LANGUAGE plpgsql
     AS $$
       DECLARE asked text;
       BEGIN
         SELECT n.kind INTO asked FROM native_action n
          WHERE n.tenant = NEW.tenant AND n.project = NEW.project
            AND n.action = NEW.action;
         IF NOT ((asked = 'TicketEscalation' AND NEW.resolution IN ('Resume', 'Revoke'))
              OR (asked = 'FinalizationApproval' AND NEW.resolution IN ('Approve', 'Decline'))
              OR (asked = 'EvaluationApproval' AND NEW.resolution IN ('Approve', 'Reject'))) THEN
           RAISE EXCEPTION '% is not an answer a % asks for', NEW.resolution, asked
             USING ERRCODE = 'integrity_constraint_violation';
         END IF;
         RETURN NEW;
       END $$`,
    `CREATE FUNCTION ${openFunction} RETURNS trigger
     LANGUAGE plpgsql SECURITY DEFINER
     SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       DECLARE spawn record; asked text;
       BEGIN
         SELECT q.authorizing_seq, q.effect_position INTO STRICT spawn
           FROM execution_request q
          WHERE q.tenant = NEW.tenant AND q.project = NEW.project
            AND q.request = NEW.source_request AND q.kind = 'SpawnEvaluation';
         asked := 'EvaluationApproval:' || NEW.execution;
         INSERT INTO native_action
           (tenant, project, action, authorizing_seq, effect_position, ticket,
            action_version, kind, escalation, required_capability, execution)
         VALUES (NEW.tenant, NEW.project, asked, spawn.authorizing_seq,
            spawn.effect_position, NEW.ticket, spawn.authorizing_seq,
            'EvaluationApproval', 'NoEscalation', 'ApproveEvaluation', NEW.execution);
         INSERT INTO native_action_resolution (tenant, project, action, resolution)
         SELECT NEW.tenant, NEW.project, asked, unnest(ARRAY['Approve', 'Reject']);
         RETURN NULL;
       END $$`,
    `ALTER FUNCTION ${openFunction} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${openFunction} FROM PUBLIC`,
    `CREATE TRIGGER execution_awaiting_opens_its_approval AFTER INSERT ON public.execution
       FOR EACH ROW WHEN (NEW.requirement_value IS NULL) EXECUTE FUNCTION ${openFunction}`,
    `CREATE FUNCTION ${closeFunction} RETURNS trigger
     LANGUAGE plpgsql SECURITY DEFINER
     SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       BEGIN
         UPDATE native_action SET state = 'Withdrawn'
          WHERE tenant = NEW.tenant AND project = NEW.project
            AND execution = NEW.execution AND state = 'Open';
         RETURN NULL;
       END $$`,
    `ALTER FUNCTION ${closeFunction} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${closeFunction} FROM PUBLIC`,
    `CREATE TRIGGER execution_settling_closes_its_approval AFTER UPDATE OF status ON public.execution
       FOR EACH ROW WHEN (OLD.requirement_value IS NULL AND OLD.status <> NEW.status) EXECUTE FUNCTION ${closeFunction}`,
    `CREATE FUNCTION ${leaveFunction} RETURNS trigger
     LANGUAGE plpgsql SECURITY DEFINER
     SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       BEGIN
         UPDATE native_action SET state = 'Withdrawn'
          WHERE tenant = NEW.tenant AND project = NEW.project
            AND ticket = NEW.ticket AND kind = 'EvaluationApproval'
            AND state = 'Open';
         RETURN NULL;
       END $$`,
    `ALTER FUNCTION ${leaveFunction} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${leaveFunction} FROM PUBLIC`,
    `CREATE TRIGGER ticket_leaving_evaluation_closes_its_approvals AFTER UPDATE OF phase ON public.ticket_projection
       FOR EACH ROW WHEN (OLD.phase = 'Evaluation' AND NEW.phase <> 'Evaluation') EXECUTE FUNCTION ${leaveFunction}`,
    migration147Admitting(
      "CREATE OR REPLACE FUNCTION public.public_ticket_command_is_valid(",
    ),
    migration147Admitting(
      "CREATE OR REPLACE FUNCTION public.accept_operation(",
    ),
    `ALTER TABLE public.decision_input
       DROP CONSTRAINT decision_input_outcome_is_known,
       ADD CONSTRAINT decision_input_outcome_is_known CHECK ((outcome_code IS NULL OR (outcome_code = ANY (${textArray([...domainRefusals, ...boundaryRefusalsAt146, "ApprovalNotAnswerable"])}))))`,
  ],
};
