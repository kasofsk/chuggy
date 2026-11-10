/**
 * The head of every tab of the epic page, laid out as the ticket page's is and
 * drawn in its frame: the title with its number, where the epic's tickets
 * stand, what this reader may do to it, the notes that apply, and the revision
 * it is at, with who saved that and when.
 *
 * A revision, an archive and a reactivation are each sent at the revision the
 * page read, so one made over another's is refused as stale.
 */

import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type {
  EpicGraphResponse,
  EpicViewResponse,
} from "../../../../../src/contract/responses.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import {
  epicFormFrom,
  epicVisibilityWrite,
  epicWriteFrom,
} from "../../core/epics.ts";
import { instantFigure } from "../../core/figures.ts";
import { ConsoleWriteRefusedWords, useConsoleWrite } from "../consoleWrite.tsx";
import { EpicFormPanel } from "../EpicForm.tsx";
import { TicketActionConfirm } from "../ticket/TicketActionConfirm.tsx";
import {
  TicketHeaderFrame,
  TicketHeaderTitle,
} from "../ticket/TicketHeader.tsx";
import { readValue } from "../ticket/TicketPageHeld.tsx";
import { Button } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Pill } from "../ui/Pill.tsx";
import type { EpicPageHeld } from "./EpicPageHeld.tsx";
import { EpicStanding, EpicStatusChip } from "./EpicProgress.tsx";

import "../ticket/ticket.css";
import "./epic.css";

/** The revise form, opened over the page and sent at the revision read. */
function EpicHeaderEdit(props: {
  readonly partition: PartitionIdentity;
  readonly view: EpicViewResponse;
}): ReactNode {
  const text = useCopyText();
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      title={text({ id: "epics-edit" })}
      trigger={text({ id: "ui-edit" })}
      size="form"
      open={open}
      onOpenChange={setOpen}
    >
      <EpicFormPanel
        key={props.view.number}
        partition={props.partition}
        held={{
          epic: props.view.number,
          revision: props.view.revision,
          form: epicFormFrom(props.view),
        }}
        submit={text({ id: "ui-save" })}
        onSaved={() => {
          setOpen(false);
        }}
      />
    </Dialog>
  );
}

/** Archive, or Reactivate an archived epic, each asked before it is sent. */
function EpicHeaderVisibility(props: {
  readonly partition: PartitionIdentity;
  readonly view: EpicViewResponse;
  readonly writing: ReturnType<typeof useEpicHeaderWriting>;
}): ReactNode {
  const text = useCopyText();
  const [asking, setAsking] = useState(false);
  const archived = props.view.visibility === "Archived";
  const word = text({ id: archived ? "epics-reactivate" : "epics-archive" });
  return (
    <>
      <Button
        size="sm"
        variant="quiet"
        busy={props.writing.isPending}
        disabled={props.writing.isPending}
        onClick={() => {
          setAsking(true);
        }}
      >
        {word}
      </Button>
      <TicketActionConfirm
        title={text({
          id: archived ? "epics-reactivate-title" : "epics-archive-title",
        })}
        confirm={word}
        open={asking}
        onOpenChange={setAsking}
        onConfirm={() => {
          const request = epicWriteFrom(
            {
              ...epicFormFrom(props.view),
              visibility: archived ? "Active" : "Archived",
            },
            { epic: props.view.number, revision: props.view.revision },
          );
          if (request !== undefined) props.writing.mutate(request);
        }}
      >
        {text({
          id: archived ? "epics-reactivate-body" : "epics-archive-body",
        })}
      </TicketActionConfirm>
    </>
  );
}

function useEpicHeaderWriting(partition: PartitionIdentity) {
  return useConsoleWrite(epicVisibilityWrite(partition), { drawn: true });
}

