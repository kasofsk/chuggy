/**
 * The project's catalog: each repository with the configurations it declares
 * and the fragments they are made of, and, once the address names a
 * configuration, every workload, evaluation plan, finalizer and prompt file
 * one version of it holds, chosen among its own repository's.
 *
 * THE ADDRESS HOLDS THE CHOICE, the version drawn, the entry shown and
 * whether the repository's head is drawn in the version's place, so a reader
 * can hand any of them to someone else. The search is the reader's own, and
 * narrows whichever list is drawn.
 *
 * A version 1 configuration is no catalog, and is drawn as a ticket's page
 * draws the configuration it runs under.
 */

import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { ConfigurationSummary } from "../../../../../src/contract/responses.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import {
  catalogConfigurationHolding,
  catalogConfigurationNewestFrom,
  catalogConfigurationsOf,
  catalogConfigurationVersionOf,
} from "../../core/catalogConfigurations.ts";
import type {
  CatalogConfiguration,
  CatalogQuery,
} from "../../core/catalogConfigurations.ts";
import { catalogEntriesOf } from "../../core/catalogEntries.ts";
import {
  catalogRepositoriesOf,
  catalogRepositoryHolding,
} from "../../core/catalogRepositories.ts";
import type { CatalogRepository } from "../../core/catalogRepositories.ts";
import { configurationCatalogOf } from "../../core/configurationCatalog.ts";
import {
  catalogConfigurationsQuery,
  configurationQuery,
} from "../../core/configurationQueries.ts";
import { instantFigure } from "../../core/figures.ts";
import { configurationCommitShort } from "../../core/labels.ts";
import { repositoryLabel } from "../../core/projectRepositories.ts";
import type { PanelState } from "../../core/freshness.ts";
import { configurationsPartialLabel } from "../../core/repositoryConfigurations.ts";
import { usePanelState } from "../api.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { useNowMs } from "../Freshness.tsx";
import { ConfigurationBody } from "../TicketProvenance.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Figure } from "../ui/Figure.tsx";
import {
  ListControls,
  ListGlyph,
  ListSearch,
  listFilterGlyph,
} from "../ui/ListControls.tsx";
import { PageHeader } from "../ui/PageHeader.tsx";
import type { PageHeaderBack } from "../ui/PageHeader.tsx";
import { Panel } from "../ui/Panel.tsx";
import { Picker } from "../ui/Picker.tsx";
import { settingsRoutes } from "../../core/settingsNav.ts";
import { CatalogHeadLine, CatalogHeadRevision } from "./CatalogHead.tsx";
import {
  CatalogRepositoryPicker,
  CatalogRepositorySection,
  catalogRepositoryChosen,
} from "./CatalogRepositories.tsx";
import {
  CatalogSearchProvider,
  CatalogShown,
  CatalogSkeleton,
  useCatalogPartition,
} from "./CatalogShown.tsx";

import "./catalog.css";

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
  const text = useCopyText();
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
        <span>{text({ id: "configuration-catalog-authored" })}</span>
      )}
      <span>
        {text({ id: "configuration-catalog-imported" })}{" "}
        <Figure figure={instantFigure(props.summary.createdAt, nowMs)} />
      </span>
    </p>
  );
}

/** What the repository's head says of the configuration, where the address draws the head in the import's place. */
function CatalogChosenHead(props: {
  readonly configurations: readonly CatalogConfiguration[];
  readonly revision: string;
  readonly query: CatalogQuery;
}): ReactNode {
  const partition = useCatalogPartition();
  const holding = catalogConfigurationHolding(
    props.configurations,
    props.revision,
  );
  const summary = holding?.revisions.find(
    (version) => version.revision === props.revision,
  );
  if (
    props.query.source !== "head" ||
    holding === undefined ||
    summary?.provenance.source !== "Repository"
  )
    return null;
  return (
    <CatalogHeadLine
      key={summary.provenance.repository}
      partition={partition}
      repository={summary.provenance.repository}
      name={holding.name}
      newestDigest={
        catalogConfigurationNewestFrom(holding, summary.provenance.repository)
          ?.digest ?? summary.digest
      }
      query={{ ...props.query, configuration: props.revision }}
    />
  );
}

const catalogRevisionGlyph = (
  <ListGlyph>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 5v3l2 1.5" />
  </ListGlyph>
);

/** Which configuration, and which version of it, the page draws; another
 * version keeps the entry shown. */
