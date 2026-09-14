/**
 * A binding can be retired: the repository a project used to read stays on the
 * row that names it and stops being one anything new is placed against.
 *
 * THE ROW STAYS BECAUSE THE PAST NAMES IT. A released ticket's brief names its
 * repository, a configuration revision is `repository:<commit>:<name>`, and
 * work observation, the finalizer's credentials and the plane's all resolve a
 * binding the caller already knows the identity of. Deleting the row would
 * break every one of those reads, so retirement is a fact added to the binding
 * rather than the binding's removal, and a read that NAMES a repository still
 * answers it retired or not.
 *
 * WHAT RETIREMENT MOVES IS THE ELECTION. The two reads that name no repository
 * are the ones that pick: `read_project_repository_binding` elects a project's
 * oldest for session placement, and `list_repository_bindings` hands the
 * importer the estate. Both now see live bindings only, so a project whose
 * oldest binding is retired places its sessions against the oldest that is
 * left and the importer stops asking a remote nobody serves. The rule between
 * live bindings is unchanged: oldest wins, as 080's election left it.
 *
 * AND NOTHING NEW IS AUTHORED AGAINST ONE. 092's two brief writers refuse a
 * repository the project has not bound; they refuse one it has retired by the
 * same answer, because an author naming an unbound repository and an author
 * naming a retired one are asking for the same impossible thing. A released
 * ticket is untouched: its brief named its repository while the binding stood,
 * and every read that resolves one names it.
 *
 * THE TRIGGER TREATS IT EXACTLY AS IT TREATS THE LANDING. 090 narrowed 040's
 * refusal by removing one column from the comparison; this removes a second,
 * so `retired_at` is an administrator's to move in either direction and every
 * other column is still nobody's. Both directions are a door's: the door below
 * sets it, and binding the repository again clears it, so an operator's
 * mistyped retirement is undone by the route that made the binding rather than
 * by disabling the trigger.
 *
 * BINDING IT AGAIN REINSTATES IT. 080's door answers `AlreadyBound` where the
 * project already holds the repository, because there was nothing to do; where
 * the row it holds is retired there is, so it clears the retirement and answers
 * `Bound`, which is the fact the project is being told. The row keeps the
 * identity, the instant and the landing it always had, because a reinstated
 * binding is the binding that stood.
 *
 * THE DOOR IS IDEMPOTENT AND UNFENCED. Retiring names its own repository and
 * moves the column one way, so two administrators retiring cannot cross the way
 * two moving a landing can: there is no second value for one of them to be
 * deciding against. A row already retired keeps the instant it was retired at
 * and answers `Retired`, for the reason 090 gave for answering `Written` to a
 * repeat.
 *
 * THE THREE DOORS THAT ANSWER A WHOLE BINDING ANSWER THIS TOO. A listing that
 * showed a retired binding as though it were live would be the only account an
 * administrator has of a retirement that did or did not land, so each is
 * dropped and recreated for the column, which takes its owner and its grants
 * with it exactly as 82 and 90 say.
 */

import { projectRepositoriesAnsweredMax } from "../../../../contract/http.ts";
import { repositoryBindingsPerImportMax } from "../../../../interpreter/repositoryConfiguration.ts";
import {
  apiRole,
  boundaryOwnerRole,
  draftCreateFunction,
  draftReviseFunction,
  notificationPublishFunction,
  repositoryBindingListAllFunction,
  repositoryBindingListFunction,
  repositoryBindingReadFunction,
  repositoryBindingWriteFunction,
  repositoryLandingReadFunction,
  repositoryLandingWriteFunction,
  repositoryRetirementWriteFunction,
  type Migration,
} from "../shared.ts";

const listSignature = "text,text,bigint";
const landingReadSignature = "text,text,text";
const landingWriteSignature = "text,text,text,text,text";
const retirementSignature = "text,text,text";

/** The instant a binding stopped being elected, and the trigger widened by one column to let it be written. */
const retirement = [
  `ALTER TABLE project_repository ADD COLUMN retired_at timestamptz`,
  `CREATE OR REPLACE FUNCTION project_repository_is_immutable() RETURNS trigger
     LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN
     IF TG_OP='UPDATE'
        AND to_jsonb(NEW)-'landing_mode'-'retired_at'
          = to_jsonb(OLD)-'landing_mode'-'retired_at'
       THEN RETURN NEW; END IF;
     RAISE EXCEPTION 'repository bindings are immutable but for their landing and their retirement'
       USING ERRCODE='integrity_constraint_violation'; END $$`,
  `GRANT UPDATE (retired_at) ON project_repository TO ${boundaryOwnerRole}`,
];