/** A ticket named by its number and, where the graph holds it, its title. */
function EpicHeaderTicket(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
  readonly graph: EpicGraphResponse | undefined;
}): ReactNode {
  const title = props.graph?.nodes.find(
    (node) => node.ticket === props.ticket,
  )?.title;
  return (
    <Link
      to="/$tenant/$project/tickets/$ticket"
      params={{ ...props.partition, ticket: String(props.ticket) }}
    >
      {title === undefined
        ? `#${String(props.ticket)}`
        : `#${String(props.ticket)} ${title}`}
    </Link>
  );
}

/** Each escalated member, and the tickets outside that members wait on. */
function EpicHeaderNotes(props: {
  readonly held: EpicPageHeld;
  readonly view: EpicViewResponse;
  readonly writing: ReturnType<typeof useEpicHeaderWriting>;
}): ReactNode {
  const text = useCopyText();
  const { partition } = props.held;
  const graph = readValue(props.held.graphState);
  const escalated = (graph?.nodes ?? []).filter(
    (node) => node.member && node.phase === "Escalated",
  );
  const outside = props.view.waitingOnOutside;
  return (
    <div className="ticket-header-notes">
      {escalated.map((node) => (
        <p key={node.ticket} className="epic-header-note" data-note="attention">
          {text({ id: "epics-note-attention" })}{" "}
          <EpicHeaderTicket
            partition={partition}
            ticket={node.ticket}
            graph={graph}
          />{" "}
          {text({ id: "epics-note-attention-escalated" })}
        </p>
      ))}
      {outside.length === 0 ? null : (
        <p className="epic-header-note" data-note="waiting">
          {text({ id: "epics-note-waiting", args: { count: outside.length } })}{" "}
          {outside.map((ticket, at) => (
            <span key={ticket}>
              {at === 0 ? null : ", "}
              <EpicHeaderTicket
                partition={partition}
                ticket={ticket}
                graph={graph}
              />
            </span>
          ))}
        </p>
      )}
      {props.writing.error === null ? null : (
        <p className="notice notice-danger notice-inline" role="alert">
          <ConsoleWriteRefusedWords refused={props.writing.error} />
        </p>
      )}
    </div>
  );
}

/** The revision the epic is at, and who saved it when, where the newest page
 * of its history holds that revision. */
function EpicHeaderSaved(props: {
  readonly held: EpicPageHeld;
  readonly view: EpicViewResponse;
}): ReactNode {
  const text = useCopyText();
  const saved = readValue(props.held.historyState)?.revisions.find(
    (revision) => revision.revision === props.view.revision,
  );
  return (
    <p className="epic-header-saved">
      {saved === undefined ? (
        text({
          id: "epics-revision",
          args: { revision: String(props.view.revision) },
        })
      ) : (
        <>
          {text({
            id: "epics-saved",
            args: {
              revision: String(props.view.revision),
              actor: saved.actor.subject,
            },
          })}{" "}
          <Figure figure={instantFigure(saved.changedAt, props.held.nowMs)} />
        </>
      )}
    </p>
  );
}

export function EpicHeader(props: {
  readonly held: EpicPageHeld;
  readonly view: EpicViewResponse;
}): ReactNode {
  const text = useCopyText();
  const { held, view } = props;
  const writing = useEpicHeaderWriting(held.partition);
  return (
    <TicketHeaderFrame
      label={<EpicStatusChip status={view.status} />}
      title={view.title}
    >
      <TicketHeaderTitle title={view.title} ticket={view.number} />
      {view.visibility === "Archived" ? (
        <span>
          <Pill tone="retired">
            {text({ id: "epics-visibility-archived" })}
          </Pill>
        </span>
      ) : null}
      <div className="ticket-header-standing">
        <div className="ticket-header-state">
          <EpicStanding epic={view} size="page" />
        </div>
        {held.writing ? (
          <div className="ticket-header-actions">
            <EpicHeaderEdit partition={held.partition} view={view} />
            <EpicHeaderVisibility
              partition={held.partition}
              view={view}
              writing={writing}
            />
          </div>
        ) : null}
      </div>
      <EpicHeaderNotes held={held} view={view} writing={writing} />
      <EpicHeaderSaved held={held} view={view} />
    </TicketHeaderFrame>
  );
}
