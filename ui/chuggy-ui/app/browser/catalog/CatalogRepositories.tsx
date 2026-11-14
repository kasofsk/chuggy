/**
 * The catalog of one repository an import was read from, chosen among them
 * all: the commit it was read at, the configurations that commit declares
 * with how many of each kind each holds, and every fragment those
 * configurations hold with the file it is written in and the configurations
 * holding it. The search narrows both to what it matches.
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
import type { CopyText } from "../../core/copy.ts";
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
import { rosterSearchFilter } from "../../core/rosterSearch.ts";
import { CountBadge } from "../ui/CountBadge.tsx";
import { Figure } from "../ui/Figure.tsx";
import { listFilterGlyph } from "../ui/ListControls.tsx";
import { Picker } from "../ui/Picker.tsx";
import { RecordRow } from "../ui/RecordList.tsx";
import {
  CatalogBadges,
  CatalogGroup,
  CatalogLink,
  CatalogRowMeta,
  CatalogSearchNone,
  CatalogSkeleton,
  useCatalogRowLink,
  useCatalogSearch,
} from "./CatalogShown.tsx";

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

/** How many of each kind a configuration holds. */
function CatalogConfigurationCounts(props: {
  readonly entries: CatalogEntries;
}): ReactNode {
  const text = useCopyText();
  return (
    <span className="catalog-counts">
      {props.entries.groups.map((group) => (
        <span key={group.kind}>
          {text(group.title)}{" "}
          <CountBadge
            count={group.entries.length}
            name={text({
              id: "configuration-catalog-count",
              args: { count: group.entries.length },
            })}
          />
        </span>
      ))}
    </span>
  );
}

/** What a configuration's row says under its meta line: how many of each
 * kind it holds once read, or why it says nothing of them. */
function CatalogConfigurationFoot(props: {
  readonly summary: ConfigurationSummary;
  readonly state: PanelState<ConfigurationResponse>;
}): ReactNode {
  const text = useCopyText();
  const { summary, state } = props;
  if (summary.readiness === "Incomplete")
    return <span>{text({ id: "configuration-catalog-incomplete" })}</span>;
  if (state.state === "Pending") return null;
  if (state.state !== "Ready") return <PanelUnready state={state} />;
  const entries = catalogDeclaredOf(summary, state.value).entries;
  if (entries === undefined)
    return <span>{text({ id: "configuration-catalog-version-one" })}</span>;
  return <CatalogConfigurationCounts entries={entries} />;
}

function CatalogConfigurationRow(props: {
  readonly repository: string;
  readonly summary: ConfigurationSummary;
  readonly state: PanelState<ConfigurationResponse>;
}): ReactNode {
  const linked = useCatalogRowLink();
  const { summary } = props;
  return (
    <RecordRow
      title={catalogSummaryName(summary)}
      link={linked({ configuration: summary.revision })}
      level={4}
      meta={
        <>
          <CatalogRowMeta repository={props.repository} said="" />
          <code>{catalogSummaryPath(summary)}</code>
        </>
      }
      trailing={
        summary.version === undefined
          ? undefined
          : `#${String(summary.version.number)}`
      }
      foot={<CatalogConfigurationFoot summary={summary} state={props.state} />}
    />
  );
}

