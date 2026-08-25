import {
  phaseTags,
  reasonTags,
} from "../../../../domain/generated/modelTypes.ts";
import {
  allNativeActionResolutions,
  nativeActionResolutions,
  safetyResolution,
} from "../../../../interpreter/ticketCommand.ts";
import {
  acceptanceFunction,
  apiRole,
  boundaryOwnerRole,
  cancellationFunction,
  continuationFunction,
  notificationPublishFunction,
  roleStatement,
  schemaTextSet,
  ticketServiceRole,
  type Migration,
} from "../shared.ts";
const acceptanceOrdinaryResolutions = allNativeActionResolutions.filter(
  (resolution) => resolution !== safetyResolution,
);

export const acceptanceBody = `FUNCTION ${acceptanceFunction}(
      in_tenant text, in_project text, in_operation text,
      in_authority_kind text, in_authority_subject text,
      in_key_version text, in_key_digest text, in_payload_digest text,
      in_retained_key_digests text[], in_retained_payload_digests text[],
      in_command text, in_ordinary_soft_limit bigint, in_hard_limit bigint)
     RETURNS TABLE(result text, operation text, ordinal bigint, state text,
       authority_kind text, admission text, lifecycle_generation bigint, lifecycle text)
     LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
     DECLARE project_lifecycle text; project_generation bigint; next_ordinal bigint;
       pending_total bigint; pending_ordinary bigint; existing record;
       command_value jsonb; command_tag text; priority text; admission_class text;
       action_id text; authorizing_sequence bigint; action_resolution text;
     BEGIN
       IF cardinality(in_retained_key_digests) <> cardinality(in_retained_payload_digests) THEN
         RAISE EXCEPTION 'idempotency digest arrays disagree';
       END IF;

       BEGIN
         command_value := in_command::jsonb;
       EXCEPTION WHEN others THEN
         RETURN QUERY SELECT 'InvalidCommand'::text, NULL::text, NULL::bigint,
           NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text;
         RETURN;
       END;
       IF ticket_command_is_valid(command_value) IS NOT TRUE THEN
         RETURN QUERY SELECT 'InvalidCommand'::text, NULL::text, NULL::bigint,
           NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text;
         RETURN;
       END IF;
       IF command_value->>'command' = 'Decide'
          AND jsonb_typeof(command_value->'event') = 'object' THEN
         command_tag := command_value->'event'->>'type';
       ELSIF command_value->>'command' = 'ReleaseDraft' THEN
         command_tag := 'ReleaseDraft';
       ELSIF command_value->>'command' = 'ResolveNativeAction'
          AND jsonb_typeof(command_value->'action') = 'string'
          AND length(command_value->>'action') BETWEEN 1 AND 256
          AND jsonb_typeof(command_value->'authorizingSeq') = 'number'
          AND (command_value->>'authorizingSeq') ~ '^[1-9][0-9]*$'
          AND command_value->>'resolution' IN (${schemaTextSet(allNativeActionResolutions)}) THEN
         command_tag := 'ResolveNativeAction';
         action_id := command_value->>'action';
         BEGIN
           authorizing_sequence := (command_value->>'authorizingSeq')::bigint;
         EXCEPTION WHEN numeric_value_out_of_range THEN
           RETURN QUERY SELECT 'InvalidCommand'::text, NULL::text, NULL::bigint,
             NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text;
           RETURN;
         END;
         action_resolution := command_value->>'resolution';
       ELSE
         RETURN QUERY SELECT 'InvalidCommand'::text, NULL::text, NULL::bigint,
           NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text;
         RETURN;
       END IF;

       IF command_tag = 'Revoke' OR
          (command_tag = 'ResolveNativeAction' AND action_resolution = '${safetyResolution}') THEN
         priority := 'Safety'; admission_class := 'CorrectnessReducing';
       ELSIF command_tag IN ('ReleaseDraft', 'Dispatch', 'ResumeTicket') OR
             (command_tag = 'ResolveNativeAction' AND action_resolution IN (${schemaTextSet(acceptanceOrdinaryResolutions)})) THEN
         priority := 'Ordinary'; admission_class := 'Ordinary';
       ELSE
         RETURN QUERY SELECT 'InvalidCommand'::text, NULL::text, NULL::bigint,
           NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text;
         RETURN;
       END IF;

       SELECT p.lifecycle, p.lifecycle_generation INTO STRICT project_lifecycle, project_generation
         FROM project p WHERE p.tenant=in_tenant AND p.project=in_project FOR UPDATE;

       SELECT o.operation, d.ordinal, d.state, o.authority_kind, o.admission,
              d.lifecycle_generation, offered.payload_digest AS offered_payload, o.payload_digest
         INTO existing
         FROM unnest(in_retained_key_digests, in_retained_payload_digests)
              AS offered(key_digest, payload_digest)
         JOIN operation o ON o.tenant=in_tenant AND o.project=in_project
              AND o.authority_kind=in_authority_kind AND o.key_digest=offered.key_digest
         JOIN decision_input d ON d.tenant=o.tenant AND d.project=o.project
              AND d.input_kind='Operation' AND d.input_id=o.operation
         ORDER BY (o.payload_digest = offered.payload_digest) DESC
         LIMIT 1;
       IF FOUND THEN
         IF existing.payload_digest IS DISTINCT FROM existing.offered_payload THEN
           RETURN QUERY SELECT 'IdempotencyConflict'::text, NULL::text, NULL::bigint,
             NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text;
         ELSE
           RETURN QUERY SELECT 'Original'::text, existing.operation::text,
             existing.ordinal::bigint, existing.state::text, existing.authority_kind::text,
             existing.admission::text, existing.lifecycle_generation::bigint, NULL::text;
         END IF;
         RETURN;
       END IF;

       IF command_tag='ResolveNativeAction' AND NOT EXISTS (
         SELECT 1 FROM native_action a JOIN native_action_resolution r
           USING (tenant, project, action)
          WHERE a.tenant=in_tenant AND a.project=in_project AND a.action=action_id
            AND a.state='Open' AND a.authorizing_seq=authorizing_sequence
            AND r.resolution=action_resolution FOR UPDATE OF a)
       THEN
         RETURN QUERY SELECT 'InvalidCommand'::text, NULL::text, NULL::bigint,
           NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text;
         RETURN;
       END IF;
       IF command_tag='ReleaseDraft' AND NOT EXISTS (
         SELECT 1 FROM draft_revision r
          WHERE r.tenant=in_tenant AND r.project=in_project
            AND r.ticket=(command_value->>'ticket')::bigint
            AND r.authoring_version=(command_value->>'authoringVersion')::bigint
            AND r.configuration_revision=command_value->>'configurationRevision')
       THEN
         RETURN QUERY SELECT 'InvalidCommand'::text, NULL::text, NULL::bigint,
           NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text;
         RETURN;
       END IF;

       SELECT count(*), count(*) FILTER (WHERE d.base_priority='Ordinary')
         INTO pending_total, pending_ordinary FROM decision_input d
        WHERE d.tenant=in_tenant AND d.project=in_project AND d.state='Pending';
       IF pending_total >= in_hard_limit THEN
         RETURN QUERY SELECT 'Unavailable'::text, NULL::text, NULL::bigint,
           NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text;
         RETURN;
       END IF;
       IF priority='Ordinary' AND pending_ordinary >= in_ordinary_soft_limit THEN
         RETURN QUERY SELECT 'Backpressure'::text, NULL::text, NULL::bigint,
           NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text;
         RETURN;
       END IF;
       IF NOT (project_lifecycle = 'Active' OR
          (admission_class = 'CorrectnessReducing' AND
           project_lifecycle IN ('Suspended', 'IntegrityBlocked', 'Deleting'))) THEN
         RETURN QUERY SELECT 'NotAdmitted'::text, NULL::text, NULL::bigint,
           NULL::text, NULL::text, NULL::text, NULL::bigint, project_lifecycle;
         RETURN;
       END IF;

       UPDATE project p SET ingress_next=p.ingress_next+1
        WHERE p.tenant=in_tenant AND p.project=in_project
        RETURNING p.ingress_next-1 INTO next_ordinal;
       INSERT INTO operation
         (tenant, project, operation, authority_kind, authority_subject, admission,
          key_version, key_digest, payload_digest, command, command_tag)
       VALUES (in_tenant, in_project, in_operation, in_authority_kind, in_authority_subject,
          admission_class, in_key_version, in_key_digest, in_payload_digest, in_command, command_tag);
       INSERT INTO decision_input (tenant, project, ordinal, input_kind, input_id, base_priority, lifecycle_generation)
       VALUES (in_tenant, in_project, next_ordinal, 'Operation', in_operation, priority, project_generation);
       INSERT INTO project_readiness (tenant, project, ready, generation)
       VALUES (in_tenant, in_project, true, 1)
       ON CONFLICT (tenant, project) DO UPDATE
         SET ready=true, generation=project_readiness.generation+1;
       RETURN QUERY SELECT 'Accepted'::text, in_operation, next_ordinal, 'Pending'::text,
         in_authority_kind, admission_class, project_generation, NULL::text;
     END $$`;

