/**
 * The escalation inbox: every ticket that needs a human, newest activity first,
 * each answerable where it stands.
 *
 * The server answers the inbox whole, one entry per ticket, and the shell badge
 * and this panel both take that one read through `useInboxRows`, so the count
 * and the rows are one value. What a row ran is the latest execution its entry
 * carries, whatever put the ticket here. What a row offers is the core's
 * decision and what happens after the click is `followOperation`'s, both shared
 * with the ticket page, because a second account of what the machine accepts
 * is a second account that drifts.
 *
 * ANSWERING NEVER TOUCHES THE ROWS. The follow reports its steps into the row it
 * came from and writes into no entry; the row leaves when the inbox, read again
 * on a frame or a poll, no longer holds it. That is the only account of where a
 * ticket is that a reader can trust. `ui/chuggy-ui/test/inbox.test.tsx`,
 * `ui/chuggy-ui/test/inboxApproval.test.tsx` and
 * `ui/chuggy-ui/test/inboxProposals.test.tsx` hold that.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  InboxEntryResponse,
  RunnerLoss,
  RunStepFailure,
} from "../../../../src/contract/responses.ts";
import { apiInbox } from "../core/apiRoutes.ts";
import { inboxQuery } from "../core/ticketQueries.ts";
import { base64urlFromBytes } from "../core/base64url.ts";
import {
  escalationKindSentence,
  nativeActionKindSentence,
  operationFailureSentence,
} from "../core/codeSentences.ts";
import {
  phaseLabel,
  runnerLossDetail,
  runnerLossLine,
  runStepLabel,
} from "../core/codeLabels.ts";
import type { PanelState } from "../core/freshness.ts";
import {
  ConsoleWriteProgress,
  ConsoleWriteRefused,
  consoleWriteKey,
} from "../core/consoleWrite.ts";
import type { ConsoleWrite } from "../core/consoleWrite.ts";
import {
  inboxAnswerInFlight,
  inboxAnswerRefusal,
  inboxStepSentence,
} from "../core/inboxAnswers.ts";
import type { InboxAnswer } from "../core/inboxAnswers.ts";
import {
  inboxEntryPhased,
  inboxPage,
  inboxRowsAfterPage,
  inboxRowsHaveMore,
  inboxSection,
} from "../core/inboxList.ts";
import type { InboxRows } from "../core/inboxList.ts";
import { nativeActionsAnswers } from "../core/nativeActionAnswers.ts";
import { projectAbilityRefused } from "../core/projectAbilities.ts";
import {
  operationIdBytesCount,
  operationSubmitting,
} from "../core/operationFollow.ts";
import type { OperationStep } from "../core/operationFollow.ts";
import { followOperationProgressed } from "../core/operationProgress.ts";
import { projectTableRow } from "../core/projectTableRows.ts";
import type { ProjectTableRow } from "../core/projectTableRows.ts";
import { actionsFor, ticketActionSentence } from "../core/ticketActions.ts";
import type { TicketAction } from "../core/ticketActions.ts";
import { ticketSectionTitles } from "../core/ticketSections.ts";
import { agenticRefusalStandingTone } from "../core/tones.ts";
import { panelReadRestarted, useApiPorts, usePanelState } from "./api.ts";
import { useConsoleWrite, useConsoleWriteProgress } from "./consoleWrite.tsx";
import { DataPanel } from "./DataPanel.tsx";
import { useNowMs } from "./Freshness.tsx";
import {
  InboxProposalActions,
  InboxProposalNotice,
  InboxProposalWhy,
  useInboxProposalAnswers,
} from "./InboxProposals.tsx";
import type { InboxProposalAnswers } from "./InboxProposals.tsx";
import { drawBytes } from "./ports.ts";
import { useProjectAbilities } from "./projectAbilities.tsx";
import { ScreenTitle } from "./shell/slots.tsx";
import {
  TicketRevokeConfirm,
  useTicketRevokeAsk,
} from "./ticket/TicketRevoke.tsx";
import {
  TicketActivityCell,
  cellAbsent,
  TicketRowExecutionCell,
  TicketTitleCell,
} from "./TicketCells.tsx";
import { RepositoryImportRefusedNotice } from "./repositories/RepositoryImportRefused.tsx";
import { Button } from "./ui/Button.tsx";
import { useRunReason } from "./RunEvidence.tsx";
import { Pill } from "./ui/Pill.tsx";
import { Table } from "./ui/Table.tsx";
import { Tooltip } from "./ui/Tooltip.tsx";

export interface InboxRowsHeld {
  readonly panel: PanelState<InboxRows>;
  readonly rows: InboxRows | undefined;
  readonly readMore: (() => void) | undefined;
  readonly reading: boolean;
}

/**
 * The inbox, read under its one key and polled for the held decisions no frame
 * names. The badge and the panel take the same value through this, which is
 * what makes the header's claim above true rather than merely intended.
 */
