/**
 * The project's runners: where its work runs, the machines registered to run
 * it, and the command that adds one.
 *
 * A HOSTED ROUTE IS OFFERED ONLY WHERE THE API SAYS SO. The placement read
 * answers the routes this reader may choose, so the choice is drawn from that
 * list and never from the roster; a write the grant still refuses says so in
 * the section rather than retrying.
 */

import { useParams } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  ExecutionPlacementResponse,
  WorkerPoolsResponse,
  WorkerPoolTokenResponse,
} from "../../../../src/contract/responses.ts";
import type { PlacementRoute } from "../../../../src/contract/rosters.ts";
import {
  apiExecutionPlacement,
  apiMintWorkerPoolToken,
  apiWorkerPools,
  apiWriteExecutionPlacement,
} from "../core/apiRoutes.ts";
import { instantFigure } from "../core/figures.ts";
import { panelReason } from "../core/freshness.ts";
import { projectResourceKey } from "../core/projectQueryKeys.ts";
import {
  runnerCapabilityLabel,
  runnerPlatforms,
  runnerRegisterCommand,
  runnerRouteLabel,
  runnerRouteSourceLabel,
  runnersPlacementAnswered,
  runnersPlacementDraft,
  runnersPlacementRoute,
  runnersPlacementSavable,
  runnerTokenLifetimeSecs,
} from "../core/runners.ts";
import type {
  RunnersPlacementDraft,
  RunnersPlacementSaved,
} from "../core/runners.ts";
import { useApiPorts, usePanelResource } from "./api.ts";
import { PanelUnready } from "./DataPanel.tsx";
import { useNowMs } from "./Freshness.tsx";
import { clipboardWritten, currentOrigin } from "./ports.ts";
import { TopBarSlot } from "./shell/slots.tsx";
import { Button } from "./ui/Button.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { Figure } from "./ui/Figure.tsx";
import { Notice } from "./ui/Notice.tsx";
import { Panel } from "./ui/Panel.tsx";
import { RadioGroup } from "./ui/RadioGroup.tsx";
import { SettingsSection } from "./ui/SettingsSection.tsx";
import { Table } from "./ui/Table.tsx";

/** No frame names these reads, so the partition's own refetch is what reaches them. */
const executionPlacementResource = "execution-placement";
const workerPoolsResource = "worker-pools";

/** This page's own address, which its reads are from. */
export const runnersRoutePath = "/$tenant/$project/runners";

