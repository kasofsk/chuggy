import { configurationCanonicalCharsMax } from "../../../../contract/http.ts";
import {
  apiRole,
  boundaryOwnerRole,
  configurationCreateFunction,
  draftCreateFunction,
  draftDeleteFunction,
  draftReleaseFunction,
  draftReviseFunction,
  notificationPublishFunction,
  ticketServiceRole,
  type Migration,
} from "../shared.ts";

const nativeAuthoring = [
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
     CONSTRAINT configuration_revision_content_is_bounded CHECK (length(canonical) BETWEEN 1 AND ${configurationCanonicalCharsMax})
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

export const migration007: Migration = {
  version: 7,
  name: "native versioned authoring",
  statements: [...nativeAuthoring],
};