function CatalogConfigurationPickers(props: {
  readonly configurations: readonly CatalogConfiguration[];
  readonly revision: string;
  readonly query: CatalogQuery;
}): ReactNode {
  const text = useCopyText();
  const navigate = useNavigate();
  const partition = useCatalogPartition();
  const holding = catalogConfigurationHolding(
    props.configurations,
    props.revision,
  );
  const choose = (configuration: string, entry?: string): void => {
    void navigate({
      to: settingsRoutes.project.catalog,
      params: partition,
      search:
        entry === undefined ? { configuration } : { configuration, entry },
    });
  };
  const version =
    holding === undefined
      ? undefined
      : catalogConfigurationVersionOf(holding, props.revision);
  return (
    <>
      <Picker
        label={text({ id: "configuration-catalog-picker-configuration" })}
        iconOnly
        glyph={listFilterGlyph}
        value={holding?.versions[0]?.revision ?? props.revision}
        placeholder={props.revision}
        options={props.configurations.flatMap((configuration) =>
          configuration.versions.slice(0, 1).map((newest) => ({
            value: newest.revision,
            text: configuration.name,
          })),
        )}
        onChoose={choose}
        align="end"
      />
      {holding === undefined || holding.versions.length < 2 ? null : (
        <Picker
          label={text({ id: "configuration-catalog-picker-revision" })}
          iconOnly
          glyph={catalogRevisionGlyph}
          value={version?.revision ?? props.revision}
          options={holding.versions.map((held) => ({
            value: held.revision,
            text: catalogVersionText(held),
          }))}
          onChoose={(chosen) => {
            choose(chosen, props.query.entry);
          }}
          align="end"
        />
      )}
    </>
  );
}

/** One version, read by its revision so a version past the listing's budget is still drawn. */
function CatalogRevision(props: {
  readonly partition: PartitionIdentity;
  readonly repository: string | undefined;
  readonly revision: string;
  readonly selected: string | undefined;
}): ReactNode {
  const text = useCopyText();
  const state = usePanelState(
    configurationQuery(props.partition, props.revision, "Streamed"),
  );
  if (state.state === "Pending") return <CatalogSkeleton />;
  if (state.state !== "Ready") return <PanelUnready state={state} />;
  const configuration = state.value;
  const catalog = configurationCatalogOf(configuration.canonical);
  if (catalog === undefined)
    return (
      <Panel
        variant="section"
        title={text({ id: "configuration-catalog-version-one" })}
      >
        <ConfigurationBody
          configuration={configuration}
          overrides={undefined}
          selection={undefined}
        />
      </Panel>
    );
  return (
    <CatalogShown
      base={{ configuration: props.revision }}
      repository={props.repository}
      canonical={configuration.canonical}
      entries={catalogEntriesOf(catalog, configuration.workloadPaths)}
      selected={props.selected}
    />
  );
}

/** The version the address names, or the repository head's version of it where the address asks for the head. */
function CatalogDrawn(props: {
  readonly partition: PartitionIdentity;
  readonly configurations: readonly CatalogConfiguration[];
  readonly revision: string;
  readonly query: CatalogQuery;
}): ReactNode {
  const holding = catalogConfigurationHolding(
    props.configurations,
    props.revision,
  );
  const provenance = holding?.revisions.find(
    (summary) => summary.revision === props.revision,
  )?.provenance;
  const repository =
    provenance?.source === "Repository" ? provenance.repository : undefined;
  if (
    props.query.source === "head" &&
    holding !== undefined &&
    provenance?.source === "Repository"
  )
    return (
      <CatalogHeadRevision
        partition={props.partition}
        repository={provenance.repository}
        name={holding.name}
        query={{ ...props.query, configuration: props.revision }}
        imported={
          <CatalogRevision
            partition={props.partition}
            repository={repository}
            revision={props.revision}
            selected={props.query.entry}
          />
        }
      />
    );
  return (
    <CatalogRevision
      partition={props.partition}
      repository={repository}
      revision={props.revision}
      selected={props.query.entry}
    />
  );
}

/** The page's head: its title, the line saying the listing is partial where
 * it is, what the view draws under them, and the bar after it. */
function CatalogPageHead(props: {
  readonly title?: string | undefined;
  readonly number?: number | undefined;
  readonly back?: PageHeaderBack | undefined;
  readonly partial: boolean;
  readonly controls?: ReactNode;
  readonly children?: ReactNode;
}): ReactNode {
  const text = useCopyText();
  return (
    <PageHeader
      title={props.title ?? text({ id: "configuration-catalog-title" })}
      {...(props.number === undefined ? {} : { number: props.number })}
      {...(props.back === undefined ? {} : { back: props.back })}
      controls={props.controls}
    >
      {props.partial ? (
        <p className="catalog-none">{text(configurationsPartialLabel)}</p>
      ) : null}
      {props.children}
    </PageHeader>
  );
}

/** One configuration: its name and version over where it was read and the
 * bar choosing among the repository's, then its entries. */
