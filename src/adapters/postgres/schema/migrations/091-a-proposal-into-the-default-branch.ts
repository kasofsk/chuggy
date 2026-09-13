/**
 * A proposal opened into the branch the repository defaults to, for a brief
 * that names no base of its own.
 *
 * THE BASE IS OPTIONAL AND THE HEAD IS NOT. 051 made a proposing brief name
 * both, so a repository landing by proposal turned every brief naming neither
 * into a constraint violation nothing maps (kasofsk/chuggy#653). The base is
 * now the remote's default branch where the brief leaves it unsaid, and the
 * head stays the brief's own branch, because only the remote knows the one and
 * nothing but the brief knows the other.
 *
 * THE DOOR REFUSES THE BRANCHLESS BRIEF RATHER THAN THE CHECK CATCHING IT. A
 * brief naming no branch is refused as a result row like `RepositoryNotBound`
 * is, because the landing it is refused for is resolved here and not by the
 * caller: the wire's own pairing cannot see a repository's default.
 *
 * THE MODE IS WRITTEN OUT AND NOT RENDERED. 051 and 090 render their mode
 * lists from the live roster, so a mode added to it moves what they install.
 * What this migration says about `PullRequest` does not move.
 */

import {
  draftCreateFunction,
  draftReviseFunction,
  notificationPublishFunction,
  type Migration,
} from "../shared.ts";

/** 051's pairing, relaxed to the half a brief naming no base still states. */
const proposalIntoTheDefault = [
  `ALTER TABLE draft_brief
     DROP CONSTRAINT draft_brief_finalization_is_whole,
     ADD CONSTRAINT draft_brief_finalization_is_whole
       CHECK (finalization_mode <> 'PullRequest'
         OR (branch IS NOT NULL
           AND (finalization_target IS NULL
             OR branch <> finalization_target)))`,
];

/** 090's resolution, which is where a brief naming no mode takes its repository's. */
const resolvedLanding = `coalesce(in_finalization_mode,
       (SELECT b.landing_mode FROM project_repository b
         WHERE b.tenant=in_tenant AND b.project=in_project
           AND b.repository=in_repository),
       'Push')`;

/**
 * The landing a door stores, and the two it stores nothing for: a ticket that
 * runs no finalizer resolves none, and a resolved proposal with no branch to
 * open from is refused in the columns the door answers in.
 */
function briefLandingResolved(unbranched: string): string {
  return `IF in_authoring::jsonb->'value'->>'finalizer' = 'NoFinalizer' THEN
         IF in_finalization_mode IS NOT NULL OR in_finalization_target IS NOT NULL THEN
           RAISE EXCEPTION 'a ticket with no finalizer lands nothing'
             USING ERRCODE='check_violation';
         END IF;
       ELSE
         landing := ${resolvedLanding};
         target := in_finalization_target;
         IF landing='PullRequest' AND in_branch IS NULL THEN
           RETURN QUERY SELECT 'LandingUnbranched',${unbranched}; RETURN;
         END IF;
       END IF;`;
}

