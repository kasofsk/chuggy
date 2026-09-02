/**
 * The escalation inbox: every ticket that needs a human, newest activity first,
 * each answerable where it stands.
 *
 * Two reads make the list — the phase page and the project's open native
 * actions — and `inboxUnion` is where they become one row per ticket. The shell
 * badge and this panel both take those two reads through `useInboxRows`, so the
 * count and the rows are one value: a read that refused becomes a notice beside
 * the rows the other one supplied rather than an empty panel under a badge that
 * still counts them. What a row ran is the project table's own index under the
 * project table's own key. What a row offers is the core's decision and what
 * happens after the click is `followOperation`'s, both shared with the ticket
 * page, because a second account of what the machine accepts is a second account
 * that drifts.
 *
 * ANSWERING NEVER TOUCHES THE ROWS. The follow reports its steps into the row it
 * came from and writes into neither list; the row leaves when a `Ticket` frame
 * says the ticket left the section, or when a `NativeAction` frame says its open
 * questions are answered. Those are the only accounts of where a ticket is that
 * a reader can trust. `ui/chuggy-ui/test/inbox.test.tsx` and
 * `ui/chuggy-ui/test/inboxApproval.test.tsx` hold that.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { AgenticRefusalsResponse } from "../../../../src/contract/responses.ts";
import {
  apiAgenticRefusals,
  apiNativeActions,
  apiProject,
} from "../core/apiRoutes.ts";
import { base64urlFromBytes } from "../core/base64url.ts";
import {
  escalationReasonSentence,
  nativeActionKindSentence,
  operationRefusalSentence,
  operationStateSentence,
} from "../core/codeSentences.ts";
import type { PanelState } from "../core/freshness.ts";
import {
  inboxAnswerInFlight,
  inboxAnswersEmpty,
  inboxAnswersWith,
} from "../core/inboxAnswers.ts";
import type { InboxAnswers } from "../core/inboxAnswers.ts";
import {
  inboxActionsPage,
  inboxPage,
  inboxPhases,
  inboxRefusalsPage,
  inboxSection,
} from "../core/inboxList.ts";
import {
  inboxUnion,
  inboxUnionEmpty,
  inboxUnionRefusals,
  inboxUnionState,
} from "../core/inboxUnion.ts";
import type {
  InboxEntry,
  InboxRefusals,
  InboxUnion,
} from "../core/inboxUnion.ts";
import { nativeActionsAnswers } from "../core/nativeActionAnswers.ts";
import {
  followOperation,
  operationIdBytesCount,
} from "../core/operationFollow.ts";
import type { OperationStep } from "../core/operationFollow.ts";
import {
  projectExecutionIndexAt,
  projectExecutionIndexUnread,
} from "../core/projectExecutionIndex.ts";
import type {
  ProjectExecutionIndex,
  ProjectExecutionKnown,
} from "../core/projectExecutionIndex.ts";
import {
  projectNativeActionRowsFold,
  projectNativeActionRowsRead,
} from "../core/projectNativeActionPages.ts";
import type { ProjectNativeActionRows } from "../core/projectNativeActionPages.ts";
import {
  projectListFolded,
  projectListReread,
} from "../core/projectQueryKeys.ts";
import {
  projectTableExecutionPhrase,
  projectTableRow,
} from "../core/projectTableRows.ts";
import type { ProjectTableRow } from "../core/projectTableRows.ts";
import {
  projectTicketRowsAfterPage,
  projectTicketRowsFold,
  projectTicketRowsRead,
} from "../core/projectTicketPages.ts";
import type { ProjectTicketRows } from "../core/projectTicketPages.ts";
import { agenticRefusalStanding } from "../core/leadTranscript.ts";
import { actionsFor, ticketActionSentence } from "../core/ticketActions.ts";
import type { TicketAction } from "../core/ticketActions.ts";
import { ticketSectionTitles } from "../core/ticketSections.ts";
import { agenticRefusalStandingTone } from "../core/tones.ts";
import { useApiPorts, usePanelList } from "./api.ts";
import { DataPanel } from "./DataPanel.tsx";
import { useProjectExecutionIndex } from "./executionIndex.ts";
import { drawBytes } from "./ports.ts";
import {
  cellAbsent,
  cellExecutionUnread,
  ticketRowExecutionCell,
  TicketNumberCell,
} from "./TicketCells.tsx";
import { Notice } from "./ui/Notice.tsx";
import { Pill } from "./ui/Pill.tsx";

const inboxListName = "inbox";

export interface InboxRowsHeld {
  readonly union: InboxUnion;
  readonly panel: PanelState<InboxUnion>;
  readonly refusals: InboxRefusals;
  readonly pageFailure: string | undefined;
  readonly openPageFailure: string | undefined;
  readonly readMore: (() => void) | undefined;
  readonly reading: boolean;
}

/**
 * The project's open native actions, live. Registered from both the shell and
 * this screen under one key, which the fold admits because a frame carries the
 * whole truth about one ticket and folding it twice lands where folding it once
 * does.
 */
