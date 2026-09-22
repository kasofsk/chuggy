import {
  apiRole,
  boundaryOwnerRole,
  schedulerRole,
  sourceUnrecordedResult,
  ticketServiceRole,
  type Migration,
} from "../shared.ts";

/**
 * A ticket is released as a whole definition and runs at the definition it was
 * released under. `CreateTicket` stops carrying a ticket number beside a list
 * of dependencies and a program and carries the released ticket itself — its
 * own identity, the content it was authored from, the dependencies it waits
 * on, the task definition its work runs under, the plan its evaluators run and
 * the finalization it concludes under. The dispatch carries the source it was
 * taken at, and a produced report carries the obligation the task was given
 * rather than a bare reference to what it returned.
 *
 * WHY THIS ONE OPENS WITH 008's GUARD TOO. A stored release names a ticket, a
 * `deps` and a `prog`, and the validator this image installs refuses a payload
 * shaped that way: those fields are not optional here, they are gone, and an
 * entry whose bytes are what its digest attests cannot be rewritten into one
 * this machine admits. So a journal with rows in it comes up holding a ticket
 * the actor cannot replay, and installing the validator behind it would hide
 * that behind a schema that looks migrated. The guard refuses the migration
 * instead and names `deploy/rig/wipe-tickets.sql`, which is what empties the
 * journal it needs.
 *
 * AND `deps` AND `prog` ARE REFUSED FOR BEING NAMED RATHER THAN IGNORED FOR
 * IT, which is 009's move for 009's reason. Behind the wipe no stored entry
 * carries either, so the only writer that could is an image of the earlier
 * vintage pointed at a migrated database — and that writer means a ticket
 * released with no definition at all, which this machine would then run under
 * whatever a reader of the absent fields made of them.
 *
 * THE TICKET'S NUMBER MOVES FROM `ticket` TO `id`, AND THE INDEX MOVES WITH
 * IT. The release payload is the released ticket, and the released ticket
 * names itself; `journal_entry_release_ticket` indexed the key the old payload
 * carried, so left alone it would index nothing for every release this image
 * writes and the reads that exist for it would scan the partition instead. It
 * is re-rendered over the key the payload has, at both tags, because the tag
 * that left is a tag stored rows were written at and the field is what moved.
 *
 * THE REFERENCES ARE POSITIVE, AND ONE PREDICATE SAYS SO ONCE. Every reference
 * in a released ticket, an obligation and a report is an integer this
 * vocabulary can hold and greater than zero — `taskDefinitionValid` and
 * `releasedTicketValid` are the model's names for it — and the arms weighed
 * that as an integer test beside a floor written out per field. A jsonb
 * comparison answers for a value that is absent or of the wrong type without
 * raising, so the floor needs no second statement, and `command_reference` is
 * where it is stated; `command_task_definition` is the four references a task
 * definition is, which the release carries once for work and once per
 * evaluator and the obligation carries again.
 *
 * THE OBLIGATION NAMES THE TASK THE COMPLETION NAMES, AND IS WEIGHED AGAINST
 * IT RATHER THAN BESIDE IT. The event already carries the identity, so a
 * report whose obligation named a different task would be a completion with
 * two answers to the same question and the reader would settle the wrong one.
 * Equality is one condition where a second copy of the identity arm would be
 * eleven, and it is the stronger statement — it is also the whole of the shape
 * test, because only an object holding that identity can equal it, and a
 * subscript of a value that is not one answers null rather than raising.
 *
 * THE STAGE'S DEAD WIDTH GOES WITH THE THREE 012 LEFT STANDING. The arm
 * refused a fan-out on a stage, a fan-out on the ticket, a finalizer this tree
 * has one of and a combinator this tree has one of — shapes PRs 1, 2 and 9
 * removed. They are dead for the same reason: the spelling that carried them
 * is refused whole above, so nothing that reaches the walk below can name one,
 * and a fresh walk that refuses them would be this schema's own statement that
 * it expects a writer nothing mints.
 *
 * THE MATERIAL THE REFERENCES NAME IS A ROW, AND THE REFERENCES STAY IN THE
 * JOURNAL. `ticket_definition` holds what a request is built from — the image,
 * the requirement per kind and stage, the blocks a briefing composes, the
 * finalization binding — resolved once in the release transaction, so every
 * cycle of a ticket runs the revision its release pinned rather than whatever
 * the configuration says when the cycle starts. It is not a second copy of the
 * references: those are read back from the entry the release journalled, which
 * is why this migration gives the boundary owner the columns of `journal_entry`
 * that read names and nothing else. The scheduler reads it because the
 * requirement is copied into `execution`, which is the scheduler's own row.
 *
 * `ticket_source` IS ONE ROW PER SOURCE A TICKET HAS RUN AT, keyed by the
 * reference the source folds to, so the dispatch's observation and every
 * accepted work result land in the same relation and a spawn reads the ticket's
 * current source without asking a forge. A ticket whose brief names no
 * repository has a source too — it is what a rework and a finalization run at —
 * and carries no commit, which is what the wholeness CHECK says: a repository
 * and a commit arrive together or not at all.
 *
 * NEITHER POINTS AT `ticket_projection`, BECAUSE NOTHING IN THIS SCHEMA DOES.
 * The projection is a projection: it is rebuilt from the journal rather than
 * repaired, and a foreign key into it would make a row this schema can rebuild
 * the parent of rows it cannot. Both point at `project` instead, which is what
 * every other per-ticket relation here points at.
 *
 * AND THE AUTHORITY CHECK LOSES THE TAG THAT LEFT IN 012. `operation_
 * completion_authority_is_its_boundary` still switched on a block naming a
 * ticket, which stopped being an event a boundary writes when a wall became a
 * task's; the arm is dead and a reader would build for it. It is re-rendered
 * without that arm and stays unvalidated, because re-rendering a roster is not
 * a new rule about the rows already under it.
 *
 * AND A DISPATCH JOINS THE EVENTS NO PRINCIPAL MAY OFFER, which is 007's move
 * for 007's reason: the dispatch carries the commit its work is observed at,
 * and only the writer observes one, so a `Decide` carrying the event is a
 * principal authoring a source. `ticket_command_is_valid` is re-rendered with
 * it beside `FinalizationResult` — the acceptance function classifies a
 * decision by the event it carries and would otherwise have admitted this one
 * as ordinary.
 *
 * `submit_task_completion` IS REWRITTEN WHOLE AGAIN, AND THE OBLIGATION IS
 * WHY. A produced report carries the whole of what the task was asked for, so
 * the door reads the released definition off the entry the release journalled —
 * the work definition for a work task, the named evaluator's for an evaluation
 * one — inside the transaction that already holds the execution row, and builds
 * the obligation from rows rather than taking one from the caller. The context
 * a task ran in is its work cycle: the model's evaluation input is begun at the
 * cycle that produced the result it judges, so the two kinds of task answer the
 * same number and neither is authored. What it returned is one reference like
 * every other, the fold of its manifest's digest, because that is the shape the
 * machine reads and a record in its place is a payload no replay admits.
 *
 * AND A PASSED WORK RESULT IS WHERE THE TICKET'S SOURCE MOVES. The commit the
 * manifest was produced at is what the next cycle, the next evaluation and the
 * finalizer run against, so the door folds it to the reference the report
 * carries and writes the `ticket_source` row under the same lock — one
 * statement, so the reference journalled and the row a spawn will read are the
 * same source. A pass with no observation recorded against its manifest is
 * refused on a ticket whose sources name a repository, because that ticket's
 * next spawn has nowhere to run and a completion that settled it would leave
 * the ticket pointing at a commit nobody wrote down.
 *
 * AND THE WORKER'S DOOR STOPS WRITING THE OBSERVATION AFTER THE COMPLETION IT
 * IS READ BY. `submit_worker_result` took the source, delegated the whole
 * submission to its own sourceless overload and recorded the observation once
 * that returned — which is after the completion asked for it, so a passed work
 * result through the worker plane would be refused for recording nothing. The
 * overload carrying the source becomes the implementation, writing the row
 * between the result it belongs to and the completion that reads it, and the
 * sourceless one becomes the call to it that passes none.
 *
 * ITS SIGNATURE DOES NOT MOVE, so this is a replacement and not a drop. The
 * obligation is derived rather than passed: the scheduler's door still takes
 * the ticket, the wire integer and the outcome it was told, weighs them against
 * the execution as `BindingMismatch` always has, and the definition it reports
 * is the one the release wrote down. Nothing in `privileges.ts` spells a new
 * signature, so no grant is restated and `AlreadySubmitted` answers exactly as
 * before.
 */

