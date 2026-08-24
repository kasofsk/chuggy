import {
  acceptanceFunction,
  apiRole,
  boundaryOwnerRole,
  configurationCreateFunction,
  dispatchAcceptanceFunction,
  draftCreateFunction,
  draftDeleteFunction,
  draftReleaseFunction,
  draftReviseFunction,
  notificationPublishFunction,
  roleStatement,
  selectorServiceRole,
  ticketServiceRole,
  type Migration,
} from "./shared.ts";

/** I4a gives the API only the columns needed to poll operations and read projections. */
export const nativeWebReads = [
  `REVOKE SELECT ON operation FROM ${apiRole}`,
  `GRANT SELECT (tenant, project, operation, authority_kind, admission,
                 accepted_at)
     ON operation TO ${apiRole}`,
  `GRANT SELECT (tenant, project, ordinal, input_kind, input_id, state,
                 lifecycle_generation, decided_seq, outcome_code,
                 refused_head, refused_lifecycle_generation)
     ON decision_input TO ${apiRole}`,
  `REVOKE SELECT ON project FROM ${apiRole}`,
  `GRANT SELECT (tenant, project, lifecycle, lifecycle_generation,
                 fencing_epoch, head)
     ON project TO ${apiRole}`,
  `GRANT SELECT (tenant, project, ticket, phase, seq)
     ON ticket_projection TO ${apiRole}`,
];