function useInboxOpenActions(
  partition: PartitionIdentity,
): PanelState<ProjectNativeActionRows> {
  return usePanelList(
    projectListFolded<ProjectNativeActionRows>(
      partition,
      "NativeAction",
      inboxListName,
      (previous, change) =>
        projectNativeActionRowsFold(
          previous,
          change.resource,
          change.representation,
        ),
    ),
    (at) =>
      projectNativeActionRowsRead((cursor) =>
        apiNativeActions(at, partition, inboxActionsPage(cursor)),
      ),
  );
}

/**
 * The project's standing agentic refusals, re-read rather than folded: the
 * `AgenticRefusal` frame carries one ticket's ledger, and this list is the
 * project's standing rows with each one's supersession decided against the
 * ticket's current authoring version, which the frame does not carry.
 */
function useInboxRefusals(
  partition: PartitionIdentity,
): PanelState<AgenticRefusalsResponse> {
  return usePanelList(
    projectListReread<AgenticRefusalsResponse>(
      partition,
      "AgenticRefusal",
      inboxListName,
    ),
    (at) => apiAgenticRefusals(at, partition, inboxRefusalsPage()),
  );
}

/** The tickets a phase puts in front of a person, live under the same key. */
function useInboxPhaseRows(partition: PartitionIdentity): {
  readonly state: PanelState<ProjectTicketRows>;
  readonly readMore: (() => void) | undefined;
  readonly reading: boolean;
} {
  const list = projectListFolded<ProjectTicketRows>(
    partition,
    "Ticket",
    inboxListName,
    (previous, change) =>
      projectTicketRowsFold(
        previous,
        change.resource,
        change.representation,
        inboxPhases,
      ),
  );
  const key = list.key;
  const client = useQueryClient();
  const ports = useApiPorts();
  const [reading, setReading] = useState(false);
  const state = usePanelList(list, (at) =>
    projectTicketRowsRead(
      client.getQueryData<ProjectTicketRows>(key),
      (cursor) => apiProject(at, partition, inboxPage(cursor)),
    ),
  );
  const rows = state.state === "Ready" ? state.value : undefined;
  const cursor = rows?.nextCursor;
  const readMore = () => {
    setReading(true);
    void (async () => {
      const answered = await apiProject(ports, partition, inboxPage(cursor));
      client.setQueryData<ProjectTicketRows>(key, (previous) =>
        previous === undefined
          ? previous
          : projectTicketRowsAfterPage(previous, answered),
      );
      setReading(false);
    })();
  };
  return {
    state,
    readMore: cursor === undefined || reading ? undefined : readMore,
    reading,
  };
}

/**
 * Both reads, the union they make and the one state that draws it. The badge
 * and the panel take the same two values through the same two functions, which
 * is what makes the header's claim above true rather than merely intended.
 */
export function useInboxRows(partition: PartitionIdentity): InboxRowsHeld {
  const phase = useInboxPhaseRows(partition);
  const open = useInboxOpenActions(partition);
  const refused = useInboxRefusals(partition);
  const held = phase.state.state === "Ready" ? phase.state.value : undefined;
  const openHeld = open.state === "Ready" ? open.value : undefined;
  const refusedHeld = refused.state === "Ready" ? refused.value : undefined;
  const union =
    held === undefined && openHeld === undefined && refusedHeld === undefined
      ? inboxUnionEmpty
      : inboxUnion(held, openHeld, refusedHeld);
  const panel = inboxUnionState(union, phase.state, open, refused);
  return {
    union,
    panel,
    refusals: inboxUnionRefusals(panel, phase.state, open, refused),
    pageFailure: held?.failure,
    openPageFailure: openHeld?.failure,
    readMore: phase.readMore,
    reading: phase.reading,
  };
}

/** A follow that outlived its screen has nowhere to report, so it stops here. */
function useLiving(): { readonly current: boolean } {
  const living = useRef(true);
  useEffect(() => {
    living.current = true;
    return () => {
      living.current = false;
    };
  }, []);
  return living;
}

