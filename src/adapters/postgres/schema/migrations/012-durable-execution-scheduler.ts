import { verdictTags } from "../../../../domain/generated/modelTypes.ts";
import {
  allAttemptStates,
  allBlockedReasons,
  allExecutionOutcomes,
  allExecutionStatuses,
  allSchedulerIncidentKinds,
  executionCapacityDefaults,
  executionSchedulerAuthorityKind,
  schedulerEvidenceCharsMax,
} from "../../../../interpreter/executionScheduler.ts";
import {
  allArtifactRoles,
  artifactBytesMax,
  artifactDigestChars,
  artifactPathCharsMax,
  manifestArtifactsMax,
  resultDigestFoldHexChars,
} from "../../../../interpreter/resultManifest.ts";
import { schedulerIdentityCharsMax } from "../../../../interpreter/schedulerIdentity.ts";
import {
  accountIdentityFunction,
  accountProvisionFunction,
  activeWorkFunction,
  apiRole,
  backlogFunction,
  boundaryOwnerRole,
  completionFunction,
  digestFoldFunction,
  roleStatement,
  schedulerRole,
  schemaTextSet,
  statusMoveFunction,
  ticketServiceRole,
  type Migration,
} from "../shared.ts";

const capacityAccountDefaults = [
  `\x27${executionCapacityDefaults.cluster}\x27`,
  String(executionCapacityDefaults.accountReserved),
  String(executionCapacityDefaults.accountMaximum),
  "1",
].join(", ");

/**
 * The columns a logical execution's requirement is materialized into, named
 * once for the create that spells them and the upgrade that adds and grants
 * them.
 */
export const executionRequirementColumns = [
  { name: "requirement_identity", type: "text" },
  { name: "requirement_value", type: "jsonb" },
  { name: "requirement_digest", type: "text" },
  { name: "requirement_source", type: "text" },
  { name: "platform_default_version", type: "bigint" },
] as const;

export const executionRequirementColumnNames = executionRequirementColumns
  .map(({ name }) => name)
  .join(",");

/**
 * Installed by the migration that creates it and by the one that upgrades a
 * database which never got it, so the two cannot disagree about the body.
 */
export const materializeLegacyRequirementDefinition = `FUNCTION materialize_legacy_execution_requirement() RETURNS trigger
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE configuration jsonb;
     BEGIN
       IF NEW.requirement_identity IS NOT NULL THEN RETURN NEW; END IF;
       SELECT canonical::jsonb INTO STRICT configuration FROM configuration_revision
         WHERE tenant=NEW.tenant AND project=NEW.project
           AND revision=NEW.configuration_revision AND digest=NEW.configuration_digest;
       NEW.requirement_identity=NEW.execution;
       NEW.requirement_value=jsonb_build_object('mode','Container','operatingSystem','Linux',
         'architecture','Amd64','image',configuration->>'image');
       NEW.requirement_digest=encode(sha256(convert_to(format(
         '{"mode":"Container","operatingSystem":"Linux","architecture":"Amd64","image":%s}',
         to_json(configuration->>'image')::text),'UTF8')),'hex');
       NEW.requirement_source='PlatformDefault';
       NEW.platform_default_version=1;
       RETURN NEW;
     END $$`;

