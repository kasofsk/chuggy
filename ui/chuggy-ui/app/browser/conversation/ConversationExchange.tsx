/**
 * One exchange drawn as a chat turn: the member's bubble on the right, the
 * assistant flush left behind its mark, and one quiet line under the answer.
 *
 * A TURN NOBODY HAS ANSWERED DRAWS NO ANSWER BLOCK. The parts primitive draws
 * an empty part where a running message holds no content, so the answer is
 * asked for only once there is one: an exchange still running is its work card
 * and its meta line, and nothing between them.
 */

import { MessagePrimitive, useAuiState } from "@assistant-ui/react";
import type { TextMessagePartComponent } from "@assistant-ui/react";
import type { ReactNode } from "react";

import type { ConversationExchange } from "../../core/conversation.ts";
import { threadTurnKindWord } from "../../core/threads.ts";
import { MarkdownReport } from "../ui/MarkdownReport.tsx";
import { Notice } from "../ui/Notice.tsx";
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

const ConversationSaid: TextMessagePartComponent = (props) => <>{props.text}</>;

const ConversationReport: TextMessagePartComponent = (props) => (
  <MarkdownReport text={props.text} />
);

/** The member's own words, on the right, as they were typed. */
function ConversationBubble(): ReactNode {
  return (
    <div className="grid min-w-0 justify-items-end">
      <div className="bg-bubble rounded-3 max-w-3/4 px-4 py-3 whitespace-pre-wrap">
        <MessagePrimitive.Parts components={{ Text: ConversationSaid }} />
      </div>
    </div>
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
      return <ConversationBubble />;
    case "Wake":
      return <ConversationSystemLine words={`${ask.wake} · ${ask.resource}`} />;
    case "Document":
      return <ConversationSystemLine words={threadTurnKindWord(ask.kind)} />;
    case "Observation":
      return <ConversationSystemLine words="Observation" />;
    case "Inquiry":
      return <ConversationSystemLine words="Inquiry" />;
  }
}

/** The ask, with whatever the record could not draw standing above it. */
export function ConversationAskMessage(): ReactNode {
  const exchange = useConversationExchange();
  if (exchange === undefined) return null;
  return (
    <MessagePrimitive.Root className="grid min-w-0 gap-3">
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

/** The mark the assistant's side of the column is read by, at the column's
 * left edge where a chat puts it. */
function ConversationMark(): ReactNode {
  return (
    <span
      className="conversation-round bg-surface-inverse text-ink-inverse flex size-5 shrink-0 items-center justify-center text-xs"
      aria-hidden="true"
    >
      c
    </span>
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
    <MessagePrimitive.Root className="grid min-w-0 grid-cols-[auto_1fr] gap-3">
      <ConversationMark />
      <div className="grid min-w-0 gap-3">
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
        <ConversationMetaLine
          standing={standing}
          measures={exchange.measures}
        />
      </div>
    </MessagePrimitive.Root>
  );
}
