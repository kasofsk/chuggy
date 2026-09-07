/**
 * The title a brief names, which is what a table of tickets is read down.
 *
 * It is a column of the brief's own relation and takes the line rule a link
 * takes, under the shorter bound a heading is written to. The two doors a brief
 * is written by change signature, so they are dropped and created rather than
 * 42, 50 or 57 edited; the drafts page is replaced too, because a reader that
 * revises sends back what it read and a title it never read is a title erased.
 */

import { briefTitleCharsMax } from "../../../../contract/brief.ts";
import { nativeHttpPageItemsMax } from "../../../../contract/http.ts";
import {
  apiRole,
  boundaryOwnerRole,
  draftCreateFunction,
  draftReviseFunction,
  notificationPublishFunction,
  projectDraftsReadFunction,
  type Migration,
} from "../shared.ts";

const draftCreateSignatureBefore =
  "text,text,text,text,bigint,text,text,text[],text[],text,text,text,text,text";
const draftCreateSignature =
  "text,text,text,text,bigint,text,text,text,text[],text[],text,text,text,text,text";
const draftReviseSignatureBefore =
  "text,text,bigint,bigint,text,text,text,text[],text[],text,text,text,text,text";
const draftReviseSignature =
  "text,text,bigint,bigint,text,text,text,text,text[],text[],text,text,text,text,text";
const projectDraftsSignature = "text,text,bigint,bigint";

/** A title is one line, so no control character belongs in one. */
const briefTitle = [
  `ALTER TABLE draft_brief
     ADD COLUMN title text,
     ADD CONSTRAINT draft_brief_title_is_a_bounded_line CHECK (
       title IS NULL OR (length(title) BETWEEN 1 AND ${briefTitleCharsMax}
         AND title !~ '[[:cntrl:]]'))`,
];

const briefWriters = [
  `DROP FUNCTION ${draftCreateFunction}(${draftCreateSignatureBefore})`,
  `CREATE FUNCTION ${draftCreateFunction}(in_tenant text,in_project text,in_configuration text,
      in_configuration_digest text,in_expected_head bigint,in_authoring text,
      in_title text,in_intent text,in_links text[],in_checks text[],in_branch text,
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
       INSERT INTO draft_brief (tenant,project,ticket,title,intent,branch,finalization_mode,finalization_target)
         VALUES (in_tenant,in_project,minted,in_title,in_intent,in_branch,in_finalization_mode,in_finalization_target);
       INSERT INTO draft_brief_link (tenant,project,ticket,ordinal,url)
         SELECT in_tenant,in_project,minted,link.ordinal,link.url
           FROM unnest(in_links) WITH ORDINALITY AS link(url,ordinal);
       INSERT INTO draft_brief_check (tenant,project,ticket,ordinal,command)
         SELECT in_tenant,in_project,minted,line.ordinal,line.command
           FROM unnest(in_checks) WITH ORDINALITY AS line(command,ordinal);
       PERFORM ${notificationPublishFunction}(in_tenant,in_project,'Draft',minted::text,NULL,1);
       RETURN QUERY SELECT 'Created',minted,1::bigint,'Draft'::text;
     END $$`,
  `DROP FUNCTION ${draftReviseFunction}(${draftReviseSignatureBefore})`,
  `CREATE FUNCTION ${draftReviseFunction}(in_tenant text,in_project text,in_ticket bigint,
      in_expected bigint,in_configuration text,in_authoring text,
      in_title text,in_intent text,in_links text[],in_checks text[],in_branch text,
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
       INSERT INTO draft_brief (tenant,project,ticket,title,intent,branch,finalization_mode,finalization_target)
         VALUES (in_tenant,in_project,in_ticket,in_title,in_intent,in_branch,in_finalization_mode,in_finalization_target)
         ON CONFLICT (tenant,project,ticket) DO UPDATE SET title=EXCLUDED.title,intent=EXCLUDED.intent,
           branch=EXCLUDED.branch,
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

/** The page 61 wrote, answering the title beside the rest of each brief. */
const projectDrafts = [
  `DROP FUNCTION ${projectDraftsReadFunction}(${projectDraftsSignature})`,
  `CREATE FUNCTION ${projectDraftsReadFunction}(
     in_tenant text,in_project text,in_after bigint,in_max bigint)
     RETURNS TABLE(ticket bigint,authoring_version bigint,state text,
                   configuration_revision text,authoring text,
                   title text,intent text,branch text,finalization_mode text,
                   finalization_target text,links text[],checks text[],
                   version_name text,version_number bigint)
     LANGUAGE sql STABLE SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
       SELECT d.ticket,d.authoring_version,d.state,d.configuration_revision,
              r.authoring,b.title,b.intent,b.branch,b.finalization_mode,
              b.finalization_target,
              (SELECT array_agg(k.url ORDER BY k.ordinal) FROM draft_brief_link k
                WHERE k.tenant=d.tenant AND k.project=d.project
                  AND k.ticket=d.ticket),
              (SELECT array_agg(c.command ORDER BY c.ordinal) FROM draft_brief_check c
                WHERE c.tenant=d.tenant AND c.project=d.project
                  AND c.ticket=d.ticket),
              v.name,v.number
         FROM draft d
         JOIN draft_revision r USING (tenant,project,ticket,authoring_version)
         LEFT JOIN draft_brief b
           ON b.tenant=d.tenant AND b.project=d.project AND b.ticket=d.ticket
         LEFT JOIN repository_configuration_provenance p
           ON p.tenant=d.tenant AND p.project=d.project
          AND p.revision=d.configuration_revision
         LEFT JOIN repository_configuration_version v
           ON v.tenant=d.tenant AND v.project=d.project
          AND v.name=p.name AND v.digest=p.digest
        WHERE d.tenant=in_tenant AND d.project=in_project AND d.state='Draft'
          AND d.ticket>coalesce(in_after,0)
        ORDER BY d.ticket
        LIMIT least(coalesce(in_max,${nativeHttpPageItemsMax + 1}),
                    ${nativeHttpPageItemsMax + 1})
     $$`,
  `ALTER FUNCTION ${projectDraftsReadFunction}(${projectDraftsSignature})
     OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${projectDraftsReadFunction}(${projectDraftsSignature})
     FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${projectDraftsReadFunction}(${projectDraftsSignature})
     TO ${apiRole}`,
];

/** A ticket is called something, and that is what a listing leads with. */
export const migration078: Migration = {
  version: 78,
  name: "the ticket brief's title",
  statements: [...briefTitle, ...briefWriters, ...projectDrafts],
};
