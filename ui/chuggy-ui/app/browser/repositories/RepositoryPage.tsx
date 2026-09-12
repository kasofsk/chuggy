/**
 * One bound repository: how a finished ticket in it lands, what runs after
 * evaluation, and what it declares under `.chug/configurations`.
 *
 * Only what a reader can act on is drawn. A revision's digest, its parent, the
 * practices it names and the instructions it counts are the configuration's own
 * and are read where it is; what belongs here is what a ticket in this
 * repository will be run and finished under.
 */

import { useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import {
  apiDraftInitialization,
  apiProjectRepositories,
} from "../../core/apiRoutes.ts";
import { finalizerLabel } from "../../core/codeLabels.ts";
import { repositoryLabel } from "../../core/projectRepositories.ts";
import { projectRepositoryBound } from "../../core/repositoryLanding.ts";
import {
  readProjectConfigurations,
  repositoryConfigurationRow,
  repositoryConfigurations,
  repositoryReadyConfiguration,
} from "../../core/repositoryConfigurations.ts";
import { navRoutes } from "../../core/shellNav.ts";
import { usePanelResource } from "../api.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { TopBarSlot } from "../shell/slots.tsx";
import { Breadcrumb, BreadcrumbLink } from "../ui/Breadcrumb.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Field, Fields } from "../ui/Fields.tsx";
import { Panel } from "../ui/Panel.tsx";
import { projectRepositoriesResource } from "./AddRepository.tsx";
import { RepositoryConfigurationTable } from "./RepositoryConfigurations.tsx";
import { RepositoryLandingSection } from "./RepositoryLandingSection.tsx";

/** This page's own address, which its reads take their partition from. */
export const repositoryRoutePath = "/$tenant/$project/repositories/$repository";

/** No frame names either read, so the partition's own refetch is what reaches
 * them; the revisions are the project's, so every repository's page shares one. */
export const repositoryConfigurationsResource = "repository-configurations";

function repositoryInitializationResource(revision: string): string {
  return `draft-initialization:${revision}`;
}

/** What a new ticket here is authored to run once it is evaluated, which the
 * initialization of this repository's newest ready revision defaults. */
function RepositoryFinalizerSection(props: {
  readonly partition: PartitionIdentity;
  readonly revision: string;
}): ReactNode {
  const partition = props.partition;
  const revision = props.revision;
  const state = usePanelResource(
    partition,
    "Configuration",
    repositoryInitializationResource(revision),
    (ports) => apiDraftInitialization(ports, partition, revision),
  );
  const finalizer =
    state.state === "Ready" ? state.value.defaults.finalizer : undefined;
  return (
    <Panel
      variant="section"
      title="Finalizer"
      about="What a new ticket is authored to run. A ticket may choose otherwise."
    >
      <PanelUnready state={state} />
      {finalizer === undefined ? null : (
        <Fields variant="inline">
          <Field name="Finalizer">
            <span className="flex items-center gap-3">
              {finalizerLabel(finalizer)}
              {finalizer === "ManagedFinalizer" ? (
                <span className="text-ink-3 text-sm">
                  Runs after evaluation passes
                </span>
              ) : null}
            </span>
          </Field>
        </Fields>
      )}
    </Panel>
  );
}

/** What this repository declares, and what the newest ready revision of it
 * finalizes with. */
function RepositoryDeclared(props: {
  readonly partition: PartitionIdentity;
  readonly repository: string;
}): ReactNode {
  const partition = props.partition;
  const state = usePanelResource(
    partition,
    "Configuration",
    repositoryConfigurationsResource,
    (ports) => readProjectConfigurations(ports, partition),
  );
  const read = state.state === "Ready" ? state.value : undefined;
  const held = read?.configurations ?? [];
  const ready = repositoryReadyConfiguration(held, props.repository);
  return (
    <>
      {ready === undefined ? null : (
        <RepositoryFinalizerSection
          partition={partition}
          revision={ready.revision}
        />
      )}
      <Panel
        variant="section"
        title="Configurations"
        about="What this repository declares under .chug/configurations."
      >
        <PanelUnready state={state} />
        {read === undefined ? null : (
          <RepositoryConfigurationTable
            rows={repositoryConfigurations(held, props.repository).map(
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
      </TopBarSlot>
      <PanelUnready state={bindings} />
      {bindings.state === "Ready" && binding === undefined ? (
        <EmptyState label="Not bound" />
      ) : null}
      {binding === undefined ? null : (
        <>
          <RepositoryLandingSection partition={partition} binding={binding} />
          <RepositoryDeclared partition={partition} repository={repository} />
        </>
      )}
    </div>
  );
}
