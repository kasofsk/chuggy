/**
 * A repository's landing default: the mode a ticket in it lands by when its
 * brief names none.
 *
 * THE BINDING ROW IS WHERE IT GOES, AND THAT IS WHY THE IMMUTABILITY TRIGGER
 * NARROWS. 040 refused every UPDATE on `project_repository` because nothing on
 * the row was ever an operator's to move; a landing is, so the trigger now
 * refuses every DELETE and every UPDATE that changes any column but
 * `landing_mode`. It compares the two rows with the column removed rather than
 * naming the columns it protects, so a column added later is protected by the
 * comparison that already stands.
 *
 * THE WRITE IS FENCED ON THE LANDING THE WRITER READ, under a row lock rather
 * than a read followed by a write: two administrators editing one repository
 * would otherwise cross with the later write silently winning. A repeat of a
 * write that already landed is not a crossing, so a row already holding the
 * mode asked for answers `Written`.
 *
 * THE POINT READ IS A DOOR OF ITS OWN AND NOT THE LISTING. A bind answers the
 * row it just made, and a project binding more repositories than the listing
 * answers would have that row fall off the end of it.
 *
 * THE DRAFT DOORS RESOLVE THE MODE RATHER THAN THE ADAPTER, because the value
 * they resolve against is a column of a row the caller never read. A brief
 * naming a mode keeps it; one naming none takes its repository's; one naming
 * neither a mode nor a repository takes the tree's own default. Both doors keep
 * their signatures, so each is replaced rather than dropped, which leaves the
 * owner and the grants they already carry standing.
 *
 * A TICKET THAT RUNS NO FINALIZER STORES NO LANDING, so `finalization_mode`
 * becomes nullable and the doors resolve nothing for one, refusing a caller
 * that named a landing anyway rather than keeping it.
 */

import { projectRepositoriesAnsweredMax } from "../../../../contract/http.ts";
import { briefFinalizationModes } from "../../../../contract/rosters.ts";
import { briefFinalizationDefault } from "../../../../interpreter/ticketBrief.ts";
import {
  apiRole,
  boundaryOwnerRole,
  draftCreateFunction,
  draftReviseFunction,
  notificationPublishFunction,
  repositoryBindingListFunction,
  repositoryLandingReadFunction,
  repositoryLandingWriteFunction,
  schemaTextSet,
  type Migration,
} from "../shared.ts";

const landingReadSignature = "text,text,text";
const landingWriteSignature = "text,text,text,text,text";
const listSignature = "text,text,bigint";

/** The mode a binding made before this column existed lands by, which is the one every brief took. */
const bindingLanding = [
  `ALTER TABLE project_repository
     ADD COLUMN landing_mode text NOT NULL
       DEFAULT '${briefFinalizationDefault.mode}',
     ADD CONSTRAINT project_repository_landing_mode_is_known
       CHECK (landing_mode IN (${schemaTextSet([...briefFinalizationModes])}))`,
  `CREATE OR REPLACE FUNCTION project_repository_is_immutable() RETURNS trigger
     LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN
     IF TG_OP='UPDATE'
        AND to_jsonb(NEW)-'landing_mode' = to_jsonb(OLD)-'landing_mode'
       THEN RETURN NEW; END IF;
     RAISE EXCEPTION 'repository bindings are immutable but for their landing'
       USING ERRCODE='integrity_constraint_violation'; END $$`,
  `GRANT UPDATE (landing_mode) ON project_repository TO ${boundaryOwnerRole}`,
];

/** One binding's landing, for the bind that answers the row it just made. */
const landingRead = [
  `CREATE FUNCTION ${repositoryLandingReadFunction}(
     in_tenant text,in_project text,in_repository text)
     RETURNS TABLE(repository text,bound_at timestamptz,landing_mode text)
     LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     SELECT b.repository,b.bound_at,b.landing_mode FROM project_repository b
      WHERE b.tenant=in_tenant AND b.project=in_project AND b.repository=in_repository
     $$`,
  `ALTER FUNCTION ${repositoryLandingReadFunction}(${landingReadSignature})
     OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${repositoryLandingReadFunction}(${landingReadSignature})
     FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${repositoryLandingReadFunction}(${landingReadSignature})
     TO ${apiRole}`,
];

