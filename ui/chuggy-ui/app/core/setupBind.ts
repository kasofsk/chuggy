/**
 * `bind`: the folder's repository added to the project, with the write the
 * console's Add makes, at the address the portal app lists it by.
 *
 * It is asked only where the checklist's next thing is that repository, which
 * the checklist names only where both apps are granted it, and it lets no
 * other write out. What the site answered is said in the Add dialog's own
 * words, and whether the step is done is the checklist's to say, read after.
 */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { nativeHttpRoutes } from "../../../../src/contract/http.ts";

import type { ApiPorts } from "./apiRequest.ts";
import { apiBindProjectRepository } from "./apiRoutes.ts";
import {
  repositoryBindNote,
  repositoryBindOutcome,
} from "./projectRepositories.ts";
import type { SetupBindAnswered } from "./setupReport.ts";

/** The one write `bind` makes for a project: the binding of one repository. */
export function setupBindWrites(
  partition: PartitionIdentity,
): readonly string[] {
  const route = nativeHttpRoutes.projectRepositories
    .replace(":tenant", encodeURIComponent(partition.tenant))
    .replace(":project", encodeURIComponent(partition.project));
  return [`POST ${route}`];
}

/** Asks the site to bind `url` to the project under `operation`, through ports that let only that write out. */
export async function setupBindAsked(
  ports: ApiPorts,
  partition: PartitionIdentity,
  url: string,
  operation: string,
): Promise<SetupBindAnswered> {
  const outcome = repositoryBindOutcome(
    await apiBindProjectRepository(
      ports,
      partition,
      { repository: url },
      operation,
    ),
  );
  const said = repositoryBindNote(outcome).status;
  return outcome.outcome === "Refused"
    ? { answered: "Refused", refusal: said }
    : { answered: "Bound", said };
}
