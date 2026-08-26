/**
 * The escalation inbox: every ticket that needs a human, newest activity first,
 * each answerable where it stands.
 *
 * The rows are one query the shell's badge reads too, so the count and the list
 * are the same value and cannot disagree, and what a row ran is the project
 * table's own index under the project table's own key — one read, one budget,
 * one caption when it was cut short. What a row offers is `actionsFor`'s
 * decision and what happens after the click is `followOperation`'s, both shared
 * with the ticket page, because a second account of what the machine accepts is
 * a second account that drifts.
 *
 * ANSWERING NEVER TOUCHES THE ROWS. The follow reports its steps into the row
 * it came from and writes nothing into the list; the row leaves when a `Ticket`
 * frame says the ticket left the section, which is the only account of where a
 * ticket is that a reader can trust.
 * `ui/chuggy-ui/test/inbox.test.tsx` holds that.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { TicketResponse } from "../../../../src/contract/responses.ts";
import { apiProject } from "../core/apiRoutes.ts";
import { base64urlFromBytes } from "../core/base64url.ts";
import {
  escalationReasonSentence,
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
import { inboxPage, inboxPhases, inboxSection } from "../core/inboxList.ts";
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
import { projectListKey } from "../core/projectQueryKeys.ts";
import {
  projectTableExecutionPhrase,
  projectTableRow,
} from "../core/projectTableRows.ts";
import {
  projectTicketRowsAfterPage,
  projectTicketRowsFold,
  projectTicketRowsRead,
} from "../core/projectTicketPages.ts";
import type { ProjectTicketRows } from "../core/projectTicketPages.ts";
import { actionsFor, ticketActionSentence } from "../core/ticketActions.ts";
import type { TicketAction } from "../core/ticketActions.ts";
import { ticketSectionTitles } from "../core/ticketSections.ts";
import { useApiPorts, usePanelQuery } from "./api.ts";
import { useProjectExecutionIndex } from "./executionIndex.ts";
import { Panel } from "./Panel.tsx";
import { drawBytes } from "./ports.ts";
import { useProjectListFold } from "./stream.tsx";
import {
  cellAbsent,
  ticketRowExecutionCell,
  TicketNumberCell,
} from "./TicketCells.tsx";

const inboxListName = "inbox";

export interface InboxRowsHeld {
  readonly state: PanelState<ProjectTicketRows>;
  readonly readMore: (() => void) | undefined;
  readonly reading: boolean;
}

/**
 * The tickets needing a human, live. Registered from both the shell and this
 * screen under one key, which the fold admits because folding a frame twice
 * lands where folding it once does.
 */
