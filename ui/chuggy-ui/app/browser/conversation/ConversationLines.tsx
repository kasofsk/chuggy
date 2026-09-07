/**
 * The quiet lines of a conversation: what opened a turn nobody typed, what the
 * record could not draw, and where the answer ended up.
 */

import { Link } from "@tanstack/react-router";
import { Fragment } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type {
  ConversationMarker,
  ConversationMeasures,
  ConversationStanding,
} from "../../core/conversation.ts";
import type { ConversationExchangeTicket } from "../../core/conversationTickets.ts";
import type { Figure as FigureValue } from "../../core/figures.ts";
import {
  costAmountFigure,
  durationFigure,
  tokenCountUnitFigure,
} from "../../core/figures.ts";
import { runCountLabel } from "../../core/runTotals.ts";
import { conversationStandingArm } from "../../core/tones.ts";
import { Figure } from "../ui/Figure.tsx";

/** Where an exchange the surface draws stands, which is every arm but the one
 * carrying markers alone. */
export type ConversationStandingDrawn = Exclude<
  ConversationStanding,
  { readonly standing: "Markers" }
>;

/**
 * A centred line that belongs to neither speaker. `ruled` draws a hairline
 * through it, which is what separates a fact about the record from a turn the
 * runtime opened.
 */
export function ConversationSystemLine(props: {
  readonly words: string;
  readonly ruled?: boolean;
}): ReactNode {
  const rule =
    props.ruled === true ? (
      <span className="border-edge grow border-t" aria-hidden="true" />
    ) : null;
  return (
    <p className="text-ink-3 flex items-center justify-center gap-3 text-xs">
      {rule}
      <span>{props.words}</span>
      {rule}
    </p>
  );
}

/** One marker in the words the lead's panels already say it in. */
export function conversationMarkerWords(marker: ConversationMarker): string {
  switch (marker.marker) {
    case "Compaction":
      return "Compaction";
    case "Elision":
      return `Elided · ${runCountLabel(marker.bytes)} bytes`;
    case "Capped":
      return marker.sentence;
    case "Unreadable":
      return "Unreadable";
    case "Failure":
      return `Failed · ${marker.reason}`;
    case "Truncated":
      return "Truncated";
    case "Dropped":
      return `Dropped · ${runCountLabel(marker.count)}`;
    case "Unreached":
      return "Not reached";
    case "Unlisted":
      return "Stream unlisted";
    case "NoStore":
      return "No store";
  }
}

/** The two arms a reader must not mistake for a settled turn keep their hue;
 * a settled one is as quiet as the measures beside it. */
function conversationStandingInk(standing: ConversationStandingDrawn): string {
  switch (standing.standing) {
    case "Failed":
      return "text-tone-fail";
    case "Running":
    case "Open":
      return "text-tone-live";
    case "Answered":
    case "Abandoned":
      return "text-ink-3";
  }
}

function conversationMetaFigures(
  measures: ConversationMeasures | undefined,
): readonly FigureValue[] {
  if (measures === undefined) return [];
  return [
    ...(measures.tokens === undefined
      ? []
      : [tokenCountUnitFigure(measures.tokens)]),
    ...(measures.costMicros === undefined
      ? []
      : [costAmountFigure(measures.costMicros)]),
    ...(measures.durationMs === undefined
      ? []
      : [durationFigure(measures.durationMs)]),
  ];
}

/**
 * Where the exchange ended and what it took, on one line under the answer. A
 * measure nothing recorded is left out rather than drawn as an absence: this is
 * a timestamp, not a ledger row, and a row of dashes reads as a fault.
 */
export function ConversationMetaLine(props: {
  readonly standing: ConversationStandingDrawn;
  readonly measures: ConversationMeasures | undefined;
}): ReactNode {
  return (
    <p className="text-ink-3 flex flex-wrap items-baseline gap-2 text-xs">
      <span className={conversationStandingInk(props.standing)}>
        {conversationStandingArm(props.standing).word}
      </span>
      {conversationMetaFigures(props.measures).map((figure, at) => (
        <Fragment key={at}>
          <span aria-hidden="true">·</span>
          <Figure figure={figure} />
        </Fragment>
      ))}
    </p>
  );
}

/** One ticket a call touched, as a link where the surface holds a partition
 * and as text where it does not — which is what keeps the surface mountable
 * with no router. */
function ConversationTicketNumber(props: {
  readonly partition: PartitionIdentity | undefined;
  readonly ticket: number;
}): ReactNode {
  return props.partition === undefined ? (
    <span>{props.ticket}</span>
  ) : (
    <Link
      to="/$tenant/$project/tickets/$ticket"
      params={{ ...props.partition, ticket: String(props.ticket) }}
    >
      {props.ticket}
    </Link>
  );
}

/**
 * Which tickets the exchange's work touched and what was done to each, one
 * quiet line beside the meta line so a reader sees what a filing tool call
 * filed without opening the work card's disclosures.
 */
export function ConversationTicketsLine(props: {
  readonly tickets: readonly ConversationExchangeTicket[];
  readonly partition: PartitionIdentity | undefined;
}): ReactNode {
  if (props.tickets.length === 0) return null;
  return (
    <p className="text-ink-3 flex flex-wrap items-baseline gap-2 text-xs">
      {props.tickets.map((ticket, at) => (
        <Fragment key={at}>
          {at === 0 ? null : <span aria-hidden="true">·</span>}
          <span>{ticket.verb}</span>
          <ConversationTicketNumber
            partition={props.partition}
            ticket={ticket.ticket}
          />
        </Fragment>
      ))}
    </p>
  );
}
