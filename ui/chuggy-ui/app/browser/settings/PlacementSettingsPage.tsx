/**
 * The project's placement setting: where its work, evaluation, chat and lead
 * run, read and edited behind one Edit.
 *
 * A HOSTED ROUTE IS OFFERED ONLY WHERE THE API SAYS SO. The placement read
 * answers the routes this reader may choose, so the choice is drawn from that
 * list and never from the roster; a write the grant still refuses says so in
 * the section rather than retrying.
 *
 * WHAT THE READER DID NOT MOVE IS WRITTEN AS LAST READ. A route they may not
 * choose is drawn as it stands rather than moved to one they may, and a save
 * writes only a placement one of whose kinds they moved, its other kind at the
 * newest read, so only a move made since that read is lost, until a write
 * carries the value it expects.
 */

import { useParams } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type {
  ExecutionPlacementResponse,
  SessionPlacementResponse,
} from "../../../../../src/contract/responses.ts";
import type {
  PlacementRoute,
  SessionRunnerStanding,
} from "../../../../../src/contract/rosters.ts";
import {
  apiExecutionPlacement,
  apiWriteExecutionPlacement,
  apiWriteSessionPlacement,
} from "../../core/apiRoutes.ts";
import { projectResourceKey } from "../../core/projectQueryKeys.ts";
import { settingsRoutes } from "../../core/settingsNav.ts";
import {
  runnerRouteLabel,
  runnerRouteSourceLabel,
  runnersPlacementAnswered,
  runnersPlacementDraft,
  runnersPlacementMoved,
  runnersPlacementOptions,
  runnersPlacementRoute,
  runnersPlacementWrites,
  runnerStandingLabel,
} from "../../core/runners.ts";
import type {
  RunnersPlacementDraft,
  RunnersPlacementMoves,
  RunnersPlacementOption,
  RunnersPlacementSaved,
  RunnersPlacementWrites,
} from "../../core/runners.ts";
import { useApiPorts, usePanelResource } from "../api.ts";
import { PanelUnready } from "../DataPanel.tsx";
import {
  sessionPlacementResource,
  useSessionPlacement,
} from "../sessionPlacement.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Panel } from "../ui/Panel.tsx";
import { RadioGroup } from "../ui/RadioGroup.tsx";
import { SettingsSection } from "../ui/SettingsSection.tsx";
import { Table } from "../ui/Table.tsx";
import { SettingsPage } from "./SettingsPage.tsx";

/** No frame names this read, so the partition's own refetch is what reaches it. */
const executionPlacementResource = "execution-placement";

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
  readonly options: readonly RunnersPlacementOption[];
  readonly onChoose: (route: PlacementRoute) => void;
}): ReactNode {
  return (
    <div className="grid gap-1">
      <span className="text-sm text-ink-3">{props.label}</span>
      <RadioGroup
        label={props.label}
        value={props.value}
        options={props.options.map((option) => ({
          value: option.route,
          text: runnerRouteLabel(option.route),
          disabled: !option.choosable,
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
      return (
        <>
          <PlacementLanded landed={saved.landed} />
          <Notice tone="parked" inline detail="Needs hosted runs" />
        </>
      );
    case "Failed":
      return (
        <>
          <PlacementLanded landed={saved.landed} />
          <Notice tone="danger" inline detail={`Failed · ${saved.reason}`} />
        </>
      );
  }
}

/** The placement a save wrote before the one refused, which stands. */
function PlacementLanded(props: { readonly landed: boolean }): ReactNode {
  return props.landed ? (
    <Notice tone="live" inline detail="Work and evaluation saved" />
  ) : null;
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
  readonly read: RunnersPlacementDraft;
  readonly draft: RunnersPlacementDraft;
  readonly choices: {
    readonly execution: readonly PlacementRoute[];
    readonly session: readonly PlacementRoute[];
  };
  readonly onMove: (moves: RunnersPlacementMoves) => void;
}): ReactNode {
  return (
    <div className="grid gap-3">
      {placementEditorKinds.map(([kind, label, placement]) => (
        <PlacementChoice
          key={kind}
          label={label}
          value={props.draft[kind]}
          options={runnersPlacementOptions(
            props.read[kind],
            props.choices[placement],
          )}
          onChoose={(route) => {
            props.onMove({ [kind]: route });
          }}
        />
      ))}
    </div>
  );
}

interface PlacementWriting {
  readonly saved: RunnersPlacementSaved;
  readonly reset: () => void;
  readonly write: (writes: RunnersPlacementWrites, wrote: () => void) => void;
}

/**
 * The doors the section writes through: work and evaluation, then a thread and
 * the lead once the first has landed, each only where the draft moved it. A
 * write that landed is the newest read of its placement, so the page holds it.
 */
function usePlacementWriting(partition: PartitionIdentity): PlacementWriting {
  const ports = useApiPorts();
  const client = useQueryClient();
  const [saved, setSaved] = useState<RunnersPlacementSaved>({ saved: "Idle" });
  /** A read still in flight was asked before the write, so it is cancelled
   * rather than let land over it. */
  const held = async (resource: string, placement: unknown): Promise<void> => {
    const key = projectResourceKey(partition, "Project", resource);
    await client.cancelQueries({ queryKey: key });
    client.setQueryData(key, placement);
  };
  const written = async (writes: RunnersPlacementWrites): Promise<boolean> => {
    let landed = false;
    if (writes.execution !== undefined) {
      const execution = runnersPlacementAnswered(
        await apiWriteExecutionPlacement(ports, partition, writes.execution),
      );
      if (execution.saved !== "Written") {
        setSaved({ ...execution, landed });
        return false;
      }
      await held(executionPlacementResource, execution.placement);
      landed = true;
    }
    if (writes.session !== undefined) {
      const session = runnersPlacementAnswered(
        await apiWriteSessionPlacement(ports, partition, writes.session),
      );
      if (session.saved !== "Written") {
        setSaved({ ...session, landed });
        return false;
      }
      await held(sessionPlacementResource, session.placement);
    }
    return true;
  };
  return {
    saved,
    reset: () => {
      setSaved({ saved: "Idle" });
    },
    write: (writes, wrote) => {
      if (writes.execution === undefined && writes.session === undefined) {
        wrote();
        return;
      }
      setSaved({ saved: "Writing" });
      void written(writes).then((landed) => {
        if (!landed) return;
        setSaved({ saved: "Written" });
        wrote();
      });
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
  const [moves, setMoves] = useState<RunnersPlacementMoves>({});
  const read = runnersPlacementDraft(props.execution, props.session);
  const draft = runnersPlacementMoved(read, moves);
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
      savable={saved.saved !== "Writing"}
      footLead={null}
      {...(saved.saved === "Idle"
        ? {}
        : { notice: <PlacementNotice saved={saved} /> })}
      onEdit={() => {
        setMoves({});
        writing.reset();
        setEditing(true);
      }}
      onCancel={() => {
        setEditing(false);
      }}
      onSave={() => {
        writing.write(runnersPlacementWrites(read, draft), () => {
          setEditing(false);
        });
      }}
    >
      {editing ? (
        <PlacementEditor
          read={read}
          draft={draft}
          choices={choices}
          onMove={(moved) => {
            setMoves({ ...moves, ...moved });
          }}
        />
      ) : (
        <PlacementTable execution={props.execution} session={props.session} />
      )}
    </SettingsSection>
  );
}

export function PlacementSettingsPage(): ReactNode {
  const params = useParams({ from: settingsRoutes.project.placement });
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
  return (
    <SettingsPage title="Placement">
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
    </SettingsPage>
  );
}
