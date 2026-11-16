/**
 * The head of every tab of the epic page, drawn through `PageHeader` as the
 * ticket page's is: the title with its number; its summary; its status and
 * whether it is archived, with what this reader may do to it; a bar of where
 * its tickets stand; and the notes that apply.
 *
 * An archive and a reactivation are each sent at the revision the page read,
 * so one made over another's is refused as stale.
 */

import { Link } from "@tanstack/react-router";
import { DropdownMenu } from "radix-ui";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type {
  EpicGraphResponse,
  EpicViewResponse,
} from "../../../../../src/contract/responses.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import type { CopyText } from "../../core/copy.ts";
import { consolePageHref } from "../../core/consolePage.ts";
import {
  epicFormFrom,
  epicVisibilityWrite,
  epicWriteFrom,
} from "../../core/epics.ts";
import { ConsoleWriteRefusedWords, useConsoleWrite } from "../consoleWrite.tsx";
import { currentOrigin } from "../ports.ts";
import { TicketActionConfirm } from "../ticket/TicketActionConfirm.tsx";
import { readValue } from "../ticket/TicketPageHeld.tsx";
import { buttonLookClassName } from "../ui/Button.tsx";
import { CopySaid, useCopyPress } from "../ui/CopyButton.tsx";
import type { CopyPress } from "../ui/CopyButton.tsx";
import { MenuContent, menuItemClassName } from "../ui/Menu.tsx";
import { PageHeader } from "../ui/PageHeader.tsx";
import type { PageHeaderAction } from "../ui/PageHeader.tsx";
import { Pill } from "../ui/Pill.tsx";
import type { EpicPageHeld } from "./EpicPageHeld.tsx";
import { EpicProgressPage, EpicStatusChip } from "./EpicProgress.tsx";

import "../ticket/ticket.css";
import "./epic.css";

function useEpicHeaderWriting(partition: PartitionIdentity) {
  return useConsoleWrite(epicVisibilityWrite(partition), { drawn: true });
}

type EpicHeaderWriting = ReturnType<typeof useEpicHeaderWriting>;

function EpicHeaderMenuMark(): ReactNode {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="size-4"
      fill="currentColor"
    >
      <circle cx="3" cy="8" r="1.4" />
      <circle cx="8" cy="8" r="1.4" />
      <circle cx="13" cy="8" r="1.4" />
    </svg>
  );
}

/** Archive, or Reactivate an archived epic, asked before it is sent at the
 * revision the page read. */
