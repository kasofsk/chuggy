import { briefLineCharsMax } from "../../../../contract/brief.ts";
import {
  apiRole,
  boundaryOwnerRole,
  draftCreateFunction,
  draftReviseFunction,
  notificationPublishFunction,
  type Migration,
} from "../shared.ts";

const draftCreateSignature =
  "text,text,text,text,bigint,text,text,text,text[],text,text,text,text,text";
const draftReviseSignature =
  "text,text,bigint,bigint,text,text,text,text,text[],text,text,text,text,text";

/**
 * A display name a reader would rather see than a ticket number. It is stored
 * beside the brief rather than inside it, so a ticket authored with no title
 * reads back as none rather than as an empty one.
 */
const ticketTitle = [
  `ALTER TABLE draft_brief
     ADD COLUMN title text,
     ADD CONSTRAINT draft_brief_title_is_bounded
       CHECK (title IS NULL OR (length(title) BETWEEN 1 AND ${briefLineCharsMax}
         AND title !~ '[[:cntrl:]]'))`,
];

const briefWriters = [
  `DROP FUNCTION ${draftCreateFunction}(text,text,text,text,bigint,text,text,text[],text,text,text,text,text)`,
  `CREATE FUNCTION ${draftCreateFunction}(in_tenant text,in_project text,in_configuration text,
      in_configuration_digest text,in_expected_head bigint,in_authoring text,
      in_intent text,in_title text,in_links text[],in_branch text,
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
       INSERT INTO draft_brief (tenant,project,ticket,intent,title,branch,finalization_mode,finalization_target)
         VALUES (in_tenant,in_project,minted,in_intent,in_title,in_branch,in_finalization_mode,in_finalization_target);
       INSERT INTO draft_brief_link (tenant,project,ticket,ordinal,url)
         SELECT in_tenant,in_project,minted,link.ordinal,link.url
           FROM unnest(in_links) WITH ORDINALITY AS link(url,ordinal);
       PERFORM ${notificationPublishFunction}(in_tenant,in_project,'Draft',minted::text,NULL,1);
       RETURN QUERY SELECT 'Created',minted,1::bigint,'Draft'::text;
     END $$`,
  `DROP FUNCTION ${draftReviseFunction}(text,text,bigint,bigint,text,text,text,text[],text,text,text,text,text)`,
  `CREATE FUNCTION ${draftReviseFunction}(in_tenant text,in_project text,in_ticket bigint,
      in_expected bigint,in_configuration text,in_authoring text,
      in_intent text,in_title text,in_links text[],in_branch text,
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
       INSERT INTO draft_brief (tenant,project,ticket,intent,title,branch,finalization_mode,finalization_target)
         VALUES (in_tenant,in_project,in_ticket,in_intent,in_title,in_branch,in_finalization_mode,in_finalization_target)
         ON CONFLICT (tenant,project,ticket) DO UPDATE SET intent=EXCLUDED.intent,title=EXCLUDED.title,
           branch=EXCLUDED.branch,finalization_mode=EXCLUDED.finalization_mode,
           finalization_target=EXCLUDED.finalization_target;
       DELETE FROM draft_brief_link
        WHERE tenant=in_tenant AND project=in_project AND ticket=in_ticket;
       INSERT INTO draft_brief_link (tenant,project,ticket,ordinal,url)
         SELECT in_tenant,in_project,in_ticket,link.ordinal,link.url
           FROM unnest(in_links) WITH ORDINALITY AS link(url,ordinal);
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
 * A ticket's own title, carried beside its brief so the project table has a
 * name for a ticket to show beyond its number. No grant changes: every role
 * that reads `draft_brief` already holds the relation rather than its columns.
 */
export const migration053: Migration = {
  version: 53,
  name: "the ticket title",
  statements: [...ticketTitle, ...briefWriters],
};
