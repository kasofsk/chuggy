/**
 * The epic page's Tickets tab: its members grouped by where each stands, each
 * group in the order the work will happen, under a box that filters them by
 * number or title. A row is its state's mark, its number and its title, what
 * unfinished it comes after and how many members wait on it, and its state,
 * which on a ready row is the ticket list's dispatch.
 *
 * On an Active epic a reader who may write epics adds tickets here and takes
 * one out from its row's menu, each one revision sent at the revision the page
 * read; one refused as stale reads the epic again.
 */

import { DropdownMenu } from "radix-ui";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import type { Copy } from "../../core/copy.ts";
import {
  epicTicketsGrouped,
  epicTicketsMembersOf,
  epicTicketsRemoved,
} from "../../core/epicTickets.ts";
import type {
  EpicTicketsGroup,
  EpicTicketsMember,
} from "../../core/epicTickets.ts";
import { projectTableRow } from "../../core/projectTableRows.ts";
import { ticketStateLabelOf } from "../../core/ticketHeader.ts";
import type { TicketStateStanding } from "../../core/ticketHeader.ts";
import { ConsoleWriteRefusedWords } from "../consoleWrite.tsx";
import { PanelUnready } from "../DataPanel.tsx";
import { TicketListState } from "../ProjectTable.tsx";
import { TicketRowDispatchScope } from "../TicketActions.tsx";
import { TicketTitleNumber, TicketTitleWords } from "../TicketCells.tsx";
import {
  TicketStateMark,
  TicketStateWord,
} from "../ticket/TicketStateLabel.tsx";
import { readValue } from "../ticket/TicketPageHeld.tsx";
import { buttonLookClassName } from "../ui/Button.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Input } from "../ui/Input.tsx";
import { MenuContent, menuItemClassName } from "../ui/Menu.tsx";
import { EpicTicketsAdd } from "./EpicTicketsAdd.tsx";
import { useEpicPageHeld } from "./EpicPageHeld.tsx";
import { useEpicTicketsWriting } from "./epicTicketsWriting.ts";

import "../ProjectTable.css";
import "./epicTickets.css";

/** The standing a group's head is drawn by: Running is drawn as work is. */
const epicTicketsGroupStandings: Readonly<
  Record<EpicTicketsGroup, TicketStateStanding>
> = {
  Escalated: "Escalated",
  Running: "Work",
  Ready: "Ready",
  Blocked: "Blocked",
  Draft: "Draft",
  Done: "Done",
  Revoked: "Revoked",
};

function epicTicketsGroupWord(group: EpicTicketsGroup): Copy {
  return group === "Running"
    ? { id: "epics-tickets-running" }
    : ticketStateLabelOf(epicTicketsGroupStandings[group]).word;
}

/** What unfinished the member comes after, each a link, and how many members
 * wait on it. */
function EpicTicketsMeta(props: {
  readonly partition: PartitionIdentity;
  readonly member: EpicTicketsMember;
}): ReactNode {
  const text = useCopyText();
  const { after, blocks } = props.member;
  const blocking = blocks !== undefined && blocks > 0;
  if (after.length === 0 && !blocking) return null;
  return (
    <p className="epic-tickets-meta">
      {after.length === 0 ? null : (
        <span>
          {text({ id: "epics-tickets-after" })}{" "}
          {after.map((ticket, at) => (
            <span key={ticket} className="epic-tickets-after">
              {at === 0 ? null : ", "}
              <TicketTitleNumber partition={props.partition} ticket={ticket} />
            </span>
          ))}
        </span>
      )}
      {after.length > 0 && blocking ? " · " : null}
      {blocking ? (
        <span>
          {text({
            id: "epics-tickets-blocks",
            args: { count: String(blocks) },
          })}
        </span>
      ) : null}
    </p>
  );
}

/** The member's state as its word, which on a ready row is the ticket list's
 * chip with its dispatch where the reader may dispatch it. */
function EpicTicketsState(props: {
  readonly partition: PartitionIdentity;
  readonly member: EpicTicketsMember;
}): ReactNode {
  const { member } = props;
  const { row } = member;
  const word = <TicketStateWord standing={member.standing} />;
  if (row === undefined || member.standing !== "Ready") return word;
  return (
    <TicketRowDispatchScope
      partition={props.partition}
      ticket={row.ticket}
      sequence={row.sequence}
    >
      {(dispatch, notes) =>
        dispatch === undefined ? (
          word
        ) : (
          <>
            <TicketListState row={row} dispatch={dispatch} />
            <span className="epic-tickets-notes">{notes}</span>
          </>
        )
      }
    </TicketRowDispatchScope>
  );
}

