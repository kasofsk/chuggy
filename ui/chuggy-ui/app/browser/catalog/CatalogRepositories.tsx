/**
 * The catalog of one repository an import was read from, chosen among them
 * all: the commit it was read at, the configurations that commit declares
 * with the parts each is made of, and every fragment those configurations hold with the file it
 * is written in and the configurations holding it.
 *
 * Every configuration and fragment links to the configuration's own page,
 * which draws the entry in full. A configuration whose read failed says so in
 * its row, and the fragments are those of the configurations that were read.
 */

import { useQueries } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type {
  ConfigurationResponse,
  ConfigurationSummary,
} from "../../../../../src/contract/responses.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import {
  catalogEntriesOf,
  catalogEntrySummary,
} from "../../core/catalogEntries.ts";
import type { CatalogEntries } from "../../core/catalogEntries.ts";
import { catalogFragmentsOf } from "../../core/catalogRepositories.ts";
import type {
  CatalogDeclared,
  CatalogFragment,
  CatalogFragmentGroup,
  CatalogRepository,
} from "../../core/catalogRepositories.ts";
import { configurationCatalogOf } from "../../core/configurationCatalog.ts";
import { configurationQuery } from "../../core/configurationQueries.ts";
import { instantFigure } from "../../core/figures.ts";
import type { PanelState } from "../../core/freshness.ts";
import { commitLabel } from "../../core/labels.ts";
import { repositoryLabel } from "../../core/projectRepositories.ts";
import { settingsRoutes } from "../../core/settingsNav.ts";
import { panelQueryState, usePanelQueryOptions } from "../api.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { useNowMs } from "../Freshness.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Picker } from "../ui/Picker.tsx";
import { CatalogBadges, CatalogLink } from "./CatalogShown.tsx";

function catalogSummaryName(summary: ConfigurationSummary): string {
  const { provenance } = summary;
  return (
    summary.version?.name ??
    (provenance.source === "Repository" ? provenance.name : summary.revision)
  );
}

function catalogSummaryPath(summary: ConfigurationSummary): string {
  const { provenance } = summary;
  return provenance.source === "Repository" ? provenance.path : "";
}

function catalogDeclaredOf(
  summary: ConfigurationSummary,
  read: ConfigurationResponse,
): CatalogDeclared {
  const catalog = configurationCatalogOf(read.canonical);
  return {
    name: catalogSummaryName(summary),
    revision: summary.revision,
    path: catalogSummaryPath(summary),
    entries:
      catalog === undefined
        ? undefined
        : catalogEntriesOf(catalog, read.workloadPaths),
  };
}