function CatalogConfigurationView(props: {
  readonly partition: PartitionIdentity;
  readonly configurations: readonly CatalogConfiguration[];
  readonly revision: string;
  readonly query: CatalogQuery;
  readonly partial: boolean;
  readonly search: ReactNode;
}): ReactNode {
  const text = useCopyText();
  const holding = catalogConfigurationHolding(
    props.configurations,
    props.revision,
  );
  const summary = holding?.revisions.find(
    (version) => version.revision === props.revision,
  );
  const provenance = summary?.provenance;
  return (
    <>
      <CatalogPageHead
        title={holding?.name}
        number={summary?.version?.number}
        back={
          provenance?.source === "Repository"
            ? {
                label: text({
                  id: "configuration-catalog-repository-back",
                  args: { repository: repositoryLabel(provenance.repository) },
                }),
                link: {
                  to: settingsRoutes.project.catalog,
                  params: props.partition,
                  search: { repository: provenance.repository },
                },
              }
            : undefined
        }
        partial={props.partial}
        controls={
          <ListControls>
            {props.search}
            <CatalogConfigurationPickers
              configurations={props.configurations}
              revision={props.revision}
              query={props.query}
            />
          </ListControls>
        }
      >
        {summary === undefined ? null : <CatalogProvenance summary={summary} />}
        <CatalogChosenHead
          configurations={props.configurations}
          revision={props.revision}
          query={props.query}
        />
      </CatalogPageHead>
      <CatalogDrawn
        key={props.revision}
        partition={props.partition}
        configurations={props.configurations}
        revision={props.revision}
        query={props.query}
      />
    </>
  );
}

/** Every repository's catalog, one drawn at a time under the bar choosing it. */
function CatalogRepositoriesView(props: {
  readonly partition: PartitionIdentity;
  readonly repositories: readonly CatalogRepository[];
  readonly chosen: string | undefined;
  readonly partial: boolean;
  readonly search: ReactNode;
}): ReactNode {
  const text = useCopyText();
  const repository = catalogRepositoryChosen(props.repositories, props.chosen);
  if (repository === undefined)
    return (
      <>
        <CatalogPageHead partial={props.partial} />
        <EmptyState label={text({ id: "configuration-catalog-none" })} />
      </>
    );
  return (
    <>
      <CatalogPageHead
        partial={props.partial}
        controls={
          <ListControls>
            {props.search}
            {props.repositories.length < 2 ? null : (
              <CatalogRepositoryPicker
                partition={props.partition}
                repositories={props.repositories}
                chosen={repository}
              />
            )}
          </ListControls>
        }
      />
      <CatalogRepositorySection
        key={repository.repository}
        partition={props.partition}
        repository={repository}
      />
    </>
  );
}

/** The listing's read, rows standing for it until it is read. */
function CatalogUnread(props: {
  readonly state: PanelState<unknown>;
}): ReactNode {
  return (
    <>
      <CatalogPageHead partial={false} />
      {props.state.state === "Pending" ? (
        <CatalogSkeleton />
      ) : (
        <PanelUnready state={props.state} />
      )}
    </>
  );
}

export function CatalogPage(props: {
  readonly query: CatalogQuery;
}): ReactNode {
  const text = useCopyText();
  const partition = useCatalogPartition();
  const state = usePanelState(catalogConfigurationsQuery(partition));
  const [typed, setTyped] = useState("");
  const read = state.state === "Ready" ? state.value : undefined;
  const summaries = read?.configurations ?? [];
  const revision = props.query.configuration;
  const repository =
    revision === undefined
      ? undefined
      : catalogRepositoryHolding(summaries, revision);
  const search = (
    <ListSearch
      label={text({ id: "configuration-catalog-search" })}
      placeholder={text({ id: "configuration-catalog-search-placeholder" })}
      search={typed}
      onSearch={setTyped}
    />
  );
  return (
    <div className="catalog-page" data-fills-width>
      <CatalogSearchProvider value={typed}>
        {read === undefined ? (
          <CatalogUnread state={state} />
        ) : revision === undefined ? (
          <CatalogRepositoriesView
            partition={partition}
            repositories={catalogRepositoriesOf(summaries)}
            chosen={props.query.repository}
            partial={read.partial}
            search={search}
          />
        ) : (
          <CatalogConfigurationView
            partition={partition}
            configurations={catalogConfigurationsOf(
              repository === undefined
                ? summaries
                : summaries.filter(
                    (summary) =>
                      summary.provenance.source === "Repository" &&
                      summary.provenance.repository === repository,
                  ),
            )}
            revision={revision}
            query={props.query}
            partial={read.partial}
            search={search}
          />
        )}
      </CatalogSearchProvider>
    </div>
  );
}
