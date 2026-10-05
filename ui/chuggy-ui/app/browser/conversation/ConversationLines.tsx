/**
 * The quiet lines of a conversation: what opened a turn nobody typed, what the
 * record could not draw, and where the answer ended up.
 *
 * THE LINE UNDER AN ANSWER IS THERE FROM THE TURN'S FIRST MOMENT TO ITS LAST,
 * and is as tall with a glyph in it as with a control, so the turn settling
 * moves nothing above it or below.
 *
 * IT SPEAKS ONLY WHERE NOTHING ELSE ON THE ANSWER DOES. While the engine runs,
 * a part of the work names what is under way or text is being let out, that is
 * where a reader is looking and the line shows nothing. It says `Working` for a
 * turn that has begun and that nothing else is drawn as the doing of.
 *
 * A WORD FOR WAITING IS SAID ONCE THE WAIT HAS LASTED. A turn is queued and
 * started in less than a reader takes to read either word on most sends, so
 * each is drawn only when it has stood longer than a glance, and comes in
 * slowly then, so a wait that ends as its word is due shows no word. A turn no
 * runner can take now is not passing through that state, and says so at once.
 *
 * THE ANSWER IS THERE TO COPY AS SOON AS ITS LAST CHARACTER IS DRAWN. The
 * runner goes on listening after a turn's last message is whole, and the turn
 * can still fail there, so from then to its settling the line says neither
 * that the turn is working nor how it ended; what it took arrives beside the
 * control when the mailbox says.
 *
 * THE WORD IS A STATUS. A reader who cannot see the text arriving is told when
 * the turn begins to work and when it is answered, and of no word in between.
 */

import { Fragment, useEffect, useState } from "react";
import type { ReactNode } from "react";

import {
  conversationExchangeBegun,
  conversationExchangeDoing,
  conversationExchangeSaid,
} from "../../core/conversation.ts";
import type {
  ConversationDoing,
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
    case "Stopped":
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

/** How long a turn waits in one state before the line says which. */
export const conversationWaitWordAfterMs = 3000;

/** Whether the word a turn is waiting in has stood longer than a glance. */
function useConversationWaitLasted(word: string | undefined): boolean {
  const [lasted, setLasted] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (word === undefined) return undefined;
    const waiting = setTimeout(() => {
      setLasted(word);
    }, conversationWaitWordAfterMs);
    return () => {
      clearTimeout(waiting);
      setLasted(undefined);
    };
  }, [word]);
  return word !== undefined && lasted === word;
}

/** What stands at the head of the line: the answer to copy, a glyph that is
 * or is not the one thing moving, or the place kept for either. */
type ConversationMetaLead = "Copy" | "Live" | "Still" | "Kept";

interface ConversationMetaDrawn {
  readonly lead: ConversationMetaLead;
  /** The status, and whether a reader who can see is shown it. */
  readonly word: string | undefined;
  readonly worded: boolean;
}

/** What the line says of a turn that is out, which is nothing a reader sees
 * while something else on the answer shows what is under way. */
function conversationMetaRunning(
  doing: Exclude<ConversationDoing, { readonly doing: "Settled" }>,
  word: string,
  shown: {
    readonly live: boolean;
    readonly marked: boolean;
    readonly engine: boolean;
    readonly lasted: boolean;
    readonly copies: boolean;
  },
): ConversationMetaDrawn {
  const unsaid = { word: undefined, worded: false };
  switch (doing.doing) {
    case "Whole":
      return {
        lead: shown.copies && !shown.marked ? "Copy" : "Kept",
        ...unsaid,
      };
    case "Unbegun": {
      const said = shown.lasted ? { word, worded: true } : unsaid;
      if (shown.live && !shown.engine) return { lead: "Live", ...said };
      return { lead: shown.lasted ? "Still" : "Kept", ...said };
    }
    case "Work":
    case "Text":
      return { lead: "Kept", word, worded: false };
    case "Unnamed":
      if (shown.marked) return { lead: "Kept", word, worded: false };
      return { lead: shown.live ? "Live" : "Still", word, worded: true };
  }
}

function ConversationMetaLeadDrawn(props: {
  readonly lead: ConversationMetaLead;
  readonly said: string | undefined;
  readonly running: boolean;
}): ReactNode {
  if (props.lead === "Copy" && props.said !== undefined)
    return <CopyButton text={props.said} label="Copy answer" />;
  return (
    <ConversationGlyph filled={props.running} live={props.lead === "Live"} />
  );
}

const conversationMetaThere = "conversation-meta text-ink-3 text-xs";

/** The line whose word came in after a wait, which the sheet brings in slowly. */
const conversationMetaWaited =
  "conversation-meta conversation-meta-waited text-ink-3 text-xs";

/**
 * Where the exchange stands and what it took, on one line under the answer. A
 * measure nothing recorded is left out rather than drawn as an absence: this is
 * a timestamp, not a ledger row, and a row of dashes reads as a fault.
 */
export function ConversationMetaLine(props: {
  readonly exchange: ConversationExchange;
  readonly standing: ConversationStandingDrawn;
  /** Whether this exchange holds the one thing on the surface that moves. */
  readonly live: boolean;
  /** Whether text of the answer is still being let out. */
  readonly marked: boolean;
  /** Whether the engine is what runs for a turn nothing is drawn of. */
  readonly engine: boolean;
}): ReactNode {
  const { exchange, standing } = props;
  const doing = conversationExchangeDoing(exchange);
  const said = conversationExchangeSaid(exchange);
  const copies = useCopyHeld() !== undefined && said !== undefined;
  const arm = conversationStandingArm(
    standing,
    conversationExchangeBegun(exchange),
  );
  const parked =
    standing.standing === "Running" && standing.state === "Waiting";
  const waited = useConversationWaitLasted(
    doing.doing === "Unbegun" && !parked ? arm.word : undefined,
  );
  const lasted = waited || parked;
  const drawn: ConversationMetaDrawn =
    doing.doing === "Settled"
      ? { lead: copies ? "Copy" : "Still", word: arm.word, worded: true }
      : conversationMetaRunning(doing, arm.word, {
          live: props.live,
          marked: props.marked,
          engine: props.engine,
          lasted,
          copies,
        });
  return (
    <div className={waited ? conversationMetaWaited : conversationMetaThere}>
      <span
        className={
          drawn.lead === "Kept"
            ? "conversation-meta-lead invisible"
            : "conversation-meta-lead"
        }
      >
        <ConversationMetaLeadDrawn
          lead={drawn.lead}
          said={said}
          running={standing.standing === "Running"}
        />
      </span>
      <p className="flex flex-wrap items-baseline gap-2">
        <span
          role="status"
          className={
            drawn.worded ? conversationStandingInk(standing) : "visually-hidden"
          }
        >
          {drawn.word ?? null}
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
