/**
 * The project's catalog: the configurations its repositories declare, as
 * their imports stored them, and for one version of one of them every
 * workload, evaluation plan, finalizer and prompt file it holds.
 *
 * THE ADDRESS HOLDS THE CHOICE, the version drawn and the entry shown, so a
 * reader can hand either to someone else. An entry shows what it says, which
 * entries it names and which name it, and what it is written as; a list with
 * no entry chosen takes the page's whole width.
 *
 * A version 1 configuration is no catalog, and is drawn as a ticket's page
 * draws the configuration it runs under.
 */

import { Link, useNavigate, useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { ConfigurationSummary } from "../../../../../src/contract/responses.ts";
import { apiConfiguration } from "../../core/apiRoutes.ts";
import {
  catalogConfigurationHolding,
  catalogConfigurationOpening,
  catalogConfigurationsOf,
} from "../../core/catalogConfigurations.ts";
import type {
  CatalogConfiguration,
  CatalogQuery,
} from "../../core/catalogConfigurations.ts";
import {
  catalogDefaultLabel,
  catalogEntriesOf,
  catalogEntryFields,
  catalogEntrySummary,
} from "../../core/catalogEntries.ts";
import type {
  CatalogEntries,
  CatalogEntry,
  CatalogReference,
} from "../../core/catalogEntries.ts";
import { configurationCatalogOf } from "../../core/configurationCatalog.ts";
import { instantFigure } from "../../core/figures.ts";
import { configurationCommitShort } from "../../core/labels.ts";
import { repositoryLabel } from "../../core/projectRepositories.ts";
import {
  configurationsPartialLabel,
  readProjectConfigurations,
} from "../../core/repositoryConfigurations.ts";
import { usePanelResource } from "../api.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { useNowMs } from "../Freshness.tsx";
import { repositoryConfigurationsResource } from "../repositories/RepositoryPage.tsx";
import { ScreenTitle } from "../shell/slots.tsx";
import { ConfigurationBody } from "../TicketProvenance.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Figure } from "../ui/Figure.tsx";
import { MarkdownReport } from "../ui/MarkdownReport.tsx";
import { Panel } from "../ui/Panel.tsx";
import { Picker } from "../ui/Picker.tsx";
import { catalogEntrySource } from "./catalogSource.ts";

import "./catalog.css";

/** This page's own address, which its reads take their partition from. */
export const catalogRoutePath = "/$tenant/$project/catalog";

function useCatalogPartition(): PartitionIdentity {
  const params = useParams({ from: catalogRoutePath });
  return { tenant: params.tenant, project: params.project };
}

/** A link to this page drawing a choice, which keeps the reader's place in the list. */
function CatalogLink(props: {
  readonly query: CatalogQuery;
  readonly className?: string;
  readonly current?: boolean;
  readonly children: ReactNode;
}): ReactNode {
  const partition = useCatalogPartition();
  return (
    <Link
      to={catalogRoutePath}
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

function catalogVersionText(summary: ConfigurationSummary): string {
  const commit = configurationCommitShort(summary.provenance);
  return [
    summary.version === undefined
      ? summary.revision
      : `#${String(summary.version.number)}`,
    commit,
  ]
    .filter((part) => part !== undefined)
    .join(" · ");
}

/** Where the drawn version came from: the repository, the file and the commit an import read it at, and when. */
function CatalogProvenance(props: {
  readonly summary: ConfigurationSummary;
}): ReactNode {
  const nowMs = useNowMs();
  const { provenance } = props.summary;
  return (
    <p className="catalog-provenance">
      {provenance.source === "Repository" ? (
        <>
          <span>{repositoryLabel(provenance.repository)}</span>
          <code title={provenance.commit}>
            {configurationCommitShort(provenance)}
          </code>
          <code>{provenance.path}</code>
        </>
      ) : (
        <span>Authored</span>
      )}
      <span>
        Imported{" "}
        <Figure figure={instantFigure(props.summary.createdAt, nowMs)} />
      </span>
    </p>
  );
}

/** Which configuration, and which version of it, the page draws. */
function CatalogChooser(props: {
  readonly configurations: readonly CatalogConfiguration[];
  readonly revision: string;
}): ReactNode {
  const navigate = useNavigate();
  const partition = useCatalogPartition();
  const holding = catalogConfigurationHolding(
    props.configurations,
    props.revision,
  );
  const choose = (configuration: string): void => {
    void navigate({
      to: catalogRoutePath,
      params: partition,
      search: { configuration },
    });
  };
  const summary = holding?.versions.find(
    (version) => version.revision === props.revision,
  );
  return (
    <div className="catalog-chooser">
      <div className="catalog-chooser-pickers">
        <Picker
          label="Configuration"
          value={holding?.versions[0]?.revision ?? props.revision}
          placeholder={props.revision}
          options={props.configurations.flatMap((configuration) =>
            configuration.versions.slice(0, 1).map((newest) => ({
              value: newest.revision,
              text: configuration.name,
            })),
          )}
          onChoose={choose}
          align="start"
        />
        {holding === undefined || holding.versions.length < 2 ? null : (
          <Picker
            label="Version"
            value={props.revision}
            options={holding.versions.map((version) => ({
              value: version.revision,
              text: catalogVersionText(version),
            }))}
            onChoose={choose}
            align="start"
          />
        )}
      </div>
      {summary === undefined ? null : <CatalogProvenance summary={summary} />}
    </div>
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
  readonly revision: string;
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
                    query={{ configuration: props.revision, entry: entry.key }}
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
  readonly revision: string;
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
                <CatalogLink
                  query={{
                    configuration: props.revision,
                    entry: reference.key,
                  }}
                >
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
  readonly revision: string;
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
        revision={props.revision}
        references={entries.uses.get(entry.key) ?? []}
        entries={entries}
      />
      <CatalogReferences
        title="Used by"
        none="Nothing in the catalog."
        revision={props.revision}
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
function CatalogShown(props: {
  readonly revision: string;
  readonly canonical: string;
  readonly entries: CatalogEntries;
  readonly selected: string | undefined;
}): ReactNode {
  const list = (
    <CatalogList
      revision={props.revision}
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
            revision={props.revision}
            canonical={props.canonical}
            entries={props.entries}
            entry={entry}
          />
        )}
      </div>
    </div>
  );
}

/** One version, read by its revision so a version past the listing's budget is still drawn. */
function CatalogRevision(props: {
  readonly partition: PartitionIdentity;
  readonly revision: string;
  readonly selected: string | undefined;
}): ReactNode {
  const state = usePanelResource(
    props.partition,
    "Configuration",
    props.revision,
    (ports) => apiConfiguration(ports, props.partition, props.revision),
  );
  if (state.state !== "Ready") return <PanelUnready state={state} />;
  const configuration = state.value;
  const catalog = configurationCatalogOf(configuration.canonical);
  if (catalog === undefined)
    return (
      <Panel variant="section" title="Version 1 configuration">
        <ConfigurationBody
          configuration={configuration}
          overrides={undefined}
          selection={undefined}
        />
      </Panel>
    );
  return (
    <CatalogShown
      revision={props.revision}
      canonical={configuration.canonical}
      entries={catalogEntriesOf(catalog)}
      selected={props.selected}
    />
  );
}

export function CatalogPage(props: {
  readonly query: CatalogQuery;
}): ReactNode {
  const partition = useCatalogPartition();
  const state = usePanelResource(
    partition,
    "Configuration",
    repositoryConfigurationsResource,
    (ports) => readProjectConfigurations(ports, partition),
  );
  const read = state.state === "Ready" ? state.value : undefined;
  const configurations =
    read === undefined ? [] : catalogConfigurationsOf(read.configurations);
  const revision =
    props.query.configuration ?? catalogConfigurationOpening(configurations);
  return (
    <div className="catalog-page" data-fills-width>
      <ScreenTitle>Catalog</ScreenTitle>
      <PanelUnready state={state} />
      {read === undefined ? null : revision === undefined ? (
        <EmptyState
          variant="page"
          label="No configuration imported"
          detail="A repository's catalogs live under .chug/configurations; once one is imported, its workloads, plans, finalizers and prompts are listed here."
        />
      ) : (
        <>
          <CatalogChooser configurations={configurations} revision={revision} />
          {read.partial ? (
            <p className="catalog-none">{configurationsPartialLabel}</p>
          ) : null}
          <CatalogRevision
            key={revision}
            partition={partition}
            revision={revision}
            selected={props.query.entry}
          />
        </>
      )}
    </div>
  );
}
