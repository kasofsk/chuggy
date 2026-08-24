import { finalizationOutcomeTags } from "../../../domain/generated/modelTypes.ts";
import { artifactDigestChars } from "../../../interpreter/resultManifest.ts";
import {
  allCommitPermitStates,
  allFinalizationAttemptOutcomes,
  allFinalizationFailureKinds,
  allInputBundleReferenceKinds,
  allIntegrationStrategies,
  allReconciliationVerdicts,
  finalizerAuthorityKind,
  finalizerIdentityCharsMax,
  finalizerKeyVersion,
  gitObjectIdPattern,
  gitRefNameCharsMax,
  inputBundleReferencesMax,
} from "../../../interpreter/finalizer.ts";
import {
  finalizationDigestFormat,
  inputBundleCanonicalPart,
} from "../../../interpreter/finalizerPreparation.ts";
import {
  inputBundleIdentityKind,
  spawnRequestKinds,
} from "../../../interpreter/projectDecision.ts";
import {
  allNativeActionKinds,
  allNativeActionResolutions,
  nativeActionResolutions,
} from "../../../interpreter/ticketCommand.ts";
import {
  apiRole,
  approvalRequestFunction,
  boundaryOwnerRole,
  finalizationFunction,
  finalizerRole,
  roleStatement,
  schedulerRole,
  schemaTextSet,
  selectorServiceRole,
  ticketServiceRole,
  type Migration,
} from "./shared.ts";
import { acceptanceBody, publicCommandGrammarBody } from "./mailbox.ts";

/**
 * The pairing every offered answer satisfies, as the disjunction a trigger
 * evaluates. A question and the answers it admits are one roster, so a row
 * offering an escalation's answer to an approval is refused by the server.
 */
export const nativeActionPairing = allNativeActionKinds
  .map(
    (kind) =>
      `(asked = '${kind}' AND NEW.resolution IN (${schemaTextSet(nativeActionResolutions[kind])}))`,
  )
  .join("\n              OR ");

/**
 * The bundle identity a registration predating I7 is given, spelled exactly as
 * the deciding transaction spells one so a replayed decision reproduces it.
 */
export const retrofitBundleIdentity = `r.authorizing_seq::text || ':'
     || r.effect_position::text || ':${inputBundleIdentityKind}'`;

/**
 * The canonical bytes of that bundle's one reference, digested as
 * `canonicalInputBundle` digests it: each part length-prefixed, in order.
 */
export const retrofitBundleDigest = `encode(sha256(convert_to((
       SELECT string_agg(length(part)::text || ':' || part, '' ORDER BY position)
         FROM unnest(ARRAY['${finalizationDigestFormat}', '${inputBundleCanonicalPart}',
                           r.tenant, r.project, ${retrofitBundleIdentity}, '1',
                           'ConfigurationRevision', r.configuration_revision,
                           r.configuration_digest])
              WITH ORDINALITY AS parts(part, position)), 'UTF8')), 'hex')`;

