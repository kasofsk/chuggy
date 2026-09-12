/**
 * What one repository declares under `.chug/configurations`, as the rows its
 * page draws.
 *
 * The listing arrives newest first, so the first revision of a name is that
 * name's current one and the rest are its history, which this page is not.
 * Only what a reader can act on is drawn: an incomplete revision decides
 * nothing yet and carries none of the four facts, so it is a row saying so.
 */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { ConfigurationSummary } from "../../../../src/contract/responses.ts";

import type { ApiPorts, ApiResult } from "./apiRequest.ts";
import { apiConfigurations, configurationPagesMax } from "./apiRoutes.ts";
import { approvalLabel, handoffLabel } from "./codeLabels.ts";
import { configurationLabel, workerLabel } from "./labels.ts";
import type { Label } from "./labels.ts";
import { latestReadyConfiguration } from "./ticketCreation.ts";

/** What a ready revision decides, which is the whole of what the row says. */
export interface RepositoryConfigurationFacts {
  readonly worker: Label;
  readonly stages: string;
  readonly approval: string;
  readonly handoff: string;
}

/** One row: the revision it names, and its facts where it has any. */
export interface RepositoryConfigurationRow {
  readonly revision: string;
  readonly configuration: Label;
  readonly facts: RepositoryConfigurationFacts | undefined;
}

/** The newest revision of each name this repository declares, newest first. */
export function repositoryConfigurations(
  configurations: readonly ConfigurationSummary[],
  repository: string,
): readonly ConfigurationSummary[] {
  const named = new Set<string>();
  const held: ConfigurationSummary[] = [];
  for (const summary of configurations) {
    const provenance = summary.provenance;
    if (provenance.source !== "Repository") continue;
    if (provenance.repository !== repository) continue;
    if (named.has(provenance.name)) continue;
    named.add(provenance.name);
    held.push(summary);
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
            handoff: handoffLabel(summary.finalization.handoff),
          },
  };
}

/** The newest ready revision this repository declares, whose initialization
 * says what a ticket in it is authored with. */
export function repositoryReadyConfiguration(
  configurations: readonly ConfigurationSummary[],
  repository: string,
): ConfigurationSummary | undefined {
  return latestReadyConfiguration(
    repositoryConfigurations(configurations, repository),
  );
}

/** What a walk of the listing read, and whether the budget cut it short. */
export interface ProjectConfigurationsRead {
  readonly configurations: readonly ConfigurationSummary[];
  readonly partial: boolean;
}

/**
 * Every revision the project holds, read to exhaustion under a page budget.
 *
 * A WALK THAT STOPS SAYS SO: a page whose rows all fall past the budget would
 * otherwise read as a repository that declares nothing.
 */
export async function readProjectConfigurations(
  ports: ApiPorts,
  partition: PartitionIdentity,
): Promise<ApiResult<ProjectConfigurationsRead>> {
  const held: ConfigurationSummary[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < configurationPagesMax; page += 1) {
    const answered = await apiConfigurations(ports, partition, { cursor });
    if (answered.outcome !== "Ok") return answered;
    held.push(...answered.value.configurations);
    cursor = answered.value.nextCursor;
    if (cursor === undefined) break;
  }
  return {
    outcome: "Ok",
    value: { configurations: held, partial: cursor !== undefined },
  };
}
