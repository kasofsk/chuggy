/**
 * What one repository declares under `.chug/configurations`, as the rows its
 * page draws.
 *
 * An import writes every declaration of the commit it reads, and the listing
 * arrives newest first, so the rows of the first commit it holds for a
 * repository are the whole of what that repository declares now. Older commits
 * are its history, which this page is not, and a name only they carry is one
 * the repository stopped declaring. Only what a reader can act on is drawn: an
 * incomplete revision decides nothing yet and carries none of the three facts,
 * so it is a row saying so.
 */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { ConfigurationSummary } from "../../../../src/contract/responses.ts";

import type { ApiPorts, ApiResult } from "./apiRequest.ts";
import { apiConfigurations, configurationPagesMax } from "./apiRoutes.ts";
import { approvalLabel } from "./codeLabels.ts";
import { configurationLabel, workerLabel } from "./labels.ts";
import type { Label } from "./labels.ts";

/** What a ready revision decides, which is the whole of what the row says. */
export interface RepositoryConfigurationFacts {
  readonly worker: Label;
  readonly stages: string;
  readonly approval: string;
}

/** One row: the revision it names, and its facts where it has any. */
export interface RepositoryConfigurationRow {
  readonly revision: string;
  readonly configuration: Label;
  readonly facts: RepositoryConfigurationFacts | undefined;
}

/** The revisions this repository's newest imported commit declares, in the
 * listing's order. */
export function repositoryConfigurations(
  configurations: readonly ConfigurationSummary[],
  repository: string,
): readonly ConfigurationSummary[] {
  let newest: string | undefined;
  const held: ConfigurationSummary[] = [];
  for (const summary of configurations) {
    const provenance = summary.provenance;
    if (provenance.source !== "Repository") continue;
    if (provenance.repository !== repository) continue;
    newest ??= provenance.commit;
    if (provenance.commit === newest) held.push(summary);
  }
  return held;
}

/** A catalog's work, as the workload a ticket selecting none runs among the ones it may select. */
function repositoryCatalogLabel(
  catalog: NonNullable<
    Extract<ConfigurationSummary, { readiness: "Ready" }>["catalog"]
  >,
): Label {
  return {
    text: `${catalog.defaults.work} of ${String(catalog.workloads.length)} workloads`,
    title: catalog.workloads.join(", "),
  };
}

export function repositoryConfigurationRow(
  summary: ConfigurationSummary,
): RepositoryConfigurationRow {
  return {
    revision: summary.revision,
    configuration: configurationLabel(summary.revision, summary.version),
    facts:
      summary.readiness === "Incomplete"
        ? undefined
        : {
            worker:
              summary.catalog === undefined
                ? workerLabel(summary.worker, summary.image)
                : repositoryCatalogLabel(summary.catalog),
            stages: String(summary.evaluationStagesCount),
            approval: approvalLabel(summary.finalization.approvalRequired),
          },
  };
}

/** What a screen says of a walk the budget cut short, the revisions it did
 * not reach being otherwise indistinguishable from ones that do not exist. */
export const configurationsPartialLabel = "Not every configuration was read";

/** What a walk of the listing read, and whether the budget cut it short. */
export interface ProjectConfigurationsRead {
  readonly configurations: readonly ConfigurationSummary[];
  readonly partial: boolean;
}

/**
 * The project's revisions newest first, every one or with `latest` only the
 * newest of each repository and name, read to the listing's end under a page
 * budget or until a caller has enough of them.
 *
 * A WALK THAT STOPS SAYS SO: a page whose rows all fall past the budget would
 * otherwise read as a repository that declares nothing.
 */
export async function readProjectConfigurations(
  ports: ApiPorts,
  partition: PartitionIdentity,
  latest: boolean,
  enough: (held: readonly ConfigurationSummary[]) => boolean = () => false,
): Promise<ApiResult<ProjectConfigurationsRead>> {
  const held: ConfigurationSummary[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < configurationPagesMax; page += 1) {
    const answered = await apiConfigurations(ports, partition, {
      cursor,
      latest: latest ? true : undefined,
    });
    if (answered.outcome !== "Ok") return answered;
    held.push(...answered.value.configurations);
    cursor = answered.value.nextCursor;
    if (cursor === undefined || enough(held))
      return { outcome: "Ok", value: { configurations: held, partial: false } };
  }
  return { outcome: "Ok", value: { configurations: held, partial: true } };
}

/**
 * Every configuration's newest revision, with as many older ones as the budget
 * reaches: the walk is a prefix of the listing read after the newest, so a
 * newest revision it did not reach is older than all it did and follows them.
 * Only the newest read can leave a configuration out, so only it makes the
 * read partial.
 */
export async function readProjectConfigurationsVersions(
  ports: ApiPorts,
  partition: PartitionIdentity,
): Promise<ApiResult<ProjectConfigurationsRead>> {
  const newest = await readProjectConfigurations(ports, partition, true);
  if (newest.outcome !== "Ok") return newest;
  const walked = await readProjectConfigurations(ports, partition, false);
  if (walked.outcome !== "Ok") return walked;
  const reached = new Set(
    walked.value.configurations.map((summary) => summary.revision),
  );
  return {
    outcome: "Ok",
    value: {
      configurations: [
        ...walked.value.configurations,
        ...newest.value.configurations.filter(
          (summary) => !reached.has(summary.revision),
        ),
      ],
      partial: newest.value.partial,
    },
  };
}