/** The relations, triggers and boundaries the finalizer owns, which I7 adds. */
export const durableFinalizer = [
  roleStatement(finalizerRole),
  `ALTER ROLE ${finalizerRole} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
  `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${finalizerRole}`,
  `REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM ${finalizerRole}`,
  `GRANT USAGE ON SCHEMA public TO ${finalizerRole}`,
  `GRANT ${boundaryOwnerRole} TO CURRENT_USER`,
  `GRANT CREATE ON SCHEMA public TO ${boundaryOwnerRole}`,

  `CREATE TABLE project_repository (
     tenant         text NOT NULL,
     project        text NOT NULL,
     repository     text NOT NULL,
     recovery_epoch text NOT NULL REFERENCES recovery_epoch (epoch),
     bound_at       timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (tenant, project),
     CONSTRAINT project_repository_belongs_to_project
       FOREIGN KEY (tenant, project) REFERENCES project (tenant, project),
     CONSTRAINT project_repository_is_exclusive UNIQUE (repository),
     CONSTRAINT project_repository_is_referenceable UNIQUE (tenant, project, repository),
     CONSTRAINT project_repository_identity_is_bounded CHECK (
       length(repository) BETWEEN 1 AND ${finalizerIdentityCharsMax})
   )`,

  `CREATE TABLE input_bundle (
     tenant     text NOT NULL,
     project    text NOT NULL,
     bundle     text NOT NULL,
     digest     text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (tenant, project, bundle),
     CONSTRAINT input_bundle_belongs_to_project
       FOREIGN KEY (tenant, project) REFERENCES project (tenant, project),
     CONSTRAINT input_bundle_is_referenceable UNIQUE (tenant, project, bundle, digest),
     CONSTRAINT input_bundle_digest_is_hex CHECK (
       digest ~ '^[0-9a-f]{${artifactDigestChars}}$'),
     CONSTRAINT input_bundle_identity_is_bounded CHECK (
       length(bundle) BETWEEN 1 AND ${finalizerIdentityCharsMax})
   )`,
  `CREATE TABLE input_bundle_reference (
     tenant         text    NOT NULL,
     project        text    NOT NULL,
     bundle         text    NOT NULL,
     ordinal        integer NOT NULL,
     reference_kind text    NOT NULL,
     reference_id   text    NOT NULL,
     reference_digest text,
     PRIMARY KEY (tenant, project, bundle, ordinal),
     CONSTRAINT input_bundle_reference_has_its_bundle
       FOREIGN KEY (tenant, project, bundle) REFERENCES input_bundle (tenant, project, bundle),
     CONSTRAINT input_bundle_reference_is_declared_once
       UNIQUE (tenant, project, bundle, reference_kind, reference_id),
     CONSTRAINT input_bundle_reference_kind_is_known CHECK (
       reference_kind IN (${schemaTextSet(allInputBundleReferenceKinds)})),
     CONSTRAINT input_bundle_reference_count_is_bounded CHECK (
       ordinal BETWEEN 1 AND ${inputBundleReferencesMax}),
     CONSTRAINT input_bundle_reference_identity_is_bounded CHECK (
       length(reference_id) BETWEEN 1 AND ${finalizerIdentityCharsMax}),
     CONSTRAINT input_bundle_reference_digest_is_hex CHECK (
       reference_digest IS NULL
       OR reference_digest ~ '^[0-9a-f]{${artifactDigestChars}}$')
   )`,

  `ALTER TABLE execution_request
     ADD COLUMN input_bundle        text,
     ADD COLUMN input_bundle_digest text`,
  `INSERT INTO input_bundle (tenant, project, bundle, digest)
     SELECT r.tenant, r.project, ${retrofitBundleIdentity},
            ${retrofitBundleDigest}
       FROM execution_request r
      WHERE r.kind IN (${schemaTextSet(spawnRequestKinds)})`,
  `INSERT INTO input_bundle_reference
     (tenant, project, bundle, ordinal, reference_kind, reference_id, reference_digest)
     SELECT r.tenant, r.project, ${retrofitBundleIdentity}, 1,
            'ConfigurationRevision', r.configuration_revision, r.configuration_digest
       FROM execution_request r
      WHERE r.kind IN (${schemaTextSet(spawnRequestKinds)})`,
  `UPDATE execution_request r
      SET input_bundle = b.bundle, input_bundle_digest = b.digest
     FROM input_bundle b
    WHERE b.tenant = r.tenant AND b.project = r.project
      AND b.bundle = ${retrofitBundleIdentity}
      AND r.kind IN (${schemaTextSet(spawnRequestKinds)})`,
  `DO $$ BEGIN
     IF EXISTS (SELECT 1 FROM execution_request
                 WHERE (kind IN (${schemaTextSet(spawnRequestKinds)}))
                   <> (input_bundle IS NOT NULL AND input_bundle_digest IS NOT NULL))
     THEN RAISE EXCEPTION 'I7 found a registration whose input bundle the backfill did not pin';
     END IF;
   END $$`,
  `ALTER TABLE execution_request
     ADD CONSTRAINT execution_request_pins_its_bundle CHECK (
       (kind IN (${schemaTextSet(spawnRequestKinds)})) = (input_bundle IS NOT NULL)
       AND (input_bundle IS NULL) = (input_bundle_digest IS NULL)),
     ADD CONSTRAINT execution_request_bundle_is_retained
       FOREIGN KEY (tenant, project, input_bundle, input_bundle_digest)
       REFERENCES input_bundle (tenant, project, bundle, digest)`,

  `CREATE TABLE finalization_attempt (
     tenant                 text    NOT NULL,
     project                text    NOT NULL,
     attempt                text    NOT NULL,
     request                text    NOT NULL,
     ticket                 bigint  NOT NULL,
     repository             text    NOT NULL,
     input_bundle           text    NOT NULL,
     input_bundle_digest    text    NOT NULL,
     target_ref             text    NOT NULL,
     target_commit          text    NOT NULL,
     strategy               text    NOT NULL,
     configuration_revision text    NOT NULL,
     configuration_digest   text    NOT NULL,
     approval_required      boolean NOT NULL,
     outcome                text    NOT NULL,
     candidate_commit       text,
     failure_kind             text,
     conflict_manifest        text,
     conflict_manifest_digest text,
     attempt_digest         text    NOT NULL,
     prepared_at            timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (tenant, project, attempt),
     CONSTRAINT finalization_attempt_identity_is_never_reused UNIQUE (attempt),
     CONSTRAINT finalization_attempt_belongs_to_project
       FOREIGN KEY (tenant, project) REFERENCES project (tenant, project),
     CONSTRAINT finalization_attempt_has_its_request
       FOREIGN KEY (tenant, project, request)
       REFERENCES finalization_request (tenant, project, request),
     CONSTRAINT finalization_attempt_has_its_repository
       FOREIGN KEY (tenant, project, repository)
       REFERENCES project_repository (tenant, project, repository),
     CONSTRAINT finalization_attempt_has_its_bundle
       FOREIGN KEY (tenant, project, input_bundle, input_bundle_digest)
       REFERENCES input_bundle (tenant, project, bundle, digest),
     CONSTRAINT finalization_attempt_configuration_is_retained
       FOREIGN KEY (tenant, project, configuration_revision, configuration_digest)
       REFERENCES configuration_revision (tenant, project, revision, digest),
     CONSTRAINT finalization_attempt_outcome_is_known CHECK (
       outcome IN (${schemaTextSet(allFinalizationAttemptOutcomes)})),
     CONSTRAINT finalization_attempt_failure_kind_is_known CHECK (
       failure_kind IS NULL OR failure_kind IN (${schemaTextSet(allFinalizationFailureKinds)})),
     CONSTRAINT finalization_attempt_strategy_is_known CHECK (
       strategy IN (${schemaTextSet(allIntegrationStrategies)})),
     CONSTRAINT finalization_attempt_outcome_is_whole CHECK (
       (outcome = 'Prepared') = (candidate_commit IS NOT NULL)
       AND (outcome = 'Failed') = (failure_kind IS NOT NULL)
       AND (conflict_manifest IS NULL OR failure_kind = 'MergeConflict')
       AND (conflict_manifest IS NULL) = (conflict_manifest_digest IS NULL)),
     CONSTRAINT finalization_attempt_commits_are_object_ids CHECK (
       target_commit ~ '${gitObjectIdPattern()}'
       AND (candidate_commit IS NULL OR candidate_commit ~ '${gitObjectIdPattern()}')),
     CONSTRAINT finalization_attempt_digest_is_hex CHECK (
       attempt_digest ~ '^[0-9a-f]{${artifactDigestChars}}$'
       AND (conflict_manifest_digest IS NULL
            OR conflict_manifest_digest ~ '^[0-9a-f]{${artifactDigestChars}}$')),
     CONSTRAINT finalization_attempt_ticket_is_positive CHECK (ticket >= 1),
     CONSTRAINT finalization_attempt_text_is_bounded CHECK (
       length(attempt) BETWEEN 1 AND ${finalizerIdentityCharsMax}
       AND length(target_ref) BETWEEN 1 AND ${gitRefNameCharsMax}
       AND coalesce(length(conflict_manifest), 1) BETWEEN 1 AND ${finalizerIdentityCharsMax})
   )`,
  `CREATE INDEX finalization_attempt_by_request
     ON finalization_attempt (tenant, project, request, prepared_at)`,

  `CREATE TABLE commit_permit (
     tenant               text   NOT NULL,
     project              text   NOT NULL,
     permit               text   NOT NULL,
     attempt              text   NOT NULL,
     recovery_epoch       text   NOT NULL REFERENCES recovery_epoch (epoch),
     lifecycle_generation bigint NOT NULL,
     state                text   NOT NULL DEFAULT 'Granted',
     granted_at           timestamptz NOT NULL DEFAULT now(),
     concluded_at         timestamptz,
     PRIMARY KEY (tenant, project, permit),
     CONSTRAINT commit_permit_identity_is_never_reused UNIQUE (permit),
     CONSTRAINT commit_permit_has_its_attempt
       FOREIGN KEY (tenant, project, attempt)
       REFERENCES finalization_attempt (tenant, project, attempt),
     CONSTRAINT commit_permit_is_one_per_attempt UNIQUE (tenant, project, attempt),
     CONSTRAINT commit_permit_state_is_known CHECK (
       state IN (${schemaTextSet(allCommitPermitStates)})),
     CONSTRAINT commit_permit_conclusion_is_whole CHECK (
       (state = 'Concluded') = (concluded_at IS NOT NULL)),
     CONSTRAINT commit_permit_generation_is_positive CHECK (lifecycle_generation >= 1),
     CONSTRAINT commit_permit_identity_is_bounded CHECK (
       length(permit) BETWEEN 1 AND ${finalizerIdentityCharsMax})
   )`,
  `CREATE UNIQUE INDEX commit_permit_one_live
     ON commit_permit (tenant, project) WHERE state = 'Granted'`,
  `CREATE INDEX commit_permit_unconcluded
     ON commit_permit (granted_at) WHERE state = 'Granted'`,

  `CREATE TABLE finalization_reconciliation (
     tenant           text NOT NULL,
     project          text NOT NULL,
     permit           text NOT NULL,
     candidate_commit text NOT NULL,
     target_ref       text NOT NULL,
     verdict          text NOT NULL,
     observed_commit  text,
     reconciled_at    timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (tenant, project, permit),
     CONSTRAINT finalization_reconciliation_has_its_permit
       FOREIGN KEY (tenant, project, permit) REFERENCES commit_permit (tenant, project, permit),
     CONSTRAINT finalization_reconciliation_verdict_is_known CHECK (
       verdict IN (${schemaTextSet(allReconciliationVerdicts)})),
     CONSTRAINT finalization_reconciliation_reading_is_whole CHECK (
       (verdict = 'Unreadable') = (observed_commit IS NULL)),
     CONSTRAINT finalization_reconciliation_commits_are_object_ids CHECK (
       candidate_commit ~ '${gitObjectIdPattern()}'
       AND (observed_commit IS NULL OR observed_commit ~ '${gitObjectIdPattern()}')),
     CONSTRAINT finalization_reconciliation_ref_is_bounded CHECK (
       length(target_ref) BETWEEN 1 AND ${gitRefNameCharsMax})
   )`,
  `CREATE INDEX finalization_reconciliation_held
     ON finalization_reconciliation (reconciled_at) WHERE verdict = 'Unreadable'`,

  `ALTER TABLE finalization_request
     ADD COLUMN recovery_epoch text REFERENCES recovery_epoch (epoch),
     ADD CONSTRAINT finalization_request_claim_is_fenced CHECK (
       (claim_owner IS NULL) = (recovery_epoch IS NULL)
       AND coalesce(length(claim_owner), 1) BETWEEN 1 AND ${finalizerIdentityCharsMax})`,
  `CREATE INDEX finalization_request_claimable
     ON finalization_request (authorizing_seq) WHERE state = 'Open'`,
  `CREATE INDEX finalization_request_claim_expiry
     ON finalization_request (claim_expires_at) WHERE claim_owner IS NOT NULL`,
  `CREATE INDEX finalization_request_epoch
     ON finalization_request (recovery_epoch) WHERE claim_owner IS NOT NULL`,
  `DROP INDEX finalization_request_one_open`,
  `CREATE UNIQUE INDEX finalization_request_one_live
     ON finalization_request (tenant, project, ticket)
     WHERE state IN ('Open', 'Registered')`,

  `ALTER TABLE native_action ADD COLUMN attempt text, ADD COLUMN resolution text`,
  `DO $$
     DECLARE named text;
     BEGIN
       FOR named IN
         SELECT c.conname FROM pg_constraint c
          WHERE c.conrelid = 'native_action'::regclass AND c.contype = 'c'
            AND pg_get_constraintdef(c.oid) ~ '(TicketEscalation|ResolveTicket)'
       LOOP
         EXECUTE format('ALTER TABLE native_action DROP CONSTRAINT %I', named);
       END LOOP;
       FOR named IN
         SELECT c.conname FROM pg_constraint c
          WHERE c.conrelid = 'native_action'::regclass AND c.contype = 'u'
            AND pg_get_constraintdef(c.oid) ~ 'effect_position'
       LOOP
         EXECUTE format('ALTER TABLE native_action DROP CONSTRAINT %I', named);
       END LOOP;
       FOR named IN
         SELECT c.conname FROM pg_constraint c
          WHERE c.conrelid = 'native_action_resolution'::regclass AND c.contype = 'c'
       LOOP
         EXECUTE format(
           'ALTER TABLE native_action_resolution DROP CONSTRAINT %I', named);
       END LOOP;
     END $$`,
  `UPDATE native_action a SET resolution = o.command::jsonb->>'resolution'
     FROM operation o
     JOIN decision_input d ON d.tenant = o.tenant AND d.project = o.project
          AND d.input_kind = 'Operation' AND d.input_id = o.operation
          AND d.state = 'Journaled'
    WHERE o.tenant = a.tenant AND o.project = a.project
      AND o.command_tag = 'ResolveNativeAction'
      AND o.command::jsonb->>'action' = a.action
      AND a.state = 'Resolved' AND a.resolution IS NULL`,
  `ALTER TABLE native_action_resolution
     ADD CONSTRAINT native_action_resolution_is_known CHECK (
       resolution IN (${schemaTextSet(allNativeActionResolutions)}))`,
  `CREATE UNIQUE INDEX native_action_effect_is_materialized_once
     ON native_action (tenant, project, authorizing_seq, effect_position)
     WHERE attempt IS NULL`,
  `CREATE UNIQUE INDEX native_action_approves_an_attempt_once
     ON native_action (tenant, project, attempt) WHERE attempt IS NOT NULL`,
  `ALTER TABLE native_action
     ADD CONSTRAINT native_action_kind_is_known CHECK (
       kind IN (${schemaTextSet(allNativeActionKinds)})),
     ADD CONSTRAINT native_action_capability_is_known CHECK (
       required_capability IN ('ResolveTicket', 'ApproveFinalization')),
     ADD CONSTRAINT native_action_kind_names_its_capability CHECK (
       (kind = 'TicketEscalation') = (required_capability = 'ResolveTicket')
       AND (kind = 'FinalizationApproval') = (required_capability = 'ApproveFinalization')
       AND (kind = 'FinalizationApproval') = (attempt IS NOT NULL)),
     ADD CONSTRAINT native_action_answer_is_whole CHECK (
       (state = 'Resolved') = (resolution IS NOT NULL)),
     ADD CONSTRAINT native_action_answers_with_one_it_offered
       FOREIGN KEY (tenant, project, action, resolution)
       REFERENCES native_action_resolution (tenant, project, action, resolution),
     ADD CONSTRAINT native_action_attempt_is_its_own
       FOREIGN KEY (tenant, project, attempt)
       REFERENCES finalization_attempt (tenant, project, attempt)`,

  `CREATE FUNCTION native_action_resolution_pairs_with_its_kind() RETURNS trigger
     LANGUAGE plpgsql AS $$
     DECLARE asked text;
     BEGIN
       SELECT n.kind INTO asked FROM native_action n
        WHERE n.tenant = NEW.tenant AND n.project = NEW.project
          AND n.action = NEW.action;
       IF NOT (${nativeActionPairing}) THEN
         RAISE EXCEPTION '% is not an answer a % asks for', NEW.resolution, asked
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       RETURN NEW;
     END $$`,
  `REVOKE EXECUTE ON FUNCTION native_action_resolution_pairs_with_its_kind() FROM PUBLIC`,
  `ALTER FUNCTION native_action_resolution_pairs_with_its_kind()
     OWNER TO ${boundaryOwnerRole}`,
  `CREATE TRIGGER native_action_resolution_pairs_with_its_kind
     BEFORE INSERT OR UPDATE ON native_action_resolution
     FOR EACH ROW EXECUTE FUNCTION native_action_resolution_pairs_with_its_kind()`,
];

/**
 * The server's own statements of what may not move, and the two boundaries the
 * finalizer reaches ticket-service-owned rows through: one submits a result
 * into the mailbox, the other asks a person to approve one prepared candidate.
 * Every relation this migration adds is revoked from every prior role before
 * anything is granted on it.
 */
export const durableFinalizerBoundaries = [
  `ALTER TABLE decision_input
     DROP CONSTRAINT decision_input_state_is_known,
     DROP CONSTRAINT decision_input_kind_state_agree,
     ADD CONSTRAINT decision_input_state_is_known CHECK (
       state IN ('Pending', 'Journaled', 'Answered', 'Refused', 'Cancelled', 'Stale')),
     ADD CONSTRAINT decision_input_kind_state_agree CHECK (
       (input_kind = 'Operation' AND
        state IN ('Pending', 'Journaled', 'Answered', 'Refused', 'Cancelled')) OR
       (input_kind = 'Continuation' AND state IN ('Pending', 'Journaled', 'Stale')))`,
  `CREATE OR REPLACE ${acceptanceBody}`,
  `GRANT UPDATE (resolution) ON native_action TO ${ticketServiceRole}`,
  `ALTER FUNCTION ticket_command_is_valid(jsonb)
     RENAME TO public_ticket_command_is_valid`,
  `CREATE OR REPLACE FUNCTION public_ticket_command_is_valid${publicCommandGrammarBody}`,
  `CREATE FUNCTION ticket_command_is_valid(command jsonb) RETURNS boolean
     LANGUAGE plpgsql IMMUTABLE AS $$
     BEGIN
       IF command IS NULL OR jsonb_typeof(command) <> 'object' THEN
         RETURN false;
       END IF;
       IF command->>'command' = 'SubmitFinalizationResult' THEN
         RETURN jsonb_typeof(command->'version') = 'number'
           AND command->>'version' = '1'
           AND jsonb_typeof(command->'request') = 'string'
           AND length(command->>'request') BETWEEN 1 AND ${finalizerIdentityCharsMax}
           AND jsonb_typeof(command->'attempt') = 'string'
           AND length(command->>'attempt') BETWEEN 1 AND ${finalizerIdentityCharsMax}
           AND command_integer(command->'requestGeneration')
           AND (command->>'requestGeneration')::numeric >= 1
           AND jsonb_typeof(command->'recoveryEpoch') = 'string'
           AND length(command->>'recoveryEpoch') BETWEEN 1 AND ${finalizerIdentityCharsMax}
           AND command->>'outcome' IN (${schemaTextSet(finalizationOutcomeTags)});
       END IF;
       RETURN public_ticket_command_is_valid(command)
         AND command->'event'->>'type' IS DISTINCT FROM 'FinalizationResult';
     END $$`,
  `ALTER FUNCTION ticket_command_is_valid(jsonb) OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ticket_command_is_valid(jsonb) FROM PUBLIC`,

  `CREATE FUNCTION durable_row_is_written_once() RETURNS trigger
     LANGUAGE plpgsql AS $$
     BEGIN
       RAISE EXCEPTION
         '% is written once, and a row that could be edited is not evidence', TG_TABLE_NAME
         USING ERRCODE = 'integrity_constraint_violation';
     END $$`,
  `REVOKE EXECUTE ON FUNCTION durable_row_is_written_once() FROM PUBLIC`,
  `CREATE TRIGGER finalization_attempt_is_written_once
     BEFORE UPDATE OR DELETE ON finalization_attempt
     FOR EACH ROW EXECUTE FUNCTION durable_row_is_written_once()`,
  `CREATE TRIGGER input_bundle_is_written_once
     BEFORE UPDATE OR DELETE ON input_bundle
     FOR EACH ROW EXECUTE FUNCTION durable_row_is_written_once()`,
  `CREATE TRIGGER input_bundle_reference_is_written_once
     BEFORE UPDATE OR DELETE ON input_bundle_reference
     FOR EACH ROW EXECUTE FUNCTION durable_row_is_written_once()`,

  `CREATE FUNCTION commit_permit_concludes_once() RETURNS trigger
     LANGUAGE plpgsql AS $$
     BEGIN
       IF OLD.state = 'Concluded' THEN
         RAISE EXCEPTION 'permit % is already concluded, and a permit is spent once', OLD.permit
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       IF (NEW.tenant, NEW.project, NEW.permit, NEW.attempt, NEW.recovery_epoch,
           NEW.lifecycle_generation)
          IS DISTINCT FROM
          (OLD.tenant, OLD.project, OLD.permit, OLD.attempt, OLD.recovery_epoch,
           OLD.lifecycle_generation) THEN
         RAISE EXCEPTION 'permit % would change the identity, epoch or generation it was granted under',
           OLD.permit USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       RETURN NEW;
     END $$`,
  `REVOKE EXECUTE ON FUNCTION commit_permit_concludes_once() FROM PUBLIC`,
  `CREATE TRIGGER commit_permit_concludes_once
     BEFORE UPDATE ON commit_permit
     FOR EACH ROW EXECUTE FUNCTION commit_permit_concludes_once()`,

  `CREATE FUNCTION finalization_reconciliation_concludes_once() RETURNS trigger
     LANGUAGE plpgsql AS $$
     BEGIN
       IF OLD.verdict <> 'Unreadable' THEN
         RAISE EXCEPTION
           'reconciliation of permit % already concluded %, and a verdict is read once',
           OLD.permit, OLD.verdict USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       IF (NEW.tenant, NEW.project, NEW.permit, NEW.candidate_commit, NEW.target_ref)
          IS DISTINCT FROM
          (OLD.tenant, OLD.project, OLD.permit, OLD.candidate_commit, OLD.target_ref) THEN
         RAISE EXCEPTION
           'reconciliation of permit % would change the candidate or ref it was read against',
           OLD.permit USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       RETURN NEW;
     END $$`,
  `REVOKE EXECUTE ON FUNCTION finalization_reconciliation_concludes_once() FROM PUBLIC`,
  `CREATE TRIGGER finalization_reconciliation_concludes_once
     BEFORE UPDATE ON finalization_reconciliation
     FOR EACH ROW EXECUTE FUNCTION finalization_reconciliation_concludes_once()`,

  `CREATE FUNCTION ${finalizationFunction}(
      in_tenant text, in_project text, in_request text, in_attempt text,
      in_outcome text, in_failure_kind text, in_request_generation bigint,
      in_recovery_epoch text, in_operation text, in_authority_subject text)
     RETURNS TABLE(result text, operation text, ordinal bigint)
     LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
     DECLARE bound record; project_lifecycle text; project_generation bigint;
       next_ordinal bigint; command_value jsonb; current_epoch text;
       scoped_digest text; settled text;
     BEGIN
       IF in_outcome NOT IN (${schemaTextSet(finalizationOutcomeTags)}) THEN
         RAISE EXCEPTION 'finalization outcome % is not one this boundary submits', in_outcome
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       scoped_digest := encode(sha256(convert_to('finalization:' || in_request, 'UTF8')), 'hex');
       SELECT f.ticket, f.state, f.request_generation, f.recovery_epoch,
              a.attempt, a.outcome AS attempt_outcome, a.failure_kind,
              p.state AS permit_state, r.verdict
         INTO bound
         FROM finalization_request f
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
          AND o.authority_kind = '${finalizerAuthorityKind}' AND o.key_digest = scoped_digest;
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
          OR bound.attempt IS NULL
          OR (in_outcome = 'FinalizationFailed'
              AND (bound.attempt_outcome <> 'Failed'
                   OR bound.failure_kind IS DISTINCT FROM in_failure_kind))
          OR (in_outcome = 'FinalizationSucceeded'
              AND (in_failure_kind IS NOT NULL
                   OR bound.attempt_outcome <> 'Prepared'
                   OR bound.permit_state IS DISTINCT FROM 'Concluded'
                   OR bound.verdict IS DISTINCT FROM 'Promoted'))
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
         'attempt', in_attempt, 'requestGeneration', in_request_generation,
         'recoveryEpoch', in_recovery_epoch, 'outcome', in_outcome);
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
       VALUES (in_tenant, in_project, in_operation, '${finalizerAuthorityKind}',
          in_authority_subject, 'CorrectnessReducing', '${finalizerKeyVersion}',
          scoped_digest,
          encode(sha256(convert_to(command_value::text, 'UTF8')), 'hex'),
          command_value::text, 'FinalizationResult');
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
  `CREATE FUNCTION ${approvalRequestFunction}(
      in_tenant text, in_project text, in_attempt text, in_action text,
      in_recovery_epoch text)
     RETURNS TABLE(result text, action text)
     LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
     DECLARE bound record; standing record; requested text; current_epoch text;
     BEGIN
       SELECT a.ticket, a.outcome, a.approval_required,
              f.state AS request_state, f.recovery_epoch AS request_epoch,
              f.authorizing_seq, f.effect_position, t.phase
         INTO bound
         FROM finalization_attempt a
         JOIN finalization_request f
           ON f.tenant = a.tenant AND f.project = a.project AND f.request = a.request
         LEFT JOIN ticket_projection t
           ON t.tenant = a.tenant AND t.project = a.project AND t.ticket = a.ticket
        WHERE a.tenant = in_tenant AND a.project = in_project AND a.attempt = in_attempt
        FOR UPDATE OF f;
       IF NOT FOUND THEN
         RETURN QUERY SELECT 'UnknownAttempt'::text, NULL::text; RETURN;
       END IF;
       SELECT n.action INTO requested FROM native_action n
        WHERE n.tenant = in_tenant AND n.project = in_project AND n.attempt = in_attempt;
       IF requested IS NOT NULL THEN
         RETURN QUERY SELECT 'AlreadyRequested'::text, requested; RETURN;
       END IF;
       SELECT n.action, n.kind INTO standing FROM native_action n
        WHERE n.tenant = in_tenant AND n.project = in_project
          AND n.ticket = bound.ticket AND n.state = 'Open';
       IF standing.action IS NOT NULL AND standing.kind <> 'FinalizationApproval' THEN
         RETURN QUERY SELECT 'TicketHasAnOpenAction'::text, standing.action; RETURN;
       END IF;
       SELECT e.epoch INTO current_epoch FROM recovery_epoch e ORDER BY e.ordinal DESC LIMIT 1;
       IF bound.outcome <> 'Prepared'
          OR bound.approval_required IS NOT TRUE
          OR bound.request_state NOT IN ('Open', 'Registered')
          OR bound.request_epoch IS DISTINCT FROM in_recovery_epoch
          OR current_epoch IS DISTINCT FROM in_recovery_epoch
          OR bound.phase IS DISTINCT FROM 'Finalizing'
       THEN
         RETURN QUERY SELECT 'BindingMismatch'::text, NULL::text; RETURN;
       END IF;
       IF standing.action IS NOT NULL THEN
         UPDATE native_action n SET state = 'Withdrawn'
          WHERE n.tenant = in_tenant AND n.project = in_project
            AND n.action = standing.action AND n.state = 'Open';
       END IF;
       INSERT INTO native_action
         (tenant, project, action, authorizing_seq, effect_position, ticket,
          action_version, kind, reason, required_capability, attempt)
       VALUES (in_tenant, in_project, in_action, bound.authorizing_seq,
          bound.effect_position, bound.ticket, bound.authorizing_seq,
          'FinalizationApproval', 'NoReason', 'ApproveFinalization', in_attempt);
       INSERT INTO native_action_resolution (tenant, project, action, resolution)
       SELECT in_tenant, in_project, in_action,
              unnest(ARRAY[${schemaTextSet(nativeActionResolutions.FinalizationApproval)}]);
       RETURN QUERY SELECT 'Requested'::text, in_action;
     END $$`,
  `ALTER FUNCTION ${approvalRequestFunction}(text,text,text,text,text)
     OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${approvalRequestFunction}(text,text,text,text,text) FROM PUBLIC`,
  `ALTER FUNCTION ${finalizationFunction}(text,text,text,text,text,text,bigint,text,text,text)
     OWNER TO ${boundaryOwnerRole}`,
  `ALTER FUNCTION durable_row_is_written_once() OWNER TO ${boundaryOwnerRole}`,
  `ALTER FUNCTION commit_permit_concludes_once() OWNER TO ${boundaryOwnerRole}`,
  `ALTER FUNCTION finalization_reconciliation_concludes_once() OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${finalizationFunction}(text,text,text,text,text,text,bigint,text,text,text) FROM PUBLIC`,

  `REVOKE ALL ON project_repository, finalization_attempt, commit_permit,
     finalization_reconciliation
     FROM ${apiRole}, ${ticketServiceRole}, ${selectorServiceRole}, ${schedulerRole}`,
  `REVOKE ALL ON input_bundle, input_bundle_reference
     FROM ${apiRole}, ${selectorServiceRole}, ${schedulerRole}`,
  `REVOKE ALL ON journal_entry, decision_input, operation, ticket_projection,
     project_notification, project_continuation, native_action_resolution,
     execution_request, execution_request_task, draft, draft_revision,
     execution, execution_attempt, execution_result, execution_result_artifact,
     scheduler_incident, execution_cluster, capacity_account,
     dispatch_view, dispatch_candidate, dispatch_candidate_dependency,
     selector_project_state, selector_inventory_state, selector_interaction,
     selector_planning_intent, selector_proposal_delivery
     FROM ${finalizerRole}`,

  `GRANT SELECT, INSERT ON input_bundle, input_bundle_reference TO ${ticketServiceRole}`,
  `GRANT SELECT ON finalization_attempt TO ${ticketServiceRole}`,

  `GRANT SELECT ON finalization_request, finalization_attempt, commit_permit,
     finalization_reconciliation, recovery_epoch, ticket_projection
     TO ${boundaryOwnerRole}`,
  `GRANT UPDATE (state) ON finalization_request TO ${boundaryOwnerRole}`,

  `GRANT SELECT ON recovery_epoch, project_repository, input_bundle,
     input_bundle_reference, configuration_revision, native_action,
     native_action_resolution TO ${finalizerRole}`,
  `GRANT INSERT ON input_bundle, input_bundle_reference TO ${finalizerRole}`,
  `GRANT SELECT ON execution, execution_request_task, execution_result,
     execution_result_artifact TO ${finalizerRole}`,
  `GRANT SELECT (tenant, project, lifecycle, lifecycle_generation)
     ON project TO ${finalizerRole}`,
  `GRANT SELECT ON finalization_request TO ${finalizerRole}`,
  `GRANT UPDATE (state, claim_owner, claim_generation, claim_expires_at, recovery_epoch)
     ON finalization_request TO ${finalizerRole}`,
  `GRANT SELECT, INSERT ON finalization_attempt TO ${finalizerRole}`,
  `GRANT SELECT, INSERT ON commit_permit TO ${finalizerRole}`,
  `GRANT UPDATE (state, concluded_at) ON commit_permit TO ${finalizerRole}`,
  `GRANT SELECT, INSERT ON finalization_reconciliation TO ${finalizerRole}`,
  `GRANT UPDATE (verdict, observed_commit, reconciled_at)
     ON finalization_reconciliation TO ${finalizerRole}`,
  `GRANT EXECUTE ON FUNCTION ${finalizationFunction}(text,text,text,text,text,text,bigint,text,text,text)
     TO ${finalizerRole}`,
  `GRANT EXECUTE ON FUNCTION ${approvalRequestFunction}(text,text,text,text,text)
     TO ${finalizerRole}`,

  `REVOKE CREATE ON SCHEMA public FROM ${boundaryOwnerRole}`,
  `REVOKE ${boundaryOwnerRole} FROM CURRENT_USER`,
];

export const finalizerMigrations: readonly Migration[] = [
  {
    version: 13,
    name: "the durable finalizer",
    statements: [...durableFinalizer, ...durableFinalizerBoundaries],
  },
];
