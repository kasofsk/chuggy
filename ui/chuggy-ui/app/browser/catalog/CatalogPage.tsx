/**
 * The project's catalog: the configurations its repositories declare, as
 * their imports stored them, and for one version of one of them every
 * workload, evaluation plan, finalizer and prompt file it holds.
 *
 * THE ADDRESS HOLDS THE CHOICE, the version drawn, the entry shown and
 * whether the repository's head is drawn in the version's place, so a reader
 * can hand any of them to someone else.
 *
 * A version 1 configuration is no catalog, and is drawn as a ticket's page
 * draws the configuration it runs under.
 */

import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { ConfigurationSummary } from "../../../../../src/contract/responses.ts";
import { apiConfiguration } from "../../core/apiRoutes.ts";
import {
  catalogConfigurationHolding,
  catalogConfigurationNewestFrom,
  catalogConfigurationOpening,
  catalogConfigurationsOf,
  catalogConfigurationVersionOf,
} from "../../core/catalogConfigurations.ts";
import type {
  CatalogConfiguration,
  CatalogQuery,
} from "../../core/catalogConfigurations.ts";
import { catalogEntriesOf } from "../../core/catalogEntries.ts";
import { configurationCatalogOf } from "../../core/configurationCatalog.ts";
import { instantFigure } from "../../core/figures.ts";
import { configurationCommitShort } from "../../core/labels.ts";
import { repositoryLabel } from "../../core/projectRepositories.ts";
import {
  configurationsPartialLabel,
  readProjectConfigurationsVersions,
} from "../../core/repositoryConfigurations.ts";
import { usePanelResource } from "../api.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { useNowMs } from "../Freshness.tsx";
import { ScreenTitle } from "../shell/slots.tsx";
import { ConfigurationBody } from "../TicketProvenance.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Panel } from "../ui/Panel.tsx";
import { Picker } from "../ui/Picker.tsx";
import { navRoutes } from "../../core/shellNav.ts";
import { CatalogHeadLine, CatalogHeadRevision } from "./CatalogHead.tsx";
import { CatalogShown, useCatalogPartition } from "./CatalogShown.tsx";

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

/** The repository's head against the configuration drawn, where an import from a repository drew it. */
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
  if (holding === undefined || summary?.provenance.source !== "Repository")
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

/** Which configuration, and which version of it, the page draws; another version keeps the entry shown. */
function CatalogChooser(props: {
  readonly configurations: readonly CatalogConfiguration[];
  readonly revision: string;
  readonly query: CatalogQuery;
}): ReactNode {
  const navigate = useNavigate();
  const partition = useCatalogPartition();
  const holding = catalogConfigurationHolding(
    props.configurations,
    props.revision,
  );
  const choose = (configuration: string, entry?: string): void => {
    void navigate({
      to: navRoutes.catalog,
      params: partition,
      search:
        entry === undefined ? { configuration } : { configuration, entry },
    });
  };
  const summary = holding?.revisions.find(
    (version) => version.revision === props.revision,
  );
  const version =
    holding === undefined
      ? undefined
      : catalogConfigurationVersionOf(holding, props.revision);
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
            value={version?.revision ?? props.revision}
            options={holding.versions.map((held) => ({
              value: held.revision,
              text: catalogVersionText(held),
            }))}
            onChoose={(chosen) => {
              choose(chosen, props.query.entry);
            }}
            align="start"
          />
        )}
      </div>
      {summary === undefined ? null : <CatalogProvenance summary={summary} />}
      <CatalogChosenHead
        configurations={props.configurations}
        revision={props.revision}
        query={props.query}
      />
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
      base={{ configuration: props.revision }}
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
            revision={props.revision}
            selected={props.query.entry}
          />
        }
      />
    );
  return (
    <CatalogRevision
      partition={props.partition}
      revision={props.revision}
      selected={props.query.entry}
    />
  );
}

/** Not the repository page's read, which holds only the newest revisions. */
const catalogConfigurationsResource = "catalog-configurations";

export function CatalogPage(props: {
  readonly query: CatalogQuery;
}): ReactNode {
  const partition = useCatalogPartition();
  const state = usePanelResource(
    partition,
    "Configuration",
    catalogConfigurationsResource,
    (ports) => readProjectConfigurationsVersions(ports, partition),
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
          <CatalogChooser
            configurations={configurations}
            revision={revision}
            query={props.query}
          />
          {read.partial ? (
            <p className="catalog-none">{configurationsPartialLabel}</p>
          ) : null}
          <CatalogDrawn
            key={revision}
            partition={partition}
            configurations={configurations}
            revision={revision}
            query={props.query}
          />
        </>
      )}
    </div>
  );
}
