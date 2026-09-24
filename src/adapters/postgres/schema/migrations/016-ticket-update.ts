import {
  apiRole,
  boundaryOwnerRole,
  sourceUnrecordedResult,
  ticketServiceRole,
  workResultUnrecordedResult,
  type Migration,
} from "../shared.ts";

/**
 * A ticket still waiting to be dispatched can be edited, and the edit reaches
 * the journal as a revision of the ticket. The draft stays the one editor: a
 * released draft whose ticket is `Pending` takes revisions again, at the
 * dependencies it was released with, and releasing it again is an update the
 * machine decides — `UpdateTicket` in the inbox's grammar, `TicketUpdated` in
 * the journal's.
 *
 * NO GUARD, BECAUSE NOTHING STORED MOVES. Every arm this adds is a new arm:
 * the validators admit every row 015 admitted, the projection's revision
 * arrives at the one every stored ticket is at, and the draft's released
 * version is the version a released draft is at, since until now nothing could
 * revise one.
 *
 * `TicketUpdated` NAMES ITS TICKET TWICE, AND THEY AGREE. The definition is a
 * released ticket, weighed as a release's, and it names itself; an update
 * journalled under one number about a definition naming another is a pair the
 * machine refuses before it journals. The revision starts past the one a
 * release makes. `UpdateTicket` in the grammar carries the revision it expects
 * and admits a definition naming another ticket, because that is a refusal the
 * machine decides and stores with its payload.
 *
 * THE UPDATE ARRIVES AS ITS OWN ENVELOPE. A principal offers it the way it
 * offers a release — the ticket, the authoring version and configuration
 * revision the draft was revised to — plus the revision it expects, so it is
 * admitted, classified ordinary and checked against a stored draft revision as
 * `ReleaseDraft` is, and no `Decide` may carry the ticket command. The authority
 * check has no arm for either envelope and gains none.
 *
 * THE DRAFT REMEMBERS WHICH OF ITS VERSIONS IS LIVE. `released_authoring_version`
 * is written by the fence that commits a release or an update, so the version
 * the ticket runs at and the version the draft holds are both on the row. An
 * update is fenced by `update_draft_fenced`, on the same three values as a
 * release but on a released draft; whether the ticket may still be updated is
 * the machine's to answer.
 *
 * `revise_draft` IS REWRITTEN WHOLE for the door that reopens. A released draft
 * is revisable while its ticket's projection says `Pending`; a revision there
 * that moves the dependencies answers `DependenciesLocked`, so the draft never
 * holds authoring its ticket's update must refuse; past `Pending` it answers
 * `NotDraft` as before. Its signature does not move.
 *
 * `submit_task_completion` IS REWRITTEN WHOLE, because the definition a task
 * runs at is its ticket's latest: the door reads the definition off the last
 * release or update journalled for the ticket rather than off the release. It
 * orders them by the sequence the entry carries, which is the one the journal's
 * check holds it to, because the columns it may read are the entry's.
 *
 * AND `ticket_definition` IS WRITTEN AGAIN BY AN UPDATE, which re-resolves the
 * definition in the transaction that journals it.
 */

/** The ticket command and the journal's event an update is, as the codec spells them. */
const updateTag = "UpdateTicket";
const updatedTag = "TicketUpdated";

/** The envelope a principal offers an update under. */
const updateEnvelope = "UpdateTicket";

/** The fields an update carries, as the codec spells them. */
const expectedRevisionField = "expectedRevision";
const revisionField = "revision";
const definitionField = "definition";

/** The tags a ticket command is at, which 015 named. */
const createTag = "CreateTicket";
const dispatchTag = "DispatchTicket";
const revokeTag = "RevokeTicket";
const resumeTag = "ResumeTicket";
const reportTag = "ReportTaskTerminal";
const finalizationTag = "ReportFinalizationResult";

/** The field of a `Decide` envelope the ticket command is under. */
const decideField = "ticketCommand";

