/**
 * A project's configuration reads: one revision, which a `Configuration` frame
 * carries whole, and the views over its revisions that no frame names, which
 * the partition's refetch reaches.
 */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import {
  apiConfiguration,
  apiDraftInitialization,
  apiRepositoryConfigurationHead,
} from "./apiRoutes.ts";
import { consoleListQuery, consoleProjectQuery } from "./consoleQuery.ts";
import type { ConsoleQueryKept } from "./consoleQuery.ts";
import {
  readProjectConfigurations,
  readProjectConfigurationsVersions,
} from "./repositoryConfigurations.ts";
import { projectListReread } from "./projectQueryKeys.ts";
import type { ProjectList } from "./projectQueryKeys.ts";
import { readCreationContext } from "./ticketCreationRun.ts";
import type { CreationContext } from "./ticketCreationRun.ts";

/** The one list the creation screen reads under, the context being the
 * project's rather than any one revision's. */
export const creationContextName = "creation";

/**
 * Where the creation context is held, and what makes it stale.
 *
 * Every `Configuration` frame does, because the context is whichever revisions
 * are offered and the frame's own revision does not say which those now are —
 * a newer commit's import changes the answer without ever appearing in the
 * entry the screen holds.
 */
export function creationContextList(
  partition: PartitionIdentity,
): ProjectList<CreationContext> {
  return projectListReread<CreationContext>(
    partition,
    "Configuration",
    creationContextName,
  );
}

export function configurationQuery(
  partition: PartitionIdentity,
  revision: string,
  kept: ConsoleQueryKept = "Read",
) {
  return consoleProjectQuery(
    partition,
    "Configuration",
    revision,
    (ports) => apiConfiguration(ports, partition, revision),
    undefined,
    kept,
  );
}

/** Every revision, for the catalog: not the repository page's read, which
 * holds only the newest. */
export function catalogConfigurationsQuery(partition: PartitionIdentity) {
  return consoleProjectQuery(
    partition,
    "Configuration",
    "catalog-configurations",
    (ports) => readProjectConfigurationsVersions(ports, partition),
  );
}

/** The newest revisions, which every repository's page shares. */
export function repositoryConfigurationsQuery(partition: PartitionIdentity) {
  return consoleProjectQuery(
    partition,
    "Configuration",
    "repository-configurations",
    (ports) => readProjectConfigurations(ports, partition, true),
  );
}

/** What one repository's head declares. */
export function configurationHeadQuery(
  partition: PartitionIdentity,
  repository: string,
) {
  return consoleProjectQuery(
    partition,
    "Configuration",
    `head:${repository}`,
    (ports) => apiRepositoryConfigurationHead(ports, partition, repository),
  );
}

/** What a draft under one revision starts from. */
export function draftInitializationQuery(
  partition: PartitionIdentity,
  revision: string,
) {
  return consoleProjectQuery(
    partition,
    "Configuration",
    `${revision}/draft-initialization`,
    (ports) => apiDraftInitialization(ports, partition, revision),
  );
}

/** The configurations a ticket may be drawn under, read again on every
 * `Configuration` frame. */
export function creationContextQuery(partition: PartitionIdentity) {
  return consoleListQuery(creationContextList(partition), (ports) =>
    readCreationContext(ports, partition),
  );
}