export function useInboxRows(partition: PartitionIdentity): InboxRowsHeld {
  const key = projectListKey(partition, "Ticket", inboxListName);
  const client = useQueryClient();
  const ports = useApiPorts();
  const [reading, setReading] = useState(false);
  const state = usePanelQuery<ProjectTicketRows>(key, (at) =>
    projectTicketRowsRead(
      client.getQueryData<ProjectTicketRows>(key),
      (cursor) => apiProject(at, partition, inboxPage(cursor)),
    ),
  );
  useProjectListFold("Ticket", key, (previous, change) =>
    projectTicketRowsFold(
      previous as ProjectTicketRows | undefined,
      change.resource,
      change.representation,
      inboxPhases,
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

function InboxActions(props: {
  readonly ticket: TicketResponse;
  readonly step: OperationStep | undefined;
  readonly onAnswer: (action: TicketAction) => void;
}): ReactNode {
  const actions = actionsFor(props.ticket);
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
          title={ticketActionSentence(action.action)}
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

function InboxRow(props: {
  readonly ticket: TicketResponse;
  readonly known: ProjectExecutionKnown | undefined;
  readonly truncated: boolean;
  readonly partition: PartitionIdentity;
  readonly step: OperationStep | undefined;
  readonly onAnswer: (action: TicketAction) => void;
}): ReactNode {
  const row = projectTableRow(props.ticket, props.known, props.truncated);
  const reason = props.ticket.reason;
  const status = projectTableExecutionPhrase(row);
  return (
    <tr>
      <TicketNumberCell partition={props.partition} ticket={row.ticket} />
      <td>
        <span
          className="badge"
          title={
            reason === undefined ? undefined : escalationReasonSentence(reason)
          }
        >
          {row.badge ?? row.phase}
        </span>
      </td>
      <td>{ticketRowExecutionCell(row, status)}</td>
      <td className="cell-dim">
        {row.sequence}
        {row.activityAt === undefined ? "" : ` · ${row.activityAt}`}
      </td>
      <td className="row-actions">
        <div className="row-actions-inner">
          <InboxActions
            ticket={props.ticket}
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
  readonly tickets: readonly TicketResponse[];
  readonly index: ProjectExecutionIndex;
  readonly partition: PartitionIdentity;
  readonly steps: InboxAnswers;
  readonly onAnswer: (ticket: TicketResponse, action: TicketAction) => void;
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
        {props.tickets.map((ticket) => (
          <InboxRow
            key={ticket.ticket}
            ticket={ticket}
            known={projectExecutionIndexAt(props.index, ticket.ticket)}
            truncated={props.index.truncated}
            partition={props.partition}
            step={props.steps[String(ticket.ticket)]}
            onAnswer={(action) => {
              props.onAnswer(ticket, action);
            }}
          />
        ))}
      </tbody>
    </table>
  );
}

/**
 * The follows in flight and finished, keyed by the ticket each one is about.
 * Nothing here writes the list: a row that left because this asked it to would
 * be this screen's opinion rather than the project's.
 */
function useInboxAnswers(partition: PartitionIdentity): {
  readonly steps: InboxAnswers;
  readonly answer: (ticket: TicketResponse, action: TicketAction) => void;
} {
  const ports = useApiPorts();
  const living = useLiving();
  const [steps, setSteps] = useState<InboxAnswers>(inboxAnswersEmpty);
  const answer = (ticket: TicketResponse, action: TicketAction) => {
    void followOperation(
      ports,
      partition,
      {
        operation: base64urlFromBytes(drawBytes(operationIdBytesCount)),
        mutation: action.mutation,
      },
      ticket.ticket,
      (step) => {
        if (living.current)
          setSteps((held) => inboxAnswersWith(held, ticket.ticket, step));
      },
    );
  };
  return { steps, answer };
}

/** The screen itself, taking the partition rather than reading the route, so a
 * suite can mount it. */
export function InboxScreen(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  const partition = props.partition;
  const tickets = useInboxRows(partition);
  const held =
    tickets.state.state === "Ready" ? tickets.state.value : undefined;
  const executions = useProjectExecutionIndex(partition);
  const index =
    executions.state === "Ready"
      ? executions.value
      : projectExecutionIndexUnread;
  const answers = useInboxAnswers(partition);
  return (
    <>
      {executions.state === "Failed" ? (
        <p className="panel-failed">
          what each ticket ran could not be read — {executions.reason}
        </p>
      ) : null}
      {executions.state === "Ready" && index.truncated ? (
        <p className="panel-absent">
          the index of what each ticket ran was truncated at its page budget, so
          the rows it did not reach say “not read” rather than nothing
        </p>
      ) : null}
      {held?.failure === undefined ? null : (
        <p className="panel-failed">
          a further page could not be read — {held.failure}
        </p>
      )}
      <Panel title={ticketSectionTitles[inboxSection]} state={tickets.state}>
        {(rows) =>
          rows.tickets.length === 0 ? (
            <p className="panel-note">
              nothing needs you here — every ticket is the machine&rsquo;s
            </p>
          ) : (
            <InboxTable
              tickets={rows.tickets}
              index={index}
              partition={partition}
              steps={answers.steps}
              onAnswer={answers.answer}
            />
          )
        }
      </Panel>
      {tickets.readMore === undefined ? null : (
        <button type="button" className="more" onClick={tickets.readMore}>
          more
        </button>
      )}
      {tickets.reading ? <p className="panel-note">reading…</p> : null}
    </>
  );
}

export function Inbox(): ReactNode {
  return <InboxScreen partition={useParams({ from: "/$tenant/$project" })} />;
}
