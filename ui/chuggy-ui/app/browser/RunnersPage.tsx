/**
 * The project's runners: where its work and sessions run, the machines
 * registered to run them, and the command that adds one.
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
  SessionPlacementResponse,
  WorkerPoolsResponse,
  WorkerPoolTokenResponse,
} from "../../../../src/contract/responses.ts";
import type {
  PlacementRoute,
  SessionRunnerStanding,
} from "../../../../src/contract/rosters.ts";
import {
  apiExecutionPlacement,
  apiMintWorkerPoolToken,
  apiWorkerPools,
  apiWriteExecutionPlacement,
  apiWriteSessionPlacement,
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
  runnerStandingLabel,
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
import {
  sessionPlacementResource,
  useSessionPlacement,
} from "./sessionPlacement.tsx";
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

/** One kind's row: where it runs, what decided it, and, for a session on
 * runners, whether the runners it would run on are there. */
interface PlacementRow {
  readonly kind: string;
  readonly resolved: ExecutionPlacementResponse["work"];
  readonly runners: SessionRunnerStanding | undefined;
}

function PlacementTable(props: {
  readonly execution: ExecutionPlacementResponse;
  readonly session: SessionPlacementResponse;
}): ReactNode {
  const { execution, session } = props;
  const rows: readonly PlacementRow[] = [
    { kind: "Work", resolved: execution.work, runners: undefined },
    { kind: "Evaluation", resolved: execution.evaluation, runners: undefined },
    { kind: "Chat", resolved: session.thread, runners: session.runners.mine },
    { kind: "Lead", resolved: session.lead, runners: session.runners.project },
  ];
  return (
    <Table caption="Placement">
      <thead>
        <tr>
          <th scope="col">Kind</th>
          <th scope="col">Runs on</th>
          <th scope="col">Set by</th>
          <th scope="col">Runner</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.kind}>
            <th scope="row">{row.kind}</th>
            <td>{runnerRouteLabel(row.resolved.route)}</td>
            <td>{runnerRouteSourceLabel(row.resolved.source)}</td>
            <td>
              {row.runners === undefined || row.resolved.route !== "Pool"
                ? null
                : runnerStandingLabel(row.runners)}
            </td>
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

/** The draft's kinds in the order the table draws them, each with the label
 * it is drawn under and which placement's choices it is chosen from. */
const placementEditorKinds = [
  ["work", "Work", "execution"],
  ["evaluation", "Evaluation", "execution"],
  ["thread", "Chat", "session"],
  ["lead", "Lead", "session"],
] as const;

function PlacementEditor(props: {
  readonly draft: RunnersPlacementDraft;
  readonly choices: {
    readonly execution: readonly PlacementRoute[];
    readonly session: readonly PlacementRoute[];
  };
  readonly onDraft: (draft: RunnersPlacementDraft) => void;
}): ReactNode {
  return (
    <div className="grid gap-3">
      {placementEditorKinds.map(([kind, label, placement]) => (
        <PlacementChoice
          key={kind}
          label={label}
          value={props.draft[kind]}
          choices={props.choices[placement]}
          onChoose={(route) => {
            props.onDraft({ ...props.draft, [kind]: route });
          }}
        />
      ))}
    </div>
  );
}

interface PlacementWriting {
  readonly saved: RunnersPlacementSaved;
  readonly reset: () => void;
  readonly write: (draft: RunnersPlacementDraft, wrote: () => void) => void;
}

/**
 * The doors the section writes through: work and evaluation, then a thread and
 * the lead once the first has landed, each whole and answering a repeat the
 * same, so a save the second refused is saved again whole. A write that landed
 * is the newest read of its placement, so the page holds it.
 */
function usePlacementWriting(partition: PartitionIdentity): PlacementWriting {
  const ports = useApiPorts();
  const client = useQueryClient();
  const [saved, setSaved] = useState<RunnersPlacementSaved>({ saved: "Idle" });
  const held = (resource: string, placement: unknown): void => {
    client.setQueryData(
      projectResourceKey(partition, "Project", resource),
      placement,
    );
  };
  return {
    saved,
    reset: () => {
      setSaved({ saved: "Idle" });
    },
    write: (draft, wrote) => {
      setSaved({ saved: "Writing" });
      void (async () => {
        const execution = runnersPlacementAnswered(
          await apiWriteExecutionPlacement(ports, partition, {
            work: draft.work,
            evaluation: draft.evaluation,
          }),
        );
        if (execution.saved !== "Written") {
          setSaved(execution);
          return;
        }
        held(executionPlacementResource, execution.placement);
        const session = runnersPlacementAnswered(
          await apiWriteSessionPlacement(ports, partition, {
            thread: draft.thread,
            lead: draft.lead,
          }),
        );
        if (session.saved !== "Written") {
          setSaved(session);
          return;
        }
        held(sessionPlacementResource, session.placement);
        setSaved({ saved: "Written" });
        wrote();
      })();
    },
  };
}

function PlacementSection(props: {
  readonly partition: PartitionIdentity;
  readonly execution: ExecutionPlacementResponse;
  readonly session: SessionPlacementResponse;
}): ReactNode {
  const writing = usePlacementWriting(props.partition);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<RunnersPlacementDraft>(() =>
    runnersPlacementDraft(props.execution, props.session),
  );
  const saved = writing.saved;
  const choices = {
    execution: props.execution.choices,
    session: props.session.choices,
  };
  return (
    <SettingsSection
      title="Placement"
      about="Where this project's agents run."
      editing={editing}
      editable={choices.execution.length > 0 && choices.session.length > 0}
      savable={
        runnersPlacementSavable(draft, choices.execution, choices.session) &&
        saved.saved !== "Writing"
      }
      footLead={null}
      {...(saved.saved === "Idle"
        ? {}
        : { notice: <PlacementNotice saved={saved} /> })}
      onEdit={() => {
        setDraft(runnersPlacementDraft(props.execution, props.session));
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
        <PlacementTable execution={props.execution} session={props.session} />
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
      about="Machines that run this project's agents."
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
  const sessions = useSessionPlacement(partition);
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
      {placement.state === "Ready" && sessions.state === "Ready" ? (
        <PlacementSection
          partition={partition}
          execution={placement.value}
          session={sessions.value}
        />
      ) : (
        <Panel variant="section" title="Placement">
          <PanelUnready
            state={placement.state === "Ready" ? sessions : placement}
          />
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