/** The journal's tags, which 014 and 015 named. */
const createdTag = "TicketCreated";
const dispatchedTag = "TicketDispatched";
const revokedTag = "TicketRevoked";
const workResumedTag = "TicketWorkResumed";
const evaluationResumedTag = "TicketEvaluationResumed";
const finalizationResumedTag = "TicketFinalizationResumed";
const workAcceptedTag = "TicketWorkResultAccepted";
const workFailedTag = "TicketWorkProcessFailed";
const workUnavailableTag = "TicketWorkExecutionUnavailable";
const evaluationProgressedTag = "TicketEvaluationProgressed";
const evaluationPassedTag = "TicketEvaluationPassed";
const evaluationBlockedTag = "TicketEvaluationBlocked";
const reworkStartedTag = "TicketEvaluationReworkStarted";
const failureEscalatedTag = "TicketEvaluationFailureEscalated";
const finalizationSucceededTag = "TicketFinalizationSucceeded";
const finalizationNeedsWorkTag = "TicketFinalizationNeedsWork";
const finalizationUnavailableTag = "TicketFinalizationUnavailable";

/** The arms of a finalization result. */
const finalizationResults = [
  "FinalizationSucceeded",
  "FinalizationNeedsWork",
  "FinalizationResultUnavailable",
];

/** The fields those records carry, as the codec spells them. */
const ticketField = "ticket";
const sourceField = "source";
const resultField = "result";
const acceptedSourceField = "acceptedSourceRef";
const taskField = "task";
const evidenceField = "evidence";
const reportField = "report";
const failureField = "failure";
const workCycleField = "workCycle";
const generationField = "generation";
const reworkEvaluatorField = "evaluator";
const resultReferenceField = "resultRef";
const obligationField = "obligation";
const obligationDefinitionField = "definition";
const obligationContextField = "contextRef";

/** The released ticket's fields the door reads, which 013 named. */
const releasedIdField = "id";
const releasedWorkField = "workConfiguration";
const releasedPlanField = "evaluationPlan";
const releasedStagesField = "stages";
const stageKeyField = "key";
const stageEvaluatorsField = "evaluators";
const evaluatorKeyField = "key";
const evaluatorTaskField = "task";

/** The field of a draft's authoring its dependencies are under. */
const authoringDependenciesField = "dependencies";

/** The predicates 013–015 stated. */
const referencePredicate = "command_reference";
const releasedPredicate = "released_ticket_is_valid";
const identityPredicate = "task_identity_is_valid";
const validatedResultPredicate = "validated_task_result_is_valid";
const reportPredicate = "task_report_is_valid";
const commandValidator = "decision_command_is_valid";

/** The fence an update commits through, beside the release's. */
const updateFence = "update_draft_fenced";
const fenceSignature = `(in_tenant text, in_project text, in_ticket bigint, in_expected bigint, in_configuration text, in_digest text, in_commit boolean)`;

function textList(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(", ");
}