/** What the row says about the answer it is carrying, in the reader's terms. */
function inboxStepSentence(step: OperationStep): string {
  switch (step.step) {
    case "Submitting":
      return "submitting…";
    case "Backlogged":
      return `the API is deferring this (${step.code})`;
    case "Following":
      return "waiting on the actor…";
    case "Confirming":
      return "waiting for the project to catch up…";
    case "Settled":
      return step.refusalCode === undefined
        ? operationStateSentence(step.state)
        : operationRefusalSentence(step.refusalCode);
    case "Abandoned":
      return step.reason;
  }
}

/** An open action's admitted answers, and the phase's own where none is open. */
function inboxEntryActions(entry: InboxEntry): readonly TicketAction[] {
  if (entry.actions.length > 0) return nativeActionsAnswers(entry.actions);
  return entry.held === undefined ? [] : actionsFor(entry.held);
}

function InboxActions(props: {
  readonly entry: InboxEntry;
  readonly step: OperationStep | undefined;
  readonly onAnswer: (action: TicketAction) => void;
}): ReactNode {
  const actions = inboxEntryActions(props.entry);
  if (actions.length === 0)
    return (
      <span className="cell-dim">no action can be sent from here yet</span>
    );
  return (
    <>
      {actions.map((action) => (
        <button
          key={action.action}
          type="button"
          className="row-action"
          disabled={inboxAnswerInFlight(props.step)}
          title={ticketActionSentence(action.action, {
            reason: props.entry.held?.reason,
          })}
          onClick={() => {
            props.onAnswer(action);
          }}
        >
          {action.action.toLowerCase()}
        </button>
      ))}
    </>
  );
}

/** Why this ticket is here: its phase where the phase page reached it, and what
 * its open questions ask where it did not. */
function InboxWhy(props: {
  readonly entry: InboxEntry;
  readonly row: ProjectTableRow | undefined;
}): ReactNode {
  const held = props.entry.held;
  const row = props.row;
  if (held === undefined || row === undefined)
    return (
      <>
        {props.entry.actions.map((action) => (
          <span key={action.action} className="badge">
            {nativeActionKindSentence(action.kind)}
          </span>
        ))}
      </>
    );
  const reason = held.reason;
  return (
    <span
      className="badge"
      title={
        reason === undefined ? undefined : escalationReasonSentence(reason)
      }
    >
      {row.badge ?? row.phase}
    </span>
  );
}

/** Whether the lead is declining to dispatch this ticket, and whether that
 * still binds. The reason is on hover, because a row is one line. */
function InboxRefusal(props: { readonly entry: InboxEntry }): ReactNode {
  const refusal = props.entry.refusals[0];
  if (refusal === undefined) return null;
  const standing = agenticRefusalStanding(refusal);
  return (
    <span title={refusal.reason}>
      <Pill tone={agenticRefusalStandingTone(standing)}>{standing}</Pill>
    </span>
  );
}

/**
 * One row. A ticket only the actions named has no projection row to draw from,
 * so its execution and activity columns say the screen did not read them rather
 * than filling them from a join it does not have.
 */
function InboxRow(props: {
  readonly entry: InboxEntry;
  readonly known: ProjectExecutionKnown | undefined;
  readonly truncated: boolean;
  readonly partition: PartitionIdentity;
  readonly step: OperationStep | undefined;
  readonly onAnswer: (action: TicketAction) => void;
}): ReactNode {
  const held = props.entry.held;
  const row =
    held === undefined
      ? undefined
      : projectTableRow(held, props.known, props.truncated);
  return (
    <tr>
      <TicketNumberCell
        partition={props.partition}
        ticket={props.entry.ticket}
      />
      <td>
        <InboxWhy entry={props.entry} row={row} />
        <InboxRefusal entry={props.entry} />
      </td>
      <td>
        {row === undefined
          ? cellExecutionUnread
          : ticketRowExecutionCell(row, projectTableExecutionPhrase(row))}
      </td>
      <td className="cell-dim">
        {row === undefined ? cellAbsent : row.sequence}
        {row?.activityAt === undefined ? "" : ` · ${row.activityAt}`}
      </td>
      <td className="row-actions">
        <div className="row-actions-inner">
          <InboxActions
            entry={props.entry}
            step={props.step}
            onAnswer={props.onAnswer}
          />
        </div>
      </td>
      <td className="cell-dim">
        {props.step === undefined ? cellAbsent : inboxStepSentence(props.step)}
      </td>
    </tr>
  );
}