export function useInboxRows(partition: PartitionIdentity): InboxRowsHeld {
  const query = inboxQuery(partition);
  const key = query.queryKey;
  const client = useQueryClient();
  const ports = useApiPorts();
  const [reading, setReading] = useState(false);
  const panel = usePanelState(query);
  const rows = panel.state === "Ready" ? panel.value : undefined;
  const readMore = () => {
    setReading(true);
    void (async () => {
      const answered = await apiInbox(
        ports,
        partition,
        inboxPage(rows?.nextCursor),
      );
      client.setQueryData(key, (previous) =>
        previous === undefined
          ? previous
          : inboxRowsAfterPage(previous, answered),
      );
      panelReadRestarted(client, key);
      setReading(false);
    })();
  };
  return {
    panel,
    rows,
    readMore:
      rows === undefined || !inboxRowsHaveMore(rows) || reading
        ? undefined
        : readMore,
    reading,
  };
}

/** An open action's admitted answers, and the phase's own where none is open. */
function inboxEntryActions(entry: InboxEntryResponse): readonly TicketAction[] {
  if (entry.actions.length > 0) return nativeActionsAnswers(entry.actions);
  const phased = inboxEntryPhased(entry);
  return phased === undefined ? [] : actionsFor(phased);
}

/** The answers a row offers, Revoke asking under them before it submits. */
function InboxActions(props: {
  readonly partition: PartitionIdentity;
  readonly entry: InboxEntryResponse;
  readonly answer: InboxAnswer | undefined;
  readonly onAnswer: (action: TicketAction) => void;
}): ReactNode {
  const actions = inboxEntryActions(props.entry);
  const revoke = useTicketRevokeAsk(props.answer);
  const abilities = useProjectAbilities(props.partition);
  const revoking = actions.find((action) => action.action === "Revoke");
  if (actions.length === 0)
    return props.entry.proposals.length > 0 ? null : (
      <span className="text-ink-3">no action can be sent from here yet</span>
    );
  if (projectAbilityRefused(abilities, "mutate")) return null;
  return (
    <div className="grid gap-2">
      <div className="flex gap-2 items-baseline">
        {actions.map((action) => (
          <Tooltip
            key={action.action}
            text={ticketActionSentence(action.action, {
              kind: inboxEntryPhased(props.entry)?.escalation?.kind,
            })}
          >
            <span>
              <Button
                variant="quiet"
                size="sm"
                disabled={inboxAnswerInFlight(props.answer?.step)}
                {...(action === revoking ? { expanded: revoke.open } : {})}
                onClick={
                  action === revoking
                    ? revoke.toggle
                    : () => {
                        props.onAnswer(action);
                      }
                }
              >
                {action.action.toLowerCase()}
              </Button>
            </span>
          </Tooltip>
        ))}
      </div>
      {revoking === undefined || !revoke.open ? null : (
        <TicketRevokeConfirm
          ask={revoke}
          onRevoke={() => {
            props.onAnswer(revoking);
          }}
        />
      )}
    </div>
  );
}

/** The hover over a lost job's badge: the runner, how often it was lost and
 * resumed, and the first line its worker kept where it kept one. */
function InboxLostWhy(props: {
  readonly partition: PartitionIdentity;
  readonly lost: RunnerLoss;
  readonly badge: string;
}): ReactNode {
  const lost = props.lost;
  const reason = useRunReason(props.partition, lost.execution, lost.attempt);
  const said = [runnerLossDetail(lost), runnerLossLine(lost)];
  if (lost.error !== undefined && reason !== undefined) said.push(reason.line);
  return (
    <Tooltip text={said.join(" · ")}>
      <span>
        <Pill tone="parked">{props.badge}</Pill>
      </span>
    </Tooltip>
  );
}