/** The write, decided under the row's own lock and answering the row either way. */
const landingWrite = [
  `CREATE FUNCTION ${repositoryLandingWriteFunction}(
     in_tenant text,in_project text,in_repository text,
     in_expected_mode text,in_mode text)
     RETURNS TABLE(outcome text,repository text,bound_at timestamptz,landing_mode text)
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
   DECLARE standing project_repository%ROWTYPE;
   BEGIN
     SELECT * INTO standing FROM project_repository b
      WHERE b.tenant=in_tenant AND b.project=in_project
        AND b.repository=in_repository FOR UPDATE;
     IF NOT FOUND THEN
       RETURN QUERY SELECT 'NotBound',NULL::text,NULL::timestamptz,NULL::text; RETURN;
     END IF;
     IF standing.landing_mode<>in_expected_mode AND standing.landing_mode<>in_mode THEN
       RETURN QUERY SELECT 'LandingMoved',standing.repository,standing.bound_at,
         standing.landing_mode; RETURN;
     END IF;
     UPDATE project_repository b SET landing_mode=in_mode
      WHERE b.tenant=in_tenant AND b.project=in_project
        AND b.repository=in_repository;
     RETURN QUERY SELECT 'Written',standing.repository,standing.bound_at,in_mode;
   END $$`,
  `ALTER FUNCTION ${repositoryLandingWriteFunction}(${landingWriteSignature})
     OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${repositoryLandingWriteFunction}(${landingWriteSignature})
     FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${repositoryLandingWriteFunction}(${landingWriteSignature})
     TO ${apiRole}`,
];

/** 89's listing, answering the landing beside the binding it belongs to. */
const bindingListing = [
  `DROP FUNCTION ${repositoryBindingListFunction}(${listSignature})`,
  `CREATE FUNCTION ${repositoryBindingListFunction}(
     in_tenant text,in_project text,in_max bigint)
     RETURNS TABLE(repository text,bound_at timestamptz,landing_mode text)
     LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     SELECT b.repository,b.bound_at,b.landing_mode FROM project_repository b
      WHERE b.tenant=in_tenant AND b.project=in_project
      ORDER BY b.bound_at,b.repository
      LIMIT least(coalesce(in_max,${projectRepositoriesAnsweredMax}),
                  ${projectRepositoriesAnsweredMax})
     $$`,
  `ALTER FUNCTION ${repositoryBindingListFunction}(${listSignature})
     OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${repositoryBindingListFunction}(${listSignature})
     FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${repositoryBindingListFunction}(${listSignature})
     TO ${apiRole}`,
];

/** What a brief naming no mode resolves to, which is its repository's and then the tree's own. */
const resolvedLanding = `coalesce(in_finalization_mode,
       (SELECT b.landing_mode FROM project_repository b
         WHERE b.tenant=in_tenant AND b.project=in_project
           AND b.repository=in_repository),
       '${briefFinalizationDefault.mode}')`;

/**
 * The mode a ticket that lands nothing stores. 050's `mode_is_known` and 051's
 * `is_whole` already pass on a null one, so only the target needs a rule of its
 * own: a reference to land on says nothing without a way of landing.
 */
const briefLanding = [
  `ALTER TABLE draft_brief
     ALTER COLUMN finalization_mode DROP NOT NULL,
     ALTER COLUMN finalization_mode DROP DEFAULT,
     ADD CONSTRAINT draft_brief_finalization_target_needs_a_mode
       CHECK (finalization_target IS NULL OR finalization_mode IS NOT NULL)`,
];

/** The finalizer a draft is authored to run, read out of the event the caller hands the door. */
const authoredFinalizer = `in_authoring::jsonb->'value'->>'finalizer'`;

/** What a ticket that lands nothing is refused for naming a landing anyway. */
const landsNothing = `IF ${authoredFinalizer} = 'NoFinalizer' THEN
         IF in_finalization_mode IS NOT NULL OR in_finalization_target IS NOT NULL THEN
           RAISE EXCEPTION 'a ticket with no finalizer lands nothing'
             USING ERRCODE='check_violation';
         END IF;
       ELSE
         landing := ${resolvedLanding};
         target := in_finalization_target;
       END IF;`;

/** 81's writers, each resolving the mode it stores rather than being handed one. */
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
       ${landsNothing}
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
       ${landsNothing}
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

/** A repository says how a ticket in it lands, and a brief that names no landing takes it. */
export const migration090: Migration = {
  version: 90,
  name: "a repository's landing",
  statements: [
    ...bindingLanding,
    ...landingRead,
    ...landingWrite,
    ...bindingListing,
    ...briefLanding,
    ...briefWriters,
  ],
};
