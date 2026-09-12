/**
 * The three control-plane services that now mint their own repository
 * credentials gain the read they mint from, and the importer gains a listing
 * of every binding there is.
 *
 * THE GRANT ARRIVES WITH THE MINTING, WHICH IS WHAT 084 SAID IT WOULD. 084
 * revoked `forge_installation` from these three by name, because at that
 * commit the only minter was the API and a grant written before its caller is
 * a privilege nothing would have noticed was unnecessary. They mint now: the
 * finalizer pushes and proposes under a token, the ticket service observes a
 * source under one, and the importer reads a snapshot under one. SELECT is the
 * whole of what each gains — the claim door stays the API's and the write
 * stays the owner's, so none of the three can move an installation onto
 * another account or claim one at all.
 *
 * THE LISTING IS A DOOR AND NOT A GRANT ON THE RELATION, for 089's reason:
 * `project_repository` holds every project's rows, and a role that could
 * SELECT it could read one project's bindings while answering another's
 * question. This door answers with the four columns a run needs and nothing
 * else about the row.
 *
 * THIS DOOR IS CROSS-PARTITION WHERE 089'S IS NOT, AND ONLY THE IMPORTER HOLDS
 * IT. The API's listing takes a partition because an API caller is always
 * asking on behalf of one project; the importer has no caller and no project —
 * its whole job is every partition's declarations, so a door that took a
 * partition would need the importer to already know the list it is asking for.
 * That is why nobody else may execute it: the answer is the shape of every
 * tenant's estate, and the only role whose job is all of it is the one that
 * imports for all of it.
 *
 * THE CEILING IS THE DOOR'S. A caller may narrow what it asks for and may not
 * widen it, so a database holding more bindings than one run may import costs
 * one bounded read rather than an unbounded one, and the run says it stopped.
 */

import { repositoryBindingsPerImportMax } from "../../../../interpreter/repositoryConfiguration.ts";
import {
  boundaryOwnerRole,
  configurationImporterRole,
  finalizerRole,
  repositoryBindingListAllFunction,
  ticketServiceRole,
  type Migration,
} from "../shared.ts";

const listAllSignature = "bigint";

/** The read a minted token is drawn from, for the three roles that now draw one. */
const mintingReads = [
  `GRANT SELECT ON forge_installation
     TO ${finalizerRole},${ticketServiceRole},${configurationImporterRole}`,
];

/** Every binding there is, oldest first, without the relation behind it. */
const bindingListing = [
  `CREATE FUNCTION ${repositoryBindingListAllFunction}(in_max bigint)
     RETURNS TABLE(tenant text,project text,repository text,bound_at timestamptz)
     LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     SELECT b.tenant,b.project,b.repository,b.bound_at FROM project_repository b
      ORDER BY b.bound_at,b.tenant,b.project,b.repository
      LIMIT least(coalesce(in_max,${repositoryBindingsPerImportMax}),
                  ${repositoryBindingsPerImportMax})
     $$`,
  `ALTER FUNCTION ${repositoryBindingListAllFunction}(${listAllSignature})
     OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${repositoryBindingListAllFunction}(${listAllSignature})
     FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${repositoryBindingListAllFunction}(${listAllSignature})
     TO ${configurationImporterRole}`,
];

/** The control plane mints for itself, and the importer runs over every binding. */
export const migration088: Migration = {
  version: 88,
  name: "the control plane mints",
  statements: [...mintingReads, ...bindingListing],
};
