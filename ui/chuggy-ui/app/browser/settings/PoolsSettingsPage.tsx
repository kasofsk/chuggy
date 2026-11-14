/**
 * The project's pools: the machines registered to run its work and its lead,
 * each with what it runs on, the release it runs and when it registered. Read
 * by anyone who reads the project's settings, and added from nowhere here.
 */

import { useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { WorkerPoolsResponse } from "../../../../../src/contract/responses.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import { instantFigure } from "../../core/figures.ts";
import { workerPoolsQuery } from "../../core/projectQueries.ts";
import { runnerCapabilityLabel } from "../../core/runners.ts";
import { settingsRoutes } from "../../core/settingsNav.ts";
import { usePanelState } from "../api.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { useNowMs } from "../Freshness.tsx";
import { RunnerVersion } from "../RunnerVersion.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Notice } from "../ui/Notice.tsx";
import { SettingsPage } from "./SettingsPage.tsx";
import {
  SettingsListing,
  SettingsListingSection,
  SettingsListingTable,
} from "./SettingsListing.tsx";

function PoolsSettingsTable(props: {
  readonly listed: WorkerPoolsResponse;
}): ReactNode {
  const text = useCopyText();
  const nowMs = useNowMs();
  return (
    <SettingsListingTable caption={text({ id: "runners-pools-title" })}>
      <thead>
        <tr>
          <th scope="col">{text({ id: "runners-col-runner" })}</th>
          <th scope="col">{text({ id: "runners-col-platforms" })}</th>
          <th scope="col">{text({ id: "runners-col-version" })}</th>
          <th scope="col">{text({ id: "runners-col-registered" })}</th>
        </tr>
      </thead>
      <tbody>
        {props.listed.pools.map((pool) => (
          <tr key={pool.pool}>
            <th scope="row">{pool.pool}</th>
            <td>{pool.capabilities.map(runnerCapabilityLabel).join(", ")}</td>
            <td>
              <RunnerVersion runner={pool.runner} />
            </td>
            <td>
              <Figure figure={instantFigure(pool.registeredAt, nowMs)} />
            </td>
          </tr>
        ))}
      </tbody>
    </SettingsListingTable>
  );
}

export function PoolsSettingsPage(): ReactNode {
  const text = useCopyText();
  const params = useParams({ from: settingsRoutes.project.pools });
  const partition: PartitionIdentity = {
    tenant: params.tenant,
    project: params.project,
  };
  const pools = usePanelState(workerPoolsQuery(partition));
  const title = text({ id: "runners-pools-title" });
  return (
    <SettingsPage title={title}>
      <SettingsListing>
        <SettingsListingSection
          heading={title}
          about={text({ id: "runners-pools-about" })}
        >
          <PanelUnready state={pools} />
          {pools.state !== "Ready" ? null : pools.value.pools.length === 0 ? (
            <EmptyState label={text({ id: "runners-pools-none" })} />
          ) : (
            <PoolsSettingsTable listed={pools.value} />
          )}
          {pools.state === "Ready" && pools.value.truncated ? (
            <Notice tone="info" inline detail={text({ id: "runners-more" })} />
          ) : null}
        </SettingsListingSection>
      </SettingsListing>
    </SettingsPage>
  );
}