export const nativeAuthoring = [
  `UPDATE decision_input i
      SET state='Refused', outcome_code='CommandUnreadable',
          refused_head=p.head,
          refused_lifecycle_generation=p.lifecycle_generation,
          terminal_at=now(),
          settled_authority_kind='ProjectTicketWriter',
          settled_authority_subject='I4Migration'
     FROM operation o, project p
    WHERE o.tenant=i.tenant AND o.project=i.project AND o.operation=i.input_id
      AND i.input_kind='Operation' AND i.state='Pending'
      AND p.tenant=i.tenant AND p.project=i.project
      AND legacy_event(o.command)->>'command'='Decide'
      AND legacy_event(o.command)->'event'->>'type'='ReleaseTicket'`,
  `ALTER TABLE project ADD COLUMN ticket_next bigint`,
  `UPDATE project p SET ticket_next=coalesce(
     (SELECT max(t.ticket)+1 FROM ticket_projection t
       WHERE t.tenant=p.tenant AND t.project=p.project),1)`,
  `ALTER TABLE project ALTER COLUMN ticket_next SET NOT NULL,
     ALTER COLUMN ticket_next SET DEFAULT 1,
     ADD CONSTRAINT project_ticket_next_is_positive CHECK (ticket_next >= 1)`,
  `CREATE TABLE configuration_revision (
     tenant text NOT NULL, project text NOT NULL, revision text NOT NULL,
     parent text, canonical text NOT NULL, digest text NOT NULL,
     authority_kind text NOT NULL, authority_subject text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (tenant, project, revision),
     CONSTRAINT configuration_revision_belongs_to_project FOREIGN KEY (tenant,project)
       REFERENCES project (tenant,project),
     CONSTRAINT configuration_revision_parent_is_local FOREIGN KEY (tenant,project,parent)
       REFERENCES configuration_revision (tenant,project,revision),
     CONSTRAINT configuration_revision_digest_identity UNIQUE (tenant,project,revision,digest),
     CONSTRAINT configuration_revision_content_is_bounded CHECK (length(canonical) BETWEEN 1 AND 65536)
   )`,
  `ALTER TABLE journal_entry
     ADD COLUMN integrity_version integer NOT NULL DEFAULT 1,
     ADD COLUMN configuration_revision text,
     ADD COLUMN configuration_digest text,
     ADD COLUMN event_schema_version integer NOT NULL DEFAULT 1,
     ADD COLUMN decision_semantics_version integer NOT NULL DEFAULT 1,
     ADD CONSTRAINT journal_configuration_is_whole CHECK
       ((configuration_revision IS NULL)=(configuration_digest IS NULL)),
     ADD CONSTRAINT journal_configuration_is_required_for_v2 CHECK
       (integrity_version=1 OR configuration_revision IS NOT NULL),
     ADD CONSTRAINT journal_configuration_is_retained FOREIGN KEY
       (tenant,project,configuration_revision,configuration_digest)
       REFERENCES configuration_revision (tenant,project,revision,digest),
     ADD CONSTRAINT journal_integrity_version_is_known CHECK (integrity_version IN (1,2))`,
  `ALTER TABLE journal_entry
     ADD CONSTRAINT journal_event_schema_version_is_positive CHECK (event_schema_version >= 1),
     ADD CONSTRAINT journal_decision_semantics_version_is_positive CHECK (decision_semantics_version >= 1)`,
  `ALTER TABLE ticket_projection
     ADD COLUMN configuration_revision text,
     ADD COLUMN configuration_digest text,
     ADD CONSTRAINT ticket_projection_configuration_is_whole CHECK
       ((configuration_revision IS NULL)=(configuration_digest IS NULL)),
     ADD CONSTRAINT ticket_projection_configuration_is_retained FOREIGN KEY
       (tenant,project,configuration_revision,configuration_digest)
       REFERENCES configuration_revision (tenant,project,revision,digest)`,
  `CREATE TABLE draft (
     tenant text NOT NULL, project text NOT NULL, ticket bigint NOT NULL,
     authoring_version bigint NOT NULL, state text NOT NULL,
     configuration_revision text NOT NULL,
     PRIMARY KEY (tenant,project,ticket),
     CONSTRAINT draft_belongs_to_project FOREIGN KEY (tenant,project) REFERENCES project (tenant,project),
     CONSTRAINT draft_configuration_is_local FOREIGN KEY (tenant,project,configuration_revision)
       REFERENCES configuration_revision (tenant,project,revision),
     CONSTRAINT draft_ticket_is_positive CHECK (ticket >= 1 AND authoring_version >= 1),
     CONSTRAINT draft_state_is_known CHECK (state IN ('Draft','Released','Deleted'))
   )`,
  `CREATE TABLE draft_revision (
     tenant text NOT NULL, project text NOT NULL, ticket bigint NOT NULL,
     authoring_version bigint NOT NULL, configuration_revision text NOT NULL,
     authoring text NOT NULL, authority_kind text NOT NULL, authority_subject text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (tenant,project,ticket,authoring_version),
     CONSTRAINT draft_revision_belongs_to_draft FOREIGN KEY (tenant,project,ticket)
       REFERENCES draft (tenant,project,ticket),
     CONSTRAINT draft_revision_configuration_is_local FOREIGN KEY (tenant,project,configuration_revision)
       REFERENCES configuration_revision (tenant,project,revision),
     CONSTRAINT draft_revision_content_is_bounded CHECK (length(authoring) BETWEEN 1 AND 65536)
   )`,
  `CREATE FUNCTION ${configurationCreateFunction}(in_tenant text,in_project text,in_revision text,
      in_parent text,in_canonical text,in_digest text,in_kind text,in_subject text) RETURNS text
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE existing configuration_revision%ROWTYPE; inserted boolean := false;
     BEGIN
       BEGIN
         INSERT INTO configuration_revision
           (tenant,project,revision,parent,canonical,digest,authority_kind,authority_subject)
         VALUES (in_tenant,in_project,in_revision,in_parent,in_canonical,in_digest,in_kind,in_subject)
         ON CONFLICT (tenant,project,revision) DO NOTHING RETURNING true INTO inserted;
       EXCEPTION
         WHEN foreign_key_violation THEN RETURN 'ParentNotFound';
         WHEN unique_violation THEN NULL;
       END;
       IF inserted THEN
         PERFORM ${notificationPublishFunction}(in_tenant,in_project,'Configuration',in_revision,NULL,NULL);
         RETURN 'Created';
       END IF;
       SELECT * INTO existing FROM configuration_revision
        WHERE tenant=in_tenant AND project=in_project AND revision=in_revision;
       RETURN CASE WHEN existing.canonical=in_canonical AND existing.digest=in_digest
         AND existing.parent IS NOT DISTINCT FROM in_parent THEN 'AlreadyExists' ELSE 'IdentityConflict' END;
     END $$`,
  `CREATE FUNCTION ${draftCreateFunction}(in_tenant text,in_project text,in_configuration text,
      in_authoring text,in_kind text,in_subject text)
     RETURNS TABLE(result text,ticket bigint,authoring_version bigint,state text)
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE minted bigint;
     BEGIN
       IF NOT EXISTS (SELECT 1 FROM configuration_revision WHERE tenant=in_tenant AND project=in_project AND revision=in_configuration)
         THEN RETURN QUERY SELECT 'ConfigurationNotFound',NULL::bigint,NULL::bigint,NULL::text; RETURN; END IF;
       UPDATE project SET ticket_next=ticket_next+1 WHERE tenant=in_tenant AND project=in_project AND lifecycle='Active'
         RETURNING ticket_next-1 INTO minted;
       IF minted IS NULL THEN RETURN QUERY SELECT 'ConfigurationNotFound',NULL::bigint,NULL::bigint,NULL::text; RETURN; END IF;
       INSERT INTO draft VALUES (in_tenant,in_project,minted,1,'Draft',in_configuration);
       INSERT INTO draft_revision (tenant,project,ticket,authoring_version,configuration_revision,authoring,authority_kind,authority_subject)
         VALUES (in_tenant,in_project,minted,1,in_configuration,in_authoring,in_kind,in_subject);
       PERFORM ${notificationPublishFunction}(in_tenant,in_project,'Draft',minted::text,NULL,1);
       RETURN QUERY SELECT 'Created',minted,1::bigint,'Draft'::text;
     END $$`,
  `CREATE FUNCTION ${draftReviseFunction}(in_tenant text,in_project text,in_ticket bigint,
      in_expected bigint,in_configuration text,in_authoring text,in_kind text,in_subject text)
     RETURNS TABLE(result text,authoring_version bigint,state text)
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE current draft%ROWTYPE; next_version bigint;
     BEGIN
       SELECT * INTO current FROM draft WHERE tenant=in_tenant AND project=in_project AND ticket=in_ticket FOR UPDATE;
       IF NOT FOUND THEN RETURN QUERY SELECT 'NotFound',NULL::bigint,NULL::text; RETURN; END IF;
       IF current.state <> 'Draft' THEN RETURN QUERY SELECT 'NotDraft',current.authoring_version,current.state; RETURN; END IF;
       IF current.authoring_version <> in_expected THEN RETURN QUERY SELECT 'Stale',current.authoring_version,current.state; RETURN; END IF;
       IF NOT EXISTS (SELECT 1 FROM configuration_revision WHERE tenant=in_tenant AND project=in_project AND revision=in_configuration)
         THEN RETURN QUERY SELECT 'ConfigurationNotFound',current.authoring_version,current.state; RETURN; END IF;
       next_version := current.authoring_version+1;
       INSERT INTO draft_revision (tenant,project,ticket,authoring_version,configuration_revision,authoring,authority_kind,authority_subject)
         VALUES (in_tenant,in_project,in_ticket,next_version,in_configuration,in_authoring,in_kind,in_subject);
       UPDATE draft SET authoring_version=next_version,configuration_revision=in_configuration
        WHERE tenant=in_tenant AND project=in_project AND ticket=in_ticket;
       PERFORM ${notificationPublishFunction}(in_tenant,in_project,'Draft',in_ticket::text,NULL,next_version);
       RETURN QUERY SELECT 'Revised',next_version,'Draft'::text;
     END $$`,
  `CREATE FUNCTION ${draftDeleteFunction}(in_tenant text,in_project text,in_ticket bigint,
      in_expected bigint,in_kind text,in_subject text)
     RETURNS TABLE(result text,authoring_version bigint,state text)
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE current draft%ROWTYPE;
     BEGIN
       SELECT * INTO current FROM draft WHERE tenant=in_tenant AND project=in_project AND ticket=in_ticket FOR UPDATE;
       IF NOT FOUND THEN RETURN QUERY SELECT 'NotFound',NULL::bigint,NULL::text; RETURN; END IF;
       IF current.state <> 'Draft' THEN RETURN QUERY SELECT 'NotDraft',current.authoring_version,current.state; RETURN; END IF;
       IF current.authoring_version <> in_expected THEN RETURN QUERY SELECT 'Stale',current.authoring_version,current.state; RETURN; END IF;
       INSERT INTO draft_revision (tenant,project,ticket,authoring_version,configuration_revision,authoring,authority_kind,authority_subject)
         SELECT r.tenant,r.project,r.ticket,r.authoring_version+1,r.configuration_revision,r.authoring,in_kind,in_subject
           FROM draft_revision r WHERE r.tenant=in_tenant AND r.project=in_project AND r.ticket=in_ticket
            AND r.authoring_version=current.authoring_version;
       UPDATE draft d SET state='Deleted',authoring_version=d.authoring_version+1
        WHERE d.tenant=in_tenant AND d.project=in_project AND d.ticket=in_ticket;
       PERFORM ${notificationPublishFunction}(in_tenant,in_project,'Draft',in_ticket::text,NULL,current.authoring_version+1);
       RETURN QUERY SELECT 'Deleted',current.authoring_version+1,'Deleted'::text;
     END $$`,
  `CREATE FUNCTION ${draftReleaseFunction}(in_tenant text,in_project text,in_ticket bigint,
      in_expected bigint,in_configuration text,in_digest text,in_commit boolean) RETURNS boolean
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE current draft%ROWTYPE;
     BEGIN
       SELECT d.* INTO current FROM draft d JOIN configuration_revision c
         ON c.tenant=d.tenant AND c.project=d.project AND c.revision=d.configuration_revision
        WHERE d.tenant=in_tenant AND d.project=in_project AND d.ticket=in_ticket
          AND c.digest=in_digest FOR UPDATE OF d;
       IF NOT FOUND OR current.state <> 'Draft' OR current.authoring_version <> in_expected
          OR current.configuration_revision <> in_configuration THEN RETURN false; END IF;
       IF in_commit THEN UPDATE draft SET state='Released'
         WHERE tenant=in_tenant AND project=in_project AND ticket=in_ticket; END IF;
       RETURN true;
     END $$`,
  `ALTER FUNCTION ${configurationCreateFunction}(text,text,text,text,text,text,text,text) OWNER TO ${boundaryOwnerRole}`,
  `ALTER FUNCTION ${draftCreateFunction}(text,text,text,text,text,text) OWNER TO ${boundaryOwnerRole}`,
  `ALTER FUNCTION ${draftReviseFunction}(text,text,bigint,bigint,text,text,text,text) OWNER TO ${boundaryOwnerRole}`,
  `ALTER FUNCTION ${draftDeleteFunction}(text,text,bigint,bigint,text,text) OWNER TO ${boundaryOwnerRole}`,
  `ALTER FUNCTION ${draftReleaseFunction}(text,text,bigint,bigint,text,text,boolean) OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${configurationCreateFunction}(text,text,text,text,text,text,text,text),
     ${draftCreateFunction}(text,text,text,text,text,text),
     ${draftReviseFunction}(text,text,bigint,bigint,text,text,text,text),
     ${draftDeleteFunction}(text,text,bigint,bigint,text,text),
     ${draftReleaseFunction}(text,text,bigint,bigint,text,text,boolean) FROM PUBLIC`,
  `GRANT SELECT,INSERT ON configuration_revision,draft,draft_revision TO ${boundaryOwnerRole}`,
  `GRANT UPDATE (ticket_next) ON project TO ${boundaryOwnerRole}`,
  `GRANT UPDATE (ticket_next) ON project TO ${ticketServiceRole}`,
  `GRANT UPDATE (authoring_version,state,configuration_revision) ON draft TO ${boundaryOwnerRole}`,
  `GRANT EXECUTE ON FUNCTION ${configurationCreateFunction}(text,text,text,text,text,text,text,text),
     ${draftCreateFunction}(text,text,text,text,text,text),
     ${draftReviseFunction}(text,text,bigint,bigint,text,text,text,text),
     ${draftDeleteFunction}(text,text,bigint,bigint,text,text) TO ${apiRole}`,
  `GRANT EXECUTE ON FUNCTION ${draftReleaseFunction}(text,text,bigint,bigint,text,text,boolean) TO ${ticketServiceRole}`,
  `GRANT SELECT ON configuration_revision,draft,draft_revision TO ${apiRole},${ticketServiceRole}`,
];

