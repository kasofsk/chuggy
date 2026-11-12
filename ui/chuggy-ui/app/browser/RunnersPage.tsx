/**
 * The project's runners: the machines registered to run its agents, and the
 * steps that add one, from installing a runner package to registering the
 * machine with a token minted here.
 *
 * ADD IS DRAWN WHERE IT IS THE NEXT THING TO DO: beside the line an empty
 * roster is said in, and in the page's head once a runner is registered.
 * `ui/chuggy-ui/app/core/runners.ts` decides which.
 */

import { useParams } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  WorkerPoolsResponse,
  WorkerPoolTokenResponse,
} from "../../../../src/contract/responses.ts";
import { useCopyText } from "../copy/CopyProvider.tsx";
import { apiMintWorkerPoolToken } from "../core/apiRoutes.ts";
import { instantFigure } from "../core/figures.ts";
import type { PanelState } from "../core/freshness.ts";
import {
  executionPlacementQuery,
  workerPoolsQuery,
} from "../core/projectQueries.ts";
import {
  runnerAddPlace,
  runnerCapabilityLabel,
  runnerStandingLabel,
  runnerTokenLifetimeSecs,
} from "../core/runners.ts";
import type { RunnerAsk } from "../core/runners.ts";
import { runnerStandingTone } from "../core/tones.ts";
import { consoleWriteKey } from "../core/consoleWrite.ts";
import type { ConsoleWrite } from "../core/consoleWrite.ts";
import { usePanelState } from "./api.ts";
import { PanelUnready } from "./DataPanel.tsx";
import {
  RunnerMintOpened,
  runnerMintRefusal,
  useRunnerMinting,
} from "./RunnerAsk.tsx";
import type { RunnerMinting } from "./RunnerAsk.tsx";
import { RunnerVersion } from "./RunnerVersion.tsx";
import { useNowMs } from "./Freshness.tsx";
import { Button } from "./ui/Button.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { Figure } from "./ui/Figure.tsx";
import { Notice } from "./ui/Notice.tsx";
import { PageHeader } from "./ui/PageHeader.tsx";
import { Panel } from "./ui/Panel.tsx";
import { Pill } from "./ui/Pill.tsx";
import { Table } from "./ui/Table.tsx";

/** This page's own address, which its reads are from. */
export const runnersRoutePath = "/$tenant/$project/runners";

/** The registered runners, or the line that says there are none with the one thing to do about it beside it. */
function RunnerRoster(props: {
  readonly listed: WorkerPoolsResponse;
  readonly action: ReactNode;
}): ReactNode {
  const text = useCopyText();
  const nowMs = useNowMs();
  if (props.listed.pools.length === 0)
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <EmptyState label={text({ id: "runners-none" })} />
        {props.action}
      </div>
    );
  return (
    <Table
      caption={text({ id: "runners-caption" })}
      stacked={{
        columns: [
          {
            key: "runner",
            label: text({ id: "runners-col-runner" }),
            rowHeader: true,
          },
          { key: "status", label: text({ id: "runners-col-status" }) },
          { key: "version", label: text({ id: "runners-col-version" }) },
          { key: "polled", label: text({ id: "runners-col-last-polled" }) },
        ],
        rows: props.listed.pools.map((pool) => ({
          key: pool.pool,
          cells: {
            runner: (
              <>
                <span className="block font-medium text-ink-1">
                  {pool.pool}
                </span>
                <span className="block text-sm font-regular text-ink-3">
                  {pool.capabilities.map(runnerCapabilityLabel).join(", ")}
                </span>
              </>
            ),
            status: <RunnerStanding live={pool.live} />,
            version: <RunnerVersion runner={pool.runner} />,
            polled:
              pool.polledAt === undefined ? (
                text({ id: "runners-never" })
              ) : (
                <Figure figure={instantFigure(pool.polledAt, nowMs)} />
              ),
          },
        })),
      }}
    />
  );
}

/** Whether a runner is taking work, as a word with its mark. */
function RunnerStanding(props: { readonly live: boolean }): ReactNode {
  const text = useCopyText();
  const standing = props.live ? "Live" : "Offline";
  return (
    <Pill tone={runnerStandingTone(standing)}>
      {text(runnerStandingLabel(standing))}
    </Pill>
  );
}

/** The project's pool token minted, which changes nothing a read draws until
 * a machine registers with it. */
function runnersPoolTokenWrite(
  partition: PartitionIdentity,
): ConsoleWrite<RunnerAsk, WorkerPoolTokenResponse> {
  return {
    mutationKey: consoleWriteKey(
      "pool-token-mint",
      partition.tenant,
      partition.project,
    ),
    write: (ports) =>
      apiMintWorkerPoolToken(ports, partition, {
        lifetimeSecs: runnerTokenLifetimeSecs,
      }),
    refusal: runnerMintRefusal,
  };
}

/** The press that opens the ask a registration token is minted for, which
 * only an administrator is offered, drawn as the one thing to do under an
 * empty roster. */
function AddRunner(props: { readonly minting: RunnerMinting }): ReactNode {
  const text = useCopyText();
  return (
    <Button
      size="sm"
      variant="primary"
      disabled={props.minting.opened}
      onClick={props.minting.open}
    >
      {text({ id: "runners-add" })}
    </Button>
  );
}

/** The page's head, holding Add where the roster has runners, and the panel
 * the roster, the ask and the steps are drawn in. */
function RunnersSection(props: {
  readonly partition: PartitionIdentity;
  readonly roster: PanelState<WorkerPoolsResponse>;
  /** Whether the reader administers the project, which minting needs. */
  readonly administers: boolean;
}): ReactNode {
  const text = useCopyText();
  const client = useQueryClient();
  const { partition, roster } = props;
  const minting = useRunnerMinting(runnersPoolTokenWrite(partition), {
    drawn: true,
  });
  const place = runnerAddPlace({
    administers: props.administers,
    roster,
    opened: minting.opened,
  });
  return (
    <>
      <PageHeader
        title={text({ id: "runners-title" })}
        description={text({ id: "runners-about" })}
        primary={
          place === "Head"
            ? {
                label: text({ id: "runners-add" }),
                onPress: minting.open,
                disabled: minting.opened,
              }
            : undefined
        }
      />
      <Panel variant="section" title={text({ id: "runners-caption" })}>
        <RunnerMintOpened
          minting={minting}
          kind="Pool"
          onDone={() => {
            minting.close();
            void client.invalidateQueries({
              queryKey: workerPoolsQuery(partition).queryKey,
            });
          }}
        />
        <PanelUnready state={roster} />
        {roster.state === "Ready" ? (
          <RunnerRoster
            listed={roster.value}
            action={
              place === "Empty" ? <AddRunner minting={minting} /> : undefined
            }
          />
        ) : null}
        {roster.state === "Ready" && roster.value.truncated ? (
          <Notice tone="info" inline detail={text({ id: "runners-more" })} />
        ) : null}
      </Panel>
    </>
  );
}

export function RunnersPage(): ReactNode {
  const params = useParams({ from: runnersRoutePath });
  const partition: PartitionIdentity = {
    tenant: params.tenant,
    project: params.project,
  };
  const placement = usePanelState(executionPlacementQuery(partition));
  const pools = usePanelState(workerPoolsQuery(partition));
  return (
    <div className="grid min-w-0 max-w-settings gap-4" data-fills-width>
      <RunnersSection
        partition={partition}
        roster={pools}
        administers={
          placement.state === "Ready" && placement.value.choices.length > 0
        }
      />
    </div>
  );
}