function PlacementTable(props: {
  readonly placement: ExecutionPlacementResponse;
}): ReactNode {
  const rows = [
    ["Work", props.placement.work],
    ["Evaluation", props.placement.evaluation],
  ] as const;
  return (
    <Table caption="Placement">
      <thead>
        <tr>
          <th scope="col">Kind</th>
          <th scope="col">Runs on</th>
          <th scope="col">Set by</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([kind, resolved]) => (
          <tr key={kind}>
            <th scope="row">{kind}</th>
            <td>{runnerRouteLabel(resolved.route)}</td>
            <td>{runnerRouteSourceLabel(resolved.source)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function PlacementChoice(props: {
  readonly label: string;
  readonly value: PlacementRoute;
  readonly choices: readonly PlacementRoute[];
  readonly onChoose: (route: PlacementRoute) => void;
}): ReactNode {
  return (
    <div className="grid gap-1">
      <span className="text-sm text-ink-3">{props.label}</span>
      <RadioGroup
        label={props.label}
        value={props.value}
        options={props.choices.map((route) => ({
          value: route,
          text: runnerRouteLabel(route),
        }))}
        onChoose={(value) => {
          const route = runnersPlacementRoute(value);
          if (route !== undefined) props.onChoose(route);
        }}
      />
    </div>
  );
}

function PlacementNotice(props: {
  readonly saved: RunnersPlacementSaved;
}): ReactNode {
  const saved = props.saved;
  switch (saved.saved) {
    case "Idle":
      return null;
    case "Writing":
      return <Notice tone="info" inline detail="Writing" />;
    case "Written":
      return <Notice tone="live" inline detail="Written" />;
    case "Unhosted":
      return <Notice tone="parked" inline detail="Needs hosted runs" />;
    case "Failed":
      return (
        <Notice tone="danger" inline detail={`Failed · ${saved.reason}`} />
      );
  }
}

function PlacementEditor(props: {
  readonly draft: RunnersPlacementDraft;
  readonly choices: readonly PlacementRoute[];
  readonly onDraft: (draft: RunnersPlacementDraft) => void;
}): ReactNode {
  return (
    <div className="grid gap-3">
      <PlacementChoice
        label="Work"
        value={props.draft.work}
        choices={props.choices}
        onChoose={(work) => {
          props.onDraft({ ...props.draft, work });
        }}
      />
      <PlacementChoice
        label="Evaluation"
        value={props.draft.evaluation}
        choices={props.choices}
        onChoose={(evaluation) => {
          props.onDraft({ ...props.draft, evaluation });
        }}
      />
    </div>
  );
}

interface PlacementWriting {
  readonly saved: RunnersPlacementSaved;
  readonly reset: () => void;
  readonly write: (draft: RunnersPlacementDraft, wrote: () => void) => void;
}

/** The one door the section writes through. A write that landed is the newest
 * read of the placement, so the page holds it rather than waiting on a refetch. */
function usePlacementWriting(partition: PartitionIdentity): PlacementWriting {
  const ports = useApiPorts();
  const client = useQueryClient();
  const [saved, setSaved] = useState<RunnersPlacementSaved>({ saved: "Idle" });
  return {
    saved,
    reset: () => {
      setSaved({ saved: "Idle" });
    },
    write: (draft, wrote) => {
      setSaved({ saved: "Writing" });
      void (async () => {
        const answered = runnersPlacementAnswered(
          await apiWriteExecutionPlacement(ports, partition, draft),
        );
        setSaved(answered);
        if (answered.saved !== "Written") return;
        client.setQueryData(
          projectResourceKey(partition, "Project", executionPlacementResource),
          answered.placement,
        );
        wrote();
      })();
    },
  };
}

function PlacementSection(props: {
  readonly partition: PartitionIdentity;
  readonly placement: ExecutionPlacementResponse;
}): ReactNode {
  const writing = usePlacementWriting(props.partition);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<RunnersPlacementDraft>(() =>
    runnersPlacementDraft(props.placement),
  );
  const saved = writing.saved;
  const choices = props.placement.choices;
  return (
    <SettingsSection
      title="Placement"
      about="Where this project's tickets run."
      editing={editing}
      editable={choices.length > 0}
      savable={
        runnersPlacementSavable(draft, choices) && saved.saved !== "Writing"
      }
      footLead={null}
      {...(saved.saved === "Idle"
        ? {}
        : { notice: <PlacementNotice saved={saved} /> })}
      onEdit={() => {
        setDraft(runnersPlacementDraft(props.placement));
        writing.reset();
        setEditing(true);
      }}
      onCancel={() => {
        setEditing(false);
      }}
      onSave={() => {
        writing.write(draft, () => {
          setEditing(false);
        });
      }}
    >
      {editing ? (
        <PlacementEditor draft={draft} choices={choices} onDraft={setDraft} />
      ) : (
        <PlacementTable placement={props.placement} />
      )}
    </SettingsSection>
  );
}

function PoolTable(props: { readonly listed: WorkerPoolsResponse }): ReactNode {
  const nowMs = useNowMs();
  if (props.listed.pools.length === 0)
    return <EmptyState label="No runner registered" />;
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

/** The command a minted token is handed over in, copied whole by one press. */
function RunnerCommand(props: {
  readonly minted: WorkerPoolTokenResponse;
  readonly onDone: () => void;
}): ReactNode {
  const nowMs = useNowMs();
  const [copied, setCopied] = useState<boolean | undefined>(undefined);
  const command = runnerRegisterCommand(currentOrigin(), props.minted.token);
  return (
    <div className="grid gap-2">
      <span className="text-sm text-ink-3">Run on the machine</span>
      <code
        aria-label="Command"
        className="bg-surface-2 rounded-2 px-2 py-1 font-mono text-sm text-ink-1 break-all"
      >
        {command}
      </code>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            void clipboardWritten(command).then(setCopied);
          }}
        >
          {copied === true ? "Copied" : "Copy"}
        </Button>
        <Button variant="quiet" size="sm" onClick={props.onDone}>
          Done
        </Button>
        <span className="text-sm text-ink-3">
          Expires{" "}
          <Figure
            figure={instantFigure(
              new Date(props.minted.expiresAtMs).toISOString(),
              nowMs,
            )}
          />
        </span>
        {copied === false ? (
          <Notice tone="parked" inline detail="Copy blocked" />
        ) : null}
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
}): ReactNode {
  const ports = useApiPorts();
  return (
    <Button
      size="sm"
      busy={props.mint.mint === "Minting"}
      disabled={props.mint.mint === "Minting"}
      onClick={() => {
        props.onMint({ mint: "Minting" });
        void (async () => {
          const minted = await apiMintWorkerPoolToken(ports, props.partition, {
            capabilities: [...runnerPlatforms],
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
  readonly listed: WorkerPoolsResponse | undefined;
  readonly unready: ReactNode;
  /** Whether the reader administers the project, which minting needs. */
  readonly administers: boolean;
}): ReactNode {
  const client = useQueryClient();
  const [mint, setMint] = useState<RunnerMint>({ mint: "Idle" });
  return (
    <Panel
      variant="section"
      title="Runners"
      about="Machines that run this project's tickets."
      {...(props.administers
        ? {
            meta: (
              <AddRunner
                partition={props.partition}
                mint={mint}
                onMint={setMint}
              />
            ),
          }
        : {})}
    >
      {mint.mint === "Minted" ? (
        <RunnerCommand
          minted={mint.minted}
          onDone={() => {
            setMint({ mint: "Idle" });
            void client.invalidateQueries({
              queryKey: projectResourceKey(
                props.partition,
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
      {props.unready}
      {props.listed === undefined ? null : <PoolTable listed={props.listed} />}
      {props.listed?.truncated === true ? (
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
      {placement.state === "Ready" ? (
        <PlacementSection partition={partition} placement={placement.value} />
      ) : (
        <Panel variant="section" title="Placement">
          <PanelUnready state={placement} />
        </Panel>
      )}
      <RunnersSection
        partition={partition}
        listed={pools.state === "Ready" ? pools.value : undefined}
        unready={<PanelUnready state={pools} />}
        administers={
          placement.state === "Ready" && placement.value.choices.length > 0
        }
      />
    </div>
  );
}
