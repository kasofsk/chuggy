import {
  briefChecksMax,
  briefLineCharsMax,
} from "../../../../contract/brief.ts";
import {
  apiRole,
  boundaryOwnerRole,
  draftCreateFunction,
  draftReviseFunction,
  finalizerRole,
  notificationPublishFunction,
  schedulerRole,
  ticketServiceRole,
  type Migration,
} from "../shared.ts";

const draftCreateSignature =
  "text,text,text,text,bigint,text,text,text[],text[],text,text,text,text,text";
const draftReviseSignature =
  "text,text,bigint,bigint,text,text,text,text[],text[],text,text,text,text,text";

/**
 * The command lines a ticket appends to its check stage, ordered as a link list
 * is, because the order is what the worker runs them in and a set would lose
 * it. A line is one command line, so no control character belongs in one.
 */
const briefChecks = [
  `CREATE TABLE draft_brief_check (
     tenant text NOT NULL, project text NOT NULL, ticket bigint NOT NULL,
     ordinal integer NOT NULL, command text NOT NULL,
     PRIMARY KEY (tenant,project,ticket,ordinal),
     CONSTRAINT draft_brief_check_belongs_to_brief FOREIGN KEY (tenant,project,ticket)
       REFERENCES draft_brief (tenant,project,ticket),
     CONSTRAINT draft_brief_check_ordinal_is_bounded
       CHECK (ordinal BETWEEN 1 AND ${briefChecksMax}),
     CONSTRAINT draft_brief_check_is_a_bounded_command_line
       CHECK (length(command) BETWEEN 1 AND ${briefLineCharsMax}
         AND command !~ '[[:cntrl:]]')
   )`,
];

const briefWriters = [
  `DROP FUNCTION ${draftCreateFunction}(text,text,text,text,bigint,text,text,text[],text,text,text,text,text)`,
  `CREATE FUNCTION ${draftCreateFunction}(in_tenant text,in_project text,in_configuration text,
      in_configuration_digest text,in_expected_head bigint,in_authoring text,
      in_intent text,in_links text[],in_checks text[],in_branch text,
      in_finalization_mode text,in_finalization_target text,in_kind text,in_subject text)
     RETURNS TABLE(result text,ticket bigint,authoring_version bigint,state text)
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE minted bigint;
     BEGIN
       IF NOT EXISTS (SELECT 1 FROM configuration_revision WHERE tenant=in_tenant AND project=in_project
            AND revision=in_configuration AND digest=in_configuration_digest)
         THEN RETURN QUERY SELECT 'ConfigurationNotFound',NULL::bigint,NULL::bigint,NULL::text; RETURN; END IF;
       UPDATE project SET ticket_next=ticket_next+1
        WHERE tenant=in_tenant AND project=in_project AND lifecycle='Active' AND head=in_expected_head
        RETURNING ticket_next-1 INTO minted;
       IF minted IS NULL THEN RETURN QUERY SELECT 'Stale',NULL::bigint,NULL::bigint,NULL::text; RETURN; END IF;
       INSERT INTO draft VALUES (in_tenant,in_project,minted,1,'Draft',in_configuration);
       INSERT INTO draft_revision (tenant,project,ticket,authoring_version,configuration_revision,authoring,authority_kind,authority_subject)
         VALUES (in_tenant,in_project,minted,1,in_configuration,in_authoring,in_kind,in_subject);
       INSERT INTO draft_brief (tenant,project,ticket,intent,branch,finalization_mode,finalization_target)
         VALUES (in_tenant,in_project,minted,in_intent,in_branch,in_finalization_mode,in_finalization_target);
       INSERT INTO draft_brief_link (tenant,project,ticket,ordinal,url)
         SELECT in_tenant,in_project,minted,link.ordinal,link.url
           FROM unnest(in_links) WITH ORDINALITY AS link(url,ordinal);
       INSERT INTO draft_brief_check (tenant,project,ticket,ordinal,command)
         SELECT in_tenant,in_project,minted,line.ordinal,line.command
           FROM unnest(in_checks) WITH ORDINALITY AS line(command,ordinal);
       PERFORM ${notificationPublishFunction}(in_tenant,in_project,'Draft',minted::text,NULL,1);
       RETURN QUERY SELECT 'Created',minted,1::bigint,'Draft'::text;
     END $$`,
  `DROP FUNCTION ${draftReviseFunction}(text,text,bigint,bigint,text,text,text,text[],text,text,text,text,text)`,
  `CREATE FUNCTION ${draftReviseFunction}(in_tenant text,in_project text,in_ticket bigint,
      in_expected bigint,in_configuration text,in_authoring text,
      in_intent text,in_links text[],in_checks text[],in_branch text,
      in_finalization_mode text,in_finalization_target text,in_kind text,in_subject text)
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
       INSERT INTO draft_brief (tenant,project,ticket,intent,branch,finalization_mode,finalization_target)
         VALUES (in_tenant,in_project,in_ticket,in_intent,in_branch,in_finalization_mode,in_finalization_target)
         ON CONFLICT (tenant,project,ticket) DO UPDATE SET intent=EXCLUDED.intent,branch=EXCLUDED.branch,
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
       PERFORM ${notificationPublishFunction}(in_tenant,in_project,'Draft',in_ticket::text,NULL,next_version);
       RETURN QUERY SELECT 'Revised',next_version,'Draft'::text;
     END $$`,
  `ALTER FUNCTION ${draftCreateFunction}(${draftCreateSignature}) OWNER TO ${boundaryOwnerRole}`,
  `ALTER FUNCTION ${draftReviseFunction}(${draftReviseSignature}) OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${draftCreateFunction}(${draftCreateSignature}),
     ${draftReviseFunction}(${draftReviseSignature}) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${draftCreateFunction}(${draftCreateSignature}),
     ${draftReviseFunction}(${draftReviseSignature}) TO ${apiRole}`,
];

/**
 * A ticket appends its own command lines to the check stage its configuration
 * commands. They are the brief's, so they are written by the two doors a brief
 * is written by and read by every role that reads one; the doors are replaced
 * rather than migration 42 or 50 edited, the ledger being append-only.
 */
export const migration057: Migration = {
  version: 57,
  name: "the ticket brief's check lines",
  statements: [
    ...briefChecks,
    ...briefWriters,
    `GRANT SELECT,INSERT,DELETE ON draft_brief_check TO ${boundaryOwnerRole}`,
    `GRANT SELECT ON draft_brief_check
       TO ${apiRole},${ticketServiceRole},${schedulerRole},${finalizerRole}`,
  ],
};
