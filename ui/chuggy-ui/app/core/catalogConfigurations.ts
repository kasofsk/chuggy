/**
 * The configurations the Catalog page chooses among, and what its address
 * holds of that choice.
 *
 * A CONFIGURATION IS ITS NAME, and only one a repository declares: a revision
 * authored through the API was no import, and has no name to list it under.
 *
 * A VERSION IS A DIGEST, NOT AN IMPORT. Every import of a commit mints a
 * revision for each name it declares, changed or not, so a version is drawn
 * once, by its newest revision, and every revision of it stays addressable.
 * The listing arrives newest first, so the names are in the order each was
 * last imported.
 *
 * THE PAGE OPENS ON A CATALOG: the newest version of the configuration
 * imported last among those that are one, and the newest of any where none is.
 */

import type { ConfigurationSummary } from "../../../../src/contract/responses.ts";

/** One configuration as the read reached it, newest first. */
export interface CatalogConfiguration {
  readonly name: string;
  /** Each version once, by the newest revision holding it. */
  readonly versions: readonly ConfigurationSummary[];
  readonly revisions: readonly ConfigurationSummary[];
}

/** A name's revisions with each digest kept once, by its first. */
function catalogConfigurationsVersions(
  revisions: readonly ConfigurationSummary[],
): readonly ConfigurationSummary[] {
  const seen = new Set<string>();
  return revisions.filter((summary) => {
    if (seen.has(summary.digest)) return false;
    seen.add(summary.digest);
    return true;
  });
}

export function catalogConfigurationsOf(
  summaries: readonly ConfigurationSummary[],
): readonly CatalogConfiguration[] {
  const held = new Map<string, ConfigurationSummary[]>();
  for (const summary of summaries) {
    if (summary.provenance.source !== "Repository") continue;
    const name = summary.version?.name ?? summary.provenance.name;
    const revisions = held.get(name) ?? [];
    revisions.push(summary);
    held.set(name, revisions);
  }
  return [...held].map(([name, revisions]) => ({
    name,
    versions: catalogConfigurationsVersions(revisions),
    revisions,
  }));
}

function catalogSummaryIsCatalog(summary: ConfigurationSummary): boolean {
  return summary.readiness === "Ready" && summary.catalog !== undefined;
}

/** The revision the page draws where its address names none. */
export function catalogConfigurationOpening(
  configurations: readonly CatalogConfiguration[],
): string | undefined {
  const newest = configurations.flatMap((configuration) =>
    configuration.versions.slice(0, 1),
  );
  return (newest.find(catalogSummaryIsCatalog) ?? newest[0])?.revision;
}

/** The configuration a revision is of, none where the read did not reach it. */
export function catalogConfigurationHolding(
  configurations: readonly CatalogConfiguration[],
  revision: string,
): CatalogConfiguration | undefined {
  return configurations.find((configuration) =>
    configuration.revisions.some((summary) => summary.revision === revision),
  );
}

/** The version a revision holds, by the revision the configuration's versions draw it with. */
export function catalogConfigurationVersionOf(
  configuration: CatalogConfiguration,
  revision: string,
): ConfigurationSummary | undefined {
  const digest = configuration.revisions.find(
    (summary) => summary.revision === revision,
  )?.digest;
  return configuration.versions.find((summary) => summary.digest === digest);
}

/** What the page's address says: the revision drawn and the entry shown, each none where it names none. */
export interface CatalogQuery {
  readonly configuration?: string;
  readonly entry?: string;
}

function catalogQueryText(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function catalogQueryOf(
  search: Readonly<Record<string, unknown>>,
): CatalogQuery {
  const configuration = catalogQueryText(search["configuration"]);
  const entry = catalogQueryText(search["entry"]);
  return {
    ...(configuration === undefined ? {} : { configuration }),
    ...(entry === undefined ? {} : { entry }),
  };
}