function InboxTable(props: {
  readonly entries: readonly InboxEntry[];
  readonly index: ProjectExecutionIndex;
  readonly partition: PartitionIdentity;
  readonly steps: InboxAnswers;
  readonly onAnswer: (ticket: number, action: TicketAction) => void;
}): ReactNode {
  return (
    <table className="ticket-table">
      <thead>
        <tr>
          <th scope="col">ticket</th>
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
            key={entry.ticket}
            entry={entry}
            known={projectExecutionIndexAt(props.index, entry.ticket)}
            truncated={props.index.truncated}
            partition={props.partition}
            step={props.steps[String(entry.ticket)]}
            onAnswer={(action) => {
              props.onAnswer(entry.ticket, action);
            }}
          />
        ))}
      </tbody>
    </table>
  );
}

/**
 * The follows in flight and finished, keyed by the ticket each one is about.
 * Nothing here writes either list: a row that left because this asked it to
 * would be this screen's opinion rather than the project's.
 */
function useInboxAnswers(partition: PartitionIdentity): {
  readonly steps: InboxAnswers;
  readonly answer: (ticket: number, action: TicketAction) => void;
} {
  const ports = useApiPorts();
  const living = useLiving();
  const [steps, setSteps] = useState<InboxAnswers>(inboxAnswersEmpty);
  const answer = (ticket: number, action: TicketAction) => {
    void followOperation(
      ports,
      partition,
      {
        operation: base64urlFromBytes(drawBytes(operationIdBytesCount)),
        mutation: action.mutation,
      },
      ticket,
      (step) => {
        if (living.current)
          setSteps((held) => inboxAnswersWith(held, ticket, step));
      },
    );
  };
  return { steps, answer };
}

/**
 * What could not be read, said as itself beside the rows that could. A read
 * that refused while the other answered is a notice here rather than an empty
 * panel, so the half a person can still act on stays on screen.
 */
function InboxNotices(props: {
  readonly executions: PanelState<ProjectExecutionIndex>;
  readonly index: ProjectExecutionIndex;
  readonly held: InboxRowsHeld;
}): ReactNode {
  const held = props.held;
  return (
    <>
      {held.refusals.phase === undefined ? null : (
        <p className="panel-failed">
          the tickets a phase parks could not be read — {held.refusals.phase}
        </p>
      )}
      {held.refusals.open === undefined ? null : (
        <p className="panel-failed">
          the tickets waiting on an answer from you could not be read —{" "}
          {held.refusals.open}
        </p>
      )}
      {held.refusals.standing === undefined ? null : (
        <Notice
          tone="parked"
          inline
          detail={`Refusals · ${held.refusals.standing}`}
        />
      )}
      {held.openPageFailure === undefined ? null : (
        <p className="panel-failed">
          a further page of open questions could not be read —{" "}
          {held.openPageFailure}
        </p>
      )}
      {props.executions.state === "Failed" ? (
        <p className="panel-failed">
          what each ticket ran could not be read — {props.executions.reason}
        </p>
      ) : null}
      {props.executions.state === "Ready" && props.index.truncated ? (
        <p className="panel-absent">
          the index of what each ticket ran was truncated at its page budget, so
          the rows it did not reach say “not read” rather than nothing
        </p>
      ) : null}
      {held.pageFailure === undefined ? null : (
        <p className="panel-failed">
          a further page could not be read — {held.pageFailure}
        </p>
      )}
    </>
  );
}

/** The screen itself, taking the partition rather than reading the route, so a
 * suite can mount it. */
export function InboxScreen(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  const partition = props.partition;
  const inbox = useInboxRows(partition);
  const executions = useProjectExecutionIndex(partition);
  const index =
    executions.state === "Ready"
      ? executions.value
      : projectExecutionIndexUnread;
  const answers = useInboxAnswers(partition);
  return (
    <>
      <InboxNotices executions={executions} index={index} held={inbox} />
      <DataPanel title={ticketSectionTitles[inboxSection]} state={inbox.panel}>
        {(union) =>
          union.entries.length === 0 ? (
            <p className="panel-note">Inbox is clear</p>
          ) : (
            <InboxTable
              entries={union.entries}
              index={index}
              partition={partition}
              steps={answers.steps}
              onAnswer={answers.answer}
            />
          )
        }
      </DataPanel>
      {inbox.readMore === undefined ? null : (
        <button type="button" className="more" onClick={inbox.readMore}>
          more
        </button>
      )}
      {inbox.reading ? <p className="panel-note">reading…</p> : null}
    </>
  );
}

export function Inbox(): ReactNode {
  return <InboxScreen partition={useParams({ from: "/$tenant/$project" })} />;
}
