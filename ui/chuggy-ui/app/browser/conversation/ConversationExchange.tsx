/**
 * One exchange drawn as a chat turn: the member's bubble on the right, the
 * assistant's answer flush left, and one quiet line under it.
 *
 * AN ANSWER IS DRAWN IN THE ORDER IT WAS WRITTEN: a text, the work that
 * followed it behind one line, the text after that. Each part keeps its place
 * and its node as more is written, as the transcript's own copy takes the
 * place of what was heard, and when the record is read again, so nothing a
 * reader has read leaves, shrinks or moves except by more being written below
 * it.
 *
 * A TURN NOBODY HAS ANSWERED DRAWS NO ANSWER TEXT. Each text is asked of the
 * library by its place among the message's texts, so a message holding none
 * is asked for none, and an exchange nothing is drawn of yet is the line its
 * first part will take and the line under that. The engine runs on the first
 * where the turn is the one moving, and the line is kept where it is not, so
 * a turn waiting behind another is the same shape before the engine reaches
 * it as after.
 *
 * ONE THING MOVES, AT THE END OF WHAT IS DRAWN. The surface names the one
 * exchange that may, and within it the turn is at its last part: the mark at
 * the end of a text, or the line of the work. The glyph under the answer
 * moves only where a turn has begun and has no part, and never while text is
 * still being let out above it: only the part drawing a text knows that, so
 * it says so to the line under the answer through a count the answer holds.
 * The surface holds the same count over every answer, and the engine of a
 * turn nothing is drawn of waits on it, so the turn before it has drawn its
 * last character before anything moves for the next.
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
 *
 * ONLY WHAT ARRIVES IS LET OUT AT A PACE. A text is drawn whole as it is first
 * drawn, whatever its turn is doing, so a page that opens on a turn part way
 * through writes none of it again.
 */

import { MessagePrimitive, useAuiState, useSmooth } from "@assistant-ui/react";
import type {
  MessagePartStatus,
  TextMessagePartComponent,
} from "@assistant-ui/react";
import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useLayoutEffect,
  useReducer,
  useState,
} from "react";
import type { ReactNode } from "react";

import { ticketReferenceSplit } from "../../../../../src/contract/ticketReference.ts";
import {
  conversationExchangeDoing,
  conversationExchangeNamed,
  conversationExchangeParts,
} from "../../core/conversation.ts";
import type {
  ConversationDoing,
  ConversationExchange,
  ConversationPart,
} from "../../core/conversation.ts";
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
import { ConversationWaiting } from "./ConversationWaiting.tsx";
import { ConversationWorkCard } from "./ConversationWorkCard.tsx";

import "./conversation.css";

/** Whether the surface draws each exchange's work open. */
export const ConversationWorkOpen = createContext(false);

/** Whether the surface lets an answer still being written out at an even
 * pace. */
export const ConversationPaced = createContext(false);

/** The exchange that holds the one thing on the surface that moves, where
 * there is one, by the name it keeps while the transcript comes to hold its
 * turn, and whether the engine is what runs for a turn nothing is drawn of. */
export interface ConversationIndicatedHeld {
  readonly named: string | undefined;
  readonly engine: boolean;
}

export const ConversationIndicated = createContext<ConversationIndicatedHeld>({
  named: undefined,
  engine: false,
});

const ConversationMarked = createContext(false);

const ConversationMarkedSaid = createContext<(by: number) => void>(
  () => undefined,
);

const ConversationLetting = createContext(false);

const ConversationLettingSaid = createContext<(by: number) => void>(
  () => undefined,
);

function conversationMarksCounted(held: number, by: number): number {
  return held + by;
}

/** Holds how many texts anywhere on the surface are carrying the mark. */
export function ConversationLettingHeld(props: {
  readonly children: ReactNode;
}): ReactNode {
  const [marks, marked] = useReducer(conversationMarksCounted, 0);
  return (
    <ConversationLettingSaid.Provider value={marked}>
      <ConversationLetting.Provider value={marks > 0}>
        {props.children}
      </ConversationLetting.Provider>
    </ConversationLettingSaid.Provider>
  );
}

/** Where a text stands in its answer: one no more is written of, since a part
 * follows it or its turn was stopped, the last part, or the last part of a
 * turn that is still at it. */
type ConversationTextPlace = "Closed" | "Last" | "UnderWay";

const ConversationTextPlaced = createContext<ConversationTextPlace>("Last");

/** Holds how many of an answer's texts are carrying the mark, apart from the
 * answer itself so that saying so draws its other parts again and no text,
 * and tells the surface of each. */
