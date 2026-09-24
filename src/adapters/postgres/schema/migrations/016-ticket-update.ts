import {
  apiRole,
  boundaryOwnerRole,
  finalizerRole,
  schedulerRole,
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
 *
 * WHAT A TICKET RUNS IS WHAT WAS RELEASED, NEVER THE LIVE DRAFT. The brief is
 * one row per draft and a reopened draft revises it in place, so a revision
 * nobody released would reach a dispatch, a briefing or a finalization that
 * read it there. Each release and update stores the brief it resolved beside
 * the definition, the rows stored before now take the brief their draft still
 * holds — nothing could revise a released draft until this migration — and the
 * scheduler and the finalizer lose their read of the draft's brief, so the
 * released one is the only brief they can reach. `submit_finalization_result`
 * is rewritten whole to read its landing off the released definition for the
 * same reason. The API reads the released brief too, and of the row only the
 * brief and its key, and the configuration revision the projection pins, so a
 * ticket's page shows what the ticket runs and what it was released under.
 *
 * The names below are the ones this adds. What 013–015 named, the bodies spell
 * as those installed it.
 */

/** The longest released brief the column admits, as its text. */
const releasedBriefCharsMax = 65_536;

/** The released definition's finalization binding, and the landing it names. */
const releasedFinalizationField = "finalization";
const landingModeField = "mode";

/** The ticket command and the journal's event an update is, as the codec spells them. */
const updateTag = "UpdateTicket";
const updatedTag = "TicketUpdated";

/** The envelope a principal offers an update under. */
const updateEnvelope = "UpdateTicket";

/** The fields an update carries, as the codec spells them. */
const expectedRevisionField = "expectedRevision";
const revisionField = "revision";
const definitionField = "definition";

/** The field of a draft's authoring its dependencies are under. */
const authoringDependenciesField = "dependencies";

/** The fence an update commits through, beside the release's. */
const updateFence = "update_draft_fenced";
const fenceSignature = `(in_tenant text, in_project text, in_ticket bigint, in_expected bigint, in_configuration text, in_digest text, in_commit boolean)`;

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
       IF tag = 'TicketCreated' THEN
         RETURN released_ticket_is_valid(value);
       END IF;
       IF tag IN ('TicketRevoked', 'TicketWorkResumed', 'TicketEvaluationResumed',
                  'TicketFinalizationResumed') THEN
         RETURN command_reference(value);
       END IF;
       IF jsonb_typeof(value) IS DISTINCT FROM 'object'
          OR NOT command_reference(value->'ticket') THEN
         RETURN false;
       END IF;
       IF tag = '${updatedTag}' THEN
         RETURN command_reference(value->'${revisionField}')
           AND value->'${revisionField}' > to_jsonb(1)
           AND released_ticket_is_valid(value->'${definitionField}')
           AND value->'${definitionField}'->'id' = value->'ticket';
       END IF;
       IF tag = 'TicketDispatched' THEN
         RETURN command_reference(value->'source');
       END IF;
       IF tag = 'TicketWorkResultAccepted' THEN
         RETURN validated_task_result_is_valid(value->'result')
           AND command_reference(value->'acceptedSourceRef');
       END IF;
       IF tag IN ('TicketWorkProcessFailed', 'TicketWorkExecutionUnavailable') THEN
         RETURN task_identity_is_valid(value->'task')
           AND command_reference(value->'evidence');
       END IF;
       IF tag IN ('TicketEvaluationProgressed', 'TicketEvaluationPassed',
                  'TicketEvaluationBlocked', 'TicketEvaluationReworkStarted',
                  'TicketEvaluationFailureEscalated')
          AND (NOT task_report_is_valid(value->'report')
               OR value->'report'->'value'->'ticket'
                  IS DISTINCT FROM value->'ticket') THEN
         RETURN false;
       END IF;
       IF tag IN ('TicketEvaluationProgressed', 'TicketEvaluationPassed',
                  'TicketEvaluationBlocked') THEN
         RETURN true;
       END IF;
       IF tag IN ('TicketEvaluationReworkStarted', 'TicketEvaluationFailureEscalated') THEN
         IF jsonb_typeof(value->'evidence') IS DISTINCT FROM 'array'
            OR jsonb_array_length(value->'evidence') < 1 THEN
           RETURN false;
         END IF;
         FOR item IN SELECT element
               FROM jsonb_array_elements(value->'evidence') AS elements(element) LOOP
           IF NOT command_reference(item->'evaluator')
              OR NOT command_reference(item->'resultRef') THEN
             RETURN false;
           END IF;
         END LOOP;
         RETURN true;
       END IF;
       IF tag IN ('TicketFinalizationSucceeded', 'TicketFinalizationNeedsWork',
                  'TicketFinalizationUnavailable') THEN
         RETURN command_reference(value->'workCycle')
           AND command_reference(value->'generation')
           AND command_reference(value->'evidence');
       END IF;
       RETURN false;
     END $$`,
    `CREATE OR REPLACE FUNCTION public.decision_command_is_valid(command jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
     DECLARE tag text; value jsonb;
     BEGIN
       IF command IS NULL OR jsonb_typeof(command) <> 'object'
          OR jsonb_typeof(command->'type') IS DISTINCT FROM 'string' THEN
         RETURN false;
       END IF;
       tag := command->>'type'; value := command->'value';
       IF tag = 'CreateTicket' THEN
         RETURN NOT (value ? 'deps' OR value ? 'prog')
           AND released_ticket_is_valid(value);
       END IF;
       IF tag IN ('RevokeTicket', 'ResumeTicket') THEN
         RETURN command_reference(value);
       END IF;
       IF tag = 'ReportTaskTerminal' THEN
         RETURN task_report_is_valid(value);
       END IF;
       IF jsonb_typeof(value) IS DISTINCT FROM 'object'
          OR NOT command_reference(value->'ticket') THEN
         RETURN false;
       END IF;
       IF tag = '${updateTag}' THEN
         RETURN command_reference(value->'${expectedRevisionField}')
           AND NOT (value->'${definitionField}' ? 'deps' OR value->'${definitionField}' ? 'prog')
           AND released_ticket_is_valid(value->'${definitionField}');
       END IF;
       IF tag = 'DispatchTicket' THEN
         RETURN command_reference(value->'source');
       END IF;
       IF tag = 'ReportFinalizationResult' THEN
         RETURN command_reference(value->'workCycle')
           AND command_reference(value->'generation')
           AND COALESCE(value->'result'->>'type', '')
             IN ('FinalizationSucceeded', 'FinalizationNeedsWork', 'FinalizationResultUnavailable')
           AND command_reference(value->'result'->'value');
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
           AND decision_command_is_valid(command->'ticketCommand')
           AND command->'ticketCommand'->>'type' NOT IN ('CreateTicket', '${updateTag}');
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
          AND jsonb_typeof(command_value->'ticketCommand') = 'object' THEN
         command_tag := command_value->'ticketCommand'->>'type';
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

       IF command_tag = 'RevokeTicket' OR
          (command_tag = 'ResolveNativeAction' AND action_resolution = 'Revoke') THEN
         priority := 'Safety'; admission_class := 'CorrectnessReducing';
       ELSIF command_tag IN ('ReleaseDraft', '${updateEnvelope}', 'ResumeTicket') OR
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
    `GRANT SELECT(configuration_revision) ON TABLE public.ticket_projection TO ${apiRole}`,
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
       failure := jsonb_build_object('task', identity,
         'evidence', bound.task);
       IF in_outcome = 'Blocked' THEN
         report := jsonb_build_object('type', 'TerminalFailureReport', 'value',
           jsonb_build_object('ticket', bound.ticket,
             'failure', failure, 'kind', 'ExecutionUnavailableFailure'));
       ELSIF in_outcome = 'ProcessFailed'
          OR (bound.task_kind = 'Work' AND bound.verdict <> 'Pass') THEN
         report := jsonb_build_object('type', 'TerminalFailureReport', 'value',
           jsonb_build_object('ticket', bound.ticket,
             'failure', failure, 'kind', 'ProcessFailure'));
       ELSE
         SELECT CASE WHEN journalled.entry->'event'->>'type' = 'TicketCreated'
                     THEN journalled.entry->'event'->'value'
                     ELSE journalled.entry->'event'->'value'->'${definitionField}' END
           INTO released
           FROM journal_entry j
           CROSS JOIN LATERAL (SELECT CASE WHEN j.entry IS JSON OBJECT
                                           THEN j.entry::jsonb END AS entry) AS journalled
          WHERE j.tenant = in_tenant AND j.project = in_project
            AND ((journalled.entry->'event'->>'type' = 'TicketCreated'
                  AND journalled.entry->'event'->'value'->'id' = to_jsonb(bound.ticket))
              OR (journalled.entry->'event'->>'type' = '${updatedTag}'
                  AND journalled.entry->'event'->'value'->'ticket' = to_jsonb(bound.ticket)))
          ORDER BY journalled.entry->'seq' DESC
          LIMIT 1;
         IF bound.task_kind = 'Work' THEN
           definition := released->'workConfiguration';
           context_reference := bound.cycle;
         ELSE
           SELECT evaluators.evaluator->'task' INTO definition
             FROM jsonb_array_elements(released->'evaluationPlan'->'stages')
                    AS stages(stage),
                  jsonb_array_elements(stages.stage->'evaluators')
                    AS evaluators(evaluator)
            WHERE (stages.stage->>'key')::bigint = bound.stage
              AND (evaluators.evaluator->>'key')::bigint = bound.evaluator;
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
           'task', identity,
           'definition', definition,
           'contextRef', context_reference);
         produced := jsonb_build_object('obligation', obligation,
           'resultRef', result_digest_fold(bound.digest));
         IF bound.task_kind = 'Evaluation' THEN
           report := jsonb_build_object('type', 'EvaluationResultReport', 'value',
             jsonb_build_object('ticket', bound.ticket, 'result', produced,
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
             jsonb_build_object('ticket', bound.ticket, 'result', produced,
               'acceptedSourceRef', accepted));
         END IF;
       END IF;
       command_value := jsonb_build_object('version', 1, 'command', 'Decide',
         'ticketCommand', jsonb_build_object('type', 'ReportTaskTerminal', 'value', report));
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
          command_value::text, 'ReportTaskTerminal');
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
    `ALTER TABLE public.ticket_definition
       ADD COLUMN brief jsonb,
       ADD CONSTRAINT ticket_definition_brief_is_bounded CHECK (((brief IS NULL) OR ((jsonb_typeof(brief) = 'object'::text) AND (length((brief)::text) <= ${String(releasedBriefCharsMax)}))))`,
    `UPDATE public.ticket_definition d
        SET brief = jsonb_strip_nulls(jsonb_build_object(
          'title', b.title, 'intent', b.intent,
          'links', coalesce((SELECT jsonb_agg(l.url ORDER BY l.ordinal) FROM public.draft_brief_link l
                              WHERE l.tenant = b.tenant AND l.project = b.project AND l.ticket = b.ticket),
                            '[]'::jsonb),
          'checks', coalesce((SELECT jsonb_agg(k.command ORDER BY k.ordinal) FROM public.draft_brief_check k
                               WHERE k.tenant = b.tenant AND k.project = b.project AND k.ticket = b.ticket),
                             '[]'::jsonb),
          'repository', b.repository, 'branch', b.branch,
          'finalization', CASE WHEN b.finalization_mode IS NULL THEN NULL
            ELSE jsonb_build_object('mode', b.finalization_mode, 'target', b.finalization_target) END))
       FROM public.draft_brief b
      WHERE b.tenant = d.tenant AND b.project = d.project AND b.ticket = d.ticket`,
    `GRANT UPDATE(brief) ON TABLE public.ticket_definition TO ${ticketServiceRole}`,
    `GRANT SELECT ON TABLE public.ticket_definition TO ${finalizerRole}`,
    `GRANT SELECT(tenant, project, ticket, brief) ON TABLE public.ticket_definition TO ${apiRole}`,
    `REVOKE SELECT ON TABLE public.draft_brief, public.draft_brief_link, public.draft_brief_check FROM ${schedulerRole}, ${finalizerRole}`,
    `CREATE OR REPLACE FUNCTION public.submit_finalization_result(in_tenant text, in_project text, in_request text, in_attempt text, in_outcome text, in_failure_kind text, in_request_generation bigint, in_recovery_epoch text, in_operation text, in_authority_subject text) RETURNS TABLE(result text, operation text, ordinal bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record; project_lifecycle text; project_generation bigint;
       next_ordinal bigint; command_value jsonb; current_epoch text;
       scoped_digest text; settled text;
     BEGIN
       IF in_outcome NOT IN ('FinalizationSucceeded', 'FinalizationFailed',
           'FinalizationNeedsWork', 'FinalizationResultUnavailable') THEN
         RAISE EXCEPTION 'finalization outcome % is not one this boundary submits', in_outcome
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       scoped_digest := encode(sha256(convert_to('finalization:' || in_request, 'UTF8')), 'hex');
       SELECT f.ticket, f.state, f.request_generation, f.recovery_epoch, f.kind,
              f.hold_kind,
              a.attempt, a.outcome AS attempt_outcome, a.failure_kind,
              p.state AS permit_state, r.verdict,
              w.definition->'${releasedFinalizationField}'->>'${landingModeField}' AS landing
         INTO bound
         FROM finalization_request f
         LEFT JOIN ticket_definition w
           ON w.tenant = f.tenant AND w.project = f.project AND w.ticket = f.ticket
         LEFT JOIN finalization_attempt a
           ON a.tenant = f.tenant AND a.project = f.project
              AND a.request = f.request AND a.attempt = in_attempt
         LEFT JOIN commit_permit p
           ON p.tenant = a.tenant AND p.project = a.project AND p.attempt = a.attempt
         LEFT JOIN finalization_reconciliation r
           ON r.tenant = p.tenant AND r.project = p.project AND r.permit = p.permit
        WHERE f.tenant = in_tenant AND f.project = in_project AND f.request = in_request
        FOR UPDATE OF f;
       IF NOT FOUND THEN
         RETURN QUERY SELECT 'UnknownRequest'::text, NULL::text, NULL::bigint; RETURN;
       END IF;
       SELECT o.operation INTO settled FROM operation o
        WHERE o.tenant = in_tenant AND o.project = in_project
          AND o.authority_kind = 'Finalizer' AND o.key_digest = scoped_digest;
       IF FOUND THEN
         RETURN QUERY SELECT 'AlreadySubmitted'::text, settled,
           (SELECT d.ordinal FROM decision_input d
             WHERE d.tenant = in_tenant AND d.project = in_project
               AND d.input_kind = 'Operation' AND d.input_id = settled);
         RETURN;
       END IF;
       SELECT e.epoch INTO current_epoch FROM recovery_epoch e ORDER BY e.ordinal DESC LIMIT 1;
       IF bound.state NOT IN ('Open', 'Registered')
          OR bound.request_generation <> in_request_generation
          OR bound.recovery_epoch IS DISTINCT FROM in_recovery_epoch
          OR current_epoch IS DISTINCT FROM in_recovery_epoch
          OR (bound.attempt IS NULL
            AND in_outcome <> 'FinalizationResultUnavailable'
            AND NOT (in_attempt IS NULL
              AND bound.landing IS NOT DISTINCT FROM 'None'))
          OR NOT (
            (in_outcome IN ('FinalizationFailed', 'FinalizationNeedsWork')
              AND bound.kind = 'RunFinalizer'
              AND bound.attempt_outcome = 'Failed'
              AND bound.failure_kind IS NOT DISTINCT FROM in_failure_kind)
            OR (in_outcome = 'FinalizationSucceeded'
              AND bound.kind = 'RunFinalizer'
              AND in_failure_kind IS NULL
              AND bound.attempt_outcome = 'Prepared'
              AND bound.permit_state IS NOT DISTINCT FROM 'Concluded'
              AND bound.verdict IS NOT DISTINCT FROM 'Promoted')
            OR (in_outcome = 'FinalizationSucceeded'
              AND bound.kind = 'RunFinalizer'
              AND in_failure_kind IS NULL
              AND in_attempt IS NULL
              AND bound.landing IS NOT DISTINCT FROM 'None')
            OR (in_outcome = 'FinalizationResultUnavailable'
              AND bound.kind = 'RunFinalizer'
              AND in_attempt IS NULL
              AND bound.hold_kind IS NOT NULL
              AND bound.hold_kind IS NOT DISTINCT FROM in_failure_kind))
       THEN
         RETURN QUERY SELECT 'BindingMismatch'::text, NULL::text, NULL::bigint; RETURN;
       END IF;
       SELECT p.lifecycle, p.lifecycle_generation
         INTO STRICT project_lifecycle, project_generation
         FROM project p WHERE p.tenant = in_tenant AND p.project = in_project FOR UPDATE;
       IF project_lifecycle = 'Retention' THEN
         RETURN QUERY SELECT 'NotAdmitted'::text, NULL::text, NULL::bigint; RETURN;
       END IF;
       command_value := jsonb_build_object('version', 1,
         'command', 'SubmitFinalizationResult', 'request', in_request,
         'requestGeneration', in_request_generation,
         'recoveryEpoch', in_recovery_epoch, 'outcome', in_outcome)
         || CASE WHEN in_attempt IS NULL THEN '{}'::jsonb
                 ELSE jsonb_build_object('attempt', in_attempt) END
         || CASE WHEN in_outcome = 'FinalizationResultUnavailable'
                 THEN jsonb_build_object('kind', in_failure_kind)
                 ELSE '{}'::jsonb END;
       IF ticket_command_is_valid(command_value) IS NOT TRUE THEN
         RAISE EXCEPTION 'the finalization result this boundary built is not one the mailbox admits'
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       UPDATE project p SET ingress_next = p.ingress_next + 1
        WHERE p.tenant = in_tenant AND p.project = in_project
        RETURNING p.ingress_next - 1 INTO next_ordinal;
       INSERT INTO operation
         (tenant, project, operation, authority_kind, authority_subject, admission,
          key_version, key_digest, payload_digest, command, command_tag)
       VALUES (in_tenant, in_project, in_operation, 'Finalizer',
          in_authority_subject, 'CorrectnessReducing', 'finalizer-v1',
          scoped_digest,
          encode(sha256(convert_to(command_value::text, 'UTF8')), 'hex'),
          command_value::text, 'ReportFinalizationResult');
       INSERT INTO decision_input
         (tenant, project, ordinal, input_kind, input_id, base_priority, lifecycle_generation)
       VALUES (in_tenant, in_project, next_ordinal, 'Operation', in_operation,
          'Completion', project_generation);
       INSERT INTO project_readiness (tenant, project, ready, generation)
       VALUES (in_tenant, in_project, true, 1)
       ON CONFLICT (tenant, project) DO UPDATE
         SET ready = true, generation = project_readiness.generation + 1;
       RETURN QUERY SELECT 'Submitted'::text, in_operation, next_ordinal;
     END $$`,
  ],
};