/** 090's writers, each refusing the brief its own resolution left with no head. */
const briefWriters = [
  `CREATE OR REPLACE FUNCTION ${draftCreateFunction}(in_tenant text,in_project text,in_configuration text,
      in_configuration_digest text,in_expected_head bigint,in_authoring text,
      in_title text,in_intent text,in_links text[],in_checks text[],in_branch text,
      in_finalization_mode text,in_finalization_target text,in_repository text,
      in_kind text,in_subject text)
     RETURNS TABLE(result text,ticket bigint,authoring_version bigint,state text)
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE minted bigint; landing text; target text;
     BEGIN
       IF NOT EXISTS (SELECT 1 FROM configuration_revision WHERE tenant=in_tenant AND project=in_project
            AND revision=in_configuration AND digest=in_configuration_digest)
         THEN RETURN QUERY SELECT 'ConfigurationNotFound',NULL::bigint,NULL::bigint,NULL::text; RETURN; END IF;
       IF in_repository IS NOT NULL AND NOT EXISTS (SELECT 1 FROM project_repository
            WHERE tenant=in_tenant AND project=in_project AND repository=in_repository)
         THEN RETURN QUERY SELECT 'RepositoryNotBound',NULL::bigint,NULL::bigint,NULL::text; RETURN; END IF;
       ${briefLandingResolved("NULL::bigint,NULL::bigint,NULL::text")}
       UPDATE project SET ticket_next=ticket_next+1
        WHERE tenant=in_tenant AND project=in_project AND lifecycle='Active' AND head=in_expected_head
        RETURNING ticket_next-1 INTO minted;
       IF minted IS NULL THEN RETURN QUERY SELECT 'Stale',NULL::bigint,NULL::bigint,NULL::text; RETURN; END IF;
       INSERT INTO draft VALUES (in_tenant,in_project,minted,1,'Draft',in_configuration);
       INSERT INTO draft_revision (tenant,project,ticket,authoring_version,configuration_revision,authoring,authority_kind,authority_subject)
         VALUES (in_tenant,in_project,minted,1,in_configuration,in_authoring,in_kind,in_subject);
       INSERT INTO draft_brief (tenant,project,ticket,title,intent,branch,finalization_mode,finalization_target,repository)
         VALUES (in_tenant,in_project,minted,in_title,in_intent,in_branch,landing,target,in_repository);
       INSERT INTO draft_brief_link (tenant,project,ticket,ordinal,url)
         SELECT in_tenant,in_project,minted,link.ordinal,link.url
           FROM unnest(in_links) WITH ORDINALITY AS link(url,ordinal);
       INSERT INTO draft_brief_check (tenant,project,ticket,ordinal,command)
         SELECT in_tenant,in_project,minted,line.ordinal,line.command
           FROM unnest(in_checks) WITH ORDINALITY AS line(command,ordinal);
       PERFORM ${notificationPublishFunction}(in_tenant,in_project,'Draft',minted::text,NULL,1);
       RETURN QUERY SELECT 'Created',minted,1::bigint,'Draft'::text;
     END $$`,
  `CREATE OR REPLACE FUNCTION ${draftReviseFunction}(in_tenant text,in_project text,in_ticket bigint,
      in_expected bigint,in_configuration text,in_authoring text,
      in_title text,in_intent text,in_links text[],in_checks text[],in_branch text,
      in_finalization_mode text,in_finalization_target text,in_repository text,
      in_kind text,in_subject text)
     RETURNS TABLE(result text,authoring_version bigint,state text)
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE current draft%ROWTYPE; next_version bigint; landing text; target text;
     BEGIN
       SELECT * INTO current FROM draft WHERE tenant=in_tenant AND project=in_project AND ticket=in_ticket FOR UPDATE;
       IF NOT FOUND THEN RETURN QUERY SELECT 'NotFound',NULL::bigint,NULL::text; RETURN; END IF;
       IF current.state <> 'Draft' THEN RETURN QUERY SELECT 'NotDraft',current.authoring_version,current.state; RETURN; END IF;
       IF current.authoring_version <> in_expected THEN RETURN QUERY SELECT 'Stale',current.authoring_version,current.state; RETURN; END IF;
       IF NOT EXISTS (SELECT 1 FROM configuration_revision WHERE tenant=in_tenant AND project=in_project AND revision=in_configuration)
         THEN RETURN QUERY SELECT 'ConfigurationNotFound',current.authoring_version,current.state; RETURN; END IF;
       IF in_repository IS NOT NULL AND NOT EXISTS (SELECT 1 FROM project_repository
            WHERE tenant=in_tenant AND project=in_project AND repository=in_repository)
         THEN RETURN QUERY SELECT 'RepositoryNotBound',current.authoring_version,current.state; RETURN; END IF;
       ${briefLandingResolved("current.authoring_version,current.state")}
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
       PERFORM ${notificationPublishFunction}(in_tenant,in_project,'Draft',in_ticket::text,NULL,next_version);
       RETURN QUERY SELECT 'Revised',next_version,'Draft'::text;
     END $$`,
];

/** A brief that proposes names a head, and takes the repository's default branch as its base. */
export const migration091: Migration = {
  version: 91,
  name: "a proposal into the default branch",
  statements: [...proposalIntoTheDefault, ...briefWriters],
};
