/**
 * The project's placement setting: where its work, evaluation, chat and lead
 * run, read and edited behind one Edit; and beside it, whether a member's own
 * runner takes the work they start here.
 *
 * A HOSTED ROUTE IS OFFERED ONLY WHERE THE API SAYS SO. The placement read
 * answers the routes this reader may choose, so the choice is drawn from that
 * list and never from the roster; a write the grant still refuses says so in
 * the section rather than retrying. The subsidized lead is offered where the
 * read says the deployment admits it.
 *
 * EVERY SESSION WRITE NAMES THE LEAD'S OFFERING as the draft holds it. One
 * naming none keeps the offering the project's row stores, which may be one
 * the deployment has withdrawn and the read no longer answers.
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
import { useCopyText } from "../../copy/CopyProvider.tsx";
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
import type { Copy, CopyText } from "../../core/copy.ts";
import {
  executionPlacementQuery,
  selectorSettingsQuery,
  sessionPlacementQuery,
} from "../../core/projectQueries.ts";
import type { ProjectQueryKeyOf } from "../../core/projectQueryKeys.ts";
import { settingsRoutes } from "../../core/settingsNav.ts";
import {
  runnerRouteSourceLabel,
  runnersLeadPlacementChoices,
  runnersPlacementDraft,
  runnersPlacementLabel,
  runnersPlacementMoved,
  runnersPlacementOptions,
  runnersPlacementRefusal,
  runnersPlacementUnhosted,
  runnersPlacementValue,
  runnersPlacementWrites,
  runnerStandingLabel,
  runnersSubsidizedLine,
} from "../../core/runners.ts";
import type {
  RunnersLeadPlacement,
  RunnersPlacementChoice,
  RunnersPlacementDraft,
  RunnersPlacementMoves,
  RunnersPlacementOption,
  RunnersPlacementWrites,
} from "../../core/runners.ts";
import { usePanelState } from "../api.ts";
import {
  ConsoleWriteRefusedWords,
  useConsoleWrite,
  useConsoleWriteProgress,
} from "../consoleWrite.tsx";
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
  readonly kind: keyof RunnersPlacementDraft;
  readonly resolved: ExecutionPlacementResponse["work"];
  /** What the kind is drawn as running on: its route, and the lead's offering. */
  readonly placed: RunnersPlacementChoice;
  readonly runners: SessionRunnerStanding | undefined;
}

function PlacementTable(props: {
  readonly execution: ExecutionPlacementResponse;
  readonly session: SessionPlacementResponse;
}): ReactNode {
  const text = useCopyText();
  const { execution, session } = props;
  const rows: readonly PlacementRow[] = [
    {
      kind: "work",
      resolved: execution.work,
      placed: execution.work.route,
      runners: undefined,
    },
    {
      kind: "evaluation",
      resolved: execution.evaluation,
      placed: execution.evaluation.route,
      runners: undefined,
    },
    {
      kind: "thread",
      resolved: session.thread,
      placed: session.thread.route,
      runners: session.runners.mine,
    },
    {
      kind: "lead",
      resolved: session.lead,
      placed: { route: session.lead.route, offering: session.leadOffering },
      runners: session.runners.project,
    },
  ];
  return (
    <Table caption={text({ id: "runners-placement-title" })}>
      <thead>
        <tr>
          <th scope="col">{text({ id: "runners-placement-col-kind" })}</th>
          <th scope="col">{text({ id: "runners-placement-col-runs-on" })}</th>
          <th scope="col">{text({ id: "runners-placement-col-set-by" })}</th>
          <th scope="col">{text({ id: "runners-placement-col-runner" })}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.kind}>
            <th scope="row">{text(placementKindLabels[row.kind])}</th>
            <td>{text(runnersPlacementLabel(row.placed))}</td>
            <td>{text(runnerRouteSourceLabel(row.resolved.source))}</td>
            <td>
              {row.runners === undefined || row.resolved.route !== "Pool"
                ? null
                : text(runnerStandingLabel(row.runners))}
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function PlacementChoice<T extends RunnersPlacementChoice>(props: {
  readonly label: string;
  readonly value: T;
  readonly options: readonly RunnersPlacementOption<T>[];
  readonly about?: (choice: T) => string | undefined;
  readonly onChoose: (choice: T) => void;
}): ReactNode {
  const text = useCopyText();
  return (
    <div className="grid gap-1">
      <span className="text-sm text-ink-3">{props.label}</span>
      <RadioGroup
        label={props.label}
        value={runnersPlacementValue(props.value)}
        options={props.options.map((option) => {
          const about = props.about?.(option.choice);
          return {
            value: runnersPlacementValue(option.choice),
            text: text(runnersPlacementLabel(option.choice)),
            ...(about === undefined ? {} : { description: about }),
            disabled: !option.choosable,
          };
        })}
        onChoose={(value) => {
          const chosen = props.options.find(
            (option) => runnersPlacementValue(option.choice) === value,
          );
          if (chosen?.choosable === true) props.onChoose(chosen.choice);
        }}
      />
    </div>
  );
}

function PlacementNotice(props: {
  readonly saving: ConsoleWriting<PlacementSave, unknown>;
}): ReactNode {
  const text = useCopyText();
  const saving = props.saving;
  const step = useConsoleWriteProgress(saving.variables?.progress);
  if (saving.isPending)
    return (
      <Notice tone="info" inline detail={text({ id: "runners-writing" })} />
    );
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
        >
          <ConsoleWriteRefusedWords refused={saving.error} />
        </Notice>
      </>
    );
  }
  if (saving.isSuccess)
    return (
      <Notice tone="live" inline detail={text({ id: "runners-written" })} />
    );
  return null;
}

