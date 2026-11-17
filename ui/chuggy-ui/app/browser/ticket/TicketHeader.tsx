/**
 * The head of every tab of the ticket page, drawn through `PageHeader`: the
 * title with its number, the state label with the one fragment beside it and
 * its place in a landing queue where it holds one, the actions, and the epics
 * it belongs to. Once the header has scrolled out of view, the primitive's bar
 * holds the small label and the title in its place.
 */

import type { ReactNode } from "react";

import type { LandingQueuePlace } from "../../core/landingQueues.ts";
import type {
  TicketHeaderFragment,
  TicketStateStanding,
} from "../../core/ticketHeader.ts";
import { LandingQueueChip } from "./LandingQueueChip.tsx";
import { TicketRunMarkDrawn } from "./TicketRunMark.tsx";
import { TicketRunTime } from "./TicketRunTime.tsx";
import { TicketStateLabel } from "./TicketStateLabel.tsx";
import { PageHeader } from "../ui/PageHeader.tsx";

import "./ticket.css";

function TicketHeaderFragmentDrawn(props: {
  readonly fragment: TicketHeaderFragment;
  readonly nowMs: number;
}): ReactNode {
  const fragment = props.fragment;
  switch (fragment.fragment) {
    case "None":
      return null;
    case "Words":
      return <span className="ticket-header-fragment">{fragment.words}</span>;
    case "Running":
      return (
        <span className="ticket-header-fragment">
          {`${fragment.step} · `}
          <TicketRunTime runs={[fragment.run]} nowMs={props.nowMs} />
        </span>
      );
    case "Landed":
      return (
        <span className="ticket-header-fragment">
          <TicketRunMarkDrawn mark="Merge" tone="finalization" />
          {fragment.words}
          {fragment.link === undefined ? null : (
            <>
              {" · "}
              <a
                href={fragment.link.href}
                rel="noopener noreferrer"
                target="_blank"
              >
                {fragment.link.label}
              </a>
            </>
          )}
        </span>
      );
  }
}

export function TicketHeader(props: {
  readonly ticket: number;
  readonly title: string;
  readonly standing: TicketStateStanding;
  readonly fragment: TicketHeaderFragment;
  readonly queued?: LandingQueuePlace | undefined;
  readonly nowMs: number;
  readonly epics: ReactNode;
  readonly actions: ReactNode;
  readonly notes: ReactNode;
}): ReactNode {
  return (
    <PageHeader
      title={props.title}
      number={props.ticket}
      status={
        <>
          <TicketStateLabel standing={props.standing} size="page" />
          <TicketHeaderFragmentDrawn
            fragment={props.fragment}
            nowMs={props.nowMs}
          />
          <LandingQueueChip place={props.queued} />
        </>
      }
      statusCondensed={
        <TicketStateLabel standing={props.standing} size="small" />
      }
      overflow={props.actions}
    >
      {props.epics}
      {props.notes}
    </PageHeader>
  );
}