export const migration016: Migration = {
  version: 16,
  name: "a pending ticket takes an update, and its draft reopens for one",
  statements: [
    `CREATE OR REPLACE FUNCTION public.decision_event_is_valid(event jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
     DECLARE tag text; value jsonb; item jsonb;
     BEGIN
       IF event IS NULL OR jsonb_typeof(event) <> 'object'
          OR jsonb_typeof(event->'type') IS DISTINCT FROM 'string' THEN
         RETURN false;
       END IF;
       tag := event->>'type'; value := event->'value';
       IF tag = '${createdTag}' THEN
         RETURN ${releasedPredicate}(value);
       END IF;
       IF tag IN ('${revokedTag}', '${workResumedTag}', '${evaluationResumedTag}',
                  '${finalizationResumedTag}') THEN
         RETURN ${referencePredicate}(value);
       END IF;
       IF jsonb_typeof(value) IS DISTINCT FROM 'object'
          OR NOT ${referencePredicate}(value->'${ticketField}') THEN
         RETURN false;
       END IF;
       IF tag = '${updatedTag}' THEN
         RETURN ${referencePredicate}(value->'${revisionField}')
           AND value->'${revisionField}' > to_jsonb(1)
           AND ${releasedPredicate}(value->'${definitionField}')
           AND value->'${definitionField}'->'${releasedIdField}' = value->'${ticketField}';
       END IF;
       IF tag = '${dispatchedTag}' THEN
         RETURN ${referencePredicate}(value->'${sourceField}');
       END IF;
       IF tag = '${workAcceptedTag}' THEN
         RETURN ${validatedResultPredicate}(value->'${resultField}')
           AND ${referencePredicate}(value->'${acceptedSourceField}');
       END IF;
       IF tag IN ('${workFailedTag}', '${workUnavailableTag}') THEN
         RETURN ${identityPredicate}(value->'${taskField}')
           AND ${referencePredicate}(value->'${evidenceField}');
       END IF;
       IF tag IN ('${evaluationProgressedTag}', '${evaluationPassedTag}',
                  '${evaluationBlockedTag}', '${reworkStartedTag}',
                  '${failureEscalatedTag}')
          AND (NOT ${reportPredicate}(value->'${reportField}')
               OR value->'${reportField}'->'value'->'${ticketField}'
                  IS DISTINCT FROM value->'${ticketField}') THEN
         RETURN false;
       END IF;
       IF tag IN ('${evaluationProgressedTag}', '${evaluationPassedTag}',
                  '${evaluationBlockedTag}') THEN
         RETURN true;
       END IF;
       IF tag IN ('${reworkStartedTag}', '${failureEscalatedTag}') THEN
         IF jsonb_typeof(value->'${evidenceField}') IS DISTINCT FROM 'array'
            OR jsonb_array_length(value->'${evidenceField}') < 1 THEN
           RETURN false;
         END IF;
         FOR item IN SELECT element
               FROM jsonb_array_elements(value->'${evidenceField}') AS elements(element) LOOP
           IF NOT ${referencePredicate}(item->'${reworkEvaluatorField}')
              OR NOT ${referencePredicate}(item->'${resultReferenceField}') THEN
             RETURN false;
           END IF;
         END LOOP;
         RETURN true;
       END IF;
       IF tag IN ('${finalizationSucceededTag}', '${finalizationNeedsWorkTag}',
                  '${finalizationUnavailableTag}') THEN
         RETURN ${referencePredicate}(value->'${workCycleField}')
           AND ${referencePredicate}(value->'${generationField}')
           AND ${referencePredicate}(value->'${evidenceField}');
       END IF;
       RETURN false;
     END $$`,
    `CREATE OR REPLACE FUNCTION public.${commandValidator}(command jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
     DECLARE tag text; value jsonb;
     BEGIN
       IF command IS NULL OR jsonb_typeof(command) <> 'object'
          OR jsonb_typeof(command->'type') IS DISTINCT FROM 'string' THEN
         RETURN false;
       END IF;
       tag := command->>'type'; value := command->'value';
       IF tag = '${createTag}' THEN
         RETURN NOT (value ? 'deps' OR value ? 'prog')
           AND ${releasedPredicate}(value);
       END IF;
       IF tag IN ('${revokeTag}', '${resumeTag}') THEN
         RETURN ${referencePredicate}(value);
       END IF;
       IF tag = '${reportTag}' THEN
         RETURN ${reportPredicate}(value);
       END IF;
       IF jsonb_typeof(value) IS DISTINCT FROM 'object'
          OR NOT ${referencePredicate}(value->'${ticketField}') THEN
         RETURN false;
       END IF;
       IF tag = '${updateTag}' THEN
         RETURN ${referencePredicate}(value->'${expectedRevisionField}')
           AND NOT (value->'${definitionField}' ? 'deps' OR value->'${definitionField}' ? 'prog')
           AND ${releasedPredicate}(value->'${definitionField}');
       END IF;
       IF tag = '${dispatchTag}' THEN
         RETURN ${referencePredicate}(value->'${sourceField}');
       END IF;
       IF tag = '${finalizationTag}' THEN
         RETURN ${referencePredicate}(value->'${workCycleField}')
           AND ${referencePredicate}(value->'${generationField}')
           AND COALESCE(value->'${resultField}'->>'type', '')
             IN (${textList(finalizationResults)})
           AND ${referencePredicate}(value->'${resultField}'->'value');
       END IF;
       RETURN false;
     END $$`,
    `CREATE OR REPLACE FUNCTION public.public_ticket_command_is_valid(command jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
     BEGIN
       IF command IS NULL OR jsonb_typeof(command) <> 'object'
          OR jsonb_typeof(command->'version') <> 'number'
          OR command->>'version' <> '1' THEN
         RETURN false;
       END IF;
       IF command->>'command' = 'Decide' THEN
         RETURN NOT command ? 'event'
           AND ${commandValidator}(command->'${decideField}')
           AND command->'${decideField}'->>'type' NOT IN ('${createTag}', '${updateTag}');
       END IF;
       IF command->>'command' = 'ReleaseDraft' THEN
         RETURN command_integer(command->'ticket') AND (command->>'ticket')::numeric >= 1
           AND command_integer(command->'authoringVersion') AND (command->>'authoringVersion')::numeric >= 1
           AND jsonb_typeof(command->'configurationRevision')='string'
           AND length(command->>'configurationRevision') BETWEEN 1 AND 256;
       END IF;
       IF command->>'command' = '${updateEnvelope}' THEN
         RETURN command_integer(command->'ticket') AND (command->>'ticket')::numeric >= 1
           AND command_integer(command->'${expectedRevisionField}')
           AND (command->>'${expectedRevisionField}')::numeric >= 1
           AND command_integer(command->'authoringVersion') AND (command->>'authoringVersion')::numeric >= 1
           AND jsonb_typeof(command->'configurationRevision')='string'
           AND length(command->>'configurationRevision') BETWEEN 1 AND 256;
       END IF;
       RETURN command->>'command' = 'ResolveNativeAction'
         AND jsonb_typeof(command->'action') = 'string'
         AND length(command->>'action') BETWEEN 1 AND 256
         AND command_integer(command->'authorizingSeq')
         AND (command->>'authorizingSeq')::numeric >= 1
         AND command->>'resolution' IN ('Resume', 'Revoke', 'Approve', 'Decline');
     END $$`,
    `CREATE OR REPLACE FUNCTION public.accept_operation(in_tenant text, in_project text, in_operation text, in_authority_kind text, in_authority_subject text, in_key_version text, in_key_digest text, in_payload_digest text, in_retained_key_digests text[], in_retained_payload_digests text[], in_command text, in_ordinary_soft_limit bigint, in_hard_limit bigint, in_via_session text) RETURNS TABLE(result text, operation text, ordinal bigint, state text, authority_kind text, admission text, lifecycle_generation bigint, lifecycle text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
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
          AND jsonb_typeof(command_value->'${decideField}') = 'object' THEN
         command_tag := command_value->'${decideField}'->>'type';
       ELSIF command_value->>'command' IN ('ReleaseDraft', '${updateEnvelope}') THEN
         command_tag := command_value->>'command';
       ELSIF command_value->>'command' = 'ResolveNativeAction'
          AND jsonb_typeof(command_value->'action') = 'string'
          AND length(command_value->>'action') BETWEEN 1 AND 256
          AND jsonb_typeof(command_value->'authorizingSeq') = 'number'
          AND (command_value->>'authorizingSeq') ~ '^[1-9][0-9]*$'
          AND command_value->>'resolution' IN ('Resume', 'Revoke', 'Approve', 'Decline') THEN
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

       IF command_tag = '${revokeTag}' OR
          (command_tag = 'ResolveNativeAction' AND action_resolution = 'Revoke') THEN
         priority := 'Safety'; admission_class := 'CorrectnessReducing';
       ELSIF command_tag IN ('ReleaseDraft', '${updateEnvelope}', '${resumeTag}') OR
             (command_tag = 'ResolveNativeAction' AND action_resolution IN ('Resume', 'Approve', 'Decline')) THEN
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
       IF command_tag IN ('ReleaseDraft', '${updateEnvelope}') AND NOT EXISTS (
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
          key_version, key_digest, payload_digest, command, command_tag, via_session)
       VALUES (in_tenant, in_project, in_operation, in_authority_kind, in_authority_subject,
          admission_class, in_key_version, in_key_digest, in_payload_digest, in_command, command_tag,
          in_via_session);
       INSERT INTO decision_input (tenant, project, ordinal, input_kind, input_id, base_priority, lifecycle_generation)
       VALUES (in_tenant, in_project, next_ordinal, 'Operation', in_operation, priority, project_generation);
       INSERT INTO project_readiness (tenant, project, ready, generation)
       VALUES (in_tenant, in_project, true, 1)
       ON CONFLICT (tenant, project) DO UPDATE
         SET ready=true, generation=project_readiness.generation+1;
       RETURN QUERY SELECT 'Accepted'::text, in_operation, next_ordinal, 'Pending'::text,
         in_authority_kind, admission_class, project_generation, NULL::text;
     END $_$`,
    `ALTER TABLE public.draft
       ADD COLUMN released_authoring_version bigint`,
    `UPDATE public.draft SET released_authoring_version = authoring_version
      WHERE state = 'Released'`,
    `ALTER TABLE public.draft
       ADD CONSTRAINT draft_release_names_its_version CHECK ((((state = 'Released'::text) = (released_authoring_version IS NOT NULL)) AND ((released_authoring_version IS NULL) OR ((released_authoring_version >= 1) AND (released_authoring_version <= authoring_version)))))`,
    `GRANT UPDATE(released_authoring_version) ON TABLE public.draft TO ${boundaryOwnerRole}`,
    `CREATE OR REPLACE FUNCTION public.release_draft_fenced${fenceSignature} RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE current draft%ROWTYPE;
     BEGIN
       SELECT d.* INTO current FROM draft d JOIN configuration_revision c
         ON c.tenant=d.tenant AND c.project=d.project AND c.revision=d.configuration_revision
        WHERE d.tenant=in_tenant AND d.project=in_project AND d.ticket=in_ticket
          AND c.digest=in_digest FOR UPDATE OF d;
       IF NOT FOUND OR current.state <> 'Draft' OR current.authoring_version <> in_expected
          OR current.configuration_revision <> in_configuration THEN RETURN false; END IF;
       IF in_commit THEN UPDATE draft SET state='Released', released_authoring_version=in_expected
         WHERE tenant=in_tenant AND project=in_project AND ticket=in_ticket; END IF;
       RETURN true;
     END $$`,
    `CREATE FUNCTION public.${updateFence}${fenceSignature} RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE current draft%ROWTYPE;
     BEGIN
       SELECT d.* INTO current FROM draft d JOIN configuration_revision c
         ON c.tenant=d.tenant AND c.project=d.project AND c.revision=d.configuration_revision
        WHERE d.tenant=in_tenant AND d.project=in_project AND d.ticket=in_ticket
          AND c.digest=in_digest FOR UPDATE OF d;
       IF NOT FOUND OR current.state <> 'Released' OR current.authoring_version <> in_expected
          OR current.configuration_revision <> in_configuration THEN RETURN false; END IF;
       IF in_commit THEN UPDATE draft SET released_authoring_version=in_expected
         WHERE tenant=in_tenant AND project=in_project AND ticket=in_ticket; END IF;
       RETURN true;
     END $$`,
    `ALTER FUNCTION public.${updateFence}${fenceSignature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION public.${updateFence}${fenceSignature} FROM PUBLIC`,
    `GRANT ALL ON FUNCTION public.${updateFence}${fenceSignature} TO ${ticketServiceRole}`,
    `CREATE OR REPLACE FUNCTION public.revise_draft(in_tenant text, in_project text, in_ticket bigint, in_expected bigint, in_configuration text, in_authoring text, in_title text, in_intent text, in_links text[], in_checks text[], in_branch text, in_finalization_mode text, in_finalization_target text, in_repository text, in_kind text, in_subject text) RETURNS TABLE(result text, authoring_version bigint, state text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE current draft%ROWTYPE; next_version bigint; landing text; target text;
       phase text; offered jsonb; locked jsonb;
     BEGIN
       SELECT * INTO current FROM draft WHERE tenant=in_tenant AND project=in_project AND ticket=in_ticket FOR UPDATE;
       IF NOT FOUND THEN RETURN QUERY SELECT 'NotFound',NULL::bigint,NULL::text; RETURN; END IF;
       IF current.state = 'Released' THEN
         SELECT p.phase INTO phase FROM ticket_projection p
          WHERE p.tenant=in_tenant AND p.project=in_project AND p.ticket=in_ticket;
       END IF;
       IF current.state <> 'Draft' AND NOT (current.state = 'Released' AND phase IS NOT DISTINCT FROM 'Pending')
         THEN RETURN QUERY SELECT 'NotDraft',current.authoring_version,current.state; RETURN; END IF;
       IF current.authoring_version <> in_expected THEN RETURN QUERY SELECT 'Stale',current.authoring_version,current.state; RETURN; END IF;
       IF current.state = 'Released' THEN
         IF in_authoring IS JSON OBJECT THEN
           offered := in_authoring::jsonb;
         END IF;
         SELECT CASE WHEN r.authoring IS JSON OBJECT THEN r.authoring::jsonb END INTO locked
           FROM draft_revision r
          WHERE r.tenant=in_tenant AND r.project=in_project AND r.ticket=in_ticket
            AND r.authoring_version=current.released_authoring_version;
         IF jsonb_typeof(offered->'${authoringDependenciesField}') IS DISTINCT FROM 'array'
            OR jsonb_typeof(locked->'${authoringDependenciesField}') IS DISTINCT FROM 'array'
         THEN RETURN QUERY SELECT 'DependenciesLocked',current.authoring_version,current.state; RETURN; END IF;
         IF (SELECT array_agg(DISTINCT dependency ORDER BY dependency)
                  FROM jsonb_array_elements(offered->'${authoringDependenciesField}') AS offered_dependencies(dependency))
               IS DISTINCT FROM
               (SELECT array_agg(DISTINCT dependency ORDER BY dependency)
                  FROM jsonb_array_elements(locked->'${authoringDependenciesField}') AS locked_dependencies(dependency))
         THEN RETURN QUERY SELECT 'DependenciesLocked',current.authoring_version,current.state; RETURN; END IF;
       END IF;
       IF NOT EXISTS (SELECT 1 FROM configuration_revision WHERE tenant=in_tenant AND project=in_project AND revision=in_configuration)
         THEN RETURN QUERY SELECT 'ConfigurationNotFound',current.authoring_version,current.state; RETURN; END IF;
       IF in_repository IS NOT NULL AND NOT EXISTS (SELECT 1 FROM project_repository
            WHERE tenant=in_tenant AND project=in_project AND repository=in_repository
              AND retired_at IS NULL)
         THEN RETURN QUERY SELECT 'RepositoryNotBound',current.authoring_version,current.state; RETURN; END IF;
       landing := coalesce(in_finalization_mode,
     (SELECT b.landing_mode FROM project_repository b
       WHERE b.tenant=in_tenant AND b.project=in_project
         AND b.repository=in_repository),
     'Push');
       target := in_finalization_target;
       IF landing IN ('PullRequest','PullRequestMerge') AND in_branch IS NULL THEN
         RETURN QUERY SELECT 'LandingUnbranched',current.authoring_version,current.state; RETURN;
       END IF;
       next_version := current.authoring_version+1;
       INSERT INTO draft_revision (tenant,project,ticket,authoring_version,configuration_revision,authoring,authority_kind,authority_subject)
         VALUES (in_tenant,in_project,in_ticket,next_version,in_configuration,in_authoring,in_kind,in_subject);
       INSERT INTO draft_brief (tenant,project,ticket,title,intent,branch,finalization_mode,finalization_target,repository)
         VALUES (in_tenant,in_project,in_ticket,in_title,in_intent,in_branch,landing,target,in_repository)
         ON CONFLICT (tenant,project,ticket) DO UPDATE SET title=EXCLUDED.title,intent=EXCLUDED.intent,
           branch=EXCLUDED.branch,repository=EXCLUDED.repository,
           finalization_mode=EXCLUDED.finalization_mode,finalization_target=EXCLUDED.finalization_target;
       DELETE FROM draft_brief_link
        WHERE tenant=in_tenant AND project=in_project AND ticket=in_ticket;
       INSERT INTO draft_brief_link (tenant,project,ticket,ordinal,url)
         SELECT in_tenant,in_project,in_ticket,link.ordinal,link.url
           FROM unnest(in_links) WITH ORDINALITY AS link(url,ordinal);
       DELETE FROM draft_brief_check
        WHERE tenant=in_tenant AND project=in_project AND ticket=in_ticket;
       INSERT INTO draft_brief_check (tenant,project,ticket,ordinal,command)
         SELECT in_tenant,in_project,in_ticket,line.ordinal,line.command
           FROM unnest(in_checks) WITH ORDINALITY AS line(command,ordinal);
       UPDATE draft SET authoring_version=next_version,configuration_revision=in_configuration
        WHERE tenant=in_tenant AND project=in_project AND ticket=in_ticket;
       PERFORM publish_project_notification(in_tenant,in_project,'Draft',in_ticket::text,NULL,next_version);
       RETURN QUERY SELECT 'Revised',next_version,current.state;
     END $$`,
    `ALTER TABLE public.ticket_projection
       ADD COLUMN revision bigint DEFAULT 1 NOT NULL,
       ADD CONSTRAINT ticket_projection_revision_is_positive CHECK ((revision >= 1))`,
    `GRANT SELECT(revision) ON TABLE public.ticket_projection TO ${apiRole}`,
    `GRANT UPDATE(revision) ON TABLE public.ticket_projection TO ${ticketServiceRole}`,
    `GRANT UPDATE(definition) ON TABLE public.ticket_definition TO ${ticketServiceRole}`,
    `GRANT UPDATE(digest) ON TABLE public.ticket_definition TO ${ticketServiceRole}`,
    `CREATE OR REPLACE FUNCTION public.submit_task_completion(in_tenant text, in_project text, in_execution text, in_ticket bigint, in_task bigint, in_source_effect integer, in_outcome text, in_manifest text, in_manifest_digest text, in_reason text, in_operation text, in_authority_subject text) RETURNS TABLE(result text, operation text, ordinal bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record; observed record; project_lifecycle text;
       project_generation bigint; next_ordinal bigint; command_value jsonb;
       identity jsonb; report jsonb; released jsonb; definition jsonb;
       obligation jsonb; produced jsonb; accepted bigint;
       context_reference bigint; failure jsonb;
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
       failure := jsonb_build_object('${taskField}', identity,
         '${evidenceField}', bound.task);
       IF in_outcome = 'Blocked' THEN
         report := jsonb_build_object('type', 'TerminalFailureReport', 'value',
           jsonb_build_object('${ticketField}', bound.ticket,
             '${failureField}', failure, 'kind', 'ExecutionUnavailableFailure'));
       ELSIF in_outcome = 'ProcessFailed'
          OR (bound.task_kind = 'Work' AND bound.verdict <> 'Pass') THEN
         report := jsonb_build_object('type', 'TerminalFailureReport', 'value',
           jsonb_build_object('${ticketField}', bound.ticket,
             '${failureField}', failure, 'kind', 'ProcessFailure'));
       ELSE
         SELECT CASE WHEN journalled.entry->'event'->>'type' = '${createdTag}'
                     THEN journalled.entry->'event'->'value'
                     ELSE journalled.entry->'event'->'value'->'${definitionField}' END
           INTO released
           FROM journal_entry j
           CROSS JOIN LATERAL (SELECT CASE WHEN j.entry IS JSON OBJECT
                                           THEN j.entry::jsonb END AS entry) AS journalled
          WHERE j.tenant = in_tenant AND j.project = in_project
            AND ((journalled.entry->'event'->>'type' = '${createdTag}'
                  AND journalled.entry->'event'->'value'->'${releasedIdField}' = to_jsonb(bound.ticket))
              OR (journalled.entry->'event'->>'type' = '${updatedTag}'
                  AND journalled.entry->'event'->'value'->'${ticketField}' = to_jsonb(bound.ticket)))
          ORDER BY journalled.entry->'seq' DESC
          LIMIT 1;
         IF bound.task_kind = 'Work' THEN
           definition := released->'${releasedWorkField}';
           context_reference := bound.cycle;
         ELSE
           SELECT evaluators.evaluator->'${evaluatorTaskField}' INTO definition
             FROM jsonb_array_elements(released->'${releasedPlanField}'->'${releasedStagesField}')
                    AS stages(stage),
                  jsonb_array_elements(stages.stage->'${stageEvaluatorsField}')
                    AS evaluators(evaluator)
            WHERE (stages.stage->>'${stageKeyField}')::bigint = bound.stage
              AND (evaluators.evaluator->>'${evaluatorKeyField}')::bigint = bound.evaluator;
           SELECT result_digest_fold(w.digest) INTO context_reference
             FROM execution e2
             JOIN execution_request_task t2
               ON t2.tenant = e2.tenant AND t2.project = e2.project
              AND t2.request = e2.source_request AND t2.task = e2.task
             JOIN execution_result w
               ON w.tenant = e2.tenant AND w.project = e2.project
              AND w.execution = e2.execution
            WHERE e2.tenant = in_tenant AND e2.project = in_project
              AND e2.ticket = bound.ticket
              AND t2.kind = 'Work' AND t2.cycle = bound.cycle
              AND w.verdict = 'Pass'
            LIMIT 1;
           IF NOT FOUND THEN
             RETURN QUERY SELECT '${workResultUnrecordedResult}'::text, NULL::text, NULL::bigint;
             RETURN;
           END IF;
         END IF;
         obligation := jsonb_build_object(
           '${taskField}', identity,
           '${obligationDefinitionField}', definition,
           '${obligationContextField}', context_reference);
         produced := jsonb_build_object('${obligationField}', obligation,
           '${resultReferenceField}', result_digest_fold(bound.digest));
         IF bound.task_kind = 'Evaluation' THEN
           report := jsonb_build_object('type', 'EvaluationResultReport', 'value',
             jsonb_build_object('${ticketField}', bound.ticket, 'result', produced,
               'verdict', CASE WHEN bound.verdict = 'Pass'
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
             jsonb_build_object('${ticketField}', bound.ticket, 'result', produced,
               '${acceptedSourceField}', accepted));
         END IF;
       END IF;
       command_value := jsonb_build_object('version', 1, 'command', 'Decide',
         '${decideField}', jsonb_build_object('type', '${reportTag}', 'value', report));
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
          command_value::text, '${reportTag}');
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
     END $$`,
  ],
};