/** The retirement itself: one binding, named, under its own row lock. */
const retirementWrite = [
  `CREATE FUNCTION ${repositoryRetirementWriteFunction}(
     in_tenant text,in_project text,in_repository text)
     RETURNS TABLE(outcome text,repository text,bound_at timestamptz,
                   landing_mode text,retired_at timestamptz)
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
   DECLARE standing project_repository%ROWTYPE;
   BEGIN
     SELECT * INTO standing FROM project_repository b
      WHERE b.tenant=in_tenant AND b.project=in_project
        AND b.repository=in_repository FOR UPDATE;
     IF NOT FOUND THEN
       RETURN QUERY SELECT 'NotBound',NULL::text,NULL::timestamptz,
         NULL::text,NULL::timestamptz; RETURN;
     END IF;
     IF standing.retired_at IS NULL THEN
       UPDATE project_repository b SET retired_at=now()
        WHERE b.tenant=in_tenant AND b.project=in_project
          AND b.repository=in_repository
        RETURNING b.retired_at INTO standing.retired_at;
     END IF;
     RETURN QUERY SELECT 'Retired',standing.repository,standing.bound_at,
       standing.landing_mode,standing.retired_at;
   END $$`,
  `ALTER FUNCTION ${repositoryRetirementWriteFunction}(${retirementSignature})
     OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${repositoryRetirementWriteFunction}(${retirementSignature})
     FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${repositoryRetirementWriteFunction}(${retirementSignature})
     TO ${apiRole}`,
];

/**
 * The two reads that elect. Naming a repository still answers it whatever its
 * standing, because every caller that names one holds the identity from a row
 * the retirement did not move; naming none takes the oldest live.
 */
const electingReads = [
  `CREATE OR REPLACE FUNCTION ${repositoryBindingReadFunction}(
     in_tenant text,in_project text,in_repository text)
     RETURNS TABLE(repository text,recovery_epoch text)
     LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     SELECT b.repository,b.recovery_epoch FROM project_repository b
      WHERE b.tenant=in_tenant AND b.project=in_project
        AND (in_repository IS NULL OR b.repository=in_repository)
        AND (in_repository IS NOT NULL OR b.retired_at IS NULL)
      ORDER BY b.bound_at,b.repository LIMIT 1
     $$`,
  `CREATE OR REPLACE FUNCTION ${repositoryBindingListAllFunction}(in_max bigint)
     RETURNS TABLE(tenant text,project text,repository text,bound_at timestamptz)
     LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     SELECT b.tenant,b.project,b.repository,b.bound_at FROM project_repository b
      WHERE b.retired_at IS NULL
      ORDER BY b.bound_at,b.tenant,b.project,b.repository
      LIMIT least(coalesce(in_max,${repositoryBindingsPerImportMax}),
                  ${repositoryBindingsPerImportMax})
     $$`,
];

/** 090's resolution as 092 restated it, reached only where the guard above let the brief through. */
const resolvedLanding = `coalesce(in_finalization_mode,
       (SELECT b.landing_mode FROM project_repository b
         WHERE b.tenant=in_tenant AND b.project=in_project
           AND b.repository=in_repository),
       'Push')`;

/** 092's branchless refusal, restated because its writers are. */
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

/** 092's writers, restated because a brief may only name a binding that is live. */
const authoringDoors = [
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
            WHERE tenant=in_tenant AND project=in_project AND repository=in_repository
              AND retired_at IS NULL)
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
            WHERE tenant=in_tenant AND project=in_project AND repository=in_repository
              AND retired_at IS NULL)
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

/** 080's door, restated because a bind of a retired binding has something to do. */
const reinstatement = [
  `CREATE OR REPLACE FUNCTION ${repositoryBindingWriteFunction}(
     in_tenant text,in_project text,in_repository text,in_recovery_epoch text,
     in_operation text,in_authority_kind text,in_authority_subject text)
     RETURNS text LANGUAGE plpgsql SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
   DECLARE existing project_repository_bind_operation%ROWTYPE;
           holder project_repository%ROWTYPE;
           current_epoch text;
           accepted text;
   BEGIN
     PERFORM pg_advisory_xact_lock(hashtextextended('operation:'||in_operation,0));
     SELECT * INTO existing FROM project_repository_bind_operation
      WHERE operation=in_operation;
     IF FOUND THEN
       IF existing.tenant=in_tenant AND existing.project=in_project
          AND existing.repository=in_repository
          AND existing.recovery_epoch=in_recovery_epoch
          AND existing.authority_kind=in_authority_kind
          AND existing.authority_subject=in_authority_subject
         THEN RETURN 'AlreadyBound'; END IF;
       RETURN 'OperationConflict';
     END IF;
     PERFORM pg_advisory_xact_lock(hashtextextended('repository:'||in_repository,0));
     PERFORM 1 FROM project WHERE tenant=in_tenant AND project=in_project FOR UPDATE;
     IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='foreign_key_violation',
       MESSAGE='repository binding project is absent'; END IF;
     SELECT epoch INTO current_epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1;
     IF current_epoch IS DISTINCT FROM in_recovery_epoch
       THEN RETURN 'RecoveryEpochMismatch'; END IF;
     SELECT * INTO holder FROM project_repository WHERE repository=in_repository;
     IF FOUND THEN
       IF holder.tenant<>in_tenant OR holder.project<>in_project
         THEN RETURN 'RepositoryBoundElsewhere'; END IF;
       IF holder.retired_at IS NULL THEN
         accepted := 'AlreadyBound';
       ELSE
         UPDATE project_repository b SET retired_at=NULL
          WHERE b.tenant=in_tenant AND b.project=in_project
            AND b.repository=in_repository;
         accepted := 'Bound';
       END IF;
     ELSE
       INSERT INTO project_repository(tenant,project,repository,recovery_epoch)
         VALUES(in_tenant,in_project,in_repository,in_recovery_epoch);
       accepted := 'Bound';
     END IF;
     INSERT INTO project_repository_bind_operation
       (operation,tenant,project,repository,recovery_epoch,
        authority_kind,authority_subject,outcome)
       VALUES(in_operation,in_tenant,in_project,in_repository,in_recovery_epoch,
              in_authority_kind,in_authority_subject,accepted);
     RETURN accepted;
   END $$`,
];

