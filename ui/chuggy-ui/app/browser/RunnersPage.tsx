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
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  WorkerPoolsResponse,
  WorkerPoolTokenResponse,
} from "../../../../src/contract/responses.ts";
import {
  apiExecutionPlacement,
  apiMintWorkerPoolToken,
  apiWorkerPools,
} from "../core/apiRoutes.ts";
import { instantFigure } from "../core/figures.ts";
import { panelReason } from "../core/freshness.ts";
import type { PanelState } from "../core/freshness.ts";
import { projectResourceKey } from "../core/projectQueryKeys.ts";
import {
  runnerAddPlace,
  runnerCapabilityLabel,
  runnerPackageOffered,
  runnerRegisterCommand,
  runnerTokenLifetimeSecs,
} from "../core/runners.ts";
import { useApiPorts, usePanelResource } from "./api.ts";
import { PanelUnready } from "./DataPanel.tsx";
import { useNowMs } from "./Freshness.tsx";
import { currentOrigin } from "./ports.ts";
import { TopBarSlot } from "./shell/slots.tsx";
import { Button } from "./ui/Button.tsx";
import { CopyButton } from "./ui/CopyButton.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { Figure } from "./ui/Figure.tsx";
import { Notice } from "./ui/Notice.tsx";
import { Panel } from "./ui/Panel.tsx";
import { Table } from "./ui/Table.tsx";

/** No frame names these reads, so the partition's own refetch is what reaches them. */
const executionPlacementResource = "execution-placement";
const workerPoolsResource = "worker-pools";

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
          <th scope="col">Registered</th>
        </tr>
      </thead>
      <tbody>
        {props.listed.pools.map((pool) => (
          <tr key={pool.pool}>
            <th scope="row">{pool.pool}</th>
            <td>{pool.capabilities.map(runnerCapabilityLabel).join(", ")}</td>
            <td>
              <Figure figure={instantFigure(pool.registeredAt, nowMs)} />
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** A command in a box of its own, under the bar that says one thing of it and holds the control that copies it. */
function RunnerCommand(props: {
  readonly about: ReactNode;
  readonly command: string;
  readonly copyLabel: string;
}): ReactNode {
  return (
    <div className="bg-surface-2 rounded-2 grid min-w-0">
      <div className="flex items-center justify-between gap-2 py-1 pr-1 pl-3 text-sm text-ink-3">
        <span className="min-w-0">{props.about}</span>
        <CopyButton text={props.command} label={props.copyLabel} worded />
      </div>
      <code className="px-3 pb-2 font-mono text-sm text-ink-1 break-all">
        {props.command}
      </code>
    </div>
  );
}

function RunnerStep(props: {
  readonly title: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <li className="marker:text-ink-3">
      <div className="grid min-w-0 gap-2">
        <span className="font-medium text-ink-1">{props.title}</span>
        {props.children}
      </div>
    </li>
  );
}

/**
 * What a minted token is handed over in: the steps that make a machine a
 * runner, each command copied by its own control. The list takes the focus as
 * it is drawn only where nothing holds it, which is where a press leaves it
 * once the control is disabled for the mint, so a reader who has since moved
 * on keeps their place.
 */
function RunnerSteps(props: {
  readonly minted: WorkerPoolTokenResponse;
  readonly onDone: () => void;
}): ReactNode {
  const nowMs = useNowMs();
  const steps = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const list = steps.current;
    if (list === null) return;
    const held = list.ownerDocument.activeElement;
    if (held === null || held === list.ownerDocument.body) list.focus();
  }, []);
  const offered = runnerPackageOffered;
  const expires = new Date(props.minted.expiresAtMs).toISOString();
  return (
    <div className="border-edge grid min-w-0 gap-3 border-b pt-3 pb-4">
      <ol
        ref={steps}
        tabIndex={-1}
        aria-label="Add runner"
        className="grid min-w-0 list-decimal gap-3 pl-6"
      >
        <RunnerStep title="Install">
          <RunnerCommand
            about={offered.needs}
            command={offered.installCommand}
            copyLabel="Copy install command"
          />
        </RunnerStep>
        <RunnerStep title="Register">
          <RunnerCommand
            about={
              <>
                Expires <Figure figure={instantFigure(expires, nowMs)} />
              </>
            }
            command={runnerRegisterCommand(
              offered,
              currentOrigin(),
              props.minted.token,
            )}
            copyLabel="Copy register command"
          />
        </RunnerStep>
        <RunnerStep title="Finish">
          <a
            className="justify-self-start"
            href={offered.guideAddress}
            rel="noopener noreferrer"
            target="_blank"
          >
            Setup guide
          </a>
        </RunnerStep>
      </ol>
      <div className="pl-6">
        <Button size="sm" onClick={props.onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

type RunnerMint =
  | { readonly mint: "Idle" }
  | { readonly mint: "Minting" }
  | { readonly mint: "Minted"; readonly minted: WorkerPoolTokenResponse }
  | { readonly mint: "Failed"; readonly reason: string };

/** The press that mints a registration token, which only an administrator is offered. */
function AddRunner(props: {
  readonly partition: PartitionIdentity;
  readonly mint: RunnerMint;
  readonly onMint: (mint: RunnerMint) => void;
  /** Drawn as the one thing to do, which it is under an empty roster. */
  readonly leading: boolean;
}): ReactNode {
  const ports = useApiPorts();
  return (
    <Button
      size="sm"
      variant={props.leading ? "primary" : "default"}
      busy={props.mint.mint === "Minting"}
      disabled={props.mint.mint === "Minting"}
      onClick={() => {
        props.onMint({ mint: "Minting" });
        void (async () => {
          const minted = await apiMintWorkerPoolToken(ports, props.partition, {
            capabilities: [...runnerPackageOffered.platforms],
            lifetimeSecs: runnerTokenLifetimeSecs,
          });
          props.onMint(
            minted.outcome === "Ok"
              ? { mint: "Minted", minted: minted.value }
              : { mint: "Failed", reason: panelReason(minted) },
          );
        })();
      }}
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
  const [mint, setMint] = useState<RunnerMint>({ mint: "Idle" });
  const { partition, roster } = props;
  const place = runnerAddPlace({
    administers: props.administers,
    roster,
    stepsDrawn: mint.mint === "Minted",
  });
  const add = (
    <AddRunner
      partition={partition}
      mint={mint}
      onMint={setMint}
      leading={place === "Empty"}
    />
  );
  return (
    <Panel
      variant="section"
      title="Runners"
      about="Machines that run this project's agents."
      {...(place === "Head" ? { meta: add } : {})}
    >
      {mint.mint === "Minted" ? (
        <RunnerSteps
          minted={mint.minted}
          onDone={() => {
            setMint({ mint: "Idle" });
            void client.invalidateQueries({
              queryKey: projectResourceKey(
                partition,
                "Project",
                workerPoolsResource,
              ),
            });
          }}
        />
      ) : null}
      {mint.mint === "Failed" ? (
        <Notice tone="danger" inline detail={`Refused · ${mint.reason}`} />
      ) : null}
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
  const placement = usePanelResource(
    partition,
    "Project",
    executionPlacementResource,
    (ports) => apiExecutionPlacement(ports, partition),
  );
  const pools = usePanelResource(
    partition,
    "Project",
    workerPoolsResource,
    (ports) => apiWorkerPools(ports, partition),
  );
  return (
    <div className="grid min-w-0 max-w-settings gap-4">
      <TopBarSlot>
        <h1 className="text-md font-strong text-ink-1 truncate">Runners</h1>
      </TopBarSlot>
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
