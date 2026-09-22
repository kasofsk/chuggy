import { apiRole, type Migration } from "../shared.ts";

/**
 * A task is named by what it is rather than by a number the ticket happened to
 * hand out. `execution_request_task` carries the whole identity — the work
 * cycle, and for an evaluation the stage, the generation and the evaluator —
 * and the `TaskDone` this boundary journals carries it too, in place of `tid`.
 *
 * WHY THIS ONE OPENS WITH 008's GUARD. A stored `TaskDone` names a task by an
 * integer, and the validator this image installs refuses one that does: the
 * key is not optional here, it is gone, and an entry whose bytes are what its
 * digest attests cannot be rewritten into one this machine admits. So a
 * journal with rows in it comes up holding a ticket the actor cannot replay,
 * and adding the columns behind it would hide that behind a schema that looks
 * migrated. The guard refuses the migration instead and names
 * `deploy/rig/wipe-tickets.sql`, which is what empties the journal it needs.
 *
 * THE IDENTITY IS COLUMNS AND NOT A JSON DOCUMENT, and the reason is the same
 * one 008 gave for the desk: this relation is read by the api role column by
 * column, so a field that arrives without the grant beside it is a query
 * refused as a whole rather than one that answers null. A document would also
 * put the shape out of reach of a CHECK, and the shape is the whole point —
 * the model proves `taskIdentityValid` of every live task, and what a database
 * can hold to that is a constraint per arm over columns it can see.
 *
 * SO EACH ARM STATES THE WHOLE IDENTITY. `execution_request_task_check` is one
 * constraint over the kind and what the kind implies, and it leaves and comes
 * back carrying the new columns: work names a cycle and nothing else, an
 * evaluation names a cycle, a stage, a generation and an evaluator, and each
 * is positive. Half an identity is refused at the insert rather than found
 * missing at the read, which is what `taskIdentityValid` says and where this
 * schema can say it.
 *
 * THE CYCLE IS NOT NULL BECAUSE BOTH ARMS HAVE ONE, and the other three are
 * nullable because only one arm does. The column declaration is the honest
 * home for a field every row carries; the constraint is the home for a field
 * whose presence depends on the kind. That split is also what makes the arms
 * readable: they spell out which of the three are absent rather than repeating
 * that the cycle is there.
 *
 * THE STAGE STOPS BEING AN INDEX AND BECOMES THE KEY THE IDENTITY NAMES. The
 * column was a zero-based position in the released program; the identity's
 * stage is positive, because a stage that is not the first one has to be
 * nameable without reference to how the list was stored. Nothing here rewrites
 * a row — behind the wipe there are none — so the whole change is the floor in
 * the restated constraint, and every writer and reader of that column moves
 * with it: the interpreter's projection, the requirement key an authored
 * configuration spells as a stage, and the labels the console used to reach by
 * adding one.
 *
 * AND THE SOURCE ROSTER LOSES THE MEMBER ONLY A NUMBERED TASK COULD NAME.
 * `execution_requirement_source_known` admits `ExplicitTask`, which is what a
 * requirement authored against one task's number materialized as. A task is
 * named by an identity its ticket mints as it spawns, so there is nothing an
 * author can write down that reaches one, and neither the model's
 * `selectedRequirement` nor the interpreter's has an arm that yields it. Left
 * standing, the CHECK would be this schema's own statement that a source
 * nothing mints is a source it expects — and the next reader would build for
 * it. The constraint is dropped by name and written again without it.
 *
 * ONLY THE NEW COLUMNS TAKE GRANTS. The api role reads this relation column by
 * column, so the three that arrive need a line each; the stage was already
 * granted and keeps that grant through a floor change. Every other role holds
 * this relation by table, so a column arriving is already theirs.
 *
 * AND `tid` IS REFUSED FOR BEING NAMED RATHER THAN IGNORED FOR IT, which is
 * 009's move for 009's reason. Behind the wipe no stored entry carries it, so
 * the only writer that could is an image of the earlier vintage pointed at a
 * migrated database — and that writer means a completion bound to a number
 * this machine no longer allocates. Refusing the entry is what makes that loud
 * at the mailbox rather than at a task that resolved the wrong obligation.
 *
 * WHAT THE MAILBOX ARM WEIGHS IS THE SHAPE, AND THE COLUMNS CARRY THE FLOORS.
 * The arm asks for each field of the constructor it was given, exactly as the
 * arm it replaces asked for the ticket beside it, and it stops there: the only
 * writer of this event reads a row this relation already held to the floors,
 * and an identity that clears the shape but names a cycle nothing ever spawned
 * is refused by the actor as not naming a live task.
 *
 * `submit_task_completion` IS REWRITTEN WHOLE, AND THE IDENTITY IS WHY. The
 * event it builds used to be the execution's own `task` column copied across,
 * which is a number the boundary already had in hand; the identity is four
 * more fields that live on another relation, and it reads them there inside
 * the transaction that already holds the execution row — the same lock, the
 * same statement, so the identity journalled is the identity the request
 * authorized and not one a concurrent writer moved underneath it. The join is
 * total because `execution_has_its_authorized_task` says it is, so an
 * execution that reaches this door has exactly one task row to read.
 *
 * ITS SIGNATURE DOES NOT MOVE, so this is a replacement and not a drop. The
 * identity is read rather than passed: the scheduler's door still takes the
 * ticket and the wire integer it was told, weighs them against the execution
 * as `BindingMismatch` always has, and the reconstruction happens on this side
 * of the boundary. Nothing in `privileges.ts` spells a new signature, so no
 * grant is restated and `AlreadySubmitted` answers exactly as before.
 */