/** A configuration's parts, each group a line of links to its entries. */
function CatalogParts(props: {
  readonly revision: string;
  readonly entries: CatalogEntries;
}): ReactNode {
  const text = useCopyText();
  return (
    <dl className="catalog-parts">
      {props.entries.groups.map((group) => (
        <div key={group.kind}>
          <dt>{text(group.title)}</dt>
          <dd>
            {group.entries.map((entry) => (
              <span key={entry.key} className="catalog-part">
                <CatalogLink
                  query={{ configuration: props.revision, entry: entry.key }}
                >
                  {entry.name}
                </CatalogLink>
                <CatalogBadges entry={entry} />
              </span>
            ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function CatalogConfigurationRow(props: {
  readonly summary: ConfigurationSummary;
  readonly state: PanelState<ConfigurationResponse>;
}): ReactNode {
  const text = useCopyText();
  const { summary, state } = props;
  const declared =
    state.state === "Ready"
      ? catalogDeclaredOf(summary, state.value)
      : undefined;
  return (
    <li className="catalog-configuration">
      <div className="catalog-configuration-head">
        <CatalogLink
          query={{ configuration: summary.revision }}
          className="catalog-entry-name"
        >
          {catalogSummaryName(summary)}
        </CatalogLink>
        {summary.version === undefined ? null : (
          <span className="catalog-origin">{`#${String(summary.version.number)}`}</span>
        )}
        <code className="catalog-origin">{catalogSummaryPath(summary)}</code>
      </div>
      {summary.readiness === "Incomplete" ? (
        <p className="catalog-none">
          {text({ id: "configuration-catalog-incomplete" })}
        </p>
      ) : state.state !== "Ready" ? (
        <PanelUnready state={state} />
      ) : declared?.entries === undefined ? (
        <p className="catalog-none">
          {text({ id: "configuration-catalog-version-one" })}
        </p>
      ) : (
        <CatalogParts revision={summary.revision} entries={declared.entries} />
      )}
    </li>
  );
}

/** One fragment: what it is, the file it is written in, and the configurations holding it. */
function CatalogFragmentRow(props: {
  readonly fragment: CatalogFragment;
}): ReactNode {
  const text = useCopyText();
  const { fragment } = props;
  const [first] = fragment.holders;
  const summary = catalogEntrySummary(fragment.entry, text);
  const files =
    fragment.file === undefined
      ? [...new Set(fragment.holders.map((holder) => holder.path))]
      : [fragment.file];
  return (
    <li className="catalog-fragment">
      <div className="catalog-configuration-head">
        {first === undefined ? (
          <span className="catalog-entry-name">{fragment.entry.name}</span>
        ) : (
          <CatalogLink
            query={{ configuration: first.revision, entry: first.key }}
            className="catalog-entry-name"
          >
            {fragment.entry.name}
          </CatalogLink>
        )}
        {summary === "" ? null : (
          <span className="catalog-entry-summary">{summary}</span>
        )}
      </div>
      <p className="catalog-origin">
        {fragment.file === undefined ? (
          <span>{text({ id: "configuration-catalog-written-in" })}</span>
        ) : null}
        {files.map((file) => (
          <code key={file}>{file}</code>
        ))}
        <span>{text({ id: "configuration-catalog-held-by" })}</span>
        {fragment.holders.map((holder) => (
          <CatalogLink
            key={holder.revision}
            query={{ configuration: holder.revision, entry: holder.key }}
          >
            {holder.name}
          </CatalogLink>
        ))}
      </p>
    </li>
  );
}

/** Every fragment of one repository, a card per kind. */
function CatalogFragmentGroups(props: {
  readonly groups: readonly CatalogFragmentGroup[];
}): ReactNode {
  const text = useCopyText();
  return (
    <>
      {props.groups.map((group) => (
        <section
          key={group.kind}
          className="catalog-group"
          aria-label={text(group.title)}
        >
          <h3 className="catalog-group-title">
            {text(group.title)}{" "}
            <span className="catalog-count">{group.fragments.length}</span>
          </h3>
          <ul className="catalog-list">
            {group.fragments.map((fragment) => (
              <CatalogFragmentRow key={fragment.id} fragment={fragment} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

/** The repository's name, and the commit its newest import read and when. */
function CatalogRepositoryHead(props: {
  readonly repository: CatalogRepository;
}): ReactNode {
  const text = useCopyText();
  const nowMs = useNowMs();
  const { repository } = props;
  const commit = commitLabel(repository.commit);
  return (
    <header className="catalog-repository-head">
      <h2 className="catalog-repository-name" title={repository.repository}>
        {repositoryLabel(repository.repository)}
      </h2>
      <p className="catalog-provenance">
        <code title={commit.title}>{commit.text}</code>
        <span>
          {text({ id: "configuration-catalog-imported" })}{" "}
          <Figure figure={instantFigure(repository.importedAt, nowMs)} />
        </span>
      </p>
    </header>
  );
}

function CatalogRepositorySection(props: {
  readonly partition: PartitionIdentity;
  readonly repository: CatalogRepository;
}): ReactNode {
  const text = useCopyText();
  const { repository } = props;
  const options = usePanelQueryOptions();
  const states = useQueries({
    queries: repository.declared.map((summary) => ({
      ...options(
        configurationQuery(props.partition, summary.revision, "Streamed"),
      ),
      enabled: summary.readiness !== "Incomplete",
    })),
    combine: (answers) => answers.map((answer) => panelQueryState(answer)),
  });
  const declared = repository.declared.flatMap((summary, index) => {
    const state = states[index];
    return state?.state === "Ready"
      ? [catalogDeclaredOf(summary, state.value)]
      : [];
  });
  const groups = catalogFragmentsOf(declared);
  const unread = states.some(
    (state) => state.state === "Failed" || state.state === "Absent",
  );
  return (
    <section
      className="catalog-repository"
      aria-label={repositoryLabel(repository.repository)}
    >
      <CatalogRepositoryHead repository={repository} />
      <section
        className="catalog-group"
        aria-label={text({
          id: "configuration-catalog-section-configurations",
        })}
      >
        <h3 className="catalog-group-title">
          {text({ id: "configuration-catalog-section-configurations" })}{" "}
          <span className="catalog-count">{repository.declared.length}</span>
        </h3>
        <ul className="catalog-list">
          {repository.declared.map((summary, index) => (
            <CatalogConfigurationRow
              key={summary.revision}
              summary={summary}
              state={states[index] ?? { state: "Pending" }}
            />
          ))}
        </ul>
      </section>
      {unread ? (
        <p className="catalog-none">
          {text({ id: "configuration-catalog-fragments-partial" })}
        </p>
      ) : null}
      <CatalogFragmentGroups groups={groups} />
    </section>
  );
}

/** One repository's catalog, and the picker that chooses which; the address
 * holds the choice, and the one imported last is drawn where it names none. */
export function CatalogRepositories(props: {
  readonly partition: PartitionIdentity;
  readonly repositories: readonly CatalogRepository[];
  readonly chosen: string | undefined;
}): ReactNode {
  const text = useCopyText();
  const navigate = useNavigate();
  const repository =
    props.repositories.find((held) => held.repository === props.chosen) ??
    props.repositories[0];
  if (repository === undefined) return null;
  return (
    <div className="catalog-repositories">
      <div className="catalog-chooser-pickers">
        <Picker
          label={text({ id: "configuration-catalog-picker-repository" })}
          value={repository.repository}
          options={props.repositories.map((held) => ({
            value: held.repository,
            text: repositoryLabel(held.repository),
          }))}
          onChoose={(chosen) => {
            void navigate({
              to: settingsRoutes.project.catalog,
              params: props.partition,
              search: { repository: chosen },
            });
          }}
          align="start"
        />
      </div>
      <CatalogRepositorySection
        key={repository.repository}
        partition={props.partition}
        repository={repository}
      />
    </div>
  );
}