export const durableNotifications = [
  `ALTER TABLE project ADD COLUMN notification_next bigint NOT NULL DEFAULT 1,
     ADD CONSTRAINT project_notification_next_is_positive CHECK (notification_next >= 1)`,
  `CREATE TABLE project_notification (
     tenant text NOT NULL, project text NOT NULL, ordinal bigint NOT NULL,
     kind text NOT NULL, resource text NOT NULL, project_seq bigint,
     authoring_version bigint, created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (tenant,project,ordinal),
     CONSTRAINT project_notification_belongs_to_project FOREIGN KEY (tenant,project)
       REFERENCES project (tenant,project),
     CONSTRAINT project_notification_kind_is_known CHECK
       (kind IN ('Operation','Ticket','Draft','Configuration')),
     CONSTRAINT project_notification_values_are_bounded CHECK
       (ordinal >= 1 AND length(resource) BETWEEN 1 AND 256
        AND coalesce(project_seq,1) >= 1 AND coalesce(authoring_version,1) >= 1)
   )`,
  `CREATE FUNCTION ${notificationPublishFunction}(in_tenant text,in_project text,in_kind text,
      in_resource text,in_project_seq bigint,in_authoring_version bigint) RETURNS bigint
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE allocated bigint; retention_max constant bigint := 1000;
     BEGIN
       UPDATE project SET notification_next=notification_next+1
        WHERE tenant=in_tenant AND project=in_project
        RETURNING notification_next-1 INTO allocated;
       IF allocated IS NULL THEN RAISE EXCEPTION 'notification project is absent'; END IF;
       INSERT INTO project_notification
         (tenant,project,ordinal,kind,resource,project_seq,authoring_version)
       VALUES (in_tenant,in_project,allocated,in_kind,in_resource,in_project_seq,in_authoring_version);
       DELETE FROM project_notification
        WHERE tenant=in_tenant AND project=in_project AND ordinal <= allocated-retention_max;
       RETURN allocated;
     END $$`,
  `ALTER FUNCTION ${notificationPublishFunction}(text,text,text,text,bigint,bigint) OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${notificationPublishFunction}(text,text,text,text,bigint,bigint) FROM PUBLIC`,
  `GRANT SELECT,INSERT,DELETE ON project_notification TO ${boundaryOwnerRole}`,
  `GRANT UPDATE (notification_next) ON project TO ${boundaryOwnerRole}`,
  `GRANT EXECUTE ON FUNCTION ${notificationPublishFunction}(text,text,text,text,bigint,bigint)
     TO ${ticketServiceRole}`,
  `GRANT SELECT ON project_notification TO ${apiRole}`,
];

