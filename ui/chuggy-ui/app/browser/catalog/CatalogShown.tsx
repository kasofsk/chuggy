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
import { navRoutes } from "../../core/shellNav.ts";
import { MarkdownReport } from "../ui/MarkdownReport.tsx";
import { catalogEntrySource } from "./catalogSource.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";

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

function CatalogList(props: {
  readonly base: CatalogQuery;
  readonly entries: CatalogEntries;
  readonly selected: string | undefined;
}): ReactNode {
  const text = useCopyText();
  return (
    <div className="catalog-groups">
      {props.entries.groups.map((group) => (
        <section
          key={group.kind}
          className="catalog-group"
          aria-label={text(group.title)}
        >
          <h2 className="catalog-group-title">
            {text(group.title)}{" "}
            <span className="catalog-count">{group.entries.length}</span>
          </h2>
          <ul className="catalog-list">
            {group.entries.map((entry) => {
              const summary = catalogEntrySummary(entry, text);
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