/** The placement a save wrote before the one refused, which stands. */
function PlacementLanded(props: { readonly landed: boolean }): ReactNode {
  const text = useCopyText();
  return props.landed ? (
    <Notice
      tone="live"
      inline
      detail={text({ id: "runners-placement-landed" })}
    />
  ) : null;
}

/** The label each of the draft's kinds is drawn under. */
const placementKindLabels: Readonly<Record<keyof RunnersPlacementDraft, Copy>> =
  {
    work: { id: "runners-placement-work" },
    evaluation: { id: "runners-placement-evaluation" },
    thread: { id: "runners-placement-chat" },
    lead: { id: "runners-placement-lead" },
  };

/** The route kinds in the order the table draws them, each with which
 * placement's choices it is chosen from; the lead is drawn after them. */
const placementEditorKinds = [
  ["work", "execution"],
  ["evaluation", "execution"],
  ["thread", "session"],
] as const;

/** The subsidized lead's line, naming the model the effective settings say it
 * runs, read only while it is offered. */
function usePlacementSubsidizedLine(
  partition: PartitionIdentity,
  offered: boolean,
): string {
  const text = useCopyText();
  const settings = usePanelState({
    ...selectorSettingsQuery(partition),
    enabled: offered,
  });
  return text(
    runnersSubsidizedLine(
      settings.state === "Ready" ? settings.value.effective : undefined,
    ),
  );
}

function PlacementEditor(props: {
  readonly partition: PartitionIdentity;
  readonly read: RunnersPlacementDraft;
  readonly draft: RunnersPlacementDraft;
  readonly choices: {
    readonly execution: readonly PlacementRoute[];
    readonly session: readonly PlacementRoute[];
  };
  readonly leadChoices: readonly RunnersLeadPlacement[];
  readonly onMove: (moves: RunnersPlacementMoves) => void;
}): ReactNode {
  const text = useCopyText();
  const subsidized = usePlacementSubsidizedLine(
    props.partition,
    props.leadChoices.some((choice) => choice.offering === "Subsidized"),
  );
  return (
    <div className="grid gap-3">
      {placementEditorKinds.map(([kind, placement]) => (
        <PlacementChoice
          key={kind}
          label={text(placementKindLabels[kind])}
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
      <PlacementChoice
        label={text(placementKindLabels.lead)}
        value={props.draft.lead}
        options={runnersPlacementOptions(props.read.lead, props.leadChoices)}
        about={(choice) =>
          choice.offering === "Subsidized" ? subsidized : undefined
        }
        onChoose={(lead) => {
          props.onMove({ lead });
        }}
      />
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
  text: CopyText,
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
          text,
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
  const text = useCopyText();
  const saving = useConsoleWrite(placementWrite(props.partition, text), {
    drawn: true,
  });
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
      title={text({ id: "runners-placement-title" })}
      about={text({ id: "runners-placement-about" })}
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
          partition={props.partition}
          read={read}
          draft={draft}
          choices={choices}
          leadChoices={runnersLeadPlacementChoices(props.session)}
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
  const text = useCopyText();
  const title = text({ id: "runners-placement-title" });
  const params = useParams({ from: settingsRoutes.project.placement });
  const partition: PartitionIdentity = {
    tenant: params.tenant,
    project: params.project,
  };
  const placement = usePanelState(executionPlacementQuery(partition));
  const sessions = useSessionPlacement(partition);
  return (
    <SettingsPage title={title}>
      {placement.state === "Ready" && sessions.state === "Ready" ? (
        <PlacementSection
          partition={partition}
          execution={placement.value}
          session={sessions.value}
        />
      ) : (
        <Panel variant="section" title={title}>
          <PanelUnready
            state={placement.state === "Ready" ? sessions : placement}
          />
        </Panel>
      )}
      <OwnerFallbackSection partition={partition} />
    </SettingsPage>
  );
}
