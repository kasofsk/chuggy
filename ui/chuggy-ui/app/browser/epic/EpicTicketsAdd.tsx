/**
 * Add tickets: a dialog that finds tickets by number or title with the ticket
 * list's own search, and adds the chosen ones to the epic in one revision at
 * the revision the page read. A ticket the epic already holds is drawn held
 * and cannot be chosen again.
 */

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import type { EpicViewResponse } from "../../../../../src/contract/responses.ts";
import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import { epicTicketsAdded } from "../../core/epicTickets.ts";
import { ticketListAskDefault } from "../../core/projectTableFilters.ts";
import {
  ticketListSearchOf,
  ticketListSearchWaitMs,
} from "../../core/ticketListView.ts";
import { ticketRowsQuery } from "../../core/ticketQueries.ts";
import { usePanelState } from "../api.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { readValue } from "../ticket/TicketPageHeld.tsx";
import { Button } from "../ui/Button.tsx";
import { Checkbox } from "../ui/Checkbox.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Input } from "../ui/Input.tsx";
import type { EpicTicketsWriting } from "./epicTicketsWriting.ts";

/** What was typed, once it has stood long enough to be asked. */
function useEpicTicketsAddSearch(typed: string): string | undefined {
  const [asked, setAsked] = useState<string | undefined>(undefined);
  useEffect(() => {
    const search = ticketListSearchOf(typed);
    const waiting = setTimeout(() => {
      setAsked(search);
    }, ticketListSearchWaitMs);
    return () => {
      clearTimeout(waiting);
    };
  }, [typed]);
  return asked;
}

/** The tickets a search found, each a box to choose it by. */
function EpicTicketsAddFound(props: {
  readonly partition: PartitionIdentity;
  readonly search: string;
  readonly members: ReadonlySet<number>;
  readonly chosen: ReadonlySet<number>;
  readonly onChosen: (ticket: number, chosen: boolean) => void;
}): ReactNode {
  const text = useCopyText();
  const state = usePanelState(
    ticketRowsQuery(props.partition, {
      ...ticketListAskDefault,
      search: props.search,
    }),
  );
  const found = readValue(state)?.tickets;
  if (found === undefined) return <PanelUnready state={state} />;
  if (found.length === 0)
    return (
      <EmptyState
        variant="inline"
        label={text({ id: "epics-tickets-add-none" })}
      />
    );
  return (
    <ul
      className="grid gap-1"
      aria-label={text({ id: "epics-tickets-add-search" })}
    >
      {found.map((ticket) => {
        const member = props.members.has(ticket.ticket);
        const label = `#${String(ticket.ticket)} ${ticket.title ?? ""}`;
        return (
          <li key={ticket.ticket} className="epic-tickets-found">
            <Checkbox
              label={label}
              checked={member || props.chosen.has(ticket.ticket)}
              disabled={member}
              onChange={(checked) => {
                props.onChosen(ticket.ticket, checked);
              }}
            />
            {member ? (
              <span className="epic-tickets-found-member">
                {text({ id: "epics-tickets-add-member" })}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function epicTicketsAddChosen(
  chosen: ReadonlySet<number>,
  ticket: number,
  checked: boolean,
): ReadonlySet<number> {
  const next = new Set(chosen);
  if (checked) next.add(ticket);
  else next.delete(ticket);
  return next;
}

/** Cancel, and Add naming how many were chosen. */
function EpicTicketsAddFoot(props: {
  readonly chosen: number;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onAdd: () => void;
}): ReactNode {
  const text = useCopyText();
  return (
    <>
      <Button onClick={props.onCancel}>{text({ id: "ui-cancel" })}</Button>
      <Button
        variant="primary"
        disabled={props.chosen === 0 || props.busy}
        onClick={props.onAdd}
      >
        {text({
          id: "epics-tickets-add-chosen",
          args: { count: props.chosen },
        })}
      </Button>
    </>
  );
}

export function EpicTicketsAdd(props: {
  readonly partition: PartitionIdentity;
  readonly view: EpicViewResponse;
  readonly tickets: EpicTicketsWriting;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): ReactNode {
  const text = useCopyText();
  const [typed, setTyped] = useState("");
  const [chosen, setChosen] = useState<ReadonlySet<number>>(new Set());
  const search = useEpicTicketsAddSearch(typed);
  const { writing, send } = props.tickets;
  const opened = (open: boolean): void => {
    if (open) {
      setTyped("");
      setChosen(new Set());
      writing.reset();
    }
    props.onOpenChange(open);
  };
  const request =
    chosen.size === 0 ? undefined : epicTicketsAdded(props.view, [...chosen]);
  return (
    <Dialog
      title={text({ id: "epics-tickets-add" })}
      trigger={text({ id: "epics-tickets-add" })}
      open={props.open}
      onOpenChange={opened}
      busy={writing.isPending}
      note={writing.error?.message}
      foot={
        <EpicTicketsAddFoot
          chosen={chosen.size}
          busy={writing.isPending}
          onCancel={() => {
            opened(false);
          }}
          onAdd={() => {
            if (request !== undefined)
              send(request, () => {
                opened(false);
              });
          }}
        />
      }
    >
      <Input
        label={text({ id: "epics-tickets-add-search" })}
        placeholder={text({ id: "epics-tickets-add-search" })}
        value={typed}
        onChange={setTyped}
        autoFocus
      />
      {search === undefined ? null : (
        <EpicTicketsAddFound
          partition={props.partition}
          search={search}
          members={new Set(props.view.tickets)}
          chosen={chosen}
          onChosen={(ticket, checked) => {
            setChosen(epicTicketsAddChosen(chosen, ticket, checked));
          }}
        />
      )}
    </Dialog>
  );
}
