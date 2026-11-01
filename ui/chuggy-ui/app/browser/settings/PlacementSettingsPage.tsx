/**
 * The project's placement setting: where its work, evaluation, chat and lead
 * run, read and edited behind one Edit; and beside it, whether a member's own
 * runner takes the work they start here.
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
import type { QueryClient } from "@tanstack/react-query";
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
  apiWriteExecutionPlacement,
  apiWriteSessionPlacement,
} from "../../core/apiRoutes.ts";
import {
  ConsoleWriteProgress,
  consoleWriteAnswered,
  consoleWriteKey,
} from "../../core/consoleWrite.ts";
import type { ConsoleWrite } from "../../core/consoleWrite.ts";
import {
  executionPlacementQuery,
  sessionPlacementQuery,
} from "../../core/projectQueries.ts";
import type { ProjectQueryKeyOf } from "../../core/projectQueryKeys.ts";
import { settingsRoutes } from "../../core/settingsNav.ts";
import {
  runnerRouteLabel,
  runnerRouteSourceLabel,
  runnersPlacementDraft,
  runnersPlacementMoved,
  runnersPlacementOptions,
  runnersPlacementRefusal,
  runnersPlacementRoute,
  runnersPlacementUnhosted,
  runnersPlacementWrites,
  runnerStandingLabel,
} from "../../core/runners.ts";
import type {
  RunnersPlacementDraft,
  RunnersPlacementMoves,
  RunnersPlacementOption,
  RunnersPlacementWrites,
} from "../../core/runners.ts";
import { usePanelState } from "../api.ts";
import { useConsoleWrite, useConsoleWriteProgress } from "../consoleWrite.tsx";
import type { ConsoleWriting } from "../consoleWrite.tsx";
import { PanelUnready } from "../DataPanel.tsx";
import { useSessionPlacement } from "../sessionPlacement.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Panel } from "../ui/Panel.tsx";
import { RadioGroup } from "../ui/RadioGroup.tsx";
import { SettingsSection } from "../ui/SettingsSection.tsx";
import { Table } from "../ui/Table.tsx";
import { OwnerFallbackSection } from "./OwnerFallbackSection.tsx";
import { SettingsPage } from "./SettingsPage.tsx";

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
  readonly saving: ConsoleWriting<PlacementSave, unknown>;
}): ReactNode {
  const saving = props.saving;
  const step = useConsoleWriteProgress(saving.variables?.progress);
  if (saving.isPending) return <Notice tone="info" inline detail="Writing" />;
  if (saving.error !== null) {
    const failure = saving.error.failure;
    return (
      <>
        <PlacementLanded landed={step === "ExecutionWritten"} />
        <Notice
          tone={
            failure !== undefined && runnersPlacementUnhosted(failure)
              ? "parked"
              : "danger"
          }
          inline
          detail={saving.error.message}
        />
      </>
    );
  }
  if (saving.isSuccess) return <Notice tone="live" inline detail="Written" />;
  return null;
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

/** A save's step: work and evaluation written, so a refusal of the session
 * placement after it leaves that one standing. */
type PlacementSaveStep = "ExecutionWritten";

/** One press of Save: what it writes, and where it reports its step. */
interface PlacementSave {
  readonly writes: RunnersPlacementWrites;
  readonly progress: ConsoleWriteProgress<PlacementSaveStep>;
}

/** A written placement is the newest read of it, so a read still in flight,
 * which was asked before the write, is cancelled rather than let land over it. */
async function placementHeld<T>(
  client: QueryClient,
  key: ProjectQueryKeyOf<T>,
  placement: T,
): Promise<void> {
  await client.cancelQueries({ queryKey: key });
  client.setQueryData(key, placement);
}

/**
 * The doors the section writes through: work and evaluation, then a thread and
 * the lead once the first has landed, each only where the draft moved it. The
 * first is held as its newest read as soon as it lands, since it stands
 * whatever the second answers.
 */
function placementWrite(
  partition: PartitionIdentity,
): ConsoleWrite<PlacementSave, SessionPlacementResponse | undefined> {
  return {
    mutationKey: consoleWriteKey(
      "runners-placement",
      partition.tenant,
      partition.project,
    ),
    write: async (ports, { writes, progress }, client) => {
      if (writes.execution !== undefined) {
        const execution = consoleWriteAnswered(
          await apiWriteExecutionPlacement(ports, partition, writes.execution),
          runnersPlacementRefusal,
        );
        await placementHeld(
          client,
          executionPlacementQuery(partition).queryKey,
          execution,
        );
        progress.report("ExecutionWritten");
      }
      if (writes.session === undefined)
        return { outcome: "Ok", value: undefined };
      return apiWriteSessionPlacement(ports, partition, writes.session);
    },
    refusal: runnersPlacementRefusal,
    landed: async (client, session) => {
      if (session !== undefined)
        await placementHeld(
          client,
          sessionPlacementQuery(partition).queryKey,
          session,
        );
    },
  };
}

function PlacementSection(props: {
  readonly partition: PartitionIdentity;
  readonly execution: ExecutionPlacementResponse;
  readonly session: SessionPlacementResponse;
}): ReactNode {
  const saving = useConsoleWrite(placementWrite(props.partition));
  const shown = saving.isPending || saving.error !== null || saving.isSuccess;
  const [editing, setEditing] = useState(false);
  const [moves, setMoves] = useState<RunnersPlacementMoves>({});
  const read = runnersPlacementDraft(props.execution, props.session);
  const draft = runnersPlacementMoved(read, moves);
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
      savable={!saving.isPending}
      footLead={null}
      {...(shown ? { notice: <PlacementNotice saving={saving} /> } : {})}
      onEdit={() => {
        setMoves({});
        saving.reset();
        setEditing(true);
      }}
      onCancel={() => {
        setEditing(false);
      }}
      onSave={() => {
        const writes = runnersPlacementWrites(read, draft);
        if (writes.execution === undefined && writes.session === undefined)
          setEditing(false);
        else
          saving.mutate(
            { writes, progress: new ConsoleWriteProgress() },
            {
              onSuccess: () => {
                setEditing(false);
              },
            },
          );
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
  const placement = usePanelState(executionPlacementQuery(partition));
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
      <OwnerFallbackSection partition={partition} />
    </SettingsPage>
  );
}
