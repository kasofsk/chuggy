/**
 * One catalog as the Catalog page draws it, whichever version it is: its
 * entries grouped and listed, and the chosen one beside them with what it
 * says, what it names and is named by, and what it is written as.
 *
 * Every link keeps the rest of the address it was drawn under, so an entry
 * chosen in the repository's head stays in the head.
 */

import { Link, useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { CatalogQuery } from "../../core/catalogConfigurations.ts";
import {
  catalogDefaultLabel,
  catalogEntryFields,
  catalogEntrySummary,
} from "../../core/catalogEntries.ts";
import type {
  CatalogEntries,
  CatalogEntry,
  CatalogReference,
} from "../../core/catalogEntries.ts";
import { navRoutes } from "../../core/shellNav.ts";
import { MarkdownReport } from "../ui/MarkdownReport.tsx";
import { catalogEntrySource } from "./catalogSource.ts";

export function useCatalogPartition(): PartitionIdentity {
  const params = useParams({ from: navRoutes.catalog });
  return { tenant: params.tenant, project: params.project };
}

/** A link to this page drawing a choice, which keeps the reader's place in the list. */
export function CatalogLink(props: {
  readonly query: CatalogQuery;
  readonly className?: string;
  readonly current?: boolean;
  readonly children: ReactNode;
}): ReactNode {
  const partition = useCatalogPartition();
  return (
    <Link
      to={navRoutes.catalog}
      params={partition}
      search={props.query}
      resetScroll={false}
      className={props.className}
      aria-current={props.current === true ? "true" : undefined}
    >
      {props.children}
    </Link>
  );
}

function CatalogBadges(props: { readonly entry: CatalogEntry }): ReactNode {
  if (props.entry.defaults.length === 0) return null;
  return (
    <span className="catalog-badges">
      {props.entry.defaults.map((role) => (
        <span key={role} className="catalog-badge">
          {catalogDefaultLabel(role)}
        </span>
      ))}
    </span>
  );
}

function CatalogList(props: {
  readonly base: CatalogQuery;
  readonly entries: CatalogEntries;
  readonly selected: string | undefined;
}): ReactNode {
  return (
    <div className="catalog-groups">
      {props.entries.groups.map((group) => (
        <section
          key={group.kind}
          className="catalog-group"
          aria-label={group.title}
        >
          <h2 className="catalog-group-title">
            {group.title}{" "}
            <span className="catalog-count">{group.entries.length}</span>
          </h2>
          <ul className="catalog-list">
            {group.entries.map((entry) => {
              const summary = catalogEntrySummary(entry);
              return (
                <li key={entry.key}>
                  <CatalogLink
                    query={{ ...props.base, entry: entry.key }}
                    className="catalog-entry"
                    current={entry.key === props.selected}
                  >
                    <span className="catalog-entry-name">{entry.name}</span>
                    {summary === "" ? null : (
                      <span className="catalog-entry-summary">{summary}</span>
                    )}
                    <CatalogBadges entry={entry} />
                  </CatalogLink>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function CatalogReferences(props: {
  readonly title: string;
  readonly none: string;
  readonly base: CatalogQuery;
  readonly references: readonly CatalogReference[];
  readonly entries: CatalogEntries;
}): ReactNode {
  return (
    <section className="catalog-references" aria-label={props.title}>
      <h4>{props.title}</h4>
      {props.references.length === 0 ? (
        <p className="catalog-none">{props.none}</p>
      ) : (
        <ul>
          {props.references.map((reference) => (
            <li key={`${reference.key}\u0000${reference.field}`}>
              {props.entries.byKey.has(reference.key) ? (
                <CatalogLink query={{ ...props.base, entry: reference.key }}>
                  {reference.name}
                </CatalogLink>
              ) : (
                <span>{reference.name}</span>
              )}
              <span className="catalog-field">{reference.field}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CatalogDetail(props: {
  readonly base: CatalogQuery;
  readonly canonical: string;
  readonly entries: CatalogEntries;
  readonly entry: CatalogEntry;
}): ReactNode {
  const { entry, entries } = props;
  const source = catalogEntrySource(props.canonical, entry);
  return (
    <article className="catalog-detail" aria-label={entry.name}>
      <header className="catalog-detail-head">
        <h3 className="catalog-detail-name">{entry.name}</h3>
        <span className="catalog-detail-kind">{entry.detail.kind}</span>
        <CatalogBadges entry={entry} />
      </header>
      <dl className="catalog-fields">
        {catalogEntryFields(entry).map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <CatalogReferences
        title="Uses"
        none="Nothing."
        base={props.base}
        references={entries.uses.get(entry.key) ?? []}
        entries={entries}
      />
      <CatalogReferences
        title="Used by"
        none="Nothing in the catalog."
        base={props.base}
        references={entries.usedBy.get(entry.key) ?? []}
        entries={entries}
      />
      {source === undefined ? null : entry.detail.kind === "Prompt" ? (
        <MarkdownReport text={source} />
      ) : (
        <MarkdownReport text={`\`\`\`yaml\n${source}\`\`\``} bare />
      )}
    </article>
  );
}

/** One version as a catalog: its entries listed, and the chosen one beside them. */
export function CatalogShown(props: {
  readonly base: CatalogQuery;
  readonly canonical: string;
  readonly entries: CatalogEntries;
  readonly selected: string | undefined;
}): ReactNode {
  const list = (
    <CatalogList
      base={props.base}
      entries={props.entries}
      selected={props.selected}
    />
  );
  if (props.selected === undefined) return list;
  const entry = props.entries.byKey.get(props.selected);
  return (
    <div className="catalog-layout">
      {list}
      <div className="catalog-pane">
        {entry === undefined ? (
          <p className="catalog-none" role="alert">
            Nothing in this catalog is <code>{props.selected}</code>.
          </p>
        ) : (
          <CatalogDetail
            base={props.base}
            canonical={props.canonical}
            entries={props.entries}
            entry={entry}
          />
        )}
      </div>
    </div>
  );
}