function EpicTicketsMenuMark(): ReactNode {
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

/** The row's ⋯ menu, whose Remove from epic is sent as soon as it is chosen. */
function EpicTicketsRowMenu(props: {
  readonly ticket: number;
  readonly onRemove: () => void;
  readonly busy: boolean;
}): ReactNode {
  const text = useCopyText();
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger
        className={buttonLookClassName({ variant: "quiet", size: "icon" })}
        aria-label={text({
          id: "epics-tickets-menu",
          args: { ticket: String(props.ticket) },
        })}
      >
        <EpicTicketsMenuMark />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <MenuContent sideOffset={4} align="end">
          <DropdownMenu.Item
            className={menuItemClassName}
            disabled={props.busy}
            onSelect={props.onRemove}
          >
            {text({ id: "epics-tickets-remove" })}
          </DropdownMenu.Item>
        </MenuContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function EpicTicketsRow(props: {
  readonly partition: PartitionIdentity;
  readonly member: EpicTicketsMember;
  readonly onRemove: (() => void) | undefined;
  readonly busy: boolean;
}): ReactNode {
  const { partition, member } = props;
  return (
    <li
      className="epic-tickets-row"
      data-ticket={member.ticket}
      data-standing={member.standing}
    >
      <span className="epic-tickets-mark">
        <TicketStateMark standing={member.standing} />
      </span>
      <span className="epic-tickets-number">
        <TicketTitleNumber partition={partition} ticket={member.ticket} />
      </span>
      <div className="epic-tickets-body">
        <h4 className="epic-tickets-title">
          <TicketTitleWords
            partition={partition}
            ticket={member.ticket}
            title={member.title}
          />
        </h4>
        <EpicTicketsMeta partition={partition} member={member} />
      </div>
      <span className="epic-tickets-state">
        <EpicTicketsState partition={partition} member={member} />
      </span>
      {props.onRemove === undefined ? null : (
        <span className="epic-tickets-actions">
          <EpicTicketsRowMenu
            ticket={member.ticket}
            onRemove={props.onRemove}
            busy={props.busy}
          />
        </span>
      )}
    </li>
  );
}

function EpicTicketsGroupList(props: {
  readonly partition: PartitionIdentity;
  readonly group: EpicTicketsGroup;
  readonly members: readonly EpicTicketsMember[];
  readonly onRemove: ((ticket: number) => void) | undefined;
  readonly busy: boolean;
}): ReactNode {
  const text = useCopyText();
  const word = text(epicTicketsGroupWord(props.group));
  const count = props.members.length;
  const { onRemove } = props;
  return (
    <section className="epic-tickets-group" data-group={props.group}>
      <h3 className="epic-tickets-group-head">
        <TicketStateMark standing={epicTicketsGroupStandings[props.group]} />
        <span>{word}</span>
        <span className="ticket-tab-count">{count}</span>
      </h3>
      <ul
        className="epic-tickets-rows"
        aria-label={text({
          id: "epics-tickets-group",
          args: { word, count: String(count) },
        })}
      >
        {props.members.map((member) => (
          <EpicTicketsRow
            key={member.ticket}
            partition={props.partition}
            member={member}
            busy={props.busy}
            onRemove={
              onRemove === undefined
                ? undefined
                : () => {
                    onRemove(member.ticket);
                  }
            }
          />
        ))}
      </ul>
    </section>
  );
}

/** The filter, and what may be added beside it. */
function EpicTicketsBar(props: {
  readonly typed: string;
  readonly onTyped: (typed: string) => void;
  readonly children: ReactNode;
}): ReactNode {
  const text = useCopyText();
  const label = text({ id: "epics-tickets-filter" });
  return (
    <div className="epic-tickets-bar">
      <span className="epic-tickets-filter">
        <Input
          label={label}
          placeholder={label}
          value={props.typed}
          onChange={props.onTyped}
        />
      </span>
      {props.children}
    </div>
  );
}

export function EpicTicketsTab(): ReactNode {
  const held = useEpicPageHeld();
  const text = useCopyText();
  const [typed, setTyped] = useState("");
  const [adding, setAdding] = useState(false);
  const tickets = useEpicTicketsWriting(held.partition);
  const view = readValue(held.epicState);
  if (view === undefined) return <PanelUnready state={held.epicState} />;
  const changing = held.writing && view.visibility === "Active";
  const rows = new Map(
    (readValue(held.rowsState)?.tickets ?? []).map((ticket) => [
      ticket.ticket,
      projectTableRow(ticket),
    ]),
  );
  const members = epicTicketsMembersOf(
    view.tickets,
    rows,
    readValue(held.graphState),
  );
  const groups = epicTicketsGrouped(members, typed);
  const { writing } = tickets;
  const onRemove = changing
    ? (ticket: number) => {
        const request = epicTicketsRemoved(view, ticket);
        if (request !== undefined) tickets.send(request);
      }
    : undefined;
  return (
    <section
      className="epic-tickets"
      aria-label={text({ id: "epics-tab-tickets" })}
    >
      <EpicTicketsBar typed={typed} onTyped={setTyped}>
        {changing ? (
          <EpicTicketsAdd
            partition={held.partition}
            view={view}
            tickets={tickets}
            open={adding}
            onOpenChange={setAdding}
          />
        ) : null}
      </EpicTicketsBar>
      {writing.error === null || adding ? null : (
        <p className="notice notice-danger notice-inline" role="alert">
          <ConsoleWriteRefusedWords refused={writing.error} />
        </p>
      )}
      {view.tickets.length === 0 ? (
        <EmptyState label={text({ id: "epics-tickets-none" })} />
      ) : groups.length === 0 ? (
        <EmptyState label={text({ id: "epics-tickets-no-match" })} />
      ) : (
        groups.map((group) => (
          <EpicTicketsGroupList
            key={group.group}
            partition={held.partition}
            group={group.group}
            members={group.members}
            onRemove={onRemove}
            busy={writing.isPending}
          />
        ))
      )}
    </section>
  );
}
