/**
 * The catalog as a repository declares it: the configurations its newest
 * imported commit holds, and the fragments they are made of, each said once
 * with where it is written and which configurations hold it.
 *
 * A FRAGMENT IS A REPOSITORY'S, since a configuration holds only what its own
 * repository's import read. Two configurations hold one fragment where they
 * hold the same kind under the same name, from the same file, saying the
 * same; one that says otherwise is a fragment of its own.
 */

import type { ConfigurationSummary } from "../../../../src/contract/responses.ts";
import type {
  CatalogEntries,
  CatalogEntry,
  CatalogEntryKind,
  CatalogGroup,
} from "./catalogEntries.ts";
import type { Copy } from "./copy.ts";
import { repositoryConfigurations } from "./repositoryConfigurations.ts";

/** One repository, and what its newest imported commit declares. */
export interface CatalogRepository {
  readonly repository: string;
  readonly commit: string;
  readonly importedAt: ConfigurationSummary["createdAt"];
  readonly declared: readonly ConfigurationSummary[];
}

/** The repositories the listing holds an import of, in the order each was last imported. */
export function catalogRepositoriesOf(
  summaries: readonly ConfigurationSummary[],
): readonly CatalogRepository[] {
  const held = new Map<string, CatalogRepository>();
  for (const summary of summaries) {
    const { provenance } = summary;
    if (provenance.source !== "Repository") continue;
    if (held.has(provenance.repository)) continue;
    held.set(provenance.repository, {
      repository: provenance.repository,
      commit: provenance.commit,
      importedAt: summary.createdAt,
      declared: repositoryConfigurations(summaries, provenance.repository),
    });
  }
  return [...held.values()];
}

/** The repository an import read a revision from, none for one the listing does not hold or that no import made. */
export function catalogRepositoryHolding(
  summaries: readonly ConfigurationSummary[],
  revision: string,
): string | undefined {
  const provenance = summaries.find(
    (summary) => summary.revision === revision,
  )?.provenance;
  return provenance?.source === "Repository"
    ? provenance.repository
    : undefined;
}

/** One declared configuration read in full, its entries where it is a catalog. */
export interface CatalogDeclared {
  readonly name: string;
  readonly revision: string;
  /** The repository file that declares it. */
  readonly path: string;
  readonly entries: CatalogEntries | undefined;
}

/** A configuration holding a fragment, and the entry it holds it as. */
export interface CatalogFragmentHolder {
  readonly name: string;
  readonly revision: string;
  readonly path: string;
  readonly key: string;
}

export interface CatalogFragment {
  readonly id: string;
  readonly entry: CatalogEntry;
  /** The repository file it is written in, none where its configuration writes it inline. */
  readonly file: string | undefined;
  readonly holders: readonly CatalogFragmentHolder[];
}

export interface CatalogFragmentGroup {
  readonly kind: CatalogEntryKind;
  readonly title: Copy;
  readonly fragments: readonly CatalogFragment[];
}

function catalogFragmentFile(entry: CatalogEntry): string | undefined {
  const { detail } = entry;
  return detail.kind === "Workload" || detail.kind === "Prompt"
    ? detail.path
    : undefined;
}

function catalogFragmentSaid(entry: CatalogEntry): unknown {
  const { detail } = entry;
  switch (detail.kind) {
    case "Workload":
      return detail.workload.definition;
    case "Plan":
      return detail.stages;
    case "Finalizer":
      return detail.finalizer;
    case "Prompt":
      return detail.text;
  }
}

function catalogFragmentId(entry: CatalogEntry): string {
  return JSON.stringify([
    entry.key,
    catalogFragmentFile(entry) ?? null,
    catalogFragmentSaid(entry),
  ]);
}

/** Every fragment the declared configurations hold, grouped as a catalog groups its entries. */
export function catalogFragmentsOf(
  declared: readonly CatalogDeclared[],
): readonly CatalogFragmentGroup[] {
  const groups = new Map<
    CatalogEntryKind,
    { readonly title: Copy; readonly fragments: Map<string, CatalogFragment> }
  >();
  const groupOf = (group: CatalogGroup) => {
    const held = groups.get(group.kind) ?? {
      title: group.title,
      fragments: new Map<string, CatalogFragment>(),
    };
    groups.set(group.kind, held);
    return held;
  };
  for (const configuration of declared)
    for (const group of configuration.entries?.groups ?? []) {
      const { fragments } = groupOf(group);
      for (const entry of group.entries) {
        const id = catalogFragmentId(entry);
        const holder: CatalogFragmentHolder = {
          name: configuration.name,
          revision: configuration.revision,
          path: configuration.path,
          key: entry.key,
        };
        const held = fragments.get(id);
        fragments.set(id, {
          id,
          entry,
          file: catalogFragmentFile(entry),
          holders: [...(held?.holders ?? []), holder],
        });
      }
    }
  const order: readonly CatalogEntryKind[] = [
    "Workload",
    "Plan",
    "Finalizer",
    "Prompt",
  ];
  return order.flatMap((kind) => {
    const held = groups.get(kind);
    return held === undefined
      ? []
      : [{ kind, title: held.title, fragments: [...held.fragments.values()] }];
  });
}
