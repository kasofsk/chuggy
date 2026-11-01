/**
 * The project's runners: the machines registered to run its agents, and the
 * steps that add one, from installing a runner package to registering the
 * machine with a token minted here.
 *
 * ADD IS DRAWN WHERE IT IS THE NEXT THING TO DO: under the line an empty
 * roster is said in, and in the panel's head once a runner is registered.
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
  runnerTokenLifetimeSecs,
} from "../core/runners.ts";
import type { RunnerAsk } from "../core/runners.ts";
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
import { ScreenTitle } from "./shell/slots.tsx";
import { Button } from "./ui/Button.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { Figure } from "./ui/Figure.tsx";
import { Notice } from "./ui/Notice.tsx";
import { Panel } from "./ui/Panel.tsx";
import { Table } from "./ui/Table.tsx";

/** This page's own address, which its reads are from. */
export const runnersRoutePath = "/$tenant/$project/runners";

/** The registered runners, or the line that says there are none, with the one thing to do about it under it. */
function RunnerRoster(props: {
  readonly listed: WorkerPoolsResponse;
  readonly action: ReactNode;
}): ReactNode {
  const nowMs = useNowMs();
  if (props.listed.pools.length === 0)
    return (
      <div className="grid justify-items-start gap-3 pt-3">
        <EmptyState label="No runner registered" />
        {props.action}
      </div>
    );
  return (
    <Table caption="Registered runners">
      <thead>
        <tr>
          <th scope="col">Runner</th>
          <th scope="col">Platforms</th>
          <th scope="col">Version</th>
          <th scope="col">Registered</th>
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
    </Table>
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

/** The press that opens the ask a registration token is minted for, which only an administrator is offered. */
function AddRunner(props: {
  readonly minting: RunnerMinting;
  /** Drawn as the one thing to do, which it is under an empty roster. */
  readonly leading: boolean;
}): ReactNode {
  return (
    <Button
      size="sm"
      variant={props.leading ? "primary" : "default"}
      disabled={props.minting.opened}
      onClick={props.minting.open}
    >
      Add runner
    </Button>
  );
}

function RunnersSection(props: {
  readonly partition: PartitionIdentity;
  readonly roster: PanelState<WorkerPoolsResponse>;
  /** Whether the reader administers the project, which minting needs. */
  readonly administers: boolean;
}): ReactNode {
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
  const add = <AddRunner minting={minting} leading={place === "Empty"} />;
  return (
    <Panel
      variant="section"
      title="Runners"
      about="Machines that run this project's agents."
      {...(place === "Head" ? { meta: add } : {})}
    >
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
          action={place === "Empty" ? add : undefined}
        />
      ) : null}
      {roster.state === "Ready" && roster.value.truncated ? (
        <Notice tone="info" inline detail="More not shown" />
      ) : null}
    </Panel>
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
    <div className="grid min-w-0 max-w-settings gap-4">
      <ScreenTitle>Runners</ScreenTitle>
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
