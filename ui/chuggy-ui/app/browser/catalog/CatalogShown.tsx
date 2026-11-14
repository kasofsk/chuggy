/**
 * One catalog as the Catalog page draws it, whichever version it is: its
 * entries grouped and listed, and the chosen one beside them with what it
 * says, what it names and is named by, and what it is written as.
 *
 * Every link keeps the rest of the address it was drawn under, so an entry
 * chosen in the repository's head stays in the head.
 */

import { Link, useParams } from "@tanstack/react-router";
import type { LinkOptions } from "@tanstack/react-router";
import { createContext, useContext } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { CatalogQuery } from "../../core/catalogConfigurations.ts";
import {
  catalogDefaultLabel,
  catalogEntryFields,
  catalogEntrySummary,
  catalogKindLabel,
  catalogReferenceAt,
} from "../../core/catalogEntries.ts";
import type {
  CatalogEntries,
  CatalogEntry,
  CatalogReference,
} from "../../core/catalogEntries.ts";
import type { Copy } from "../../core/copy.ts";
import { copyOrDataText } from "../../core/copy.ts";
import { repositoryLabel } from "../../core/projectRepositories.ts";
import { rosterSearchFilter } from "../../core/rosterSearch.ts";
import { settingsRoutes } from "../../core/settingsNav.ts";
import { CountBadge } from "../ui/CountBadge.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { MarkdownReport } from "../ui/MarkdownReport.tsx";
import { RecordList, RecordRow, RecordRowSkeleton } from "../ui/RecordList.tsx";
import { catalogEntrySource } from "./catalogSource.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";

export function useCatalogPartition(): PartitionIdentity {
  const params = useParams({ from: settingsRoutes.project.catalog });
  return { tenant: params.tenant, project: params.project };
}

/** A link to this page drawing a choice, which keeps the reader's place in the list. */
export function CatalogLink(props: {
  readonly query: CatalogQuery;
  readonly children: ReactNode;
}): ReactNode {
  const partition = useCatalogPartition();
  return (
    <Link
      to={settingsRoutes.project.catalog}
      params={partition}
      search={props.query}
      resetScroll={false}
    >
      {props.children}
    </Link>
  );
}

export function CatalogBadges(props: {
  readonly entry: CatalogEntry;
}): ReactNode {
  const text = useCopyText();
  if (props.entry.defaults.length === 0) return null;
  return (
    <span className="catalog-badges">
      {props.entry.defaults.map((role) => (
        <span key={role} className="catalog-badge">
          {text(catalogDefaultLabel(role))}
        </span>
      ))}
    </span>
  );
}

/** What the reader has typed into the catalog's search, which every list on
 * the page narrows to. */
const catalogSearchContext = createContext("");

export const CatalogSearchProvider = catalogSearchContext.Provider;

export function useCatalogSearch(): string {
  return useContext(catalogSearchContext);
}

/** The address a row of this page links to, which keeps the reader's place in the list. */
export function useCatalogRowLink(): (query: CatalogQuery) => LinkOptions {
  const partition = useCatalogPartition();
  return (query) => ({
    to: settingsRoutes.project.catalog,
    params: partition,
    search: query,
    resetScroll: false,
  });
}

const catalogSkeletonRowsCount = 3;

/** Rows standing where a read's rows will be, until they are read. */
export function CatalogSkeleton(): ReactNode {
  const text = useCopyText();
  return (
    <RecordList label={text({ id: "panel-loading" })}>
      {Array.from({ length: catalogSkeletonRowsCount }, (_, index) => (
        <RecordRowSkeleton key={index} />
      ))}
    </RecordList>
  );
}

/** A group's name over its rows, and how many it lists. */
export function CatalogGroup(props: {
  readonly title: Copy;
  readonly level: 2 | 3;
  readonly count: number;
  readonly children: ReactNode;
}): ReactNode {
  const text = useCopyText();
  const title = text(props.title);
  const Heading = `h${String(props.level)}` as "h2" | "h3";
  return (
    <section className="catalog-group" aria-label={title}>
      <Heading className="catalog-group-title">
        {title}{" "}
        <CountBadge
          count={props.count}
          name={text({
            id: "configuration-catalog-count",
            args: { count: props.count },
          })}
        />
      </Heading>
      <RecordList label={title}>{props.children}</RecordList>
    </section>
  );
}

/** The line that stands for a list the search left empty. */
export function CatalogSearchNone(): ReactNode {
  const text = useCopyText();
  return (
    <EmptyState label={text({ id: "configuration-catalog-search-none" })} />
  );
}