/**
 * The public command grammar's body, installed by the migration that wrote it
 * and reinstalled under its later name by the one that widened the answers a
 * resolution may carry. There is one body, so the two cannot become two grammars.
 */
export const publicCommandGrammarBody = `(command jsonb) RETURNS boolean
     LANGUAGE plpgsql IMMUTABLE AS $$
     BEGIN
       IF command IS NULL OR jsonb_typeof(command) <> 'object'
          OR jsonb_typeof(command->'version') <> 'number'
          OR command->>'version' <> '1' THEN
         RETURN false;
       END IF;
       IF command->>'command' = 'Decide' THEN
         RETURN decision_event_is_valid(command->'event')
           AND command->'event'->>'type' <> 'ReleaseTicket';
       END IF;
       IF command->>'command' = 'ReleaseDraft' THEN
         RETURN command_integer(command->'ticket') AND (command->>'ticket')::numeric >= 1
           AND command_integer(command->'authoringVersion') AND (command->>'authoringVersion')::numeric >= 1
           AND jsonb_typeof(command->'configurationRevision')='string'
           AND length(command->>'configurationRevision') BETWEEN 1 AND 256;
       END IF;
       RETURN command->>'command' = 'ResolveNativeAction'
         AND jsonb_typeof(command->'action') = 'string'
         AND length(command->>'action') BETWEEN 1 AND 256
         AND command_integer(command->'authorizingSeq')
         AND (command->>'authorizingSeq')::numeric >= 1
         AND command->>'resolution' IN (${schemaTextSet(allNativeActionResolutions)});
     END $$`;