function EpicHeaderVisibilityConfirm(props: {
  readonly view: EpicViewResponse;
  readonly writing: EpicHeaderWriting;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): ReactNode {
  const text = useCopyText();
  const { view } = props;
  const archived = view.visibility === "Archived";
  return (
    <TicketActionConfirm
      title={text({
        id: archived ? "epics-reactivate-title" : "epics-archive-title",
      })}
      confirm={text({ id: archived ? "epics-reactivate" : "epics-archive" })}
      open={props.open}
      onOpenChange={props.onOpenChange}
      onConfirm={() => {
        const request = epicWriteFrom(
          {
            ...epicFormFrom(view),
            visibility: archived ? "Active" : "Archived",
          },
          { epic: view.number, revision: view.revision },
        );
        if (request !== undefined) props.writing.mutate(request);
      }}
    >
      {text({
        id: archived ? "epics-reactivate-body" : "epics-archive-body",
      })}
    </TicketActionConfirm>
  );
}

/** The menu's Copy link, which stays open to say it copied. */
function EpicHeaderCopyLink(props: {
  readonly held: EpicPageHeld;
  readonly view: EpicViewResponse;
  readonly copy: CopyPress;
}): ReactNode {
  const text = useCopyText();
  const { copy } = props;
  return (
    <DropdownMenu.Item
      className={menuItemClassName}
      onSelect={(event) => {
        event.preventDefault();
        copy.press(
          new URL(
            consolePageHref(props.held.partition, {
              page: "Epic",
              epic: props.view.number,
            }),
            currentOrigin(),
          ).href,
        );
      }}
    >
      {text({
        id: copy.copied ? "epics-copy-link-copied" : "epics-copy-link",
      })}
    </DropdownMenu.Item>
  );
}

/** The ⋯ menu: Archive, or Reactivate an archived epic, for a reader who may
 * write epics, each asked before it is sent; and Copy link, which stays open
 * to say it copied. A menu with nothing in it is not drawn. */
function EpicHeaderMenu(props: {
  readonly held: EpicPageHeld;
  readonly view: EpicViewResponse;
  readonly writing: EpicHeaderWriting;
}): ReactNode {
  const text = useCopyText();
  const copy = useCopyPress();
  const [asking, setAsking] = useState(false);
  const { held, view } = props;
  const word = text({
    id: view.visibility === "Archived" ? "epics-reactivate" : "epics-archive",
  });
  if (!held.writing && copy === undefined) return null;
  return (
    <>
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger
          className={buttonLookClassName({ size: "icon" })}
          aria-label={text({ id: "epics-menu-label" })}
        >
          <EpicHeaderMenuMark />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <MenuContent sideOffset={4} align="end">
            {held.writing ? (
              <DropdownMenu.Item
                className={menuItemClassName}
                disabled={props.writing.isPending}
                onSelect={() => {
                  setAsking(true);
                }}
              >
                {word}
              </DropdownMenu.Item>
            ) : null}
            {copy === undefined ? null : (
              <EpicHeaderCopyLink held={held} view={view} copy={copy} />
            )}
          </MenuContent>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {copy === undefined ? null : <CopySaid copied={copy.copied} />}
      <EpicHeaderVisibilityConfirm
        view={view}
        writing={props.writing}
        open={asking}
        onOpenChange={setAsking}
      />
    </>
  );
}

/** New ticket on an Active epic, and Edit for a reader who may write epics. */
function epicHeaderActions(
  held: EpicPageHeld,
  view: EpicViewResponse,
  text: CopyText,
): readonly PageHeaderAction[] {
  return [
    ...(view.visibility === "Active"
      ? [
          {
            label: text({ id: "epics-new-ticket" }),
            link: {
              to: "/$tenant/$project/tickets/new",
              params: held.partition,
              search: { epic: view.number },
            },
          } satisfies PageHeaderAction,
        ]
      : []),
    ...(held.writing
      ? [
          {
            label: text({ id: "ui-edit" }),
            link: {
              to: "/$tenant/$project/epics/$epic/edit",
              params: { ...held.partition, epic: String(view.number) },
            },
          } satisfies PageHeaderAction,
        ]
      : []),
  ];
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

/** Each escalated member. */
function EpicHeaderNotes(props: {
  readonly held: EpicPageHeld;
  readonly writing: EpicHeaderWriting;
}): ReactNode {
  const text = useCopyText();
  const { partition } = props.held;
  const graph = readValue(props.held.graphState);
  const escalated = (graph?.nodes ?? []).filter(
    (node) => node.member && node.phase === "Escalated",
  );
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
      {props.writing.error === null ? null : (
        <p className="notice notice-danger notice-inline" role="alert">
          <ConsoleWriteRefusedWords refused={props.writing.error} />
        </p>
      )}
    </div>
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
    <PageHeader
      title={view.title}
      number={view.number}
      {...(view.summary === undefined ? {} : { description: view.summary })}
      status={
        <>
          <EpicStatusChip status={view.status} />
          {view.visibility === "Archived" ? (
            <Pill tone="retired">
              {text({ id: "epics-visibility-archived" })}
            </Pill>
          ) : null}
        </>
      }
      statusCondensed={<EpicStatusChip status={view.status} />}
      secondary={epicHeaderActions(held, view, text)}
      overflow={<EpicHeaderMenu held={held} view={view} writing={writing} />}
    >
      <EpicProgressPage progress={view.progress} />
      <EpicHeaderNotes held={held} writing={writing} />
    </PageHeader>
  );
}