/** What a row says of where an entry is from and what it is. */
export function CatalogRowMeta(props: {
  readonly repository: string | undefined;
  readonly said: string;
}): ReactNode {
  return (
    <>
      {props.repository === undefined ? null : (
        <span title={props.repository}>
          {repositoryLabel(props.repository)}
        </span>
      )}
      {props.said === "" ? null : <span>{props.said}</span>}
    </>
  );
}

function CatalogList(props: {
  readonly base: CatalogQuery;
  readonly repository: string | undefined;
  readonly entries: CatalogEntries;
}): ReactNode {
  const text = useCopyText();
  const search = useCatalogSearch();
  const linked = useCatalogRowLink();
  const groups = props.entries.groups.flatMap((group) => {
    const entries = rosterSearchFilter(group.entries, search, (entry) =>
      [entry.name, catalogEntrySummary(entry, text)].join(" "),
    );
    return entries.length === 0 ? [] : [{ ...group, entries }];
  });
  if (groups.length === 0) return <CatalogSearchNone />;
  return (
    <div className="catalog-groups">
      {groups.map((group) => (
        <CatalogGroup
          key={group.kind}
          title={group.title}
          level={2}
          count={group.entries.length}
        >
          {group.entries.map((entry) => (
            <RecordRow
              key={entry.key}
              title={entry.name}
              link={linked({ ...props.base, entry: entry.key })}
              level={3}
              meta={
                <CatalogRowMeta
                  repository={props.repository}
                  said={catalogEntrySummary(entry, text)}
                />
              }
              trailing={
                entry.defaults.length === 0 ? undefined : (
                  <CatalogBadges entry={entry} />
                )
              }
            />
          ))}
        </CatalogGroup>
      ))}
    </div>
  );
}

function CatalogReferences(props: {
  readonly title: Copy;
  readonly none: Copy;
  readonly base: CatalogQuery;
  readonly references: readonly CatalogReference[];
  readonly entries: CatalogEntries;
}): ReactNode {
  const text = useCopyText();
  const title = text(props.title);
  return (
    <section className="catalog-references" aria-label={title}>
      <h4>{title}</h4>
      {props.references.length === 0 ? (
        <p className="catalog-none">{text(props.none)}</p>
      ) : (
        <ul>
          {props.references.map((reference) => (
            <li key={catalogReferenceAt(reference)}>
              {props.entries.byKey.has(reference.key) ? (
                <CatalogLink query={{ ...props.base, entry: reference.key }}>
                  {reference.name}
                </CatalogLink>
              ) : (
                <span>{reference.name}</span>
              )}
              <span className="catalog-field">
                {copyOrDataText(text, reference.field)}
              </span>
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
  const text = useCopyText();
  const source = catalogEntrySource(props.canonical, entry);
  return (
    <article className="catalog-detail" aria-label={entry.name}>
      <header className="catalog-detail-head">
        <h3 className="catalog-detail-name">{entry.name}</h3>
        <span className="catalog-detail-kind">
          {text(catalogKindLabel(entry.detail.kind))}
        </span>
        <CatalogBadges entry={entry} />
      </header>
      <dl className="catalog-fields">
        {catalogEntryFields(entry, text).map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <CatalogReferences
        title={{ id: "configuration-catalog-uses" }}
        none={{ id: "configuration-catalog-uses-none" }}
        base={props.base}
        references={entries.uses.get(entry.key) ?? []}
        entries={entries}
      />
      <CatalogReferences
        title={{ id: "configuration-catalog-used-by" }}
        none={{ id: "configuration-catalog-used-by-none" }}
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

/** An address naming an entry this catalog does not hold, the name drawn as
 * the code it is wherever the line places it. */
function CatalogEntryAbsent(props: { readonly entry: string }): ReactNode {
  const text = useCopyText();
  const [before, after] = text({
    id: "configuration-catalog-entry-absent",
    args: { entry: catalogEntryAbsentMark },
  }).split(catalogEntryAbsentMark);
  return (
    <p className="catalog-none" role="alert">
      {before}
      <code>{props.entry}</code>
      {after}
    </p>
  );
}

/** What stands in the line for the entry's name until it is drawn as code. */
const catalogEntryAbsentMark = "\u0000";

/** One version as a catalog: its entries listed, and the chosen one beside them. */
export function CatalogShown(props: {
  readonly base: CatalogQuery;
  /** The repository the version was read from, none where it was authored. */
  readonly repository: string | undefined;
  readonly canonical: string;
  readonly entries: CatalogEntries;
  readonly selected: string | undefined;
}): ReactNode {
  const list = (
    <CatalogList
      base={props.base}
      repository={props.repository}
      entries={props.entries}
    />
  );
  if (props.selected === undefined) return list;
  const entry = props.entries.byKey.get(props.selected);
  return (
    <div className="catalog-layout">
      {list}
      <div className="catalog-pane">
        {entry === undefined ? (
          <CatalogEntryAbsent entry={props.selected} />
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