/** I3 replaces the operation-only inbox with one typed, prioritized decision-input authority. */
const durableMailbox = [
  roleStatement(boundaryOwnerRole),
  roleStatement(ticketServiceRole),
  `CREATE FUNCTION command_integer(value jsonb) RETURNS boolean
     LANGUAGE plpgsql IMMUTABLE AS $$
     BEGIN
       IF value IS NULL OR jsonb_typeof(value) <> 'number'
          OR value::text !~ '^-?(0|[1-9][0-9]*)$' THEN
         RETURN false;
       END IF;
       RETURN value::text::numeric BETWEEN -9007199254740991 AND 9007199254740991;
     EXCEPTION WHEN numeric_value_out_of_range THEN
       RETURN false;
     END $$`,
  `CREATE FUNCTION decision_event_is_valid(event jsonb) RETURNS boolean
     LANGUAGE plpgsql IMMUTABLE AS $$
     DECLARE tag text; value jsonb; item jsonb;
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
         RETURN jsonb_typeof(value) = 'object'
           AND command_integer(value->'ticket') AND command_integer(value->'tid')
           AND value->>'verdict' IN ('Pass', 'Fail')
           AND jsonb_typeof(value->'result') = 'object'
           AND command_integer(value->'result'->'manifest')
           AND command_integer(value->'result'->'digest')
           AND command_integer(value->'result'->'schema');
       END IF;
       IF tag = 'FinalizationResult' THEN
         RETURN jsonb_typeof(value) = 'object'
           AND command_integer(value->'ticket')
           AND value->>'out' IN ('FinalizationSucceeded', 'FinalizationFailed');
       END IF;
       IF tag = 'ExecutionBlocked' THEN
         RETURN jsonb_typeof(value) = 'object'
           AND command_integer(value->'ticket')
           AND value->>'reason' IN ('NoReason', 'WorkFailed', 'ReworkBudgetExhausted',
             'FinalizationBudgetExhausted', 'GasExhausted', 'DependencyRevoked',
             'ExecutionPolicyDenied', 'TicketConfigIncompatible',
             'ExecutionProfileUnavailable', 'RuntimeVersionUnsupported',
             'RequiredCapabilityUnavailable');
       END IF;
       IF tag <> 'ReleaseTicket' OR jsonb_typeof(value) <> 'object'
          OR NOT command_integer(value->'ticket')
          OR jsonb_typeof(value->'deps') <> 'array'
          OR jsonb_typeof(value->'prog') <> 'array'
          OR NOT command_integer(value->'workFanout')
          OR jsonb_typeof(value->'reworkPolicy') <> 'object'
          OR value->'reworkPolicy'->>'type' <> 'BudgetedRework'
          OR NOT command_integer(value->'reworkPolicy'->'value')
          OR value->>'resumePricing' NOT IN ('RetryCharged', 'RetryFree')
          OR value->>'finalizer' NOT IN ('NoFinalizer', 'ManagedFinalizer') THEN
         RETURN false;
       END IF;
       IF NOT (value->'finalizationPricing' = '"DeadlineOnly"'::jsonb OR
          (jsonb_typeof(value->'finalizationPricing') = 'object'
           AND value->'finalizationPricing'->>'type' = 'Budgeted'
           AND command_integer(value->'finalizationPricing'->'value'))) THEN
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
            OR item->>'combinator' NOT IN ('UnanimousPass', 'AnyPass') THEN
           RETURN false;
         END IF;
       END LOOP;
       RETURN true;
     END $$`,
  `CREATE FUNCTION ticket_command_is_valid${publicCommandGrammarBody}`,
  `CREATE FUNCTION legacy_event(command text) RETURNS jsonb
     LANGUAGE plpgsql IMMUTABLE AS $$
     BEGIN
       RETURN command::jsonb;
     EXCEPTION WHEN others THEN
       RETURN NULL;
     END $$`,
  `ALTER FUNCTION command_integer(jsonb) OWNER TO ${boundaryOwnerRole}`,
  `ALTER FUNCTION decision_event_is_valid(jsonb) OWNER TO ${boundaryOwnerRole}`,
  `ALTER FUNCTION ticket_command_is_valid(jsonb) OWNER TO ${boundaryOwnerRole}`,
  `ALTER FUNCTION legacy_event(text) OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION command_integer(jsonb) FROM PUBLIC`,
  `REVOKE ALL ON FUNCTION decision_event_is_valid(jsonb) FROM PUBLIC`,
  `REVOKE ALL ON FUNCTION ticket_command_is_valid(jsonb) FROM PUBLIC`,
  `REVOKE ALL ON FUNCTION legacy_event(text) FROM PUBLIC`,
  `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${ticketServiceRole}`,
  `REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM ${ticketServiceRole}`,
  `GRANT SELECT ON recovery_epoch, project, journal_entry, operation,
     project_readiness, ticket_projection TO ${ticketServiceRole}`,
  `GRANT UPDATE (head, owner, lease_expires_at, recovery_epoch, fencing_epoch, ingress_next)
     ON project TO ${ticketServiceRole}`,
  `GRANT INSERT ON journal_entry, ticket_projection TO ${ticketServiceRole}`,
  `GRANT UPDATE (ready) ON project_readiness TO ${ticketServiceRole}`,
  `GRANT UPDATE (phase, seq) ON ticket_projection TO ${ticketServiceRole}`,
  `ALTER ROLE ${boundaryOwnerRole} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
  `GRANT ${boundaryOwnerRole} TO CURRENT_USER`,
  `GRANT USAGE, CREATE ON SCHEMA public TO ${boundaryOwnerRole}`,
  `CREATE TABLE decision_input (
     tenant text NOT NULL, project text NOT NULL, ordinal bigint NOT NULL,
     input_kind text NOT NULL, input_id text NOT NULL,
     base_priority text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
     lifecycle_generation bigint NOT NULL, state text NOT NULL DEFAULT 'Pending',
     decided_seq bigint, outcome_code text, refused_head bigint,
     refused_lifecycle_generation bigint, terminal_at timestamptz,
     settled_authority_kind text, settled_authority_subject text,
     PRIMARY KEY (tenant, project, ordinal),
     CONSTRAINT decision_input_identity_is_unique UNIQUE (tenant, project, input_kind, input_id),
     CONSTRAINT decision_input_decision_tuple_is_unique UNIQUE (tenant, project, input_kind, input_id, decided_seq),
     CONSTRAINT decision_input_belongs_to_project FOREIGN KEY (tenant, project) REFERENCES project (tenant, project),
     CONSTRAINT decision_input_ordinal_is_positive CHECK (ordinal >= 1 AND lifecycle_generation >= 1),
     CONSTRAINT decision_input_kind_is_known CHECK (input_kind IN ('Operation', 'Continuation')),
     CONSTRAINT decision_input_priority_is_known CHECK (base_priority IN ('Safety', 'Completion', 'Continuation', 'Ordinary')),
     CONSTRAINT decision_input_state_is_known CHECK (state IN ('Pending', 'Journaled', 'Refused', 'Cancelled', 'Stale')),
     CONSTRAINT decision_input_kind_state_agree CHECK (
       (input_kind = 'Operation' AND state IN ('Pending', 'Journaled', 'Refused', 'Cancelled')) OR
       (input_kind = 'Continuation' AND state IN ('Pending', 'Journaled', 'Stale'))),
     CONSTRAINT decision_input_outcome_is_whole CHECK (
       (state = 'Journaled') = (decided_seq IS NOT NULL) AND
       (state = 'Refused') = (outcome_code IS NOT NULL) AND
       (state = 'Refused') = (refused_head IS NOT NULL) AND
       (state = 'Refused') = (refused_lifecycle_generation IS NOT NULL) AND
       (state IN ('Pending')) = (terminal_at IS NULL) AND
       (settled_authority_kind IS NULL) = (settled_authority_subject IS NULL) AND
       coalesce(decided_seq, 1) >= 1)
   )`,
  `DROP TRIGGER operation_outcome_is_decided_once ON operation`,
  `DROP FUNCTION operation_stays_terminal()`,
  `ALTER TABLE operation DROP CONSTRAINT operation_outcome_code_is_known`,
  `UPDATE operation o
      SET state='Refused', settled_at=now(),
          settled_authority_kind='ProjectTicketWriter',
          settled_authority_subject='I3Migration', outcome_code='CommandUnreadable',
          refused_head=p.head, refused_lifecycle_generation=o.lifecycle_generation
     FROM project p
    WHERE p.tenant=o.tenant AND p.project=o.project AND o.state='Pending'
      AND decision_event_is_valid(legacy_event(o.command)) IS NOT TRUE`,
  `UPDATE inbox_item i SET consumable=false
     FROM operation o
    WHERE o.tenant=i.tenant AND o.project=i.project AND o.operation=i.operation
      AND o.state='Refused'`,
  `UPDATE operation
      SET command = jsonb_build_object(
        'version', 1, 'command', 'Decide', 'event', legacy_event(command)
      )::text
    WHERE decision_event_is_valid(legacy_event(command))`,
  `INSERT INTO decision_input
     (tenant, project, ordinal, input_kind, input_id, base_priority, created_at,
      lifecycle_generation, state, decided_seq, outcome_code, refused_head,
      refused_lifecycle_generation, terminal_at, settled_authority_kind, settled_authority_subject)
   SELECT o.tenant, o.project, i.ordinal, 'Operation', o.operation,
          CASE
            WHEN legacy_event(o.command)->'event'->>'type' = 'Revoke' THEN 'Safety'
            WHEN legacy_event(o.command)->'event'->>'type' IN ('TaskDone', 'ExecutionBlocked', 'FinalizationResult') THEN 'Completion'
            ELSE 'Ordinary' END,
          o.accepted_at, o.lifecycle_generation,
          CASE o.state WHEN 'Succeeded' THEN 'Journaled' ELSE o.state END,
          o.decided_seq, o.outcome_code, o.refused_head, o.refused_lifecycle_generation,
          o.settled_at, o.settled_authority_kind, o.settled_authority_subject
     FROM operation o JOIN inbox_item i USING (tenant, project, operation)`,
  `DO $$ BEGIN
     IF (SELECT count(*) FROM operation) <> (SELECT count(*) FROM decision_input WHERE input_kind = 'Operation')
     THEN RAISE EXCEPTION 'I3 operation input backfill lost rows'; END IF;
   END $$`,
  `ALTER TABLE journal_entry ADD COLUMN cause_kind text, ADD COLUMN cause_id text`,
  `UPDATE journal_entry SET cause_kind = 'Operation', cause_id = cause_operation`,
  `ALTER TABLE journal_entry ALTER COLUMN cause_kind SET NOT NULL, ALTER COLUMN cause_id SET NOT NULL`,
  `ALTER TABLE journal_entry DROP CONSTRAINT journal_entry_cause_is_effective,
     DROP CONSTRAINT journal_entry_has_its_cause,
     ADD CONSTRAINT journal_entry_cause_is_effective UNIQUE (tenant, project, cause_kind, cause_id),
     ADD CONSTRAINT journal_entry_input_sequence_is_unique
       UNIQUE (tenant, project, cause_kind, cause_id, seq),
     ADD CONSTRAINT journal_entry_has_its_input
       FOREIGN KEY (tenant, project, cause_kind, cause_id, seq)
       REFERENCES decision_input (tenant, project, input_kind, input_id, decided_seq)
       DEFERRABLE INITIALLY DEFERRED`,
  `ALTER TABLE decision_input ADD CONSTRAINT decision_input_has_its_entry
       FOREIGN KEY (tenant, project, input_kind, input_id, decided_seq)
       REFERENCES journal_entry (tenant, project, cause_kind, cause_id, seq)
       DEFERRABLE INITIALLY DEFERRED`,
  `ALTER TABLE journal_entry DROP COLUMN cause_operation`,
  `ALTER TABLE operation ADD COLUMN command_tag text`,
  `UPDATE operation SET command_tag = CASE
       WHEN ticket_command_is_valid(legacy_event(command))
       THEN legacy_event(command)->'event'->>'type'
       ELSE 'LegacyUnreadable' END`,
  `ALTER TABLE operation ALTER COLUMN command_tag SET NOT NULL`,
  `GRANT INSERT (command_tag) ON operation TO ${apiRole}`,
  `ALTER TABLE operation DROP CONSTRAINT operation_outcome_is_whole,
     DROP CONSTRAINT operation_state_is_known,
     DROP CONSTRAINT operation_settlement_is_whole,
     DROP COLUMN state, DROP COLUMN lifecycle_generation, DROP COLUMN settled_at,
     DROP COLUMN settled_authority_kind, DROP COLUMN settled_authority_subject,
     DROP COLUMN outcome_code, DROP COLUMN decided_seq, DROP COLUMN refused_head,
     DROP COLUMN refused_lifecycle_generation`,
  `DROP TABLE inbox_item`,
  `CREATE INDEX decision_input_safety_head ON decision_input (tenant, project, ordinal) WHERE state = 'Pending' AND base_priority = 'Safety'`,
  `CREATE INDEX decision_input_completion_head ON decision_input (tenant, project, ordinal) WHERE state = 'Pending' AND base_priority = 'Completion'`,
  `CREATE INDEX decision_input_continuation_head ON decision_input (tenant, project, ordinal) WHERE state = 'Pending' AND base_priority = 'Continuation'`,
  `CREATE INDEX decision_input_ordinary_head ON decision_input (tenant, project, ordinal) WHERE state = 'Pending' AND base_priority = 'Ordinary'`,
  `CREATE TABLE project_continuation (
     tenant text NOT NULL, project text NOT NULL, continuation text NOT NULL,
     kind text NOT NULL, authorizing_seq bigint NOT NULL, effect_position integer NOT NULL,
     ticket bigint NOT NULL, expected_ticket_version bigint NOT NULL,
     expected_phase text NOT NULL, task_set_generation bigint NOT NULL,
     PRIMARY KEY (tenant, project, continuation),
     UNIQUE (tenant, project, authorizing_seq, effect_position, kind),
     FOREIGN KEY (tenant, project, authorizing_seq) REFERENCES journal_entry (tenant, project, seq),
     CHECK (kind IN ('ReduceWork', 'ReduceEvaluation')),
     CHECK (authorizing_seq >= 1 AND effect_position >= 0 AND ticket >= 1 AND expected_ticket_version >= 1 AND task_set_generation >= 1),
     CHECK (expected_phase IN (${schemaTextSet(phaseTags)}))
   )`,
  `CREATE TABLE native_action (
     tenant text NOT NULL, project text NOT NULL, action text NOT NULL,
     authorizing_seq bigint NOT NULL, effect_position integer NOT NULL,
     ticket bigint NOT NULL, action_version bigint NOT NULL, kind text NOT NULL,
     reason text NOT NULL, required_capability text NOT NULL,
     state text NOT NULL DEFAULT 'Open',
     PRIMARY KEY (tenant, project, action),
     UNIQUE (tenant, project, authorizing_seq, effect_position),
     FOREIGN KEY (tenant, project, authorizing_seq) REFERENCES journal_entry (tenant, project, seq),
     CHECK (state IN ('Open', 'Resolved', 'Withdrawn')),
     CHECK (kind = 'TicketEscalation'),
     CHECK (required_capability = 'ResolveTicket'),
     CHECK (reason IN (${schemaTextSet(reasonTags)})),
     CHECK (authorizing_seq >= 1 AND effect_position >= 0 AND ticket >= 1 AND action_version = authorizing_seq)
   )`,
  `CREATE UNIQUE INDEX native_action_one_open ON native_action (tenant, project, ticket) WHERE state = 'Open'`,
  `CREATE TABLE native_action_resolution (
     tenant text NOT NULL, project text NOT NULL, action text NOT NULL, resolution text NOT NULL,
     PRIMARY KEY (tenant, project, action, resolution),
     FOREIGN KEY (tenant, project, action) REFERENCES native_action (tenant, project, action)
     ,CHECK (resolution IN (${schemaTextSet(nativeActionResolutions.TicketEscalation)}))
   )`,
  `CREATE TABLE execution_request (
     tenant text NOT NULL, project text NOT NULL, request text NOT NULL,
     authorizing_seq bigint NOT NULL, effect_position integer NOT NULL,
     ticket bigint NOT NULL, ticket_version bigint NOT NULL, kind text NOT NULL,
     state text NOT NULL DEFAULT 'Open', claim_owner text, claim_generation bigint NOT NULL DEFAULT 0,
     claim_expires_at timestamptz,
     PRIMARY KEY (tenant, project, request),
     UNIQUE (tenant, project, authorizing_seq, effect_position, kind),
     FOREIGN KEY (tenant, project, authorizing_seq) REFERENCES journal_entry (tenant, project, seq),
     CHECK (kind IN ('SpawnWork', 'SpawnEvaluation', 'CancelTicketWork')),
     CHECK (state IN ('Open', 'Registered', 'Fulfilled', 'Invalidated')),
     CHECK ((claim_owner IS NULL) = (claim_expires_at IS NULL)),
     CHECK (authorizing_seq >= 1 AND effect_position >= 0 AND ticket >= 1 AND ticket_version = authorizing_seq AND claim_generation >= 0)
   )`,
  `CREATE TABLE execution_request_task (
     tenant text NOT NULL, project text NOT NULL, request text NOT NULL,
     task bigint NOT NULL, kind text NOT NULL, stage bigint,
     PRIMARY KEY (tenant, project, request, task),
     FOREIGN KEY (tenant, project, request) REFERENCES execution_request (tenant, project, request),
     CHECK (kind IN ('Work', 'Evaluation')),
     CHECK ((kind = 'Work' AND stage IS NULL) OR (kind = 'Evaluation' AND stage IS NOT NULL AND stage >= 0)),
     CHECK (task >= 1)
   )`,
  `CREATE TABLE finalization_request (
     tenant text NOT NULL, project text NOT NULL, request text NOT NULL,
     authorizing_seq bigint NOT NULL, effect_position integer NOT NULL,
     ticket bigint NOT NULL, ticket_version bigint NOT NULL, request_generation bigint NOT NULL,
     state text NOT NULL DEFAULT 'Open', claim_owner text, claim_generation bigint NOT NULL DEFAULT 0,
     claim_expires_at timestamptz,
     PRIMARY KEY (tenant, project, request),
     UNIQUE (tenant, project, authorizing_seq, effect_position),
     FOREIGN KEY (tenant, project, authorizing_seq) REFERENCES journal_entry (tenant, project, seq),
     CHECK (state IN ('Open', 'Registered', 'Fulfilled', 'Invalidated')),
     CHECK ((claim_owner IS NULL) = (claim_expires_at IS NULL)),
     CHECK (authorizing_seq >= 1 AND effect_position >= 0 AND ticket >= 1 AND ticket_version = authorizing_seq AND request_generation >= 1 AND claim_generation >= 0)
   )`,
  `CREATE UNIQUE INDEX finalization_request_one_open ON finalization_request (tenant, project, ticket) WHERE state = 'Open'`,
  `CREATE ${acceptanceBody}`,
  `CREATE FUNCTION ${continuationFunction}(in_tenant text, in_project text, in_ordinal bigint,
      in_continuation text) RETURNS void
     LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
     BEGIN
       INSERT INTO decision_input (tenant, project, ordinal, input_kind, input_id, base_priority, lifecycle_generation)
       SELECT in_tenant, in_project, in_ordinal, 'Continuation', in_continuation, 'Continuation', lifecycle_generation
         FROM project WHERE tenant=in_tenant AND project=in_project;
       INSERT INTO project_readiness (tenant, project, ready, generation)
       VALUES (in_tenant, in_project, true, 1)
       ON CONFLICT (tenant, project) DO UPDATE
         SET ready=true, generation=project_readiness.generation+1;
     END $$`,
  `CREATE OR REPLACE FUNCTION ${cancellationFunction}(
     in_tenant text, in_project text, in_operation text,
     in_authority_kind text, in_authority_subject text) RETURNS text
     LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
     DECLARE locked_state text;
     BEGIN
       SELECT state INTO locked_state FROM decision_input
        WHERE tenant=in_tenant AND project=in_project AND input_kind='Operation' AND input_id=in_operation FOR UPDATE;
       IF NOT FOUND THEN RETURN NULL; END IF;
       IF locked_state <> 'Pending' THEN RETURN CASE locked_state WHEN 'Journaled' THEN 'Succeeded' ELSE locked_state END; END IF;
       UPDATE decision_input SET state='Cancelled', terminal_at=now(),
         settled_authority_kind=in_authority_kind, settled_authority_subject=in_authority_subject
        WHERE tenant=in_tenant AND project=in_project AND input_kind='Operation' AND input_id=in_operation;
       PERFORM ${notificationPublishFunction}(in_tenant,in_project,'Operation',in_operation,NULL,NULL);
       RETURN locked_state;
     END $$`,
  `ALTER FUNCTION ${acceptanceFunction}(text,text,text,text,text,text,text,text,text[],text[],text,bigint,bigint) OWNER TO ${boundaryOwnerRole}`,
  `ALTER FUNCTION ${continuationFunction}(text,text,bigint,text) OWNER TO ${boundaryOwnerRole}`,
  `ALTER FUNCTION ${cancellationFunction}(text,text,text,text,text) OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${acceptanceFunction}(text,text,text,text,text,text,text,text,text[],text[],text,bigint,bigint) FROM PUBLIC`,
  `REVOKE ALL ON FUNCTION ${continuationFunction}(text,text,bigint,text) FROM PUBLIC`,
  `REVOKE ALL ON FUNCTION ${cancellationFunction}(text,text,text,text,text) FROM PUBLIC`,
  `GRANT SELECT, INSERT ON operation, decision_input, project, project_readiness,
     native_action, native_action_resolution TO ${boundaryOwnerRole}`,
  `GRANT UPDATE (ingress_next) ON project TO ${boundaryOwnerRole}`,
  `GRANT UPDATE (ready, generation) ON project_readiness TO ${boundaryOwnerRole}`,
  `GRANT UPDATE (state) ON native_action TO ${boundaryOwnerRole}`,
  `GRANT USAGE ON SCHEMA public TO ${boundaryOwnerRole}`,
  `GRANT UPDATE (state, terminal_at, settled_authority_kind, settled_authority_subject) ON decision_input TO ${boundaryOwnerRole}`,
  `GRANT EXECUTE ON FUNCTION ${acceptanceFunction}(text,text,text,text,text,text,text,text,text[],text[],text,bigint,bigint) TO ${apiRole}`,
  `GRANT EXECUTE ON FUNCTION ${continuationFunction}(text,text,bigint,text) TO ${ticketServiceRole}`,
  `GRANT EXECUTE ON FUNCTION ${cancellationFunction}(text,text,text,text,text) TO ${apiRole}`,
  `REVOKE INSERT ON decision_input FROM ${apiRole}, ${ticketServiceRole}`,
  `REVOKE INSERT ON operation FROM ${apiRole}`,
  `REVOKE UPDATE (ingress_next) ON project FROM ${apiRole}`,
  `REVOKE INSERT, UPDATE ON project_readiness FROM ${apiRole}`,
  `GRANT SELECT ON decision_input, project_continuation, native_action, native_action_resolution,
     execution_request, execution_request_task, finalization_request TO ${ticketServiceRole}`,
  `GRANT UPDATE (state, decided_seq, outcome_code, refused_head, refused_lifecycle_generation,
     terminal_at, settled_authority_kind, settled_authority_subject) ON decision_input TO ${ticketServiceRole}`,
  `GRANT INSERT ON native_action, native_action_resolution, execution_request,
     execution_request_task, finalization_request, project_continuation TO ${ticketServiceRole}`,
  `GRANT UPDATE (state) ON native_action TO ${ticketServiceRole}`,
  `GRANT UPDATE (state) ON finalization_request TO ${ticketServiceRole}`,
  `REVOKE CREATE ON SCHEMA public FROM ${boundaryOwnerRole}`,
  `REVOKE ${boundaryOwnerRole} FROM CURRENT_USER`,
];

export const migration005: Migration = {
  version: 5,
  name: "the durable prioritized decision mailbox",
  statements: [...durableMailbox],
};