/** The hover over a stopped job's badge: the step it stopped at, and the first
 * line its worker kept where it kept one. */
function InboxFailedWhy(props: {
  readonly partition: PartitionIdentity;
  readonly failed: RunStepFailure;
  readonly badge: string;
}): ReactNode {
  const failed = props.failed;
  const reason = useRunReason(
    props.partition,
    failed.execution,
    failed.attempt,
  );
  const said = [runStepLabel(failed.evidence)];
  if (failed.error !== undefined && reason !== undefined)
    said.push(reason.line);
  return (
    <Tooltip text={said.join(" · ")}>
      <span>
        <Pill tone="parked">{props.badge}</Pill>
      </span>
    </Tooltip>
  );
}

/** Why this ticket is here: its phase where that is what holds it, and what
 * its open questions ask where it is not. */
function InboxWhy(props: {
  readonly partition: PartitionIdentity;
  readonly entry: InboxEntryResponse;
  readonly row: ProjectTableRow;
}): ReactNode {
  const held = inboxEntryPhased(props.entry);
  const row = props.row;
  if (held === undefined)
    return (
      <div className="flex flex-wrap gap-2">
        {props.entry.actions.map((action) => (
          <Pill key={action.action} tone="parked">
            {nativeActionKindSentence(action.kind)}
          </Pill>
        ))}
      </div>
    );
  const lost = held.escalation?.lost;
  if (lost !== undefined)
    return (
      <InboxLostWhy
        partition={props.partition}
        lost={lost}
        badge={row.badge ?? phaseLabel(row.phase)}
      />
    );
  const failed = held.escalation?.failed;
  if (failed !== undefined)
    return (
      <InboxFailedWhy
        partition={props.partition}
        failed={failed}
        badge={row.badge ?? phaseLabel(row.phase)}
      />
    );
  const kind = held.escalation?.kind;
  return (
    <Tooltip
      text={kind === undefined ? undefined : escalationKindSentence(kind)}
    >
      <span>
        <Pill tone="parked">{row.badge ?? phaseLabel(row.phase)}</Pill>
      </span>
    </Tooltip>
  );
}

/** That the lead is declining to dispatch this ticket. The reason is on hover,
 * because a row is one line. */
function InboxRefusal(props: {
  readonly entry: InboxEntryResponse;
}): ReactNode {
  const refusal = props.entry.refusals[0];
  if (refusal === undefined) return null;
  return (
    <Tooltip text={refusal.reason}>
      <span>
        <Pill tone={agenticRefusalStandingTone("Standing")}>Standing</Pill>
      </span>
    </Tooltip>
  );
}

/** One press of a row's answer: what was answered, the identity it drew, and
 * where its follow reports. */
interface InboxAnswerPressed {
  readonly action: TicketAction;
  readonly operation: string;
  readonly progress: ConsoleWriteProgress<OperationStep>;
}

/** One ticket's answer, followed to settlement and refused wherever the actor
 * did not take it. The rows are not read again for it: a frame or a poll is
 * what moves a row. */
function inboxAnswerWrite(
  partition: PartitionIdentity,
  ticket: number,
): ConsoleWrite<InboxAnswerPressed, OperationStep> {
  return {
    mutationKey: consoleWriteKey(
      "inbox-answer",
      partition.tenant,
      partition.project,
      ticket,
    ),
    write: async (ports, pressed) => {
      const step = await followOperationProgressed(
        ports,
        partition,
        { operation: pressed.operation, mutation: pressed.action.mutation },
        ticket,
        pressed.progress,
        "the answer failed",
      );
      const refused = inboxAnswerRefusal(step);
      if (refused !== undefined) throw new ConsoleWriteRefused(refused);
      return { outcome: "Ok", value: step };
    },
    refusal: operationFailureSentence,
  };
}

/** A row's answer and the press that sends one, each row answering under its
 * own ticket's key. */
function useInboxAnswer(
  partition: PartitionIdentity,
  ticket: number,
): {
  readonly answer: InboxAnswer | undefined;
  readonly onAnswer: (action: TicketAction) => void;
} {
  const writing = useConsoleWrite(inboxAnswerWrite(partition, ticket), {
    drawn: true,
  });
  const reported = useConsoleWriteProgress(writing.variables?.progress);
  const step =
    reported ?? (writing.isPending ? operationSubmitting() : undefined);
  const action = writing.variables?.action;
  const answer = useMemo(
    () =>
      action === undefined || step === undefined ? undefined : { action, step },
    [action, step],
  );
  return {
    answer,
    onAnswer: (pressed) => {
      writing.mutate({
        action: pressed,
        operation: base64urlFromBytes(drawBytes(operationIdBytesCount)),
        progress: new ConsoleWriteProgress<OperationStep>(),
      });
    },
  };
}

