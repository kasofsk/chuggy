/**
 * The API gains the two doors onboarding is done through, and a door of its own
 * for reading what a project binds.
 *
 * THE GRANTS ARRIVE WITH THE ROUTES, WHICH IS WHAT 084 AND 080 SAID THEY WOULD.
 * 084 granted the API the read it mints from and withheld the claim door
 * "until the route arrives"; 080 left `bind_project_repository` executable by
 * nobody at all, because its only caller was an operator connecting as the
 * owner. Both routes exist now, so both grants are made here rather than at
 * either door's own migration — a grant written before its caller is a
 * privilege nothing would have noticed was unnecessary.
 *
 * EXECUTE IS THE WHOLE OF WHAT THE API GAINS. Neither table becomes writable:
 * `forge_installation` keeps its SELECT and no more, `project_repository` stays
 * unreadable and unwritable to this role, and every write still goes through a
 * definer that decides the outcome. So the API cannot claim an account the
 * trigger would refuse to move, cannot bind past the epoch fence, and cannot
 * spend a bind operation identity twice — the doors answer those, and there is
 * no second path to the rows they guard.
 *
 * THE LISTING IS A NEW DOOR AND NOT A GRANT ON THE RELATION. A project's
 * bindings are read by a project's readers, and a SELECT on
 * `project_repository` would answer one project's question with a relation
 * holding every project's rows. The function takes the partition and returns
 * only its own, in the order `read_project_repository_binding` already elects
 * by, so the head of the list is the binding every caller naming no repository
 * works against.
 *
 * THE CEILING IS THE DOOR'S AND NOT ONLY THE ROUTE'S. A caller may narrow what
 * it asks for and may not widen it, so a project that somehow binds more than
 * the contract answers costs one bounded read rather than an unbounded one.
 */

import { projectRepositoriesAnsweredMax } from "../../../../contract/http.ts";
import {
  apiRole,
  boundaryOwnerRole,
  forgeInstallationRecordFunction,
  repositoryBindingListFunction,
  repositoryBindingWriteFunction,
  type Migration,
} from "../shared.ts";

const claimSignature = "text,text,text,text,text,text,text,text";
const bindSignature = "text,text,text,text,text,text,text";
const listSignature = "text,text,bigint";

/** The two doors an onboarding route drives, each already owned by the boundary owner. */
const apiDoors = [
  `GRANT EXECUTE ON FUNCTION ${forgeInstallationRecordFunction}(${claimSignature})
     TO ${apiRole}`,
  `GRANT EXECUTE ON FUNCTION ${repositoryBindingWriteFunction}(${bindSignature})
     TO ${apiRole}`,
];

/** A project's own bindings, oldest first, without the relation behind them. */
const bindingListing = [
  `CREATE FUNCTION ${repositoryBindingListFunction}(
     in_tenant text,in_project text,in_max bigint)
     RETURNS TABLE(repository text,bound_at timestamptz)
     LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     SELECT b.repository,b.bound_at FROM project_repository b
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

/** Onboarding is done over the API, so the API holds the doors it is done through. */
export const migration085: Migration = {
  version: 85,
  name: "onboarding over the api",
  statements: [...apiDoors, ...bindingListing],
};
