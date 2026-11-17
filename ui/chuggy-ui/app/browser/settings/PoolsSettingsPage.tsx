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
import { Table } from "../ui/Table.tsx";
import { SettingsPage } from "./SettingsPage.tsx";
import { SettingsListing, SettingsListingSection } from "./SettingsListing.tsx";

function PoolsSettingsTable(props: {
  readonly listed: WorkerPoolsResponse;
}): ReactNode {
  const text = useCopyText();
  const nowMs = useNowMs();
  return (
    <Table
      caption={text({ id: "runners-pools-title" })}
      stacked={{
        columns: [
          {
            key: "runner",
            label: text({ id: "runners-col-runner" }),
            rowHeader: true,
          },
          { key: "platforms", label: text({ id: "runners-col-platforms" }) },
          { key: "version", label: text({ id: "runners-col-version" }) },
          {
            key: "registered",
            label: text({ id: "runners-col-registered" }),
          },
        ],
        rows: props.listed.pools.map((pool) => ({
          key: pool.pool,
          cells: {
            runner: pool.pool,
            platforms: pool.capabilities.map(runnerCapabilityLabel).join(", "),
            version: <RunnerVersion runner={pool.runner} />,
            registered: (
              <Figure figure={instantFigure(pool.registeredAt, nowMs)} />
            ),
          },
        })),
      }}
    />
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
    <SettingsPage title={title} headed>
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