/** One row, drawn from the row its entry carries whatever put it here. */
function InboxRow(props: {
  readonly entry: InboxEntryResponse;
  readonly partition: PartitionIdentity;
  readonly proposed: InboxProposalAnswers;
  readonly nowMs: number;
}): ReactNode {
  const row = projectTableRow(props.entry.ticket);
  const { answer, onAnswer } = useInboxAnswer(props.partition, row.ticket);
  return (
    <tr>
      <TicketTitleCell
        partition={props.partition}
        ticket={row.ticket}
        title={row.title}
      />
      <td>
        <InboxWhy partition={props.partition} entry={props.entry} row={row} />
        <InboxProposalWhy
          ticket={row.ticket}
          proposals={props.entry.proposals}
        />
        <InboxRefusal entry={props.entry} />
      </td>
      <td>
        <TicketRowExecutionCell row={row} />
      </td>
      <TicketActivityCell activityAt={row.activityAt} nowMs={props.nowMs} />
      <td>
        <InboxActions
          partition={props.partition}
          entry={props.entry}
          answer={answer}
          onAnswer={onAnswer}
        />
        <InboxProposalActions
          proposals={props.entry.proposals}
          answers={props.proposed}
        />
      </td>
      <td className="text-ink-3">
        {answer === undefined ? cellAbsent : inboxStepSentence(answer.step)}
      </td>
    </tr>
  );
}

function InboxTable(props: {
  readonly entries: readonly InboxEntryResponse[];
  readonly partition: PartitionIdentity;
  readonly proposed: InboxProposalAnswers;
  readonly nowMs: number;
}): ReactNode {
  return (
    <Table caption={ticketSectionTitles[inboxSection]}>
      <thead>
        <tr>
          <th scope="col">title</th>
          <th scope="col">why</th>
          <th scope="col">last execution</th>
          <th scope="col">last activity</th>
          <th scope="col">answer</th>
          <th scope="col">what happened</th>
        </tr>
      </thead>
      <tbody>
        {props.entries.map((entry) => (
          <InboxRow
            key={entry.ticket.ticket}
            entry={entry}
            partition={props.partition}
            proposed={props.proposed}
            nowMs={props.nowMs}
          />
        ))}
      </tbody>
    </Table>
  );
}

/** A further page the reader asked for that could not be read, beside the rows that were. */
function InboxPageFailure(props: {
  readonly rows: InboxRows | undefined;
}): ReactNode {
  const failure = props.rows?.failure;
  return failure === undefined ? null : (
    <p className="panel-failed">a further page could not be read — {failure}</p>
  );
}

/** The screen itself, taking the partition rather than reading the route, so a
 * suite can mount it. */
export function InboxScreen(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  const partition = props.partition;
  const inbox = useInboxRows(partition);
  const proposed = useInboxProposalAnswers(partition);
  const nowMs = useNowMs();
  return (
    <>
      <ScreenTitle>Inbox</ScreenTitle>
      <RepositoryImportRefusedNotice partition={partition} />
      <InboxPageFailure rows={inbox.rows} />
      <InboxProposalNotice answers={proposed} />
      <DataPanel title={ticketSectionTitles[inboxSection]} state={inbox.panel}>
        {(rows) =>
          rows.entries.length === 0 ? (
            <p className="panel-note">Inbox is clear</p>
          ) : (
            <InboxTable
              entries={rows.entries}
              partition={partition}
              proposed={proposed}
              nowMs={nowMs}
            />
          )
        }
      </DataPanel>
      {inbox.readMore === undefined ? null : (
        <div>
          <Button size="sm" onClick={inbox.readMore}>
            more
          </Button>
        </div>
      )}
      {inbox.reading ? <p className="panel-note">reading…</p> : null}
    </>
  );
}

export function Inbox(): ReactNode {
  return <InboxScreen partition={useParams({ from: "/$tenant/$project" })} />;
}