/** 90's three doors, each answering the retirement beside the binding it belongs to. */
const wholeBindingDoors = [
  `DROP FUNCTION ${repositoryBindingListFunction}(${listSignature})`,
  `CREATE FUNCTION ${repositoryBindingListFunction}(
     in_tenant text,in_project text,in_max bigint)
     RETURNS TABLE(repository text,bound_at timestamptz,landing_mode text,
                   retired_at timestamptz)
     LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     SELECT b.repository,b.bound_at,b.landing_mode,b.retired_at
       FROM project_repository b
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
  `DROP FUNCTION ${repositoryLandingReadFunction}(${landingReadSignature})`,
  `CREATE FUNCTION ${repositoryLandingReadFunction}(
     in_tenant text,in_project text,in_repository text)
     RETURNS TABLE(repository text,bound_at timestamptz,landing_mode text,
                   retired_at timestamptz)
     LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     SELECT b.repository,b.bound_at,b.landing_mode,b.retired_at
       FROM project_repository b
      WHERE b.tenant=in_tenant AND b.project=in_project AND b.repository=in_repository
     $$`,
  `ALTER FUNCTION ${repositoryLandingReadFunction}(${landingReadSignature})
     OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${repositoryLandingReadFunction}(${landingReadSignature})
     FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${repositoryLandingReadFunction}(${landingReadSignature})
     TO ${apiRole}`,
  `DROP FUNCTION ${repositoryLandingWriteFunction}(${landingWriteSignature})`,
  `CREATE FUNCTION ${repositoryLandingWriteFunction}(
     in_tenant text,in_project text,in_repository text,
     in_expected_mode text,in_mode text)
     RETURNS TABLE(outcome text,repository text,bound_at timestamptz,
                   landing_mode text,retired_at timestamptz)
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
   DECLARE standing project_repository%ROWTYPE;
   BEGIN
     SELECT * INTO standing FROM project_repository b
      WHERE b.tenant=in_tenant AND b.project=in_project
        AND b.repository=in_repository FOR UPDATE;
     IF NOT FOUND THEN
       RETURN QUERY SELECT 'NotBound',NULL::text,NULL::timestamptz,
         NULL::text,NULL::timestamptz; RETURN;
     END IF;
     IF standing.landing_mode<>in_expected_mode AND standing.landing_mode<>in_mode THEN
       RETURN QUERY SELECT 'LandingMoved',standing.repository,standing.bound_at,
         standing.landing_mode,standing.retired_at; RETURN;
     END IF;
     UPDATE project_repository b SET landing_mode=in_mode
      WHERE b.tenant=in_tenant AND b.project=in_project
        AND b.repository=in_repository;
     RETURN QUERY SELECT 'Written',standing.repository,standing.bound_at,in_mode,
       standing.retired_at;
   END $$`,
  `ALTER FUNCTION ${repositoryLandingWriteFunction}(${landingWriteSignature})
     OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${repositoryLandingWriteFunction}(${landingWriteSignature})
     FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${repositoryLandingWriteFunction}(${landingWriteSignature})
     TO ${apiRole}`,
];

/** A retired binding stays readable by name and stops being the one a session, an import or a brief elects. */
export const migration094: Migration = {
  version: 94,
  name: "a binding is retired",
  statements: [
    ...retirement,
    ...retirementWrite,
    ...electingReads,
    ...authoringDoors,
    ...reinstatement,
    ...wholeBindingDoors,
  ],
};
