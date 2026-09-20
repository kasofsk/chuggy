/**
 * The cells every table of tickets draws the same way.
 *
 * A ticket number is a link to that ticket's page wherever it appears, and the
 * cell spells the route once so a second table is not a second place the path
 * has to change. What a row is waiting on is the same arrangement for a
 * different reason: an empty cell there means nothing is holding the ticket,
 * which is a claim rather than an absence, so it is drawn as words and not as
 * a dash two readers would read two ways.
 */

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { AdoptedTicket } from "../../../../src/contract/adoptedTickets.ts";
import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import {
  adoptedTicketStateLabel,
  adoptedTicketWord,
} from "../core/codeLabels.ts";
import { adoptedTicketStateSentence } from "../core/codeSentences.ts";
import { adoptedTicketStateTone } from "../core/tones.ts";
import { Pill } from "./ui/Pill.tsx";
import { Tooltip } from "./ui/Tooltip.tsx";

/** What an "up next" row says when every ticket it depends on has finished. */
export const cellNothingHolding = "ready";

/** A ticket that has finished, or one that never waited on anything, is not
 * waiting — and neither is a claim about a run. */
export const cellNotWaiting = "—";

function TicketLink(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
}): ReactNode {
  return (
    <Link
      to="/$tenant/$project/tickets/$ticket"
      params={{ ...props.partition, ticket: String(props.ticket) }}
    >
      {adoptedTicketWord(props.ticket)}
    </Link>
  );
}

export function TicketNumberCell(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
}): ReactNode {
  return (
    <th scope="row" className="num">
      <TicketLink partition={props.partition} ticket={props.ticket} />
    </th>
  );
}

/**
 * The tickets still holding this one up, each a link to its own page. A row
 * that could start now says so in the heading's own words; a row in any other
 * section that waits on nothing has nothing to say at all, because "ready" is
 * about a ticket that has not started.
 */
export function TicketWaitingCell(props: {
  readonly partition: PartitionIdentity;
  readonly waitingOn: readonly number[];
  readonly startable: boolean;
}): ReactNode {
  if (props.waitingOn.length === 0)
    return (
      <td className="text-ink-3">
        {props.startable ? cellNothingHolding : cellNotWaiting}
      </td>
    );
  return (
    <td>
      {props.waitingOn.map((ticket, at) => (
        <span key={ticket}>
          {at === 0 ? null : " "}
          <TicketLink partition={props.partition} ticket={ticket} />
        </span>
      ))}
    </td>
  );
}

/**
 * The state, in the word and hue the console draws that state in everywhere,
 * with the line saying what it means for a reader who stops on it. The chip is
 * the `Pill` primitive inside a span of its own, because the tooltip makes its
 * child the trigger and a primitive that takes no ref cannot be one.
 */
export function TicketStateCell(props: {
  readonly state: AdoptedTicket["state"];
}): ReactNode {
  return (
    <td>
      <Tooltip text={adoptedTicketStateSentence(props.state)}>
        <span>
          <Pill tone={adoptedTicketStateTone(props.state)}>
            {adoptedTicketStateLabel(props.state)}
          </Pill>
        </span>
      </Tooltip>
    </td>
  );
}