/** One fragment: what it is, the file it is written in, and the configurations holding it. */
function CatalogFragmentRow(props: {
  readonly repository: string;
  readonly fragment: CatalogFragment;
}): ReactNode {
  const text = useCopyText();
  const linked = useCatalogRowLink();
  const { fragment } = props;
  const [first] = fragment.holders;
  const files =
    fragment.file === undefined
      ? [...new Set(fragment.holders.map((holder) => holder.path))]
      : [fragment.file];
  return (
    <RecordRow
      title={fragment.entry.name}
      link={linked(
        first === undefined
          ? { repository: props.repository }
          : { configuration: first.revision, entry: first.key },
      )}
      level={4}
      meta={
        <CatalogRowMeta
          repository={props.repository}
          said={catalogEntrySummary(fragment.entry, text)}
        />
      }
      trailing={
        fragment.entry.defaults.length === 0 ? undefined : (
          <CatalogBadges entry={fragment.entry} />
        )
      }
      foot={
        <span className="catalog-origin">
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
        </span>
      }
    />
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

/** Each configuration's read, in the order the repository declares them. */
function useCatalogDeclaredStates(
  partition: PartitionIdentity,
  repository: CatalogRepository,
): readonly PanelState<ConfigurationResponse>[] {
  const options = usePanelQueryOptions();
  return useQueries({
    queries: repository.declared.map((summary) => ({
      ...options(configurationQuery(partition, summary.revision, "Streamed")),
      enabled: summary.readiness !== "Incomplete",
    })),
    combine: (answers) => answers.map((answer) => panelQueryState(answer)),
  });
}

/** The fragments of the configurations read, each kind's narrowed to those
 * the search keeps, and only the kinds it keeps any of. */
function catalogRepositoryFragmentsKept(
  repository: CatalogRepository,
  states: readonly PanelState<ConfigurationResponse>[],
  search: string,
  text: CopyText,
): readonly CatalogFragmentGroup[] {
  const declared = repository.declared.flatMap((summary, index) => {
    const state = states[index];
    return state?.state === "Ready"
      ? [catalogDeclaredOf(summary, state.value)]
      : [];
  });
  return catalogFragmentsOf(declared).flatMap((group) => {
    const fragments = rosterSearchFilter(group.fragments, search, (fragment) =>
      [fragment.entry.name, catalogEntrySummary(fragment.entry, text)].join(
        " ",
      ),
    );
    return fragments.length === 0 ? [] : [{ ...group, fragments }];
  });
}

/** The configurations and the fragments the search keeps, each group with
 * any row; none where it keeps nothing. */
function CatalogRepositoryGroups(props: {
  readonly repository: CatalogRepository;
  readonly states: readonly PanelState<ConfigurationResponse>[];
}): ReactNode {
  const text = useCopyText();
  const search = useCatalogSearch();
  const { repository, states } = props;
  const configurations = rosterSearchFilter(
    repository.declared.map((summary, index) => ({
      summary,
      state: states[index] ?? ({ state: "Pending" } as const),
    })),
    search,
    ({ summary }) =>
      [catalogSummaryName(summary), catalogSummaryPath(summary)].join(" "),
  );
  const groups = catalogRepositoryFragmentsKept(
    repository,
    states,
    search,
    text,
  );
  const reading = repository.declared.some(
    (summary, index) =>
      summary.readiness !== "Incomplete" && states[index]?.state === "Pending",
  );
  if (configurations.length === 0 && groups.length === 0 && !reading)
    return <CatalogSearchNone />;
  return (
    <>
      {configurations.length === 0 ? null : (
        <CatalogGroup
          title={{ id: "configuration-catalog-section-configurations" }}
          level={3}
          count={configurations.length}
        >
          {configurations.map(({ summary, state }) => (
            <CatalogConfigurationRow
              key={summary.revision}
              repository={repository.repository}
              summary={summary}
              state={state}
            />
          ))}
        </CatalogGroup>
      )}
      {groups.map((group) => (
        <CatalogGroup
          key={group.kind}
          title={group.title}
          level={3}
          count={group.fragments.length}
        >
          {group.fragments.map((fragment) => (
            <CatalogFragmentRow
              key={fragment.id}
              repository={repository.repository}
              fragment={fragment}
            />
          ))}
        </CatalogGroup>
      ))}
      {reading ? <CatalogSkeleton /> : null}
    </>
  );
}

/** One repository's catalog: its name and commit, then its configurations
 * and the fragments they are made of. */
export function CatalogRepositorySection(props: {
  readonly partition: PartitionIdentity;
  readonly repository: CatalogRepository;
}): ReactNode {
  const text = useCopyText();
  const { repository } = props;
  const states = useCatalogDeclaredStates(props.partition, repository);
  const unread = states.some(
    (state) => state.state === "Failed" || state.state === "Absent",
  );
  return (
    <section
      className="catalog-repository"
      aria-label={repositoryLabel(repository.repository)}
    >
      <CatalogRepositoryHead repository={repository} />
      {unread ? (
        <p className="catalog-none">
          {text({ id: "configuration-catalog-fragments-partial" })}
        </p>
      ) : null}
      <CatalogRepositoryGroups repository={repository} states={states} />
    </section>
  );
}

/** The picker choosing which repository's catalog is drawn, which the
 * address holds. */
export function CatalogRepositoryPicker(props: {
  readonly partition: PartitionIdentity;
  readonly repositories: readonly CatalogRepository[];
  readonly chosen: CatalogRepository;
}): ReactNode {
  const text = useCopyText();
  const navigate = useNavigate();
  return (
    <Picker
      label={text({ id: "configuration-catalog-picker-repository" })}
      iconOnly
      glyph={listFilterGlyph}
      value={props.chosen.repository}
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
      align="end"
    />
  );
}

/** The repository the address names, or the one imported last where it
 * names none the listing holds. */
export function catalogRepositoryChosen(
  repositories: readonly CatalogRepository[],
  chosen: string | undefined,
): CatalogRepository | undefined {
  return (
    repositories.find((held) => held.repository === chosen) ?? repositories[0]
  );
}
