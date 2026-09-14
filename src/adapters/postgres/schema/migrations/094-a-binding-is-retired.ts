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
 * THE TRIGGER TREATS IT EXACTLY AS IT TREATS THE LANDING. 090 narrowed 040's
 * refusal by removing one column from the comparison; this removes a second,
 * so `retired_at` is an administrator's to move in either direction and every
 * other column is still nobody's. A one-way column would have made an
 * operator's mistyped retirement unreachable without disabling the trigger,
 * and the door above is what only ever sets it: there is no route that clears
 * one, which is where "settable once" is enforced and where it belongs, since
 * the table cannot tell a retraction from a repair.
 *
 * THE DOOR IS IDEMPOTENT AND UNFENCED. Retiring is one-way and names its own
 * repository, so two administrators retiring cannot cross the way two moving a
 * landing can: there is no second value for one of them to be deciding
 * against. A row already retired keeps the instant it was retired at and
 * answers `Retired`, for the reason 090 gave for answering `Written` to a
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
  repositoryBindingListAllFunction,
  repositoryBindingListFunction,
  repositoryBindingReadFunction,
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

/** A retired binding stays readable by name and stops being the one a session or an import elects. */
export const migration094: Migration = {
  version: 94,
  name: "a binding is retired",
  statements: [
    ...retirement,
    ...retirementWrite,
    ...electingReads,
    ...wholeBindingDoors,
  ],
};
