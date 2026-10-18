/**
 * One bound repository: how a finished ticket in it lands, what runs after
 * evaluation, what it declares under `.chug/configurations`, and when that was
 * last imported. A retired binding, which the listing does not draw, says
 * Unbound beside its name and offers no import.
 *
 * Only what a reader can act on is drawn. A revision's digest, its parent, the
 * practices it names and the instructions it counts are the configuration's own
 * and are read where it is; what belongs here is what a ticket in this
 * repository will be run and finished under.
 */

import { useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { ProjectRepositoryListedResponse } from "../../../../../src/contract/responses.ts";
import { apiProjectRepositories } from "../../core/apiRoutes.ts";
import { projectAbilityRefused } from "../../core/projectAbilities.ts";
import {
  repositoryLabel,
  repositoryUnbound,
} from "../../core/projectRepositories.ts";
import { projectRepositoryBound } from "../../core/repositoryLanding.ts";
import {
  readProjectConfigurations,
  repositoryConfigurationRow,
  repositoryConfigurations,
} from "../../core/repositoryConfigurations.ts";
import { navRoutes } from "../../core/shellNav.ts";
import { usePanelResource } from "../api.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { useProjectAbilities } from "../projectAbilities.tsx";
import { TopBarSlot } from "../shell/slots.tsx";
import { Breadcrumb, BreadcrumbLink } from "../ui/Breadcrumb.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Panel } from "../ui/Panel.tsx";
import { Pill } from "../ui/Pill.tsx";
import { projectRepositoriesResource } from "./AddRepository.tsx";
import {
  RepositoryImportButton,
  RepositoryImportLine,
  useRepositoryImportNow,
} from "./RepositoryImport.tsx";
import { RepositoryConfigurationTable } from "./RepositoryConfigurations.tsx";
import { RepositoryLandingSection } from "./RepositoryLandingSection.tsx";

/** This page's own address, which its reads take their partition from. */
export const repositoryRoutePath = "/$tenant/$project/repositories/$repository";

/** No frame names either read, so the partition's own refetch is what reaches
 * them; the revisions are the project's, so every repository's page shares one. */
export const repositoryConfigurationsResource = "repository-configurations";

/** What this repository declares under `.chug/configurations`, and when it was last imported. */
function RepositoryDeclared(props: {
  readonly partition: PartitionIdentity;
  readonly binding: ProjectRepositoryListedResponse;
}): ReactNode {
  const partition = props.partition;
  const repository = props.binding.repository;
  const state = usePanelResource(
    partition,
    "Configuration",
    repositoryConfigurationsResource,
    (ports) => readProjectConfigurations(ports, partition),
  );
  const importing = useRepositoryImportNow(
    partition,
    repository,
    props.binding.lastImport?.attemptedAt,
  );
  const abilities = useProjectAbilities(partition);
  const importable =
    props.binding.retiredAt === undefined &&
    !projectAbilityRefused(abilities, "mutate");
  const read = state.state === "Ready" ? state.value : undefined;
  const held = read?.configurations ?? [];
  return (
    <>
      <Panel
        variant="section"
        title="Configurations"
        about="What this repository declares under .chug/configurations."
        {...(importable
          ? { meta: <RepositoryImportButton importing={importing} /> }
          : {})}
      >
        <RepositoryImportLine
          lastImport={props.binding.lastImport}
          pressed={importing.pressed}
        />
        <PanelUnready state={state} />
        {read === undefined ? null : (
          <RepositoryConfigurationTable
            rows={repositoryConfigurations(held, repository).map(
              repositoryConfigurationRow,
            )}
            partial={read.partial}
          />
        )}
      </Panel>
    </>
  );
}

export function RepositoryPage(): ReactNode {
  const params = useParams({ from: repositoryRoutePath });
  const partition: PartitionIdentity = {
    tenant: params.tenant,
    project: params.project,
  };
  const repository = params.repository;
  const bindings = usePanelResource(
    partition,
    "Project",
    projectRepositoriesResource,
    (ports) => apiProjectRepositories(ports, partition),
  );
  const binding =
    bindings.state === "Ready"
      ? projectRepositoryBound(bindings.value, repository)
      : undefined;
  return (
    <div className="grid min-w-0 max-w-settings gap-4">
      <TopBarSlot>
        <Breadcrumb>
          <BreadcrumbLink to={navRoutes.repositories} params={partition}>
            Repositories
          </BreadcrumbLink>
        </Breadcrumb>
        <h1 className="text-md font-strong text-ink-1 truncate">
          {repositoryLabel(repository)}
        </h1>
        {binding?.retiredAt === undefined ? null : (
          <Pill tone="retired">{repositoryUnbound}</Pill>
        )}
      </TopBarSlot>
      <PanelUnready state={bindings} />
      {bindings.state === "Ready" && binding === undefined ? (
        <EmptyState label="Not bound" />
      ) : null}
      {binding === undefined ? null : (
        <>
          <RepositoryLandingSection partition={partition} binding={binding} />
          <RepositoryDeclared partition={partition} binding={binding} />
        </>
      )}
    </div>
  );
}