/** The relations, triggers and boundaries the execution scheduler owns, which I6 adds. */
const durableExecutionScheduler = [
  roleStatement(schedulerRole),
  `ALTER ROLE ${schedulerRole} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
  `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${schedulerRole}`,
  `REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM ${schedulerRole}`,
  `GRANT USAGE ON SCHEMA public TO ${schedulerRole}`,
  `GRANT ${boundaryOwnerRole} TO CURRENT_USER`,
  `GRANT CREATE ON SCHEMA public TO ${boundaryOwnerRole}`,

  /**
   * A project's identity is its tenant and its project together, so the account
   * named for one carries both. The encoding is length-prefixed rather than
   * delimiter-joined because both halves are opaque text: a delimiter one of
   * them contains would let two projects spell one account name, which is one
   * entitlement two tenants would spend against.
   */
  `CREATE FUNCTION ${accountIdentityFunction}(in_tenant text, in_project text)
     RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
       SELECT octet_length(in_tenant)::text || ':' || in_tenant
           || octet_length(in_project)::text || ':' || in_project
     $$`,

  `ALTER TABLE execution_request
     ADD COLUMN capacity_account       text,
     ADD COLUMN configuration_revision text,
     ADD COLUMN configuration_digest   text`,
  `UPDATE execution_request r
      SET capacity_account = ${accountIdentityFunction}(r.tenant, r.project),
          configuration_revision = j.configuration_revision,
          configuration_digest = j.configuration_digest
     FROM journal_entry j
    WHERE j.tenant = r.tenant AND j.project = r.project AND j.seq = r.authorizing_seq
      AND r.kind IN ('SpawnWork', 'SpawnEvaluation')`,
  `DO $$ BEGIN
     IF EXISTS (SELECT 1 FROM execution_request
                 WHERE kind IN ('SpawnWork','SpawnEvaluation')
                   AND (capacity_account IS NULL OR configuration_revision IS NULL
                        OR configuration_digest IS NULL))
     THEN RAISE EXCEPTION 'I6 found a spawn request with no retained configuration to pin';
     END IF;
   END $$`,
  `ALTER TABLE execution_request
     ADD CONSTRAINT execution_request_pins_are_whole CHECK (
       (kind IN ('SpawnWork','SpawnEvaluation')) = (capacity_account IS NOT NULL)
       AND (kind IN ('SpawnWork','SpawnEvaluation')) = (configuration_revision IS NOT NULL)
       AND (kind IN ('SpawnWork','SpawnEvaluation')) = (configuration_digest IS NOT NULL)
       AND coalesce(length(capacity_account), 1) BETWEEN 1 AND ${schedulerIdentityCharsMax}),
     ADD CONSTRAINT execution_request_configuration_is_retained
       FOREIGN KEY (tenant, project, configuration_revision, configuration_digest)
       REFERENCES configuration_revision (tenant, project, revision, digest),
     ADD CONSTRAINT execution_request_ticket_is_referenceable
       UNIQUE (tenant, project, request, ticket)`,
  `CREATE INDEX execution_request_claimable
     ON execution_request (kind, authorizing_seq) WHERE state = 'Open'`,

  `ALTER TABLE project
     ADD COLUMN manifest_next bigint NOT NULL DEFAULT 1,
     ADD CONSTRAINT project_manifest_next_is_positive CHECK (manifest_next >= 1)`,

  `CREATE TABLE execution_cluster (
     cluster         text    NOT NULL,
     slots_max       integer NOT NULL,
     policy_revision bigint  NOT NULL,
     PRIMARY KEY (cluster),
     CONSTRAINT execution_cluster_slots_are_bounded CHECK (slots_max >= 0),
     CONSTRAINT execution_cluster_policy_is_positive CHECK (policy_revision >= 1),
     CONSTRAINT execution_cluster_identity_is_bounded CHECK (
       length(cluster) BETWEEN 1 AND ${schedulerIdentityCharsMax})
   )`,
  `CREATE TABLE capacity_account (
     account         text    NOT NULL,
     cluster         text    NOT NULL REFERENCES execution_cluster (cluster),
     reserved        integer NOT NULL,
     maximum         integer NOT NULL,
     policy_revision bigint  NOT NULL,
     PRIMARY KEY (account),
     CONSTRAINT capacity_account_entitlement_is_ordered CHECK (
       reserved >= 0 AND maximum >= reserved),
     CONSTRAINT capacity_account_policy_is_positive CHECK (policy_revision >= 1),
     CONSTRAINT capacity_account_identity_is_bounded CHECK (
       length(account) BETWEEN 1 AND ${schedulerIdentityCharsMax}),
     CONSTRAINT capacity_account_draws_from_one_cluster UNIQUE (account, cluster)
   )`,
  `INSERT INTO execution_cluster (cluster, slots_max, policy_revision)
     VALUES ('${executionCapacityDefaults.cluster}',
             ${executionCapacityDefaults.clusterSlotsMax}, 1)`,
  `INSERT INTO capacity_account (account, cluster, reserved, maximum, policy_revision)
     SELECT ${accountIdentityFunction}(p.tenant, p.project), ${capacityAccountDefaults}
       FROM project p ON CONFLICT (account) DO NOTHING`,
  `CREATE FUNCTION ${accountProvisionFunction}() RETURNS trigger
     LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
     BEGIN
       INSERT INTO capacity_account (account, cluster, reserved, maximum, policy_revision)
       VALUES (${accountIdentityFunction}(NEW.tenant, NEW.project), ${capacityAccountDefaults})
       ON CONFLICT (account) DO NOTHING;
       RETURN NULL;
     END $$`,
  `REVOKE EXECUTE ON FUNCTION ${accountProvisionFunction}() FROM PUBLIC`,
  `CREATE TRIGGER project_has_a_capacity_account
     AFTER INSERT ON project
     FOR EACH ROW EXECUTE FUNCTION ${accountProvisionFunction}()`,

  `CREATE TABLE execution (
     tenant                 text   NOT NULL,
     project                text   NOT NULL,
     execution              text   NOT NULL,
     ticket                 bigint NOT NULL,
     task                   bigint NOT NULL,
     source_request         text   NOT NULL,
     account                text   NOT NULL,
     cluster                text   NOT NULL,
     configuration_revision text   NOT NULL,
     configuration_digest   text   NOT NULL,
     requirement_identity   text   NOT NULL,
     requirement_value      jsonb  NOT NULL,
     requirement_digest     text   NOT NULL,
     requirement_source     text   NOT NULL,
     platform_default_version bigint NOT NULL,
     status                 text   NOT NULL DEFAULT 'Queued',
     outcome                text,
     blocked_reason         text,
     result_manifest        text,
     completion_operation   text,
     attempt_next           bigint NOT NULL DEFAULT 1,
     retries_spent          bigint NOT NULL DEFAULT 0,
     placement_backoff_from timestamptz,
     registered_at          timestamptz NOT NULL DEFAULT now(),
     terminal_at            timestamptz,
     PRIMARY KEY (tenant, project, execution),
     CONSTRAINT execution_identity_is_never_reused UNIQUE (execution),
     CONSTRAINT execution_requirement_identity_unique UNIQUE (requirement_identity),
     CONSTRAINT execution_names_one_logical_task UNIQUE (tenant, project, ticket, task),
     CONSTRAINT execution_completion_is_its_own UNIQUE (tenant, project, completion_operation),
     CONSTRAINT execution_belongs_to_project
       FOREIGN KEY (tenant, project) REFERENCES project (tenant, project),
     CONSTRAINT execution_has_its_authorized_task
       FOREIGN KEY (tenant, project, source_request, task)
       REFERENCES execution_request_task (tenant, project, request, task),
     CONSTRAINT execution_has_its_authorized_ticket
       FOREIGN KEY (tenant, project, source_request, ticket)
       REFERENCES execution_request (tenant, project, request, ticket),
     CONSTRAINT execution_account_draws_its_cluster
       FOREIGN KEY (account, cluster) REFERENCES capacity_account (account, cluster),
     CONSTRAINT execution_configuration_is_retained
       FOREIGN KEY (tenant, project, configuration_revision, configuration_digest)
       REFERENCES configuration_revision (tenant, project, revision, digest),
     CONSTRAINT execution_completion_is_an_operation
       FOREIGN KEY (tenant, project, completion_operation)
       REFERENCES operation (tenant, project, operation),
     CONSTRAINT execution_status_is_known CHECK (
       status IN (${schemaTextSet(allExecutionStatuses)})),
     CONSTRAINT execution_outcome_is_known CHECK (
       outcome IS NULL OR outcome IN (${schemaTextSet(allExecutionOutcomes)})),
     CONSTRAINT execution_blocked_reason_is_known CHECK (
       blocked_reason IS NULL OR blocked_reason IN (${schemaTextSet(allBlockedReasons)})),
     CONSTRAINT execution_requirement_source_known CHECK (requirement_source IN
       ('ExplicitTask','TaskKindDefault','TicketDefault','PlatformDefault')),
     CONSTRAINT execution_platform_default_version_positive CHECK (
       platform_default_version >= 1),
     CONSTRAINT execution_counters_are_positive CHECK (
       ticket >= 1 AND task >= 1 AND attempt_next >= 1 AND retries_spent >= 0),
     CONSTRAINT execution_identity_is_bounded CHECK (
       length(execution) BETWEEN 1 AND ${schedulerIdentityCharsMax}),
     CONSTRAINT execution_outcome_is_whole CHECK (
       (status = 'Terminal') = (outcome IS NOT NULL)
       AND (status = 'Terminal') = (completion_operation IS NOT NULL)
       AND (status IN ('Terminal','Cancelled')) = (terminal_at IS NOT NULL)
       AND (outcome IS NOT NULL AND outcome IS DISTINCT FROM 'Blocked')
           = (result_manifest IS NOT NULL)
       AND (outcome IS NOT DISTINCT FROM 'Blocked') = (blocked_reason IS NOT NULL))
   )`,
  `CREATE INDEX execution_queued ON execution (cluster, registered_at) WHERE status = 'Queued'`,
  `CREATE INDEX execution_active_by_cluster ON execution (cluster)
     WHERE status IN ('Admitted','Launching','Running')`,
  `CREATE INDEX execution_active_by_account ON execution (account)
     WHERE status IN ('Admitted','Launching','Running')`,
  `CREATE INDEX execution_live_by_project ON execution (tenant, project, status)
     WHERE status NOT IN ('Terminal','Cancelled')`,
  `CREATE INDEX execution_by_request ON execution (tenant, project, source_request)`,
  `CREATE ${materializeLegacyRequirementDefinition}`,
  `ALTER FUNCTION materialize_legacy_execution_requirement() OWNER TO ${boundaryOwnerRole}`,
  `CREATE TRIGGER execution_materializes_legacy_requirement
     BEFORE INSERT ON execution FOR EACH ROW
     EXECUTE FUNCTION materialize_legacy_execution_requirement()`,
  `REVOKE ALL ON FUNCTION materialize_legacy_execution_requirement() FROM PUBLIC`,

  `CREATE TABLE execution_attempt (
     tenant           text   NOT NULL,
     project          text   NOT NULL,
     execution        text   NOT NULL,
     attempt          text   NOT NULL,
     attempt_number   bigint NOT NULL,
     generation       bigint NOT NULL DEFAULT 1,
     recovery_epoch   text   NOT NULL REFERENCES recovery_epoch (epoch),
     state            text   NOT NULL DEFAULT 'Placing',
     lease_owner      text,
     lease_expires_at timestamptz,
     workload         text,
     evidence         text,
     opened_at        timestamptz NOT NULL DEFAULT now(),
     ended_at         timestamptz,
     PRIMARY KEY (tenant, project, execution, attempt_number),
     CONSTRAINT execution_attempt_identity_is_never_reused UNIQUE (attempt),
     CONSTRAINT execution_attempt_identity_is_local UNIQUE (tenant, project, execution, attempt),
     CONSTRAINT execution_attempt_has_its_execution
       FOREIGN KEY (tenant, project, execution) REFERENCES execution (tenant, project, execution),
     CONSTRAINT execution_attempt_state_is_known CHECK (
       state IN (${schemaTextSet(allAttemptStates)})),
     CONSTRAINT execution_attempt_lease_is_whole CHECK (
       (lease_owner IS NULL) = (lease_expires_at IS NULL)),
     CONSTRAINT execution_attempt_ending_is_whole CHECK (
       (state IN ('Placing','Running')) = (ended_at IS NULL)),
     CONSTRAINT execution_attempt_evidence_is_whole CHECK (
       evidence IS NULL OR state NOT IN ('Placing','Running')),
     CONSTRAINT execution_attempt_counters_are_positive CHECK (
       attempt_number >= 1 AND generation >= 1),
     CONSTRAINT execution_attempt_text_is_bounded CHECK (
       length(attempt) BETWEEN 1 AND ${schedulerIdentityCharsMax}
       AND coalesce(length(lease_owner), 1) BETWEEN 1 AND ${schedulerIdentityCharsMax}
       AND coalesce(length(workload), 1) BETWEEN 1 AND ${schedulerIdentityCharsMax}
       AND coalesce(length(evidence), 0) <= ${schedulerEvidenceCharsMax})
   )`,
  `CREATE UNIQUE INDEX execution_attempt_one_authoritative
     ON execution_attempt (tenant, project, execution) WHERE state IN ('Placing','Running')`,
  `CREATE INDEX execution_attempt_lease_expiry ON execution_attempt (lease_expires_at)
     WHERE state IN ('Placing','Running')`,
  `CREATE INDEX execution_attempt_epoch ON execution_attempt (recovery_epoch)
     WHERE state IN ('Placing','Running')`,

  `CREATE TABLE execution_result (
     tenant           text    NOT NULL,
     project          text    NOT NULL,
     manifest         text    NOT NULL,
     execution        text    NOT NULL,
     attempt          text    NOT NULL,
     manifest_ordinal bigint  NOT NULL,
     schema_version   integer NOT NULL,
     digest           text    NOT NULL,
     verdict          text    NOT NULL,
     recorded_at      timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (tenant, project, manifest),
     CONSTRAINT execution_result_identity_is_never_reused UNIQUE (manifest),
     CONSTRAINT execution_result_ordinal_is_project_local UNIQUE (tenant, project, manifest_ordinal),
     CONSTRAINT execution_result_is_one_per_execution UNIQUE (tenant, project, execution),
     CONSTRAINT execution_result_is_referenceable UNIQUE (tenant, project, execution, manifest),
     CONSTRAINT execution_result_is_one_per_attempt UNIQUE (tenant, project, attempt),
     CONSTRAINT execution_result_has_its_attempt
       FOREIGN KEY (tenant, project, execution, attempt)
       REFERENCES execution_attempt (tenant, project, execution, attempt),
     CONSTRAINT execution_result_verdict_is_known CHECK (
       verdict IN (${schemaTextSet(verdictTags)})),
     CONSTRAINT execution_result_counters_are_positive CHECK (
       manifest_ordinal >= 1 AND schema_version >= 1),
     CONSTRAINT execution_result_digest_is_hex CHECK (
       digest ~ '^[0-9a-f]{${artifactDigestChars}}$'),
     CONSTRAINT execution_result_identity_is_bounded CHECK (
       length(manifest) BETWEEN 1 AND ${schedulerIdentityCharsMax})
   )`,
  `CREATE TABLE execution_result_artifact (
     tenant   text    NOT NULL,
     project  text    NOT NULL,
     manifest text    NOT NULL,
     ordinal  integer NOT NULL,
     role     text    NOT NULL,
     path     text    NOT NULL,
     digest   text    NOT NULL,
     bytes    bigint  NOT NULL,
     PRIMARY KEY (tenant, project, manifest, ordinal),
     CONSTRAINT execution_result_artifact_has_its_manifest
       FOREIGN KEY (tenant, project, manifest) REFERENCES execution_result (tenant, project, manifest),
     CONSTRAINT execution_result_artifact_path_is_declared_once
       UNIQUE (tenant, project, manifest, path),
     CONSTRAINT execution_result_artifact_role_is_known CHECK (
       role IN (${schemaTextSet(allArtifactRoles)})),
     CONSTRAINT execution_result_artifact_count_is_bounded CHECK (
       ordinal BETWEEN 1 AND ${manifestArtifactsMax}),
     CONSTRAINT execution_result_artifact_size_is_bounded CHECK (
       bytes BETWEEN 0 AND ${artifactBytesMax}),
     CONSTRAINT execution_result_artifact_digest_is_hex CHECK (
       digest ~ '^[0-9a-f]{${artifactDigestChars}}$'),
     CONSTRAINT execution_result_artifact_path_is_normalized CHECK (
       length(path) BETWEEN 1 AND ${artifactPathCharsMax}
       AND path !~ '^/' AND path !~ '//' AND path !~ '[\\\\]'
       AND path !~ '(^|/)[.][.]?(/|$)'
       AND path !~ '[[:cntrl:]]'
       AND path !~ '(^|/)[[:space:]]' AND path !~ '[[:space:]](/|$)')
   )`,
  `CREATE FUNCTION execution_result_is_immutable() RETURNS trigger
     LANGUAGE plpgsql AS $$
     BEGIN
       RAISE EXCEPTION
         'result manifest % is written once, and a manifest that could be edited is not evidence',
         OLD.manifest
         USING ERRCODE = 'integrity_constraint_violation';
     END $$`,
  `REVOKE EXECUTE ON FUNCTION execution_result_is_immutable() FROM PUBLIC`,
  `CREATE TRIGGER execution_result_is_written_once
     BEFORE UPDATE OR DELETE ON execution_result
     FOR EACH ROW EXECUTE FUNCTION execution_result_is_immutable()`,
  `CREATE TRIGGER execution_result_artifact_is_written_once
     BEFORE UPDATE OR DELETE ON execution_result_artifact
     FOR EACH ROW EXECUTE FUNCTION execution_result_is_immutable()`,
  /**
   * The body runs as whoever wrote the row rather than as the boundary owner,
   * so the schemas it resolves names in are that caller's. `TEMPORARY` is a
   * privilege every role holds by default and a temporary schema is searched
   * ahead of `public`, so an unpinned path lets the writer stand an empty
   * `execution_attempt` in front of the real one and read back no fence.
   */
  `CREATE FUNCTION execution_result_reporter_is_unfenced() RETURNS trigger
     LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
     DECLARE reporter text;
     BEGIN
       SELECT a.state INTO reporter FROM execution_attempt a
        WHERE a.tenant = NEW.tenant AND a.project = NEW.project
          AND a.execution = NEW.execution AND a.attempt = NEW.attempt;
       IF reporter = 'Superseded' THEN
         RAISE EXCEPTION
           'attempt % was fenced, and a fenced reporter''s manifest is not evidence',
           NEW.attempt USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       RETURN NEW;
     END $$`,
  `REVOKE EXECUTE ON FUNCTION execution_result_reporter_is_unfenced() FROM PUBLIC`,
  `CREATE TRIGGER execution_result_comes_from_an_unfenced_attempt
     BEFORE INSERT ON execution_result
     FOR EACH ROW EXECUTE FUNCTION execution_result_reporter_is_unfenced()`,
  `ALTER TABLE execution ADD CONSTRAINT execution_result_is_its_own
     FOREIGN KEY (tenant, project, execution, result_manifest)
     REFERENCES execution_result (tenant, project, execution, manifest)`,

  `CREATE TABLE scheduler_incident (
     tenant      text NOT NULL,
     project     text NOT NULL,
     incident    text NOT NULL,
     kind        text NOT NULL,
     execution   text,
     attempt     text,
     evidence    text NOT NULL,
     observed_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (tenant, project, incident),
     CONSTRAINT scheduler_incident_identity_is_never_reused UNIQUE (incident),
     CONSTRAINT scheduler_incident_belongs_to_project
       FOREIGN KEY (tenant, project) REFERENCES project (tenant, project),
     CONSTRAINT scheduler_incident_kind_is_known CHECK (
       kind IN (${schemaTextSet(allSchedulerIncidentKinds)})),
     CONSTRAINT scheduler_incident_evidence_is_bounded CHECK (
       length(evidence) BETWEEN 1 AND ${schedulerEvidenceCharsMax}),
     CONSTRAINT scheduler_incident_subject_is_bounded CHECK (
       coalesce(length(execution), 1) BETWEEN 1 AND ${schedulerIdentityCharsMax}
       AND coalesce(length(attempt), 1) BETWEEN 1 AND ${schedulerIdentityCharsMax})
   )`,
  `CREATE INDEX scheduler_incident_recent ON scheduler_incident (tenant, project, observed_at DESC)`,
];

/**
 * Installed by the migration that creates it and by the one that upgrades a
 * database whose copy predates the requirement columns, so the tuple this
 * body compares cannot fall behind the columns the table has.
 */
export const executionMovesLegallyDefinition = `FUNCTION execution_moves_legally() RETURNS trigger
     LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
     DECLARE reported text;
     BEGIN
       IF OLD.status IN ('Terminal', 'Cancelled') THEN
         RAISE EXCEPTION 'execution % is already %, and a settled execution is written once',
           OLD.execution, OLD.status USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       IF (NEW.tenant, NEW.project, NEW.execution, NEW.ticket, NEW.task, NEW.source_request,
           NEW.account, NEW.cluster, NEW.configuration_revision, NEW.configuration_digest,
           NEW.requirement_identity,NEW.requirement_value,NEW.requirement_digest,
           NEW.requirement_source,NEW.platform_default_version)
          IS DISTINCT FROM
          (OLD.tenant, OLD.project, OLD.execution, OLD.ticket, OLD.task, OLD.source_request,
           OLD.account, OLD.cluster, OLD.configuration_revision, OLD.configuration_digest,
           OLD.requirement_identity,OLD.requirement_value,OLD.requirement_digest,
           OLD.requirement_source,OLD.platform_default_version) THEN
         RAISE EXCEPTION 'execution % would change an identity or a pin it was registered under',
           OLD.execution USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       IF NEW.status IS DISTINCT FROM OLD.status
          AND NOT ${statusMoveFunction}(OLD.status, NEW.status) THEN
         RAISE EXCEPTION 'execution % may not move from % to %',
           OLD.execution, OLD.status, NEW.status
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       IF NEW.attempt_next < OLD.attempt_next OR NEW.retries_spent < OLD.retries_spent THEN
         RAISE EXCEPTION 'execution % would reuse an attempt number or unspend a retry',
           OLD.execution USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       IF NEW.result_manifest IS NOT NULL THEN
         SELECT r.verdict INTO reported FROM execution_result r
          WHERE r.tenant = NEW.tenant AND r.project = NEW.project
            AND r.manifest = NEW.result_manifest;
         IF (NEW.outcome = 'Passed') IS DISTINCT FROM (reported = 'Pass') THEN
           RAISE EXCEPTION 'execution % settles % over a manifest that reported %',
             OLD.execution, NEW.outcome, reported
             USING ERRCODE = 'integrity_constraint_violation';
         END IF;
       END IF;
       RETURN NEW;
     END $$`;

/**
 * The server's own statements of what may move, and the boundaries the runtime
 * roles reach it through. The boundary owner owns what its `SECURITY DEFINER`
 * bodies call and reads what they read, and the scheduler is granted the move
 * table because its own status updates are what fire the trigger consulting it
 * and `SELECT` on the manifest counter because allocating an ordinal reads the
 * column it advances.
 */
const durableExecutionSchedulerBoundaries = [
  `CREATE FUNCTION ${statusMoveFunction}(before text, after text) RETURNS boolean
     LANGUAGE sql IMMUTABLE STRICT AS $$
       SELECT CASE before
         WHEN 'Queued'    THEN after IN ('Admitted', 'Cancelled')
         WHEN 'Admitted'  THEN after IN ('Launching', 'Terminal', 'Cancelled')
         WHEN 'Launching' THEN after IN ('Running', 'Terminal', 'Cancelled')
         WHEN 'Running'   THEN after IN ('Terminal', 'Cancelled')
         WHEN 'Terminal'  THEN after = 'Terminal'
         WHEN 'Cancelled' THEN after = 'Cancelled'
       END $$`,
  `CREATE ${executionMovesLegallyDefinition}`,
  `REVOKE ALL ON FUNCTION ${statusMoveFunction}(text, text) FROM PUBLIC`,
  `REVOKE EXECUTE ON FUNCTION execution_moves_legally() FROM PUBLIC`,
  `CREATE TRIGGER execution_status_moves_legally
     BEFORE UPDATE ON execution
     FOR EACH ROW EXECUTE FUNCTION execution_moves_legally()`,
  `CREATE FUNCTION execution_attempt_is_fenced() RETURNS trigger
     LANGUAGE plpgsql AS $$
     BEGIN
       IF OLD.state NOT IN ('Placing', 'Running') THEN
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
     END $$`,
  `REVOKE EXECUTE ON FUNCTION execution_attempt_is_fenced() FROM PUBLIC`,
  `CREATE TRIGGER execution_attempt_is_fenced
     BEFORE UPDATE ON execution_attempt
     FOR EACH ROW EXECUTE FUNCTION execution_attempt_is_fenced()`,

  `CREATE FUNCTION ${digestFoldFunction}(in_digest text) RETURNS bigint
     LANGUAGE sql IMMUTABLE STRICT AS $$
       SELECT ('x' || substr(in_digest, 1, ${resultDigestFoldHexChars}))
              ::bit(${resultDigestFoldHexChars * 4})::bigint + 1
     $$`,
  `REVOKE ALL ON FUNCTION ${digestFoldFunction}(text) FROM PUBLIC`,

  `CREATE FUNCTION ${completionFunction}(
      in_tenant text, in_project text, in_execution text,
      in_ticket bigint, in_task bigint, in_source_effect integer,
      in_outcome text, in_manifest text, in_manifest_digest text, in_reason text,
      in_operation text, in_authority_subject text)
     RETURNS TABLE(result text, operation text, ordinal bigint)
     LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
     DECLARE bound record; project_lifecycle text; project_generation bigint;
       next_ordinal bigint; command_value jsonb; command_tag text;
     BEGIN
       IF in_outcome NOT IN (${schemaTextSet(allExecutionOutcomes)}) THEN
         RAISE EXCEPTION 'completion outcome % is not one this boundary submits', in_outcome
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       SELECT e.ticket, e.task, e.status, e.completion_operation, q.effect_position,
              r.manifest, r.digest, r.verdict, r.manifest_ordinal, r.schema_version
         INTO bound
         FROM execution e
         JOIN execution_request q
           ON q.tenant = e.tenant AND q.project = e.project AND q.request = e.source_request
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
          OR (in_reason IS NOT NULL AND in_reason NOT IN (${schemaTextSet(allBlockedReasons)}))
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
             jsonb_build_object('ticket', bound.ticket, 'reason', in_reason)));
       ELSE
         command_tag := 'TaskDone';
         command_value := jsonb_build_object('version', 1, 'command', 'Decide', 'event',
           jsonb_build_object('type', 'TaskDone', 'value',
             jsonb_build_object('ticket', bound.ticket, 'tid', bound.task,
               'verdict', bound.verdict,
               'result', jsonb_build_object(
                 'manifest', bound.manifest_ordinal,
                 'digest', ${digestFoldFunction}(bound.digest),
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
       VALUES (in_tenant, in_project, in_operation, '${executionSchedulerAuthorityKind}',
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
     END $$`,

  `CREATE FUNCTION ${activeWorkFunction}(in_tenant text, in_project text)
     RETURNS TABLE(queued bigint, admitted bigint, launching bigint, running bigint,
                   cluster_slots_max bigint, cluster_active bigint,
                   account_maximum bigint, account_active bigint, account_deficit bigint)
     LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
       SELECT own.queued, own.admitted, own.launching, own.running,
              coalesce(c.slots_max, 0)::bigint, coalesce(clustered.active, 0),
              coalesce(a.maximum, 0)::bigint, coalesce(held.active, 0),
              greatest(coalesce(a.reserved, 0) - coalesce(held.active, 0), 0)::bigint
         FROM (SELECT count(*) FILTER (WHERE e.status = 'Queued')    AS queued,
                      count(*) FILTER (WHERE e.status = 'Admitted')  AS admitted,
                      count(*) FILTER (WHERE e.status = 'Launching') AS launching,
                      count(*) FILTER (WHERE e.status = 'Running')   AS running
                 FROM execution e
                WHERE e.tenant = in_tenant AND e.project = in_project) own
         LEFT JOIN capacity_account a
                ON a.account = ${accountIdentityFunction}(in_tenant, in_project)
         LEFT JOIN execution_cluster c ON c.cluster = a.cluster
         LEFT JOIN LATERAL (SELECT count(*) AS active FROM execution x
                             WHERE x.cluster = a.cluster
                               AND x.status IN ('Admitted','Launching','Running')) clustered ON true
         LEFT JOIN LATERAL (SELECT count(*) AS active FROM execution x
                             WHERE x.account = a.account
                               AND x.status IN ('Admitted','Launching','Running')) held ON true
     $$`,
  `CREATE FUNCTION ${backlogFunction}(in_tenant text, in_project text)
     RETURNS TABLE(project_backlog bigint, installation_backlog bigint)
     LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
       SELECT (SELECT count(*) FROM execution e
                WHERE e.tenant = in_tenant AND e.project = in_project
                  AND e.status NOT IN ('Terminal', 'Cancelled'))
            + (SELECT count(*) FROM execution_request q
                 JOIN execution_request_task t
                   ON t.tenant = q.tenant AND t.project = q.project AND t.request = q.request
                WHERE q.tenant = in_tenant AND q.project = in_project
                  AND q.kind IN ('SpawnWork', 'SpawnEvaluation') AND q.state = 'Open'),
              (SELECT count(*) FROM execution e
                WHERE e.status NOT IN ('Terminal', 'Cancelled'))
     $$`,

  `ALTER FUNCTION ${completionFunction}(text,text,text,bigint,bigint,integer,text,text,text,text,text,text)
     OWNER TO ${boundaryOwnerRole}`,
  `ALTER FUNCTION ${activeWorkFunction}(text,text) OWNER TO ${boundaryOwnerRole}`,
  `ALTER FUNCTION ${backlogFunction}(text,text) OWNER TO ${boundaryOwnerRole}`,
  `ALTER FUNCTION ${statusMoveFunction}(text,text) OWNER TO ${boundaryOwnerRole}`,
  `ALTER FUNCTION ${digestFoldFunction}(text) OWNER TO ${boundaryOwnerRole}`,
  `ALTER FUNCTION ${accountProvisionFunction}() OWNER TO ${boundaryOwnerRole}`,
  `ALTER FUNCTION ${accountIdentityFunction}(text,text) OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${accountIdentityFunction}(text,text) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${accountIdentityFunction}(text,text) TO ${ticketServiceRole}`,
  `REVOKE ALL ON FUNCTION ${completionFunction}(text,text,text,bigint,bigint,integer,text,text,text,text,text,text) FROM PUBLIC`,
  `REVOKE ALL ON FUNCTION ${activeWorkFunction}(text,text) FROM PUBLIC`,
  `REVOKE ALL ON FUNCTION ${backlogFunction}(text,text) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${completionFunction}(text,text,text,bigint,bigint,integer,text,text,text,text,text,text) TO ${schedulerRole}`,
  `GRANT EXECUTE ON FUNCTION ${activeWorkFunction}(text,text), ${backlogFunction}(text,text)
     TO ${apiRole}, ${ticketServiceRole}`,
  `GRANT EXECUTE ON FUNCTION ${statusMoveFunction}(text,text) TO ${schedulerRole}`,

  `GRANT SELECT ON operation, decision_input, project, project_readiness, execution,
     execution_request, execution_request_task, execution_result, execution_cluster,
     capacity_account TO ${boundaryOwnerRole}`,
  `GRANT INSERT ON operation, decision_input, project_readiness,
     capacity_account TO ${boundaryOwnerRole}`,
  `GRANT UPDATE (ingress_next) ON project TO ${boundaryOwnerRole}`,
  `GRANT UPDATE (ready, generation) ON project_readiness TO ${boundaryOwnerRole}`,
  `GRANT UPDATE (status, outcome, blocked_reason, result_manifest, completion_operation,
     terminal_at) ON execution TO ${boundaryOwnerRole}`,

  `GRANT SELECT (tenant, project, lifecycle, lifecycle_generation, manifest_next)
     ON project TO ${schedulerRole}`,
  `GRANT UPDATE (manifest_next) ON project TO ${schedulerRole}`,
  `GRANT SELECT ON recovery_epoch, execution_cluster, capacity_account TO ${schedulerRole}`,
  `GRANT SELECT ON execution_request, execution_request_task TO ${schedulerRole}`,
  `GRANT UPDATE (state, claim_owner, claim_generation, claim_expires_at)
     ON execution_request TO ${schedulerRole}`,
  `GRANT SELECT ON execution, execution_attempt, execution_result,
     execution_result_artifact, scheduler_incident TO ${schedulerRole}`,
  `GRANT INSERT (tenant, project, execution, ticket, task, source_request, account, cluster,
                 configuration_revision, configuration_digest, requirement_identity,
                 requirement_value, requirement_digest, requirement_source,
                 platform_default_version) ON execution TO ${schedulerRole}`,
  `GRANT UPDATE (status, attempt_next, retries_spent, placement_backoff_from, terminal_at)
     ON execution TO ${schedulerRole}`,
  `GRANT INSERT ON execution_attempt, execution_result, execution_result_artifact,
     scheduler_incident TO ${schedulerRole}`,
  `GRANT UPDATE (state, generation, lease_owner, lease_expires_at, workload, evidence, ended_at)
     ON execution_attempt TO ${schedulerRole}`,

  `REVOKE ALL ON journal_entry, decision_input, operation, ticket_projection,
     project_notification, project_continuation, native_action, native_action_resolution,
     finalization_request, draft, draft_revision, configuration_revision
     FROM ${schedulerRole}`,
  `REVOKE ALL ON execution, execution_attempt, execution_result, execution_result_artifact,
     scheduler_incident, execution_cluster, capacity_account
     FROM ${apiRole}, ${ticketServiceRole}`,
  `GRANT SELECT ON configuration_revision TO ${schedulerRole}`,
  `REVOKE CREATE ON SCHEMA public FROM ${boundaryOwnerRole}`,
  `REVOKE ${boundaryOwnerRole} FROM CURRENT_USER`,
];
/**
 * Brings a database that applied migrations 12 and 15 before the requirement
 * columns were added to their bodies up to the shape the code reads. Every
 * statement is a no-op against a database already carrying them.
 */

export const migration012: Migration = {
  version: 12,
  name: "the durable execution scheduler",
  statements: [
    ...durableExecutionScheduler,
    ...durableExecutionSchedulerBoundaries,
  ],
};
