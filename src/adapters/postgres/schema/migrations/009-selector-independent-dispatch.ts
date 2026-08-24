import {
  acceptanceFunction,
  apiRole,
  boundaryOwnerRole,
  dispatchAcceptanceFunction,
  roleStatement,
  selectorServiceRole,
  ticketServiceRole,
  type Migration,
} from "../shared.ts";

const durableDispatch = [
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

export const migration009: Migration = {
  version: 9,
  name: "selector-independent durable dispatch",
  statements: [...durableDispatch],
};
