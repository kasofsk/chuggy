/**
 * One exchange drawn as a chat turn: the member's bubble on the right, the
 * assistant's answer flush left, and one quiet line under it.
 *
 * A TURN NOBODY HAS ANSWERED DRAWS NO ANSWER BLOCK. The parts primitive draws
 * an empty part where a running message holds no content, so the answer is
 * asked for only once there is one: an exchange still running is its work card
 * and its meta line, and nothing between them.
 *
 * Both halves stack with a column flex and neither draws a gutter beside the
 * text, so an exchange is the same shape in a pane as on a page and the words
 * take the whole width wherever it is drawn.
 */

import { MessagePrimitive, useAuiState } from "@assistant-ui/react";
import type { TextMessagePartComponent } from "@assistant-ui/react";
import { Fragment } from "react";
import type { ReactNode } from "react";

import { ticketReferenceSplit } from "../../../../../src/contract/ticketReference.ts";
import type { ConversationExchange } from "../../core/conversation.ts";
import { threadTurnKindWord } from "../../core/threads.ts";
import { TicketReference } from "../ui/TicketReference.tsx";
import { MarkdownReport } from "../ui/MarkdownReport.tsx";
import { Notice } from "../ui/Notice.tsx";
import { ConversationCard } from "./ConversationCard.tsx";
import {
  ConversationMetaLine,
  ConversationSystemLine,
  conversationMarkerWords,
} from "./ConversationLines.tsx";
import { ConversationWorkCard } from "./ConversationWorkCard.tsx";

import "./conversation.css";

/** What one message carries of the exchange it is half of. */
export interface ConversationCustom {
  readonly exchange: ConversationExchange;
  readonly side: "Ask" | "Answer";
}

function conversationHeld(custom: unknown): ConversationExchange | undefined {
  if (custom === null || typeof custom !== "object") return undefined;
  return (custom as Partial<ConversationCustom>).exchange;
}

function useConversationExchange(): ConversationExchange | undefined {
  return useAuiState((state) =>
    conversationHeld(state.message.metadata.custom),
  );
}

/**
 * The member's own words are not marked-up text and are never read as any, so
 * the only thing drawn out of them is a ticket they named — which they named by
 * picking it out of the composer's own list, and would not expect to read back
 * as brackets.
 */
const ConversationSaid: TextMessagePartComponent = (props) => (
  <>
    {ticketReferenceSplit(props.text).map((segment, at) =>
      segment.kind === "Text" ? (
        <Fragment key={at}>{segment.text}</Fragment>
      ) : (
        <TicketReference key={at} ticket={segment.ticket} />
      ),
    )}
  </>
);

/** The report gives up its own panel here: what it sits on is already a
 * surface, and a box inside a box is width the words need more. */
const ConversationReport: TextMessagePartComponent = (props) => (
  <MarkdownReport text={props.text} bare />
);

/** The member's own words, on the right, as they were typed — with the block
 * the server composed in front of a thread's first message folded away above
 * them, because they neither typed it nor asked to read it. */
function ConversationBubble(props: {
  readonly context: string | undefined;
}): ReactNode {
  return (
    <div className="flex flex-col items-end gap-2">
      {props.context === undefined ? null : (
        <ConversationCard label="Context">
          <MarkdownReport text={props.context} bare />
        </ConversationCard>
      )}
      <div className="bg-bubble rounded-3 max-w-[85%] px-4 py-3 wrap-anywhere whitespace-pre-wrap">
        <MessagePrimitive.Parts components={{ Text: ConversationSaid }} />
      </div>
    </div>
  );
}

/** The line every ask nobody typed opens on, and the record of it a reader can
 * still choose to read — the same card the seeding's `Context` uses. */
function ConversationObservation(props: {
  readonly text: string | undefined;
}): ReactNode {
  return (
    <>
      <ConversationSystemLine words="Observation" />
      {props.text === undefined ? null : (
        <ConversationCard label="Observation">
          <pre className="max-h-(--height-clip) overflow-auto">
            {props.text}
          </pre>
        </ConversationCard>
      )}
    </>
  );
}

/** The ask half of one exchange: the member's bubble, or the centred line a
 * turn the runtime opened is drawn as — never the document it composed. */
function ConversationAskBody(props: {
  readonly exchange: ConversationExchange;
}): ReactNode {
  const ask = props.exchange.ask;
  if (ask === undefined) return null;
  switch (ask.ask) {
    case "Message":
      return <ConversationBubble context={ask.context} />;
    case "Wake":
      return <ConversationSystemLine words={`${ask.wake} · ${ask.resource}`} />;
    case "Document":
      return <ConversationSystemLine words={threadTurnKindWord(ask.kind)} />;
    case "Observation":
      return <ConversationObservation text={ask.text} />;
    case "Inquiry":
      return <ConversationSystemLine words="Inquiry" />;
  }
}

/** The ask, with whatever the record could not draw standing above it. */
export function ConversationAskMessage(): ReactNode {
  const exchange = useConversationExchange();
  if (exchange === undefined) return null;
  return (
    <MessagePrimitive.Root className="flex flex-col gap-3">
      {exchange.before.map((marker, at) => (
        <ConversationSystemLine
          key={at}
          words={conversationMarkerWords(marker)}
          ruled
        />
      ))}
      <ConversationAskBody exchange={exchange} />
    </MessagePrimitive.Root>
  );
}

/** The answer half of one exchange: what it took, what came back, and where it
 * ended up. */
export function ConversationAnswerMessage(): ReactNode {
  const exchange = useConversationExchange();
  if (exchange === undefined) return null;
  const standing = exchange.standing;
  if (standing.standing === "Markers") return null;
  return (
    <MessagePrimitive.Root className="flex flex-col gap-3">
      <ConversationWorkCard
        work={exchange.work}
        running={standing.standing === "Running"}
      />
      {standing.standing === "Failed" && standing.failure !== undefined ? (
        <Notice tone="danger" detail={standing.failure} />
      ) : null}
      {exchange.answer === undefined ? null : (
        <MessagePrimitive.Parts components={{ Text: ConversationReport }} />
      )}
      <ConversationMetaLine standing={standing} measures={exchange.measures} />
    </MessagePrimitive.Root>
  );
}
