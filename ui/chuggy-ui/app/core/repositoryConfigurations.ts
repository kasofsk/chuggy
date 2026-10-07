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
            worker: workerLabel(summary.worker, summary.image),
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
 * The project's revisions, newest first, read to the listing's end under a
 * page budget, or only until a caller has enough of them.
 *
 * A WALK THAT STOPS SAYS SO: a page whose rows all fall past the budget would
 * otherwise read as a repository that declares nothing.
 */
export async function readProjectConfigurations(
  ports: ApiPorts,
  partition: PartitionIdentity,
  enough: (held: readonly ConfigurationSummary[]) => boolean = () => false,
): Promise<ApiResult<ProjectConfigurationsRead>> {
  const held: ConfigurationSummary[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < configurationPagesMax; page += 1) {
    const answered = await apiConfigurations(ports, partition, { cursor });
    if (answered.outcome !== "Ok") return answered;
    held.push(...answered.value.configurations);
    cursor = answered.value.nextCursor;
    if (cursor === undefined || enough(held))
      return { outcome: "Ok", value: { configurations: held, partial: false } };
  }
  return { outcome: "Ok", value: { configurations: held, partial: true } };
}