/**
 * How the generated codec spells a released ticket: a sum arm carrying a record
 * is the constructor under `type` and the record under `value`, so the release
 * payload is the released ticket itself and its fields are the record's.
 */
const releasedIdField = "id";
const releasedContentField = "content";
const releasedDependenciesField = "dependencies";
const releasedWorkField = "workConfiguration";
const releasedPlanField = "evaluationPlan";
const releasedStagesField = "stages";
const releasedFinalizationField = "finalizationConfiguration";
const stageKeyField = "key";
const stageEvaluatorsField = "evaluators";
const evaluatorKeyField = "key";
const evaluatorTaskField = "task";

/** The four references a task definition is, as the codec spells that record. */
const definitionWorkloadField = "workload";
const definitionInputsField = "inputs";
const definitionRequirementsField = "executionRequirements";
const definitionContractField = "resultContract";

/** What a produced report carries, and the field the dispatch names its source at. */
const obligationField = "obligation";
const obligationTaskField = "task";
const obligationDefinitionField = "definition";
const obligationContextField = "contextRef";
const resultReferenceField = "resultRef";
const acceptedSourceField = "acceptedSourceRef";
const dispatchSourceField = "source";

/** The reference predicates this migration states once and the arms weigh with. */
const referencePredicate = "command_reference";
const taskDefinitionPredicate = "command_task_definition";

/**
 * The bound a released ticket's material takes, which is the bound this tree
 * already holds a configuration document to: the material is resolved from one.
 */
