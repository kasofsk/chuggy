/**
 * The quiet lines of a conversation: what opened a turn nobody typed, what the
 * record could not draw, and where the answer ended up.
 *
 * THE LINE UNDER AN ANSWER IS THERE FROM THE TURN'S FIRST MOMENT TO ITS LAST,
 * and is as tall with a glyph in it as with a control. While the turn is out
 * it says, in a member's word, what the turn is waiting on; once it settles it
 * says how, offers the answer to copy, and gives what it took — so the turn
 * settling moves nothing above it or below.
 *
 * BETWEEN A TURN'S LAST WORD AND ITS SETTLING THE LINE SAYS NOTHING. The
 * runner goes on listening after the turn's last message is whole, and the
 * turn can still fail there, so the line neither goes on saying the turn is
 * working nor says how it ended. It keeps its place and what stood in it, out
 * of sight, until the mailbox says.
 *
 * THE WORD IS A STATUS. A reader who cannot see the text arriving is told when
 * the turn begins to work and when it is answered, and of no word in between.
 */

import { Fragment } from "react";
import type { ReactNode } from "react";

import {
  conversationExchangeBegun,
  conversationExchangeQuiet,
} from "../../core/conversation.ts";
import type {
  ConversationExchange,
  ConversationMarker,
  ConversationMeasures,
  ConversationStanding,
} from "../../core/conversation.ts";
import type { Figure as FigureValue } from "../../core/figures.ts";
import {
  costAmountFigure,
  durationFigure,
  tokenCountUnitFigure,
} from "../../core/figures.ts";
import { runCountLabel } from "../../core/runTotals.ts";
import { conversationStandingArm } from "../../core/tones.ts";
import { CopyButton } from "../ui/CopyButton.tsx";
import { useCopyHeld } from "../ui/copyHeld.tsx";
import { Figure } from "../ui/Figure.tsx";
import { ConversationGlyph } from "./ConversationCard.tsx";

import "./conversation.css";

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

/** The arms a reader must not mistake for a settled turn keep their hue, a
 * turn waiting on a runner the parked one; a settled one is as quiet as the
 * measures beside it. */
function conversationStandingInk(standing: ConversationStandingDrawn): string {
  switch (standing.standing) {
    case "Failed":
      return "text-tone-fail";
    case "Running":
      return standing.state === "Waiting"
        ? "text-tone-parked"
        : "text-tone-live";
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
 * Where the exchange stands and what it took, on one line under the answer. A
 * measure nothing recorded is left out rather than drawn as an absence: this is
 * a timestamp, not a ledger row, and a row of dashes reads as a fault.
 */
export function ConversationMetaLine(props: {
  readonly exchange: ConversationExchange;
  readonly standing: ConversationStandingDrawn;
  /** Whether the glyph is the one thing on the surface that moves. */
  readonly live: boolean;
}): ReactNode {
  const { exchange, standing } = props;
  const running = standing.standing === "Running";
  const quiet = conversationExchangeQuiet(exchange);
  const copies = useCopyHeld() !== undefined && !running;
  return (
    <div className="conversation-meta text-ink-3 text-xs">
      <span
        className={
          quiet ? "conversation-meta-lead invisible" : "conversation-meta-lead"
        }
      >
        {copies && exchange.answer !== undefined ? (
          <CopyButton text={exchange.answer} label="Copy answer" />
        ) : (
          <ConversationGlyph filled={running} live={running && props.live} />
        )}
      </span>
      <p className="flex flex-wrap items-baseline gap-2">
        <span role="status" className={conversationStandingInk(standing)}>
          {quiet
            ? null
            : conversationStandingArm(
                standing,
                conversationExchangeBegun(exchange),
              ).word}
        </span>
        {conversationMetaFigures(exchange.measures).map((figure, at) => (
          <Fragment key={at}>
            <span aria-hidden="true">·</span>
            <Figure figure={figure} />
          </Fragment>
        ))}
      </p>
    </div>
  );
}