export const durableDispatch = [
  roleStatement(selectorServiceRole),
  `CREATE FUNCTION ${dispatchAcceptanceFunction}(
      in_tenant text,in_project text,in_operation text,in_authority_kind text,
      in_authority_subject text,in_key_version text,in_key_digest text,in_payload_digest text,
      in_retained_key_digests text[],in_retained_payload_digests text[],in_command text,
      in_ordinary_soft_limit bigint,in_hard_limit bigint)
     RETURNS TABLE(result text,operation text,ordinal bigint,state text,authority_kind text,
       admission text,lifecycle_generation bigint,lifecycle text)
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE command_value jsonb; ticket_value bigint; accepted record;
     BEGIN
       BEGIN command_value:=in_command::jsonb;
       EXCEPTION WHEN others THEN RETURN QUERY SELECT 'InvalidCommand'::text,NULL::text,NULL::bigint,
         NULL::text,NULL::text,NULL::text,NULL::bigint,NULL::text; RETURN; END;
       IF command_value->>'version'<>'1'
          OR command_value->>'command' NOT IN ('ManualDispatch','ProposeDispatch')
          OR NOT command_integer(command_value->'ticket')
          OR (command_value->>'ticket') !~ '^[1-9][0-9]*$'
          OR NOT command_integer(command_value->'expectedTicketVersion')
          OR (command_value->>'expectedTicketVersion') !~ '^[1-9][0-9]*$' THEN
         RETURN QUERY SELECT 'InvalidCommand'::text,NULL::text,NULL::bigint,
           NULL::text,NULL::text,NULL::text,NULL::bigint,NULL::text; RETURN;
       END IF;
       BEGIN ticket_value:=(command_value->>'ticket')::bigint;
       EXCEPTION WHEN numeric_value_out_of_range THEN RETURN QUERY SELECT 'InvalidCommand'::text,
         NULL::text,NULL::bigint,NULL::text,NULL::text,NULL::text,NULL::bigint,NULL::text; RETURN; END;
       IF command_value->>'command'='ProposeDispatch' AND (
          jsonb_typeof(command_value->'observedViewToken')<>'object'
          OR command_value->'observedViewToken'->>'tenant'<>in_tenant
          OR command_value->'observedViewToken'->>'project'<>in_project
          OR jsonb_typeof(command_value->'observedViewToken'->'recoveryEpoch')<>'string'
          OR length(command_value->'observedViewToken'->>'recoveryEpoch') NOT BETWEEN 1 AND 256
          OR command_value->'observedViewToken'->>'schemaVersion'<>'1'
          OR NOT command_integer(command_value->'observedViewToken'->'watermark')
          OR (command_value->'observedViewToken'->>'watermark') !~ '^(0|[1-9][0-9]*)$'
          OR (command_value->'observedViewToken'->>'digest') !~ '^[0-9a-f]{64}$'
          OR jsonb_typeof(command_value->'selectorDecisionReference')<>'string'
          OR length(command_value->>'selectorDecisionReference') NOT BETWEEN 1 AND 256) THEN
         RETURN QUERY SELECT 'InvalidCommand'::text,NULL::text,NULL::bigint,
           NULL::text,NULL::text,NULL::text,NULL::bigint,NULL::text; RETURN;
       END IF;
       SELECT * INTO accepted FROM ${acceptanceFunction}(
         in_tenant,in_project,in_operation,in_authority_kind,in_authority_subject,
         in_key_version,in_key_digest,in_payload_digest,in_retained_key_digests,
         in_retained_payload_digests,jsonb_build_object('version',1,'command','Decide',
           'event',jsonb_build_object('type','ResumeTicket','value',ticket_value))::text,
         in_ordinary_soft_limit,in_hard_limit);
       IF accepted.result='Accepted' THEN UPDATE operation AS stored
         SET command=in_command,command_tag=command_value->>'command'
         WHERE stored.tenant=in_tenant AND stored.project=in_project
           AND stored.operation=in_operation; END IF;
       RETURN QUERY SELECT accepted.result::text,accepted.operation::text,accepted.ordinal::bigint,
         accepted.state::text,accepted.authority_kind::text,accepted.admission::text,
         accepted.lifecycle_generation::bigint,accepted.lifecycle::text;
     END $$`,
  `ALTER FUNCTION ${dispatchAcceptanceFunction}(text,text,text,text,text,text,text,text,text[],text[],text,bigint,bigint)
     OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${dispatchAcceptanceFunction}(text,text,text,text,text,text,text,text,text[],text[],text,bigint,bigint)
     FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${dispatchAcceptanceFunction}(text,text,text,text,text,text,text,text,text[],text[],text,bigint,bigint)
     TO ${apiRole}`,
  `GRANT UPDATE (command,command_tag) ON operation TO ${boundaryOwnerRole}`,
  `ALTER TABLE project_notification DROP CONSTRAINT project_notification_kind_is_known,
     ADD CONSTRAINT project_notification_kind_is_known CHECK
       (kind IN ('Operation','Ticket','Draft','Configuration','Project'))`,
  `CREATE TABLE dispatch_view (
     tenant text NOT NULL, project text NOT NULL, recovery_epoch text NOT NULL,
     watermark bigint NOT NULL, schema_version integer NOT NULL, digest text NOT NULL,
     PRIMARY KEY (tenant,project),
     FOREIGN KEY (tenant,project) REFERENCES project (tenant,project),
     FOREIGN KEY (recovery_epoch) REFERENCES recovery_epoch (epoch),
     CHECK (watermark >= 0 AND schema_version = 1 AND digest ~ '^[0-9a-f]{64}$')
   )`,
  `CREATE TABLE dispatch_candidate (
     tenant text NOT NULL, project text NOT NULL, ticket bigint NOT NULL,
     ticket_version bigint NOT NULL, work_fanout bigint NOT NULL,
     program text NOT NULL, rework_policy text NOT NULL,
     finalization_pricing text NOT NULL, resume_pricing text NOT NULL,
     finalizer text NOT NULL, configuration_revision text NOT NULL,
     configuration_digest text NOT NULL, configuration_canonical text NOT NULL,
     PRIMARY KEY (tenant,project,ticket),
     FOREIGN KEY (tenant,project) REFERENCES dispatch_view (tenant,project) ON DELETE CASCADE,
     FOREIGN KEY (tenant,project,configuration_revision,configuration_digest)
       REFERENCES configuration_revision (tenant,project,revision,digest),
     CHECK (ticket >= 1 AND ticket_version >= 1 AND work_fanout >= 1)
   )`,
  `CREATE TABLE dispatch_candidate_dependency (
     tenant text NOT NULL, project text NOT NULL, ticket bigint NOT NULL, dependency bigint NOT NULL,
     PRIMARY KEY (tenant,project,ticket,dependency),
     FOREIGN KEY (tenant,project,ticket) REFERENCES dispatch_candidate (tenant,project,ticket) ON DELETE CASCADE,
     CHECK (dependency >= 1)
   )`,
  `CREATE TABLE selector_project_state (
     tenant text NOT NULL, project text NOT NULL, notification_cursor bigint NOT NULL DEFAULT 0,
     recovery_epoch text, attention text NOT NULL DEFAULT 'Monitoring', revision bigint NOT NULL DEFAULT 0,
     candidate_scan_token text, candidate_scan_after bigint,
     updated_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (tenant,project), CHECK (notification_cursor >= 0 AND revision >= 0),
     CHECK (attention IN ('Monitoring','Attention','Stopped')),
     CHECK ((candidate_scan_token IS NULL)=(candidate_scan_after IS NULL)),
     CHECK (candidate_scan_after IS NULL OR candidate_scan_after >= 1),
     CHECK (candidate_scan_token IS NULL OR length(candidate_scan_token) <= 65536),
     CHECK (recovery_epoch IS NULL OR length(recovery_epoch) BETWEEN 1 AND 256)
   )`,
  `CREATE TABLE selector_inventory_state (
     singleton integer PRIMARY KEY DEFAULT 1, tenant text, project text,
     CHECK (singleton=1), CHECK ((tenant IS NULL)=(project IS NULL))
   )`,
  `INSERT INTO selector_inventory_state (singleton) VALUES (1)`,
  `CREATE TABLE selector_interaction (
     selector_decision text PRIMARY KEY, ordinal bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
     tenant text NOT NULL, project text NOT NULL,
     instructions_version text NOT NULL, instructions text NOT NULL, observed_view text NOT NULL,
     context text NOT NULL, tool_activity text NOT NULL, result text NOT NULL,
     implementation_revision text NOT NULL, model_revision text NOT NULL, policy_revision text NOT NULL,
     accounting text NOT NULL, started_at timestamptz NOT NULL, completed_at timestamptz NOT NULL,
     UNIQUE (selector_decision,tenant,project),
     CHECK (length(selector_decision) BETWEEN 1 AND 256),
     CHECK (length(instructions_version) BETWEEN 1 AND 256
       AND length(implementation_revision) BETWEEN 1 AND 256
       AND length(model_revision) BETWEEN 1 AND 256
       AND length(policy_revision) BETWEEN 1 AND 256),
     CHECK (length(instructions) <= 65536 AND length(observed_view) <= 65536
       AND length(context) <= 65536 AND length(tool_activity) <= 65536
       AND length(result) <= 65536 AND length(accounting) <= 65536),
     CHECK (completed_at >= started_at)
   )`,
  `CREATE TABLE selector_interaction_resource (
     selector_decision text NOT NULL, kind text NOT NULL, ordinal bigint NOT NULL,
     digest text NOT NULL, byte_length bigint NOT NULL, chunk_count bigint NOT NULL,
     content text NOT NULL,
     PRIMARY KEY (selector_decision,kind,ordinal),
     FOREIGN KEY (selector_decision) REFERENCES selector_interaction (selector_decision)
       ON DELETE CASCADE,
     CHECK (kind IN ('ObservedView','Context','ToolActivity')),
     CHECK (ordinal >= 0 AND byte_length >= 0 AND chunk_count >= 1),
     CHECK (digest ~ '^[0-9a-f]{64}$'),
     CHECK (length(content) <= 65536)
   )`,
  `CREATE TABLE selector_planning_intent (
     tenant text NOT NULL, project text NOT NULL, selector_decision text NOT NULL,
     intent text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tenant,project),
     FOREIGN KEY (selector_decision,tenant,project)
       REFERENCES selector_interaction (selector_decision,tenant,project)
     ,CHECK (length(intent) <= 65536)
   )`,
  `CREATE TABLE selector_proposal_delivery (
     selector_decision text PRIMARY KEY,
     tenant text NOT NULL, project text NOT NULL, operation text NOT NULL UNIQUE,
     command text NOT NULL, state text NOT NULL DEFAULT 'Pending', outcome text,
     attempts bigint NOT NULL DEFAULT 0, retry_at timestamptz NOT NULL DEFAULT now(),
     FOREIGN KEY (selector_decision,tenant,project)
       REFERENCES selector_interaction (selector_decision,tenant,project),
     CHECK (state IN ('Pending','Submitted','Terminal')), CHECK (attempts >= 0),
     CHECK (length(operation) BETWEEN 1 AND 256 AND length(command) <= 65536
       AND (outcome IS NULL OR length(outcome) <= 65536))
   )`,
  `GRANT SELECT ON dispatch_view,dispatch_candidate,dispatch_candidate_dependency TO ${apiRole}`,
  `GRANT SELECT,INSERT,UPDATE,DELETE ON selector_project_state,selector_inventory_state,selector_interaction,
     selector_interaction_resource,selector_planning_intent,selector_proposal_delivery TO ${selectorServiceRole}`,
  `GRANT SELECT,INSERT,UPDATE,DELETE ON dispatch_view,dispatch_candidate,
     dispatch_candidate_dependency TO ${ticketServiceRole}`,
  `INSERT INTO project_readiness (tenant,project,ready,generation)
     SELECT tenant,project,true,1 FROM project WHERE lifecycle='Active'
     ON CONFLICT (tenant,project) DO UPDATE SET
       ready=true,generation=project_readiness.generation+1`,
];

export const nativeMigrations: readonly Migration[] = [
  { version: 6, name: "native web reads", statements: [...nativeWebReads] },
  {
    version: 7,
    name: "native versioned authoring",
    statements: [...nativeAuthoring],
  },
  {
    version: 8,
    name: "bounded durable project notifications",
    statements: [...durableNotifications],
  },
  {
    version: 9,
    name: "selector-independent durable dispatch",
    statements: [...durableDispatch],
  },
];