const ticketDefinitionCharsMax = 65_536;

export const migration013: Migration = {
  version: 13,
  name: "a ticket is released as a definition, and runs at the source it was dispatched from",
  statements: [
    `DO $$
       BEGIN
         IF EXISTS (SELECT FROM public.journal_entry) THEN
           RAISE EXCEPTION 'this image replays no journal written before it; empty the journal with deploy/rig/wipe-tickets.sql first'
             USING ERRCODE = 'integrity_constraint_violation';
         END IF;
       END $$`,
    `CREATE TABLE public.ticket_definition (
    tenant text NOT NULL,
    project text NOT NULL,
    ticket bigint NOT NULL,
    definition jsonb NOT NULL,
    digest text NOT NULL,
    CONSTRAINT ticket_definition_digest_is_named CHECK (((length(digest) >= 1) AND (length(digest) <= 256))),
    CONSTRAINT ticket_definition_material_is_bounded CHECK (((jsonb_typeof(definition) = 'object'::text) AND (length((definition)::text) <= ${String(ticketDefinitionCharsMax)}))),
    CONSTRAINT ticket_definition_ticket_is_positive CHECK ((ticket >= 1))
)`,
    `ALTER TABLE ONLY public.ticket_definition
    ADD CONSTRAINT ticket_definition_pkey PRIMARY KEY (tenant, project, ticket)`,
    `ALTER TABLE ONLY public.ticket_definition
    ADD CONSTRAINT ticket_definition_belongs_to_project FOREIGN KEY (tenant, project) REFERENCES public.project(tenant, project)`,
    `CREATE TABLE public.ticket_source (
    tenant text NOT NULL,
    project text NOT NULL,
    ticket bigint NOT NULL,
    source bigint NOT NULL,
    repository text,
    commit text,
    ref text,
    CONSTRAINT ticket_source_commit_is_hex CHECK ((commit ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'::text)),
    CONSTRAINT ticket_source_counters_are_positive CHECK (((ticket >= 1) AND (source >= 1))),
    CONSTRAINT ticket_source_names_a_commit_with_its_repository CHECK (((repository IS NULL) = (commit IS NULL))),
    CONSTRAINT ticket_source_ref_is_bounded CHECK (((length(ref) >= 1) AND (length(ref) <= 256))),
    CONSTRAINT ticket_source_repository_is_bounded CHECK (((length(repository) >= 1) AND (length(repository) <= 256)))
)`,
    `ALTER TABLE ONLY public.ticket_source
    ADD CONSTRAINT ticket_source_pkey PRIMARY KEY (tenant, project, ticket, source)`,
    `ALTER TABLE ONLY public.ticket_source
    ADD CONSTRAINT ticket_source_belongs_to_project FOREIGN KEY (tenant, project) REFERENCES public.project(tenant, project)`,
    `GRANT SELECT,INSERT ON TABLE public.ticket_definition TO ${ticketServiceRole};
GRANT SELECT ON TABLE public.ticket_definition TO ${boundaryOwnerRole};
GRANT SELECT ON TABLE public.ticket_definition TO ${schedulerRole};`,
    `GRANT SELECT,INSERT ON TABLE public.ticket_source TO ${ticketServiceRole};
GRANT SELECT,INSERT ON TABLE public.ticket_source TO ${boundaryOwnerRole};
GRANT SELECT ON TABLE public.ticket_source TO ${schedulerRole};`,
    `GRANT SELECT(tenant) ON TABLE public.ticket_source TO ${apiRole}`,
    `GRANT SELECT(project) ON TABLE public.ticket_source TO ${apiRole}`,
    `GRANT SELECT(ticket) ON TABLE public.ticket_source TO ${apiRole}`,
    `GRANT SELECT(source) ON TABLE public.ticket_source TO ${apiRole}`,
    `GRANT SELECT(repository) ON TABLE public.ticket_source TO ${apiRole}`,
    `GRANT SELECT(commit) ON TABLE public.ticket_source TO ${apiRole}`,
    `GRANT SELECT(ref) ON TABLE public.ticket_source TO ${apiRole}`,
    `GRANT SELECT(tenant) ON TABLE public.journal_entry TO ${boundaryOwnerRole}`,
    `GRANT SELECT(project) ON TABLE public.journal_entry TO ${boundaryOwnerRole}`,
    `GRANT SELECT(entry) ON TABLE public.journal_entry TO ${boundaryOwnerRole}`,
    `CREATE OR REPLACE FUNCTION public.ticket_command_is_valid(command jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
       BEGIN
         IF command IS NULL OR jsonb_typeof(command) <> 'object' THEN
           RETURN false;
         END IF;
         IF command->>'command' = 'SubmitFinalizationResult' THEN
           RETURN jsonb_typeof(command->'version') = 'number'
             AND command->>'version' = '1'
             AND jsonb_typeof(command->'request') = 'string'
             AND length(command->>'request') BETWEEN 1 AND 256
             AND (command->'attempt' IS NULL
               OR (jsonb_typeof(command->'attempt') = 'string'
                 AND length(command->>'attempt') BETWEEN 1 AND 256))
             AND command_integer(command->'requestGeneration')
             AND (command->>'requestGeneration')::numeric >= 1
             AND jsonb_typeof(command->'recoveryEpoch') = 'string'
             AND length(command->>'recoveryEpoch') BETWEEN 1 AND 256
             AND command->>'outcome' IN ('FinalizationSucceeded', 'FinalizationFailed',
               'FinalizationNeedsWork', 'FinalizationResultUnavailable')
             AND (command->'kind' IS NOT NULL)
               = (command->>'outcome' = 'FinalizationResultUnavailable')
             AND (command->'kind' IS NULL
               OR (jsonb_typeof(command->'kind') = 'string'
                 AND length(command->>'kind') BETWEEN 1 AND 256));
         END IF;
         RETURN public_ticket_command_is_valid(command)
           AND (command->>'command' <> 'Decide'
             OR command->'event'->>'type' NOT IN ('FinalizationResult', 'Dispatch'));
       END $$;`,
    `DROP INDEX public.journal_entry_release_ticket`,
    `CREATE INDEX journal_entry_release_ticket ON public.journal_entry USING btree (tenant, project, (
CASE
    WHEN (entry IS JSON OBJECT) THEN ((((entry)::jsonb -> 'event'::text) -> 'value'::text) -> '${releasedIdField}'::text)
    ELSE NULL::jsonb
END)) WHERE (
CASE
    WHEN (entry IS JSON OBJECT) THEN (((entry)::jsonb -> 'event'::text) ->> 'type'::text)
    ELSE NULL::text
END = ANY (ARRAY['ReleaseTicket'::text, 'CreateTicket'::text]))`,
    `ALTER TABLE public.operation
       DROP CONSTRAINT operation_completion_authority_is_its_boundary,
       ADD CONSTRAINT operation_completion_authority_is_its_boundary CHECK (
CASE command_tag
    WHEN 'TaskDone'::text THEN (authority_kind = 'ExecutionScheduler'::text)
    WHEN 'FinalizationResult'::text THEN (authority_kind = 'Finalizer'::text)
    ELSE true
END) NOT VALID`,
    `CREATE FUNCTION public.${referencePredicate}(value jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
       SELECT command_integer(value) AND value > '0'::jsonb
     $$`,
    `ALTER FUNCTION public.${referencePredicate}(value jsonb) OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION public.${referencePredicate}(value jsonb) FROM PUBLIC`,
    `CREATE FUNCTION public.${taskDefinitionPredicate}(definition jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
       SELECT jsonb_typeof(definition) = 'object'
          AND ${referencePredicate}(definition->'${definitionWorkloadField}')
          AND ${referencePredicate}(definition->'${definitionInputsField}')
          AND ${referencePredicate}(definition->'${definitionRequirementsField}')
          AND ${referencePredicate}(definition->'${definitionContractField}')
     $$`,
    `ALTER FUNCTION public.${taskDefinitionPredicate}(definition jsonb) OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION public.${taskDefinitionPredicate}(definition jsonb) FROM PUBLIC`,
    `CREATE OR REPLACE FUNCTION public.decision_event_is_valid(event jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
     DECLARE tag text; value jsonb; item jsonb; entry jsonb; place bigint;
       task jsonb; constructor text; report jsonb; arm text; produced jsonb;
       obligation jsonb; stages jsonb; dependencies jsonb;
     BEGIN
       IF event IS NULL OR jsonb_typeof(event) <> 'object'
          OR jsonb_typeof(event->'type') <> 'string' THEN
         RETURN false;
       END IF;
       tag := event->>'type'; value := event->'value';
       IF tag IN ('Revoke', 'ResumeTicket') THEN
         RETURN command_integer(value);
       END IF;
       IF tag = 'Dispatch' THEN
         RETURN jsonb_typeof(value) = 'object'
           AND ${referencePredicate}(value->'ticket')
           AND ${referencePredicate}(value->'${dispatchSourceField}');
       END IF;
       IF tag = 'TaskDone' THEN
         task := value->'task'; constructor := COALESCE(task->>'type', '');
         report := value->'report'; arm := COALESCE(report->>'type', '');
         produced := report->'value'->'result';
         obligation := produced->'${obligationField}';
         IF jsonb_typeof(value) <> 'object'
            OR NOT command_integer(value->'ticket')
            OR value ? 'tid' OR value ? 'verdict' OR value ? 'onFailure' THEN
           RETURN false;
         END IF;
         IF NOT ((constructor = 'WorkTask'
                  AND command_integer(task->'value'->'ticket')
                  AND command_integer(task->'value'->'cycle'))
              OR (constructor = 'EvaluationTask'
                  AND command_integer(task->'value'->'ticket')
                  AND command_integer(task->'value'->'workCycle')
                  AND command_integer(task->'value'->'stage')
                  AND command_integer(task->'value'->'generation')
                  AND command_integer(task->'value'->'evaluator'))) THEN
           RETURN false;
         END IF;
         IF report ? 'value' AND report->'value' ? 'ticket' THEN
           RETURN false;
         END IF;
         IF arm = 'TerminalFailureReport' THEN
           RETURN ${referencePredicate}(report->'value'->'evidence')
             AND COALESCE(report->'value'->>'kind', '')
               IN ('ProcessFailure', 'ExecutionUnavailableFailure');
         END IF;
         IF arm NOT IN ('WorkResultReport', 'EvaluationResultReport')
            OR obligation->'${obligationTaskField}' IS DISTINCT FROM task
            OR NOT ${taskDefinitionPredicate}(obligation->'${obligationDefinitionField}')
            OR NOT ${referencePredicate}(obligation->'${obligationContextField}')
            OR NOT ${referencePredicate}(produced->'${resultReferenceField}') THEN
           RETURN false;
         END IF;
         IF arm = 'WorkResultReport' THEN
           RETURN ${referencePredicate}(report->'value'->'${acceptedSourceField}');
         END IF;
         RETURN COALESCE(report->'value'->>'verdict', '')
           IN ('EvaluatorPass', 'EvaluatorFail');
       END IF;
       IF tag = 'FinalizationResult' THEN
         RETURN jsonb_typeof(value) = 'object'
           AND command_integer(value->'ticket')
           AND value->>'out' IN ('FinalizationSucceeded',
             'FinalizationNeedsWork', 'FinalizationResultUnavailable');
       END IF;
       IF tag <> 'CreateTicket' OR jsonb_typeof(value) <> 'object'
          OR value ? 'deps' OR value ? 'prog'
          OR NOT ${referencePredicate}(value->'${releasedIdField}')
          OR NOT ${referencePredicate}(value->'${releasedContentField}')
          OR NOT ${referencePredicate}(value->'${releasedFinalizationField}')
          OR NOT ${taskDefinitionPredicate}(value->'${releasedWorkField}')
          OR jsonb_typeof(value->'${releasedDependenciesField}') IS DISTINCT FROM 'array'
          OR jsonb_typeof(value->'${releasedPlanField}') IS DISTINCT FROM 'object'
          OR jsonb_typeof(value->'${releasedPlanField}'->'${releasedStagesField}')
             IS DISTINCT FROM 'array' THEN
         RETURN false;
       END IF;
       dependencies := value->'${releasedDependenciesField}';
       stages := value->'${releasedPlanField}'->'${releasedStagesField}';
       IF (SELECT count(*) FROM jsonb_array_elements(dependencies)) <>
          (SELECT count(DISTINCT element)
             FROM jsonb_array_elements(dependencies) AS elements(element)) THEN
         RETURN false;
       END IF;
       FOR item IN SELECT element FROM jsonb_array_elements(dependencies) AS elements(element) LOOP
         IF NOT ${referencePredicate}(item) THEN RETURN false; END IF;
       END LOOP;
       FOR item, place IN
         SELECT element, ordinality
           FROM jsonb_array_elements(stages) WITH ORDINALITY AS elements(element, ordinality)
       LOOP
         IF jsonb_typeof(item) <> 'object'
            OR NOT ${referencePredicate}(item->'${stageKeyField}')
            OR jsonb_typeof(item->'${stageEvaluatorsField}') <> 'array' THEN
           RETURN false;
         END IF;
         IF (item->>'${stageKeyField}')::bigint <> place
            OR jsonb_array_length(item->'${stageEvaluatorsField}') < 1 THEN
           RETURN false;
         END IF;
         FOR entry IN SELECT element
               FROM jsonb_array_elements(item->'${stageEvaluatorsField}') AS elements(element) LOOP
           IF jsonb_typeof(entry) <> 'object'
              OR NOT ${referencePredicate}(entry->'${evaluatorKeyField}')
              OR NOT ${taskDefinitionPredicate}(entry->'${evaluatorTaskField}') THEN
             RETURN false;
           END IF;
         END LOOP;
         IF (SELECT count(DISTINCT element->'${evaluatorKeyField}')
               FROM jsonb_array_elements(item->'${stageEvaluatorsField}') AS elements(element))
            <> jsonb_array_length(item->'${stageEvaluatorsField}') THEN
           RETURN false;
         END IF;
       END LOOP;
       RETURN true;
     END $$;`,
    `CREATE OR REPLACE FUNCTION public.submit_task_completion(in_tenant text, in_project text, in_execution text, in_ticket bigint, in_task bigint, in_source_effect integer, in_outcome text, in_manifest text, in_manifest_digest text, in_reason text, in_operation text, in_authority_subject text) RETURNS TABLE(result text, operation text, ordinal bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record; observed record; project_lifecycle text;
       project_generation bigint; next_ordinal bigint; command_value jsonb;
       identity jsonb; report jsonb; released jsonb; definition jsonb;
       obligation jsonb; produced jsonb; accepted bigint;
     BEGIN
       IF in_outcome NOT IN ('Passed', 'Failed', 'Blocked', 'ProcessFailed') THEN
         RAISE EXCEPTION 'completion outcome % is not one this boundary submits', in_outcome
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       SELECT e.ticket, e.task, e.status, e.completion_operation, q.effect_position,
              r.manifest, r.digest, r.verdict,
              t.kind AS task_kind, t.cycle, t.stage, t.generation, t.evaluator
         INTO bound
         FROM execution e
         JOIN execution_request q
           ON q.tenant = e.tenant AND q.project = e.project AND q.request = e.source_request
         JOIN execution_request_task t
           ON t.tenant = e.tenant AND t.project = e.project
          AND t.request = e.source_request AND t.task = e.task
         LEFT JOIN execution_result r
           ON r.tenant = e.tenant AND r.project = e.project AND r.execution = e.execution
        WHERE e.tenant = in_tenant AND e.project = in_project AND e.execution = in_execution
        FOR UPDATE OF e;
       IF NOT FOUND THEN
         RETURN QUERY SELECT 'UnknownExecution'::text, NULL::text, NULL::bigint; RETURN;
       END IF;
       IF bound.completion_operation IS NOT NULL THEN
         RETURN QUERY SELECT 'AlreadySubmitted'::text, bound.completion_operation::text,
           (SELECT d.ordinal FROM decision_input d
             WHERE d.tenant = in_tenant AND d.project = in_project
               AND d.input_kind = 'Operation' AND d.input_id = bound.completion_operation);
         RETURN;
       END IF;
       IF bound.status IN ('Terminal', 'Cancelled')
          OR bound.ticket <> in_ticket OR bound.task <> in_task
          OR bound.effect_position <> in_source_effect
          OR (in_outcome = 'Blocked') <> (in_manifest IS NULL)
          OR (in_outcome = 'Blocked') <> (in_reason IS NOT NULL)
          OR (in_reason IS NOT NULL AND in_reason NOT IN ('ExecutionPolicyDenied', 'TicketConfigIncompatible', 'ExecutionProfileUnavailable', 'RuntimeVersionUnsupported', 'RequiredCapabilityUnavailable'))
          OR (in_manifest IS NOT NULL
              AND (bound.manifest IS DISTINCT FROM in_manifest
                   OR bound.digest IS DISTINCT FROM in_manifest_digest))
          OR (in_outcome <> 'Blocked'
              AND (bound.verdict IS NULL
                   OR (in_outcome = 'Passed') <> (bound.verdict = 'Pass')))
       THEN
         RETURN QUERY SELECT 'BindingMismatch'::text, NULL::text, NULL::bigint; RETURN;
       END IF;
       SELECT p.lifecycle, p.lifecycle_generation
         INTO STRICT project_lifecycle, project_generation
         FROM project p WHERE p.tenant = in_tenant AND p.project = in_project FOR UPDATE;
       IF project_lifecycle = 'Retention' THEN
         RETURN QUERY SELECT 'NotAdmitted'::text, NULL::text, NULL::bigint; RETURN;
       END IF;
       IF bound.task_kind = 'Work' THEN
         identity := jsonb_build_object('type', 'WorkTask', 'value',
           jsonb_build_object('ticket', bound.ticket, 'cycle', bound.cycle));
       ELSE
         identity := jsonb_build_object('type', 'EvaluationTask', 'value',
           jsonb_build_object('ticket', bound.ticket, 'workCycle', bound.cycle,
             'stage', bound.stage, 'generation', bound.generation,
             'evaluator', bound.evaluator));
       END IF;
       IF in_outcome = 'Blocked' THEN
         report := jsonb_build_object('type', 'TerminalFailureReport', 'value',
           jsonb_build_object('evidence', bound.task,
             'kind', 'ExecutionUnavailableFailure'));
       ELSIF in_outcome = 'ProcessFailed'
          OR (bound.task_kind = 'Work' AND bound.verdict <> 'Pass') THEN
         report := jsonb_build_object('type', 'TerminalFailureReport', 'value',
           jsonb_build_object('evidence', bound.task, 'kind', 'ProcessFailure'));
       ELSE
         SELECT (j.entry::jsonb)->'event'->'value' INTO released
           FROM journal_entry j
          WHERE j.tenant = in_tenant AND j.project = in_project
            AND (CASE WHEN j.entry IS JSON OBJECT
                      THEN j.entry::jsonb->'event'->>'type' END)
                = ANY (ARRAY['ReleaseTicket'::text, 'CreateTicket'::text])
            AND (CASE WHEN j.entry IS JSON OBJECT
                      THEN j.entry::jsonb->'event'->'value'->'${releasedIdField}' END)
                = to_jsonb(bound.ticket)
          LIMIT 1;
         IF bound.task_kind = 'Work' THEN
           definition := released->'${releasedWorkField}';
         ELSE
           SELECT evaluators.evaluator->'${evaluatorTaskField}' INTO definition
             FROM jsonb_array_elements(released->'${releasedPlanField}'->'${releasedStagesField}')
                    AS stages(stage),
                  jsonb_array_elements(stages.stage->'${stageEvaluatorsField}')
                    AS evaluators(evaluator)
            WHERE (stages.stage->>'${stageKeyField}')::bigint = bound.stage
              AND (evaluators.evaluator->>'${evaluatorKeyField}')::bigint = bound.evaluator;
         END IF;
         obligation := jsonb_build_object(
           '${obligationTaskField}', identity,
           '${obligationDefinitionField}', definition,
           '${obligationContextField}', bound.cycle);
         produced := jsonb_build_object('${obligationField}', obligation,
           '${resultReferenceField}', result_digest_fold(bound.digest));
         IF bound.task_kind = 'Evaluation' THEN
           report := jsonb_build_object('type', 'EvaluationResultReport', 'value',
             jsonb_build_object('result', produced, 'verdict',
               CASE WHEN bound.verdict = 'Pass'
                 THEN 'EvaluatorPass' ELSE 'EvaluatorFail' END));
         ELSE
           SELECT s.repository, s.commit, s.ref INTO observed
             FROM execution_result_source s
            WHERE s.tenant = in_tenant AND s.project = in_project
              AND s.manifest = bound.manifest;
           IF FOUND THEN
             accepted := result_digest_fold(observed.commit);
             INSERT INTO ticket_source
               (tenant, project, ticket, source, repository, commit, ref)
             VALUES (in_tenant, in_project, bound.ticket, accepted,
               observed.repository, observed.commit, observed.ref)
             ON CONFLICT (tenant, project, ticket, source) DO NOTHING;
           ELSIF EXISTS (SELECT FROM ticket_source t
                          WHERE t.tenant = in_tenant AND t.project = in_project
                            AND t.ticket = bound.ticket AND t.repository IS NOT NULL) THEN
             RETURN QUERY SELECT '${sourceUnrecordedResult}'::text, NULL::text, NULL::bigint;
             RETURN;
           ELSE
             SELECT t.source INTO accepted FROM ticket_source t
              WHERE t.tenant = in_tenant AND t.project = in_project
                AND t.ticket = bound.ticket LIMIT 1;
           END IF;
           report := jsonb_build_object('type', 'WorkResultReport', 'value',
             jsonb_build_object('result', produced,
               '${acceptedSourceField}', accepted));
         END IF;
       END IF;
       command_value := jsonb_build_object('version', 1, 'command', 'Decide', 'event',
         jsonb_build_object('type', 'TaskDone', 'value',
           jsonb_build_object('ticket', bound.ticket, 'task', identity,
             'report', report)));
       IF ticket_command_is_valid(command_value) IS NOT TRUE THEN
         RAISE EXCEPTION 'the completion this boundary built is not one the mailbox admits'
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       UPDATE project p SET ingress_next = p.ingress_next + 1
        WHERE p.tenant = in_tenant AND p.project = in_project
        RETURNING p.ingress_next - 1 INTO next_ordinal;
       INSERT INTO operation
         (tenant, project, operation, authority_kind, authority_subject, admission,
          key_version, key_digest, payload_digest, command, command_tag)
       VALUES (in_tenant, in_project, in_operation, 'ExecutionScheduler',
          in_authority_subject, 'CorrectnessReducing', 'scheduler-v1',
          encode(sha256(convert_to('execution:' || in_execution, 'UTF8')), 'hex'),
          encode(sha256(convert_to(command_value::text, 'UTF8')), 'hex'),
          command_value::text, 'TaskDone');
       INSERT INTO decision_input
         (tenant, project, ordinal, input_kind, input_id, base_priority, lifecycle_generation)
       VALUES (in_tenant, in_project, next_ordinal, 'Operation', in_operation,
          'Completion', project_generation);
       INSERT INTO project_readiness (tenant, project, ready, generation)
       VALUES (in_tenant, in_project, true, 1)
       ON CONFLICT (tenant, project) DO UPDATE
         SET ready = true, generation = project_readiness.generation + 1;
       UPDATE execution
          SET status = 'Terminal',
              outcome = in_outcome,
              blocked_reason = in_reason,
              result_manifest = in_manifest, completion_operation = in_operation,
              terminal_at = now()
        WHERE tenant = in_tenant AND project = in_project AND execution = in_execution;
       RETURN QUERY SELECT 'Submitted'::text, in_operation, next_ordinal;
     END $$;`,
    `CREATE OR REPLACE FUNCTION public.submit_worker_result(in_secret_digest text, in_generation bigint, in_manifest text, in_schema integer, in_digest text, in_verdict text, in_artifacts jsonb, in_source jsonb, in_operation text) RETURNS TABLE(terminalized text, outcome text, operation text, incident text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
       DECLARE bound record; next_manifest bigint; submitted record; incident_id text;
         settled_outcome text; submitted_artifact jsonb; project_lifecycle text;
       BEGIN
         IF in_source IS NOT NULL AND (
              in_verdict<>'Pass'
              OR CASE WHEN jsonb_typeof(in_artifacts)='array' THEN EXISTS(
                   SELECT 1 FROM jsonb_array_elements(in_artifacts) x(artifact)
                    WHERE artifact->>'role'='Handoff') ELSE true END
              OR jsonb_typeof(in_source) IS DISTINCT FROM 'object'
              OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(in_source) key)
                 IS DISTINCT FROM ARRAY['base','commit','ref','repository']::text[]
              OR length(coalesce(in_source->>'repository','')) NOT BETWEEN 1 AND 256
              OR length(coalesce(in_source->>'ref','')) NOT BETWEEN 1 AND 256
              OR coalesce(in_source->>'commit','') !~ '^([0-9a-f]{40}|[0-9a-f]{64})$'
              OR coalesce(in_source->>'base','') !~ '^([0-9a-f]{40}|[0-9a-f]{64})$'
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
         IF jsonb_typeof(in_artifacts) IS DISTINCT FROM 'array' THEN
           incident_id='incident-'||gen_random_uuid()::text;
           INSERT INTO scheduler_incident(tenant,project,incident,kind,execution,attempt,evidence)
             VALUES(bound.tenant,bound.project,incident_id,'ConflictingResult',bound.execution,
                    bound.attempt,'ForeignManifest');
           RETURN QUERY SELECT 'Conflicting'::text,NULL::text,NULL::text,incident_id; RETURN;
         END IF;
         IF jsonb_array_length(in_artifacts)>256
            OR EXISTS(SELECT 1 FROM jsonb_array_elements(in_artifacts) x(artifact)
              WHERE jsonb_typeof(artifact) IS DISTINCT FROM 'object'
                 OR artifact->>'role' NOT IN ('Handoff','Diagnostic')
                 OR NOT (coalesce(artifact->>'ordinal','') ~ '^[0-9]+$')
                 OR CASE WHEN coalesce(artifact->>'ordinal','') ~ '^[0-9]+$'
                         THEN (artifact->>'ordinal')::numeric NOT BETWEEN 1 AND 256
                         ELSE true END
                 OR length(coalesce(artifact->>'path','')) NOT BETWEEN 1 AND 256
                 OR coalesce(artifact->>'path','') ~ '^/'
                 OR coalesce(artifact->>'path','') ~ '//'
                 OR coalesce(artifact->>'path','') ~ '[\\\\]'
                 OR coalesce(artifact->>'path','') ~ '(^|/)[.][.]?(/|$)'
                 OR coalesce(artifact->>'path','') ~ '[[:cntrl:]]'
                 OR coalesce(artifact->>'path','') ~ '(^|/)[[:space:]]'
                 OR coalesce(artifact->>'path','') ~ '[[:space:]](/|$)'
                 OR coalesce(artifact->>'digest','') !~ '^[0-9a-f]{64}$'
                 OR NOT (coalesce(artifact->>'bytes','') ~ '^[0-9]+$')
                 OR CASE WHEN coalesce(artifact->>'bytes','') ~ '^[0-9]+$'
                         THEN (artifact->>'bytes')::numeric NOT BETWEEN 0 AND 1073741824
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
                    ELSE 5368709121 END),0)
                  FROM jsonb_array_elements(in_artifacts) x(artifact))>5368709120 THEN
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
         FOR submitted_artifact IN SELECT value FROM jsonb_array_elements(in_artifacts) LOOP
           INSERT INTO execution_result_artifact(tenant,project,manifest,ordinal,role,path,digest,bytes)
             VALUES(bound.tenant,bound.project,in_manifest,(submitted_artifact->>'ordinal')::integer,
                    submitted_artifact->>'role',submitted_artifact->>'path',submitted_artifact->>'digest',
                    (submitted_artifact->>'bytes')::bigint);
         END LOOP;
         IF in_source IS NOT NULL THEN
           INSERT INTO execution_result_source
             (tenant,project,manifest,repository,ref,commit,base,expected_base)
             SELECT bound.tenant,bound.project,in_manifest,in_source->>'repository',
                    in_source->>'ref',in_source->>'commit',in_source->>'base',b.reference_id
               FROM execution_request q
               JOIN input_bundle_reference b
                 ON b.tenant=q.tenant AND b.project=q.project AND b.bundle=q.input_bundle
                    AND b.reference_kind='TargetCommit'
              WHERE q.tenant=bound.tenant AND q.project=bound.project
                AND q.request=bound.source_request;
         END IF;
         settled_outcome=CASE in_verdict WHEN 'Pass' THEN 'Passed' ELSE 'Failed' END;
         SELECT result,s.operation INTO submitted FROM submit_task_completion(
           bound.tenant,bound.project,bound.execution,bound.ticket,bound.task,bound.effect_position,
           settled_outcome,in_manifest,in_digest,NULL,in_operation,'chuggy_worker_plane') s;
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
       END $_$;`,
    `CREATE OR REPLACE FUNCTION public.submit_worker_result(in_secret_digest text, in_generation bigint, in_manifest text, in_schema integer, in_digest text, in_verdict text, in_artifacts jsonb, in_operation text) RETURNS TABLE(terminalized text, outcome text, operation text, incident text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
       BEGIN
         RETURN QUERY SELECT * FROM submit_worker_result(
           in_secret_digest,in_generation,in_manifest,in_schema,in_digest,in_verdict,
           in_artifacts,NULL::jsonb,in_operation);
       END $_$;`,
  ],
};
