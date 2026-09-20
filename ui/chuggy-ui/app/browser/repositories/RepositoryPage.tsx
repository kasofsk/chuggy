/**
 * One bound repository: how a finished ticket in it lands, and what it
 * declares that a ticket here is run and finished under.
 *
 * Only what a reader can act on is drawn. A fragment's own fields are the
 * fragment's and are read where it is; what belongs here is what a ticket in
 * this repository will be run and finished under.
 */

import { useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { apiProjectRepositories } from "../../core/apiRoutes.ts";
import { repositoryLabel } from "../../core/projectRepositories.ts";
import { projectRepositoryBound } from "../../core/repositoryLanding.ts";
import { navRoutes } from "../../core/shellNav.ts";
import { usePanelResource } from "../api.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { TopBarSlot } from "../shell/slots.tsx";
import { Breadcrumb, BreadcrumbLink } from "../ui/Breadcrumb.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { projectRepositoriesResource } from "./AddRepository.tsx";
import { RepositoryDeclaredSection } from "./RepositoryDeclaredSection.tsx";
import { RepositoryLandingSection } from "./RepositoryLandingSection.tsx";

/** This page's own address, which its reads take their partition from. */
export const repositoryRoutePath = "/$tenant/$project/repositories/$repository";

/** No frame names either read, so the partition's own refetch is what reaches them. */
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
          <RepositoryDeclaredSection
            partition={partition}
            repository={repository}
          />
        </>
      )}
    </div>
  );
}
