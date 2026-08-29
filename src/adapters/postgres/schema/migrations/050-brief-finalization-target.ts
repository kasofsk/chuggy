import {
  briefBranchCharsMax,
  briefBranchPrefix,
} from "../../../../contract/brief.ts";
import { briefFinalizationModes } from "../../../../contract/rosters.ts";
import { briefFinalizationDefault } from "../../../../interpreter/ticketBrief.ts";
import {
  apiRole,
  boundaryOwnerRole,
  draftCreateFunction,
  draftReviseFunction,
  notificationPublishFunction,
  schemaTextSet,
  type Migration,
} from "../shared.ts";

const draftCreateSignature =
  "text,text,text,text,bigint,text,text,text[],text,text,text,text,text";
const draftReviseSignature =
  "text,text,bigint,bigint,text,text,text,text[],text,text,text,text,text";

/**
 * The mode a row already carrying a brief lands under, which is what a brief
 * naming no finalization means, so a draft written before this column existed
 * still lands where its work happened.
 */
const briefFinalization = [
  `ALTER TABLE draft_brief
     ADD COLUMN finalization_mode text NOT NULL
       DEFAULT '${briefFinalizationDefault.mode}',
     ADD COLUMN finalization_target text,
     ADD CONSTRAINT draft_brief_finalization_mode_is_known
       CHECK (finalization_mode IN (${schemaTextSet([
         ...briefFinalizationModes,
       ])})),
     ADD CONSTRAINT draft_brief_finalization_target_is_a_ref
       CHECK (finalization_target IS NULL
         OR (length(finalization_target) BETWEEN 1 AND ${briefBranchCharsMax}
           AND finalization_target LIKE '${briefBranchPrefix}%'
           AND finalization_target !~ '[[:cntrl:]]'))`,
];

const briefWriters = [
  `DROP FUNCTION ${draftCreateFunction}(text,text,text,text,bigint,text,text,text[],text,text,text)`,
  `CREATE FUNCTION ${draftCreateFunction}(in_tenant text,in_project text,in_configuration text,
      in_configuration_digest text,in_expected_head bigint,in_authoring text,
      in_intent text,in_links text[],in_branch text,
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
       PERFORM ${notificationPublishFunction}(in_tenant,in_project,'Draft',minted::text,NULL,1);
       RETURN QUERY SELECT 'Created',minted,1::bigint,'Draft'::text;
     END $$`,
  `DROP FUNCTION ${draftReviseFunction}(text,text,bigint,bigint,text,text,text,text[],text,text,text)`,
  `CREATE FUNCTION ${draftReviseFunction}(in_tenant text,in_project text,in_ticket bigint,
      in_expected bigint,in_configuration text,in_authoring text,
      in_intent text,in_links text[],in_branch text,
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
 * Where a ticket's work lands, said apart from the branch it happens on and
 * carried by the brief's own relation, so the doors that write a brief are
 * replaced rather than migration 42 edited, the ledger being append-only. Every
 * role that reads the brief already holds the relation rather than its columns,
 * so no grant moves.
 */
export const migration050: Migration = {
  version: 50,
  name: "the brief's finalization target",
  statements: [...briefFinalization, ...briefWriters],
};