/**
 * How the generated codec spells the identity: a sum carrying a record is the
 * constructor under `type` and the record under `value`, and the work cycle is
 * `cycle` in one arm and `workCycle` in the other because that is what the two
 * records call it.
 */
const workTaskTag = "WorkTask";
const evaluationTaskTag = "EvaluationTask";
const workCycleField = "cycle";
const evaluationCycleField = "workCycle";

export const migration010: Migration = {
  version: 10,
  name: "a task is named by its cycle, its stage, its generation and its evaluator",
  statements: [
    `DO $$
       BEGIN
         IF EXISTS (SELECT FROM public.journal_entry) THEN
           RAISE EXCEPTION 'this image replays no journal written before it; empty the journal with deploy/rig/wipe-tickets.sql first'
             USING ERRCODE = 'integrity_constraint_violation';
         END IF;
       END $$`,
    `ALTER TABLE public.execution_request_task
       DROP CONSTRAINT execution_request_task_check,
       ADD COLUMN cycle bigint NOT NULL,
       ADD COLUMN generation bigint,
       ADD COLUMN evaluator bigint,
       ADD CONSTRAINT execution_request_task_check CHECK ((((kind = 'Work'::text) AND (cycle >= 1) AND (stage IS NULL) AND (generation IS NULL) AND (evaluator IS NULL)) OR ((kind = 'Evaluation'::text) AND (cycle >= 1) AND (stage IS NOT NULL) AND (stage >= 1) AND (generation IS NOT NULL) AND (generation >= 1) AND (evaluator IS NOT NULL) AND (evaluator >= 1))))`,
    `GRANT SELECT(cycle) ON TABLE public.execution_request_task TO ${apiRole}`,
    `GRANT SELECT(generation) ON TABLE public.execution_request_task TO ${apiRole}`,
    `GRANT SELECT(evaluator) ON TABLE public.execution_request_task TO ${apiRole}`,
    `ALTER TABLE public.execution
       DROP CONSTRAINT execution_requirement_source_known,
       ADD CONSTRAINT execution_requirement_source_known CHECK ((requirement_source = ANY (ARRAY['TaskKindDefault'::text, 'TicketDefault'::text, 'PlatformDefault'::text])))`,
    `CREATE OR REPLACE FUNCTION public.decision_event_is_valid(event jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
     DECLARE tag text; value jsonb; item jsonb; task jsonb; constructor text;
     BEGIN
       IF event IS NULL OR jsonb_typeof(event) <> 'object'
          OR jsonb_typeof(event->'type') <> 'string' THEN
         RETURN false;
       END IF;
       tag := event->>'type'; value := event->'value';
       IF tag IN ('Revoke', 'Dispatch', 'ResumeTicket') THEN
         RETURN command_integer(value);
       END IF;
       IF tag = 'TaskDone' THEN
         task := value->'task'; constructor := COALESCE(task->>'type', '');
         RETURN jsonb_typeof(value) = 'object'
           AND command_integer(value->'ticket') AND NOT value ? 'tid'
           AND ((constructor = '${workTaskTag}'
                 AND command_integer(task->'value'->'ticket')
                 AND command_integer(task->'value'->'${workCycleField}'))
             OR (constructor = '${evaluationTaskTag}'
                 AND command_integer(task->'value'->'ticket')
                 AND command_integer(task->'value'->'${evaluationCycleField}')
                 AND command_integer(task->'value'->'stage')
                 AND command_integer(task->'value'->'generation')
                 AND command_integer(task->'value'->'evaluator')))
           AND value->>'verdict' IN ('Pass', 'Fail')
           AND jsonb_typeof(value->'result') = 'object'
           AND command_integer(value->'result'->'manifest')
           AND command_integer(value->'result'->'digest')
           AND command_integer(value->'result'->'schema');
       END IF;
       IF tag = 'FinalizationResult' THEN
         RETURN jsonb_typeof(value) = 'object'
           AND command_integer(value->'ticket')
           AND value->>'out' IN ('FinalizationSucceeded',
             'FinalizationNeedsWork', 'FinalizationResultUnavailable');
       END IF;
       IF tag = 'ExecutionBlocked' THEN
         RETURN jsonb_typeof(value) = 'object'
           AND command_integer(value->'ticket');
       END IF;
       IF tag <> 'CreateTicket' OR jsonb_typeof(value) <> 'object'
          OR NOT command_integer(value->'ticket')
          OR jsonb_typeof(value->'deps') <> 'array'
          OR jsonb_typeof(value->'prog') <> 'array'
          OR value ? 'workFanout'
          OR COALESCE(value->>'finalizer', 'ManagedFinalizer') <> 'ManagedFinalizer' THEN
         RETURN false;
       END IF;
       IF (SELECT count(*) FROM jsonb_array_elements(value->'deps')) <>
          (SELECT count(DISTINCT element)
             FROM jsonb_array_elements(value->'deps') AS elements(element)) THEN
         RETURN false;
       END IF;
       FOR item IN SELECT element FROM jsonb_array_elements(value->'deps') AS elements(element) LOOP
         IF NOT command_integer(item) THEN RETURN false; END IF;
       END LOOP;
       FOR item IN SELECT element FROM jsonb_array_elements(value->'prog') AS elements(element) LOOP
         IF jsonb_typeof(item) <> 'object' OR NOT command_integer(item->'fanout')
            OR COALESCE(item->>'combinator', 'UnanimousPass') <> 'UnanimousPass' THEN
           RETURN false;
         END IF;
       END LOOP;
       RETURN true;
     END $$;`,
    `CREATE OR REPLACE FUNCTION public.submit_task_completion(in_tenant text, in_project text, in_execution text, in_ticket bigint, in_task bigint, in_source_effect integer, in_outcome text, in_manifest text, in_manifest_digest text, in_reason text, in_operation text, in_authority_subject text) RETURNS TABLE(result text, operation text, ordinal bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record; project_lifecycle text; project_generation bigint;
       next_ordinal bigint; command_value jsonb; command_tag text; identity jsonb;
     BEGIN
       IF in_outcome NOT IN ('Passed', 'Failed', 'Blocked') THEN
         RAISE EXCEPTION 'completion outcome % is not one this boundary submits', in_outcome
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       SELECT e.ticket, e.task, e.status, e.completion_operation, q.effect_position,
              r.manifest, r.digest, r.verdict, r.manifest_ordinal, r.schema_version,
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
       IF in_outcome = 'Blocked' THEN
         command_tag := 'ExecutionBlocked';
         command_value := jsonb_build_object('version', 1, 'command', 'Decide', 'event',
           jsonb_build_object('type', 'ExecutionBlocked', 'value',
             jsonb_build_object('ticket', bound.ticket)));
       ELSE
         IF bound.task_kind = 'Work' THEN
           identity := jsonb_build_object('type', '${workTaskTag}', 'value',
             jsonb_build_object('ticket', bound.ticket, '${workCycleField}', bound.cycle));
         ELSE
           identity := jsonb_build_object('type', '${evaluationTaskTag}', 'value',
             jsonb_build_object('ticket', bound.ticket, '${evaluationCycleField}', bound.cycle,
               'stage', bound.stage, 'generation', bound.generation,
               'evaluator', bound.evaluator));
         END IF;
         command_tag := 'TaskDone';
         command_value := jsonb_build_object('version', 1, 'command', 'Decide', 'event',
           jsonb_build_object('type', 'TaskDone', 'value',
             jsonb_build_object('ticket', bound.ticket, 'task', identity,
               'verdict', bound.verdict,
               'result', jsonb_build_object(
                 'manifest', bound.manifest_ordinal,
                 'digest', result_digest_fold(bound.digest),
                 'schema', bound.schema_version))));
       END IF;
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
          command_value::text, command_tag);
       INSERT INTO decision_input
         (tenant, project, ordinal, input_kind, input_id, base_priority, lifecycle_generation)
       VALUES (in_tenant, in_project, next_ordinal, 'Operation', in_operation,
          'Completion', project_generation);
       INSERT INTO project_readiness (tenant, project, ready, generation)
       VALUES (in_tenant, in_project, true, 1)
       ON CONFLICT (tenant, project) DO UPDATE
         SET ready = true, generation = project_readiness.generation + 1;
       UPDATE execution
          SET status = 'Terminal', outcome = in_outcome, blocked_reason = in_reason,
              result_manifest = in_manifest, completion_operation = in_operation,
              terminal_at = now()
        WHERE tenant = in_tenant AND project = in_project AND execution = in_execution;
       RETURN QUERY SELECT 'Submitted'::text, in_operation, next_ordinal;
     END $$;`,
  ],
};
