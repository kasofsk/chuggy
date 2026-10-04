/**
 * One exchange drawn as a chat turn: the member's bubble on the right, the
 * assistant's answer flush left, and one quiet line under it.
 *
 * A TURN NOBODY HAS ANSWERED DRAWS NO ANSWER BLOCK. The parts primitive draws
 * an empty part where a running message holds no content, so the answer is
 * asked for only once there is one: an exchange still running is its work line
 * and its meta line, and nothing between them.
 *
 * WHAT ARRIVES LATE LANDS IN A PLACE ALREADY HELD. The work's line has its
 * place above every answer and the meta line its place below, whether or not
 * either has anything to say yet, so a step that begins after the words have,
 * and the turn settling, move nothing a reader is looking at.
 *
 * ONE THING MOVES. The surface names the one exchange that may, and within it
 * the mark at the end of the text takes it from the glyph under the answer for
 * as long as text is being let out — which only the part drawing the text
 * knows, so it says so to the line through a state the answer holds.
 *
 * Both halves stack with a column flex and neither draws a gutter beside the
 * text, so an exchange is the same shape in a pane as on a page and the words
 * take the whole width wherever it is drawn.
 *
 * AN ANSWER BEING WRITTEN IS DRAWN BY WHAT DRAWS A FINISHED ONE. The same part
 * and the same report read it at every moment, so the transcript's own copy
 * arriving changes nothing a reader can see. What differs while more is coming
 * is the text handed to them: let out at an even pace, with the marks its last
 * line leaves open closed.
 */

import { MessagePrimitive, useAuiState, useSmooth } from "@assistant-ui/react";
import type { TextMessagePartComponent } from "@assistant-ui/react";
import {
  createContext,
  Fragment,
  useContext,
  useLayoutEffect,
  useState,
} from "react";
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
import type { ConversationStandingDrawn } from "./ConversationLines.tsx";
import { ConversationWorkCard } from "./ConversationWorkCard.tsx";

import "./conversation.css";

/** Whether the surface draws each exchange's work open. */
export const ConversationWorkOpen = createContext(false);

/** Whether the surface lets an answer still being written out at an even
 * pace. */
export const ConversationPaced = createContext(false);

/** The exchange whose answer holds the one thing on the surface that moves,
 * where there is one. */
export const ConversationIndicated = createContext<string | undefined>(
  undefined,
);

const ConversationMarked = createContext(false);

const ConversationMarkedSaid = createContext<(marked: boolean) => void>(
  () => undefined,
);

/** Holds whether an answer's text is carrying the mark, apart from the answer
 * itself so that saying so draws the line under it again and nothing else. */
function ConversationMarkHeld(props: {
  readonly children: ReactNode;
}): ReactNode {
  const [marked, setMarked] = useState(false);
  return (
    <ConversationMarkedSaid.Provider value={setMarked}>
      <ConversationMarked.Provider value={marked}>
        {props.children}
      </ConversationMarked.Provider>
    </ConversationMarkedSaid.Provider>
  );
}

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

/**
 * The report gives up its own panel here: what it sits on is already a
 * surface, and a box inside a box is width the words need more. It is still
 * being written while its block is, and while the pace has yet to catch up
 * with what was heard of it.
 */
const ConversationReport: TextMessagePartComponent = (props) => {
  const paced = useContext(ConversationPaced);
  const activity = useConversationExchange()?.activity?.activity;
  const shown = useSmooth(props, paced);
  const writing =
    activity === "Writing" || shown.text.length < props.text.length;
  const markedSaid = useContext(ConversationMarkedSaid);
  useLayoutEffect(() => {
    markedSaid(writing);
    return () => {
      markedSaid(false);
    };
  }, [markedSaid, writing]);
  return (
    <div className={writing ? "conversation-writing" : undefined}>
      <MarkdownReport text={shown.text} bare writing={writing} />
    </div>
  );
};

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

/** The line under an answer, its glyph moving where this exchange is the one
 * that may and its text is not carrying the mark. */
function ConversationMeta(props: {
  readonly exchange: ConversationExchange;
  readonly standing: ConversationStandingDrawn;
}): ReactNode {
  const indicated = useContext(ConversationIndicated);
  const marked = useContext(ConversationMarked);
  return (
    <ConversationMetaLine
      exchange={props.exchange}
      standing={props.standing}
      live={indicated === props.exchange.id && !marked}
    />
  );
}

/** The answer half of one exchange: what it took, what came back, and where it
 * stands. It is marked busy for as long as its turn is out. */
export function ConversationAnswerMessage(): ReactNode {
  const exchange = useConversationExchange();
  const workOpen = useContext(ConversationWorkOpen);
  if (exchange === undefined) return null;
  const standing = exchange.standing;
  if (standing.standing === "Markers") return null;
  const running = standing.standing === "Running";
  return (
    <MessagePrimitive.Root
      className="conversation-answer flex flex-col gap-3"
      aria-busy={running}
    >
      <ConversationMarkHeld>
        <div className="conversation-work text-sm">
          <ConversationWorkCard
            work={exchange.work}
            running={running}
            activity={exchange.activity}
            open={workOpen}
          />
        </div>
        {standing.standing === "Failed" && standing.failure !== undefined ? (
          <Notice tone="danger" detail={standing.failure} />
        ) : null}
        {exchange.answer === undefined ? null : (
          <MessagePrimitive.Parts components={{ Text: ConversationReport }} />
        )}
        <ConversationMeta exchange={exchange} standing={standing} />
      </ConversationMarkHeld>
    </MessagePrimitive.Root>
  );
}
