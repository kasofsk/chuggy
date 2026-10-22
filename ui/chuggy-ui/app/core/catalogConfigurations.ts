/**
 * The configurations the Catalog page chooses among, and what its address
 * holds of that choice.
 *
 * A CONFIGURATION IS ITS NAME, and its versions are what each import of that
 * name made of it, newest first. The listing arrives newest first, so the
 * first summary of a name is its newest version and the names are in the
 * order each last changed.
 *
 * THE PAGE OPENS ON A CATALOG: the newest version of the configuration that
 * changed last among those that are one, and the newest of any where none is.
 */

import type { ConfigurationSummary } from "../../../../src/contract/responses.ts";

/** One configuration and every version of it the read reached, newest first. */
export interface CatalogConfiguration {
  readonly name: string;
  readonly versions: readonly ConfigurationSummary[];
}

function catalogConfigurationNameOf(summary: ConfigurationSummary): string {
  if (summary.version !== undefined) return summary.version.name;
  return summary.provenance.source === "Repository"
    ? summary.provenance.name
    : summary.revision;
}

export function catalogConfigurationsOf(
  summaries: readonly ConfigurationSummary[],
): readonly CatalogConfiguration[] {
  const held = new Map<string, ConfigurationSummary[]>();
  for (const summary of summaries) {
    const name = catalogConfigurationNameOf(summary);
    const versions = held.get(name) ?? [];
    versions.push(summary);
    held.set(name, versions);
  }
  return [...held].map(([name, versions]) => ({ name, versions }));
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

/** The configuration a revision is a version of, none where the read did not reach it. */
export function catalogConfigurationHolding(
  configurations: readonly CatalogConfiguration[],
  revision: string,
): CatalogConfiguration | undefined {
  return configurations.find((configuration) =>
    configuration.versions.some((summary) => summary.revision === revision),
  );
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