function ConversationMarkHeld(props: {
  readonly children: ReactNode;
}): ReactNode {
  const [marks, counted] = useReducer(conversationMarksCounted, 0);
  const surface = useContext(ConversationLettingSaid);
  const marked = useCallback(
    (by: number): void => {
      counted(by);
      surface(by);
    },
    [surface],
  );
  return (
    <ConversationMarkedSaid.Provider value={marked}>
      <ConversationMarked.Provider value={marks > 0}>
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

/** What the pace is told of every text: that it is whole. The pace begins a
 * text its part says is running from nothing, which would write again what a
 * reader had already read; told this it draws what it is first handed whole
 * and lets out at its pace only what is added after. */
const conversationPartWhole: MessagePartStatus = { type: "complete" };

/**
 * The report gives up its own panel here: what it sits on is already a
 * surface, and a box inside a box is width the words need more. It is still
 * being written while its turn is at it, and while the pace has yet to catch
 * up with what was heard of it.
 *
 * Only the last part of an answer is let out at a pace. A text something was
 * written after is drawn whole from then on, so a part is never drawn under
 * one still arriving and two texts never carry the mark at once; so is every
 * text of a turn that was stopped, at once, since a stop leaves nothing moving.
 */
const ConversationReport: TextMessagePartComponent = (props) => {
  const paced = useContext(ConversationPaced);
  const place = useContext(ConversationTextPlaced);
  const [closed, setClosed] = useState(false);
  if (place === "Closed" && !closed) setClosed(true);
  const shown = useSmooth(
    { ...props, status: conversationPartWhole },
    paced && !closed,
  );
  const writing = place === "UnderWay" || shown.text.length < props.text.length;
  const marked = useContext(ConversationMarkedSaid);
  useLayoutEffect(() => {
    if (!writing) return undefined;
    marked(1);
    return () => {
      marked(-1);
    };
  }, [marked, writing]);
  return (
    <div className={writing ? "conversation-writing" : undefined}>
      <MarkdownReport text={shown.text} bare writing={writing} />
    </div>
  );
};

const conversationReportComponents = { Text: ConversationReport };

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

function conversationTextPlace(
  last: boolean,
  underWay: boolean,
  stopped: boolean,
): ConversationTextPlace {
  if (!last || stopped) return "Closed";
  return underWay ? "UnderWay" : "Last";
}

/**
 * The parts of an answer in the order they were written. A text is named by
 * its place among the texts and a part of the work by the texts before it, so
 * work the record comes to hold between two texts moves neither.
 */
function conversationPartsDrawn(
  parts: readonly ConversationPart[],
  doing: ConversationDoing,
  shown: {
    readonly open: boolean;
    /** Whether this exchange holds the one thing that moves. */
    readonly mine: boolean;
    /** Whether the exchange's turn was stopped. */
    readonly stopped: boolean;
  },
): readonly ReactNode[] {
  const drawn: ReactNode[] = [];
  let texts = 0;
  parts.forEach((part, at) => {
    const last = at === parts.length - 1;
    if (part.part === "Work") {
      drawn.push(
        <ConversationWorkCard
          key={`work-${String(texts)}`}
          steps={part.steps}
          underWay={last && doing.doing === "Work" ? doing : undefined}
          live={shown.mine}
          open={shown.open}
        />,
      );
      return;
    }
    drawn.push(
      <ConversationTextPlaced.Provider
        key={`text-${String(texts)}`}
        value={conversationTextPlace(
          last,
          shown.mine && doing.doing === "Text",
          shown.stopped,
        )}
      >
        <MessagePrimitive.PartByIndex
          index={texts}
          components={conversationReportComponents}
        />
      </ConversationTextPlaced.Provider>,
    );
    texts += 1;
  });
  return drawn;
}

/** The line the first of an answer will take, on every turn nothing is drawn
 * of: the engine runs on it where `mine`, once no text on the surface is still
 * being let out, and until then it is kept, so the engine arriving moves
 * nothing. */
function ConversationEngine(props: { readonly mine: boolean }): ReactNode {
  const letting = useContext(ConversationLetting);
  return props.mine && !letting ? (
    <ConversationWaiting />
  ) : (
    <div className="conversation-waiting-kept" aria-hidden="true" />
  );
}

/** What an answer holds: its parts, the engine where nothing of it is drawn
 * yet, how it failed where it did, and the line under all of it. */
function ConversationAnswerBody(props: {
  readonly exchange: ConversationExchange;
  readonly standing: ConversationStandingDrawn;
}): ReactNode {
  const { exchange, standing } = props;
  const indicated = useContext(ConversationIndicated);
  const marked = useContext(ConversationMarked);
  const open = useContext(ConversationWorkOpen);
  const doing = conversationExchangeDoing(exchange);
  const mine = indicated.named === conversationExchangeNamed(exchange);
  return (
    <>
      {conversationPartsDrawn(conversationExchangeParts(exchange), doing, {
        open,
        mine,
        stopped: standing.standing === "Stopped",
      })}
      {doing.doing === "Unbegun" && indicated.engine ? (
        <ConversationEngine mine={mine} />
      ) : null}
      {standing.standing === "Failed" && standing.failure !== undefined ? (
        <Notice tone="danger" detail={standing.failure} />
      ) : null}
      <ConversationMetaLine
        exchange={exchange}
        standing={standing}
        live={mine}
        marked={marked}
        engine={indicated.engine}
      />
    </>
  );
}

/** The answer half of one exchange: what was written of it, in order, and
 * where it stands. It is marked busy for as long as its turn is out. */
export function ConversationAnswerMessage(): ReactNode {
  const exchange = useConversationExchange();
  if (exchange === undefined) return null;
  const standing = exchange.standing;
  if (standing.standing === "Markers") return null;
  return (
    <MessagePrimitive.Root
      className="conversation-answer flex flex-col gap-3"
      aria-busy={standing.standing === "Running"}
    >
      <ConversationMarkHeld>
        <ConversationAnswerBody exchange={exchange} standing={standing} />
      </ConversationMarkHeld>
    </MessagePrimitive.Root>
  );
}
