/**
 * `PullRequestMerge` widens the finalization and landing rosters: a brief may
 * open a proposal and merge it rather than leave it for a human, and a
 * repository may default new tickets to that landing.
 *
 * 051 AND 090 ARE HELD TO WHAT THEY INSTALLED. Both rendered their mode lists
 * from the live roster, so this widening would have rewritten what a fresh
 * migrate installs for a database only ever meant to see two modes at that
 * point in its history. They are frozen to the two-mode list they always
 * rendered, in this same migration, so the widening happens once and moves
 * nothing underneath it.
 */

import { briefFinalizationModes } from "../../../../contract/rosters.ts";
import {
  draftCreateFunction,
  draftReviseFunction,
  notificationPublishFunction,
  schemaTextSet,
  type Migration,
} from "../shared.ts";

/** 050's and 090's rosters, widened to what this tree now lands by. */
const draftBriefWidened = [
  `ALTER TABLE draft_brief
     DROP CONSTRAINT draft_brief_finalization_mode_is_known,
     ADD CONSTRAINT draft_brief_finalization_mode_is_known
       CHECK (finalization_mode IN (${schemaTextSet([
         ...briefFinalizationModes,
       ])})),
     DROP CONSTRAINT draft_brief_finalization_is_whole,
     ADD CONSTRAINT draft_brief_finalization_is_whole
       CHECK (finalization_mode NOT IN ('PullRequest','PullRequestMerge')
         OR (branch IS NOT NULL
           AND (finalization_target IS NULL
             OR branch <> finalization_target)))`,
];

const projectRepositoryWidened = [
  `ALTER TABLE project_repository
     DROP CONSTRAINT project_repository_landing_mode_is_known,
     ADD CONSTRAINT project_repository_landing_mode_is_known
       CHECK (landing_mode IN (${schemaTextSet([...briefFinalizationModes])}))`,
];

/** 090's resolution, carried forward unchanged: a brief naming no mode still takes its repository's. */
const resolvedLanding = `coalesce(in_finalization_mode,
       (SELECT b.landing_mode FROM project_repository b
         WHERE b.tenant=in_tenant AND b.project=in_project
           AND b.repository=in_repository),
       'Push')`;

/**
 * 091's refusal, its one literal mode widened to the two that open a proposal:
 * both need a head to propose from, so both are refused the same way where a
 * brief resolves to one and names no branch.
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
         IF landing IN ('PullRequest','PullRequestMerge') AND in_branch IS NULL THEN
           RETURN QUERY SELECT 'LandingUnbranched',${unbranched}; RETURN;
         END IF;
       END IF;`;
}

/** 091's writers, restated because its branchless refusal named one proposing mode literally. */
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

/** A brief may open a proposal and merge it, and a repository may default to that landing. */
export const migration092: Migration = {
  version: 92,
  name: "a pull request that merges",
  statements: [
    ...draftBriefWidened,
    ...projectRepositoryWidened,
    ...briefWriters,
  ],
};
